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
}

export interface SharedLimiter {
  /** 取一个令牌；需要等待时先 onWait(ms) 再睡到点重试。signal 贯穿可取消。 */
  acquire(priority: RequestPriority, signal: AbortSignal, onWait?: (ms: number) => void): Promise<void>;
  /** 平台回 rate-limited：记 strike 并设共享冷却。 */
  noteRateLimited(retryAfterMs?: number): Promise<void>;
  /** 一次成功回源：清 strikes（冷却由时间自然过期）。 */
  noteSuccess(): Promise<void>;
}

const COOLDOWN_BASE_MS = 30_000;
const COOLDOWN_CAP_MS = 10 * 60_000;

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
      const state = (await store.get()) ?? { tokens: burst, updatedAt: now(), cooldownUntil: 0, strikes: 0 };
      state.tokens = Math.min(burst, state.tokens + ((now() - state.updatedAt) / 1000) * ratePerSec);
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
          const threshold = priority === 'bulk' ? 1 + reserve : 1;
          if (at < state.cooldownUntil) return state.cooldownUntil - at;
          if (state.tokens >= threshold) {
            state.tokens -= 1;
            return 0;
          }
          return ((threshold - state.tokens) / ratePerSec) * 1000;
        });
        if (waitMs <= 0) return;
        onWait?.(waitMs);
        await sleep(waitMs, signal);
      }
    },
    async noteRateLimited(retryAfterMs) {
      await mutate((state) => {
        state.strikes += 1;
        const backoff = Math.min(COOLDOWN_CAP_MS, COOLDOWN_BASE_MS * 2 ** (state.strikes - 1));
        state.cooldownUntil = Math.max(state.cooldownUntil, now() + Math.max(retryAfterMs ?? 0, backoff));
      });
    },
    async noteSuccess() {
      await mutate((state) => {
        state.strikes = 0;
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
