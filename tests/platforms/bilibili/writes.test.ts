/**
 * 写层测试：点赞与回复的参数装配、错误码映射、新评论归一化，以及 csrf 红线
 * （只进请求体，绝不进 URL / 错误文本）。
 * 端点与参数依据：bilibili-API-collect docs/comment/action.md（社区镜像 z0z0r4/bilibili-API-collect）。
 */
import { describe, expect, it } from 'vitest';
import { PlatformError } from '@/core/errors';
import type { Subject } from '@/core/model';
import type { PlatformWrites } from '@/core/platform';
import { bilibiliAdapter } from '@/platforms/bilibili';
import { createBilibiliWrites } from '@/platforms/bilibili/api';
import { createStubHttp, type RawJson, type StubHttp } from './fakes';

const CSRF = '9f8e7d6c5b4a39281706f5e4d3c2b1a0';
const OID = 243322853;
const ROOT_ID = '3760801399';
const SUB_REPLY_ID = '4012538137';
const ADDED_ID = '3043212039';

function videoSubject(): Subject {
  return {
    ref: { platform: 'bilibili', kind: 'video', id: 'BV1GJ411x7h7' },
    title: '测试稿件',
    url: 'https://www.bilibili.com/video/BV1GJ411x7h7',
    locator: { oid: OID, type: 1 },
  };
}

function ok(data: unknown = {}): RawJson {
  return { code: 0, message: '0', ttl: 1, data };
}

function env(response: unknown): { writes: PlatformWrites; stub: StubHttp } {
  const stub = createStubHttp(() => response);
  stub.onPost = () => response;
  return { writes: createBilibiliWrites(stub.http), stub };
}

async function capture(promise: Promise<unknown>): Promise<PlatformError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PlatformError) return error;
    throw error;
  }
  throw new Error('期望抛出 PlatformError');
}

describe('适配器装配', () => {
  it('bilibiliAdapter.writes 暴露 likeComment / replyComment', () => {
    expect(typeof bilibiliAdapter.writes?.likeComment).toBe('function');
    expect(typeof bilibiliAdapter.writes?.replyComment).toBe('function');
  });
});

describe('likeComment', () => {
  it('点赞：POST /x/v2/reply/action，action=1，csrf 只在请求体里', async () => {
    const { writes, stub } = env(ok());
    await writes.likeComment({ subject: videoSubject(), commentId: ADDED_ID, action: 'like' }, { csrf: CSRF });

    expect(stub.posts).toHaveLength(1);
    const post = stub.posts[0]!;
    expect(post.url).toBe('https://api.bilibili.com/x/v2/reply/action');
    expect(post.params).toEqual({
      oid: String(OID),
      type: '1',
      rpid: ADDED_ID,
      action: '1',
      csrf: CSRF,
    });
    expect(stub.urls.every((url) => !url.includes(CSRF))).toBe(true);
  });

  it('取消点赞：action=0', async () => {
    const { writes, stub } = env(ok());
    await writes.likeComment({ subject: videoSubject(), commentId: ROOT_ID, action: 'unlike' }, { csrf: CSRF });
    expect(stub.posts[0]!.params['action']).toBe('0');
  });

  it('oid/type 来自 subject.locator，缺失时报 protocol 且不发请求', async () => {
    const { writes, stub } = env(ok());
    const subject = videoSubject();
    const error = await capture(
      writes.likeComment({ subject: { ...subject, locator: {} }, commentId: ROOT_ID, action: 'like' }, { csrf: CSRF }),
    );
    expect(error.kind).toBe('protocol');
    expect(stub.posts).toHaveLength(0);
  });

  it.each([
    [-101, 'auth-required'],
    [-111, 'auth-required'],
    [-352, 'rate-limited'],
    [-412, 'rate-limited'],
    [-509, 'rate-limited'],
    [12002, 'unavailable'],
    [12004, 'unavailable'],
    [12006, 'not-found'],
    [12011, 'invalid-input'],
    [99999, 'protocol'],
  ])('错误码 %i → %s', async (code, kind) => {
    const { writes } = env({ code, message: '平台原文' });
    await expect(
      writes.likeComment({ subject: videoSubject(), commentId: ROOT_ID, action: 'like' }, { csrf: CSRF }),
    ).rejects.toMatchObject({ kind, code });
  });
});

describe('replyComment 参数装配', () => {
  const addedReply = (overrides: RawJson = {}): RawJson => ({
    rpid: ADDED_ID,
    root: 0,
    parent: 0,
    ctime: 1592233764,
    like: 0,
    rcount: 0,
    count: 0,
    member: { mid: '293793435', uname: '社会易姐QwQ' },
    content: { message: '测试test' },
    ...overrides,
  });

  function addEnv(reply: RawJson = addedReply()): { writes: PlatformWrites; stub: StubHttp } {
    return env(ok({ success_toast: '发送成功', rpid: ADDED_ID, reply }));
  }

  it('顶层评论：带 oid/type/message/plat/csrf，不带 root/parent', async () => {
    const { writes, stub } = addEnv();
    await writes.replyComment({ subject: videoSubject(), text: '测试test' }, { csrf: CSRF });

    const post = stub.posts[0]!;
    expect(post.url).toBe('https://api.bilibili.com/x/v2/reply/add');
    expect(post.params).toEqual({
      oid: String(OID),
      type: '1',
      message: '测试test',
      plat: '1',
      csrf: CSRF,
    });
    expect('root' in post.params).toBe(false);
    expect('parent' in post.params).toBe(false);
  });

  it('回复一条根评论：root 与 parent 都等于它', async () => {
    const { writes, stub } = addEnv(addedReply({ root: Number(ROOT_ID), parent: Number(ROOT_ID) }));
    await writes.replyComment({ subject: videoSubject(), commentId: ROOT_ID, text: '回复' }, { csrf: CSRF });

    expect(stub.posts[0]!.params['root']).toBe(ROOT_ID);
    expect(stub.posts[0]!.params['parent']).toBe(ROOT_ID);
  });

  it('回复楼中楼：root 用真实根 id，parent 是被回复的那条', async () => {
    const { writes, stub } = addEnv(addedReply({ root: Number(ROOT_ID), parent: Number(SUB_REPLY_ID) }));
    await writes.replyComment(
      { subject: videoSubject(), commentId: SUB_REPLY_ID, rootId: ROOT_ID, text: '回复楼中楼' },
      { csrf: CSRF },
    );

    expect(stub.posts[0]!.params['root']).toBe(ROOT_ID);
    expect(stub.posts[0]!.params['parent']).toBe(SUB_REPLY_ID);
  });

  it('回复目标为空串：invalid-input 且不发请求', async () => {
    const { writes, stub } = addEnv();
    const error = await capture(
      writes.replyComment({ subject: videoSubject(), commentId: '', text: 'x' }, { csrf: CSRF }),
    );
    expect(error.kind).toBe('invalid-input');
    expect(stub.posts).toHaveLength(0);
  });

  it.each([
    ['', 'invalid-input'],
    ['   ', 'invalid-input'],
    ['x'.repeat(1001), 'invalid-input'],
  ])('正文 %j 被本地拦下', async (text, kind) => {
    const { writes, stub } = addEnv();
    await expect(writes.replyComment({ subject: videoSubject(), text }, { csrf: CSRF })).rejects.toMatchObject({ kind });
    expect(stub.posts).toHaveLength(0);
  });
});

describe('replyComment 归一化', () => {
  it('顶层新评论：返回归一化 Comment（id/rootId/parentId/正文/时间/作者）', async () => {
    const { writes } = env(
      ok({
        reply: {
          rpid: ADDED_ID,
          rpid_str: ADDED_ID,
          root: 0,
          parent: 0,
          dialog: 0,
          ctime: 1592233764,
          like: 0,
          rcount: 0,
          count: 0,
          member: {
            mid: '293793435',
            uname: '社会易姐QwQ',
            avatar: 'https://i1.hdslb.com/bfs/face/aebb.png',
            level_info: { current_level: 5 },
          },
          content: { message: '测试test', emote: {} },
          reply_control: { location: 'IP属地：广东' },
        },
      }),
    );
    const comment = await writes.replyComment({ subject: videoSubject(), text: '测试test' }, { csrf: CSRF });

    expect(comment).toEqual({
      id: ADDED_ID,
      rootId: null,
      parentId: null,
      author: {
        id: '293793435',
        name: '社会易姐QwQ',
        avatarUrl: 'https://i1.hdslb.com/bfs/face/aebb.png',
        level: 5,
        profileUrl: 'https://space.bilibili.com/293793435',
      },
      text: '测试test',
      createdAt: 1592233764 * 1000,
      likes: 0,
      replyCount: 0,
      location: '广东',
    });
  });

  it('楼中楼新回复：rootId/parentId 来自平台返回的那条评论，replyCount 归零', async () => {
    const { writes } = env(
      ok({
        reply: {
          rpid: ADDED_ID,
          rpid_str: ADDED_ID,
          root: Number(ROOT_ID),
          root_str: ROOT_ID,
          parent: Number(SUB_REPLY_ID),
          parent_str: SUB_REPLY_ID,
          ctime: 1600000000,
          like: 3,
          count: 0,
          rcount: 2193,
          member: { mid: '9', uname: 'u' },
          content: { message: '[支持]' },
          up_action: { like: true },
        },
      }),
    );
    const comment = await writes.replyComment(
      { subject: videoSubject(), commentId: SUB_REPLY_ID, rootId: ROOT_ID, text: '[支持]' },
      { csrf: CSRF },
    );

    expect(comment.rootId).toBe(ROOT_ID);
    expect(comment.parentId).toBe(SUB_REPLY_ID);
    expect(comment.likes).toBe(3);
    expect(comment.replyCount).toBe(0);
    expect(comment.creatorLiked).toBe(true);
  });

  it('code=0 但平台未回评论本体：protocol（正文已发出，无对象可归一化）', async () => {
    const { writes } = env(ok({ rpid: ADDED_ID, reply: null }));
    const error = await capture(writes.replyComment({ subject: videoSubject(), text: 'x' }, { csrf: CSRF }));
    expect(error.kind).toBe('protocol');
  });

  it('评论本体字段异常：protocol 并指明字段路径', async () => {
    const { writes } = env(ok({ reply: { rpid: ADDED_ID, content: {} } }));
    const error = await capture(writes.replyComment({ subject: videoSubject(), text: 'x' }, { csrf: CSRF }));
    expect(error.kind).toBe('protocol');
    expect(error.message).toContain('add.data.reply');
  });

  it.each([
    [12016, 'invalid-input'],
    [12025, 'invalid-input'],
    [12051, 'invalid-input'],
    [12035, 'unavailable'],
    [12045, 'unavailable'],
    [12052, 'unavailable'],
    [-102, 'auth-required'],
  ])('错误码 %i → %s', async (code, kind) => {
    const { writes } = env({ code, message: '平台原文' });
    await expect(writes.replyComment({ subject: videoSubject(), text: 'x' }, { csrf: CSRF })).rejects.toMatchObject({
      kind,
      code,
    });
  });
});

describe('csrf 红线', () => {
  it('缺失或空白 csrf：invalid-input，不发请求', async () => {
    const { writes, stub } = env(ok());
    for (const csrf of ['', '   ']) {
      const error = await capture(
        writes.likeComment({ subject: videoSubject(), commentId: ROOT_ID, action: 'like' }, { csrf }),
      );
      expect(error.kind).toBe('invalid-input');
    }
    expect(stub.posts).toHaveLength(0);
  });

  it('登录/风控失败时错误文本与堆栈都不含 csrf', async () => {
    for (const response of [
      { code: -111, message: 'csrf校验失败' },
      { code: -412, message: '请求被拦截' },
      { code: 0, message: '0', data: { reply: null } },
    ]) {
      const { writes } = env(response);
      const error = await capture(writes.replyComment({ subject: videoSubject(), text: 'x' }, { csrf: CSRF }));
      expect(error.message).not.toContain(CSRF);
      expect(error.stack ?? '').not.toContain(CSRF);
      expect(JSON.stringify({ ...error })).not.toContain(CSRF);
      expect(String(error.cause ?? '')).not.toContain(CSRF);
    }
  });

  it('csrf 只出现在请求体参数里，URL 上永远没有它', async () => {
    const { writes, stub } = env(
      ok({
        reply: {
          rpid: ADDED_ID,
          root: 0,
          parent: 0,
          ctime: 1,
          like: 0,
          count: 0,
          rcount: 0,
          member: { mid: '9', uname: 'u' },
          content: { message: 'x' },
        },
      }),
    );
    await writes.replyComment({ subject: videoSubject(), text: 'x' }, { csrf: CSRF });
    expect(stub.posts[0]!.params['csrf']).toBe(CSRF);
    expect(stub.posts[0]!.url).not.toContain(CSRF);
  });
});
