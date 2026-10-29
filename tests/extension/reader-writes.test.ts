// @vitest-environment happy-dom
/**
 * 写执行器的行为测试：csrf 现读现用且绝不进结果、主体解析整页一次、失败一律映射成可展示的原因。
 *
 * 适配器由测试自己装配（写能力是适配器的可选能力，见 core/platform.ts 的 PlatformWrites），
 * 因此这里不需要 mock 模块：执行器按适配器构造，生产用的 bilibiliAdapter 单例不在断言范围内。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformError } from '@/core/errors';
import type { Comment, PlatformId, Subject } from '@/core/model';
import type { HeaderRewrite, LikeCommentInput, PlatformAdapter, PlatformWrites, Politeness, ReplyCommentInput, WriteAuth } from '@/core/platform';
import { READER_BRIDGE_SOURCE, READER_WRITE_REQUEST, READER_WRITE_RESULT, type ReaderWriteRequest } from '@/extension/page-comments';
import { createReaderWriteExecutor } from '@/extension/content/reader-writes';

const VIDEO_URL = 'https://www.bilibili.com/video/BV1TEST/';
const NON_VIDEO_URL = 'https://www.bilibili.com/bangumi/play/ep1';
const CSRF = 'csrf-token-abc123';

const SUBJECT: Subject = {
  ref: { platform: 'bilibili', kind: 'video', id: 'BV1TEST' },
  title: '测试视频',
  url: VIDEO_URL,
  locator: { oid: 80433022, type: 1 },
};

const NEW_COMMENT: Comment = {
  id: '999',
  rootId: null,
  parentId: null,
  author: { id: 'u1', name: '用户1' },
  text: '你好',
  createdAt: 1,
  likes: 0,
  replyCount: 0,
};

/** 假适配器：写能力可选（`canWrite: false` 模拟只读平台），写调用与鉴权包都留在实例上供断言。 */
class WriteFakeAdapter implements PlatformAdapter {
  readonly id: PlatformId = 'bilibili';
  readonly name = '假平台';
  readonly hostPermissions = ['https://api.example.com/*'];
  readonly headerRewrites: readonly HeaderRewrite[] = [];
  readonly politeness: Politeness = { concurrency: 1, minIntervalMs: 0 };
  readonly writes: PlatformWrites | undefined;

  subject: Subject = SUBJECT;
  /** 依次消费的注入错误；队列为空时正常返回。 */
  readonly subjectFailures: PlatformError[] = [];
  readonly writeFailures: PlatformError[] = [];
  readonly likeCalls: LikeCommentInput[] = [];
  readonly replyCalls: ReplyCommentInput[] = [];
  /** 写层收到的鉴权包：用来证明 csrf 是从 cookie 现读后原样传下去的。 */
  readonly auths: WriteAuth[] = [];
  subjectCalls = 0;

  constructor(canWrite = true) {
    this.writes = canWrite
      ? {
          likeComment: async (input, auth) => this.runWrite(input, auth),
          replyComment: async (input, auth) => {
            await this.runWrite(input, auth);
            return NEW_COMMENT;
          },
        }
      : undefined;
  }

  parseTarget(input: string): { kind: 'subject'; subject: Subject['ref'] } | null {
    return input.includes('BV1TEST') ? { kind: 'subject', subject: this.subject.ref } : null;
  }

  async getSubject(): Promise<Subject> {
    this.subjectCalls += 1;
    const failure = this.subjectFailures.shift();
    if (failure !== undefined) throw failure;
    return this.subject;
  }

  getSession(): Promise<never> {
    throw new Error('写路径不该请求会话');
  }

  listRoots(): Promise<never> {
    throw new Error('写路径不该读评论');
  }

  listThread(): Promise<never> {
    throw new Error('写路径不该读评论');
  }

  private async runWrite(input: LikeCommentInput | ReplyCommentInput, auth: WriteAuth): Promise<void> {
    this.auths.push(auth);
    if ('action' in input) this.likeCalls.push(input);
    else this.replyCalls.push(input);
    const failure = this.writeFailures.shift();
    if (failure !== undefined) throw failure;
  }
}

let adapter: WriteFakeAdapter;
let locationStub: { href: string };

function writeRequest(overrides: Partial<ReaderWriteRequest>): ReaderWriteRequest {
  return { source: READER_BRIDGE_SOURCE, type: READER_WRITE_REQUEST, requestId: 'req-1', op: 'like', ...overrides };
}

/** 直接接管 document.cookie 的读取：用例控制「此刻 cookie 里有什么」，不依赖 happy-dom 的 cookie 容器。 */
function stubCookie(value: string): void {
  Object.defineProperty(document, 'cookie', { configurable: true, get: () => value });
}

beforeEach(() => {
  adapter = new WriteFakeAdapter();
  locationStub = { href: VIDEO_URL };
  vi.stubGlobal('location', locationStub);
  stubCookie(`bili_jct=${CSRF}; other=1`);
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'cookie');
});

describe('写执行器', () => {
  it('点赞：csrf 从 cookie 现读现用，结果里只有 requestId 与 ok', async () => {
    const result = await createReaderWriteExecutor(adapter)(writeRequest({ op: 'like', commentId: '123' }));

    expect(adapter.likeCalls).toEqual([{ subject: SUBJECT, commentId: '123', action: 'like' }]);
    expect(adapter.auths).toEqual([{ csrf: CSRF }]);
    expect(result).toEqual({ source: READER_BRIDGE_SOURCE, type: READER_WRITE_RESULT, requestId: 'req-1', ok: true });
    expect(JSON.stringify(result)).not.toContain(CSRF);
  });

  it('取消点赞映射成 action: unlike', async () => {
    await createReaderWriteExecutor(adapter)(writeRequest({ op: 'unlike', commentId: '456' }));

    expect(adapter.likeCalls).toEqual([{ subject: SUBJECT, commentId: '456', action: 'unlike' }]);
  });

  it('回复楼中楼：parentId 是被回复的评论、rootId 是线程根，结果带回新评论', async () => {
    const result = await createReaderWriteExecutor(adapter)(
      writeRequest({ op: 'reply', rootId: '123', parentId: '456', text: '你好' }),
    );

    expect(adapter.replyCalls).toEqual([{ subject: SUBJECT, commentId: '456', rootId: '123', text: '你好' }]);
    expect(result).toEqual({ source: READER_BRIDGE_SOURCE, type: READER_WRITE_RESULT, requestId: 'req-1', ok: true, comment: NEW_COMMENT });
  });

  it('发表顶层评论：不带 rootId / parentId 时两者都为 null', async () => {
    await createReaderWriteExecutor(adapter)(writeRequest({ op: 'reply', text: '新评论' }));

    expect(adapter.replyCalls).toEqual([{ subject: SUBJECT, commentId: null, rootId: null, text: '新评论' }]);
  });

  it('未登录（读不到 bili_jct）时直接失败，不发写请求', async () => {
    stubCookie('other=1');
    const result = await createReaderWriteExecutor(adapter)(writeRequest({ op: 'like', commentId: '123' }));

    expect(result).toEqual({
      source: READER_BRIDGE_SOURCE,
      type: READER_WRITE_RESULT,
      requestId: 'req-1',
      ok: false,
      error: '未登录：请在 B 站登录后再点赞或回复',
    });
    expect(adapter.likeCalls).toHaveLength(0);
    expect(adapter.subjectCalls).toBe(0);
  });

  it('平台没有写能力时给出可展示的原因', async () => {
    const readOnly = new WriteFakeAdapter(false);
    const result = await createReaderWriteExecutor(readOnly)(writeRequest({ op: 'like', commentId: '123' }));

    expect(result.ok).toBe(false);
    expect(result.error).toBe('当前平台不支持写操作');
    expect(readOnly.subjectCalls).toBe(0);
  });

  it('写层失败：PlatformError 的文案原样回给嵌入页，csrf 不出现在结果里', async () => {
    adapter.writeFailures.push(new PlatformError('rate-limited', '触发 Bilibili 风控，请稍后再试'));
    const result = await createReaderWriteExecutor(adapter)(writeRequest({ op: 'reply', text: '你好' }));

    expect(result.ok).toBe(false);
    expect(result.error).toBe('触发 Bilibili 风控，请稍后再试');
    expect(JSON.stringify(result)).not.toContain(CSRF);
  });

  it('页面地址识别不出主体时失败，不发写请求', async () => {
    locationStub.href = NON_VIDEO_URL;
    const result = await createReaderWriteExecutor(adapter)(writeRequest({ op: 'like', commentId: '123' }));

    expect(result.ok).toBe(false);
    expect(result.error).toBe('当前页面不是可写评论的 B 站视频页');
    expect(adapter.likeCalls).toHaveLength(0);
  });

  it('主体解析整页只做一次，换页后重新解析', async () => {
    const execute = createReaderWriteExecutor(adapter);
    await execute(writeRequest({ op: 'like', commentId: '1' }));
    await execute(writeRequest({ op: 'like', commentId: '2' }));
    expect(adapter.subjectCalls).toBe(1);

    locationStub.href = `${VIDEO_URL}?p=2`;
    await execute(writeRequest({ op: 'like', commentId: '3' }));
    expect(adapter.subjectCalls).toBe(2);
  });

  it('同一地址的并发写只解析一次主体', async () => {
    const execute = createReaderWriteExecutor(adapter);
    await Promise.all([execute(writeRequest({ op: 'like', commentId: '1' })), execute(writeRequest({ op: 'like', commentId: '2' }))]);

    expect(adapter.subjectCalls).toBe(1);
    expect(adapter.likeCalls).toHaveLength(2);
  });

  it('主体解析失败不缓存：下一次写会重试', async () => {
    adapter.subjectFailures.push(new PlatformError('network', '网络请求失败'));
    const execute = createReaderWriteExecutor(adapter);

    const failed = await execute(writeRequest({ op: 'like', commentId: '1' }));
    expect(failed).toEqual({ source: READER_BRIDGE_SOURCE, type: READER_WRITE_RESULT, requestId: 'req-1', ok: false, error: '网络请求失败' });

    const retried = await execute(writeRequest({ op: 'like', commentId: '1' }));
    expect(retried.ok).toBe(true);
    expect(adapter.subjectCalls).toBe(2);
  });
});
