/** 共享令牌桶：两实例同 store 不超发、bulk 留 reserve、冷却共享与退避封顶、Retry-After。 */
import { describe, expect, it } from 'vitest';
import { createSharedLimiter, type LimiterState, type LimiterStore } from '@/core/rate-limit';

function env(rate: { ratePerSec?: number; burst?: number; reserve?: number } = {}) {
  let now = 0;
  const sleeps: number[] = [];
  const shared: { state: LimiterState | null } = { state: null };
  const store: LimiterStore = {
    get: async () => shared.state,
    set: async (s) => {
      shared.state = s;
    },
  };
  const opts = {
    key: 'bilibili',
    ratePerSec: rate.ratePerSec ?? 1,
    burst: rate.burst ?? 3,
    reserve: rate.reserve ?? 1,
    store,
    locks: null, // 单进程串行链即可验证语义
    now: () => now,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      now += ms;
    },
  };
  return {
    a: createSharedLimiter(opts),
    b: createSharedLimiter(opts),
    shared,
    sleeps,
    advance(ms: number): void {
      now += ms;
    },
    signal: new AbortController().signal,
  };
}

describe('createSharedLimiter', () => {
  it('两个实例共享一个桶：burst 3 之后按 rate 逐秒补充，合起来不超发', async () => {
    const { a, b, signal, sleeps, shared } = env();
    // 瞬间取 3 个令牌（两实例交错）——同一 store，不重复发
    await a.acquire('interactive', signal);
    await b.acquire('interactive', signal);
    await a.acquire('interactive', signal);
    expect(sleeps).toEqual([]);
    expect(shared.state!.tokens).toBe(0);
    // 第 4 个要等 1s 补充（rate=1/s），第 5 个再等 1s
    await a.acquire('interactive', signal);
    await b.acquire('interactive', signal);
    expect(sleeps).toEqual([1000, 1000]);
  });

  it('bulk 只在 tokens >= 1 + reserve 时取：interactive 永远有令牌', async () => {
    const { a, b, signal, sleeps, shared } = env({ burst: 3, reserve: 1 });
    // burst=3 / reserve=1：bulk 两次取到 tokens=1，第三次必须等补充到 2
    await a.acquire('bulk', signal);
    await a.acquire('bulk', signal);
    expect(shared.state!.tokens).toBe(1);
    await a.acquire('bulk', signal);
    expect(sleeps).toEqual([1000]); // 等 1s 才凑够 2 个令牌
    // interactive 不受 reserve 限制：tokens 不够 2 也照拿
    await b.acquire('interactive', signal);
    expect(sleeps).toHaveLength(1);
  });

  it('rate-limited → 冷却共享给所有实例，按 30s·2^(n-1) 退避封顶 10min', async () => {
    const { a, b, signal, sleeps } = env();
    await a.acquire('interactive', signal);
    await a.noteRateLimited(); // strike 1 → 30s
    await b.acquire('interactive', signal); // 另一实例同样等到冷却结束
    expect(sleeps.at(-1)).toBe(30_000);
    await b.noteRateLimited(); // strike 2 → 60s
    await a.acquire('interactive', signal);
    expect(sleeps.at(-1)).toBe(60_000);
    for (let i = 0; i < 10; i++) await a.noteRateLimited();
    await b.acquire('interactive', signal);
    expect(sleeps.at(-1)).toBe(600_000); // 封顶 10 分钟
  });

  it('Retry-After 大于退避时以它为准', async () => {
    const { a, b, signal, sleeps } = env();
    await a.acquire('interactive', signal);
    await a.noteRateLimited(45_000);
    await b.acquire('interactive', signal);
    expect(sleeps.at(-1)).toBe(45_000);
  });

  it('缓存命中不消耗令牌：acquire 只服务真实回源（调用方约定）', async () => {
    const { a, shared } = env();
    // acquire 之外的路径（缓存命中）不碰桶——状态仍是初始
    expect(shared.state).toBeNull();
    await a.noteSuccess();
    expect(shared.state).not.toBeNull();
  });
});
