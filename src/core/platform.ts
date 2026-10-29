/**
 * 平台接缝（Seam）。一个平台 = 一个实现此接口的对象，登记进 src/platforms/index.ts。
 * 没有动态加载、没有插件框架：接口极简，换平台只换实现。
 */
import type { Cache } from './cache/types';
import type { Cursor, Page, PlatformId, RootOrder, Session, Subject, SubjectRef, Target, ThreadPage, Comment } from './model';

export interface HttpRequest {
  /** 绝对 URL，查询串已由适配器拼好（含签名）。 */
  url: string;
  headers?: Record<string, string>;
}

/**
 * 平台请求一律走这里：带 Cookie（credentials: include）、遵守适配器的礼貌参数、可取消。
 * 只负责传输与 HTTP 级错误映射，不重试、不缓存。
 * - 网络失败 → PlatformError('network')
 * - HTTP 412/429 → PlatformError('rate-limited', code=status)
 * - 其他非 2xx → PlatformError('protocol', code=status)
 * - 非 JSON → PlatformError('protocol')
 * - signal 取消 → PlatformError('aborted')
 */
export interface HttpClient {
  getJson<T = unknown>(request: HttpRequest, signal: AbortSignal): Promise<T>;
  /**
   * 表单 POST（application/x-www-form-urlencoded），带 Cookie。错误映射与 getJson 完全一致。
   * 参数里可能带写操作的凭据（csrf），实现方绝不能把参数写进日志、错误文本或缓存键。
   */
  postForm(url: string, params: Record<string, string>): Promise<unknown>;
  /**
   * 该传输层发出请求时所处的身份姿态（`'page'` = 由站点页面上下文代发，带站点 Cookie；
   * 缺省视为 `'direct'` = 扩展源直连）。引擎把它传给适配器的 FetchContext，供「与身份绑定的
   * 数据」（登录态 nav 等）建键；它不承诺登录与否，只承诺「从哪里发」。
   */
  readonly identity?: string;
}

export interface FetchContext {
  http: HttpClient;
  /** 适配器私有的小型缓存（如 WBI 密钥）。键由适配器自行加平台前缀。 */
  cache: Cache;
  signal: AbortSignal;
  /** 本次请求的身份姿态：与 `HttpClient.identity` 同源（`'direct'` / `'page'`）。 */
  identity: string;
}

/** 扩展为该平台请求改写的请求头（如 Origin/Referer）。由后台以 declarativeNetRequest 下发，仅作用于扩展自身发起的请求。 */
export interface HeaderRewrite {
  /** declarativeNetRequest urlFilter 语法，例如 '||api.bilibili.com/'。 */
  urlFilter: string;
  set: Record<string, string>;
}

export interface Politeness {
  /** 同一平台的最大并发请求数。 */
  concurrency: number;
  /** 相邻两次请求开始的最小间隔。 */
  minIntervalMs: number;
}

/**
 * 写操作的鉴权参数。csrf（bilibili 的 bili_jct）由调用方在写执行时从 document.cookie 现读，
 * 只在本层拼进请求体即时使用：绝不跨桥、绝不进日志 / 快照 / 缓存键 / storage / 错误文本。
 */
export interface WriteAuth {
  csrf: string;
}

export interface LikeCommentInput {
  /** 目标主体：适配器从 subject.locator 取 oid/type（与 listRoots 用的是同一个 Subject）。 */
  subject: Subject;
  /** 目标评论 id，顶层评论与楼中楼都接受。 */
  commentId: string;
  action: 'like' | 'unlike';
}

export interface ReplyCommentInput {
  /** 目标主体：同上。 */
  subject: Subject;
  /** 被回复的评论 id；省略 / null = 发表新的顶层评论。 */
  commentId?: string | null;
  /** 评论树真实根 id：回复楼中楼时给出；省略时以 commentId 自身为根（即直接回复一条根评论）。 */
  rootId?: string | null;
  /** 正文；平台上限由适配器校验。 */
  text: string;
}

/** 平台的写能力。凭据只经 auth 参数进入，适配器自身绝不读 cookie。 */
export interface PlatformWrites {
  /** 点赞 / 取消点赞。平台返回 code 0 即 resolve。 */
  likeComment(input: LikeCommentInput, auth: WriteAuth): Promise<void>;
  /** 发表评论 / 回复，成功后返回归一化的新评论。 */
  replyComment(input: ReplyCommentInput, auth: WriteAuth): Promise<Comment>;
}

export interface PlatformAdapter {
  readonly id: PlatformId;
  readonly name: string;
  /** manifest host_permissions 必须覆盖的匹配模式。 */
  readonly hostPermissions: readonly string[];
  readonly headerRewrites: readonly HeaderRewrite[];
  readonly politeness: Politeness;

  /** 把用户输入（URL、BV 号、带 #reply 锚点的链接……）解析成目标；无法识别返回 null。纯函数，不发请求。 */
  parseTarget(input: string): Target | null;

  /** 当前浏览器身份（鉴权状态）。 */
  getSession(ctx: FetchContext): Promise<Session>;

  getSubject(ref: SubjectRef, ctx: FetchContext): Promise<Subject>;

  /**
   * 顶层评论分页。items 可以夹带平台内联预览的楼中楼（rootId 非 null），
   * 引擎按 id 去重，并以 replyCount 与已知回复数比较决定是否需要 listThread。
   * order 是排序维度：'time' 按时间、保证可遍历完整；'hot' 平台热度序，分页形态由适配器决定。
   */
  listRoots(subject: Subject, cursor: Cursor | null, order: RootOrder, ctx: FetchContext): Promise<Page<Comment>>;

  /** 一棵评论树的回复分页。commentId 可为楼中楼，适配器负责定位真实根；首页必须带 root。 */
  listThread(subject: Subject, commentId: string, cursor: Cursor | null, ctx: FetchContext): Promise<ThreadPage>;

  /**
   * 可选：按评论 id 定点取回它所在的根评论块（一次请求的「定位读取」，不翻页）。
   * 平台没有 seek 语义时缺省，调用方按 unavailable 处理；找不到该评论应抛 not-found。
   */
  seekRoot?(subject: Subject, commentId: string, ctx: FetchContext): Promise<SeekResult>;

  /** 可选写能力（点赞 / 回复）；缺省表示该平台只读。 */
  readonly writes?: PlatformWrites;
}

/** 定点定位的结果：目标评论所在的根评论块。 */
export interface SeekResult {
  /** 目标所在的根评论（commentId 本身是根时就是它）。 */
  root: Comment;
  /** 根 + 平台内联的楼中楼预览，按 id 去重（含目标评论）。 */
  items: Comment[];
}
