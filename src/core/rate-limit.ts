/**
 * 跨文档共享令牌桶：工作台页、图谱弹窗、阅读器 iframe 是不同文档，各自限速会
 * 把对站点的总请求率放大 N 倍。桶状态（{tokens, updatedAt, cooldownUntil, strikes}）
 * 落在可注入的异步 store（默认 localStorage，键 `loupe.rate.<key>`；不可用时退内存），
 * 每次「读-补充-取-写」都在 `navigator.locks` 的短临界区里完成——锁内不睡，
 * 需要等待时先释放锁再 sleep 再重试，与 cache/index.ts 的单飞锁同一模式。
 *
 * 优先级：'interactive'（阅读器/预览/定位/会话）只要有一个令牌就能取；
 * 'bulk'（analyzeSubject/analyzeThread 批量抓取）只在 `tokens >= 1 + reserve`
 * 时才取，永远给交互请求留出 reserve 个令牌——跑全量时读者不被饿死。
 *
 * 冷却：rate-limited 错误记一次 strike，`cooldownUntil = now + max(retryAfterMs, 30s·2^(n-1))`
 * 封顶 10 分钟；所有文档共享这段冷却（同一平台同一桶）。冷却后的首个成功把 strikes 清零。
 */
import { PlatformError } from './errors';

export type SleepFn = (ms: number, signal: AbortSignal) => Promise<void>;

function abortError(): PlatformError {
  return new PlatformError('aborted', '请求已取消');
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

export type RequestPriority = 'interactive' | 'bulk';

export interface LimiterState {
  tokens: number;
  updatedAt: number;
  cooldownUntil: number;
  strikes: number;
  /** AIMD 当前速率（rps）：1 起步，0.5 地板，4 封顶。 */
  rate: number;
  /** AIMD 慢速请求/限流前的连续快速成功计数（≥5 次 +0.2 rps）。 */
  fastStreak: number;
}

export interface LimiterStore {
  get(): Promise<LimiterState | null>;
  set(state: LimiterState): Promise<void>;
}

export interface SharedLimiterOptions {
  key: string;
  ratePerSec: number;
  burst: number;
  /** bulk 取令牌的水位线：tokens >= 1 + reserve。 */
  reserve: number;
  store?: LimiterStore;
  locks?: Pick<LockManager, 'request'> | null;
  now?: () => number;
  sleep?: SleepFn;
  /** 等待抖动用的随机源（测试注入固定值，默认 Math.random）。 */
  random?: () => number;
}

export interface SharedLimiter {
  /** 取一个令牌；需要等待时先 onWait(ms) 再睡到点重试。signal 贯穿可取消。 */
  acquire(priority: RequestPriority, signal: AbortSignal, onWait?: (ms: number) => void): Promise<void>;
  /** 平台回 rate-limited：记 strike、设共享冷却，并把速率砍半。 */
  noteRateLimited(retryAfterMs?: number): Promise<void>;
  /** 一次成功回源：清 strikes；latencyMs 喂 AIMD（快成功 +0.2/5连，>3s ×0.5）。 */
  noteSuccess(latencyMs?: number): Promise<void>;
}

const COOLDOWN_BASE_MS = 60_000;
const COOLDOWN_CAP_MS = 10 * 60_000;
// AIMD（TCP 式速率自适）：起始 1 rps；每 5 个连续 <1500ms 的成功 +0.2；
// rate-limited 或 >3000ms 的慢请求 ×0.5；地板 0.5、封顶 2（≈ 10 秒最多 20 个请求，接近真人翻页节奏）。
// 封顶不是随手定的：登录态下 `wbi/main` 连续快速请求会触发平台风控（HTTP 412），
// 而 412 一旦出现是账号 + IP 维度的，会连累正常浏览——宁可慢，不可像爬虫。
const RATE_FLOOR = 0.5;
const RATE_CEIL = 2;
const RATE_INCREASE = 0.2;
const FAST_STREAK_TARGET = 5;
const FAST_LATENCY_MS = 1500;
const SLOW_LATENCY_MS = 3000;
/** 等待时间的随机抖动：固定间隔本身就是机器人指纹。 */
const WAIT_JITTER = 0.15;

/** localStorage 存根：跨文档天然共享（同源扩展页面与 iframe 实测共享，见 ADR-0010）。 */
export function localStorageLimiterStore(key: string): LimiterStore {
  const storageKey = `loupe.rate.${key}`;
  const memory: { state: LimiterState | null } = { state: null };
  const storage = (): Storage | null => {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
      return null;
    }
  };
  return {
    async get() {
      try {
        const raw = storage()?.getItem(storageKey);
        if (raw !== null && raw !== undefined) return JSON.parse(raw) as LimiterState;
      } catch {
        /* 坏记录按没有处理 */
      }
      return memory.state;
    },
    async set(state) {
      memory.state = state;
      try {
        storage()?.setItem(storageKey, JSON.stringify(state));
      } catch {
        /* localStorage 满了/不可用时进程内存根仍保证本文档自洽 */
      }
    },
  };
}

export function createSharedLimiter(options: SharedLimiterOptions): SharedLimiter {
  const { key, ratePerSec, burst, reserve } = options;
  const store = options.store ?? localStorageLimiterStore(key);
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? ((ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  }));
  const locks = options.locks === undefined ? (typeof navigator === 'undefined' ? null : (navigator.locks ?? null)) : options.locks;
  // locks 不可用时退进程内串行链——单文档仍正确，跨文档只失去互斥（语义降级不放大速率，状态仍共享）。
  let chain: Promise<unknown> = Promise.resolve();
  const mutate = async <T>(fn: (state: LimiterState) => T | Promise<T>): Promise<T> => {
    const body = async (): Promise<T> => {
      const state = (await store.get()) ?? { tokens: burst, updatedAt: now(), cooldownUntil: 0, strikes: 0, rate: ratePerSec, fastStreak: 0 };
      if (state.rate === undefined) {
        state.rate = ratePerSec;
        state.fastStreak = 0;
      }
      state.tokens = Math.min(burst, state.tokens + ((now() - state.updatedAt) / 1000) * state.rate);
      state.updatedAt = now();
      const result = await fn(state);
      await store.set(state);
      return result;
    };
    if (locks) {
      return locks.request(`loupe-rate|${key}`, body) as Promise<T>;
    }
    const run = chain.then(body, body);
    chain = run.catch(() => {});
    return run;
  };

  return {
    async acquire(priority, signal, onWait) {
      for (;;) {
        throwIfAborted(signal);
        const waitMs = await mutate((state) => {
          const at = now();
          if (at < state.cooldownUntil) return state.cooldownUntil - at;
          // 交互优先只体现在水位线：批量要额外留出 reserve 给交互，交互拿 1 个令牌就走——但**两者都要排队**。
          // 旧实现让交互「没令牌也放行」，于是快速滚动时阅读器完全不限速，是登录态撞 412 的主要来源之一。
          const threshold = priority === 'interactive' ? 1 : 1 + reserve;
          if (state.tokens >= threshold) {
            state.tokens -= 1;
            return 0;
          }
          const base = ((threshold - state.tokens) / state.rate) * 1000;
          return Math.round(base * (1 + (random() * 2 - 1) * WAIT_JITTER));
        });
        if (waitMs <= 0) return;
        onWait?.(waitMs);
        await sleep(waitMs, signal);
      }
    },
    async noteRateLimited(retryAfterMs) {
      await mutate((state) => {
        state.strikes += 1;
        state.rate = Math.max(RATE_FLOOR, state.rate * 0.5);
        state.fastStreak = 0;
        const backoff = Math.min(COOLDOWN_CAP_MS, COOLDOWN_BASE_MS * 2 ** (state.strikes - 1));
        state.cooldownUntil = Math.max(state.cooldownUntil, now() + Math.max(retryAfterMs ?? 0, backoff));
      });
    },
    async noteSuccess(latencyMs) {
      await mutate((state) => {
        state.strikes = 0;
        if (latencyMs === undefined) return;
        if (latencyMs > SLOW_LATENCY_MS) {
          state.rate = Math.max(RATE_FLOOR, state.rate * 0.5);
          state.fastStreak = 0;
        } else if (latencyMs < FAST_LATENCY_MS) {
          state.fastStreak += 1;
          if (state.fastStreak >= FAST_STREAK_TARGET) {
            state.rate = Math.min(RATE_CEIL, state.rate + RATE_INCREASE);
            state.fastStreak = 0;
          }
        } else {
          state.fastStreak = 0;
        }
      });
    },
  };
}

/** 按平台取（或建）共享限速器：同一文档内所有 runner 复用同一实例，跨文档靠 store+locks 同步。 */
const registry = new Map<string, SharedLimiter>();
export function sharedLimiterFor(platform: string, rate: { ratePerSec: number; burst: number; reserve: number } | undefined): SharedLimiter | undefined {
  if (rate === undefined) return undefined;
  let limiter = registry.get(platform);
  if (limiter === undefined) {
    limiter = createSharedLimiter({ key: platform, ...rate });
    registry.set(platform, limiter);
  }
  return limiter;
}
