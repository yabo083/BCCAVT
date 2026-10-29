import { PlatformError } from './errors';
import { cacheKey, FRESHNESS_TTL_MS } from './cache/types';
import type { Cache, Freshness, LoadOptions } from './cache/types';
import { subjectKey } from './model';
import type { Comment, Cursor, Page, Session, Subject, SubjectRef, ThreadPage } from './model';
import type { FetchContext, HttpClient, PlatformAdapter, Politeness } from './platform';
import type { CrawlOptions, CrawlPhase, CrawlProgress, FetchStats, RootsPage, Snapshot } from './report';
import { rootOrderOf } from './report';
import { sharedLimiterFor } from './rate-limit';
import type { RequestPriority, SharedLimiter } from './rate-limit';

export type SleepFn = (ms: number, signal: AbortSignal) => Promise<void>;

export function abortError(): PlatformError {
  return new PlatformError('aborted', '请求已取消');
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

/** 默认 sleep：可被 abort 打断，用于退避与礼貌间隔。 */
export const defaultSleep: SleepFn = (ms, signal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

/**
 * 每平台一个的请求队列：并发上限 + 相邻请求最小间隔。
 * 名额「先占后用」：通过闸门后立即计入并发，再去做最小间隔等待，避免等待期间被其他请求读到旧值而超发。
 * 名额「转让」：释放时若有人排队，直接把名额交给下一个排队者（active 不回落），排队者被取消则不再持有名额。
 * 间隔用「预留时隙」而不是读表，sleep 被提前唤醒也不会连发。
 */
export class PoliteQueue {
  private active = 0;
  private readonly waiters: Array<{ resolve: () => void }> = [];

  constructor(private readonly politeness: Politeness) {}

  async run<T>(fn: () => Promise<T>, signal: AbortSignal): Promise<T> {
    await this.acquire(signal);
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /** 释放名额：有人排队就转让给队首（恰好一个），否则并发数回落。 */
  private release(): void {
    const next = this.waiters.shift();
    if (next === undefined) this.active--;
    else next.resolve();
  }

  private async acquire(signal: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    await this.waitForTurn(signal);
    try {
      // 名额已到手；若此时被取消，必须把名额让出去而不是丢弃。
      throwIfAborted(signal);
    } catch (error) {
      this.release();
      throw error;
    }
  }

  /**
   * 拿到一个并发名额：有空位直接占（同步自增，不经过 await），否则排队。
   * 被取消时立即从队列摘除并以 aborted 拒绝；已被转让名额后才取消的，由 acquire 的 try 让出名额。
   */
  private waitForTurn(signal: AbortSignal): Promise<void> {
    if (this.active < this.politeness.concurrency) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(abortError());
        return;
      }
      const waiter = { resolve: (): void => {} };
      const onAbort = (): void => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(abortError());
      };
      waiter.resolve = (): void => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }
}

export interface RetryOptions {
  baseMs?: number;
  maxMs?: number;
  maxRetries?: number;
  random?: () => number;
}

export interface RetryContext {
  signal: AbortSignal;
  sleep: SleepFn;
  onRetry?: (waitMs: number, error: PlatformError) => void;
}

/** 只重试「可重试」的 PlatformError；指数退避 + 抖动，平台给了 retryAfterMs 就以它为准。 */
export async function withRetry<T>(fn: () => Promise<T>, ctx: RetryContext, options: RetryOptions = {}): Promise<T> {
  const base = options.baseMs ?? 1000;
  const max = options.maxMs ?? 30_000;
  const maxRetries = options.maxRetries ?? 5;
  const random = options.random ?? Math.random;
  let attempt = 0;
  for (;;) {
    throwIfAborted(ctx.signal);
    try {
      return await fn();
    } catch (error) {
      if (!(error instanceof PlatformError) || !error.retryable || attempt >= maxRetries) throw error;
      const waitMs =
        error.retryAfterMs !== undefined && error.retryAfterMs > 0
          ? error.retryAfterMs
          : Math.round(Math.min(max, base * 2 ** attempt) * (0.5 + random() * 0.5));
      attempt++;
      ctx.onRetry?.(waitMs, error);
      await ctx.sleep(waitMs, ctx.signal);
    }
  }
}

export interface CrawlRunnerDeps {
  adapter: PlatformAdapter;
  cache: Cache;
  http: HttpClient;
  signal: AbortSignal;
  sleep: SleepFn;
  now: () => number;
  stats: FetchStats;
  onProgress: (progress: CrawlProgress) => void;
  /** 平台级共享队列；缺省时本 runner 自建一个。 */
  queue?: PoliteQueue;
  retry?: RetryOptions;
  /** 跨文档共享令牌桶；缺省按 adapter.politeness.rate 取平台注册表实例。 */
  limiter?: SharedLimiter | null;
  /** 本次取数的优先级：analyze* 批量走 'bulk'，预览/定位/会话走 'interactive'。 */
  priority?: RequestPriority;
}

/**
 * 一次抓取的执行上下文：把礼貌、重试、计数、进度收在一处，crawl 函数只管业务。
 * 所有回源都经 request()，所有带缓存的数据都经 load()。
 */
export class CrawlRunner {
  private readonly queue: PoliteQueue;
  private phase: CrawlPhase = 'session';
  private fetched = 0;
  private declared: number | undefined;
  private threadsDone: number | undefined;
  private threadsTotal: number | undefined;
  private waitingMs: number | undefined;
  private readonly limiter: SharedLimiter | undefined;

  constructor(readonly deps: CrawlRunnerDeps) {
    this.queue = deps.queue ?? new PoliteQueue(deps.adapter.politeness);
    this.limiter = deps.limiter === null ? undefined : (deps.limiter ?? sharedLimiterFor(deps.adapter.id, deps.adapter.politeness.rate));
  }

  get adapter(): PlatformAdapter {
    return this.deps.adapter;
  }

  get cache(): Cache {
    return this.deps.cache;
  }

  get signal(): AbortSignal {
    return this.deps.signal;
  }

  get stats(): FetchStats {
    return this.deps.stats;
  }

  setPhase(phase: CrawlPhase, extra: { fetched?: number; declared?: number; threadsDone?: number; threadsTotal?: number } = {}): void {
    this.phase = phase;
    if (extra.fetched !== undefined) this.fetched = extra.fetched;
    if (extra.declared !== undefined) this.declared = extra.declared;
    if (phase !== 'threads') {
      this.threadsDone = undefined;
      this.threadsTotal = undefined;
    }
    if (extra.threadsDone !== undefined) this.threadsDone = extra.threadsDone;
    if (extra.threadsTotal !== undefined) this.threadsTotal = extra.threadsTotal;
    this.report();
  }

  report(): void {
    const progress: CrawlProgress = {
      phase: this.phase,
      fetched: this.fetched,
      requests: this.deps.stats.requests,
      cacheHits: this.deps.stats.cacheHits,
    };
    if (this.declared !== undefined) progress.declared = this.declared;
    if (this.threadsTotal !== undefined) {
      progress.threadsTotal = this.threadsTotal;
      progress.threadsDone = this.threadsDone ?? 0;
    }
    if (this.waitingMs !== undefined) progress.waitingMs = this.waitingMs;
    this.deps.onProgress(progress);
  }

  /** 礼貌排队 + 重试 + 计数的一次回源；信号贯穿到适配器。 */
  async request<T>(fn: (ctx: FetchContext) => Promise<T>): Promise<T> {
    const stats = this.deps.stats;
    try {
      return await this.queue.run(
        () =>
          withRetry(
            async () => {
              if (this.limiter !== undefined) {
                await this.limiter.acquire(this.deps.priority ?? 'interactive', this.deps.signal, (waitMs) => {
                  this.waitingMs = waitMs;
                  this.report();
                });
              }
              stats.requests++;
              try {
                const result = await fn({
                  http: this.deps.http,
                  cache: this.deps.cache,
                  signal: this.deps.signal,
                  identity: this.deps.http.identity ?? 'direct',
                });
                void this.limiter?.noteSuccess();
                return result;
              } catch (error) {
                if (error instanceof PlatformError && error.kind === 'rate-limited') {
                  await this.limiter?.noteRateLimited(error.retryAfterMs);
                }
                throw error;
              }
            },
            {
              signal: this.deps.signal,
              sleep: this.deps.sleep,
              onRetry: (waitMs) => {
                stats.retries++;
                this.waitingMs = waitMs;
                this.report();
              },
            },
            this.deps.retry,
          ),
        this.deps.signal,
      );
    } finally {
      if (this.waitingMs !== undefined) {
        this.waitingMs = undefined;
        this.report();
      }
    }
  }

  /** 带缓存的回源；命中即计入 cacheHits。 */
  async load<T>(key: string, freshness: Freshness, loader: (ctx: FetchContext) => Promise<T>, options?: LoadOptions): Promise<T> {
    const result = await this.cache.getOrLoad<T>(key, freshness, () => this.request(loader), options);
    if (result.source !== 'network') this.deps.stats.cacheHits++;
    return result.value;
  }
}

export interface SubjectCrawl {
  subject: Subject;
  /** 已按 maxRoots 截断、且只含保留根评论及其回复。 */
  comments: Comment[];
  roots: Comment[];
  declared?: number;
  truncated: boolean;
  reasons: string[];
}

/**
 * 抓取一个主体的评论区：
 * 顶层分页（可续）→ 只对「平台声明回复数 > 已知回复数」的根评论抓评论树 → 按 id 去重。
 * refresh 为 incremental 时，replyCount 未变且上一份快照已抓全（或已达单树上限）的评论树直接复用。
 */
export async function crawlSubject(
  runner: CrawlRunner,
  ref: SubjectRef,
  session: Session,
  options: CrawlOptions,
  previous: Snapshot | null,
): Promise<SubjectCrawl> {
  const adapter = runner.adapter;
  runner.setPhase('subject');
  const subject = await runner.load(cacheKey('meta', subjectKey(ref)), 'meta', (ctx) => adapter.getSubject(ref, ctx), {
    force: options.refresh === 'full',
  });

  runner.setPhase('roots');
  // 增量 / 全量都要重新遍历顶层分页，只有回放（cache-first）才吃分页缓存。
  const usePageCache = options.refresh === 'cache-first';
  // 页面缓存必须按账号隔离：不同身份可见的评论集合不同，混用会把匿名截断结果喂给已登录用户。
  const account = session.loggedIn ? `u:${session.user?.id ?? 'unknown'}` : 'anon';
  const order = rootOrderOf(options);
  // 可恢复抓取：全量/增量起跑即写「crawl-run」检查点（本轮起跑时刻），成功才删除。
  // 上一轮的检查点若仍在页 TTL 内，本轮 freshAfter 复用它的起跑时刻——中断轮已抓的页
  // 直接命中，更老的页按未命中重取；没有可用检查点时退化为普通 force 回源。
  let freshAfter: number | undefined;
  const runKey = cacheKey('pointer', 'crawl-run', subjectKey(ref), account, order);
  if (!usePageCache) {
    const prior = await runner.cache.get<{ startedAt: number }>(runKey);
    freshAfter = prior !== undefined && prior.storedAt >= runner.deps.now() - FRESHNESS_TTL_MS.page! ? prior.value.startedAt : undefined;
    // 续跑沿用上一轮的起跑时刻：再次中断时，前几轮抓到的页仍算本轮的
    await runner.cache.set(runKey, { startedAt: freshAfter ?? runner.deps.now() }, 'pointer');
  }
  // 没有可复用的检查点 = 普通全量/增量：仍按 force 回源（freshAfter 只服务续跑语义）。
  const pageOptions: LoadOptions = usePageCache ? {} : freshAfter !== undefined ? { freshAfter } : { force: true };
  const roots: Comment[] = [];
  const rootIds = new Set<string>();
  const listed: Comment[] = [];
  let cursor: Cursor | null = null;
  let rootsTruncated = false;
  for (;;) {
    throwIfAborted(runner.signal);
    const page: Page<Comment> = await runner.load<Page<Comment>>(
      cacheKey('page', subjectKey(ref), account, 'roots', order, cursor ?? 'start'),
      'page',
      (ctx) => adapter.listRoots(subject, cursor, order, ctx),
      pageOptions,
    );
    for (const item of page.items) {
      listed.push(item);
      if (item.rootId === null && !rootIds.has(item.id)) {
        rootIds.add(item.id);
        roots.push(item);
      }
    }
    runner.setPhase('roots', { fetched: roots.length, declared: subject.declaredCommentCount });
    cursor = page.next;
    if (cursor === null) break;
    if (options.maxRoots > 0 && roots.length >= options.maxRoots) {
      rootsTruncated = true;
      break;
    }
  }
  if (options.maxRoots > 0 && roots.length > options.maxRoots) {
    roots.length = options.maxRoots;
    rootsTruncated = true;
  }

  const comments = new Map<string, Comment>();
  for (const root of roots) comments.set(root.id, root);
  // 顶层分页可能夹带楼中楼预览，先收下再去重；真实回复稍后覆盖它。
  for (const item of listed) {
    if (item.rootId !== null) comments.set(item.id, item);
  }

  if (previous !== null && options.refresh === 'incremental') {
    const previousReplyCount = new Map<string, number>();
    const previousReplies = new Map<string, Comment[]>();
    for (const comment of previous.comments) {
      if (comment.rootId === null) {
        previousReplyCount.set(comment.id, comment.replyCount);
        continue;
      }
      const list = previousReplies.get(comment.rootId);
      if (list === undefined) previousReplies.set(comment.rootId, [comment]);
      else list.push(comment);
    }
    for (const root of roots) {
      if (previousReplyCount.get(root.id) !== root.replyCount) continue;
      const list = previousReplies.get(root.id) ?? [];
      if (list.length >= root.replyCount || (options.maxRepliesPerThread > 0 && list.length >= options.maxRepliesPerThread)) {
        for (const comment of list) comments.set(comment.id, comment);
      }
    }
  }

  const knownByRoot = new Map<string, number>();
  for (const comment of comments.values()) {
    if (comment.rootId === null) continue;
    knownByRoot.set(comment.rootId, (knownByRoot.get(comment.rootId) ?? 0) + 1);
  }
  // 唯一的抓取判据：平台声明的回复数多于已知回复数，且还没到单树上限。
  const pending = roots.filter((root) => {
    const known = knownByRoot.get(root.id) ?? 0;
    return root.replyCount > known && (options.maxRepliesPerThread <= 0 || known < options.maxRepliesPerThread);
  });

  runner.setPhase('threads', {
    fetched: comments.size,
    declared: subject.declaredCommentCount,
    threadsDone: 0,
    threadsTotal: pending.length,
  });
  const concurrency = Math.max(1, adapter.politeness.concurrency);
  let threadsDone = 0;
  let threadsTruncated = false;
  // 有界 worker 池取代按批切片：某个 worker 卡在慢请求上时其余照常推进，没有队头阻塞。
  let nextThread = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    for (;;) {
      throwIfAborted(runner.signal);
      const index = nextThread++;
      if (index >= pending.length) return;
      const root = pending[index]!;
      const result = await crawlThreadPages(runner, subject, root.id, options.maxRepliesPerThread, usePageCache, account, freshAfter);
      for (const comment of result.comments) comments.set(comment.id, comment);
      if (result.truncated) threadsTruncated = true;
      threadsDone++;
      runner.setPhase('threads', {
        fetched: comments.size,
        declared: subject.declaredCommentCount,
        threadsDone,
        threadsTotal: pending.length,
      });
    }
  });
  await Promise.all(workers);

  const kept = new Set(roots.map((root) => root.id));
  const keptComments: Comment[] = [];
  for (const comment of comments.values()) {
    if (comment.rootId === null ? kept.has(comment.id) : kept.has(comment.rootId)) keptComments.push(comment);
  }

  const declared = subject.declaredCommentCount;
  const reasons: string[] = [];
  if (rootsTruncated) reasons.push(`达到顶层评论上限 ${options.maxRoots}，仅抓取前 ${roots.length} 条根评论`);
  if (threadsTruncated) reasons.push(`部分评论树超过单树回复上限 ${options.maxRepliesPerThread}`);
  if (session.limitations.length > 0 && (declared === undefined || keptComments.length < declared)) {
    for (const limitation of session.limitations) {
      if (!reasons.includes(limitation)) reasons.push(limitation);
    }
  }
  if (reasons.length === 0 && declared !== undefined && keptComments.length < declared) {
    reasons.push(`平台声明 ${declared} 条评论，实际抓取 ${keptComments.length} 条`);
  }

  if (!usePageCache) await runner.cache.delete(runKey); // 成功才删检查点：失败/中断留给下轮续跑
  return { subject, comments: keptComments, roots, declared, truncated: reasons.length > 0, reasons };
}

/**
 * 只取一页顶层评论（含该页根评论的楼中楼预览）。
 *
 * 与 crawlSubject 共用同一套机制：同一套页缓存键（含账号隔离）、同一份 freshness、同一个 CrawlRunner
 * （礼貌队列 / 重试 / 进度）。区别只有一个——它走一页游标就返回，不做「从起点到第 N 页」的整链重跑：
 * 于是 cache-first 下翻回已读过的页不会重打平台，调用方也能把结果追加进视图而不是整体替换。
 * 楼中楼的抓取判据与首屏完全一致：平台声明的回复数多于已知回复数、且未达单树上限的根评论才去抓评论树。
 */
export async function crawlRootsPage(
  runner: CrawlRunner,
  ref: SubjectRef,
  session: Session,
  cursor: Cursor | null,
  options: CrawlOptions,
): Promise<RootsPage> {
  const adapter = runner.adapter;
  runner.setPhase('subject');
  const subject = await runner.load(cacheKey('meta', subjectKey(ref)), 'meta', (ctx) => adapter.getSubject(ref, ctx), {
    force: options.refresh === 'full',
  });

  // 页面缓存必须按账号隔离：不同身份可见的评论集合不同，混用会把匿名截断结果喂给已登录用户。
  const account = session.loggedIn ? `u:${session.user?.id ?? 'unknown'}` : 'anon';
  const order = rootOrderOf(options);
  const usePageCache = options.refresh === 'cache-first';
  const page = await runner.load<Page<Comment>>(
    cacheKey('page', subjectKey(ref), account, 'roots', order, cursor ?? 'start'),
    'page',
    (ctx) => adapter.listRoots(subject, cursor, order, ctx),
    { force: !usePageCache },
  );

  const roots: Comment[] = [];
  const previews: Comment[] = [];
  const seen = new Set<string>();
  for (const item of page.items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    if (item.rootId === null) roots.push(item);
    else previews.push(item);
  }
  runner.setPhase('roots', { fetched: roots.length, declared: subject.declaredCommentCount });

  // 顶层分页自带的楼中楼预览先收下；真实回复抓回来后再覆盖它们。
  const comments = new Map<string, Comment>();
  for (const root of roots) comments.set(root.id, root);
  for (const preview of previews) comments.set(preview.id, preview);

  const knownByRoot = new Map<string, number>();
  for (const preview of previews) {
    const rootId = preview.rootId;
    if (rootId === null) continue;
    knownByRoot.set(rootId, (knownByRoot.get(rootId) ?? 0) + 1);
  }
  const pending = roots.filter((root) => {
    const known = knownByRoot.get(root.id) ?? 0;
    return root.replyCount > known && (options.maxRepliesPerThread <= 0 || known < options.maxRepliesPerThread);
  });

  runner.setPhase('threads', {
    fetched: comments.size,
    declared: subject.declaredCommentCount,
    threadsDone: 0,
    threadsTotal: pending.length,
  });
  const concurrency = Math.max(1, adapter.politeness.concurrency);
  let threadsDone = 0;
  let nextThread = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    for (;;) {
      throwIfAborted(runner.signal);
      const index = nextThread++;
      if (index >= pending.length) return;
      const root = pending[index]!;
      const result = await crawlThreadPages(runner, subject, root.id, options.maxRepliesPerThread, usePageCache, account);
      for (const comment of result.comments) comments.set(comment.id, comment);
      threadsDone++;
      runner.setPhase('threads', {
        fetched: comments.size,
        declared: subject.declaredCommentCount,
        threadsDone,
        threadsTotal: pending.length,
      });
    }
  });
  await Promise.all(workers);

  return {
    subject,
    comments: [...comments.values()],
    roots,
    next: page.next,
    declared: subject.declaredCommentCount,
    // 身份限制随页带回：未登录时平台会把顶层评论截断成几条并直接说「到底」，
    // 调用方（阅读器）只有拿到这句话，才能把「不完整 4 / 1330」解释成「为什么只有 4 条」。
    limitations: [...session.limitations],
  };
}

export interface ThreadCrawl {
  root?: Comment;
  comments: Comment[];
  /** 因单树上限提前停止。 */
  truncated: boolean;
}

/** 一棵评论树的全部分页（首页带真实根评论）。account 参与页面缓存键，保证跨账号隔离。 */
export async function crawlThreadPages(
  runner: CrawlRunner,
  subject: Subject,
  commentId: string,
  maxReplies: number,
  usePageCache: boolean,
  account: string,
  freshAfter?: number,
): Promise<ThreadCrawl> {
  const comments: Comment[] = [];
  let root: Comment | undefined;
  let cursor: Cursor | null = null;
  let truncated = false;
  for (;;) {
    throwIfAborted(runner.signal);
    const page: ThreadPage = await runner.load<ThreadPage>(
      cacheKey('page', subjectKey(subject.ref), account, 'thread', commentId, cursor ?? 'start'),
      'page',
      (ctx) => runner.adapter.listThread(subject, commentId, cursor, ctx),
      usePageCache ? {} : freshAfter !== undefined ? { freshAfter } : { force: true },
    );
    if (cursor === null && page.root !== undefined) root = page.root;
    for (const comment of page.items) comments.push(comment);
    cursor = page.next;
    if (cursor === null) break;
    if (maxReplies > 0 && comments.length >= maxReplies) {
      truncated = true;
      break;
    }
  }
  return {
    root,
    comments: maxReplies > 0 ? comments.slice(0, maxReplies) : comments,
    truncated: truncated || (maxReplies > 0 && comments.length > maxReplies),
  };
}
