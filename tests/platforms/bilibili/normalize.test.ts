import { describe, expect, it } from 'vitest';
import { PlatformError } from '@/core/errors';
import { normalizeReply, rawRootId } from '@/platforms/bilibili/normalize';
import type { Comment, Emote } from '@/core/model';
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
      // 主页地址由适配器归一化给出：UI 只负责渲染成链接（点击开主页 / 悬停出卡片）
      profileUrl: 'https://space.bilibili.com/320773657',
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

  it('头像 URL 一律升到 https：平台默认头像与协议相对地址都不放过', () => {
    const withAvatar = (avatar: string) => normalizeReply(rawReply({ member: { mid: '9', uname: 'u', avatar } })).author.avatarUrl;
    // 实机出现过的兜底头像就是 http
    expect(withAvatar('http://i0.hdslb.com/bfs/face/member/noface.jpg')).toBe(
      'https://i0.hdslb.com/bfs/face/member/noface.jpg',
    );
    expect(withAvatar('//i1.hdslb.com/bfs/face/x.jpg')).toBe('https://i1.hdslb.com/bfs/face/x.jpg');
    expect(withAvatar('https://i2.hdslb.com/bfs/face/y.jpg')).toBe('https://i2.hdslb.com/bfs/face/y.jpg');
    expect(withAvatar('')).toBeUndefined();
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

describe('normalizeReply：表情（content.emote）', () => {
  const detail = fixture<RawJson>('detail-p1.json');
  const replies = detail.data.root.replies as RawJson[];

  /** 构造一条只带给定 emote 字典的评论。 */
  const withEmote = (emote: unknown, message = '正文'): Comment =>
    normalizeReply(rawReply({ content: { message, emote } }));

  it('真实 fixture：token → https CDN 图片，平台没给宽高就不填', () => {
    const comment = normalizeReply(replies[0], { path: 'replies[0]' });
    expect(comment.text).toBe('[支持]');
    expect(comment.emotes).toEqual({
      '[支持]': { url: 'https://i0.hdslb.com/bfs/emote/3c210366a5585706c09d4c686a9d942b39feeb50.png' },
    });
  });

  it('一条评论可带多个表情，字典键就是正文里的 token', () => {
    const p2 = fixture<RawJson>('detail-p2.json');
    const comment = normalizeReply((p2.data.root.replies as RawJson[])[2], { path: 'r' });
    expect(Object.keys(comment.emotes!)).toEqual(['[再见]', '[思考]']);
    expect(comment.text).toBe('回复 @一名路过且帅气的网友 :你这个评论区的回复还带蓝字展开就离谱啊[思考][再见]');
    expect(comment.emotes!['[思考]']!.url).toContain('https://i0.hdslb.com/bfs/emote/');
  });

  it('http 与协议相对的 CDN 地址都规范化成 https', () => {
    // detail-p1 的 [初音未来_委屈] 在真实响应里就是 http，必须升到 https。
    const comment = normalizeReply(replies[13], { path: 'r' });
    expect(comment.emotes!['[初音未来_委屈]']!.url).toBe(
      'https://i0.hdslb.com/bfs/emote/55023c31259200e5c821cac526b36e527f455d43.png',
    );
    expect(withEmote({ '[a]': { url: '//i0.hdslb.com/a.png' } }).emotes!['[a]']!.url).toBe(
      'https://i0.hdslb.com/a.png',
    );
    expect(withEmote({ '[b]': { url: 'https://www.bilibili.com/b.png' } }).emotes!['[b]']!.url).toBe(
      'https://www.bilibili.com/b.png',
    );
  });

  it('非 https / 非 CDN / 带凭据的地址整条丢弃，评论本身照常归一化', () => {
    const bad = [
      'data:image/png;base64,AAAA',
      'javascript:alert(1)',
      'http://evil.com/x.png',
      'https://hdslb.com.evil.com/x.png',
      'https://xhdslb.com/x.png',
      'ftp://i0.hdslb.com/x.png',
      'https://user:pass@i0.hdslb.com/x.png',
    ];
    for (const url of bad) {
      const comment = withEmote({ '[x]': { url } }, '看[x]');
      expect(comment.emotes).toBeUndefined();
      expect(comment.text).toBe('看[x]');
      expect(comment.id).toBe('100');
    }
  });

  it('同一条里坏表情只丢自己，好的保留', () => {
    const comment = withEmote(
      {
        '[good]': { url: 'https://i0.hdslb.com/g.png' },
        '[bad]': { url: 'javascript:alert(1)' },
        '[nonobject]': 'nope',
        '[nourl]': { text: '[nourl]' },
      },
      '[good][bad][nonobject][nourl]',
    );
    expect(Object.keys(comment.emotes!)).toEqual(['[good]']);
  });

  it('可选宽高在合理区间内保留，越界或非整数按未提供处理', () => {
    const emoteOf = (width: unknown, height: unknown): Emote =>
      withEmote({ '[a]': { url: 'https://i0.hdslb.com/a.png', width, height } }).emotes!['[a]']!;
    expect(emoteOf(20, 20)).toEqual({ url: 'https://i0.hdslb.com/a.png', width: 20, height: 20 });
    expect(emoteOf(1, 512)).toEqual({ url: 'https://i0.hdslb.com/a.png', width: 1, height: 512 });
    expect(emoteOf(0, 99999)).toEqual({ url: 'https://i0.hdslb.com/a.png' });
    expect(emoteOf(1.5, '20')).toEqual({ url: 'https://i0.hdslb.com/a.png' });
  });

  it('content.emote 缺失或非对象时不产生 emotes，也不报协议错误', () => {
    expect(normalizeReply(rawReply()).emotes).toBeUndefined();
    expect(withEmote('nope').emotes).toBeUndefined();
    expect(withEmote({}).emotes).toBeUndefined();
    expect(withEmote(null).emotes).toBeUndefined();
    expect(withEmote({ '': { url: 'https://i0.hdslb.com/a.png' } }).emotes).toBeUndefined();
  });

  it('token 恰为 __proto__ 时只作普通键，不污染原型', () => {
    const comment = withEmote(JSON.parse('{"__proto__":{"url":"https://i0.hdslb.com/p.png"}}'), '__proto__');
    expect(Object.getPrototypeOf(comment.emotes)).toBe(Object.prototype);
    expect(Object.keys(comment.emotes!)).toEqual(['__proto__']);
    expect(comment.emotes!['__proto__']!.url).toBe('https://i0.hdslb.com/p.png');
  });
});

describe('normalizeReply：点踩态与正文链接', () => {
  it('action=2 → disliked；0/1 不带 disliked', () => {
    expect(normalizeReply(rawReply({ action: 2 })).disliked).toBe(true);
    expect(normalizeReply(rawReply({ action: 1 })).disliked).toBeUndefined();
    expect(normalizeReply(rawReply({ action: 0 })).disliked).toBeUndefined();
  });
  it('members 与 at_name_to_mid → mentions（profileUrl 与 Author.profileUrl 同形）', () => {
    const c = normalizeReply(rawReply({ content: { message: '@阿蓝 你看', members: [{ mid: '123', uname: '阿蓝' }], at_name_to_mid: { '老白': 456 } } }));
    expect(c.mentions).toEqual(expect.arrayContaining([{ name: '阿蓝', profileUrl: 'https://space.bilibili.com/123' }, { name: '老白', profileUrl: 'https://space.bilibili.com/456' }]));
  });
  it('jump_url 只收 http(s)：pc_url 优先，关键词本身是 http(s) 时才用它；其余整条丢弃', () => {
    const c = normalizeReply(rawReply({ content: { message: '看这里', jump_url: { '看这里': { title: 't', pc_url: 'https://b23.tv/x' }, '坏链': { title: 't', pc_url: 'javascript:alert(1)' }, 'http词': {} } } }));
    expect(c.jumps).toEqual([{ keyword: '看这里', url: 'https://b23.tv/x' }]);
  });
});
