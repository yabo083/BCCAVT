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

/** 手动推进的时钟：验分层 TTL 要靠它跨过 30 分钟页 TTL。 */
function buildWithClock(adapter: FakeAdapter): { workbench: Workbench; advance: (ms: number) => void } {
  let clock = Date.UTC(2026, 0, 1);
  const now = (): number => clock;
  const cache = createCache({ dbName: uniqueDbName(), now });
  return { workbench: createWorkbench({ adapters: [adapter], cache, http: createHttpClient(), now }), advance: (ms) => { clock += ms; } };
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

  it('排序维度透传给适配器，缺省为 time', async () => {
    const adapter = new FakeAdapter();
    adapter.rootsProvider = pagedRoots([[makeComment({ id: 'r1' })]]);
    const workbench = build(adapter);

    await workbench.previewRootsPage(adapter.subject.ref, null, options(), noop, signal());
    expect(adapter.rootOrders).toEqual(['time']);

    await workbench.previewRootsPage(adapter.subject.ref, null, options({ order: 'hot' }), noop, signal());
    expect(adapter.rootOrders).toEqual(['time', 'hot']);
  });

  it('time 与 hot 的页缓存各自成链：不同序同一游标不共吃一条缓存', async () => {
    const adapter = new FakeAdapter();
    adapter.rootsProvider = pagedRoots([[makeComment({ id: 'r1' })]]);
    const workbench = build(adapter);

    await workbench.previewRootsPage(adapter.subject.ref, null, options(), noop, signal());
    expect(adapter.calls.roots).toBe(1);

    // hot 序的同游标页是另一条键：必须回源，不能吃 time 序刚写下的页
    await workbench.previewRootsPage(adapter.subject.ref, null, options({ order: 'hot' }), noop, signal());
    expect(adapter.calls.roots).toBe(2);

    // 回到 time 序：命中第一次写下的缓存，不再回源
    await workbench.previewRootsPage(adapter.subject.ref, null, options(), noop, signal());
    expect(adapter.calls.roots).toBe(2);
  });

  it('热度序按会话 + 块号成链：同一 offset 连发时块块推进，回放整链 0 回源', async () => {
    const adapter = new FakeAdapter();
    let round = 0;
    // 登录态热度序：平台一直回同一个 offset，在服务端会话里逐块推进
    adapter.rootsProvider = () => {
      round += 1;
      return round <= 3 ? { items: [makeComment({ id: `h${round}` })], next: 'same-offset' } : { items: [], next: null };
    };
    const workbench = build(adapter);
    const hot = options({ order: 'hot' });
    const read = (cursor: string | null) => workbench.previewRootsPage(adapter.subject.ref, cursor, hot, noop, signal());

    const first = await read(null);
    const second = await read(first.next);
    const third = await read(second.next);
    const end = await read(third.next);

    expect([first.roots[0]?.id, second.roots[0]?.id, third.roots[0]?.id]).toEqual(['h1', 'h2', 'h3']);
    expect(end.next).toBeNull();
    expect(adapter.rootCursors).toEqual([null, 'same-offset', 'same-offset', 'same-offset']);

    // 换序 / 重开阅读器都从 null 重新走一条链：块序与内容原样回放，一个请求都不再发
    const calls = adapter.calls.roots;
    const replay: Array<string | null> = [];
    let cursor: string | null = null;
    for (let i = 0; i < 6 && (i === 0 || cursor !== null); i++) {
      const page = await read(cursor);
      replay.push(page.roots[0]?.id ?? null);
      cursor = page.next;
    }
    expect(replay).toEqual(['h1', 'h2', 'h3', null]);
    expect(adapter.calls.roots).toBe(calls);
  });

  it('会话被平台重置回榜首时按新会话重来，不把首块当成后一块', async () => {
    const adapter = new FakeAdapter();
    const script: Array<Array<string>> = [['a'], ['b'], ['a'], ['c']];
    adapter.rootsProvider = () => {
      const ids = script.shift() ?? [];
      return { items: ids.map((id) => makeComment({ id })), next: 'same-offset' };
    };
    const workbench = build(adapter);
    const hot = options({ order: 'hot' });
    const read = (cursor: string | null) => workbench.previewRootsPage(adapter.subject.ref, cursor, hot, noop, signal());

    const first = await read(null);
    const second = await read(first.next);
    const third = await read(second.next);

    expect([first.roots[0]?.id, second.roots[0]?.id, third.roots[0]?.id]).toEqual(['a', 'b', 'c']);
    // 第三次请求回的是首块（a）⇒ 判定会话被重置，另开一条会话（null）重取
    expect(adapter.rootCursors).toEqual([null, 'same-offset', 'same-offset', null]);
  });

  it('会话被重置到中间某块时也认出来：任一 id 重复即按新会话重来', async () => {
    const adapter = new FakeAdapter();
    // 第 4 次请求故意回第 2 块的内容——不是榜首，而是会话中间某块
    const script: Array<Array<string>> = [['a'], ['b'], ['c'], ['b'], ['d']];
    adapter.rootsProvider = () => {
      const ids = script.shift() ?? [];
      return { items: ids.map((id) => makeComment({ id })), next: 'same-offset' };
    };
    const workbench = build(adapter);
    const hot = options({ order: 'hot' });
    const read = (cursor: string | null) => workbench.previewRootsPage(adapter.subject.ref, cursor, hot, noop, signal());

    const first = await read(null);
    const second = await read(first.next);
    const third = await read(second.next);
    const fourth = await read(third.next);

    expect([first.roots[0]?.id, second.roots[0]?.id, third.roots[0]?.id, fourth.roots[0]?.id]).toEqual(['a', 'b', 'c', 'd']);
    expect(adapter.rootCursors).toEqual([null, 'same-offset', 'same-offset', 'same-offset', null]);
  });

  it('会话失效后重来并快进跳过重合块：交出第一页带新条目的内容，不把重复行喂给只追加的分页器', async () => {
    const adapter = new FakeAdapter();
    const script: Array<Array<string>> = [['a'], ['b'], ['c'], ['b'], ['a'], ['b'], ['d']];
    adapter.rootsProvider = () => {
      const ids = script.shift() ?? [];
      return { items: ids.map((id) => makeComment({ id })), next: 'same-offset' };
    };
    const workbench = build(adapter);
    const hot = options({ order: 'hot' });
    const read = (cursor: string | null) => workbench.previewRootsPage(adapter.subject.ref, cursor, hot, noop, signal());

    const first = await read(null);
    const second = await read(first.next);
    const third = await read(second.next);
    // 第 4 次：平台回的是第 2 块（会话重置）→ 新开一条，快进过 a、b，交出 d
    const fourth = await read(third.next);

    expect([first.roots[0]?.id, second.roots[0]?.id, third.roots[0]?.id, fourth.roots[0]?.id]).toEqual(['a', 'b', 'c', 'd']);
    expect(fourth.next).not.toBeNull();
    expect(adapter.rootCursors).toEqual([null, 'same-offset', 'same-offset', 'same-offset', null, 'same-offset', 'same-offset']);
  });

  it('快进额度用完仍全是已读内容：如实收尾并给出原因，不假装「到底」', async () => {
    const adapter = new FakeAdapter();
    const script: Array<Array<string>> = [['a'], ['b'], ['c'], ['d'], ['e'], ['a'], ['a'], ['b'], ['c'], ['d']];
    adapter.rootsProvider = () => {
      const ids = script.shift() ?? [];
      return { items: ids.map((id) => makeComment({ id })), next: 'same-offset' };
    };
    const workbench = build(adapter);
    const hot = options({ order: 'hot' });
    const read = (cursor: string | null) => workbench.previewRootsPage(adapter.subject.ref, cursor, hot, noop, signal());

    let cursor: string | null = null;
    for (let i = 0; i < 5; i++) cursor = (await read(cursor)).next;
    const page = await read(cursor);

    expect(page.roots).toEqual([]);
    expect(page.next).toBeNull();
    expect(page.endReason).toContain('会话已失效');
  });

  it('整条热度序快照回放时带上快照时刻；实时取到的页没有', async () => {
    const adapter = new FakeAdapter();
    let round = 0;
    adapter.rootsProvider = () => {
      round += 1;
      return round <= 2 ? { items: [makeComment({ id: `h${round}` })], next: 'same-offset' } : { items: [], next: null };
    };
    const workbench = build(adapter);
    const hot = options({ order: 'hot' });
    const read = (cursor: string | null) => workbench.previewRootsPage(adapter.subject.ref, cursor, hot, noop, signal());

    const first = await read(null);
    expect(first.snapshotAt).toBeUndefined();
    const second = await read(first.next);
    await read(second.next);

    // 链已走完：重开阅读器整段回放，标明这是快照
    const replay = await read(null);
    expect(replay.roots.map((comment) => comment.id)).toEqual(['h1']);
    expect(typeof replay.snapshotAt).toBe('number');
  });

  it('分层 TTL：首屏 30 分钟、更深页 12 小时——回看旧区间不再整段重跑', async () => {
    const adapter = new FakeAdapter();
    adapter.rootsProvider = pagedRoots([[makeComment({ id: 'r1' })], [makeComment({ id: 'r2' })]]);
    const { workbench, advance } = buildWithClock(adapter);
    const read = (cursor: string | null) => workbench.previewRootsPage(adapter.subject.ref, cursor, options(), noop, signal());

    const first = await read(null);
    await read(first.next);
    expect(adapter.calls.roots).toBe(2);

    advance(45 * 60_000); // 页 TTL 30 分钟（含 ±10% 抖动）已过
    await read(null); // 首屏要回源：新评论会出现在顶部
    expect(adapter.calls.roots).toBe(3);
    await read(first.next); // 深页命 12 小时的 history 缓存
    expect(adapter.calls.roots).toBe(3);
  });

  it('平台在热度序里说完之后不再回源：链的界外页也按末页回答', async () => {
    const adapter = new FakeAdapter();
    adapter.rootsProvider = () => ({ items: [makeComment({ id: 'only' })], next: null });
    const workbench = build(adapter);
    const hot = options({ order: 'hot' });

    const page = await workbench.previewRootsPage(adapter.subject.ref, null, hot, noop, signal());
    expect(page.next).toBeNull();
    expect(adapter.calls.roots).toBe(1);

    const replay = await workbench.previewRootsPage(adapter.subject.ref, null, hot, noop, signal());
    expect(replay.roots.map((comment) => comment.id)).toEqual(['only']);
    expect(replay.next).toBeNull();
    expect(adapter.calls.roots).toBe(1);
  });

  it('未知的排序值在公开入口被拒绝', async () => {
    const adapter = new FakeAdapter();
    const workbench = build(adapter);
    await expect(
      workbench.previewRootsPage(adapter.subject.ref, null, options({ order: 'newest' as never }), noop, signal()),
    ).rejects.toMatchObject({ kind: 'invalid-input' });
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
