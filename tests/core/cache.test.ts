import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCache } from '@/core/cache/index';
import { CACHE_SCHEMA, FRESHNESS_TTL_MS, cacheKey } from '@/core/cache/types';
import { uniqueDbName } from './fakes';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('缓存 TTL', () => {
  it('有限 TTL 带 ±10% 抖动，过期后读不到', async () => {
    let clock = 1_000_000;
    const cache = createCache({ dbName: uniqueDbName(), now: () => clock });
    const key = cacheKey('meta', 'video');
    await cache.set(key, { title: 'x' }, 'meta');

    const entry = await cache.get<{ title: string }>(key);
    expect(entry?.value).toEqual({ title: 'x' });
    const ttl = FRESHNESS_TTL_MS.meta!;
    const actualTtl = entry!.expiresAt! - entry!.storedAt;
    expect(actualTtl).toBeGreaterThanOrEqual(Math.round(ttl * 0.9));
    expect(actualTtl).toBeLessThanOrEqual(Math.round(ttl * 1.1));

    clock += Math.floor(ttl * 0.8); // 抖动下界（0.9 倍）之内，仍新鲜
    expect((await cache.get(key))?.value).toEqual({ title: 'x' });
    clock += Math.ceil(ttl * 0.35); // 累计 1.15 倍，越过抖动上界必然过期
    expect(await cache.get(key)).toBeUndefined();
  });

  it('immutable / pointer 不过期', async () => {
    let clock = 5_000;
    const cache = createCache({ dbName: uniqueDbName(), now: () => clock });
    await cache.set(cacheKey('snapshot', 'a@1'), 1, 'immutable');
    await cache.set(cacheKey('pointer', 'latest'), 'a@1', 'pointer');
    clock += 400 * 24 * 3_600_000;
    expect((await cache.get<number>(cacheKey('snapshot', 'a@1')))?.value).toBe(1);
    expect((await cache.get<string>(cacheKey('pointer', 'latest')))?.value).toBe('a@1');
  });

  it('磁盘层跨实例持久化（内存层关闭也读得到）', async () => {
    const dbName = uniqueDbName();
    const writer = createCache({ dbName, memoryEntries: 0 });
    await writer.set(cacheKey('page', 'p1'), { n: 1 }, 'page');

    const reader = createCache({ dbName, memoryEntries: 0 });
    const entry = await reader.get<{ n: number }>(cacheKey('page', 'p1'));
    expect(entry?.value).toEqual({ n: 1 });
    expect(reader.stats().disk.hits).toBe(1);
  });
});

describe('getOrLoad 单飞', () => {
  it('同键并发只执行一次 loader，其余计入 coalesced', async () => {
    // 内存-only（IDB 不可用）：读取全在微任务里完成，单飞判定不依赖真实计时器。
    vi.stubGlobal('indexedDB', {
      open() {
        throw new Error('indexedDB 不可用');
      },
    });
    const cache = createCache({ dbName: uniqueDbName() });
    let release!: (value: number) => void;
    let loads = 0;
    const loader = (): Promise<number> => {
      loads++;
      return new Promise<number>((resolve) => {
        release = resolve;
      });
    };

    const pending = Promise.all([1, 2, 3, 4, 5].map(() => cache.getOrLoad(cacheKey('page', 'single'), 'page', loader)));
    for (let i = 0; i < 100 && cache.stats().coalesced < 4; i++) await Promise.resolve();
    expect(cache.stats().coalesced).toBe(4);
    release(7);
    const results = await pending;

    expect(loads).toBe(1);
    expect(results.map((result) => result.value)).toEqual([7, 7, 7, 7, 7]);
    expect(results.every((result) => result.source === 'network')).toBe(true);
    expect(cache.stats().loads).toBe(1);
  });

  it('force 也走单飞（同步登记，不重复回源）', async () => {
    const cache = createCache({ dbName: uniqueDbName() });
    let release!: (value: number) => void;
    let loads = 0;
    const loader = (): Promise<number> => {
      loads++;
      return new Promise<number>((resolve) => {
        release = resolve;
      });
    };

    const pending = Promise.all([1, 2, 3].map(() => cache.getOrLoad(cacheKey('page', 'forced'), 'page', loader, { force: true })));
    release(9);
    const results = await pending;

    expect(loads).toBe(1);
    expect(results.map((result) => result.value)).toEqual([9, 9, 9]);
    expect(cache.stats().coalesced).toBe(2);
  });

  it('force 跳过已有条目并回写', async () => {
    const cache = createCache({ dbName: uniqueDbName() });
    const key = cacheKey('meta', 'force');
    await cache.set(key, 1, 'meta');
    expect((await cache.getOrLoad(key, 'meta', async () => 2)).value).toBe(1);
    expect((await cache.getOrLoad(key, 'meta', async () => 2, { force: true })).value).toBe(2);
    expect((await cache.get<number>(key))?.value).toBe(2);
  });

  it('loader 抛错透传且不写缓存', async () => {
    const cache = createCache({ dbName: uniqueDbName() });
    const key = cacheKey('meta', 'boom');
    const boom = new Error('boom');
    let calls = 0;
    const failing = async (): Promise<number> => {
      calls++;
      throw boom;
    };
    await expect(cache.getOrLoad(key, 'meta', failing)).rejects.toBe(boom);
    await expect(cache.getOrLoad(key, 'meta', failing)).rejects.toBe(boom);
    expect(calls).toBe(2);
    expect(await cache.get(key)).toBeUndefined();
  });
});

describe('LRU 淘汰', () => {
  it('内存层按访问顺序淘汰', async () => {
    const cache = createCache({ dbName: uniqueDbName(), memoryEntries: 2 });
    const key = (name: string): string => cacheKey('mem', name);
    await cache.set(key('a'), 1, 'page');
    await cache.set(key('b'), 2, 'page');

    expect((await cache.get(key('a')))?.value).toBe(1); // 提升 a
    await cache.set(key('c'), 3, 'page'); // 挤掉 b

    const before = cache.stats();
    expect((await cache.get(key('a')))?.value).toBe(1);
    expect(cache.stats().memory.hits).toBe(before.memory.hits + 1);
    expect((await cache.get(key('b')))?.value).toBe(2); // 内存未命中，从磁盘回来
    expect(cache.stats().memory.misses).toBe(before.memory.misses + 1);
    expect(cache.stats().disk.hits).toBe(before.disk.hits + 1);
  });

  it('磁盘层超预算时按 lastAccess 淘汰最旧记录', async () => {
    let clock = 1_000;
    const cache = createCache({ dbName: uniqueDbName(), memoryEntries: 0, diskBudgetBytes: 300, now: () => clock });
    const key = (name: string): string => cacheKey('disk', name);
    await cache.set(key('a'), 'x'.repeat(50), 'immutable');
    clock += 10;
    await cache.set(key('b'), 'y'.repeat(50), 'immutable');
    clock += 10;
    await cache.set(key('c'), 'z'.repeat(50), 'immutable');
    expect((await cache.usage()).entries).toBe(3);

    clock += 10;
    await cache.set(key('d'), 'w'.repeat(200), 'immutable');

    const usage = await cache.usage();
    expect(usage.entries).toBe(2);
    expect(await cache.get(key('a'))).toBeUndefined();
    expect(await cache.get(key('b'))).toBeUndefined();
    expect((await cache.get(key('c')))?.value).toBe('z'.repeat(50));
    expect((await cache.get(key('d')))?.value).toBe('w'.repeat(200));
  });
});

describe('降级与键空间', () => {
  it('IndexedDB 抛错时降级为内存 / 回源，不抛给调用方', async () => {
    vi.stubGlobal('indexedDB', {
      open() {
        throw new Error('indexedDB 不可用');
      },
    });
    const cache = createCache({ dbName: uniqueDbName() });
    const key = cacheKey('meta', 'broken');

    expect(await cache.get(key)).toBeUndefined();
    await cache.set(key, { v: 1 }, 'meta');
    expect((await cache.get(key))?.value).toEqual({ v: 1 });

    let loads = 0;
    const loaded = await cache.getOrLoad(cacheKey('meta', 'fallback'), 'meta', async () => {
      loads++;
      return 42;
    });
    expect(loaded.value).toBe(42);
    expect(loads).toBe(1);
    expect(cache.stats().degraded).toBeGreaterThan(0);
    expect(await cache.usage()).toEqual({ entries: 0, bytes: 0 });
    await cache.deletePrefix('');
  });

  it('keys / deletePrefix 跨两层生效', async () => {
    const cache = createCache({ dbName: uniqueDbName() });
    await cache.set(cacheKey('a', '1'), 1, 'meta');
    await cache.set(cacheKey('a', '2'), 2, 'meta');
    await cache.set(cacheKey('b', '1'), 3, 'meta');

    const keys = await cache.keys(cacheKey('a'));
    expect(keys.sort()).toEqual([cacheKey('a', '1'), cacheKey('a', '2')].sort());

    await cache.delete(cacheKey('a', '1'));
    await cache.deletePrefix(cacheKey('a'));
    expect(await cache.keys(cacheKey('a'))).toEqual([]);
    expect((await cache.get(cacheKey('b', '1')))?.value).toBe(3);

    await cache.deletePrefix('');
    expect(await cache.keys(cacheKey('b'))).toEqual([]);
  });

  it('忽略非当前 CACHE_SCHEMA 的键', async () => {
    const cache = createCache({ dbName: uniqueDbName() });
    const stale = `v${CACHE_SCHEMA - 1}|meta|old`;
    await cache.set(stale, 'old', 'meta');
    expect(await cache.get(stale)).toBeUndefined();
  });
});
