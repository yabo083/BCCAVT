import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NEW_COMMENT_KEY,
  WRITE_TIMEOUT_MS,
  buildWriteRequest,
  commentIntent,
  commentTextError,
  createWriteClient,
  likeIntent,
  mergeComments,
  normalizeCommentText,
  replyIntent,
} from '@/ui/reader-comments';
import {
  READER_BRIDGE_SOURCE,
  READER_COMMENT_MAX_LENGTH,
  READER_WRITE_REQUEST,
  READER_WRITE_RESULT,
  isReaderWriteRequest,
  isReaderWriteResult,
} from '@/extension/page-comments';
import type { ReaderWriteRequest, ReaderWriteResult } from '@/extension/page-comments';
import type { Comment } from '@/core/model';

function comment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c1',
    rootId: null,
    parentId: null,
    author: { id: 'u1', name: '阿蓝' },
    text: '正文',
    createdAt: 1_700_000_000_000,
    likes: 3,
    replyCount: 0,
    ...overrides,
  };
}

function result(overrides: Partial<ReaderWriteResult> & { requestId: string }): ReaderWriteResult {
  return { source: READER_BRIDGE_SOURCE, type: READER_WRITE_RESULT, ok: true, ...overrides };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('写意图', () => {
  it('点赞取反：没点过发 like，点过发 unlike', () => {
    expect(likeIntent('42', false)).toEqual({ op: 'like', commentId: '42' });
    expect(likeIntent('42', true)).toEqual({ op: 'unlike', commentId: '42' });
  });

  it('回复顶层评论：root 与 parent 都是这条评论自己（桥上的守卫要求成对出现）', () => {
    const intent = replyIntent(comment({ id: '10', rootId: null, parentId: null }), '  说得对  ');
    expect(intent).toEqual({ op: 'reply', rootId: '10', parentId: '10', text: '说得对' });
    expect('commentId' in intent).toBe(false);
  });

  it('回复楼中楼：root 取它所属线程的根，parent 是被回复的它', () => {
    const intent = replyIntent(comment({ id: '11', rootId: '10', parentId: '10' }), '同意');
    expect(intent).toEqual({ op: 'reply', rootId: '10', parentId: '11', text: '同意' });
  });

  it('发表新顶层评论：不带 root / parent（内容脚本据此走顶层分支）', () => {
    expect(commentIntent(' 新评论 ')).toEqual({ op: 'reply', text: '新评论' });
  });
});

describe('正文校验', () => {
  it('去首尾空白后判空', () => {
    expect(normalizeCommentText('  a\n b ')).toBe('a\n b');
    expect(commentTextError('   \n ')).toBe('内容不能为空');
  });

  it('超过上限给出可展示的错误，正好等于上限则放行', () => {
    expect(commentTextError('x'.repeat(READER_COMMENT_MAX_LENGTH))).toBeNull();
    expect(commentTextError('x'.repeat(READER_COMMENT_MAX_LENGTH + 1))).toContain(String(READER_COMMENT_MAX_LENGTH));
  });

  it('草稿键与平台 id 不会撞（平台 id 都是数字串）', () => {
    expect(NEW_COMMENT_KEY).not.toMatch(/^\d+$/);
  });
});

describe('桥请求构造', () => {
  it('补上 source / type / requestId，并且不塞用不到的字段', () => {
    const request = buildWriteRequest(likeIntent('7', false), 'r-1');
    expect(request).toEqual({
      source: READER_BRIDGE_SOURCE,
      type: READER_WRITE_REQUEST,
      requestId: 'r-1',
      op: 'like',
      commentId: '7',
    });
    expect('text' in request).toBe(false);
    expect('rootId' in request).toBe(false);
  });

  it('回复请求带上 root / parent / 规范化后的正文，且不带 commentId', () => {
    const request = buildWriteRequest(replyIntent(comment({ id: '11', rootId: '10' }), ' 好 '), 'r-2');
    expect(request).toMatchObject({ op: 'reply', rootId: '10', parentId: '11', text: '好' });
    expect('commentId' in request).toBe(false);
  });

  it('发表顶层评论的请求只带正文', () => {
    const request = buildWriteRequest(commentIntent('新评论'), 'r-3');
    expect(request).toEqual({
      source: READER_BRIDGE_SOURCE,
      type: READER_WRITE_REQUEST,
      requestId: 'r-3',
      op: 'reply',
      text: '新评论',
    });
  });

  it('每种意图构造出的请求都能过桥上的守卫（界面与内容脚本的契约对得上）', () => {
    const requests = [
      buildWriteRequest(likeIntent('42', false), 'r-1'),
      buildWriteRequest(likeIntent('42', true), 'r-1'),
      buildWriteRequest(replyIntent(comment({ id: '11', rootId: '10' }), '同意'), 'r-2'),
      buildWriteRequest(replyIntent(comment({ id: '10', rootId: null }), '回复顶层评论'), 'r-3'),
      buildWriteRequest(commentIntent('新评论'), 'r-4'),
    ];
    expect(requests.map((request) => isReaderWriteRequest(request))).toEqual([true, true, true, true, true]);
  });
});

describe('评论合并', () => {
  it('同 id 后者覆盖前者：新写的评论压过快照里的旧版本', () => {
    const merged = mergeComments([comment({ id: 'a', text: '旧的' })], [comment({ id: 'a', text: '新的' }), comment({ id: 'b' })]);
    expect(merged.map((item) => item.text)).toEqual(['新的', '正文']);
    expect(merged).toHaveLength(2);
  });

  it('按来源顺序铺平：快照 → 按需抓到的回复 → 新写的评论', () => {
    const merged = mergeComments([comment({ id: 'a' })], [comment({ id: 'b' })], [comment({ id: 'c' })]);
    expect(merged.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('写客户端', () => {
  it('请求投出去后按 requestId 把结果配回来', async () => {
    const post = vi.fn<(request: ReaderWriteRequest) => void>();
    const client = createWriteClient(post, { newId: () => 'r-1' });
    const pending = client.send(likeIntent('7', false));
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]?.[0]).toMatchObject({ type: READER_WRITE_REQUEST, requestId: 'r-1', op: 'like' });

    client.settle(result({ requestId: 'r-1', ok: true, comment: comment({ id: '7' }) }));
    await expect(pending).resolves.toMatchObject({ ok: true, requestId: 'r-1' });
  });

  it('requestId 对不上的结果一律丢弃（页面脚本能伪造消息）', async () => {
    const client = createWriteClient(() => {}, { newId: () => 'r-1' });
    const pending = client.send(likeIntent('7', false));
    client.settle(result({ requestId: '别人发的', ok: true }));
    client.settle(result({ requestId: 'r-1', ok: true }));
    await expect(pending).resolves.toMatchObject({ requestId: 'r-1' });
  });

  it('内容脚本不回结果时超时收场，不悬挂', async () => {
    vi.useFakeTimers();
    const client = createWriteClient(() => {}, { newId: () => 'r-1' });
    const pending = client.send(commentIntent('你好'));
    vi.advanceTimersByTime(WRITE_TIMEOUT_MS);
    const outcome = await pending;
    expect(outcome).toMatchObject({ ok: false, requestId: 'r-1' });
    // 自己合成的失败也要是合法结果（守卫认），免得界面自作主张造出一个谁也读不懂的形状
    expect(isReaderWriteResult(outcome)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('投递本身抛错（父文档不可达）也算失败，且不 reject', async () => {
    const client = createWriteClient(() => {
      throw new Error('窗口已关闭');
    });
    await expect(client.send(likeIntent('7', false))).resolves.toMatchObject({ ok: false, error: '窗口已关闭' });
  });

  it('撤销未决请求：全部以失败收场并清掉定时器', async () => {
    const client = createWriteClient(() => {});
    const first = client.send(likeIntent('7', false));
    const second = client.send(commentIntent('你好'));
    client.dropAll('阅读器已关闭');
    await expect(first).resolves.toMatchObject({ ok: false, error: '阅读器已关闭' });
    await expect(second).resolves.toMatchObject({ ok: false, error: '阅读器已关闭' });
    // 已经收场过的请求再撤一次是空操作
    client.dropAll('再来一次');
    await expect(first).resolves.toMatchObject({ ok: false });
  });
});
