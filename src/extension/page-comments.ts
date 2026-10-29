/**
 * 页面评论区的跨世界契约：存储键、后台消息、内容脚本 ↔ 嵌入 iframe 的 window 消息，
 * 以及「原生评论 Reddit 风格增强」的开关桥。只有字符串与类型守卫，不碰 chrome API、不碰 DOM，
 * 因此内容脚本（IIFE）、嵌入页（扩展页）都能安全引入。
 *
 * 通道各司其职：
 *   - chrome.storage.local：开关本身与待办定位（LOCATE_PENDING_KEY），内容脚本与所有 Loupe 界面共同读写；
 *   - chrome.runtime 消息：后台 ↔ 内容脚本（导航 / 定位）与嵌入页 → 后台（取当前标签页的规范地址）；
 *   - window.postMessage（reader）：内容脚本 ↔ 嵌入 iframe（就绪信号 / 导航 / 内容高度 / 宿主视口 /
 *     宿主主题 / 定位 / 写意图与写结果），按 source + origin 双重校验；
 *   - window.postMessage（style）：隔离世界 → 主世界推「原生评论样式增强」开关，主世界反向 request
 *     一次（主世界读不到 chrome.storage），见 NATIVE_STYLE_BRIDGE_SOURCE。
 *
 * 嵌入页是独立文档：它的高度、滚动与明暗都不由自己决定，而由宿主页面通过上面的桥告知，
 * 因此这三件事各有一条消息（见 READER_HEIGHT / READER_VIEWPORT / READER_THEME）。
 * 嵌入阅读器是页面开关的主路径（开启即替换原生评论区），写操作经 READER_WRITE_REQUEST /
 * READER_WRITE_RESULT 交回内容脚本执行——csrf 只在内容脚本的写执行点现读现用，绝不跨桥。
 */
import { isPlatformErrorKind } from '../core/errors';
import type { PlatformErrorKind } from '../core/errors';
import type { Comment } from '../core/model';
import { isCommentId } from './messages';

/**
 * 全局设置：是否把 B 站视频页的原生评论区换成 Loupe 的嵌入阅读器（开启 = 替换模式）。
 * 默认关闭（缺省即 false）。只改呈现：内容脚本隐藏原生评论根、在原位挂载 iframe 阅读器，
 * 点赞 / 回复 / 发表都经阅读器桥交回内容脚本执行；关闭即精确还原原生评论区。
 */
export const PAGE_COMMENTS_ENABLED_KEY = 'loupe.pageComments.enabled';

/** 嵌入页 → 后台：请求当前标签页的规范视频地址。只信 sender，绝不读页面 query 或页面消息。 */
export const EMBEDDED_CONTEXT = 'loupe:embedded-context';

export interface EmbeddedContextResponse {
  ok: boolean;
  /** 规范视频地址（`https://www.bilibili.com/video/<BV>/…`，已去掉评论锚点）；ok 为 false 时不存在。 */
  input?: string;
  /** 失败原因，可直接展示。 */
  error?: string;
}

export function isEmbeddedContextResponse(value: unknown): value is EmbeddedContextResponse {
  if (typeof value !== 'object' || value === null) return false;
  const { ok, input, error } = value as Record<string, unknown>;
  if (typeof ok !== 'boolean') return false;
  if (input !== undefined && typeof input !== 'string') return false;
  return error === undefined || typeof error === 'string';
}

/** 后台 → 内容脚本：标签页地址变化（含 SPA 换页）。内容脚本据此重估是否替换/还原。 */
export const PAGE_NAVIGATION = 'loupe:page-navigation';

export interface PageNavigationMessage {
  type: typeof PAGE_NAVIGATION;
}

export function isPageNavigationMessage(value: unknown): value is PageNavigationMessage {
  return typeof value === 'object' && value !== null && (value as Record<string, unknown>).type === PAGE_NAVIGATION;
}

/**
 * window.postMessage 的 source 标记：页面脚本也能往 window 发消息，
 * 只有带这个标记、且 origin/source 都对得上的消息才当数。
 */
export const READER_BRIDGE_SOURCE = 'loupe-page-reader';

/** 嵌入页 → 内容脚本：UI 已挂载（此刻才允许隐藏原生评论区；抓取仍在进行）。 */
export const READER_READY = 'loupe:reader-ready';

/** 内容脚本 → 嵌入页：页面地址变了，重新解析目标。 */
export const READER_NAVIGATION = 'loupe:reader-navigation';

/**
 * 嵌入页 → 内容脚本：内容高度变了。
 * 槽位（iframe）高度跟随它，于是滚动条只剩宿主页面那一根，iframe 内部永远不出现滚动条。
 */
export const READER_HEIGHT = 'loupe:reader-height';

/**
 * 内容脚本 → 嵌入页：宿主视口底边在嵌入文档坐标系里的位置（槽位还在视口下方时为负）。
 * 嵌入页据此在滚到已渲染内容底部时按需取下一页顶层评论。
 */
export const READER_VIEWPORT = 'loupe:reader-viewport';

/** 内容脚本 → 嵌入页：宿主页面（B 站）当前的明暗主题，落到嵌入页的 `<html data-theme>`。 */
export const READER_THEME = 'loupe:reader-theme';

export type ReaderTheme = 'light' | 'dark';

/** 嵌入页 iframe 的扩展内路径；manifest 的 web_accessible_resources 必须覆盖它。 */
export const EMBEDDED_PAGE_PATH = 'src/ui/embedded.html';

export interface ReaderBridgeMessage {
  source: typeof READER_BRIDGE_SOURCE;
  type: string;
}

/** 校验桥消息：source 标记 + 指定的 type。origin/source（frame）由各自的监听方另行校验。 */
export function isReaderBridgeMessage(value: unknown, type: string): value is ReaderBridgeMessage {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.source === READER_BRIDGE_SOURCE && record.type === type;
}

export interface ReaderHeightMessage extends ReaderBridgeMessage {
  type: typeof READER_HEIGHT;
  /** 嵌入页内容高度（CSS 像素）。 */
  height: number;
}

export function isReaderHeightMessage(value: unknown): value is ReaderHeightMessage {
  if (!isReaderBridgeMessage(value, READER_HEIGHT)) return false;
  const { height } = value as Partial<ReaderHeightMessage>;
  return typeof height === 'number' && Number.isFinite(height) && height >= 0;
}

export interface ReaderViewportMessage extends ReaderBridgeMessage {
  type: typeof READER_VIEWPORT;
  /** 宿主视口底边在嵌入文档坐标系里的位置（CSS 像素，可为负）。 */
  visibleBottom: number;
}

export function isReaderViewportMessage(value: unknown): value is ReaderViewportMessage {
  if (!isReaderBridgeMessage(value, READER_VIEWPORT)) return false;
  const { visibleBottom } = value as Partial<ReaderViewportMessage>;
  return typeof visibleBottom === 'number' && Number.isFinite(visibleBottom);
}

export interface ReaderThemeMessage extends ReaderBridgeMessage {
  type: typeof READER_THEME;
  theme: ReaderTheme;
}

export function isReaderThemeMessage(value: unknown): value is ReaderThemeMessage {
  if (!isReaderBridgeMessage(value, READER_THEME)) return false;
  const { theme } = value as Partial<ReaderThemeMessage>;
  return theme === 'light' || theme === 'dark';
}

/**
 * 「在评论区定位某条评论」的协议：工作台 / 图谱窗口点按钮 → 后台 → 视频页内容脚本 → 嵌入阅读器。
 *
 * 三个世界各管一段，每一段都只认自己那份契约：
 *   1. 扩展页把 {@link LOCATE_COMMENT}（见 messages.ts）发给后台；
 *   2. 后台按视频身份找已打开的 B 站视频标签页（激活 + 转发），没找到就写下 {@link LOCATE_PENDING_KEY}
 *      再新开标签页；
 *   3. 视频页的内容脚本把下面这条桥消息投进嵌入阅读器，阅读器只负责滚动与高亮。
 *
 * 内容脚本在 iframe 还没挂载 / 还没 READY 时先存着，`READER_READY` 之后补发一次，因此定位绝不丢。
 */
export const READER_LOCATE = 'loupe:reader-locate';

export interface ReaderLocateMessage extends ReaderBridgeMessage {
  type: typeof READER_LOCATE;
  /** 要定位到的评论 id（顶层评论与楼中楼都接受）。 */
  commentId: string;
}

export function isReaderLocateMessage(value: unknown): value is ReaderLocateMessage {
  if (!isReaderBridgeMessage(value, READER_LOCATE)) return false;
  const { commentId } = value as Partial<ReaderLocateMessage>;
  return isCommentId(commentId);
}

/**
 * 待办定位的存储键（`chrome.storage.local`）：点「在评论区定位」时那个视频**没有**已打开的标签页，
 * 后台就先把这次定位记在这里再新开标签页；新页的内容脚本挂载时读一次，视频身份对得上才消费（读后即删）。
 *
 * 用 local 而不是 session：`storage.session` 默认不对内容脚本开放，而消费方正是内容脚本。
 */
export const LOCATE_PENDING_KEY = 'loupe.locatePending';

export interface PendingLocate {
  /** 规范视频地址（后台已归一化，见 url.ts 的 canonicalVideoUrl）。 */
  input: string;
  commentId: string;
  /** 防重放：每次写入都换一个，同一条待办只消费一次。 */
  nonce: string;
}

export function isPendingLocate(value: unknown): value is PendingLocate {
  if (typeof value !== 'object' || value === null) return false;
  const { input, commentId, nonce } = value as Record<string, unknown>;
  if (typeof input !== 'string' || input === '') return false;
  return isCommentId(commentId) && typeof nonce === 'string' && nonce !== '';
}

/**
 * 视频页地址 → 视频身份（BV 号，前缀统一成大写 `BV`）；不是 `www.bilibili.com/video/<BV>` 就返回 null。
 * 定位协议两端共用：后台按它挑已打开的标签页，内容脚本按它判断待办定位是不是本页的
 * ——分集参数 `?p=`、跟踪参数与评论锚点都不影响身份。
 *
 * BV 号规则与 `src/platforms/bilibili/url.ts` 一致（`BV` + 10 位 base58）；这里只做身份比对，
 * 不参与「这是什么目标」的解析，因此不引入适配器。
 */
export function videoIdOf(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.origin !== 'https://www.bilibili.com') return null;
  const segment = /^\/video\/([^/]+)/.exec(url.pathname)?.[1] ?? '';
  const bv = /^[Bb][Vv]([1-9A-HJ-NP-Za-km-z]{10})$/.exec(segment);
  return bv === null ? null : `BV${bv[1]}`;
}

/**
 * 嵌入页 → 内容脚本：鼠标进/出某条评论的作者（头像或昵称），请宿主显示/收起**站点自己的**用户卡片。
 *
 * 为什么不自己画卡片：B 站的用户卡片是站点主世界里的自定义元素（`bili-user-profile`），它自己取数、
 * 自己定位、自带关注/私信按钮；嵌入页是独立文档，既拿不到那个元素，也不该照抄一份会随站点改版过期的 UI。
 * 所以这条消息只传「谁 + 在哪儿」，由内容脚本把坐标换算到宿主坐标系后交给主世界的适配器驱动它。
 *
 * `rect` 是**嵌入文档坐标系**（iframe 内部不滚动，等价于 iframe 视口坐标）；`null` 表示收起。
 */
export const READER_USER_CARD = 'loupe:reader-user-card';

export interface ReaderUserCardMessage extends ReaderBridgeMessage {
  type: typeof READER_USER_CARD;
  /**
   * 这次状态变化针对的用户 id（bilibili 即 mid，纯数字）。
   * 收起也带上：迟到的收起消息不能关掉「已经换到别人身上」的卡片。
   */
  mid: string;
  /** 头像/昵称在嵌入文档里的位置；null = 收起这位作者的卡片。 */
  rect: UserCardRect | null;
}

/** 卡片锚点矩形（CSS 像素，调用方各自坐标系）。 */
export interface UserCardRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function isUserCardRect(value: unknown): value is UserCardRect {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (['left', 'top', 'width', 'height'] as const).every((key) => {
    const number = record[key];
    return typeof number === 'number' && Number.isFinite(number);
  });
}

export function isReaderUserCardMessage(value: unknown): value is ReaderUserCardMessage {
  if (!isReaderBridgeMessage(value, READER_USER_CARD)) return false;
  const { mid, rect } = value as Partial<ReaderUserCardMessage>;
  if (typeof mid !== 'string' || !/^\d{1,20}$/.test(mid)) return false;
  return rect === null || isUserCardRect(rect);
}

/**
 * 嵌入页 → 内容脚本：一次写意图（点赞 / 取消点赞 / 回复 / 发表顶层评论）。
 * 内容脚本是唯一的执行者——写请求必须由页面上下文发出（cookie 与 Origin 都只在页面里），
 * iframe 只表达意图并拿结果，绝不自己发写请求。
 */
export const READER_WRITE_REQUEST = 'loupe:reader-write';

/** 内容脚本 → 嵌入页：上面那次写的结果（成功/失败，成功回复时带新评论）。 */
export const READER_WRITE_RESULT = 'loupe:reader-write-result';

/** 写意图：点赞、取消点赞、回复（不带 rootId/parentId 即发表新的顶层评论）。 */
export type ReaderWriteOp = 'like' | 'unlike' | 'reply';

/**
 * 正文长度上限（与 B 站 `message` 上限一致，也用作输入框的 maxlength）。
 * 按 UTF-16 码元计（emoji 记 2），与 `maxlength` 的计数方式相同：桥上的校验绝不比输入框宽松。
 */
export const READER_COMMENT_MAX_LENGTH = 1000;

/** requestId 只用于把结果配回请求：内容脚本原样回投，因此只校验「非空且不太长」。 */
const READER_REQUEST_ID_MAX_LENGTH = 64;

export interface ReaderWriteRequest extends ReaderBridgeMessage {
  type: typeof READER_WRITE_REQUEST;
  /** 往返配对：内容脚本原样回投，嵌入页据此丢弃迟到或重复的结果。 */
  requestId: string;
  op: ReaderWriteOp;
  /** like / unlike 的目标评论 id（顶层评论与楼中楼都接受）；reply 不用。 */
  commentId?: string;
  /** reply：评论树的真实根评论 id；发表顶层评论时省略。 */
  rootId?: string;
  /** reply：被回复的评论 id；发表顶层评论时省略。 */
  parentId?: string;
  /** reply：正文（顶层评论与楼中楼都必填）。 */
  text?: string;
}

export interface ReaderWriteResult extends ReaderBridgeMessage {
  type: typeof READER_WRITE_RESULT;
  requestId: string;
  ok: boolean;
  /** 失败原因（可直接展示）；ok 为 true 时不存在，且任何情况下都不含 csrf。 */
  error?: string;
  /** reply 成功时的新评论（已归一化）；失败或点赞时不存在。 */
  comment?: Comment;
}

function isReaderRequestId(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value.length <= READER_REQUEST_ID_MAX_LENGTH;
}

/**
 * 写意图守卫：source + type + requestId + op 枚举，再加该 op 自己的必填项。
 * like / unlike 只要 commentId；reply 只要 text，回复楼中楼时 rootId 与 parentId 必须成对出现
 * （只给其中一个说明发送方状态不一致，宁可拒绝也不猜）。
 */
export function isReaderWriteRequest(value: unknown): value is ReaderWriteRequest {
  if (!isReaderBridgeMessage(value, READER_WRITE_REQUEST)) return false;
  const { requestId, op, commentId, rootId, parentId, text } = value as Partial<ReaderWriteRequest>;
  if (!isReaderRequestId(requestId)) return false;
  if (op === 'like' || op === 'unlike') {
    return isCommentId(commentId) && rootId === undefined && parentId === undefined && text === undefined;
  }
  if (op !== 'reply' || commentId !== undefined) return false;
  if ((rootId === undefined) !== (parentId === undefined)) return false;
  if (rootId !== undefined && (!isCommentId(rootId) || !isCommentId(parentId))) return false;
  return typeof text === 'string' && text.trim() !== '' && text.length <= READER_COMMENT_MAX_LENGTH;
}

/** 写结果守卫：失败必须带一句可展示的原因，成功回复时带的评论至少要有 id。 */
export function isReaderWriteResult(value: unknown): value is ReaderWriteResult {
  if (!isReaderBridgeMessage(value, READER_WRITE_RESULT)) return false;
  const { requestId, ok, error, comment } = value as Partial<ReaderWriteResult>;
  if (!isReaderRequestId(requestId) || typeof ok !== 'boolean') return false;
  if (error !== undefined && (typeof error !== 'string' || error === '')) return false;
  if (!ok) return typeof error === 'string';
  if (comment === undefined) return true;
  return typeof comment === 'object' && comment !== null && typeof (comment as Comment).id === 'string';
}

/**
 * 嵌入页 → 内容脚本：一次读请求（只读 GET）。
 *
 * 与写意图同一个道理，只是方向相反：读接口也必须由 B 站页面上下文发出。iframe 是扩展源，
 * 对 api.bilibili.com 属于跨站请求，带不上站点 Cookie——平台按匿名身份给小票，顶层评论翻到
 * `is_end` 就停（约 315 条），与原生评论区（同站、带 Cookie）能读到的全量差得很远；
 * 内容脚本的请求以宿主页面为发起源，同站带 Cookie，读到的就是原生那份。
 *
 * 请求里只有 URL（签名仍在 iframe 里算好）与可选请求头，凭据由浏览器在页面上下文自己带上；
 * 结果里只有解析后的 JSON 或错误的类别与文案（文案来自传输层的错误映射，不含响应体与响应头）。
 * 两个方向都绝不出现 Cookie，也绝不放行 api.bilibili.com 以外的地址。
 */
export const READER_FETCH_REQUEST = 'loupe:reader-fetch';

/** 内容脚本 → 嵌入页：上面那次读的结果（解析后的 JSON，或可重建同类错误的信息）。 */
export const READER_FETCH_RESULT = 'loupe:reader-fetch-result';

/**
 * 读桥唯一放行的源：协议、主机、端口必须完全等于它（含 userinfo / 子域在内的其它写法都会被
 * URL 规范成不同的 origin，因此一律拒绝）。读取桥只做只读、同站，绝不当通用代理用。
 */
export const READER_FETCH_ORIGIN = 'https://api.bilibili.com';

export interface ReaderFetchRequest extends ReaderBridgeMessage {
  type: typeof READER_FETCH_REQUEST;
  /** 往返配对：内容脚本原样回投，嵌入页据此丢弃迟到或重复的结果。 */
  requestId: string;
  /** 绝对 URL（查询串已含签名）；只有 {@link READER_FETCH_ORIGIN} 上的 https 地址才放行。 */
  url: string;
  /** 附加请求头（读接口目前不需要）；cookie 一律拒绝——凭据只由浏览器在页面上下文带上。 */
  headers?: Record<string, string>;
}

/** 只认 https + api.bilibili.com + 默认端口；解析不了的一律不放行。 */
function isReaderFetchUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value === '') return false;
  try {
    return new URL(value).origin === READER_FETCH_ORIGIN;
  } catch {
    return false;
  }
}

/** 读请求头：键值都是非空字符串，且没有 cookie（凭据绝不跨桥，两个方向都一样）。 */
function isReaderFetchHeaders(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  for (const [name, header] of Object.entries(value)) {
    if (name === '' || typeof header !== 'string') return false;
    if (name.toLowerCase() === 'cookie') return false;
  }
  return true;
}

/**
 * 读请求守卫：source + type + requestId + 只放行 api.bilibili.com 的 HTTPS 地址。
 * 方法维度上只有 GET——请求类型里根本没有方法字段，桥因此天然发不出写请求。
 */
export function isReaderFetchRequest(value: unknown): value is ReaderFetchRequest {
  if (!isReaderBridgeMessage(value, READER_FETCH_REQUEST)) return false;
  const { requestId, url, headers } = value as Partial<ReaderFetchRequest>;
  if (!isReaderRequestId(requestId) || !isReaderFetchUrl(url)) return false;
  return headers === undefined || isReaderFetchHeaders(headers);
}

export interface ReaderFetchSuccess extends ReaderBridgeMessage {
  type: typeof READER_FETCH_RESULT;
  requestId: string;
  ok: true;
  /** 响应体解析出的 JSON（平台读接口给的是对象；`null` 也是合法 JSON）。 */
  json: unknown;
}

export interface ReaderFetchFailure extends ReaderBridgeMessage {
  type: typeof READER_FETCH_RESULT;
  requestId: string;
  ok: false;
  /**
   * 错误类别（与 core 的 PlatformError 同枚举）：iframe 据此重建同一种错误，
   * 上游才有依据判断能不能退避重试（限流 / 网络可重试，协议错误不可）。
   */
  kind: PlatformErrorKind;
  /** 可直接展示的原因；绝不含 Cookie、请求头与响应头。 */
  error: string;
  /** 平台 / HTTP 原始码（若已拿到响应）。 */
  code?: number;
}

/**
 * 读结果：成功带解析后的 JSON，失败带「类别 + 文案」——足以在 iframe 里重建同一种 PlatformError。
 * 响应头不跨桥（红线），所以平台给的 `Retry-After` 也不会传过来：限流重试按退避曲线进行。
 */
export type ReaderFetchResult = ReaderFetchSuccess | ReaderFetchFailure;

/** 读结果守卫：成功必须带解析后的 JSON，失败必须带已知类别与一句可展示的原因。 */
export function isReaderFetchResult(value: unknown): value is ReaderFetchResult {
  if (typeof value !== 'object' || value === null) return false;
  // 结果是判别联合：先按「未知对象」把字段读成局部量，校验通过之后类型才收窄成两分支之一。
  const { requestId, ok, json, kind, error, code } = value as Record<string, unknown>;
  if (!isReaderBridgeMessage(value, READER_FETCH_RESULT)) return false;
  if (!isReaderRequestId(requestId) || typeof ok !== 'boolean') return false;
  if (ok) return json !== undefined && kind === undefined && error === undefined;
  if (!isPlatformErrorKind(kind) || typeof error !== 'string' || error === '') return false;
  return code === undefined || (typeof code === 'number' && Number.isFinite(code));
}

/**
 * 「原生评论 Reddit 风格增强」开关桥的 source 标记。
 * 主世界内容脚本读不到 chrome.storage，开关状态由隔离世界推送；主世界启动时反向 request 一次，
 * 两边脚本的执行顺序不会丢掉首帧状态。页面脚本也能伪造它，但后果只是改样式，不涉及数据与接口。
 *
 * 注意：页面开关（PAGE_COMMENTS_ENABLED_KEY）已改为驱动评论区替换，不再驱动样式增强，隔离世界
 * 也不再推这条消息；这条契约与 native-comments-style.ts / native-thread.ts 一起保留原样，
 * 由那两个模块自己的测试覆盖。
 */
export const NATIVE_STYLE_BRIDGE_SOURCE = 'loupe-native-comment-style';

/** 隔离世界 → 主世界：当前开关状态。 */
export interface NativeStyleToggleMessage {
  source: typeof NATIVE_STYLE_BRIDGE_SOURCE;
  type: 'toggle';
  enabled: boolean;
}

/** 主世界 → 隔离世界：请把当前开关状态再推一次。 */
export interface NativeStyleRequestMessage {
  source: typeof NATIVE_STYLE_BRIDGE_SOURCE;
  type: 'request';
}

export type NativeStyleBridgeMessage = NativeStyleToggleMessage | NativeStyleRequestMessage;

export function isNativeStyleToggleMessage(value: unknown): value is NativeStyleToggleMessage {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.source === NATIVE_STYLE_BRIDGE_SOURCE && record.type === 'toggle' && typeof record.enabled === 'boolean';
}

export function isNativeStyleRequestMessage(value: unknown): value is NativeStyleRequestMessage {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.source === NATIVE_STYLE_BRIDGE_SOURCE && record.type === 'request';
}

/**
 * 「站点用户卡片」桥的 source 标记：隔离世界 → 主世界。
 *
 * 与样式开关桥同路（`window.postMessage`，主世界读不到 chrome.*，也拿不到嵌入页的消息），
 * 但用途不同：卡片只能在主世界驱动——站点把 `bili-user-profile` 定义在页面那份自定义元素注册表里，
 * 隔离世界的 `customElements` 是另一份（实测拿不到该元素的方法）。所以隔离世界只做校验与坐标换算，
 * 真正的显示/收起由主世界的适配器（`content/user-card.ts`）调站点元素自己的 `setup()` 完成。
 */
export const USER_CARD_BRIDGE_SOURCE = 'loupe-user-card';

/**
 * 隔离世界 → 主世界：显示某位用户的卡片（坐标已换算成宿主视口坐标系），或收起。
 *
 * 收起分两种，用途不同：
 *   - 带 `mid`：只收起这位作者的卡片（嵌入页的 mouseleave；迟到的消息不会关掉已经换到别人身上的卡片）；
 *   - 不带 `mid`：无条件收起（槽位被拆、宿主滚动、指针离开阅读器——锚点已经不存在了）。
 */
export interface UserCardBridgeMessage {
  source: typeof USER_CARD_BRIDGE_SOURCE;
  type: 'show' | 'hide';
  /** show 时必带；hide 时可选（见上）。目标用户 id（bilibili 即 mid）。 */
  mid?: string;
  /** show 时必带：卡片锚点（头像/昵称）在宿主视口坐标系里的位置。 */
  rect?: UserCardRect;
}

export function isUserCardBridgeMessage(value: unknown): value is UserCardBridgeMessage {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.source !== USER_CARD_BRIDGE_SOURCE) return false;
  const midOk = record.mid === undefined || (typeof record.mid === 'string' && /^\d{1,20}$/.test(record.mid));
  if (!midOk) return false;
  if (record.type === 'hide') return true;
  if (record.type !== 'show') return false;
  return typeof record.mid === 'string' && isUserCardRect(record.rect);
}

/**
 * 扩展上下文失效（扩展被重载 / 更新 / 停用）后的 chrome.* 失败文案：同步抛错与 promise 拒绝都是这两种。
 * 调用方据此熔断——不再重试，也不再往控制台丢未处理的拒绝。
 */
const INVALIDATED_PATTERNS = [
  /extension context invalidated/i,
  /message port closed before a response was received/i,
];

export function isExtensionContextInvalidated(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return INVALIDATED_PATTERNS.some((pattern) => pattern.test(message));
}
