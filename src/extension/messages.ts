/**
 * 后台 → UI 的意图通道：后台把意图写进 chrome.storage.session 的 INTENT_KEY，
 * UI 启动时读取一次并监听 storage.onChanged；消费后删除该键。
 */
export const INTENT_KEY = 'loupe.intent';

export interface OpenTargetIntent {
  type: 'open-target';
  /** 交给 Workbench.resolve 的原始输入（URL / BV 号）。 */
  input: string;
  /** 右键命中的评论 id；存在时 UI 直接进入评论树分析。 */
  commentId?: string;
  /** 防重放：同一意图只消费一次。 */
  nonce: string;
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
 * UI → 后台：确保 DNR 请求头改写规则已注册。首个网络请求前必须 await 它完成，
 * 否则扩展页面发出的请求会缺 Origin/Referer 而被平台风控（HTTP 412）。
 */
export const ENSURE_HEADER_RULES = 'loupe:ensure-header-rules';

export interface EnsureHeaderRulesMessage {
  type: typeof ENSURE_HEADER_RULES;
}
