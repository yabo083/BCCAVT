import { analyzeSubject as buildSubjectReport, analyzeThread as buildThreadReport } from './analysis';
import { cacheKey } from './cache/types';
import type { Cache, CacheStats } from './cache/types';
import { CrawlRunner, PoliteQueue, crawlRootsPage, crawlSubject, crawlThreadPages, defaultSleep, type SleepFn } from './crawl';
import { PlatformError } from './errors';
import { subjectKey, targetKey } from './model';
import type { Comment, Cursor, PlatformId, Session, SubjectRef, Target } from './model';
import type { HttpClient, PlatformAdapter, SeekResult } from './platform';
import { SNAPSHOT_SCHEMA } from './report';
import type {
  AnalysisResult,
  CrawlOptions,
  CrawlProgress,
  Forest,
  LocatedComment,
  RootsPage,
  Snapshot,
  SnapshotSummary,
  SubjectReport,
  ThreadReport,
  Workbench,
} from './report';
import { buildForest } from './tree';

export interface WorkbenchDeps {
  adapters: readonly PlatformAdapter[];
  cache: Cache;
  http: HttpClient;
  now?: () => number;
  sleep?: SleepFn;
}

/** 存储是不可信边界：读回来的快照必须自证结构完整。 */
function isSnapshot(value: unknown): value is Snapshot {
  if (typeof value !== 'object' || value === null) return false;
  const snapshot = value as Partial<Snapshot>;
  return (
    snapshot.schema === SNAPSHOT_SCHEMA &&
    typeof snapshot.id === 'string' &&
    typeof snapshot.fetchedAt === 'number' &&
    Array.isArray(snapshot.comments) &&
    typeof snapshot.target === 'object' &&
    snapshot.target !== null &&
    snapshot.subject !== undefined &&
    typeof snapshot.caps === 'object' &&
    snapshot.caps !== null
  );
}

/** 公开入口的上限校验：只接受 >= 0 的整数（0 = 不限），负值 / 非整数一律拒绝。 */
function validateCrawlOptions(options: CrawlOptions): void {
  for (const [name, value] of [
    ['maxRoots', options.maxRoots],
    ['maxRepliesPerThread', options.maxRepliesPerThread],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) {
      throw new PlatformError('invalid-input', `${name} 必须是不小于 0 的整数（0 = 不限），收到 ${String(value)}`);
    }
  }
  if (options.refresh !== 'cache-first' && options.refresh !== 'incremental' && options.refresh !== 'full') {
    throw new PlatformError('invalid-input', `未知的刷新方式：${String(options.refresh)}`);
  }
  if (options.order !== undefined && options.order !== 'time' && options.order !== 'hot') {
    throw new PlatformError('invalid-input', `未知的顶层排序：${String(options.order)}`);
  }
}

/** 从整棵评论树里取出「选中评论 + 其后代」；找不到选中评论返回 null。provenance 原样保留。 */
function scopeThread(comments: Comment[], focusId: string): { focus: Comment; comments: Comment[] } | null {
  const forest = buildForest(comments);
  const focus = forest.byId.get(focusId);
  if (focus === undefined) return null;
  const selected: Comment[] = [];
  const stack = [focus];
  while (stack.length > 0) {
    const node = stack.pop()!;
    selected.push(node.comment);
    for (const child of node.children) stack.push(child);
  }
  return { focus: focus.comment, comments: selected };
}

export function createWorkbench(deps: WorkbenchDeps): Workbench {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const { adapters, cache, http } = deps;
  /**
   * 本工作台的身份姿态（'direct' / 'page'……），**每次用到时现取**而不是构造时定死：
   * readerHttp 的身份是个活的 getter（桥挂掉会从 'page' 翻成 'direct'），session 与登录态
   * nav 这类「与身份绑定的数据」必须按当下身份建键——同一份物理缓存下两种姿态各读各的
   * session，桥倒了之后也不能继续吃桥活着时写下的那份。
   */
  const identityNow = (): string => http.identity ?? 'direct';

  function adapterFor(platform: PlatformId): PlatformAdapter {
    const adapter = adapters.find((candidate) => candidate.id === platform);
    if (adapter === undefined) throw new PlatformError('invalid-input', `未接入的平台：${platform}`);
    return adapter;
  }

  /** 平台级请求队列：同一平台上的并发抓取共享并发上限与最小间隔。 */
  const queues = new Map<PlatformId, PoliteQueue>();

  function queueFor(adapter: PlatformAdapter): PoliteQueue {
    const existing = queues.get(adapter.id);
    if (existing !== undefined) return existing;
    const created = new PoliteQueue(adapter.politeness, sleep, now);
    queues.set(adapter.id, created);
    return created;
  }

  function makeRunner(adapter: PlatformAdapter, signal: AbortSignal, onProgress: (progress: CrawlProgress) => void): CrawlRunner {
    return new CrawlRunner({
      adapter,
      cache,
      http,
      signal,
      sleep,
      now,
      onProgress,
      queue: queueFor(adapter),
      stats: { requests: 0, cacheHits: 0, retries: 0, durationMs: 0 },
    });
  }

  async function loadSession(runner: CrawlRunner): Promise<Session> {
    runner.setPhase('session');
    return runner.load(cacheKey('session', runner.adapter.id, identityNow()), 'session', (ctx) => runner.adapter.getSession(ctx));
  }

  async function readLatest(target: Target): Promise<Snapshot | null> {
    const pointer = await cache.get<unknown>(cacheKey('pointer', 'latest', targetKey(target)));
    if (pointer === undefined || typeof pointer.value !== 'string') return null;
    const stored = await cache.get<unknown>(cacheKey('snapshot', pointer.value));
    return stored !== undefined && isSnapshot(stored.value) ? stored.value : null;
  }

  /**
   * cache-first 复用闸门：未截断总可复用；已截断时要求旧快照的上限不低于本次请求
   * （旧快照某维度为 0 = 不限，则该维度视为已取尽，任何请求都满足；本次为 0 = 不限而旧快照有限则不能满足），
   * 且登录态不弱于当前已知登录态——匿名快照可能被「未登录」截断，当前已登录时不得复用。
   */
  async function canReuseSnapshot(snapshot: Snapshot, options: CrawlOptions): Promise<boolean> {
    if (!snapshot.completeness.truncated) return true;
    const caps = snapshot.caps;
    const rootOk = caps.maxRoots === 0 || (options.maxRoots > 0 && options.maxRoots <= caps.maxRoots);
    const replyOk =
      caps.maxRepliesPerThread === 0 ||
      (options.maxRepliesPerThread > 0 && options.maxRepliesPerThread <= caps.maxRepliesPerThread);
    if (!rootOk || !replyOk) return false;
    if (snapshot.auth === 'anonymous') {
      const stored = await cache.get<Session>(cacheKey('session', snapshot.target.subject.platform, identityNow()));
      if (stored !== undefined && stored.value.loggedIn) return false;
    }
    return true;
  }

  async function persistSnapshot(adapter: PlatformAdapter, snapshot: Snapshot): Promise<void> {
    await cache.set(cacheKey('snapshot', snapshot.id), snapshot, 'immutable');
    await cache.set(cacheKey('pointer', 'latest', targetKey(snapshot.target)), snapshot.id, 'pointer');

    const historyKey = cacheKey('pointer', 'history', adapter.id);
    const stored = await cache.get<unknown>(historyKey);
    const history = Array.isArray(stored?.value) ? (stored.value as SnapshotSummary[]) : [];
    const summary: SnapshotSummary = {
      id: snapshot.id,
      target: snapshot.target,
      title: snapshot.subject.title,
      coverUrl: snapshot.subject.coverUrl,
      fetchedAt: snapshot.fetchedAt,
      commentCount: snapshot.comments.length,
      truncated: snapshot.completeness.truncated,
    };
    await cache.set(historyKey, [summary, ...history.filter((item) => item.id !== snapshot.id)].slice(0, 50), 'pointer');
  }

  function finish<R>(runner: CrawlRunner, snapshot: Snapshot, forest: Forest, report: R, fromSnapshot: boolean): AnalysisResult<R> {
    runner.setPhase('done', { fetched: snapshot.comments.length, declared: snapshot.completeness.declared });
    return { snapshot, forest, report, fromSnapshot };
  }

  /**
   * 主体抓取的唯一实现。persist 为 false 时只算不存：页面替换的首屏预览天然是截断的，
   * 一旦写成 latest 快照，整页模式的 cache-first 复用与历史列表都会被它污染。
   */
  async function runSubject(
    ref: SubjectRef,
    options: CrawlOptions,
    onProgress: (progress: CrawlProgress) => void,
    signal: AbortSignal,
    persist: boolean,
  ): Promise<AnalysisResult<SubjectReport>> {
    validateCrawlOptions(options);
    const adapter = adapterFor(ref.platform);
    const target: Target = { kind: 'subject', subject: ref };
    const runner = makeRunner(adapter, signal, onProgress);

    if (options.refresh === 'cache-first') {
      const existing = await readLatest(target);
      if (existing !== null && (await canReuseSnapshot(existing, options))) {
        runner.setPhase('analyze', { fetched: existing.comments.length, declared: existing.completeness.declared });
        const forest = buildForest(existing.comments);
        return finish(runner, existing, forest, buildSubjectReport(existing, forest), true);
      }
    }

    const startedAt = now();
    const session = await loadSession(runner);
    const previous = options.refresh === 'incremental' ? await readLatest(target) : null;
    const crawled = await crawlSubject(runner, ref, session, options, previous);
    runner.stats.durationMs = now() - startedAt;

    const fetchedAt = now();
    const snapshot: Snapshot = {
      schema: SNAPSHOT_SCHEMA,
      id: `${targetKey(target)}@${fetchedAt}`,
      target,
      subject: crawled.subject,
      comments: crawled.comments,
      fetchedAt,
      auth: session.loggedIn ? 'user' : 'anonymous',
      completeness: {
        declared: crawled.declared,
        fetched: crawled.comments.length,
        truncated: crawled.truncated,
        reasons: crawled.reasons,
      },
      caps: { maxRoots: options.maxRoots, maxRepliesPerThread: options.maxRepliesPerThread },
      fetchStats: runner.stats,
    };
    if (persist) await persistSnapshot(adapter, snapshot);
    const forest = buildForest(snapshot.comments);
    runner.setPhase('analyze', { fetched: snapshot.comments.length, declared: snapshot.completeness.declared });
    return finish(runner, snapshot, forest, buildSubjectReport(snapshot, forest), false);
  }

  /** 评论树抓取的唯一实现；persist 的含义同 runSubject。 */
  async function runThread(
    ref: SubjectRef,
    commentId: string,
    options: CrawlOptions,
    onProgress: (progress: CrawlProgress) => void,
    signal: AbortSignal,
    persist: boolean,
  ): Promise<AnalysisResult<ThreadReport>> {
    validateCrawlOptions(options);
    const adapter = adapterFor(ref.platform);
    const target: Target = { kind: 'thread', subject: ref, commentId };
    const runner = makeRunner(adapter, signal, onProgress);

    if (options.refresh === 'cache-first') {
      const existing = await readLatest(target);
      if (existing !== null && (await canReuseSnapshot(existing, options))) {
        runner.setPhase('analyze', { fetched: existing.comments.length, declared: existing.completeness.declared });
        const forest = buildForest(existing.comments);
        return finish(runner, existing, forest, buildThreadReport(existing, forest, commentId), true);
      }
      // 只有 cache-first 才允许用主体快照派生；full / incremental 一律回源，避免复用陈旧的主体快照。
      const subjectSnapshot = await readLatest({ kind: 'subject', subject: ref });
      if (subjectSnapshot !== null) {
        const derived = deriveThreadSnapshot(subjectSnapshot, target, commentId, options, now());
        if (derived !== null) {
          runner.setPhase('analyze', { fetched: derived.comments.length, declared: derived.completeness.declared });
          const forest = buildForest(derived.comments);
          return finish(runner, derived, forest, buildThreadReport(derived, forest, commentId), true);
        }
      }
    }

    const startedAt = now();
    const session = await loadSession(runner);
    const account = session.loggedIn ? `u:${session.user?.id ?? 'unknown'}` : 'anon';
    runner.setPhase('subject', {});
    const subject = await runner.load(cacheKey('meta', subjectKey(ref)), 'meta', (ctx) => adapter.getSubject(ref, ctx), {
      force: options.refresh === 'full',
    });
    runner.setPhase('threads', { threadsTotal: 1, threadsDone: 0 });
    const crawled = await crawlThreadPages(
      runner,
      subject,
      commentId,
      options.maxRepliesPerThread,
      options.refresh === 'cache-first',
      account,
    );
    runner.stats.durationMs = now() - startedAt;

    // 适配器为了拓扑可能抓了整棵包含它的根评论树；这里只保留「被选中的评论 + 它的后代」。
    const containingRoot = crawled.root;
    if (containingRoot === undefined) throw new PlatformError('protocol', `评论树 ${commentId} 的首页没有返回根评论`);
    const scoped = scopeThread([containingRoot, ...crawled.comments], commentId);
    if (scoped === null) throw new PlatformError('not-found', `评论 ${commentId} 不存在或已被删除`);
    const { focus, comments } = scoped;

    const fetchedReplies = crawled.comments.length;
    const sourceComplete = !crawled.truncated && fetchedReplies >= containingRoot.replyCount;
    const reasons: string[] = [];
    if (crawled.truncated) reasons.push(`达到单树回复上限 ${options.maxRepliesPerThread}`);
    else if (!sourceComplete) reasons.push(`平台声明 ${containingRoot.replyCount} 条回复，实际抓取 ${fetchedReplies} 条`);
    if (reasons.length > 0) {
      for (const limitation of session.limitations) {
        if (!reasons.includes(limitation)) reasons.push(limitation);
      }
    }

    const fetchedAt = now();
    const snapshot: Snapshot = {
      schema: SNAPSHOT_SCHEMA,
      id: `${targetKey(target)}@${fetchedAt}`,
      target,
      subject,
      rootId: focus.id,
      comments,
      fetchedAt,
      auth: session.loggedIn ? 'user' : 'anonymous',
      completeness: {
        // 只有被选中的评论本身是顶层评论时，平台的 replyCount 才代表它的后代总数；楼中楼恒为 0 表示「未知」。
        declared: focus.rootId === null ? focus.replyCount + 1 : undefined,
        fetched: comments.length,
        truncated: reasons.length > 0,
        reasons,
      },
      caps: { maxRoots: options.maxRoots, maxRepliesPerThread: options.maxRepliesPerThread },
      fetchStats: runner.stats,
    };
    if (persist) await persistSnapshot(adapter, snapshot);
    const forest = buildForest(snapshot.comments);
    runner.setPhase('analyze', { fetched: snapshot.comments.length, declared: snapshot.completeness.declared });
    return finish(runner, snapshot, forest, buildThreadReport(snapshot, forest, commentId), false);
  }

  /**
   * 页面替换阅读器的一页入口：只取一页顶层评论（含该页根评论的楼中楼预览），不落快照。
   * 与 runSubject 的区别是没有「快照复用」那一段——游标本就来自调用方，每次都按它取一页；
   * 上限校验、平台解析、账号隔离与礼貌队列全部沿用同一条路径。
   */
  async function runRootsPage(
    ref: SubjectRef,
    cursor: Cursor | null,
    options: CrawlOptions,
    onProgress: (progress: CrawlProgress) => void,
    signal: AbortSignal,
  ): Promise<RootsPage> {
    validateCrawlOptions(options);
    const adapter = adapterFor(ref.platform);
    const runner = makeRunner(adapter, signal, onProgress);
    const startedAt = now();
    const session = await loadSession(runner);
    const page = await crawlRootsPage(runner, ref, session, cursor, options);
    runner.stats.durationMs = now() - startedAt;
    runner.setPhase('done', { fetched: page.comments.length, declared: page.declared });
    return page;
  }

  /**
   * 定点定位一条评论的实现，三段序：
   * ①最新主体快照已含它——零请求，直接从快照里取它所在的根评论块；
   * ②否则经适配器的 `seekRoot` 一次取回（走 'seek' 页缓存键，同一 id 再定位不再回源；
   *   刻意不写成 'roots|start'——定位块不是第一页，混键会把假首页喂给分页）；
   * ③适配器没有 seekRoot——按平台能力缺失抛 unavailable。同样只算不存。
   */
  async function runLocate(
    ref: SubjectRef,
    commentId: string,
    onProgress: (progress: CrawlProgress) => void,
    signal: AbortSignal,
  ): Promise<LocatedComment> {
    const adapter = adapterFor(ref.platform);
    const runner = makeRunner(adapter, signal, onProgress);

    const snapshot = await readLatest({ kind: 'subject', subject: ref });
    if (snapshot !== null) {
      const target = snapshot.comments.find((comment) => comment.id === commentId);
      if (target !== undefined) {
        const rootId = target.rootId ?? target.id;
        const root = snapshot.comments.find((comment) => comment.id === rootId);
        if (root !== undefined) {
          runner.setPhase('done', { fetched: snapshot.comments.length });
          return {
            subject: snapshot.subject,
            root,
            comments: [root, ...snapshot.comments.filter((comment) => comment.rootId === root.id)],
            source: 'snapshot',
          };
        }
      }
    }

    if (adapter.seekRoot === undefined) {
      throw new PlatformError('unavailable', `${adapter.name} 不支持按评论定位`, { platform: adapter.id });
    }
    const startedAt = now();
    const session = await loadSession(runner);
    const account = session.loggedIn ? `u:${session.user?.id ?? 'unknown'}` : 'anon';
    runner.setPhase('subject');
    const subject = await runner.load(cacheKey('meta', subjectKey(ref)), 'meta', (ctx) => adapter.getSubject(ref, ctx));
    const requestsBefore = runner.stats.requests;
    const found = await runner.load<SeekResult>(
      cacheKey('page', subjectKey(ref), account, 'seek', commentId),
      'page',
      (ctx) => adapter.seekRoot!(subject, commentId, ctx),
    );
    runner.stats.durationMs = now() - startedAt;
    runner.setPhase('done', { fetched: found.items.length });
    return { subject, root: found.root, comments: found.items, source: runner.stats.requests === requestsBefore ? 'cache' : 'network' };
  }

  return {
    adapters,

    resolve(input) {
      for (const adapter of adapters) {
        const target = adapter.parseTarget(input);
        if (target !== null) return { adapter, target };
      }
      return null;
    },

    async session(platform: PlatformId, signal?: AbortSignal): Promise<Session> {
      const adapter = adapterFor(platform);
      const runner = makeRunner(adapter, signal ?? new AbortController().signal, () => {});
      // 登录态必须即时反映：公开入口每次回源（仍走单飞合并并发），不吃 30 分钟的 session 缓存。
      runner.setPhase('session');
      return runner.load(cacheKey('session', adapter.id, identityNow()), 'session', (ctx) => adapter.getSession(ctx), { force: true });
    },

    /** 整页 / 侧栏入口：结果落快照（历史与 cache-first 复用都依赖它）。 */
    analyzeSubject(ref, options, onProgress, signal) {
      return runSubject(ref, options, onProgress, signal, true);
    },

    analyzeThread(ref, commentId, options, onProgress, signal) {
      return runThread(ref, commentId, options, onProgress, signal, true);
    },

    /** 页面替换阅读器入口：只算不存，绝不写 latest 指针与历史。 */
    previewSubject(ref, options, onProgress, signal) {
      return runSubject(ref, options, onProgress, signal, false);
    },

    /** 页面替换阅读器的逐页入口：按游标取一页，同样只算不存。 */
    previewRootsPage(ref, cursor, options, onProgress, signal) {
      return runRootsPage(ref, cursor, options, onProgress, signal);
    },

    previewThread(ref, commentId, options, onProgress, signal) {
      return runThread(ref, commentId, options, onProgress, signal, false);
    },

    /** 定点定位：快照能答就不发请求，否则一次 seek（结果进 'seek' 页缓存键）。 */
    locateComment(ref, commentId, onProgress, signal) {
      return runLocate(ref, commentId, onProgress, signal);
    },

    async history(): Promise<SnapshotSummary[]> {
      const histories = await Promise.all(
        adapters.map((adapter) => cache.get<unknown>(cacheKey('pointer', 'history', adapter.id))),
      );
      const all: SnapshotSummary[] = [];
      for (const stored of histories) {
        if (Array.isArray(stored?.value)) all.push(...(stored.value as SnapshotSummary[]));
      }
      return all.sort((a, b) => b.fetchedAt - a.fetchedAt);
    },

    async openSnapshot(id: string): Promise<AnalysisResult<SubjectReport> | AnalysisResult<ThreadReport>> {
      const stored = await cache.get<unknown>(cacheKey('snapshot', id));
      if (stored === undefined || !isSnapshot(stored.value)) {
        throw new PlatformError('not-found', `快照不存在或已失效：${id}`);
      }
      const snapshot = stored.value;
      const forest = buildForest(snapshot.comments);
      return snapshot.target.kind === 'subject'
        ? { snapshot, forest, report: buildSubjectReport(snapshot, forest), fromSnapshot: true }
        : { snapshot, forest, report: buildThreadReport(snapshot, forest, snapshot.target.commentId), fromSnapshot: true };
    },

    async deleteSnapshot(id: string): Promise<void> {
      const stored = await cache.get<unknown>(cacheKey('snapshot', id));
      await cache.delete(cacheKey('snapshot', id));
      if (stored === undefined || !isSnapshot(stored.value)) return;
      const snapshot = stored.value;

      const historyKey = cacheKey('pointer', 'history', snapshot.target.subject.platform);
      const historyStored = await cache.get<unknown>(historyKey);
      const history = Array.isArray(historyStored?.value) ? (historyStored.value as SnapshotSummary[]) : [];
      const remaining = history.filter((item) => item.id !== id);
      await cache.set(historyKey, remaining, 'pointer');

      const latestKey = cacheKey('pointer', 'latest', targetKey(snapshot.target));
      const latest = await cache.get<unknown>(latestKey);
      if (latest?.value === id) {
        const key = targetKey(snapshot.target);
        const next = remaining.find((item) => targetKey(item.target) === key);
        if (next === undefined) await cache.delete(latestKey);
        else await cache.set(latestKey, next.id, 'pointer');
      }
    },

    async clearCache(): Promise<void> {
      await cache.deletePrefix('');
    },

    cacheStats(): CacheStats {
      return cache.stats();
    },

    async cacheUsage(): Promise<{ entries: number; bytes: number }> {
      return cache.usage();
    },
  };
}

/**
 * 用主体快照直接派生评论树快照（不发请求）。
 * 前提：快照里能找到被选中的评论，且它所在的根评论树在主体快照里已抓全（数量达标，或已撞到主体快照的单树上限）。
 * 派生结果同样是「选中评论 + 其后代」的子树，rootId 指向被选中的评论。
 */
function deriveThreadSnapshot(
  subjectSnapshot: Snapshot,
  target: Target,
  commentId: string,
  options: CrawlOptions,
  fetchedAt: number,
): Snapshot | null {
  const byId = new Map(subjectSnapshot.comments.map((comment) => [comment.id, comment] as const));
  const focus = byId.get(commentId);
  if (focus === undefined) return null;
  const rootId = focus.rootId ?? focus.id;
  const root = byId.get(rootId);
  if (root === undefined) return null;

  const replies = subjectSnapshot.comments.filter((comment) => comment.rootId === rootId);
  const sourceCap = subjectSnapshot.caps.maxRepliesPerThread;
  const declaredComplete = replies.length >= root.replyCount;
  const capComplete = sourceCap > 0 && replies.length >= sourceCap;
  // 主体快照自己都没抓全该树时，只有在「确实撞到它的单树上限」时才可能拿来派生。
  if (!declaredComplete && !capComplete) return null;
  // 本次请求的上限不能高于主体快照能提供的上限（0 = 不限，更不可能被有上限的旧快照满足）。
  if (!declaredComplete && (options.maxRepliesPerThread === 0 || options.maxRepliesPerThread > sourceCap)) return null;

  const scoped = scopeThread([root, ...replies], commentId);
  if (scoped === null) return null;

  const truncated = !declaredComplete;
  return {
    schema: SNAPSHOT_SCHEMA,
    id: `${targetKey(target)}@${fetchedAt}`,
    target,
    subject: subjectSnapshot.subject,
    rootId: scoped.focus.id,
    comments: scoped.comments,
    fetchedAt,
    auth: subjectSnapshot.auth,
    completeness: {
      declared: scoped.focus.rootId === null ? scoped.focus.replyCount + 1 : undefined,
      fetched: scoped.comments.length,
      truncated,
      reasons: truncated ? [`主体快照中该评论树未抓全（${replies.length}/${root.replyCount}）`] : [],
    },
    caps: { maxRoots: subjectSnapshot.caps.maxRoots, maxRepliesPerThread: sourceCap },
    fetchStats: { requests: 0, cacheHits: 0, retries: 0, durationMs: 0 },
  };
}
