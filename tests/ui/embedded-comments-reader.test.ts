// @vitest-environment happy-dom
/**
 * 嵌入阅读器的取数 / 滚动链路。盯住三件事：
 *   1) 触发：宿主视口消息与哨兵汇进同一个边沿闸门——同一段「到底区」只取一次，在途期间连来的消息一条都不多发，
 *      `next === null`（到底）之后一次都不再取；
 *   2) 取数：每次只追加一页，页数就等于平台给的游标链长度；失败保留游标、不自动重试，点「重试」从同一页继续；
 *   3) 高度：只在 DOM 更新后量，只增不减——非结构性的回落不上报，折叠这类结构性缩高才上报更小的值，
 *      同一个值不重复发。
 *
 * 这里挂真实组件，只桩掉服务层与两个观察者；高度用「行数 × 行高 + 余量」模拟，于是折叠会真的让量到的高度变小。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import PageCommentRow from '@/ui/components/PageCommentRow.vue';
import EmbeddedComments from '@/ui/EmbeddedComments.vue';
import {
  EMBEDDED_CONTEXT,
  READER_BRIDGE_SOURCE,
  READER_LOCATE,
  READER_NAVIGATION,
  READER_USER_CARD,
  READER_VIEWPORT,
  isReaderHeightMessage,
} from '@/extension/page-comments';
import type { RootsPage } from '@/core/report';
import { PlatformError } from '@/core/errors';
import type { Comment, Subject, SubjectRef } from '@/core/model';
import { ROW_PAGE_SIZE } from '@/ui/thread';

const SUBJECT: SubjectRef = { platform: 'bilibili', kind: 'video', id: 'BV1UbpP6EEGu' };
const VIDEO_URL = `https://www.bilibili.com/video/${SUBJECT.id}/`;
const SUBJECT_META: Subject = { ref: SUBJECT, title: '测试视频', url: VIDEO_URL, locator: {} };
/** 每行评论在模拟布局里的高度。 */
const ROW_HEIGHT = 100;
/** 展开一棵大树时的回复条数：要远超一批（`ROW_PAGE_SIZE`），才能观察到「到底之后还要不要手动点」。 */
const BIG_REPLIES = 250;

const mocks = vi.hoisted(() => ({ previewRootsPage: vi.fn(), previewThread: vi.fn(), locateComment: vi.fn(), session: vi.fn(async () => ({ platform: 'bilibili', loggedIn: true, user: { id: 'u1', name: '我' }, limitations: [] })), contextUrl: '' }));

vi.mock('@/ui/services', () => ({
  ensureHeaderRules: async () => {},
  readerHttp: { settle: (): void => {}, dropAll: (): void => {} },
  readerWorkbench: {
    // 目标身份由「后台回传的规范地址」决定：换视频（另一个 id）才解析出另一个主体
    resolve: (input: string) => {
      const id = /BV[0-9A-Za-z]+/.exec(input)?.[0] ?? 'BVunknown';
      return { adapter: {}, target: { kind: 'subject', subject: { platform: 'bilibili', kind: 'video', id } } };
    },
    previewRootsPage: mocks.previewRootsPage,
    previewThread: mocks.previewThread,
    locateComment: mocks.locateComment,
    session: mocks.session,
  },
}));

function makeComment(overrides: Partial<Comment> & { id: string }): Comment {
  return {
    rootId: null,
    parentId: null,
    author: { id: 'u1', name: '阿蓝' },
    text: '',
    createdAt: 0,
    likes: 0,
    replyCount: 0,
    ...overrides,
  };
}

/** 顶层一（带一条楼中楼）、顶层二：首屏两行，全部折叠后一行——高度用例靠它制造「结构性缩高」。 */
const ROOT = makeComment({ id: '1', text: '顶层一', replyCount: 1 });
const REPLY = makeComment({ id: '11', rootId: '1', parentId: '1', text: '楼中楼一' });
const SECOND = makeComment({ id: '2', text: '顶层二' });
/**
 * 第二页：平台按时间**倒序**分页（mode=2），所以后一页整页都比前一页更旧。
 * 用途是钉住「新一页追加在末尾」——按时间升序渲染会把这些行插到更前面去。
 */
const OLDER_ROOT = makeComment({ id: '3', text: '更旧顶层', createdAt: -1000, replyCount: 1 });
const OLDER_REPLY = makeComment({ id: '31', rootId: '3', parentId: '3', text: '更旧回复', createdAt: -1000 });

interface PlannedPage {
  cursor: string | null;
  comments: Comment[];
  next: string | null;
  /** 整条热度序快照回放时平台侧带回的快照时刻。 */
  snapshotAt?: number;
  /** 抓取层提前收尾的原因。 */
  endReason?: string;
}

/** 页面计划：键是游标（首屏是 'start'）。 */
let plan: Map<string, { comments: Comment[]; next: string | null; snapshotAt?: number; endReason?: string }>;
/** 每次取数请求的游标：断言「只取一次」「不跳页」都靠它。 */
let requests: Array<string | null>;
/** 让某个游标第一次取数失败（模拟平台限流）。 */
let failOnce: Set<string | null>;
/** 给某个游标的取数装闸门：放行之前它一直在途，用来观察单飞。 */
let gateCursor: string | null | undefined;
let gatePromise: Promise<void> | null;
let releaseGate: (() => void) | null;
let resizeCallbacks: Array<() => void>;
let ioCallbacks: Array<(entries: Array<{ isIntersecting: boolean }>) => void>;
/** 模拟布局里的「余量」：头像 / 表情落定这类非结构性变化改它。 */
let extraHeight: number;
/** 平台随页带回的「身份限制」（如未登录截断）：按用例设置，默认没有。 */
let pageLimitations: string[];
/** 定位用例观察 `scrollIntoView` 用（happy-dom 不一定实现它，缺就自己装一个）。 */
let scrollSpy: MockInstance;
let post: MockInstance;

enableAutoUnmount(afterEach);

function planPages(pages: PlannedPage[]): void {
  plan = new Map(
    pages.map((page) => [page.cursor ?? 'start', { comments: page.comments, next: page.next, snapshotAt: page.snapshotAt, endReason: page.endReason }]),
  );
}

/** 造一页顶层评论：塞到超过一批（`ROW_PAGE_SIZE = 100`），用来观察「分批铺开 / 到底一次铺开」。 */
function makeRoots(count: number, prefix: string, offset = 0): Comment[] {
  return Array.from({ length: count }, (_, index) =>
    makeComment({ id: `${prefix}${offset + index}`, text: `${prefix} 第 ${offset + index} 条` }),
  );
}

/**
 * 可外部 resolve 的闸门（同 `Promise.withResolvers` 的用法）。
 * 这里不用那个原生静态方法：工程的 `lib` 锁在 ES2023（运行下限 Chrome 116），它属于 ES2024。
 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let settle: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: (value) => settle(value) };
}

function deliverViewport(visibleBottom: number, viewportHeight?: number): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: {
        source: READER_BRIDGE_SOURCE,
        type: READER_VIEWPORT,
        visibleBottom,
        ...(viewportHeight === undefined ? {} : { viewportHeight }),
      },
      origin: 'https://www.bilibili.com',
      source: window,
    }),
  );
}

function fireResize(): void {
  for (const callback of resizeCallbacks) callback();
}

/** 宿主 → 嵌入页：标签页地址变了（后台对 `tabs.onUpdated` 的任何 URL 变化都发这条，含站点自己的 replaceState）。 */
function deliverNavigation(): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { source: READER_BRIDGE_SOURCE, type: READER_NAVIGATION },
      origin: 'https://www.bilibili.com',
      source: window,
    }),
  );
}

/** 宿主 → 嵌入页：把某条评论定位出来（工作台 / 图谱的「在评论区定位」）。 */
function deliverLocate(commentId: string): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { source: READER_BRIDGE_SOURCE, type: READER_LOCATE, commentId },
      origin: 'https://www.bilibili.com',
      source: window,
    }),
  );
}

/** 已渲染行按注释文字归类：断言「谁排在谁前面」时比整段文本稳定。 */
function rowIds(wrapper: VueWrapper): string[] {
  return wrapper.findAll('article.comment-row').map((row) => row.attributes('data-comment-id')!);
}

function rowKinds(wrapper: VueWrapper): string[] {
  return wrapper.findAll('article.comment-row').map((row) => {
    const text = row.text();
    for (const label of ['顶层一', '楼中楼一', '顶层二', '更旧顶层', '更旧回复']) {
      if (text.includes(label)) return label;
    }
    return text.replace(/\s+/g, ' ').slice(0, 8);
  });
}

function fireSentinel(isIntersecting: boolean): void {
  for (const callback of ioCallbacks) callback([{ isIntersecting }]);
}

function postedHeights(): number[] {
  return post.mock.calls
    .map((call) => call[0])
    .filter(isReaderHeightMessage)
    .map((message) => message.height);
}

/** 把微任务链排空：取数 → 量高 → 再评估是一条 async 链，一次 flush 不够。 */
async function settle(rounds = 6): Promise<void> {
  for (let round = 0; round < rounds; round += 1) await flushPromises();
}

beforeEach(() => {
  plan = new Map();
  requests = [];
  failOnce = new Set();
  gateCursor = undefined;
  gatePromise = null;
  releaseGate = null;
  resizeCallbacks = [];
  ioCallbacks = [];
  extraHeight = 1000;
  pageLimitations = [];
  mocks.contextUrl = VIDEO_URL;

  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: async (message: { type: string }) =>
        message.type === EMBEDDED_CONTEXT ? { ok: true, input: mocks.contextUrl } : { ok: true },
      getURL: (path: string) => `chrome-extension://loupe/${path}`,
    },
    storage: {
      local: { set: async () => undefined, get: async () => ({}) },
      // 阅读器挂载时装的是调色板跟随（watchPalette），这里只要监听接口存在
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
    windows: { create: async () => ({}) },
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resizeCallbacks.push(callback);
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
        ioCallbacks.push(callback);
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  // 模拟布局：阅读器高度 = 余量 + 已渲染行数 × 行高（折叠会让行数真的变少）
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const height = this.classList.contains('reader') ? extraHeight + document.querySelectorAll('.comment-row').length * ROW_HEIGHT : 0;
    return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: height, width: 0, height, toJSON: () => ({}) } as DOMRect;
  });
  post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  scrollSpy =
    typeof Element.prototype.scrollIntoView === 'function'
      ? vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
      : vi.fn();
  if (typeof Element.prototype.scrollIntoView !== 'function') {
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value: scrollSpy });
  }

  mocks.previewRootsPage.mockImplementation(
    async (
      _ref: SubjectRef,
      cursor: string | null,
      _options: unknown,
      onProgress: (progress: { phase: 'roots'; fetched: number; declared: number }) => void,
      signal: AbortSignal,
    ): Promise<RootsPage> => {
      requests.push(cursor);
      if (gateCursor !== undefined && gateCursor === cursor && gatePromise !== null) {
        await gatePromise;
        // 与真实取数一致：中断以异常收场，阅读器据此把它当「取消」而不是失败
        if (signal.aborted) throw new Error('aborted');
      }
      if (failOnce.has(cursor)) {
        failOnce.delete(cursor);
        throw new Error('平台限流');
      }
      const page = plan.get(cursor ?? 'start');
      if (page === undefined) throw new Error(`用例没有准备游标 ${String(cursor)} 的页`);
      onProgress({ phase: 'roots', fetched: page.comments.length, declared: 100 });
      return {
        subject: SUBJECT_META,
        comments: page.comments,
        roots: page.comments.filter((comment) => comment.rootId === null),
        next: page.next,
        declared: 100,
        limitations: pageLimitations,
        ...(page.snapshotAt === undefined ? {} : { snapshotAt: page.snapshotAt }),
        ...(page.endReason === undefined ? {} : { endReason: page.endReason }),
      };
    },
  );
  mocks.previewThread.mockResolvedValue({});
  mocks.locateComment.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function open() {
  // 挂进 document：高度用例靠 document.querySelectorAll 数已渲染行，脱离文档就数不到
  const wrapper = mount(EmbeddedComments, { attachTo: document.body });
  await settle();
  return wrapper;
}

describe('嵌入阅读器的取数触发', () => {
  it('首屏取一页；滚到底再取下一页，只追加不重取', async () => {
    planPages([
      { cursor: null, comments: [ROOT, REPLY], next: 'p1' },
      { cursor: 'p1', comments: [SECOND], next: null },
    ]);
    const wrapper = await open();
    expect(requests).toEqual([null]);
    expect(wrapper.findAll('.comment-row')).toHaveLength(2);

    deliverViewport(100_000);
    await settle();

    expect(requests).toEqual([null, 'p1']);
    expect(wrapper.findAll('.comment-row')).toHaveLength(3);
    expect(wrapper.text()).toContain('没有更多评论了');
  });

  it('距底还有一屏就预取：提前量随宿主视口高度走，仍然每页只取一次', async () => {
    planPages([
      { cursor: null, comments: [ROOT, SECOND], next: 'p1' },
      { cursor: 'p1', comments: [OLDER_ROOT], next: null },
    ]);
    const wrapper = await open();
    expect(requests).toEqual([null]);
    // 模拟布局：内容高 1000 + 2×100 = 1200
    // 旧阈值 480 下 visibleBottom=500 不触发；一屏 800 的提前量下就该预取
    deliverViewport(500, 800);
    await settle();

    expect(requests).toEqual([null, 'p1']);
    expect(wrapper.findAll('.comment-row')).toHaveLength(3);
  });

  it('提前量依然是边沿触发：预取一次之后同段到底区不再重复请求', async () => {
    planPages([
      { cursor: null, comments: [ROOT, SECOND], next: 'p1' },
      { cursor: 'p1', comments: [OLDER_ROOT], next: null },
    ]);
    await open();

    deliverViewport(500, 800);
    await settle();
    expect(requests).toEqual([null, 'p1']);

    for (let round = 0; round < 3; round += 1) deliverViewport(500, 800);
    await settle();
    expect(requests).toEqual([null, 'p1']);
  });

  it('抓取层提前收尾时如实报「不完整」并说明原因，不假装到底', async () => {
    planPages([
      {
        cursor: null,
        comments: [ROOT, SECOND],
        next: null,
        endReason: '平台的热度序会话已失效，剩下的评论请点刷新重新拉取',
      },
    ]);
    const wrapper = await open();

    expect(wrapper.text()).toContain('不完整');
    const label = wrapper.get('button.tip-trigger[aria-label^="完整度"]').attributes('aria-label') ?? '';
    expect(label).toContain('会话已失效');
  });

  it('整条热度序快照回放时，完整度气泡说明「这是几分钟前的快照」', async () => {
    const readAt = Date.now() - 20 * 60_000;
    planPages([{ cursor: null, comments: [ROOT, SECOND], next: null, snapshotAt: readAt }]);
    const wrapper = await open();

    const label = wrapper.get('button.tip-trigger[aria-label^="完整度"]').attributes('aria-label') ?? '';
    expect(label).toContain('分钟前读取的快照');
    expect(wrapper.text()).toContain('完整');
  });

  it('到底（next === null）之后，视口消息与哨兵交叉都不再触发请求', async () => {
    planPages([{ cursor: null, comments: [ROOT, REPLY], next: null }]);
    const wrapper = await open();
    expect(requests).toEqual([null]);

    fireSentinel(true);
    deliverViewport(100_000);
    deliverViewport(100_000);
    fireSentinel(false);
    fireSentinel(true);
    await settle();

    expect(requests).toEqual([null]);
    expect(wrapper.text()).toContain('没有更多评论了');
  });

  it('同一段到底区只触发一次：在途期间连来的消息一条都不多发', async () => {
    planPages([
      { cursor: null, comments: [ROOT], next: 'p1' },
      { cursor: 'p1', comments: [SECOND], next: null },
    ]);
    const wrapper = await open();
    expect(requests).toEqual([null]);

    gateCursor = 'p1';
    gatePromise = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    deliverViewport(100_000);
    await settle();
    expect(requests).toEqual([null, 'p1']);

    for (let round = 0; round < 5; round += 1) deliverViewport(100_000);
    fireSentinel(true);
    await settle();
    expect(requests).toEqual([null, 'p1']);

    gateCursor = undefined;
    releaseGate?.();
    await settle();
    expect(requests).toEqual([null, 'p1']);
    expect(wrapper.findAll('.comment-row')).toHaveLength(2);
  });

  it('取下一页失败：留着重试按钮、不自动重试；点重试从失败的那一页继续', async () => {
    planPages([
      { cursor: null, comments: [ROOT], next: 'p1' },
      { cursor: 'p1', comments: [SECOND], next: null },
    ]);
    failOnce.add('p1');
    const wrapper = await open();

    deliverViewport(100_000);
    await settle();
    expect(requests).toEqual([null, 'p1']);
    expect(wrapper.text()).toContain('平台限流');

    deliverViewport(100_000);
    deliverViewport(100_000);
    await settle();
    expect(requests).toEqual([null, 'p1']);

    await wrapper.get('.more button').trigger('click');
    await settle();
    expect(requests).toEqual([null, 'p1', 'p1']);
    expect(wrapper.findAll('.comment-row')).toHaveLength(2);
    expect(wrapper.text()).not.toContain('平台限流');
  });

  it('取消取数：不算失败，也不会立刻自动接着取；重新滚进到底区才继续', async () => {
    planPages([
      { cursor: null, comments: [ROOT], next: 'p1' },
      { cursor: 'p1', comments: [SECOND], next: 'p2' },
      { cursor: 'p2', comments: [REPLY], next: null },
    ]);
    const wrapper = await open();

    gateCursor = 'p1';
    gatePromise = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    deliverViewport(100_000);
    await settle();
    expect(requests).toEqual([null, 'p1']);

    await wrapper.get('button[title="取消抓取"]').trigger('click');
    gateCursor = undefined;
    releaseGate?.();
    await settle();

    // 中断不是失败：没有错误、也没有新请求（人还停在到底区里）
    expect(requests).toEqual([null, 'p1']);
    expect(wrapper.text()).not.toContain('加载失败');
    expect(wrapper.findAll('.comment-row')).toHaveLength(1);

    // 离开到底区再回来：闸门重新武装。被取消的那一页没落定，游标不动，所以先重取同一页（不跳页），
    // 落定后仍在到底区，于是继续取下一页
    deliverViewport(0);
    deliverViewport(100_000);
    await settle();
    expect(requests).toEqual([null, 'p1', 'p1', 'p2']);
    expect(wrapper.findAll('.comment-row')).toHaveLength(3);
  });
});

describe('嵌入阅读器的高度上报', () => {
  it('只增不减：非结构性回落不上报，折叠这类结构性缩高才上报更小的值', async () => {
    planPages([{ cursor: null, comments: [ROOT, REPLY], next: null }]);
    const wrapper = await open();

    // 首帧（还没有行）+ 首屏两行
    expect(postedHeights()).toEqual([1000, 1200]);

    // 头像 / 表情落定让内容回落：不是内容变少，不上报更小的值
    extraHeight = 800;
    fireResize();
    await settle();
    expect(postedHeights()).toEqual([1000, 1200]);

    // 折叠是结构性缩高（两行 → 一行）：允许上报更小的值
    await wrapper.get('button[title="全部折叠"]').trigger('click');
    await settle();
    expect(postedHeights()).toEqual([1000, 1200, 900]);
  });

  it('同一个值不重复上报', async () => {
    planPages([{ cursor: null, comments: [ROOT, REPLY], next: null }]);
    await open();
    expect(postedHeights()).toEqual([1000, 1200]);

    fireResize();
    fireResize();
    await settle();

    expect(postedHeights()).toEqual([1000, 1200]);
  });
});

describe('嵌入阅读器的顶层顺序（新一页只追加在末尾）', () => {
  it('平台按时间倒序分页：新一页的行接在已渲染行之后，旧行一个都不动', async () => {
    planPages([
      { cursor: null, comments: [ROOT, REPLY], next: 'p1' },
      { cursor: 'p1', comments: [OLDER_ROOT, OLDER_REPLY], next: null },
    ]);
    const wrapper = await open();
    expect(rowKinds(wrapper)).toEqual(['顶层一', '楼中楼一']);

    deliverViewport(100_000);
    await settle();

    // 第二页整页更旧，必须追加在末尾。改成按 createdAt 升序渲染，它就会插到这两行之前
    // （真机实测：每取一页把已读内容整体下推 ~3300px，视口不动、看到的就是刚看过的位置）
    expect(rowKinds(wrapper)).toEqual(['顶层一', '楼中楼一', '更旧顶层', '更旧回复']);
  });
});

describe('渐进渲染的收尾（到底之后不再分批）', () => {
  it('首屏就是最后一页：剩下的行一次铺开，不留「继续显示」', async () => {
    planPages([{ cursor: null, comments: makeRoots(120, 'a'), next: null }]);
    const wrapper = await open();

    expect(wrapper.findAll('article.comment-row')).toHaveLength(120);
    expect(wrapper.text()).not.toContain('继续显示');
    expect(wrapper.text()).toContain('没有更多评论了');
  });

  it('取到最后一页时自动铺开剩余的行，不需要手动点一次', async () => {
    planPages([
      { cursor: null, comments: makeRoots(60, 'a'), next: 'p1' },
      { cursor: 'p1', comments: makeRoots(60, 'b', 60), next: null },
    ]);
    const wrapper = await open();
    expect(wrapper.findAll('article.comment-row')).toHaveLength(60);

    deliverViewport(100_000);
    await settle();

    expect(requests).toEqual([null, 'p1']);
    expect(wrapper.findAll('article.comment-row')).toHaveLength(120);
    expect(wrapper.text()).not.toContain('继续显示');
    expect(wrapper.text()).toContain('没有更多评论了');
  });

  it('到底之后展开一大棵树：多出来的行照旧自动铺开，渲染窗口不回撤', async () => {
    const big = makeComment({ id: 'big', text: '大树', replyCount: BIG_REPLIES });
    // 平台内联预览就是这棵树的前三条回复（同一批 id），展开后由完整回复替换，不额外增行
    const previews = [0, 1, 2].map((n) =>
      makeComment({ id: `big-r${n}`, rootId: 'big', parentId: 'big', text: `回复 ${n}` }),
    );
    mocks.previewThread.mockResolvedValue({
      snapshot: {
        comments: [
          big,
          ...Array.from({ length: BIG_REPLIES }, (_, n) =>
            makeComment({ id: `big-r${n}`, rootId: 'big', parentId: 'big', text: `回复 ${n}` }),
          ),
        ],
      },
    });
    planPages([{ cursor: null, comments: [big, ...previews], next: null }]);
    const wrapper = await open();
    expect(wrapper.findAll('article.comment-row')).toHaveLength(1 + previews.length);

    // 折叠再展开：上限若被「总数临时变小」收回去，展开后已铺开的窗口就白铺了
    await wrapper.get('button[title="收起这条评论的回复"]').trigger('click');
    await settle();
    expect(wrapper.findAll('article.comment-row')).toHaveLength(1);

    await wrapper.get('button[title="展开这条评论的回复"]').trigger('click');
    await settle(10);
    expect(mocks.previewThread).toHaveBeenCalledTimes(1);
    // 折叠期间「总数」一度只有 1 行，上限若跟着收回去，这里就会只剩几行（已铺开的窗口白铺）
    expect(wrapper.findAll('article.comment-row')).toHaveLength(ROW_PAGE_SIZE);

    // 到底态下滚到已渲染底部：剩下的行按批自动铺开（旧行为：hasNext 为假 ⇒ 停在「继续显示 N 条」）
    for (let round = 0; round < 3; round += 1) {
      deliverViewport(100_000);
      await settle(10);
    }
    expect(wrapper.findAll('article.comment-row')).toHaveLength(1 + BIG_REPLIES);
    expect(wrapper.text()).not.toContain('继续显示');
  });
});
describe('加载指示与完整度说明', () => {
  it('加载指示是有尺寸的内联 SVG，不再是不可见的空占位', async () => {
    planPages([{ cursor: null, comments: [ROOT], next: null }]);
    // 卡住首屏取数：停在「抓取中」那一帧上观察指示器
    gateCursor = null;
    gatePromise = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const wrapper = mount(EmbeddedComments, { attachTo: document.body });
    await settle();

    expect(wrapper.find('span.spinner').exists()).toBe(false);
    expect(wrapper.find('p.status svg.spinner').exists()).toBe(true);

    gateCursor = undefined;
    releaseGate?.();
    await settle();
  });

  it('展开回复时头部指示是有可访问名的 SVG 图标（不再占用一行文字）', async () => {
    const root = makeComment({ id: 'r1', text: '带回复的评论', replyCount: 5 });
    const preview = makeComment({ id: 'r1-p1', rootId: 'r1', parentId: 'r1', text: '预览回复' });
    planPages([{ cursor: null, comments: [root, preview], next: null }]);
    const threadGate = deferred<{ snapshot: { comments: Comment[] } }>();
    mocks.previewThread.mockImplementation(() => threadGate.promise);
    const wrapper = await open();

    await wrapper.get('button[title="收起这条评论的回复"]').trigger('click');
    await settle();
    await wrapper.get('button[title="展开这条评论的回复"]').trigger('click');
    await settle();

    const icon = wrapper.get('header svg.spinner[role="img"]');
    expect(icon.attributes('aria-label')).toBe('正在加载这条评论的回复');
    expect(icon.attributes('title')).toBe('正在加载这条评论的回复');

    threadGate.resolve({ snapshot: { comments: [root, preview] } });
    await settle();
    expect(wrapper.findAll('header svg.spinner')).toHaveLength(0);
  });

  it('未登录被平台截断时，完整度说明里写清「为什么只有这几条」', async () => {
    const limitation = '未登录：顶层评论可能被平台截断（有时仅前 3 条热评），评论树不受影响';
    pageLimitations = [limitation];
    // 平台说「到底」但只给了 2 条，而它自己声明有 100 条
    planPages([{ cursor: null, comments: [ROOT, SECOND], next: null }]);
    const wrapper = await open();

    const label = wrapper.get('button.tip-trigger[aria-label^="完整度"]').attributes('aria-label') ?? '';
    expect(label).toContain(limitation);
    expect(label).toContain('平台声明 100 条');
    expect(label).not.toContain('已全部取回');
    expect(wrapper.text()).toContain('不完整');
  });

  it('平台 412 限流：摆出倒计时并自动重试，而不是让人对着「加载失败」反复手点', async () => {
    vi.useFakeTimers();
    try {
      planPages([{ cursor: null, comments: [ROOT, SECOND], next: null }]);
      mocks.previewRootsPage.mockRejectedValueOnce(
        new PlatformError('rate-limited', '平台限额：HTTP 412', { code: 412 }),
      );
      const wrapper = mount(EmbeddedComments, { attachTo: document.body });
      await settle();

      // 首屏失败但限流有专门的文案：说清「不是登录失效」，并给出自动重试时间
      expect(wrapper.text()).toContain('平台限流');
      expect(wrapper.text()).toContain('秒后自动重试');
      expect(wrapper.text()).toContain('不是登录失效');
      expect(wrapper.text()).not.toContain('加载失败');

      // 到点自动重试：不需要任何点击，行自己出来
      await vi.advanceTimersByTimeAsync(61_000);
      await settle();
      expect(rowKinds(wrapper)).toEqual(['顶层一', '顶层二']);
      expect(wrapper.text()).not.toContain('平台限流');
    } finally {
      vi.useRealTimers();
    }
  });

  it('顶层读到底就是完整：平台声明数含楼中楼的全部回复，不能拿它逐条对账', async () => {
    // 实测形态：64 条根评论、根评论的直接回复合计 44（声明 191 = 根 + 全部层级的回复）
    planPages([
      {
        cursor: null,
        comments: [makeComment({ ...ROOT, replyCount: 22 }), makeComment({ ...SECOND, replyCount: 22 })],
        next: null,
      },
    ]);
    const wrapper = await open();

    const label = wrapper.get('button.tip-trigger[aria-label^="完整度"]').attributes('aria-label') ?? '';
    expect(label).toContain('平台声明 100 条评论（含楼中楼的全部回复）');
    expect(label).toContain('顶层 2 条根评论已全部取回');
    expect(wrapper.text()).toContain('完整');
    expect(wrapper.text()).not.toContain('不完整');
  });

  it('登录态读全了就不冒充「不完整」：身份限制不写进说明', async () => {
    pageLimitations = ['未登录：顶层评论可能被平台截断（有时仅前 3 条热评），评论树不受影响'];
    planPages([{ cursor: null, comments: makeRoots(100, 'a'), next: null }]);
    const wrapper = await open();

    const label = wrapper.get('button.tip-trigger[aria-label^="完整度"]').attributes('aria-label') ?? '';
    expect(label).toContain('未发现缺失');
    expect(label).not.toContain('未登录');
    expect(wrapper.text()).toContain('完整');
  });
});
describe('首屏骨架屏', () => {
  it('首屏取数未落定时铺骨架，第一页落定后卸载并换成真实评论行', async () => {
    planPages([{ cursor: null, comments: [ROOT, SECOND], next: null }]);
    // 挂住首屏那一页：停在还没有任何评论的那一帧上
    gateCursor = null;
    gatePromise = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const wrapper = mount(EmbeddedComments, { attachTo: document.body });
    await settle();

    expect(wrapper.find('.skeleton-rows').exists()).toBe(true);
    expect(wrapper.find('.skeleton-rows').attributes('aria-hidden')).toBe('true');
    expect(wrapper.findAll('.skeleton-shimmer-box').length).toBeGreaterThan(0);
    expect(wrapper.findAll('article.comment-row')).toHaveLength(0);

    gateCursor = undefined;
    releaseGate?.();
    await settle();

    expect(wrapper.find('.skeleton-rows').exists()).toBe(false);
    expect(wrapper.findAll('.skeleton-shimmer-box')).toHaveLength(0);
    expect(rowKinds(wrapper)).toEqual(['顶层一', '顶层二']);
  });
});
describe('目标身份：换目标才重置', () => {
  it('同一目标的 URL 抖动不重置：已读的页留着，不重取第一页，也不上报缩高', async () => {
    planPages([
      { cursor: null, comments: [ROOT, REPLY], next: 'p1' },
      { cursor: 'p1', comments: [SECOND], next: null },
    ]);
    const wrapper = await open();
    deliverViewport(100_000);
    await settle();
    expect(requests).toEqual([null, 'p1']);
    const heights = postedHeights();

    // B 站自己在同一条视频上写 URL（?spm_id_from / ?vd_source / #锚点）：身份没变
    mocks.contextUrl = `${VIDEO_URL}?spm_id_from=333.999.0.0`;
    deliverNavigation();
    await settle();

    expect(requests).toEqual([null, 'p1']);
    expect(rowKinds(wrapper)).toEqual(['顶层一', '楼中楼一', '顶层二']);
    expect(postedHeights()).toEqual(heights);
  });

  it('读不到规范地址时什么都不做：不猜、也不清空已读的页', async () => {
    planPages([{ cursor: null, comments: [ROOT, REPLY], next: 'p1' }]);
    const wrapper = await open();
    deliverViewport(100_000);
    await settle();
    expect(requests).toEqual([null, 'p1']);

    mocks.contextUrl = '';
    deliverNavigation();
    await settle();

    expect(requests).toEqual([null, 'p1']);
    expect(rowKinds(wrapper)).toEqual(['顶层一', '楼中楼一']);
  });

  it('真的换视频才重置：列表清空、游标回起点重取第一页', async () => {
    planPages([
      { cursor: null, comments: [ROOT, REPLY], next: 'p1' },
      { cursor: 'p1', comments: [SECOND], next: null },
    ]);
    await open();
    deliverViewport(100_000);
    await settle();
    expect(requests).toEqual([null, 'p1']);

    mocks.contextUrl = 'https://www.bilibili.com/video/BV1otherp6EEGu/';
    deliverNavigation();
    await settle();

    expect(requests).toEqual([null, 'p1', null]);
    // 换目标是结构性缩高事件（旧内容已经不在 DOM 里）：允许上报更小的值，高度下界不再拦住它
    expect(postedHeights().slice(-2)).toEqual([1000, 1200]);
  });
});

describe('作者入口的桥消息', () => {
  it('悬停作者：把 mid 与头像在嵌入文档里的位置发给宿主；离开则请宿主收起', async () => {
    const author = { id: '703148042', name: '阿蓝', profileUrl: 'https://space.bilibili.com/703148042' };
    planPages([{ cursor: null, comments: [makeComment({ id: '1', text: '顶层一', author })], next: null }]);
    const wrapper = await open();

    const avatar = wrapper.get('a.avatar');
    vi.spyOn(avatar.element, 'getBoundingClientRect').mockReturnValue({
      left: 3, top: 4, width: 5, height: 6, right: 8, bottom: 10, x: 3, y: 4, toJSON: () => ({}),
    } as DOMRect);

    await avatar.trigger('mouseenter');
    const cardMessages = () => post.mock.calls.map((call) => call[0]).filter((message) => (message as { type?: string }).type === READER_USER_CARD);
    expect(cardMessages()).toEqual([
      { source: READER_BRIDGE_SOURCE, type: READER_USER_CARD, mid: '703148042', rect: { left: 3, top: 4, width: 5, height: 6 } },
    ]);

    await avatar.trigger('mouseleave');
    // 收起也带 mid：迟到的收起不能关掉已经换到别人身上的卡片
    expect(cardMessages().at(-1)).toEqual({ source: READER_BRIDGE_SOURCE, type: READER_USER_CARD, mid: '703148042', rect: null });
  });
});

/**
 * 「全部折叠」是一次意图，不是一次性的动作：新取回的页也要跟着折叠（旧写法只管当时森林里的 id，
 * 于是加载新评论后它们又是展开的）。
 */
describe('全部折叠的粘滞性与图谱入口', () => {
  it('「全部折叠」之后新取回的一页也是折叠的，直到点「全部展开」', async () => {
    planPages([
      { cursor: null, comments: [ROOT, REPLY, SECOND], next: 'p1' },
      { cursor: 'p1', comments: [OLDER_ROOT, OLDER_REPLY], next: null },
    ]);
    const wrapper = await open();
    expect(rowKinds(wrapper)).toEqual(['顶层一', '楼中楼一', '顶层二']);

    const foldAllButton = wrapper.findAll('button').find((button) => button.attributes('title') === '全部折叠');
    expect(foldAllButton).toBeDefined();
    await foldAllButton!.trigger('click');
    await settle();
    expect(rowKinds(wrapper)).toEqual(['顶层一', '顶层二']);

    // 加载下一页：新根评论「更旧顶层」自己出来了，它的楼中楼仍折叠着
    deliverViewport(100_000);
    await settle();
    expect(rowKinds(wrapper)).toEqual(['顶层一', '顶层二', '更旧顶层']);

    const expandAllButton = wrapper.findAll('button').find((button) => button.attributes('title') === '全部展开');
    await expandAllButton!.trigger('click');
    await settle();
    expect(rowKinds(wrapper)).toEqual(['顶层一', '楼中楼一', '顶层二', '更旧顶层', '更旧回复']);
  });

  it('图谱入口总是渲染：小树、叶子、楼中楼一视同仁，不按评论量分档', async () => {
    planPages([{ cursor: null, comments: [ROOT, REPLY, SECOND], next: null }]);
    const wrapper = await open();
    expect(rowKinds(wrapper)).toEqual(['顶层一', '楼中楼一', '顶层二']);
    // 每一行都有自己的入口：size 2 的顶层一、size 1 的叶子、楼中楼没有区别
    expect(wrapper.findAll('article.comment-row').every((row) => row.find('.analyze').exists())).toBe(true);
    expect(wrapper.findAll('.analyze')).toHaveLength(3);

    // 收起楼中楼只是少渲染一行，入口的有无不跟着行数走
    const fold = wrapper.findAll('button').find((button) => button.text().includes('收起回复'));
    expect(fold).toBeDefined();
    await fold!.trigger('click');
    await settle();
    expect(rowKinds(wrapper)).toEqual(['顶层一', '顶层二']);
    expect(wrapper.findAll('.analyze')).toHaveLength(2);
  });
});

/**
 *   1) 目标被祖先的折叠藏起来 → 先展开祖先链；落在渲染上限之外 → 先抬上限；然后才谈滚动与闪烁；
 *   2) 不在已读范围内就照实说，绝不凭空造行、也不悄悄滚到别的行；
 *   3) 首屏还没落定就到（内容脚本在 READER_READY 之后补发）→ 挂起，第一页到了再执行。
 */
describe('工作台 / 图谱 → 评论区定位', () => {
  it('定位已读评论：展开祖先折叠、滚动到中间并闪烁', async () => {
    planPages([{ cursor: null, comments: [ROOT, REPLY, SECOND], next: null }]);
    const wrapper = await open();

    const fold = wrapper.findAll('button').find((button) => button.text().includes('收起回复'));
    expect(fold).toBeDefined();
    await fold!.trigger('click');
    await settle();
    expect(rowKinds(wrapper)).toEqual(['顶层一', '顶层二']);

    deliverLocate('11');
    await settle();

    expect(rowKinds(wrapper)).toEqual(['顶层一', '楼中楼一', '顶层二']);
    const classes = wrapper
      .findAll('article.comment-row')
      .find((row) => row.attributes('data-comment-id') === '11')!
      .classes();
    expect(classes).toContain('selected');
    expect(classes).toContain('flash-highlight');
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
  });

  it('定位渲染上限之外的行：先把上限抬到它那一行', async () => {
    // 还有下一页 ⇒ 渲染保持分批（`rowCap = ROW_PAGE_SIZE`），目标落在窗口之外。
    // id 用纯数字：桥消息的守卫按平台约定只认纯数字评论 id（`messages.ts#isCommentId`）。
    planPages([{ cursor: null, comments: makeRoots(150, '1'), next: 'p1' }]);
    const wrapper = await open();
    expect(wrapper.findAll('.comment-row')).toHaveLength(ROW_PAGE_SIZE);

    deliverLocate('1140');
    await settle();

    expect(wrapper.findAll('.comment-row')).toHaveLength(141);
    const classes = wrapper
      .findAll('article.comment-row')
      .find((row) => row.attributes('data-comment-id') === '1140')!
      .classes();
    expect(classes).toContain('flash-highlight');
  });

  it('定位不在已读范围内的评论：取回它的根评论块钉在流上方，流序不动', async () => {
    const locatedRoot = makeComment({ id: '999990', text: '定位根', replyCount: 1 });
    const locatedReply = makeComment({ id: '999991', rootId: '999990', parentId: '999990', text: '定位楼中楼' });
    mocks.locateComment.mockResolvedValue({
      subject: SUBJECT_META,
      root: locatedRoot,
      comments: [locatedRoot, locatedReply],
      source: 'network',
    });
    planPages([{ cursor: null, comments: [ROOT, SECOND], next: null }]);
    const wrapper = await open();

    deliverLocate('999991');
    await settle();

    expect(mocks.locateComment).toHaveBeenCalledTimes(1);
    // 定位块出现在流上方：目标行选中并闪烁，主流的行序一个都不动
    const block = wrapper.get('.located-block');
    expect(block.text()).toContain('定位到的评论');
    const blockRows = block.findAll('article.comment-row');
    expect(blockRows).toHaveLength(2);
    const target = blockRows.find((row) => row.attributes('data-comment-id') === '999991')!;
    expect(target.classes()).toContain('selected');
    expect(target.classes()).toContain('flash-highlight');
    expect(rowKinds(wrapper).slice(-2)).toEqual(['顶层一', '顶层二']);
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });

    // 关掉定位块：结构性缩高（允许上报更小的值）
    const before = postedHeights();
    await block.get('button[title="关闭定位"]').trigger('click');
    await settle();
    expect(wrapper.find('.located-block').exists()).toBe(false);
    expect(postedHeights().at(-1)!).toBeLessThan(before.at(-1)!);
  });

  it('目标的根已在流里：评论块并进该根的回复，不钉定位块，流序不变', async () => {
    // ROOT 在流里但楼中楼 c9 还没加载：seek 取回的是「ROOT 根评论块」
    const c9 = makeComment({ id: '99', rootId: '1', parentId: '1', text: '定位的楼中楼' });
    mocks.locateComment.mockResolvedValue({
      subject: SUBJECT_META,
      root: ROOT,
      comments: [ROOT, REPLY, c9],
      source: 'network',
    });
    planPages([{ cursor: null, comments: [ROOT, SECOND], next: null }]);
    const wrapper = await open();

    deliverLocate('99');
    await settle();

    expect(mocks.locateComment).toHaveBeenCalledTimes(1);
    // 不钉定位块：c9 作为 ROOT 的楼中楼出现在主流里并被选中，流顶层顺序不动
    expect(wrapper.find('.located-block').exists()).toBe(false);
    const row = wrapper
      .findAll('article.comment-row')
      .find((el) => el.attributes('data-comment-id') === '99')!;
    expect(row.classes()).toContain('selected');
    expect(row.classes()).toContain('flash-highlight');
    // c9 作为 ROOT 的楼中楼出现在主流里，顶层顺序（1 → 2）不变
    expect(wrapper.findAll('article.comment-row').map((el) => el.attributes('data-comment-id'))).toEqual(['1', '11', '99', '2']);
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
  });

  it('定位在流里的评论不走 seek：仍用原路径（不发 locateComment）', async () => {
    planPages([{ cursor: null, comments: [ROOT, REPLY], next: null }]);
    const wrapper = await open();

    deliverLocate('11');
    await settle();

    expect(mocks.locateComment).not.toHaveBeenCalled();
    expect(wrapper.find('.located-block').exists()).toBe(false);
  });

  it('定位的评论不存在：不发 locateComment 时才提示；seek 返回 not-found 照实说', async () => {
    const { PlatformError } = await import('@/core/errors');
    mocks.locateComment.mockRejectedValue(new PlatformError('not-found', '评论不存在或已删除'));
    planPages([{ cursor: null, comments: [ROOT], next: null }]);
    const wrapper = await open();

    deliverLocate('999999');
    await settle();

    expect(wrapper.text()).toContain('这条评论不存在或已被删除');
    expect(wrapper.find('.located-block').exists()).toBe(false);
    expect(wrapper.findAll('.comment-row')).toHaveLength(1);
  });

  it('首屏落定前到的定位：挂起，第一页到了再执行', async () => {
    planPages([{ cursor: null, comments: [ROOT, REPLY], next: null }]);
    const gate = deferred<void>();
    gateCursor = null;
    gatePromise = gate.promise;
    const wrapper = mount(EmbeddedComments, { attachTo: document.body });
    await flushPromises();

    deliverLocate('11');
    await settle();
    expect(scrollSpy).not.toHaveBeenCalled();

    gateCursor = undefined;
    gate.resolve();
    await settle();

    expect(rowKinds(wrapper)).toEqual(['顶层一', '楼中楼一']);
    const classes = wrapper
      .findAll('article.comment-row')
      .find((row) => row.attributes('data-comment-id') === '11')!
      .classes();
    expect(classes).toContain('flash-highlight');
  });
});

describe('顶层排序切换（最热 | 最新）', () => {
  const HOT_A = makeComment({ id: 'h1', text: '热评一' });
  const HOT_B = makeComment({ id: 'h2', text: '热评二' });
  const TIME_A = makeComment({ id: 't1', text: '新评一' });
  const TIME_B = makeComment({ id: 't2', text: '新评二' });
  /** 按 order 分数据的假分页：plan 键带 'hot|' / 'time|' 前缀。 */
  function planByOrder(pages: Array<{ order: string; cursor: string | null; comments: Comment[]; next: string | null }>): void {
    const byOrder = new Map(pages.map((p) => [`${p.order}|${p.cursor ?? 'start'}`, { comments: p.comments, next: p.next }]));
    mocks.previewRootsPage.mockImplementation(
      async (_ref: SubjectRef, cursor: string | null, options: { order?: string }, onProgress: (p: { phase: string; fetched: number; declared: number }) => void) => {
        const page = byOrder.get(`${options.order ?? 'time'}|${cursor ?? 'start'}`);
        if (page === undefined) throw new Error(`用例没准备 ${options.order}/${String(cursor)} 的页`);
        onProgress({ phase: 'roots', fetched: page.comments.length, declared: 100 });
        return {
          subject: SUBJECT_META,
          comments: page.comments,
          roots: page.comments.filter((c) => c.rootId === null),
          next: page.next,
          declared: 100,
          limitations: [],
        };
      },
    );
  }

  it('首屏默认按最热取数', async () => {
    planPages([{ cursor: null, comments: [HOT_A, HOT_B], next: null }]);
    await open();
    expect(mocks.previewRootsPage.mock.calls[0]![2]).toMatchObject({ order: 'hot' });
    expect(mocks.previewRootsPage.mock.calls[0]![1]).toBeNull();
  });

  it('点「最新」：以 time 序从游标起点重取，旧序行整批替换，aria-pressed 更新', async () => {
    planByOrder([
      { order: 'hot', cursor: null, comments: [HOT_A, HOT_B], next: null },
      { order: 'time', cursor: null, comments: [TIME_A, TIME_B], next: null },
    ]);
    const wrapper = await open();
    expect(rowIds(wrapper)).toEqual(['h1', 'h2']);

    await wrapper.findAll('.sort-opt')[1]!.trigger('click');
    await settle();

    const calls = mocks.previewRootsPage.mock.calls;
    expect(calls.at(-1)![2]).toMatchObject({ order: 'time' });
    expect(calls.at(-1)![1]).toBeNull(); // 从新序的起点开始
    expect(rowIds(wrapper)).toEqual(['t1', 't2']);
    const opts = wrapper.findAll('.sort-opt');
    expect(opts[0]!.attributes('aria-pressed')).toBe('false');
    expect(opts[1]!.attributes('aria-pressed')).toBe('true');
  });

  it('旧序的在途页晚到也不会并进新序的流', async () => {
    const HOT_C = makeComment({ id: 'h3', text: '迟到的热评' });
    planByOrder([
      { order: 'hot', cursor: null, comments: [HOT_A, HOT_B], next: 'p1' },
      { order: 'hot', cursor: 'p1', comments: [HOT_C], next: null },
      { order: 'time', cursor: null, comments: [TIME_A], next: null },
    ]);
    const wrapper = await open();
    expect(rowIds(wrapper)).toEqual(['h1', 'h2']);

    // 旧序第二页被闸门卡在在途：切序发生在这时
    const gate = deferred<void>();
    mocks.previewRootsPage.mockImplementationOnce(async (_r, _c, _o, onProgress, signal) => {
      await gate.promise;
      if (signal.aborted) throw new Error('aborted');
      onProgress({ phase: 'roots', fetched: 1, declared: 100 });
      return { subject: SUBJECT_META, comments: [HOT_C], roots: [HOT_C], next: null, declared: 100, limitations: [] };
    });
    deliverViewport(100_000);
    await settle(2);

    await wrapper.findAll('.sort-opt')[1]!.trigger('click'); // abort 旧序 + reset + time 取数
    gate.resolve(); // 旧序第二页此刻才「回来」
    await settle();

    expect(rowIds(wrapper)).toEqual(['t1']); // 迟到的热评页绝不并入
  });

  it('热 → 新 → 热：第三次调用仍是 hot 序且游标归零', async () => {
    planByOrder([
      { order: 'hot', cursor: null, comments: [HOT_A], next: null },
      { order: 'time', cursor: null, comments: [TIME_A], next: null },
    ]);
    const wrapper = await open();
    const buttons = () => wrapper.findAll('.sort-opt');
    await buttons()[1]!.trigger('click');
    await settle();
    await buttons()[0]!.trigger('click');
    await settle();
    const calls = mocks.previewRootsPage.mock.calls;
    expect(calls.at(-1)![2]).toMatchObject({ order: 'hot' });
    expect(calls.at(-1)![1]).toBeNull();
    expect(rowIds(wrapper)).toEqual(['h1']);
  });

  it('切换后「刷新」按钮按当前序重放', async () => {
    planByOrder([
      { order: 'hot', cursor: null, comments: [HOT_A], next: null },
      { order: 'time', cursor: null, comments: [TIME_A], next: null },
    ]);
    const wrapper = await open();
    await wrapper.findAll('.sort-opt')[1]!.trigger('click');
    await settle();
    mocks.previewRootsPage.mockClear();
    await wrapper.get('button[aria-label="刷新"]').trigger('click');
    await settle();
    const calls = mocks.previewRootsPage.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call[2]).toMatchObject({ order: 'time' });
    expect(calls[0]![1]).toBeNull();
  });
});
describe('默认排序与删除', () => {
  it('存储默认序 time → 首屏按 time 取数；缺省仍是 hot', async () => {
    planPages([{ cursor: null, comments: [ROOT], next: null }]);
    const getSpy = vi.spyOn(chrome.storage.local, 'get').mockImplementation(async () => ({ 'loupe.reader.defaultOrder': 'time' }));
    const w1 = await open();
    expect(mocks.previewRootsPage.mock.calls.at(-1)![2]).toMatchObject({ order: 'time' });
    w1.unmount();
    getSpy.mockRestore();
    plan = new Map(); planPages([{ cursor: null, comments: [ROOT], next: null }]);
    await open();
    expect(mocks.previewRootsPage.mock.calls.at(-1)![2]).toMatchObject({ order: 'hot' });
  });
  it('删除成功：该评论连同子树从视图剔除', async () => {
    planPages([{ cursor: null, comments: [ROOT, REPLY, SECOND], next: null }]);
    const wrapper = await open();
    expect(wrapper.findAll('[data-comment-id]')).toHaveLength(3);
    const row = wrapper.findAllComponents(PageCommentRow).find((r) => r.props('row').id === '1');
    row!.vm.$emit('delete-comment', '1');
    await settle();
    const writes = post.mock.calls.map((c) => c[0]).filter((m) => m?.type === 'loupe:reader-write');
    window.dispatchEvent(new MessageEvent('message', { data: { source: READER_BRIDGE_SOURCE, type: 'loupe:reader-write-result', requestId: writes.at(-1).requestId, ok: true }, origin: 'https://www.bilibili.com', source: window }));
    await settle();
    expect(wrapper.findAll('[data-comment-id]').map((e) => e.attributes('data-comment-id'))).toEqual(['2']);
  });
});
