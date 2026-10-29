import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCache } from '@/core/cache/index';
import type { Cache } from '@/core/cache/types';
import type { SleepFn } from '@/core/crawl';
import { PlatformError } from '@/core/errors';
import { createHttpClient } from '@/core/http';
import type { Comment, Cursor } from '@/core/model';
import { DEFAULT_CRAWL_OPTIONS, type CrawlOptions, type CrawlProgress } from '@/core/report';
import { createWorkbench } from '@/core/workbench';
import type { Workbench } from '@/core/report';
import { FakeAdapter, makeComment, pagedRoots, pagedThread, uniqueDbName } from './fakes';

const noop = (): void => {};

/** 只让出微任务（配合内存-only 缓存使用），不依赖真实计时器。 */
async function settleMicrotasks(rounds = 200): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}
const options = (overrides: Partial<CrawlOptions> = {}): CrawlOptions => ({ ...DEFAULT_CRAWL_OPTIONS, refresh: 'full', ...overrides });

/** 每次调用都前进 1s，保证同一目标多次抓取得到不同的快照 id。 */
function tickingNow(): () => number {
  let clock = Date.UTC(2026, 0, 1);
  return () => {
    clock += 1000;
    return clock;
  };
}

function build(adapter: FakeAdapter, extra: { sleep?: SleepFn; cache?: Cache; identity?: string } = {}): { workbench: Workbench; cache: Cache } {
  const cache = extra.cache ?? createCache({ dbName: uniqueDbName(), now: tickingNow() });
  const http = extra.identity === undefined ? createHttpClient() : Object.assign(createHttpClient(), { identity: extra.identity });
  const workbench = createWorkbench({ adapters: [adapter], cache, http, now: tickingNow(), sleep: extra.sleep });
  return { workbench, cache };
}

function recorder(): { phases: CrawlProgress[]; onProgress: (progress: CrawlProgress) => void } {
  const phases: CrawlProgress[] = [];
  return { phases, onProgress: (progress) => phases.push(progress) };
}

describe('主体抓取', () => {
  it('顶层分页遍历到底，进度阶段齐全', async () => {
    const adapter = new FakeAdapter();
    adapter.rootsProvider = pagedRoots([[makeComment({ id: 'r1', createdAt: 3 }), makeComment({ id: 'r2', createdAt: 2 })], [makeComment({ id: 'r3', createdAt: 1 })]]);
    const { workbench } = build(adapter);
    const { phases, onProgress } = recorder();

    const result = await workbench.analyzeSubject(adapter.subject.ref, options(), onProgress, new AbortController().signal);

    expect(adapter.rootCursors).toEqual([null, '1']);
    expect(result.fromSnapshot).toBe(false);
    expect(result.snapshot.comments.map((comment) => comment.id).sort()).toEqual(['r1', 'r2', 'r3']);
    expect(result.snapshot.completeness.truncated).toBe(false);
    expect(result.snapshot.fetchStats.requests).toBe(4);
    expect(result.report.overview.roots).toBe(3);
    expect([...new Set(phases.map((progress) => progress.phase))]).toEqual(['session', 'subject', 'roots', 'threads', 'analyze', 'done']);
    expect(phases.at(-1)?.fetched).toBe(3);
  });

  it('maxRoots 截断：不再翻页并如实记录原因', async () => {
    const adapter = new FakeAdapter();
    adapter.rootsProvider = pagedRoots([[makeComment({ id: 'r1' }), makeComment({ id: 'r2' })], [makeComment({ id: 'r3' })]]);
    const { workbench } = build(adapter);

    const result = await workbench.analyzeSubject(adapter.subject.ref, options({ maxRoots: 2 }), noop, new AbortController().signal);

    expect(adapter.rootCursors).toEqual([null]);
    expect(result.snapshot.comments.map((comment) => comment.id)).toEqual(['r1', 'r2']);
    expect(result.snapshot.completeness.truncated).toBe(true);
    expect(result.snapshot.completeness.reasons[0]).toContain('上限');
  });

  it('未登录且平台声明更多评论时，把 session 限制写进原因', async () => {
    const adapter = new FakeAdapter();
    adapter.session = { platform: 'bilibili', loggedIn: false, limitations: ['未登录：顶层评论仅返回前 3 条'] };
    adapter.subject = { ...adapter.subject, declaredCommentCount: 100 };
    adapter.rootsProvider = pagedRoots([[makeComment({ id: 'r1' })]]);
    const { workbench } = build(adapter);

    const result = await workbench.analyzeSubject(adapter.subject.ref, options(), noop, new AbortController().signal);

    expect(result.snapshot.auth).toBe('anonymous');
    expect(result.snapshot.completeness.reasons).toContain('未登录：顶层评论仅返回前 3 条');
    expect(result.snapshot.completeness.truncated).toBe(true);
  });

  it('只在 replyCount 大于已知回复数时才抓评论树', async () => {
    const adapter = new FakeAdapter();
    const r1 = makeComment({ id: 'r1', replyCount: 5, createdAt: 2 });
    const previews = [1, 2, 3, 4, 5].map((index) => makeComment({ id: `r1-c${index}`, rootId: 'r1', parentId: 'r1' }));
    const r2 = makeComment({ id: 'r2', replyCount: 3, createdAt: 1 });
    const preview2 = makeComment({ id: 'r2-c1', rootId: 'r2', parentId: 'r2' });
    adapter.rootsProvider = pagedRoots([[r1, ...previews, r2, preview2]]);
    const replies = [1, 2, 3].map((index) => makeComment({ id: `r2-c${index}`, rootId: 'r2', parentId: 'r2' }));
    adapter.threadProvider = (commentId, cursor) => pagedThread(r2, replies)(commentId, cursor);
    const { workbench } = build(adapter);

    const result = await workbench.analyzeSubject(adapter.subject.ref, options(), noop, new AbortController().signal);

    expect([...new Set(adapter.threadCalls.map((call) => call.commentId))]).toEqual(['r2']);
    expect(adapter.threadCalls.map((call) => call.cursor)).toEqual([null, '1']); // 5 条回复分 3 页
    expect(result.snapshot.comments).toHaveLength(2 + 5 + 3);
    expect(result.snapshot.completeness.truncated).toBe(false);
  });

  it('限流后重试成功，等待时长上报到进度', async () => {
    const adapter = new FakeAdapter();
    adapter.rootFailures = [new PlatformError('rate-limited', '风控', { code: 412, retryAfterMs: 250 })];
    adapter.rootsProvider = pagedRoots([[makeComment({ id: 'r1' })]]);
    const waits: number[] = [];
    const { workbench } = build(adapter, {
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    const { phases, onProgress } = recorder();

    const result = await workbench.analyzeSubject(adapter.subject.ref, options(), onProgress, new AbortController().signal);

    expect(waits).toEqual([250]);
    expect(adapter.calls.roots).toBe(2);
    expect(result.snapshot.fetchStats.retries).toBe(1);
    expect(phases.some((progress) => progress.waitingMs === 250)).toBe(true);
  });

  it('不可重试的错误立即上抛', async () => {
    const adapter = new FakeAdapter();
    adapter.rootFailures = [new PlatformError('protocol', '响应结构不对')];
    adapter.rootsProvider = pagedRoots([[makeComment({ id: 'r1' })]]);
    const { workbench } = build(adapter, { sleep: async () => {} });

    await expect(workbench.analyzeSubject(adapter.subject.ref, options(), noop, new AbortController().signal)).rejects.toMatchObject({
      kind: 'protocol',
    });
    expect(adapter.calls.roots).toBe(1);
  });

  it('取消以 aborted 传播', async () => {
    const adapter = new FakeAdapter();
    const controller = new AbortController();
    adapter.rootsProvider = (cursor) => {
      if (cursor === null) {
        controller.abort();
        return { items: [makeComment({ id: 'r1' })], next: '1' };
      }
      return { items: [makeComment({ id: 'r2' })], next: null };
    };
    const { workbench } = build(adapter);

    const error: unknown = await workbench.analyzeSubject(adapter.subject.ref, options(), noop, controller.signal).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(PlatformError);
    expect((error as PlatformError).kind).toBe('aborted');
  });
});

describe('增量刷新', () => {
  function fixture(): { adapter: FakeAdapter; r1: Comment; r2: Comment; r3: Comment; replies: Map<string, Comment[]> } {
    const adapter = new FakeAdapter();
    const r1 = makeComment({ id: 'r1', replyCount: 2, createdAt: 3 });
    const r2 = makeComment({ id: 'r2', replyCount: 1, createdAt: 2 });
    const r3 = makeComment({ id: 'r3', replyCount: 0, createdAt: 1 });
    const replies = new Map<string, Comment[]>([
      ['r1', [makeComment({ id: 'r1-c1', rootId: 'r1', parentId: 'r1' }), makeComment({ id: 'r1-c2', rootId: 'r1', parentId: 'r1-c1' })]],
      ['r2', [makeComment({ id: 'r2-c1', rootId: 'r2', parentId: 'r2' })]],
    ]);
    adapter.rootsProvider = pagedRoots([[r1, r2, r3]]);
    adapter.threadProvider = (commentId, cursor) => pagedThread(commentId === 'r1' ? r1 : r2, replies.get(commentId) ?? [])(commentId, cursor);
    return { adapter, r1, r2, r3, replies };
  }

  it('只重抓 replyCount 变化的评论树', async () => {
    const { adapter, r1, r3, replies } = fixture();
    const { workbench } = build(adapter);
    const signal = new AbortController().signal;

    const first = await workbench.analyzeSubject(adapter.subject.ref, options(), noop, signal);
    expect(adapter.threadCalls.map((call) => call.commentId).sort()).toEqual(['r1', 'r2']);
    expect(first.snapshot.comments).toHaveLength(6);

    adapter.resetCalls();
    const r2v2 = makeComment({ id: 'r2', replyCount: 2, createdAt: 2 });
    adapter.rootsProvider = pagedRoots([[r1, r2v2, r3]]);
    replies.set('r2', [makeComment({ id: 'r2-c1', rootId: 'r2', parentId: 'r2' }), makeComment({ id: 'r2-c2', rootId: 'r2', parentId: 'r2' })]);

    const second = await workbench.analyzeSubject(adapter.subject.ref, options({ refresh: 'incremental' }), noop, signal);

    // 新语义（友好抓取）：增量直接吃 TTL 有效页——根页命中 → 0 回源，看到的就是缓存里的旧数据
    expect(adapter.calls.roots).toBe(0);
    expect(adapter.threadCalls).toHaveLength(0);
    expect(second.snapshot.comments.map((comment) => comment.id).sort()).toEqual(first.snapshot.comments.map((comment) => comment.id).sort());

    // 对照：全量仍强制回源，才能发现 replyCount 变化并按需补抓 r2 的新回复
    adapter.resetCalls();
    const third = await workbench.analyzeSubject(adapter.subject.ref, options({ refresh: 'full' }), noop, signal);
    expect(adapter.calls.roots).toBe(1);
    expect(adapter.threadCalls.map((call) => call.commentId).sort()).toEqual(['r1', 'r2']); // 全量强回源：r1/r2 两棵树都重抓
    expect(third.snapshot.comments.map((comment) => comment.id).sort()).toEqual(['r1', 'r1-c1', 'r1-c2', 'r2', 'r2-c1', 'r2-c2', 'r3']);
  });
});

describe('评论树分析', () => {
  const r1 = makeComment({ id: 'r1', replyCount: 5, createdAt: 1 });
  const tree: Comment[] = [1, 2, 3, 4, 5].map((index) => makeComment({ id: `c${index}`, rootId: 'r1', parentId: index === 1 ? 'r1' : `c${index - 1}`, createdAt: index }));

  function adapterWithTree(): FakeAdapter {
    const adapter = new FakeAdapter();
    adapter.rootsProvider = pagedRoots([[r1]]);
    adapter.threadProvider = (commentId, cursor) => pagedThread(r1, tree)(commentId, cursor);
    return adapter;
  }

  it('无主体快照时回源抓整棵评论树（选中的是顶层评论）', async () => {
    const adapter = adapterWithTree();
    const { workbench } = build(adapter);

    const result = await workbench.analyzeThread(adapter.subject.ref, 'r1', options(), noop, new AbortController().signal);

    expect(adapter.calls.thread).toBe(3); // 5 条回复，每页 2 条
    expect(result.snapshot.rootId).toBe('r1');
    expect(result.snapshot.comments).toHaveLength(6);
    expect(result.snapshot.completeness).toMatchObject({ declared: 6, fetched: 6, truncated: false });
    expect(result.report.focusId).toBe('r1');
    expect(result.report.root.id).toBe('r1');
    expect(result.report.longestChain).toHaveLength(6);
  });

  it('选中楼中楼时只输出「选中评论 + 其后代」', async () => {
    const adapter = adapterWithTree();
    const { workbench } = build(adapter);

    const result = await workbench.analyzeThread(adapter.subject.ref, 'c3', options(), noop, new AbortController().signal);

    // 适配器抓了整棵 r1 树，但结果裁剪为 c3 → c4 → c5。
    expect(result.snapshot.rootId).toBe('c3');
    expect(result.snapshot.comments.map((comment) => comment.id).sort()).toEqual(['c3', 'c4', 'c5']);
    expect(result.report.root.id).toBe('c3');
    expect(result.report.focusId).toBe('c3');
    expect(result.report.longestChain.map((comment) => comment.id)).toEqual(['c3', 'c4', 'c5']);
    // 祖先与兄弟都被排除。
    expect(result.snapshot.comments.some((comment) => ['r1', 'c1', 'c2'].includes(comment.id))).toBe(false);
    // 非根评论的后代总数平台未声明（replyCount 恒为 0），不能冒充为 declared。
    expect(result.snapshot.completeness.declared).toBeUndefined();
    expect(result.snapshot.completeness.truncated).toBe(false);
  });

  it('兄弟被排除、孙代保留（选中 c2）', async () => {
    const adapter = new FakeAdapter();
    const root = makeComment({ id: 'r1', replyCount: 5, createdAt: 1 });
    const c1 = makeComment({ id: 'c1', rootId: 'r1', parentId: 'r1', createdAt: 2 });
    const c2 = makeComment({ id: 'c2', rootId: 'r1', parentId: 'c1', createdAt: 3 });
    const sibling = makeComment({ id: 'c2b', rootId: 'r1', parentId: 'c1', createdAt: 4 }); // c2 的兄弟
    const c3 = makeComment({ id: 'c3', rootId: 'r1', parentId: 'c2', createdAt: 5 });
    const grandchild = makeComment({ id: 'c4', rootId: 'r1', parentId: 'c3', createdAt: 6 });
    adapter.rootsProvider = pagedRoots([[root]]);
    adapter.threadProvider = (commentId, cursor) => pagedThread(root, [c1, c2, sibling, c3, grandchild], 10)(commentId, cursor);
    const { workbench } = build(adapter);

    const result = await workbench.analyzeThread(adapter.subject.ref, 'c2', options(), noop, new AbortController().signal);

    expect(result.snapshot.comments.map((comment) => comment.id).sort()).toEqual(['c2', 'c3', 'c4']);
    expect(result.report.longestChain.map((comment) => comment.id)).toEqual(['c2', 'c3', 'c4']);
  });

  it('目标评论不存在时报 not-found，绝不静默回退到根评论', async () => {
    const adapter = adapterWithTree();
    const { workbench } = build(adapter);

    const error: unknown = await workbench
      .analyzeThread(adapter.subject.ref, 'missing', options(), noop, new AbortController().signal)
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(PlatformError);
    expect((error as PlatformError).kind).toBe('not-found');
  });

  it('复用最新主体快照时零 adapter 调用（同样裁剪到选中子树）', async () => {
    const adapter = adapterWithTree();
    const { workbench } = build(adapter);
    const signal = new AbortController().signal;

    const subject = await workbench.analyzeSubject(adapter.subject.ref, options(), noop, signal);
    expect(subject.snapshot.comments).toHaveLength(6);
    adapter.resetCalls();

    const result = await workbench.analyzeThread(adapter.subject.ref, 'c3', options({ refresh: 'cache-first' }), noop, signal);

    expect(adapter.totalCalls).toBe(0);
    expect(result.fromSnapshot).toBe(true);
    expect(result.snapshot.rootId).toBe('c3');
    expect(result.report.root.id).toBe('c3');
    expect(result.report.focusId).toBe('c3');
    expect(result.snapshot.comments.map((comment) => comment.id).sort()).toEqual(['c3', 'c4', 'c5']);
  });

  it('主体快照未抓全该树时不复用，改为回源', async () => {
    const adapter = new FakeAdapter();
    const root = makeComment({ id: 'r1', replyCount: 5, createdAt: 1 });
    adapter.rootsProvider = pagedRoots([[root]]);
    adapter.threadProvider = (commentId, cursor) => pagedThread(root, tree.slice(0, 2))(commentId, cursor);
    const { workbench } = build(adapter);
    const signal = new AbortController().signal;

    const subject = await workbench.analyzeSubject(adapter.subject.ref, options({ maxRepliesPerThread: 2 }), noop, signal);
    expect(subject.snapshot.comments).toHaveLength(3); // 根 + 2 条回复
    adapter.resetCalls();
    adapter.threadProvider = (commentId, cursor) => pagedThread(root, tree)(commentId, cursor);

    const result = await workbench.analyzeThread(adapter.subject.ref, 'r1', options({ refresh: 'incremental' }), noop, signal);

    expect(adapter.threadCalls.length).toBeGreaterThan(0);
    expect(result.fromSnapshot).toBe(false);
    expect(result.snapshot.comments).toHaveLength(6);
  });

  it('full / incremental 不复用陈旧的主体快照（必须回源）', async () => {
    const adapter = adapterWithTree();
    const { workbench } = build(adapter);
    const signal = new AbortController().signal;

    await workbench.analyzeSubject(adapter.subject.ref, options(), noop, signal);

    adapter.resetCalls();
    const incremental = await workbench.analyzeThread(adapter.subject.ref, 'c3', options({ refresh: 'incremental' }), noop, signal);
    expect(adapter.totalCalls).toBeGreaterThan(0);
    expect(incremental.fromSnapshot).toBe(false);

    adapter.resetCalls();
    const full = await workbench.analyzeThread(adapter.subject.ref, 'c3', options({ refresh: 'full' }), noop, signal);
    expect(adapter.totalCalls).toBeGreaterThan(0);
    expect(full.fromSnapshot).toBe(false);
  });
});

describe('默认上限与缓存复用', () => {
  it('默认即不限上限：cache-first 不复用被上限截断的旧快照', async () => {
    const adapter = new FakeAdapter();
    const roots = [1, 2, 3].map((index) => makeComment({ id: `r${index}`, createdAt: index, replyCount: 2 }));
    adapter.rootsProvider = pagedRoots([roots]);
    adapter.threadProvider = (commentId, cursor) => {
      const root = roots.find((candidate) => candidate.id === commentId)!;
      const replies = [1, 2].map((n) => makeComment({ id: `${commentId}-c${n}`, rootId: commentId, parentId: commentId, createdAt: n }));
      return pagedThread(root, replies, 10)(commentId, cursor);
    };
    const { workbench } = build(adapter);
    const signal = new AbortController().signal;

    const limited = await workbench.analyzeSubject(adapter.subject.ref, options({ maxRoots: 1, maxRepliesPerThread: 1 }), noop, signal);
    expect(limited.snapshot.comments.map((comment) => comment.id)).toEqual(['r1', 'r1-c1']);
    expect(limited.snapshot.completeness.truncated).toBe(true);
    adapter.resetCalls();

    const full = await workbench.analyzeSubject(adapter.subject.ref, options({ refresh: 'cache-first' }), noop, signal);

    expect(full.fromSnapshot).toBe(false);
    expect(adapter.totalCalls).toBeGreaterThan(0);
    expect(full.snapshot.comments.map((comment) => comment.id).sort()).toEqual([
      'r1', 'r1-c1', 'r1-c2', 'r2', 'r2-c1', 'r2-c2', 'r3', 'r3-c1', 'r3-c2',
    ]);
  });

  it('负上限在公开入口被拒绝', async () => {
    const adapter = new FakeAdapter();
    const { workbench } = build(adapter);
    const signal = new AbortController().signal;

    const error: unknown = await workbench
      .analyzeSubject(adapter.subject.ref, options({ maxRoots: -1 }), noop, signal)
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(PlatformError);
    expect((error as PlatformError).kind).toBe('invalid-input');

    await expect(
      workbench.analyzeThread(adapter.subject.ref, 'r1', options({ maxRepliesPerThread: -5 }), noop, signal),
    ).rejects.toMatchObject({ kind: 'invalid-input' });
  });

  it('页面缓存按账号隔离：匿名截断结果不会喂给已登录用户', async () => {
    const adapter = new FakeAdapter();
    adapter.session = { platform: 'bilibili', loggedIn: false, limitations: ['未登录：仅返回前 1 条'] };
    adapter.subject = { ...adapter.subject, declaredCommentCount: 3 };
    const anonRoot = makeComment({ id: 'r1', createdAt: 1 });
    adapter.rootsProvider = pagedRoots([[anonRoot, makeComment({ id: 'r1b', createdAt: 2 })]]);
    const { workbench } = build(adapter);
    const signal = new AbortController().signal;

    // 匿名抓取：被 maxRoots=1 截断，页面缓存写入 'anon' 分区。
    await workbench.analyzeSubject(adapter.subject.ref, options({ refresh: 'cache-first', maxRoots: 1 }), noop, signal);

    // 登录后点状态刷新（公开入口强制回源）→ 更新 session 缓存。
    adapter.session = { platform: 'bilibili', loggedIn: true, user: { id: 'u9', name: '甲' }, limitations: [] };
    await workbench.session('bilibili');
    adapter.resetCalls();
    adapter.rootsProvider = pagedRoots([[makeComment({ id: 'r1', createdAt: 1 }), makeComment({ id: 'r2', createdAt: 2 })]]);

    // 默认不限上限 → 旧快照（maxRoots=1）不能满足，回源；账号隔离使其读不到匿名页面缓存。
    const user = await workbench.analyzeSubject(adapter.subject.ref, options({ refresh: 'cache-first' }), noop, signal);

    expect(adapter.calls.roots).toBeGreaterThan(0);
    expect(user.snapshot.comments.map((comment) => comment.id).sort()).toEqual(['r1', 'r2']);
  });

  it('已登录时不复用匿名截断的 cache-first 快照', async () => {
    const adapter = new FakeAdapter();
    adapter.session = { platform: 'bilibili', loggedIn: false, limitations: ['未登录：顶层评论仅返回前 1 条'] };
    adapter.subject = { ...adapter.subject, declaredCommentCount: 2 };
    adapter.rootsProvider = pagedRoots([[makeComment({ id: 'r1', createdAt: 1 })]]);
    const { workbench } = build(adapter);
    const signal = new AbortController().signal;

    const anon = await workbench.analyzeSubject(adapter.subject.ref, options({ refresh: 'cache-first' }), noop, signal);
    expect(anon.snapshot.auth).toBe('anonymous');
    expect(anon.snapshot.completeness.truncated).toBe(true);

    adapter.session = { platform: 'bilibili', loggedIn: true, user: { id: 'u9', name: '甲' }, limitations: [] };
    await workbench.session('bilibili'); // 点状态刷新 → session 缓存更新
    adapter.resetCalls();
    adapter.rootsProvider = pagedRoots([[makeComment({ id: 'r1', createdAt: 1 }), makeComment({ id: 'r2', createdAt: 2 })]]);

    const user = await workbench.analyzeSubject(adapter.subject.ref, options({ refresh: 'cache-first' }), noop, signal);

    expect(user.fromSnapshot).toBe(false);
    expect(adapter.totalCalls).toBeGreaterThan(0);
    expect(user.snapshot.auth).toBe('user');
    expect(user.snapshot.comments.map((comment) => comment.id).sort()).toEqual(['r1', 'r2']);
  });
});

describe('快照索引', () => {
  it('cache-first 命中时零请求，历史 / 打开 / 删除闭环', async () => {
    const adapter = new FakeAdapter();
    adapter.rootsProvider = pagedRoots([[makeComment({ id: 'r1', likes: 7 })]]);
    const { workbench, cache } = build(adapter);
    const signal = new AbortController().signal;

    const first = await workbench.analyzeSubject(adapter.subject.ref, options(), noop, signal);
    adapter.resetCalls();

    const cached = await workbench.analyzeSubject(adapter.subject.ref, options({ refresh: 'cache-first' }), noop, signal);
    expect(adapter.totalCalls).toBe(0);
    expect(cached.fromSnapshot).toBe(true);
    expect(cached.snapshot.id).toBe(first.snapshot.id);
    expect(cached.report.overview.total).toBe(1);

    const history = await workbench.history();
    expect(history.map((item) => item.id)).toEqual([first.snapshot.id]);
    expect(history[0]!.commentCount).toBe(1);

    const opened = await workbench.openSnapshot(first.snapshot.id);
    expect(opened.fromSnapshot).toBe(true);
    expect(opened.report.overview.totalLikes).toBe(7);

    expect((await workbench.cacheUsage()).entries).toBeGreaterThan(0);
    await workbench.deleteSnapshot(first.snapshot.id);
    expect(await workbench.history()).toEqual([]);
    await expect(workbench.openSnapshot(first.snapshot.id)).rejects.toMatchObject({ kind: 'not-found' });

    await workbench.clearCache();
    expect(await workbench.cacheUsage()).toEqual({ entries: 0, bytes: 0 });
    expect(workbench.cacheStats().loads).toBeGreaterThan(0);
    expect(await cache.keys('')).toEqual([]);
  });

  it('resolve 交给适配器解析', () => {
    const adapter = new FakeAdapter();
    const { workbench } = build(adapter);
    expect(workbench.resolve('https://www.bilibili.com/video/BV1TEST')?.adapter.id).toBe('bilibili');
    expect(workbench.resolve('随便一串')).toBeNull();
  });

  it('session() 每次都回源，点击状态能立刻反映登录态', async () => {
    const adapter = new FakeAdapter();
    const { workbench } = build(adapter);
    const first = await workbench.session('bilibili');
    expect(first).toEqual(adapter.session);
    expect(adapter.calls.session).toBe(1);

    adapter.session = { platform: 'bilibili', loggedIn: false, limitations: [] };
    const second = await workbench.session('bilibili');
    expect(second.loggedIn).toBe(false);
    expect(adapter.calls.session).toBe(2);
  });
});

describe('身份分键：同一份物理缓存下两种身份姿态互不喂错', () => {
  it('session 键带身份维度：page 与 direct 各读各的登录态，页键也不互喂', async () => {
    const cache = createCache({ dbName: uniqueDbName(), now: tickingNow() });
    const pageAdapter = new FakeAdapter();
    pageAdapter.session = { platform: 'bilibili', loggedIn: true, user: { id: 'u1', name: '页内用户' }, limitations: [] };
    pageAdapter.rootsProvider = pagedRoots([[makeComment({ id: 'r1' })]]);
    const directAdapter = new FakeAdapter();
    directAdapter.session = { platform: 'bilibili', loggedIn: false, limitations: ['未登录'] };
    directAdapter.rootsProvider = pagedRoots([[makeComment({ id: 'rx' })]]);
    const page = build(pageAdapter, { cache, identity: 'page' }).workbench;
    const direct = build(directAdapter, { cache, identity: 'direct' }).workbench;
    const signal = new AbortController().signal;

    // page 侧先抓到登录态并写进 'session|bilibili|page'；direct 侧再吃 'session|bilibili|direct'，
    // 旧共享键会直接命中 page 写下的登录 session —— 现在必须各发各的 getSession。
    await page.previewRootsPage(pageAdapter.subject.ref, null, options({ refresh: 'cache-first' }), noop, signal);
    await direct.previewRootsPage(directAdapter.subject.ref, null, options({ refresh: 'cache-first' }), noop, signal);

    expect(pageAdapter.calls.session).toBe(1);
    expect(directAdapter.calls.session).toBe(1);
    // 页键按账号隔离：anon 侧读到自己的分页，不吃 u:u1 写下的那一份
    expect(directAdapter.calls.roots).toBe(1);
  });

  it('同一账号：工作台（direct）整链抓过的页，阅读器（page）逐页 cache-first 直接命中', async () => {
    const cache = createCache({ dbName: uniqueDbName(), now: tickingNow() });
    const a = new FakeAdapter();
    a.session = { platform: 'bilibili', loggedIn: true, user: { id: 'u1', name: '同一用户' }, limitations: [] };
    a.rootsProvider = pagedRoots([[makeComment({ id: 'r1' })], [makeComment({ id: 'r2' })]]);
    const b = new FakeAdapter();
    b.session = { platform: 'bilibili', loggedIn: true, user: { id: 'u1', name: '同一用户' }, limitations: [] };
    const wa = build(a, { cache, identity: 'direct' }).workbench;
    const wb = build(b, { cache, identity: 'page' }).workbench;
    const signal = new AbortController().signal;

    await wa.analyzeSubject(a.subject.ref, options({ refresh: 'full' }), noop, signal);
    expect(a.calls.roots).toBe(2);

    const first = await wb.previewRootsPage(a.subject.ref, null, options({ refresh: 'cache-first' }), noop, signal);
    const second = await wb.previewRootsPage(a.subject.ref, first.next, options({ refresh: 'cache-first' }), noop, signal);

    expect(first.roots.map((comment) => comment.id)).toEqual(['r1']);
    expect(second.roots.map((comment) => comment.id)).toEqual(['r2']);
    // 页键按账号（u:u1）共吃：B 的分页一次都不回源；
    // session 键按身份姿态分开：B 自己的 'session|bilibili|page' 必须各发各的 getSession
    expect(b.calls.roots).toBe(0);
    expect(b.calls.session).toBe(1);
  });

  it('身份姿态是活的：identity getter 翻面后，下一次 session 用新键重新回源', async () => {
    const adapter = new FakeAdapter();
    adapter.session = { platform: 'bilibili', loggedIn: true, user: { id: 'u1', name: '用户' }, limitations: [] };
    const cache = createCache({ dbName: uniqueDbName(), now: tickingNow() });
    let posture = 'page';
    const http = {
      // 注意不能用 Object.assign/spread 拷贝 getter——它们会即刻取值固化成数据属性
      ...createHttpClient(),
      get identity(): string {
        return posture;
      },
    };
    const workbench = createWorkbench({ adapters: [adapter], cache, http, now: tickingNow() });
    const signal = new AbortController().signal;

    await workbench.previewRootsPage(adapter.subject.ref, null, options({ refresh: 'cache-first' }), noop, signal);
    expect(adapter.calls.session).toBe(1); // 写进 'session|bilibili|page'

    posture = 'direct'; // 桥挂掉：姿态翻面，绝不能吃 'page' 姿态写下的那份 session
    adapter.rootsProvider = pagedRoots([[makeComment({ id: 'rx' })]]);
    await workbench.previewRootsPage(adapter.subject.ref, null, options({ refresh: 'cache-first' }), noop, signal);

    expect(adapter.calls.session).toBe(2); // 新键 'session|bilibili|direct' 未命中 → 回源
  });
});

describe('定位一条评论（locateComment）', () => {
  const root = makeComment({ id: 'r1', replyCount: 2 });
  const replies = [makeComment({ id: 'c1', rootId: 'r1', parentId: 'r1' }), makeComment({ id: 'c2', rootId: 'r1', parentId: 'c1' })];

  function withTree(): FakeAdapter {
    const adapter = new FakeAdapter();
    adapter.rootsProvider = pagedRoots([[root]]);
    adapter.threadProvider = (commentId, cursor) => pagedThread(root, replies, 10)(commentId, cursor);
    return adapter;
  }

  it('最新主体快照已含该评论：零请求，source 为 snapshot', async () => {
    const adapter = withTree();
    const { workbench } = build(adapter);
    const signal = new AbortController().signal;

    await workbench.analyzeSubject(adapter.subject.ref, options(), noop, signal);
    adapter.resetCalls();

    const found = await workbench.locateComment(adapter.subject.ref, 'c2', noop, signal);

    expect(adapter.totalCalls).toBe(0);
    expect(found.source).toBe('snapshot');
    expect(found.root.id).toBe('r1');
    expect(found.comments.map((comment) => comment.id).sort()).toEqual(['c1', 'c2', 'r1']);
  });

  it('快照里没有：一次 seekRoot 取回根评论块；同一 id 再定位走缓存不再回源', async () => {
    const adapter = new FakeAdapter();
    adapter.rootsProvider = pagedRoots([[makeComment({ id: 'other' })]]);
    const sought = { root, items: [root, ...replies] };
    adapter.seekRoot = async (_subject, commentId) => {
      adapter.calls.seek++;
      if (commentId !== 'c2') throw new PlatformError('not-found', '评论不存在或已删除');
      return sought;
    };
    const { workbench } = build(adapter);
    const signal = new AbortController().signal;

    const first = await workbench.locateComment(adapter.subject.ref, 'c2', noop, signal);
    expect(first.source).toBe('network');
    expect(first.comments.map((comment) => comment.id)).toEqual(['r1', 'c1', 'c2']);
    expect(adapter.calls.seek).toBe(1);

    adapter.resetCalls();
    const second = await workbench.locateComment(adapter.subject.ref, 'c2', noop, signal);
    expect(second.source).toBe('cache');
    expect(adapter.calls.seek).toBe(0);
  });

  it('seekRoot 抛 not-found 原样透传；适配器不支持 seek 时抛 unavailable', async () => {
    const adapter = new FakeAdapter();
    adapter.seekRoot = async () => {
      throw new PlatformError('not-found', '评论不存在或已删除');
    };
    const { workbench } = build(adapter);
    const signal = new AbortController().signal;

    await expect(workbench.locateComment(adapter.subject.ref, 'ghost', noop, signal)).rejects.toMatchObject({ kind: 'not-found' });

    const plain = new FakeAdapter();
    const other = build(plain).workbench;
    await expect(other.locateComment(plain.subject.ref, 'ghost', noop, signal)).rejects.toMatchObject({ kind: 'unavailable' });
    expect(plain.calls.session).toBe(0);
  });
});

describe('平台级限流', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('同一平台上的并发抓取共享并发上限', async () => {
    // 内存-only 缓存：抓取链路全在微任务里推进，无需真实计时器即可观察并发。
    vi.stubGlobal('indexedDB', {
      open() {
        throw new Error('indexedDB 不可用');
      },
    });
    const adapter = new FakeAdapter();
    adapter.politeness = { concurrency: 1, minIntervalMs: 0 };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    adapter.beforeRoots = () => gate;
    adapter.rootsProvider = pagedRoots([[makeComment({ id: 'r1' })]]);
    adapter.threadProvider = (commentId, cursor) => pagedThread(makeComment({ id: 'r1' }), [])(commentId, cursor);
    const { workbench } = build(adapter);
    const signal = new AbortController().signal;

    const subject = workbench.analyzeSubject(adapter.subject.ref, options(), noop, signal);
    const thread = workbench.analyzeThread(adapter.subject.ref, 'r1', options(), noop, signal);
    await settleMicrotasks();
    expect(adapter.maxInFlight).toBe(1);
    await settleMicrotasks();
    expect(adapter.maxInFlight).toBe(1); // 另一个抓取始终没能同时发出请求

    release();
    await Promise.all([subject, thread]);
    expect(adapter.maxInFlight).toBe(1);
  });
});

describe('可恢复抓取', () => {
  it('中断的轮次留检查点：重跑复用已抓页，只补缺页', async () => {
    const adapter = new FakeAdapter();
    const pages = [
      [makeComment({ id: 'r1', replyCount: 0 }), makeComment({ id: 'r2', replyCount: 0 })],
      [makeComment({ id: 'r3', replyCount: 0 })],
      [makeComment({ id: 'r4', replyCount: 0 })],
    ];
    // 第一轮在第二页失败 → 检查点留下
    adapter.rootsProvider = ((cursor: Cursor | null) =>
      cursor === '1' ? Promise.reject(new PlatformError('unavailable', '中断')) : pagedRoots(pages)(cursor)) as typeof adapter.rootsProvider;
    const { workbench } = build(adapter);
    await expect(workbench.analyzeSubject(adapter.subject.ref, options(), noop, new AbortController().signal)).rejects.toThrow();
    // 第二轮修复后重跑
    adapter.rootsProvider = pagedRoots(pages);
    const callsBefore = adapter.rootCursors.length;
    const result = await workbench.analyzeSubject(adapter.subject.ref, options(), noop, new AbortController().signal);
    const rerunCalls = adapter.rootCursors.slice(callsBefore);
    // start 页命中中断轮的页缓存，只回源 '1' 与 '2'
    expect(rerunCalls).toEqual(['1', '2']);
    expect(result.snapshot.comments.map((c) => c.id).sort()).toEqual(['r1', 'r2', 'r3', 'r4']);
    // 成功后检查点被删除：再跑一轮 = 普通全量回源
    const calls2 = adapter.rootCursors.length;
    await workbench.analyzeSubject(adapter.subject.ref, options(), noop, new AbortController().signal);
    expect(adapter.rootCursors.slice(calls2)).toEqual([null, '1', '2']);
  });
});

  it('评论树抓取用有界 worker 池：并发上限 = politeness.concurrency，无队头阻塞', async () => {
    const adapter = new FakeAdapter();
    const roots = [1, 2, 3, 4].map((i) => makeComment({ id: 'r' + i, replyCount: 1, createdAt: 5 - i }));
    adapter.rootsProvider = pagedRoots([roots]);
    let releaseFirst!: () => void;
    const gate = new Promise<void>((r) => {
      releaseFirst = r;
    });
    adapter.threadProvider = ((commentId: string) =>
      (commentId === 'r1' ? gate.then(() => ({ items: [makeComment({ id: commentId + '-c1', rootId: commentId, parentId: commentId })], next: null })) : ({ items: [makeComment({ id: commentId + '-c1', rootId: commentId, parentId: commentId })], next: null }))) as typeof adapter.threadProvider;
    const { workbench } = build(adapter);
    const pending = workbench.analyzeSubject(adapter.subject.ref, options(), noop, new AbortController().signal);
    // IDB 交易走宏任务：轮询要等事件循环而不是只排微任务
    for (let i = 0; i < 200 && adapter.threadCalls.length < 4; i++) await new Promise((r) => setTimeout(r, 0));
    // r1 卡住时其余 worker 照常推进 r2/r3/r4
    expect(adapter.threadCalls.length).toBe(4);
    expect(adapter.maxInFlight).toBe(2);
    releaseFirst();
    await pending;
  });