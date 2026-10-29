/**
 * 后台 → UI 的意图通道：后台把意图写进 chrome.storage.session 的 INTENT_KEY，
 * UI 在 init 里先监听 storage.onChanged、再读一次存量键；消费后删除该键。
 * 意图带 surface（+ 侧栏的 windowId），只由目标界面消费，避免多个 UI 消费者重复跑同一次分析。
 */
export const INTENT_KEY = 'loupe.intent';

/**
 * 意图投递的目标界面。侧边栏与整页各自只消费投递给自己的意图，
 * 否则同一个全局键会被所有 UI 消费者抢走（整页已打开时也会重复跑一次分析）。
 */
export type IntentSurface = 'side-panel' | 'full-tab';

export interface OpenTargetIntent {
  type: 'open-target';
  /** 交给 Workbench.resolve 的原始输入（URL / BV 号）。 */
  input: string;
  /** 右键/按钮命中的评论 id；存在时 UI 直接进入评论树分析。 */
  commentId?: string;
  /** 防重放：同一意图只消费一次。 */
  nonce: string;
  /** 目标界面。 */
  surface: IntentSurface;
  /** 侧边栏意图的宿主窗口；只有该窗口的侧栏会消费，多窗口并存时不会串台。 */
  windowId?: number;
}

export type UiIntent = OpenTargetIntent;

/**
 * 内容脚本（页面主世界）→ 隔离世界 → 后台：记录用户最近右键的评论。
 * 后台按 tabId 存在 chrome.storage.session 的 `${LAST_COMMENT_KEY}:${tabId}`。
 */
export const LAST_COMMENT_KEY = 'loupe.lastComment';

export interface LastCommentMessage {
  type: 'loupe:last-comment';
  /** 评论 id；右键位置不在评论上时为 null。 */
  commentId: string | null;
  pageUrl: string;
}

/** 主世界脚本通过 window.postMessage 发给隔离世界脚本时使用的 source 标记。 */
export const PAGE_BRIDGE_SOURCE = 'loupe-page-bridge';

/**
 * 页面按钮（隔离世界在真实点击里同步发出）→ 后台：请求分析当前视频的评论区或某条评论的回复树。
 * 后台收到后必须在同一事件里同步打开侧边栏，用户激活不能跨 await。
 */
export const ANALYZE_REQUEST = 'loupe:analyze';

export type AnalyzeKind = 'subject' | 'thread';

export interface AnalyzeRequestMessage {
  type: typeof ANALYZE_REQUEST;
  /** subject = 整个评论区；thread = 单条评论及其回复树。 */
  kind: AnalyzeKind;
  /** kind === 'thread' 时必填，纯数字评论 id。 */
  commentId?: string;
  /** 触发点击时的页面地址；后台要求它与发送标签页的当前地址一致。 */
  pageUrl: string;
}

/** 评论 id 在边界一律要求纯数字：评论 id 只可能是数字，非数字一律视为伪造。 */
export function isCommentId(value: unknown): value is string {
  return typeof value === 'string' && /^\d+$/.test(value);
}

/** 页面按钮消息的边界校验；隔离世界发出前与后台接收时共用同一份，避免两侧漂移。 */
export function isAnalyzeRequestMessage(value: unknown): value is AnalyzeRequestMessage {
  if (typeof value !== 'object' || value === null) return false;
  const { type, kind, commentId, pageUrl } = value as Record<string, unknown>;
  if (type !== ANALYZE_REQUEST || typeof pageUrl !== 'string' || pageUrl === '') return false;
  if (kind === 'subject') return commentId === undefined;
  return kind === 'thread' && isCommentId(commentId);
}

/**
 * UI → 后台：确保 DNR 请求头改写规则已注册。首个网络请求前必须 await 它完成，
 * 否则扩展页面发出的请求会缺 Origin/Referer 而被平台风控（HTTP 412）。
 */
export const ENSURE_HEADER_RULES = 'loupe:ensure-header-rules';

export interface EnsureHeaderRulesMessage {
  type: typeof ENSURE_HEADER_RULES;
}

/**
 * 工作台 / 图谱窗口 → 后台：把某条评论定位到它所在视频的评论区。
 *
 * 后台按 input 的视频身份找已打开的 B 站视频标签页（激活并转发给它的内容脚本），找不到就记下待办
 * （见 page-comments.ts 的 LOCATE_PENDING_KEY）再新开一个标签页。定位是尽力而为的跳转：
 * 响应只有成功或一句给人看的失败原因，失败不影响工作台里已有的分析。
 */
export const LOCATE_COMMENT = 'loupe:locate-comment';

export interface LocateCommentRequest {
  type: typeof LOCATE_COMMENT;
  /** 规范视频地址（`https://www.bilibili.com/video/<BV>/…`）。 */
  input: string;
  /** 要定位到的评论 id（纯数字）。 */
  commentId: string;
}

export type LocateCommentResponse = { ok: true } | { ok: false; error: string };

/** 定位请求的边界校验：非空地址 + 纯数字评论 id。后台解析视频身份时还会再验一次地址。 */
export function isLocateCommentRequest(value: unknown): value is LocateCommentRequest {
  if (typeof value !== 'object' || value === null) return false;
  const { type, input, commentId } = value as Record<string, unknown>;
  return type === LOCATE_COMMENT && typeof input === 'string' && input !== '' && isCommentId(commentId);
}

/** 定位响应守卫：成功不带载荷，失败必须带一句可展示的原因。 */
export function isLocateCommentResponse(value: unknown): value is LocateCommentResponse {
  if (typeof value !== 'object' || value === null) return false;
  const { ok, error } = value as Record<string, unknown>;
  if (ok === true) return error === undefined;
  return ok === false && typeof error === 'string' && error !== '';
}
