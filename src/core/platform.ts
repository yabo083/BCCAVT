/**
 * 平台接缝（Seam）。一个平台 = 一个实现此接口的对象，登记进 src/platforms/index.ts。
 * 没有动态加载、没有插件框架：接口极简，换平台只换实现。
 */
import type { Cache } from './cache/types';
import type { Cursor, Page, PlatformId, Session, Subject, SubjectRef, Target, ThreadPage, Comment } from './model';

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
}

export interface FetchContext {
  http: HttpClient;
  /** 适配器私有的小型缓存（如 WBI 密钥）。键由适配器自行加平台前缀。 */
  cache: Cache;
  signal: AbortSignal;
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
   * 顶层评论分页（按时间，保证可遍历完整）。items 可以夹带平台内联预览的楼中楼（rootId 非 null），
   * 引擎按 id 去重，并以 replyCount 与已知回复数比较决定是否需要 listThread。
   */
  listRoots(subject: Subject, cursor: Cursor | null, ctx: FetchContext): Promise<Page<Comment>>;

  /** 一棵评论树的回复分页。commentId 可为楼中楼，适配器负责定位真实根；首页必须带 root。 */
  listThread(subject: Subject, commentId: string, cursor: Cursor | null, ctx: FetchContext): Promise<ThreadPage>;
}
