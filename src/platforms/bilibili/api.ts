/**
 * Bilibili 评论区 API 调用。这里是唯一的网络边界：信封校验、错误码映射、WBI 签名与密钥缓存。
 * 返回的是“已验证结构、字段仍是原始 JSON”的中间形态，字段级校验交给 normalize.ts。
 */
import { cacheKey } from '../../core/cache/types';
import { PlatformError, type PlatformErrorKind } from '../../core/errors';
import type { Author, Session, SubjectRef } from '../../core/model';
import type { FetchContext } from '../../core/platform';
import { arrField, asRecord, numField, optId, optNum, optionalRecord, optStr, strField, type RawObject } from './raw';
import { keyFromWbiUrl, signQuery, type WbiKeys } from './wbi';

const API_BASE = 'https://api.bilibili.com';
const NAV_KEY = cacheKey('bilibili', 'nav');
const WBI_KEYS_KEY = cacheKey('bilibili', 'wbi-keys');

/**
 * 匿名身份下的能力限制，直接展示给用户。
 * 实测 wbi/main 对匿名并不稳定：有时只给前 3 条热评（tests/fixtures/bilibili/main-hot-anon.json），
 * 有时能给出整页（2026-10-09 线上冒烟拿到 20 条根评论 + 可用游标），所以用“可能截断”的措辞。
 */
export const ANONYMOUS_LIMITATION = '未登录：顶层评论可能被平台截断（有时仅前 3 条热评），评论树不受影响';

/** 平台错误码 → 统一错误类型。未列出的码按 protocol 处理（多半是适配器需要跟进改版）。 */
const CODE_ERRORS: Record<number, { kind: PlatformErrorKind; message: string }> = {
  [-101]: { kind: 'auth-required', message: '未登录：该操作需要先登录 Bilibili' },
  [-400]: { kind: 'invalid-input', message: '请求参数错误' },
  [-403]: { kind: 'auth-required', message: '访问权限不足（登录或签名失效）' },
  [-404]: { kind: 'not-found', message: '内容不存在或已删除' },
  [-352]: { kind: 'rate-limited', message: '触发 Bilibili 风控，请稍后再试' },
  [-412]: { kind: 'rate-limited', message: '请求被 Bilibili 风控拦截，请稍后再试' },
  12002: { kind: 'unavailable', message: '评论区已关闭' },
  12006: { kind: 'not-found', message: '评论不存在或已删除' },
  12061: { kind: 'unavailable', message: '评论区不可访问' },
  62002: { kind: 'not-found', message: '稿件不存在或不可见' },
  62004: { kind: 'unavailable', message: '稿件审核中，评论区暂不可读' },
};

export function codeToError(code: number, message: string): PlatformError {
  const known = CODE_ERRORS[code];
  if (known) return new PlatformError(known.kind, known.message, { platform: 'bilibili', code });
  return new PlatformError('protocol', `Bilibili 返回未知错误码 ${code}${message === '' ? '' : `：${message}`}`, {
    platform: 'bilibili',
    code,
  });
}

interface Envelope {
  code: number;
  message: string;
  data: unknown;
}

export function readEnvelope(raw: unknown): Envelope {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new PlatformError('protocol', `Bilibili 响应不是 JSON 对象（${raw === null ? 'null' : typeof raw}）`, {
      platform: 'bilibili',
    });
  }
  const body = raw as RawObject;
  return {
    code: numField(body, 'code', '响应体'),
    message: optStr(body, 'message') ?? '',
    data: body['data'],
  };
}

async function requestData(url: string, ctx: FetchContext): Promise<unknown> {
  const envelope = readEnvelope(await ctx.http.getJson({ url }, ctx.signal));
  if (envelope.code !== 0) throw codeToError(envelope.code, envelope.message);
  return envelope.data;
}

/** nav 响应本身带登录态与 WBI 密钥，30 分钟缓存（session 级）。未登录时平台返回 -101，但 data 依然可用。 */
export async function loadNavData(ctx: FetchContext): Promise<RawObject> {
  const { value } = await ctx.cache.getOrLoad<RawObject>(NAV_KEY, 'session', async () => {
    const envelope = readEnvelope(await ctx.http.getJson({ url: `${API_BASE}/x/web-interface/nav` }, ctx.signal));
    if (envelope.code !== 0 && envelope.code !== -101) throw codeToError(envelope.code, envelope.message);
    return asRecord(envelope.data, 'nav.data');
  });
  return value;
}

/** WBI 密钥（派生自 nav 的 wbi_img），与 nav 共用同一次请求。 */
export async function loadWbiKeys(ctx: FetchContext): Promise<WbiKeys> {
  const { value } = await ctx.cache.getOrLoad<WbiKeys>(WBI_KEYS_KEY, 'session', async () => {
    const wbi = asRecord((await loadNavData(ctx))['wbi_img'], 'nav.data.wbi_img');
    return {
      imgKey: keyFromWbiUrl(strField(wbi, 'img_url', 'nav.data.wbi_img')),
      subKey: keyFromWbiUrl(strField(wbi, 'sub_url', 'nav.data.wbi_img')),
    };
  });
  return value;
}

export async function fetchSession(ctx: FetchContext): Promise<Session> {
  const nav = await loadNavData(ctx);
  if (nav['isLogin'] !== true) {
    return { platform: 'bilibili', loggedIn: false, limitations: [ANONYMOUS_LIMITATION] };
  }
  const user: Author = { id: strField(nav, 'mid', 'nav.data'), name: strField(nav, 'uname', 'nav.data') };
  const face = optStr(nav, 'face');
  if (face) user.avatarUrl = face;
  const level = optNum(optionalRecord(nav['level_info']) ?? {}, 'current_level');
  if (level !== undefined) user.level = level;
  return { platform: 'bilibili', loggedIn: true, user, limitations: [] };
}

export interface VideoView {
  aid: number;
  bvid: string;
  title: string;
  coverUrl?: string;
  publishedAt: number;
  commentCount: number;
  owner: Author;
}

export async function fetchVideoView(ref: SubjectRef, ctx: FetchContext): Promise<VideoView> {
  const query = ref.id.startsWith('av') ? `aid=${ref.id.slice(2)}` : `bvid=${encodeURIComponent(ref.id)}`;
  const data = asRecord(await requestData(`${API_BASE}/x/web-interface/view?${query}`, ctx), 'view.data');
  const owner = asRecord(data['owner'], 'view.data.owner');
  const view: VideoView = {
    aid: numField(data, 'aid', 'view.data'),
    bvid: strField(data, 'bvid', 'view.data'),
    title: strField(data, 'title', 'view.data'),
    publishedAt: numField(data, 'pubdate', 'view.data') * 1000,
    commentCount: numField(asRecord(data['stat'], 'view.data.stat'), 'reply', 'view.data.stat'),
    owner: { id: strField(owner, 'mid', 'view.data.owner'), name: strField(owner, 'name', 'view.data.owner') },
  };
  const cover = optStr(data, 'pic');
  if (cover) view.coverUrl = cover;
  const face = optStr(owner, 'face');
  if (face) view.owner.avatarUrl = face;
  return view;
}

/** 评论接口的主体定位参数（来自 Subject.locator）。 */
export interface SubjectLocator {
  oid: string;
  type: number;
}

async function signedQuery(params: Record<string, string | number>, ctx: FetchContext): Promise<string> {
  const keys = await loadWbiKeys(ctx);
  return signQuery(params, keys, Math.floor(Date.now() / 1000));
}

export interface RawRootReply {
  reply: unknown;
  /** 平台内联的楼中楼预览（最多 3 条）。 */
  previews: unknown[];
}

export interface RawRootPage {
  replies: RawRootReply[];
  topReplies: unknown[];
  nextOffset: string | null;
  isEnd: boolean;
  upperMid: string | null;
}

/** 顶层评论分页（mode=2 按时间，保证可遍历）。 */
export async function fetchRootPage(
  locator: SubjectLocator,
  cursor: string | null,
  ctx: FetchContext,
): Promise<RawRootPage> {
  const query = await signedQuery(
    {
      oid: locator.oid,
      type: locator.type,
      mode: 2,
      plat: 1,
      web_location: 1315875,
      pagination_str: JSON.stringify({ offset: cursor ?? '' }),
    },
    ctx,
  );
  const body = asRecord(await requestData(`${API_BASE}/x/v2/reply/wbi/main?${query}`, ctx), 'main.data');
  const pageCursor = asRecord(body['cursor'], 'main.data.cursor');
  const pagination = optionalRecord(pageCursor['pagination_reply']) ?? {};
  return {
    replies: arrField(body, 'replies', 'main.data').map((raw, index) => ({
      reply: raw,
      previews: arrField(asRecord(raw, `main.data.replies[${index}]`), 'replies', `main.data.replies[${index}]`),
    })),
    // 置顶热评不在时间流里，单独给出来。
    topReplies: arrField(body, 'top_replies', 'main.data'),
    nextOffset: optStr(pagination, 'next_offset') ?? null,
    isEnd: pageCursor['is_end'] === true,
    upperMid: optId(optionalRecord(body['upper']) ?? {}, 'mid') ?? null,
  };
}

export interface RawThreadPage {
  root: unknown;
  replies: unknown[];
  nextOffset: string | null;
  isEnd: boolean;
  upperMid: string | null;
}

/**
 * 评论树分页。detail 接口无需签名（实测匿名可用），root 传楼中楼 id 时会把它当根返回，
 * 调用方据返回的 root 字段回到真正的根。
 */
export async function fetchThreadPage(
  locator: SubjectLocator,
  rootId: string,
  offset: string | null,
  ctx: FetchContext,
): Promise<RawThreadPage> {
  const params = new URLSearchParams({
    oid: locator.oid,
    type: String(locator.type),
    root: rootId,
  });
  if (offset !== null) params.set('pagination_str', JSON.stringify({ offset }));
  const body = asRecord(await requestData(`${API_BASE}/x/v2/reply/detail?${params}`, ctx), 'detail.data');
  const root = asRecord(body['root'], 'detail.data.root');
  const pageCursor = asRecord(body['cursor'], 'detail.data.cursor');
  const pagination = optionalRecord(pageCursor['pagination_reply']) ?? {};
  return {
    root: body['root'],
    replies: arrField(root, 'replies', 'detail.data.root'),
    nextOffset: optStr(pagination, 'next_offset') ?? null,
    isEnd: pageCursor['is_end'] === true,
    upperMid: optId(optionalRecord(body['upper']) ?? {}, 'mid') ?? null,
  };
}
