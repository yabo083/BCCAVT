/**
 * 引擎对 UI 的契约：快照、评论树、分析报告、工作台门面。
 * UI 只依赖本文件 + model.ts + ai/types.ts，不直接调用适配器或缓存。
 */
import type { CacheStats } from './cache/types';
import type { PlatformAdapter } from './platform';
import type { Author, Comment, PlatformId, Session, Subject, SubjectRef, Target } from './model';

// ───────────────────────── 快照 ─────────────────────────

export const SNAPSHOT_SCHEMA = 1;

export interface Completeness {
  /** 平台声明的总数（主体级 = 评论总数；树级 = 根评论 replyCount + 1）。 */
  declared?: number;
  fetched: number;
  /** 因上限 / 未登录 / 平台隐藏导致未取全。 */
  truncated: boolean;
  /** 每条一句人话，直接展示，例如"未登录：顶层评论仅返回前 3 条"。 */
  reasons: string[];
}

export interface FetchStats {
  requests: number;
  cacheHits: number;
  retries: number;
  durationMs: number;
}

/** 一次抓取的不可变结果。comments 按 id 去重，顺序无语义。 */
export interface Snapshot {
  schema: typeof SNAPSHOT_SCHEMA;
  /** `${targetKey}@${fetchedAt}` */
  id: string;
  target: Target;
  subject: Subject;
  /** 树级快照：真实根评论 id。 */
  rootId?: string;
  comments: Comment[];
  fetchedAt: number;
  auth: 'anonymous' | 'user';
  completeness: Completeness;
  fetchStats: FetchStats;
}

export interface SnapshotSummary {
  id: string;
  target: Target;
  title: string;
  coverUrl?: string;
  fetchedAt: number;
  commentCount: number;
  truncated: boolean;
}

// ───────────────────────── 评论树 ─────────────────────────

export interface CommentNode {
  comment: Comment;
  children: CommentNode[];
  parent: CommentNode | null;
  /** 根 = 0。 */
  depth: number;
  /** 子树节点数（含自身）。 */
  size: number;
}

export interface Forest {
  roots: CommentNode[];
  byId: Map<string, CommentNode>;
  /** 父评论缺失（被删 / 未抓到）而挂到根下的节点数。 */
  orphans: number;
}

// ───────────────────────── 报告 ─────────────────────────

export interface Overview {
  total: number;
  roots: number;
  replies: number;
  authors: number;
  totalLikes: number;
  medianLikes: number;
  maxDepth: number;
  /** epoch ms；空集为 null */
  firstAt: number | null;
  lastAt: number | null;
}

export interface TimeBucket {
  start: number;
  end: number;
  count: number;
}

export interface Timeline {
  /** 桶宽毫秒（自适应：小时 / 天 / 周）。 */
  bucketMs: number;
  buckets: TimeBucket[];
}

export interface CountItem {
  label: string;
  count: number;
}

export interface AuthorStat {
  author: Author;
  comments: number;
  likes: number;
}

export interface ThreadDigest {
  root: Comment;
  size: number;
  depth: number;
  participants: number;
}

/** 两个作者之间的往返对话。 */
export interface Exchange {
  a: Author;
  b: Author;
  /** a↔b 互相回复的总次数。 */
  turns: number;
}

export interface SubjectReport {
  overview: Overview;
  timeline: Timeline;
  keywords: CountItem[];
  topComments: Comment[];
  hotThreads: ThreadDigest[];
  activeAuthors: AuthorStat[];
  locations: CountItem[];
  levels: CountItem[];
  depthHistogram: CountItem[];
  /** 全评论区最激烈的作者对。 */
  exchanges: Exchange[];
}

export interface ThreadReport {
  overview: Overview;
  root: Comment;
  /** 用户指定的评论（楼中楼时与 root 不同）。 */
  focusId: string;
  timeline: Timeline;
  participants: AuthorStat[];
  exchanges: Exchange[];
  /** 从根到最深叶子的最长回复链。 */
  longestChain: Comment[];
  keywords: CountItem[];
  locations: CountItem[];
}

// ───────────────────────── 工作台门面 ─────────────────────────

export type CrawlPhase = 'session' | 'subject' | 'roots' | 'threads' | 'analyze' | 'done';

export interface CrawlProgress {
  phase: CrawlPhase;
  fetched: number;
  declared?: number;
  requests: number;
  cacheHits: number;
  /** threads 阶段：已完成 / 待抓取的评论树数。 */
  threadsDone?: number;
  threadsTotal?: number;
  /** 正在退避等待风控解除时的提示。 */
  waitingMs?: number;
}

export type RefreshMode =
  /** 有快照直接用快照。 */
  | 'cache-first'
  /** 重新遍历顶层分页，仅对 replyCount 变化的评论树重新抓取（子树级增量）。 */
  | 'incremental'
  /** 全部回源。 */
  | 'full';

export interface CrawlOptions {
  refresh: RefreshMode;
  /** 顶层评论上限；超出即停止并标记 truncated。 */
  maxRoots: number;
  /** 单棵评论树回复上限。 */
  maxRepliesPerThread: number;
}

export const DEFAULT_CRAWL_OPTIONS: CrawlOptions = {
  refresh: 'cache-first',
  maxRoots: 3000,
  maxRepliesPerThread: 2000,
};

export interface AnalysisResult<R> {
  snapshot: Snapshot;
  forest: Forest;
  report: R;
  /** 本次结果直接来自已有快照（未发请求）。 */
  fromSnapshot: boolean;
}

export interface ResolvedInput {
  adapter: PlatformAdapter;
  target: Target;
}

export interface Workbench {
  readonly adapters: readonly PlatformAdapter[];
  /** 依次尝试各适配器的 parseTarget；都不认返回 null。 */
  resolve(input: string): ResolvedInput | null;
  session(platform: PlatformId, signal?: AbortSignal): Promise<Session>;
  analyzeSubject(
    ref: SubjectRef,
    options: CrawlOptions,
    onProgress: (progress: CrawlProgress) => void,
    signal: AbortSignal,
  ): Promise<AnalysisResult<SubjectReport>>;
  /** 若最新主体快照已包含该树的完整回复，直接复用而不发请求。 */
  analyzeThread(
    ref: SubjectRef,
    commentId: string,
    options: CrawlOptions,
    onProgress: (progress: CrawlProgress) => void,
    signal: AbortSignal,
  ): Promise<AnalysisResult<ThreadReport>>;
  /** 历史快照，新到旧。 */
  history(): Promise<SnapshotSummary[]>;
  /** 打开历史快照并重算报告（不发请求）。 */
  openSnapshot(id: string): Promise<AnalysisResult<SubjectReport> | AnalysisResult<ThreadReport>>;
  deleteSnapshot(id: string): Promise<void>;
  clearCache(): Promise<void>;
  cacheStats(): CacheStats;
  cacheUsage(): Promise<{ entries: number; bytes: number }>;
}
