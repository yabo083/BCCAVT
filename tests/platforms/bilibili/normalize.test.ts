import { describe, expect, it } from 'vitest';
import { PlatformError } from '@/core/errors';
import { normalizeReply, rawRootId } from '@/platforms/bilibili/normalize';
import { fixture, type RawJson } from './fakes';

const UPPER_MID = '486906719';

function expectProtocolError(run: () => unknown, field: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(PlatformError);
    expect((error as PlatformError).kind).toBe('protocol');
    expect((error as PlatformError).message).toContain(field);
    return;
  }
  throw new Error('预期抛出 protocol 错误，但没有抛出');
}

/** 最小合法原始回复，测试按需覆盖字段。 */
function rawReply(overrides: RawJson = {}): RawJson {
  return {
    rpid_str: '100',
    root_str: '0',
    parent_str: '0',
    ctime: 1606652805,
    like: 7,
    rcount: 3,
    count: 5,
    member: { mid: '9', uname: '某人' },
    content: { message: '你好' },
    ...overrides,
  };
}

describe('normalizeReply：真实 fixture', () => {
  const main = fixture<RawJson>('main-hot-anon.json');
  const root = normalizeReply(main.data.replies[0], { upperMid: UPPER_MID, path: 'replies[0]' });

  it('顶层评论：字符串 id、无根无父、rcount 作为 replyCount', () => {
    expect(root.id).toBe('3760801399');
    expect(root.rootId).toBeNull();
    expect(root.parentId).toBeNull();
    expect(root.replyCount).toBe(2193);
    expect(root.likes).toBe(764812);
    expect(root.createdAt).toBe(1606652805 * 1000);
    expect(root.text).toBe('坏消息：被骗了\n好消息：真好听');
    expect(root.pinned).toBeUndefined();
    expect(root.creatorLiked).toBeUndefined();
    expect(root.byCreator).toBe(false);
  });

  it('作者信息来自 member（含等级与头像）', () => {
    expect(root.author).toEqual({
      id: '320773657',
      name: '老咸鱼A',
      avatarUrl: 'https://i1.hdslb.com/bfs/face/10fbeb658285067378c049b290988ab49c32aee5.jpg',
      level: 6,
    });
  });

  it('内联预览是带根/父链接的楼中楼，且回复数为 0', () => {
    const preview = normalizeReply(main.data.replies[0].replies[0], {
      upperMid: UPPER_MID,
      path: 'replies[0].replies[0]',
    });
    expect(preview.id).toBe('4065967309');
    expect(preview.rootId).toBe('3760801399');
    expect(preview.parentId).toBe('3760801399');
    expect(preview.replyCount).toBe(0);
    expect(preview.author.name).toBe('-Megumin_');
    expect(preview.likes).toBe(39590);
  });

  it('同一棵树里的楼中楼 parentId 指向被回复的那条', () => {
    const detail = fixture<RawJson>('detail-p1.json');
    const children = detail.data.root.replies as RawJson[];
    const parents = children.map((child) => normalizeReply(child, { path: 'child' }).parentId);
    expect(parents).toContain('3760801399');
    expect(new Set(parents).size).toBeGreaterThan(1);
    const roots = children.map((child) => normalizeReply(child, { path: 'child' }).rootId);
    expect(new Set(roots)).toEqual(new Set(['3760801399']));
  });
});

describe('normalizeReply：字段规整', () => {
  it('属地去掉 IP属地 前缀（全角/半角冒号）', () => {
    expect(normalizeReply(rawReply({ reply_control: { location: 'IP属地：广东' } })).location).toBe('广东');
    expect(normalizeReply(rawReply({ reply_control: { location: 'IP属地:上海' } })).location).toBe('上海');
    expect(normalizeReply(rawReply({ reply_control: {} })).location).toBeUndefined();
    expect(normalizeReply(rawReply()).location).toBeUndefined();
  });

  it('置顶、UP 主点赞、UP 主本人评论', () => {
    expect(normalizeReply(rawReply(), { pinned: true }).pinned).toBe(true);
    expect(normalizeReply(rawReply({ up_action: { like: true } })).creatorLiked).toBe(true);
    expect(normalizeReply(rawReply({ up_action: { like: false } })).creatorLiked).toBeUndefined();
    expect(normalizeReply(rawReply({ member: { mid: '9', uname: 'u' } }), { upperMid: '9' }).byCreator).toBe(true);
    expect(normalizeReply(rawReply(), { upperMid: undefined }).byCreator).toBeUndefined();
  });

  it('优先 *_str 字段，回退数字字段', () => {
    const huge = normalizeReply(
      rawReply({
        rpid: 9007199254740992,
        rpid_str: '9007199254740993',
        member: { mid: 9007199254740992, mid_str: '9007199254740993', uname: 'u' },
      }),
    );
    expect(huge.id).toBe('9007199254740993');
    expect(huge.author.id).toBe('9007199254740993');
    expect(normalizeReply(rawReply({ rpid_str: undefined, rpid: 42 })).id).toBe('42');
    const numericEdges = normalizeReply(rawReply({ root_str: undefined, parent_str: undefined, root: 0, parent: 0 }));
    expect(numericEdges.rootId).toBeNull();
  });

  it('楼中楼不带回复总数，likes 缺失按 0', () => {
    const reply = normalizeReply(rawReply({ root_str: '100', parent_str: '200', rcount: 5, like: undefined }));
    expect(reply.replyCount).toBe(0);
    expect(reply.likes).toBe(0);
    expect(reply.rootId).toBe('100');
    expect(reply.parentId).toBe('200');
  });
});

describe('normalizeReply：结构异常', () => {
  const cases: [string, RawJson][] = [
    ['replies[0].member', rawReply({ member: undefined })],
    ['replies[0].member.uname', rawReply({ member: { mid: '9' } })],
    ['replies[0].content', rawReply({ content: 'not-an-object' })],
    ['replies[0].content.message', rawReply({ content: {} })],
    ['replies[0].ctime', rawReply({ ctime: undefined })],
    ['replies[0].rpid', rawReply({ rpid_str: undefined, rpid: undefined })],
    ['replies[0].root', rawReply({ root_str: undefined, root: undefined })],
  ];

  it.each(cases)('缺少 %s 时报 protocol 错误并指明字段', (field, raw) => {
    expectProtocolError(() => normalizeReply(raw, { path: 'replies[0]' }), field);
  });

  it('响应不是对象时也报 protocol', () => {
    expectProtocolError(() => normalizeReply(null, { path: 'replies[0]' }), 'replies[0]');
    expectProtocolError(() => normalizeReply([], { path: 'replies[0]' }), 'replies[0]');
  });
});

describe('rawRootId', () => {
  it('顶层评论返回自身 id，楼中楼返回所属根 id', () => {
    expect(rawRootId(rawReply(), 'root')).toBe('100');
    expect(rawRootId(rawReply({ root_str: '55' }), 'root')).toBe('55');
  });
});
