/**
 * 后台 Service Worker（ESM）。
 * 职责：侧边栏点击行为、按适配器下发请求头改写（DNR 会话规则）、右键菜单、页面按钮消息，
 * 以及把内容脚本上报的「最近右键的评论」按标签页暂存，供菜单点击时组装意图。
 */
import { adapters } from '@/platforms';
import {
  ENSURE_HEADER_RULES,
  INTENT_KEY,
  LAST_COMMENT_KEY,
  isAnalyzeRequestMessage,
  isCommentId,
  type AnalyzeRequestMessage,
  type EnsureHeaderRulesMessage,
  type LastCommentMessage,
  type OpenTargetIntent,
} from './messages';
import { canonicalVideoUrl, isVideoPageUrl } from './url';

/** 会话规则 id 预留区间：注册前整段删除，适配器增减改写时不会残留旧规则。 */
const HEADER_RULE_ID_BASE = 1;
const HEADER_RULE_ID_SPAN = 256;

const MENU_ANALYZE_SUBJECT = 'loupe:analyze-subject';
const MENU_ANALYZE_THREAD = 'loupe:analyze-thread';

/** 评论 UI 只在视频页；与 manifest 的 content_scripts 匹配保持一致。 */
const VIDEO_PAGE_PATTERNS = ['https://www.bilibili.com/video/*'];

/** 侧边栏意图的投递面：只有侧栏会消费它，整页 UI 不会被同一条意图重复触发。 */
const PANEL_SURFACE = 'side-panel';


function headerRewriteRules(): chrome.declarativeNetRequest.Rule[] {
  const rules: chrome.declarativeNetRequest.Rule[] = [];
  for (const adapter of adapters) {
    for (const rewrite of adapter.headerRewrites) {
      rules.push({
        id: HEADER_RULE_ID_BASE + rules.length,
        priority: 1,
        action: {
          type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
          requestHeaders: Object.entries(rewrite.set).map(([header, value]) => ({
            header,
            operation: chrome.declarativeNetRequest.HeaderOperation.SET,
            value,
          })),
        },
        condition: {
          urlFilter: rewrite.urlFilter,
          initiatorDomains: [chrome.runtime.id],
          resourceTypes: [
            chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
            chrome.declarativeNetRequest.ResourceType.OTHER,
          ],
        },
      });
    }
  }
  return rules;
}

/** 会话规则能跨 SW 重启存活、但活不过浏览器重启，因此启动路径都要重放一次。 */
async function registerHeaderRewrites(): Promise<void> {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: Array.from({ length: HEADER_RULE_ID_SPAN }, (_, index) => HEADER_RULE_ID_BASE + index),
    addRules: headerRewriteRules(),
  });
}

function reportFailure(action: string) {
  return (error: unknown) => console.error(`[Loupe] ${action}失败`, error);
}

interface LastCommentRecord {
  commentId: string | null;
  pageUrl: string;
}

function isLastCommentRecord(value: unknown): value is LastCommentRecord {
  if (typeof value !== 'object' || value === null) return false;
  const { commentId, pageUrl } = value as Record<string, unknown>;
  return (commentId === null || typeof commentId === 'string') && typeof pageUrl === 'string';
}

async function readLastComment(tabId: number): Promise<LastCommentRecord | null> {
  const key = `${LAST_COMMENT_KEY}:${tabId}`;
  const stored = await chrome.storage.session.get(key);
  const value: unknown = stored[key];
  return isLastCommentRecord(value) ? value : null;
}

/**
 * 右键「分析这条评论」时取最近右键的评论：只认同一标签页、同一页面 URL 下记录的评论，
 * 避免把上一个页面（或刷新前）的右键上下文带过来。
 */
async function menuCommentId(tabId: number, pageUrl: string, wantThread: boolean): Promise<string | null> {
  if (!wantThread) return null;
  const record = await readLastComment(tabId);
  return record !== null && record.pageUrl === pageUrl && record.commentId !== null ? record.commentId : null;
}

/**
 * 写入分析意图。input 必须是归一化后的视频地址（不能带评论锚点），否则 UI 的 resolve 会把
 * 「分析评论区」解析成评论树。意图只投给侧边栏，多窗口时按 windowId 限定。
 */
async function writeOpenIntent(input: string, commentId: string | null, windowId: number | undefined): Promise<void> {
  const intent: OpenTargetIntent = {
    type: 'open-target',
    input,
    nonce: crypto.randomUUID(),
    surface: PANEL_SURFACE,
    ...(windowId === undefined ? {} : { windowId }),
    ...(commentId === null ? {} : { commentId }),
  };
  await chrome.storage.session.set({ [INTENT_KEY]: intent });
}

function isLastCommentMessage(value: unknown): value is LastCommentMessage {
  if (typeof value !== 'object' || value === null) return false;
  const { type, commentId, pageUrl } = value as Record<string, unknown>;
  return type === 'loupe:last-comment' && (commentId === null || typeof commentId === 'string') && typeof pageUrl === 'string';
}

function isEnsureHeaderRulesMessage(value: unknown): value is EnsureHeaderRulesMessage {
  return typeof value === 'object' && value !== null && (value as Record<string, unknown>).type === ENSURE_HEADER_RULES;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(reportFailure('设置侧边栏打开方式'));
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ANALYZE_SUBJECT,
      title: '分析此视频评论区',
      contexts: ['page', 'video', 'frame'],
      documentUrlPatterns: VIDEO_PAGE_PATTERNS,
    });
    chrome.contextMenus.create({
      id: MENU_ANALYZE_THREAD,
      title: '分析这条评论及其回复树',
      contexts: ['page', 'frame'],
      documentUrlPatterns: VIDEO_PAGE_PATTERNS,
    });
  });
  registerHeaderRewrites().catch(reportFailure('注册请求头改写规则'));
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(reportFailure('设置侧边栏打开方式'));
  registerHeaderRewrites().catch(reportFailure('注册请求头改写规则'));
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const tabId = tab?.id;
  // 标签页顶层 URL 优先；无论菜单来自哪个 frame，都只接受视频页，杜绝把任意 URL 注入为分析目标。
  const pageUrl = tab?.url ?? info.pageUrl;
  if (tabId === undefined || pageUrl === undefined) return;
  const wantThread = info.menuItemId === MENU_ANALYZE_THREAD;
  if (!wantThread && info.menuItemId !== MENU_ANALYZE_SUBJECT) return;
  const input = canonicalVideoUrl(pageUrl);
  if (input === null) return;
  // 必须在点击手势里同步发起，否则 chrome.sidePanel.open 会被拒绝
  chrome.sidePanel.open({ tabId }).catch(reportFailure('打开侧边栏'));
  void menuCommentId(tabId, pageUrl, wantThread)
    .then((commentId) => writeOpenIntent(input, commentId, tab?.windowId))
    .catch(reportFailure('写入分析意图'));
});

/**
 * 页面按钮：内容脚本在点击手势里同步发来消息，这里必须同步调用 sidePanel.open，不能先 await，
 * 否则用户激活已过期。目标地址只取标签页当前 URL（不信任消息里的 pageUrl 内容），
 * 但要求两者归一化后一致，防止跨页或伪造上报。
 */
function openPanelForPageRequest(message: AnalyzeRequestMessage, sender: chrome.runtime.MessageSender): void {
  const tab = sender.tab;
  const tabId = tab?.id;
  const senderUrl = tab?.url;
  if (tabId === undefined || senderUrl === undefined) return;
  const input = canonicalVideoUrl(senderUrl);
  if (input === null || canonicalVideoUrl(message.pageUrl) !== input) return;
  const commentId = message.kind === 'thread' && isCommentId(message.commentId) ? message.commentId : null;
  if (message.kind === 'thread' && commentId === null) return;
  chrome.sidePanel.open({ tabId }).catch(reportFailure('打开侧边栏'));
  writeOpenIntent(input, commentId, tab?.windowId).catch(reportFailure('写入分析意图'));
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  if (isEnsureHeaderRulesMessage(message)) {
    registerHeaderRewrites()
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => {
        reportFailure('注册请求头改写规则')(error);
        sendResponse({ ok: false });
      });
    return true;
  }
  if (isAnalyzeRequestMessage(message)) {
    openPanelForPageRequest(message, sender);
    return;
  }
  const tabId = sender.tab?.id;
  const senderUrl = sender.tab?.url;
  // 内容脚本上报：只接受同一标签页、且上报 URL 与标签页当前视频页 URL 完全一致的评论上下文。
  if (tabId === undefined || senderUrl === undefined || !isVideoPageUrl(senderUrl)) return;
  if (!isLastCommentMessage(message) || message.pageUrl !== senderUrl) return;
  chrome.storage.session
    .set({ [`${LAST_COMMENT_KEY}:${tabId}`]: { commentId: message.commentId, pageUrl: senderUrl } })
    .catch(reportFailure('记录最近右键的评论'));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(`${LAST_COMMENT_KEY}:${tabId}`).catch(reportFailure('清理标签页评论上下文'));
});

// 导航/刷新（含 SPA 换页）即丢弃右键评论上下文，菜单不会再用到上一个页面的评论。
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'loading' && changeInfo.url === undefined) return;
  chrome.storage.session.remove(`${LAST_COMMENT_KEY}:${tabId}`).catch(reportFailure('清理标签页评论上下文'));
});

registerHeaderRewrites().catch(reportFailure('注册请求头改写规则'));
