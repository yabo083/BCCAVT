// @vitest-environment happy-dom
/**
 * 嵌入阅读器的写链路：点按钮 → 桥请求 → 结果回来 → 乐观 / 确认更新。
 *
 * 这里挂真实组件、只桩掉服务层（阅读器的读取分支与读客户端）与内容脚本两端：请求从窗口消息里抓，
 * 结果由测试自己扮内容脚本投回。要盯住的是三件事——
 *   1) 发出去的意图能过桥守卫，字段与 op 对得上；
 *   2) 点赞乐观切换、失败回滚并提示；
 *   3) 回复 / 发表成功把返回的评论插进树（多级关系由 rootId/parentId 决定），失败留着草稿。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import EmbeddedComments from '@/ui/EmbeddedComments.vue';
import {
  EMBEDDED_CONTEXT,
  READER_BRIDGE_SOURCE,
  READER_WRITE_RESULT,
  isReaderWriteRequest,
} from '@/extension/page-comments';
import type { ReaderWriteRequest, ReaderWriteResult } from '@/extension/page-comments';
import { buildForest } from '@/core/tree';
import { SNAPSHOT_SCHEMA } from '@/core/report';
import type { AnalysisResult, RootsPage, SubjectReport } from '@/core/report';
import type { Comment, SubjectRef } from '@/core/model';

const SUBJECT: SubjectRef = { platform: 'bilibili', kind: 'video', id: 'BV1UbpP6EEGu' };
const VIDEO_URL = `https://www.bilibili.com/video/${SUBJECT.id}/`;

const mocks = vi.hoisted(() => ({ previewRootsPage: vi.fn(), previewThread: vi.fn() }));

vi.mock('@/ui/services', () => ({
  ensureHeaderRules: async () => {},
  // 阅读器走桥接读取分支：这条链路只测写，读客户端只要求「存在且可收结果」
  readerHttp: { settle: (): void => {}, dropAll: (): void => {} },
  readerWorkbench: {
    resolve: () => ({ adapter: {}, target: { kind: 'subject', subject: SUBJECT } }),
    previewRootsPage: mocks.previewRootsPage,
    previewThread: mocks.previewThread,
  },
}));

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: '1',
    rootId: null,
    parentId: null,
    author: { id: 'u1', name: '阿蓝' },
    text: '正文',
    createdAt: 1_700_000_000_000,
    likes: 0,
    replyCount: 0,
    ...overrides,
  };
}

/** 顶层一（带一条楼中楼）、顶层二；楼中楼已经抓在快照里，因此不该再按需抓树。 */
const COMMENTS: Comment[] = [
  makeComment({ id: '1', text: '顶层一', likes: 12, replyCount: 1 }),
  makeComment({ id: '2', text: '顶层二', createdAt: 1_700_000_060_000 }),
  makeComment({ id: '11', rootId: '1', parentId: '1', text: '楼中楼一', createdAt: 1_700_000_030_000 }),
];

/** 抓取结果的桩：这条链路只读 snapshot 与森林，report 用空壳顶掉。 */
function analysisOf(comments: Comment[]): AnalysisResult<SubjectReport> {
  return {
    snapshot: {
      schema: SNAPSHOT_SCHEMA,
      id: 'snap-1',
      target: { kind: 'subject', subject: SUBJECT },
      subject: { ref: SUBJECT, title: '测试视频', url: VIDEO_URL, locator: {} },
      comments,
      fetchedAt: 0,
      auth: 'anonymous',
      completeness: { fetched: comments.length, truncated: false, reasons: [] },
      caps: { maxRoots: 20, maxRepliesPerThread: 3 },
      fetchStats: { requests: 1, cacheHits: 0, retries: 0, durationMs: 1 },
    },
    forest: buildForest(comments),
    // 报告字段这条链路用不到（阅读器只读 snapshot 与森林）
    report: {} as SubjectReport,
    fromSnapshot: false,
  };
}

/** 一页顶层评论的桩：next 为 null = 平台说到头了，阅读器不会再取下一页。 */
function rootsPageOf(comments: Comment[]): RootsPage {
  return {
    subject: { ref: SUBJECT, title: '测试视频', url: VIDEO_URL, locator: {} },
    comments,
    roots: comments.filter((comment) => comment.rootId === null),
    next: null,
    declared: comments.length,
  };
}

enableAutoUnmount(afterEach);

let post: MockInstance;

beforeEach(() => {
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: async (message: { type: string }) =>
        message.type === EMBEDDED_CONTEXT ? { ok: true, input: VIDEO_URL } : { ok: true },
      getURL: (path: string) => `chrome-extension://loupe/${path}`,
    },
    storage: {
      local: { set: async () => undefined, get: async () => ({}) },
      onChanged: { addListener: (): void => {}, removeListener: (): void => {} },
    },
    windows: { create: async () => ({}) },
  });
  // 真实 ResizeObserver 在 happy-dom 里不回调，桩掉以免依赖具体实现
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  // 桥只往父文档投递；这里不真的投递，只记录（B 站页面那一侧由测试自己扮）
  post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  mocks.previewRootsPage.mockResolvedValue(rootsPageOf(COMMENTS));
  mocks.previewThread.mockResolvedValue(analysisOf([]));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function open() {
  const wrapper = mount(EmbeddedComments);
  await flushPromises();
  await flushPromises();
  return wrapper;
}

/** 只排空微任务（不依赖定时器）：假定时器下 flushPromises 会取不到时间。 */
async function drain(): Promise<void> {
  for (let round = 0; round < 5; round += 1) await Promise.resolve();
}

/** 内容脚本 → 嵌入页：把一次写的结果投回去。 */
function deliver(result: ReaderWriteResult): void {
  window.dispatchEvent(new MessageEvent('message', { data: result, origin: 'https://www.bilibili.com', source: window }));
}

function lastWriteRequest(): ReaderWriteRequest {
  const writes = post.mock.calls.map((call) => call[0]).filter(isReaderWriteRequest);
  const request = writes[writes.length - 1];
  if (request === undefined) throw new Error('阅读器没有发出写请求');
  return request;
}

describe('嵌入阅读器的写链路', () => {
  it('自绘区自己抓完首屏就把多级关系排出来，不碰原生分页', async () => {
    const wrapper = await open();
    const texts = wrapper.findAll('.comment-row').map((row) => row.get('.text').text());
    expect(texts).toEqual(['顶层一', '楼中楼一', '顶层二']);
    // 楼中楼已在首屏里：不再按需抓树（原生分页按钮/评论树请求都不参与）
    expect(mocks.previewThread).not.toHaveBeenCalled();
  });

  it('点赞：请求能过桥守卫，先乐观点亮，失败回滚并提示', async () => {
    const wrapper = await open();
    const like = wrapper.findAll('.comment-row')[0]!.get('.act.like');
    expect(like.attributes('aria-pressed')).toBe('false');

    await like.trigger('click');
    const request = lastWriteRequest();
    expect(request).toMatchObject({ op: 'like', commentId: '1' });
    expect(typeof request.requestId).toBe('string');
    expect(isReaderWriteRequest(request)).toBe(true);
    // 结果还没回来就已经点亮（乐观）
    expect(wrapper.findAll('.comment-row')[0]!.get('.act.like').attributes('aria-pressed')).toBe('true');

    deliver({ source: READER_BRIDGE_SOURCE, type: READER_WRITE_RESULT, requestId: request.requestId, ok: false, error: '需要登录后才能点赞' });
    await flushPromises();
    expect(wrapper.findAll('.comment-row')[0]!.get('.act.like').attributes('aria-pressed')).toBe('false');
    expect(wrapper.text()).toContain('需要登录后才能点赞');
  });

  it('点赞成功：状态留在界面上，不再提示', async () => {
    const wrapper = await open();
    await wrapper.findAll('.comment-row')[0]!.get('.act.like').trigger('click');
    const request = lastWriteRequest();
    deliver({ source: READER_BRIDGE_SOURCE, type: READER_WRITE_RESULT, requestId: request.requestId, ok: true });
    await flushPromises();
    expect(wrapper.findAll('.comment-row')[0]!.get('.act.like').attributes('aria-pressed')).toBe('true');
    expect(wrapper.text()).not.toContain('操作失败');
  });

  it('回复：桥请求带成对的 root / parent，成功后把返回的评论插进树', async () => {
    const wrapper = await open();
    const row = wrapper.findAll('.comment-row')[0]!;
    await row.findAll('.act')[1]!.trigger('click');
    await row.get('.reply textarea').setValue('同意');
    await row.get('.reply .send').trigger('click');

    const request = lastWriteRequest();
    expect(request).toMatchObject({ op: 'reply', rootId: '1', parentId: '1', text: '同意' });
    expect('commentId' in request).toBe(false);
    expect(isReaderWriteRequest(request)).toBe(true);
    expect(wrapper.text()).toContain('发送中');

    deliver({
      source: READER_BRIDGE_SOURCE,
      type: READER_WRITE_RESULT,
      requestId: request.requestId,
      ok: true,
      comment: makeComment({ id: '99', rootId: '1', parentId: '1', text: '我的新回复', author: { id: 'me', name: '我' } }),
    });
    await flushPromises();
    expect(wrapper.text()).toContain('我的新回复');
    // 回复框收起（草稿随成功清空）
    expect(wrapper.find('.reply').exists()).toBe(false);
  });

  it('回复失败：草稿留着并就地提示', async () => {
    const wrapper = await open();
    const row = wrapper.findAll('.comment-row')[0]!;
    await row.findAll('.act')[1]!.trigger('click');
    await row.get('.reply textarea').setValue('这条会失败');
    await row.get('.reply .send').trigger('click');

    const request = lastWriteRequest();
    deliver({
      source: READER_BRIDGE_SOURCE,
      type: READER_WRITE_RESULT,
      requestId: request.requestId,
      ok: false,
      error: '评论区已关闭',
    });
    await flushPromises();
    expect(row.get('.fail').text()).toContain('评论区已关闭');
    expect(row.get<HTMLTextAreaElement>('.reply textarea').element.value).toBe('这条会失败');
  });

  it('发表顶层评论：请求不带 root / parent，成功后钉在列表最上面且不重复', async () => {
    const wrapper = await open();
    const composer = wrapper.get('.reader > .composer');
    await composer.get('textarea').setValue('我发的顶层评论');
    await composer.get('.send').trigger('click');

    const request = lastWriteRequest();
    expect(request.op).toBe('reply');
    expect('rootId' in request).toBe(false);
    expect('parentId' in request).toBe(false);
    expect(isReaderWriteRequest(request)).toBe(true);

    deliver({
      source: READER_BRIDGE_SOURCE,
      type: READER_WRITE_RESULT,
      requestId: request.requestId,
      ok: true,
      comment: makeComment({ id: '88', text: '我发的顶层评论', author: { id: 'me', name: '我' }, createdAt: 1_700_000_999_000 }),
    });
    await flushPromises();
    const rows = wrapper.findAll('.comment-row');
    expect(rows[0]!.text()).toContain('我发的顶层评论');
    expect(rows.filter((rowItem) => rowItem.text().includes('我发的顶层评论'))).toHaveLength(1);
    expect(composer.get<HTMLTextAreaElement>('textarea').element.value).toBe('');
  });

  it('内容脚本不回结果时超时兜底：既不悬挂也不会把点赞永久点亮', async () => {
    const wrapper = await open();
    // 阅读器已经就绪，只把写请求的定时器换成假的
    vi.useFakeTimers();
    await wrapper.findAll('.comment-row')[0]!.get('.act.like').trigger('click');
    expect(wrapper.findAll('.comment-row')[0]!.get('.act.like').attributes('aria-pressed')).toBe('true');

    await vi.advanceTimersByTimeAsync(20_000);
    await drain();
    expect(wrapper.findAll('.comment-row')[0]!.get('.act.like').attributes('aria-pressed')).toBe('false');
    expect(wrapper.text()).toContain('写操作超时');
  });
});
