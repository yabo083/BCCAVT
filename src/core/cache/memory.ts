import type { Cache, CacheEntry, CacheStats, Freshness, LoadOptions, LoadResult } from './types';
import { FRESHNESS_TTL_MS } from './types';

/**
 * 内存层：单个 Map 的插入序即 LRU 顺序。
 * 读取命中先删后插（提升热度），写入超出容量时从表头淘汰；容量 <= 0 表示不缓存。
 */
export class MemoryLru {
  private readonly entries = new Map<string, CacheEntry<unknown>>();

  constructor(private readonly capacity: number) {}

  get(key: string, now: number): CacheEntry<unknown> | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  set(entry: CacheEntry<unknown>): void {
    if (this.capacity <= 0) return;
    this.entries.delete(entry.key);
    this.entries.set(entry.key, entry);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  deletePrefix(prefix: string): void {
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }

  keys(prefix: string): string[] {
    return [...this.entries.keys()].filter((key) => key.startsWith(prefix));
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * 纯内存 Cache：同一份 {@link Cache} 契约，但绝不碰 IndexedDB。
 * 给页面上下文（内容脚本）用——那里的 IndexedDB 属于页面源（bilibili.com），不能落盘；
 * 语义与两级缓存一致：TTL 按 freshness、getOrLoad 单飞、loader 抛错不写缓存。
 * 不施加 TTL 抖动：抖动是为了打散多客户端的磁盘过期，单进程内存层不需要。
 */
export function createMemoryCache(options: { now?: () => number; capacity?: number } = {}): Cache {
  const now = options.now ?? Date.now;
  const entries = new MemoryLru(options.capacity ?? 200);
  const inflight = new Map<string, Promise<LoadResult<unknown>>>();
  const stats: CacheStats = {
    memory: { hits: 0, misses: 0 },
    disk: { hits: 0, misses: 0 },
    loads: 0,
    coalesced: 0,
    degraded: 0,
  };

  const cache: Cache = {
    async get<T>(key: string): Promise<CacheEntry<T> | undefined> {
      const entry = entries.get(key, now());
      if (entry === undefined) {
        stats.memory.misses++;
        return undefined;
      }
      stats.memory.hits++;
      return entry as CacheEntry<T>;
    },

    async set<T>(key: string, value: T, freshness: Freshness): Promise<void> {
      const storedAt = now();
      const ttl = FRESHNESS_TTL_MS[freshness];
      entries.set({ key, value, storedAt, expiresAt: ttl === null ? null : storedAt + ttl });
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
        const hit = await cache.get<T>(key);
        if (hit !== undefined) return { value: hit.value, source: 'memory', storedAt: hit.storedAt };
        const raced = inflight.get(key);
        if (raced !== undefined) {
          stats.coalesced++;
          return raced as Promise<LoadResult<T>>;
        }
      }

      const task = (async (): Promise<LoadResult<T>> => {
        stats.loads++;
        const value = await loader();
        await cache.set(key, value, freshness);
        return { value, source: 'network', storedAt: now() };
      })();
      inflight.set(key, task as Promise<LoadResult<unknown>>);
      try {
        return await task;
      } finally {
        inflight.delete(key);
      }
    },

    async delete(key: string): Promise<void> {
      entries.delete(key);
    },

    async deletePrefix(prefix: string): Promise<void> {
      entries.deletePrefix(prefix);
    },

    async keys(prefix: string): Promise<string[]> {
      return entries.keys(prefix).sort();
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
      return { entries: entries.size, bytes: 0 };
    },
  };

  return cache;
}
