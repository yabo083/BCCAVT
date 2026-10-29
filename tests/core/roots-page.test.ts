import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createCache } from '@/core/cache/index';
import { createHttpClient } from '@/core/http';
import { DEFAULT_CRAWL_OPTIONS } from '@/core/report';
import type { CrawlOptions, CrawlProgress, Workbench } from '@/core/report';
import { createWorkbench } from '@/core/workbench';
import { FakeAdapter, makeComment, pagedRoots, pagedThread, uniqueDbName } from './fakes';

const noop = (): void => {};
/** 阅读器只用 cache-first；full 只在「刷新」时显式出现。 */
const options = (overrides: Partial<CrawlOptions> = {}): CrawlOptions => ({ ...DEFAULT_CRAWL_OPTIONS, refresh: 'cache-first', ...overrides });
const signal = (): AbortSignal => new AbortController().signal;

/** 每次调用都前进 1s：同一目标多次抓取要拿到不同的时间戳。 */
function tickingNow(): () => number {
  let clock = Date.UTC(2026, 0, 1);
  return () => {
    clock += 1000;
    return clock;
  };
}

function build(adapter: FakeAdapter): Workbench {
  const cache = createCache({ dbName: uniqueDbName(), now: tickingNow() });
  return createWorkbench({ adapters: [adapter], cache, http: createHttpClient(), now: tickingNow() });
}

describe('按游标取一页顶层评论（previewRootsPage）', () => {
  it('一页就是一次请求，游标与平台声明数原样回传', async () => {
    const adapter = new FakeAdapter();
    adapter.subject = { ...adapter.subject, declaredCommentCount: 40 };
    adapter.rootsProvider = pagedRoots([
      [makeComment({ id: 'r1' }), makeComment({ id: 'r2' })],
      [makeComment({ id: 'r3' })],
    ]);
    const workbench = build(adapter);
    const phases: CrawlProgress[] = [];

    const first = await workbench.previewRootsPage(adapter.subject.ref, null, options(), (p) => phases.push(p), signal());
    expect(first.roots.map((comment) => comment.id)).toEqual(['r1', 'r2']);
    expect(first.next).toBe('1');
    expect(first.declared).toBe(40);
    expect(first.subject.title).toBe('测试视频');

    const second = await workbench.previewRootsPage(adapter.subject.ref, first.next, options(), noop, signal());
    expect(second.roots.map((comment) => comment.id)).toEqual(['r3']);
    expect(second.next).toBeNull();
    expect(adapter.rootCursors).toEqual([null, '1']);
    expect([...new Set(phases.map((progress) => progress.phase))]).toEqual(['session', 'subject', 'roots', 'threads', 'done']);
  });

  it('同一游标命中缓存就不再请求平台', async () => {
    const adapter = new FakeAdapter();
    adapter.rootsProvider = pagedRoots([[makeComment({ id: 'r1' })]]);
    const workbench = build(adapter);

    await workbench.previewRootsPage(adapter.subject.ref, null, options(), noop, signal());
    expect(adapter.calls.roots).toBe(1);
    await workbench.previewRootsPage(adapter.subject.ref, null, options(), noop, signal());

    expect(adapter.calls.roots).toBe(1);
    expect(adapter.rootCursors).toEqual([null]);
  });

  it('与整链抓取共用同一套页缓存键：整链抓过的页，逐页入口不再回源', async () => {
    const adapter = new FakeAdapter();
    adapter.rootsProvider = pagedRoots([[makeComment({ id: 'r1' })], [makeComment({ id: 'r2' })]]);
    const workbench = build(adapter);

    await workbench.analyzeSubject(adapter.subject.ref, options({ refresh: 'full' }), noop, signal());
    expect(adapter.rootCursors).toEqual([null, '1']);

    const page = await workbench.previewRootsPage(adapter.subject.ref, null, options(), noop, signal());

    expect(page.roots.map((comment) => comment.id)).toEqual(['r1']);
    expect(page.next).toBe('1');
    expect(adapter.calls.roots).toBe(2);
  });

  it('页内按 id 去重：置顶评论同时留在时间流里也只收一条', async () => {
    const adapter = new FakeAdapter();
    const pinned = makeComment({ id: 'r1', pinned: true });
    adapter.rootsProvider = pagedRoots([[pinned, makeComment({ id: 'r2' }), pinned]]);
    const workbench = build(adapter);

    const page = await workbench.previewRootsPage(adapter.subject.ref, null, options(), noop, signal());

    expect(page.roots.map((comment) => comment.id)).toEqual(['r1', 'r2']);
    expect(page.comments.map((comment) => comment.id)).toEqual(['r1', 'r2']);
  });

  it('两页拼接起来没有重复项：每页只回自己的条，并集恰好是全集', async () => {
    const adapter = new FakeAdapter();
    adapter.rootsProvider = pagedRoots([[makeComment({ id: 'r1' }), makeComment({ id: 'r2' })], [makeComment({ id: 'r3' })]]);
    const workbench = build(adapter);

    const first = await workbench.previewRootsPage(adapter.subject.ref, null, options(), noop, signal());
    const second = await workbench.previewRootsPage(adapter.subject.ref, first.next, options(), noop, signal());
    // 阅读器就是把两页这样拼起来的；跨页同 id 的去重在状态机侧（tests/ui/infinite-scroll.test.ts）
    const merged = [...first.comments, ...second.comments];

    expect(merged).toHaveLength(3);
    expect(new Set(merged.map((comment) => comment.id))).toEqual(new Set(['r1', 'r2', 'r3']));
  });

  it('楼中楼：只有声明回复数多于已知预览数的根评论才去抓评论树', async () => {
    const adapter = new FakeAdapter();
    const r1 = makeComment({ id: 'r1', replyCount: 3 });
    const r1Previews = [1, 2, 3].map((index) => makeComment({ id: `r1-c${index}`, rootId: 'r1', parentId: 'r1' }));
    const r2 = makeComment({ id: 'r2', replyCount: 5 });
    adapter.rootsProvider = pagedRoots([[r1, ...r1Previews, r2]]);
    const r2Replies = [1, 2, 3, 4, 5].map((index) => makeComment({ id: `r2-c${index}`, rootId: 'r2', parentId: 'r2' }));
    adapter.threadProvider = (commentId, cursor) => pagedThread(r2, r2Replies)(commentId, cursor);
    const workbench = build(adapter);

    const page = await workbench.previewRootsPage(adapter.subject.ref, null, options({ maxRepliesPerThread: 3 }), noop, signal());

    expect([...new Set(adapter.threadCalls.map((call) => call.commentId))]).toEqual(['r2']);
    expect(adapter.threadCalls.map((call) => call.cursor)).toEqual([null, '1']);
    expect(page.comments.map((comment) => comment.id)).toEqual([
      'r1',
      'r2',
      'r1-c1',
      'r1-c2',
      'r1-c3',
      'r2-c1',
      'r2-c2',
      'r2-c3',
    ]);
  });

  it('逐页取数不写快照与历史（只算不存）', async () => {
    const adapter = new FakeAdapter();
    adapter.rootsProvider = pagedRoots([[makeComment({ id: 'r1' })]]);
    const workbench = build(adapter);

    await workbench.previewRootsPage(adapter.subject.ref, null, options(), noop, signal());

    expect(await workbench.history()).toEqual([]);
    await expect(workbench.openSnapshot('bilibili:video:BV1TEST@1')).rejects.toThrow();
  });
});
