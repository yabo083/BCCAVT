/**
 * 后台 Service Worker（ESM）。
 * 职责：侧边栏点击行为、按适配器下发请求头改写（DNR 会话规则）、右键菜单、以及把内容脚本上报的
 * 「最近右键的评论」按标签页暂存，供菜单点击时组装意图。
 */
import { adapters } from '@/platforms';
import {
  ENSURE_HEADER_RULES,
  INTENT_KEY,
  LAST_COMMENT_KEY,
  type EnsureHeaderRulesMessage,
  type LastCommentMessage,
  type OpenTargetIntent,
} from './messages';

/** 会话规则 id 预留区间：注册前整段删除，适配器增减改写时不会残留旧规则。 */
const HEADER_RULE_ID_BASE = 1;
const HEADER_RULE_ID_SPAN = 256;

const MENU_ANALYZE_SUBJECT = 'loupe:analyze-subject';
const MENU_ANALYZE_THREAD = 'loupe:analyze-thread';

/** 评论 UI 只在视频页；与 manifest 的 content_scripts 匹配保持一致。 */
const VIDEO_PAGE_PATTERNS = ['https://www.bilibili.com/video/*'];

/** 与 VIDEO_PAGE_PATTERNS 等价的运行时判定：只放行 Bilibili 视频页 URL。 */
function isVideoPageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === 'https://www.bilibili.com' && url.pathname.startsWith('/video/');
  } catch {
    return false;
  }
}

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

async function writeOpenIntent(tabId: number, pageUrl: string, wantThread: boolean): Promise<void> {
  // 只认「同标签页、同一页面 URL」下记录的评论，避免把上一个页面（或刷新前）的右键上下文带过来。
  const record = wantThread ? await readLastComment(tabId) : null;
  const commentId =
    record !== null && record.pageUrl === pageUrl && record.commentId !== null ? record.commentId : null;
  const intent: OpenTargetIntent = {
    type: 'open-target',
    input: pageUrl,
    nonce: crypto.randomUUID(),
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
  if (tabId === undefined || pageUrl === undefined || !isVideoPageUrl(pageUrl)) return;
  const wantThread = info.menuItemId === MENU_ANALYZE_THREAD;
  if (!wantThread && info.menuItemId !== MENU_ANALYZE_SUBJECT) return;
  // 必须在点击手势里同步发起，否则 chrome.sidePanel.open 会被拒绝
  chrome.sidePanel.open({ tabId }).catch(reportFailure('打开侧边栏'));
  writeOpenIntent(tabId, pageUrl, wantThread).catch(reportFailure('写入分析意图'));
});

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
