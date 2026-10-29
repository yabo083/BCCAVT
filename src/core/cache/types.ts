/**
 * 缓存契约。原则（assets/principles/Caching System Design Guide.md）：
 * - 缓存只是优化，不是正确性来源：存储层失败一律降级为回源，绝不让分析失败。
 * - 键稳定、带命名空间与 schema 版本：CACHE_SCHEMA 变更 = 整体失效。
 * - 新鲜度分级：不同数据不同 TTL；不可变数据用新键而非覆盖。
 * - 防三雪：getOrLoad 单飞（击穿）、TTL 抖动（雪崩）、负缓存由调用方以短 TTL 显式写入（穿透）。
 * - 命中率可观测：stats() 暴露各层命中/回源计数。
 */

/** 新鲜度等级。 */
export type Freshness =
  /** 鉴权/签名材料（登录态、WBI 密钥）。 */
  | 'session'
  /** 主体元数据（标题、评论总数）。 */
  | 'meta'
  /** 原始评论分页。 */
  | 'page'
  /** 不可变：完成的分析快照、内容寻址的 AI 结果。键里必须带版本/时间戳/内容哈希。 */
  | 'immutable'
  /** 可变指针（如"某目标的最新快照 id"），无 TTL，显式覆盖。 */
  | 'pointer';

/** 各等级 TTL（毫秒），null 表示不过期。实现对有限 TTL 施加 ±10% 抖动。 */
export const FRESHNESS_TTL_MS: Record<Freshness, number | null> = {
  session: 30 * 60_000,
  meta: 10 * 60_000,
  page: 10 * 60_000,
  immutable: null,
  pointer: null,
};

/** 递增即令全部旧条目失效（序列化契约变更时）。 */
export const CACHE_SCHEMA = 2;

export interface CacheEntry<T> {
  key: string;
  value: T;
  storedAt: number;
  /** null 表示不过期。 */
  expiresAt: number | null;
}

export type CacheSource = 'memory' | 'disk' | 'network';

export interface LoadResult<T> {
  value: T;
  source: CacheSource;
  storedAt: number;
}

export interface LoadOptions {
  /** 忽略已有条目，强制回源并回写。 */
  force?: boolean;
}

export interface CacheLayerStats {
  hits: number;
  misses: number;
}

export interface CacheStats {
  memory: CacheLayerStats;
  disk: CacheLayerStats;
  /** 回源（loader 实际执行）次数。 */
  loads: number;
  /** 被单飞合并掉的并发请求数。 */
  coalesced: number;
  /** 存储层异常后降级回源的次数。 */
  degraded: number;
}

export interface Cache {
  /** 读取未过期条目；过期或不存在返回 undefined。 */
  get<T>(key: string): Promise<CacheEntry<T> | undefined>;
  set<T>(key: string, value: T, freshness: Freshness): Promise<void>;
  /** 命中返回缓存；否则执行 loader（同键并发只执行一次）并按 freshness 回写。loader 抛错不写缓存。 */
  getOrLoad<T>(key: string, freshness: Freshness, loader: () => Promise<T>, options?: LoadOptions): Promise<LoadResult<T>>;
  delete(key: string): Promise<void>;
  /** 删除所有以 prefix 开头的键。 */
  deletePrefix(prefix: string): Promise<void>;
  /** 列出以 prefix 开头的键（不含值），用于历史记录等。 */
  keys(prefix: string): Promise<string[]>;
  stats(): CacheStats;
  /** 磁盘层占用估算。 */
  usage(): Promise<{ entries: number; bytes: number }>;
}

/** 规范化缓存键：`v<schema>|<part>|<part>…`，各段不得含 '|'。 */
export function cacheKey(...parts: (string | number)[]): string {
  return [`v${CACHE_SCHEMA}`, ...parts.map(String)].join('|');
}
