import { DiskStore, type DiskRecord } from './disk';
import { MemoryLru } from './memory';
import type { Cache, CacheEntry, CacheSource, CacheStats, Freshness, LoadOptions, LoadResult } from './types';
import { CACHE_SCHEMA, FRESHNESS_TTL_MS } from './types';

export interface CreateCacheOptions {
  dbName?: string;
  memoryEntries?: number;
  /** 磁盘层字节预算；<= 0 表示不淘汰。 */
  diskBudgetBytes?: number;
  now?: () => number;
  /**
   * 跨文档单飞用的 Web Locks（默认 `navigator.locks`）。
   * 扩展源 iframe 与顶层扩展页共享同一份 IndexedDB **和**同一份锁空间（实测 Chrome 156），
   * 因此多个文档对同一键的并发 getOrLoad 由锁串行化：拿到锁后先复读一次，
   * 另一个文档刚写完的值直接命中，loader 只跑一次。传 `null` 关闭（行为退化为仅本文档单飞）。
   */
  locks?: Pick<LockManager, 'request'> | null;
}

const SCHEMA_PREFIX = `v${CACHE_SCHEMA}|`;

/**
 * 两级缓存：内存 LRU 覆盖 IndexedDB。
 * 存储层只提供速度，任何 IndexedDB 异常都降级为回源（计入 degraded），绝不把错误抛给调用方；
 * 只有 loader 自身的错误会透传，且不写缓存。
 */
export function createCache(options: CreateCacheOptions = {}): Cache {
  const now = options.now ?? Date.now;
  const memory = new MemoryLru(options.memoryEntries ?? 500);
  const disk = new DiskStore(options.dbName ?? 'loupe');
  const budget = options.diskBudgetBytes ?? 200 * 1024 * 1024;
  const locks = options.locks === undefined ? (globalThis.navigator?.locks ?? null) : options.locks;
  const stats: CacheStats = {
    memory: { hits: 0, misses: 0 },
    disk: { hits: 0, misses: 0 },
    loads: 0,
    coalesced: 0,
    degraded: 0,
  };
  /** 单飞表：同键并发只跑一次 loader。 */
  const inflight = new Map<string, Promise<LoadResult<unknown>>>();

  async function deleteFromDisk(key: string): Promise<void> {
    if (!disk.usable) return;
    try {
      await disk.delete(key);
    } catch {
      stats.degraded++;
    }
  }

  async function read<T>(key: string): Promise<{ entry: CacheEntry<T>; source: CacheSource } | undefined> {
    if (!key.startsWith(SCHEMA_PREFIX)) return undefined;

    const at = now();
    const cached = memory.get(key, at);
    if (cached !== undefined) {
      stats.memory.hits++;
      return {
        entry: { key, value: cached.value as T, storedAt: cached.storedAt, expiresAt: cached.expiresAt },
        source: 'memory',
      };
    }
    stats.memory.misses++;

    let record: DiskRecord | undefined;
    if (disk.usable) {
      try {
        record = await disk.get(key);
      } catch {
        stats.degraded++;
        return undefined;
      }
    }
    if (record === undefined) {
      if (disk.usable) stats.disk.misses++;
      return undefined;
    }
    // 旧 CACHE_SCHEMA 写入的条目一律忽略。
    if (!record.key.startsWith(SCHEMA_PREFIX)) return undefined;
    if (record.expiresAt !== null && record.expiresAt <= at) {
      stats.disk.misses++;
      void deleteFromDisk(key);
      return undefined;
    }

    stats.disk.hits++;
    memory.set({ key, value: record.value, storedAt: record.storedAt, expiresAt: record.expiresAt });
    if (disk.usable) {
      disk.touch(key, at).catch(() => {
        stats.degraded++;
      });
    }
    return {
      entry: { key, value: record.value as T, storedAt: record.storedAt, expiresAt: record.expiresAt },
      source: 'disk',
    };
  }

  const cache: Cache = {
    async get<T>(key: string): Promise<CacheEntry<T> | undefined> {
      return (await read<T>(key))?.entry;
    },

    async set<T>(key: string, value: T, freshness: Freshness): Promise<void> {
      const at = now();
      const ttl = FRESHNESS_TTL_MS[freshness];
      // 雪崩防护：有限 TTL 施加 ±10% 抖动。
      const expiresAt = ttl === null ? null : at + Math.round(ttl * (1 + (Math.random() * 0.2 - 0.1)));
      memory.set({ key, value, storedAt: at, expiresAt });

      if (!disk.usable) return;
      const json = JSON.stringify(value);
      const bytes = json === undefined ? 0 : json.length;
      try {
        await disk.put({ key, value, storedAt: at, expiresAt, lastAccess: at, bytes });
        if (budget > 0) await disk.evictTo(budget);
      } catch {
        stats.degraded++;
      }
    },

    async getOrLoad<T>(
      key: string,
      freshness: Freshness,
      loader: () => Promise<T>,
      loadOptions?: LoadOptions,
    ): Promise<LoadResult<T>> {
      const running = inflight.get(key);
      if (running !== undefined) {
        stats.coalesced++;
        return running as Promise<LoadResult<T>>;
      }
      if (loadOptions?.force !== true) {
        const hit = await read<T>(key);
        if (hit !== undefined && (loadOptions?.freshAfter === undefined || hit.entry.storedAt >= loadOptions.freshAfter)) {
          return { value: hit.entry.value, source: hit.source, storedAt: hit.entry.storedAt };
        }
        const raced = inflight.get(key);
        if (raced !== undefined) {
          stats.coalesced++;
          return raced as Promise<LoadResult<T>>;
        }
      }

      const task = (async (): Promise<LoadResult<T>> => {
        const load = async (): Promise<LoadResult<T>> => {
          stats.loads++;
          const value = await loader();
          await cache.set(key, value, freshness);
          return { value, source: 'network', storedAt: now() };
        };
        if (locks === null) return load();
        // 跨文档单飞：拿到锁再复读一次——等待期间另一个文档可能已把值写进磁盘，
        // 此时直接按普通磁盘命中返回，loader 全链路只跑一次。
        let reachedLoader = false;
        try {
          return await locks.request(`loupe-cache|${key}`, async () => {
            if (loadOptions?.force !== true) {
              const hit = await read<T>(key);
              if (hit !== undefined && (loadOptions?.freshAfter === undefined || hit.entry.storedAt >= loadOptions.freshAfter)) {
                return { value: hit.entry.value, source: hit.source, storedAt: hit.entry.storedAt };
              }
            }
            reachedLoader = true;
            return load();
          });
        } catch (error) {
          // loader 自身的抛错必须原样透传；只有锁设施拿不到锁才降级为无锁回源。
          if (reachedLoader) throw error;
          stats.degraded++;
          return load();
        }
      })();
      inflight.set(key, task as Promise<LoadResult<unknown>>);
      try {
        return await task;
      } finally {
        inflight.delete(key);
      }
    },

    async delete(key: string): Promise<void> {
      memory.delete(key);
      await deleteFromDisk(key);
    },

    async deletePrefix(prefix: string): Promise<void> {
      memory.deletePrefix(prefix);
      if (!disk.usable) return;
      try {
        await disk.deleteMany(await disk.keys(prefix));
      } catch {
        stats.degraded++;
      }
    },

    async keys(prefix: string): Promise<string[]> {
      const found = new Set(memory.keys(prefix));
      if (!disk.usable) return [...found];
      try {
        for (const key of await disk.keys(prefix)) found.add(key);
      } catch {
        stats.degraded++;
      }
      return [...found];
    },

    stats(): CacheStats {
      return {
        memory: { ...stats.memory },
        disk: { ...stats.disk },
        loads: stats.loads,
        coalesced: stats.coalesced,
        degraded: stats.degraded,
      };
    },

    async usage(): Promise<{ entries: number; bytes: number }> {
      if (!disk.usable) return { entries: 0, bytes: 0 };
      try {
        return await disk.usage();
      } catch {
        stats.degraded++;
        return { entries: 0, bytes: 0 };
      }
    },
  };

  return cache;
}
