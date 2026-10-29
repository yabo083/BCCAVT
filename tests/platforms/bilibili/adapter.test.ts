import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Subject } from '@/core/model';
import type { FetchContext } from '@/core/platform';
import { bilibiliAdapter } from '@/platforms/bilibili';
import { adapters } from '@/platforms';
import { ANONYMOUS_LIMITATION, codeToError } from '@/platforms/bilibili/api';
import { mixinKey, type WbiKeys } from '@/platforms/bilibili/wbi';
import { createMemoryCache, createStubHttp, fixture, navResponse, type RawJson } from './fakes';

const IMG_KEY = '7cd084941338484aae1ad9425b84077c';
const SUB_KEY = '4932caff0ff746eab6f01bf08b70ac45';
const WBI_KEYS: WbiKeys = { imgKey: IMG_KEY, subKey: SUB_KEY };
const OID = 80433022;
const ANON_UPPER_MID = '486906719';

function env(handler: (url: string) => unknown): { ctx: FetchContext; urls: string[] } {
  const { http, urls } = createStubHttp(handler);
  return { ctx: { http, cache: createMemoryCache(), signal: new AbortController().signal, identity: 'direct' }, urls };
}

/** nav 走固定响应，其余交给用例自己的 handler。 */
function withNav(handler: (url: string) => unknown): (url: string) => unknown {
  return (url) => (url.includes('/x/web-interface/nav') ? navResponse(IMG_KEY, SUB_KEY) : handler(url));
}

function videoSubject(oid = OID): Subject {
  return {
    ref: { platform: 'bilibili', kind: 'video', id: 'BV1GJ411x7h7' },
    title: '测试稿件',
    url: 'https://www.bilibili.com/video/BV1GJ411x7h7',
    locator: { oid, type: 1 },
  };
}

function rawReply(overrides: RawJson = {}): RawJson {
  return {
    rpid_str: '1',
    root_str: '0',
    parent_str: '0',
    ctime: 1606652805,
    like: 1,
    rcount: 0,
    count: 0,
    member: { mid: '9', uname: 'u' },
    content: { message: 'hi' },
    ...overrides,
  };
}

/** 用 node:crypto 重新计算 w_rid，独立验证签名串。 */
function expectValidSignature(url: string): void {
  const parsed = new URL(url);
  const base = [...parsed.searchParams.entries()]
    .filter(([name]) => name !== 'w_rid')
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join('&');
  const expected = createHash('md5').update(base + mixinKey(WBI_KEYS), 'utf8').digest('hex');
  expect(parsed.searchParams.get('w_rid')).toBe(expected);
}

describe('适配器元数据', () => {
  it('hostPermissions / headerRewrites / politeness 与 manifest 契约一致', () => {
    expect(adapters).toContain(bilibiliAdapter);
    expect(bilibiliAdapter.id).toBe('bilibili');
    expect(bilibiliAdapter.hostPermissions).toEqual(['https://*.bilibili.com/*']);
    expect(bilibiliAdapter.headerRewrites).toEqual([
      {
        urlFilter: '||api.bilibili.com/',
        set: { Origin: 'https://www.bilibili.com', Referer: 'https://www.bilibili.com/' },
      },
    ]);
    expect(bilibiliAdapter.politeness).toEqual({ concurrency: 3, minIntervalMs: 250 });
  });

  it('parseTarget 委托给 URL 解析', () => {
    expect(bilibiliAdapter.parseTarget('BV1GJ411x7h7')).toEqual({
      kind: 'subject',
      subject: { platform: 'bilibili', kind: 'video', id: 'BV1GJ411x7h7' },
    });
    expect(bilibiliAdapter.parseTarget('https://b23.tv/x')).toBeNull();
  });
});

describe('getSession', () => {
  it('匿名：loggedIn=false 并给出能力限制，nav 只请求一次', async () => {
    const { ctx, urls } = env(withNav(() => navResponse(IMG_KEY, SUB_KEY)));
    const session = await bilibiliAdapter.getSession(ctx);
    expect(session).toEqual({ platform: 'bilibili', loggedIn: false, limitations: [ANONYMOUS_LIMITATION] });
    expect(session.user).toBeUndefined();

    await bilibiliAdapter.getSession(ctx);
    expect(urls).toEqual(['https://api.bilibili.com/x/web-interface/nav']);
  });

  it('已登录：返回用户信息与等级', async () => {
    const { ctx } = env(() => ({
      code: 0,
      message: '0',
      data: {
        isLogin: true,
        mid: 12345,
        uname: '登录用户',
        // 平台实测会给 http 头像（未设置头像时是 http 的 noface 兜底图）：边界必须升到 https
        face: 'http://i0.hdslb.com/bfs/face/x.jpg',
        level_info: { current_level: 5 },
        wbi_img: {
          img_url: `https://i0.hdslb.com/bfs/wbi/${IMG_KEY}.png`,
          sub_url: `https://i0.hdslb.com/bfs/wbi/${SUB_KEY}.png`,
        },
      },
    }));
    const session = await bilibiliAdapter.getSession(ctx);
    expect(session).toEqual({
      platform: 'bilibili',
      loggedIn: true,
      user: { id: '12345', name: '登录用户', avatarUrl: 'https://i0.hdslb.com/bfs/face/x.jpg', level: 5 },
      limitations: [],
    });
  });
});

describe('getSubject', () => {
  const viewResponse = {
    code: 0,
    message: '0',
    data: {
      aid: OID,
      bvid: 'BV1GJ411x7h7',
      title: '【测试】稿件',
      // 封面同样是平台原样给的 http：边界升 https，别把 Mixed Content 带进扩展页面
      pic: 'http://i0.hdslb.com/bfs/archive/x.jpg',
      pubdate: 1606652805,
      stat: { reply: 236961 },
      owner: { mid: 486906719, name: 'UP 主', face: 'https://i0.hdslb.com/bfs/face/up.jpg' },
    },
  };

  it('BV 号：归一化主体元数据与 locator', async () => {
    const { ctx, urls } = env(() => viewResponse);
    const subject = await bilibiliAdapter.getSubject({ platform: 'bilibili', kind: 'video', id: 'BV1GJ411x7h7' }, ctx);
    expect(subject).toEqual({
      ref: { platform: 'bilibili', kind: 'video', id: 'BV1GJ411x7h7' },
      title: '【测试】稿件',
      url: 'https://www.bilibili.com/video/BV1GJ411x7h7',
      coverUrl: 'https://i0.hdslb.com/bfs/archive/x.jpg',
      author: { id: '486906719', name: 'UP 主', avatarUrl: 'https://i0.hdslb.com/bfs/face/up.jpg' },
      publishedAt: 1606652805 * 1000,
      declaredCommentCount: 236961,
      locator: { oid: OID, type: 1 },
    });
    expect(urls[0]).toBe('https://api.bilibili.com/x/web-interface/view?bvid=BV1GJ411x7h7');
  });

  it('av 号走 aid 查询参数且保留原 id', async () => {
    const { ctx, urls } = env(() => viewResponse);
    const subject = await bilibiliAdapter.getSubject({ platform: 'bilibili', kind: 'video', id: 'av170001' }, ctx);
    expect(urls[0]).toBe('https://api.bilibili.com/x/web-interface/view?aid=170001');
    expect(subject.ref.id).toBe('av170001');
    expect(subject.url).toBe('https://www.bilibili.com/video/BV1GJ411x7h7');
  });

  it('不支持的主体类型报 invalid-input', async () => {
    const { ctx } = env(() => viewResponse);
    await expect(
      bilibiliAdapter.getSubject({ platform: 'bilibili', kind: 'dynamic', id: '1' }, ctx),
    ).rejects.toMatchObject({ kind: 'invalid-input' });
  });

  it('稿件不可见（62002）映射为 not-found', async () => {
    const { ctx } = env(() => ({ code: 62002, message: '稿件不可见' }));
    await expect(
      bilibiliAdapter.getSubject({ platform: 'bilibili', kind: 'video', id: 'BV1zz411z7zz' }, ctx),
    ).rejects.toMatchObject({ kind: 'not-found', code: 62002 });
  });
});

describe('listRoots', () => {
  it('匿名首页：根评论与内联预览都归一化，is_end 时 next 为 null', async () => {
    const { ctx, urls } = env(withNav(() => fixture('main-hot-anon.json')));
    const page = await bilibiliAdapter.listRoots(videoSubject(), null, 'time', ctx);

    expect(page.next).toBeNull();
    expect(page.items).toHaveLength(9);
    expect(page.items.filter((comment) => comment.rootId === null).map((comment) => comment.id)).toEqual([
      '3760801399',
      '3463001426',
      '3579303711',
    ]);
    const previews = page.items.filter((comment) => comment.rootId !== null);
    expect(previews).toHaveLength(6);
    expect(previews.every((comment) => comment.rootId !== null && comment.replyCount === 0)).toBe(true);
    expect(new Set(page.items.map((comment) => comment.id)).size).toBe(page.items.length);

    expect(urls).toHaveLength(2);
    const url = urls[1]!;
    expect(url.startsWith('https://api.bilibili.com/x/v2/reply/wbi/main?')).toBe(true);
    expectValidSignature(url);
    const params = new URL(url).searchParams;
    expect(params.get('oid')).toBe(String(OID));
    expect(params.get('type')).toBe('1');
    expect(params.get('mode')).toBe('2');
    expect(params.get('web_location')).toBe('1315875');
    expect(params.get('pagination_str')).toBe('{"offset":""}');
  });

  it('翻页：把 next_offset 当作 cursor 原样回传，is_end=false 时 next 非空', async () => {
    const response = {
      code: 0,
      message: 'OK',
      data: {
        cursor: { is_end: false, pagination_reply: { next_offset: 'CAEaADICCB4=' } },
        replies: [rawReply({ rpid_str: '7' })],
        top_replies: [],
        upper: { mid: ANON_UPPER_MID },
      },
    };
    const { ctx, urls } = env(withNav(() => response));
    const page = await bilibiliAdapter.listRoots(videoSubject(), null, 'time', ctx);
    expect(page.items.map((comment) => comment.id)).toEqual(['7']);
    expect(page.next).toBe('CAEaADICCB4=');

    const second = await bilibiliAdapter.listRoots(videoSubject(), page.next, 'time', ctx);
    expect(second.next).toBe('CAEaADICCB4=');
    expect(new URL(urls[2]!).searchParams.get('pagination_str')).toBe('{"offset":"CAEaADICCB4="}');
  });

  it('置顶评论只在首页出现，与时间流重复时保留置顶标记', async () => {
    const response = {
      code: 0,
      message: 'OK',
      data: {
        cursor: { is_end: true, pagination_reply: {} },
        replies: [rawReply({ rpid_str: '7' }), rawReply({ rpid_str: '8' })],
        top_replies: [rawReply({ rpid_str: '7' })],
        upper: {},
      },
    };
    const { ctx } = env(withNav(() => response));
    const page = await bilibiliAdapter.listRoots(videoSubject(), null, 'time', ctx);
    expect(page.items.map((comment) => comment.id)).toEqual(['7', '8']);
    expect(page.items[0]!.pinned).toBe(true);
    expect(page.items[1]!.pinned).toBeUndefined();
  });

  it.each([
    [12002, 'unavailable'],
    [12061, 'unavailable'],
    [-352, 'rate-limited'],
    [-404, 'not-found'],
    [62004, 'unavailable'],
    [12345, 'protocol'],
  ])('错误码 %i → %s', async (code, kind) => {
    const { ctx } = env(withNav(() => ({ code, message: '平台原文' })));
    await expect(bilibiliAdapter.listRoots(videoSubject(), null, 'time', ctx)).rejects.toMatchObject({ kind, code });
  });

  it('响应缺少 cursor 时报 protocol', async () => {
    const { ctx } = env(withNav(() => ({ code: 0, message: 'OK', data: { replies: [], top_replies: [] } })));
    await expect(bilibiliAdapter.listRoots(videoSubject(), null, 'time', ctx)).rejects.toMatchObject({ kind: 'protocol' });
  });

  it('评论字段异常时报 protocol 并指明字段', async () => {
    const response = {
      code: 0,
      message: 'OK',
      data: {
        cursor: { is_end: true, pagination_reply: {} },
        replies: [rawReply({ content: {} })],
        top_replies: [],
        upper: {},
      },
    };
    const { ctx } = env(withNav(() => response));
    await expect(bilibiliAdapter.listRoots(videoSubject(), null, 'time', ctx)).rejects.toMatchObject({ kind: 'protocol' });
  });
});

describe('listRoots 排序维度', () => {
  const page = {
    code: 0,
    message: 'OK',
    data: { cursor: { is_end: true, pagination_reply: {} }, replies: [rawReply({ rpid_str: '7' })], top_replies: [], upper: {} },
  };

  it('order=time → mode=2；order=hot → mode=3（都在签名串里）', async () => {
    const { ctx, urls } = env(withNav(() => page));
    await bilibiliAdapter.listRoots(videoSubject(), null, 'time', ctx);
    await bilibiliAdapter.listRoots(videoSubject(), null, 'hot', ctx);

    expect(new URL(urls[1]!).searchParams.get('mode')).toBe('2');
    expect(new URL(urls[2]!).searchParams.get('mode')).toBe('3');
    for (const url of urls.slice(1)) expectValidSignature(url);
    for (const url of urls.slice(1)) expect(new URL(url).searchParams.get('seek_rpid')).toBeNull();
  });
});

describe('seekRoot', () => {
  /** 平台对 seek_rpid 的回应：目标的根评论置顶在 replies[0]，其余是正常第一页。 */
  function seekResponse(rootId: string, previews: RawJson[] = []): RawJson {
    return {
      code: 0,
      message: 'OK',
      data: {
        cursor: { is_end: false, pagination_reply: { next_offset: 'CAEaADICCB4=' } },
        replies: [
          rawReply({ rpid_str: rootId, root_str: '0', replies: previews, rcount: previews.length, count: previews.length }),
          rawReply({ rpid_str: '999' }),
        ],
        top_replies: [],
        upper: { mid: ANON_UPPER_MID },
      },
    };
  }

  it('签名串只在定位时带 seek_rpid，普通分页不带', async () => {
    const { ctx, urls } = env(withNav(() => seekResponse('123')));
    await bilibiliAdapter.seekRoot!(videoSubject(), '123', ctx);
    const params = new URL(urls[1]!).searchParams;
    expect(params.get('seek_rpid')).toBe('123');
    expect(params.get('mode')).toBe('2');
    expectValidSignature(urls[1]!);
  });

  it('目标本身是根评论：root 即该评论，items 含内联预览并去重', async () => {
    const preview = rawReply({ rpid_str: '456', root_str: '123', parent_str: '123' });
    const { ctx } = env(withNav(() => seekResponse('123', [preview])));
    const found = await bilibiliAdapter.seekRoot!(videoSubject(), '123', ctx);
    expect(found.root.id).toBe('123');
    expect(found.items.map((comment) => comment.id)).toEqual(['123', '456']);
  });

  it('目标是楼中楼：它出现在根的 replies 预览里也算命中', async () => {
    const preview = rawReply({ rpid_str: '456', root_str: '123', parent_str: '123' });
    const { ctx } = env(withNav(() => seekResponse('123', [preview])));
    const found = await bilibiliAdapter.seekRoot!(videoSubject(), '456', ctx);
    expect(found.root.id).toBe('123');
    expect(found.items.map((comment) => comment.id)).toEqual(['123', '456']);
  });

  it('replies[0] 与目标对不上 / replies 为空：not-found，绝不把别人的评论交回去', async () => {
    const mismatch = env(withNav(() => seekResponse('321')));
    await expect(bilibiliAdapter.seekRoot!(videoSubject(), '123', mismatch.ctx)).rejects.toMatchObject({
      kind: 'not-found',
      platform: 'bilibili',
    });

    const empty = env(withNav(() => ({
      code: 0,
      message: 'OK',
      data: { cursor: { is_end: true, pagination_reply: {} }, replies: [], top_replies: [], upper: {} },
    })));
    await expect(bilibiliAdapter.seekRoot!(videoSubject(), '123', empty.ctx)).rejects.toMatchObject({ kind: 'not-found' });
  });
});

describe('listThread', () => {
  it('首页：带真实根评论与楼中楼，next 游标自带根 id', async () => {
    const { ctx, urls } = env(() => fixture('detail-p1.json'));
    const page = await bilibiliAdapter.listThread(videoSubject(), '3760801399', null, ctx);

    expect(page.root?.id).toBe('3760801399');
    expect(page.root?.replyCount).toBe(2193);
    expect(page.items).toHaveLength(20);
    expect(page.items.every((comment) => comment.rootId === '3760801399')).toBe(true);
    expect(page.next).toBe(JSON.stringify({ root: '3760801399', offset: 'CAEaADICCB4=' }));
    expect(urls).toHaveLength(1);
    const params = new URL(urls[0]!).searchParams;
    expect(params.get('oid')).toBe(String(OID));
    expect(params.get('root')).toBe('3760801399');
    expect(params.get('pagination_str')).toBeNull();
  });

  it('后续页：用游标里的根 id 与 offset 继续翻，且不再返回 root', async () => {
    const firstEnv = env(() => fixture('detail-p1.json'));
    const firstPage = await bilibiliAdapter.listThread(videoSubject(), '3760801399', null, firstEnv.ctx);
    expect(firstEnv.urls).toHaveLength(1);

    const second = env(() => fixture('detail-p2.json'));
    const page = await bilibiliAdapter.listThread(videoSubject(), '3760801399', firstPage.next, second.ctx);
    expect(page.root).toBeUndefined();
    expect(page.items).toHaveLength(20);
    expect(page.next).toBe(JSON.stringify({ root: '3760801399', offset: 'CAEaADICCDg=' }));
    const params = new URL(second.urls[0]!).searchParams;
    expect(params.get('root')).toBe('3760801399');
    expect(params.get('pagination_str')).toBe('{"offset":"CAEaADICCB4="}');
  });

  it('传入楼中楼 id：先定位真实根再取那棵树', async () => {
    const subAsRoot = {
      code: 0,
      message: 'OK',
      data: {
        root: rawReply({
          rpid_str: '4012538137',
          root_str: '3760801399',
          parent_str: '3760801399',
          content: { message: '[支持]' },
        }),
        replies: [],
        cursor: { is_end: true, pagination_reply: {} },
        upper: { mid: ANON_UPPER_MID },
      },
    };
    const { ctx, urls } = env((url) =>
      url.includes('root=4012538137') ? subAsRoot : fixture('detail-p1.json'),
    );
    const page = await bilibiliAdapter.listThread(videoSubject(), '4012538137', null, ctx);

    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('root=4012538137');
    expect(urls[1]).toContain('root=3760801399');
    expect(page.root?.id).toBe('3760801399');
    expect(page.items).toHaveLength(20);
  });

  it('评论不存在（12006）映射为 not-found', async () => {
    const { ctx } = env(() => ({ code: 12006, message: '没有该评论' }));
    await expect(bilibiliAdapter.listThread(videoSubject(), '9999999999999', null, ctx)).rejects.toMatchObject({
      kind: 'not-found',
      code: 12006,
    });
  });

  it('游标无法解析时报 invalid-input', async () => {
    const { ctx } = env(() => fixture('detail-p1.json'));
    await expect(bilibiliAdapter.listThread(videoSubject(), '3760801399', 'not-json', ctx)).rejects.toMatchObject({
      kind: 'invalid-input',
    });
    await expect(bilibiliAdapter.listThread(videoSubject(), '3760801399', '[]', ctx)).rejects.toMatchObject({
      kind: 'invalid-input',
    });
    await expect(
      bilibiliAdapter.listThread(videoSubject(), '3760801399', '{"offset":"x"}', ctx),
    ).rejects.toMatchObject({ kind: 'invalid-input' });
  });
});

describe('codeToError', () => {
  it.each([
    [-101, 'auth-required'],
    [-400, 'invalid-input'],
    [-403, 'auth-required'],
    [-412, 'rate-limited'],
    [12002, 'unavailable'],
    [12006, 'not-found'],
    [62002, 'not-found'],
  ])('%i → %s', (code, kind) => {
    expect(codeToError(code, 'msg').kind).toBe(kind);
  });

  it('未知错误码带上平台原文并归为 protocol（不可重试）', () => {
    const error = codeToError(99999, '平台原文');
    expect(error.kind).toBe('protocol');
    expect(error.retryable).toBe(false);
    expect(error.message).toContain('平台原文');
    expect(error.message).toContain('99999');
    expect(codeToError(-352, 'x').retryable).toBe(true);
  });
});
