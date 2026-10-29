/**
 * Bilibili 评论区 API 调用。这里是唯一的网络边界：信封校验、错误码映射、WBI 签名与密钥缓存，
 * 以及评论写操作（点赞 / 发表 / 回复）的参数装配。
 * 读接口返回的是“已验证结构、字段仍是原始 JSON”的中间形态，字段级校验交给 normalize.ts。
 *
 * 端点与参数来源：bilibili-API-collect 的 docs/comment/action.md（原仓库 2026-01 已下架，取自社区镜像
 * z0z0r4/bilibili-API-collect）——`POST /x/v2/reply/action`（oid/type/rpid/action/csrf，action 0=取消赞 1=点赞）
 * 与 `POST /x/v2/reply/add`（oid/type/message/root?/parent?/plat/csrf，message 上限 1000 字符）；
 * 错误码表亦以该文档为准。the1812/Bilibili-Evolved 的 comment-apis.ts 只管原生评论区的 DOM 增强，
 * 没有写接口，不能作为写层来源。
 */
import { cacheKey } from '../../core/cache/types';
import { PlatformError, type PlatformErrorKind } from '../../core/errors';
import type { Author, Comment, Session, Subject, SubjectRef } from '../../core/model';
import type {
  FetchContext,
  HttpClient,
  LikeCommentInput,
  PlatformWrites,
  ReplyCommentInput,
  WriteAuth,
} from '../../core/platform';
import { arrField, asRecord, numField, optId, optNum, optionalRecord, optStr, strField, type RawObject } from './raw';
import { httpsImageUrl, normalizeReply } from './normalize';
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
  [-102]: { kind: 'auth-required', message: '该账号已被封停，无法操作' },
  [-111]: { kind: 'auth-required', message: 'CSRF 校验失败：登录态已失效，请刷新页面后重试' },
  [-400]: { kind: 'invalid-input', message: '请求参数错误' },
  [-403]: { kind: 'auth-required', message: '访问权限不足（登录或签名失效）' },
  [-404]: { kind: 'not-found', message: '内容不存在或已删除' },
  [-352]: { kind: 'rate-limited', message: '触发 Bilibili 风控，请稍后再试' },
  [-412]: { kind: 'rate-limited', message: '请求被 Bilibili 风控拦截，请稍后再试' },
  [-509]: { kind: 'rate-limited', message: '操作过于频繁，请稍后再试' },
  12002: { kind: 'unavailable', message: '评论区已关闭' },
  12003: { kind: 'unavailable', message: '该评论区禁止回复' },
  12004: { kind: 'unavailable', message: '该评论禁止点赞或点踩' },
  12006: { kind: 'not-found', message: '评论不存在或已删除' },
  12009: { kind: 'invalid-input', message: '评论主体的 type 不合法' },
  12011: { kind: 'invalid-input', message: '不合法的赞或踩操作' },
  12015: { kind: 'unavailable', message: '需要评论验证码，请先在 B 站页面完成验证' },
  12016: { kind: 'invalid-input', message: '评论内容包含敏感信息' },
  12025: { kind: 'invalid-input', message: '评论字数过多' },
  12035: { kind: 'unavailable', message: '该账号被 UP 主列入评论黑名单' },
  12045: { kind: 'unavailable', message: '购买后即可发表评论' },
  12051: { kind: 'invalid-input', message: '重复评论，请勿刷屏' },
  12052: { kind: 'unavailable', message: '评论区已关闭' },
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
  if (face) user.avatarUrl = httpsImageUrl(face);
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
  if (cover) view.coverUrl = httpsImageUrl(cover);
  const face = optStr(owner, 'face');
  if (face) view.owner.avatarUrl = httpsImageUrl(face);
  return view;
}

/** 评论接口的主体定位参数（来自 Subject.locator）。 */
export interface SubjectLocator {
  oid: string;
  type: number;
}

/** 从 Subject.locator 里取 oid/type；缺失或类型不对时报错（读、写两条路共用这一个入口）。 */
export function locatorOf(subject: Subject): SubjectLocator {
  const oid = subject.locator['oid'];
  const type = subject.locator['type'];
  if ((typeof oid !== 'string' && typeof oid !== 'number') || typeof type !== 'number') {
    throw new PlatformError('protocol', '主体缺少 oid/type 定位参数，请重新解析主体', { platform: 'bilibili' });
  }
  return { oid: String(oid), type };
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

/** 正文上限（字符）：文档规定 message 最大 1000 字符。 */
const MAX_MESSAGE_LENGTH = 1000;

/** 鉴权校验：csrf 缺失就地失败；错误文本只说“缺少令牌”，绝不回显令牌本身。 */
function requireCsrf(auth: WriteAuth): string {
  const csrf = typeof auth.csrf === 'string' ? auth.csrf.trim() : '';
  if (csrf === '') {
    throw new PlatformError('invalid-input', '缺少 CSRF 令牌（bili_jct），无法执行写操作', { platform: 'bilibili' });
  }
  return csrf;
}

/** 正文校验：空白与超长在本地拦下，避免把注定失败的请求打出去。 */
function requireMessage(text: string): string {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new PlatformError('invalid-input', '评论内容不能为空', { platform: 'bilibili' });
  }
  const length = [...text].length;
  if (length > MAX_MESSAGE_LENGTH) {
    throw new PlatformError('invalid-input', `评论内容超过 ${MAX_MESSAGE_LENGTH} 字符上限（当前 ${length} 字符）`, {
      platform: 'bilibili',
    });
  }
  return text;
}

/** 写请求的信封：表单 POST 进、data 出，code !== 0 一律映射成 PlatformError。 */
async function postWrite(url: string, params: Record<string, string>, http: HttpClient): Promise<unknown> {
  const envelope = readEnvelope(await http.postForm(url, params));
  if (envelope.code !== 0) throw codeToError(envelope.code, envelope.message);
  return envelope.data;
}

/**
 * 写能力实现。csrf 由调用方（内容脚本）在写执行时现读传入，本层只在请求体里即时用一次：
 * 不缓存、不落盘、不进 URL、不进日志与错误文本。
 */
export function createBilibiliWrites(http: HttpClient): PlatformWrites {
  return {
    /** 点赞 / 取消：POST /x/v2/reply/action，action=1 点赞、0 取消。 */
    async likeComment(input: LikeCommentInput, auth: WriteAuth): Promise<void> {
      const csrf = requireCsrf(auth);
      const locator = locatorOf(input.subject);
      await postWrite(
        `${API_BASE}/x/v2/reply/action`,
        {
          oid: locator.oid,
          type: String(locator.type),
          rpid: input.commentId,
          action: input.action === 'like' ? '1' : '0',
          csrf,
        },
        http,
      );
    },

    /** 发表 / 回复：POST /x/v2/reply/add，成功返回归一化的新评论。 */
    async replyComment(input: ReplyCommentInput, auth: WriteAuth): Promise<Comment> {
      const csrf = requireCsrf(auth);
      const message = requireMessage(input.text);
      const locator = locatorOf(input.subject);
      const params: Record<string, string> = {
        oid: locator.oid,
        type: String(locator.type),
        message,
        plat: '1',
        csrf,
      };
      const target = input.commentId ?? null;
      if (target !== null) {
        if (target === '') {
          throw new PlatformError('invalid-input', '回复的目标评论 id 不能为空', { platform: 'bilibili' });
        }
        // 二级评论：root 与 parent 同为被回复的根评论；更深的回复：parent 是被回复的那条楼中楼。
        params['root'] = input.rootId === undefined || input.rootId === null || input.rootId === '' ? target : input.rootId;
        params['parent'] = target;
      }
      const data = asRecord(await postWrite(`${API_BASE}/x/v2/reply/add`, params, http), 'add.data');
      const reply = data['reply'];
      // 成功即代表评论已发出，但平台偶尔不回评论本体；没有可归一化的对象，按协议异常处理。
      if (typeof reply !== 'object' || reply === null || Array.isArray(reply)) {
        throw new PlatformError('protocol', '评论已提交，但平台未返回评论本体（请刷新评论区查看）', { platform: 'bilibili' });
      }
      return normalizeReply(reply, { path: 'add.data.reply' });
    },
  };
}
