/**
 * 后台 Service Worker（ESM）。
 * 职责：按适配器下发请求头改写（DNR 会话规则）、右键菜单、页面按钮消息，
 * 把工作台/图谱的「在评论区定位」转发到对应的 B 站视频标签页（没有就新开一个并记下待办），
 * 以及把内容脚本上报的「最近右键的评论」按标签页暂存，供菜单点击时组装目标。
 * 工具栏点击行为由 manifest 的 default_popup 决定（见 manifest.ts），这里不再设置侧栏行为。
 */
import { adapters } from '@/platforms';
import {
  ENSURE_HEADER_RULES,
  LAST_COMMENT_KEY,
  LOCATE_COMMENT,
  isAnalyzeRequestMessage,
  isCommentId,
  isLocateCommentRequest,
  type AnalyzeRequestMessage,
  type EnsureHeaderRulesMessage,
  type LastCommentMessage,
  type LocateCommentRequest,
  type LocateCommentResponse,
} from './messages';
import { LOCATE_PENDING_KEY, videoIdOf, type PendingLocate } from './page-comments';
import { canonicalVideoUrl, isVideoPageUrl } from './url';
import { openAnalysisTab, openGraphPopup, type AnalysisSurface } from './open-panel';

/** 会话规则 id 预留区间：注册前整段删除，适配器增减改写时不会残留旧规则。 */
const HEADER_RULE_ID_BASE = 1;
const HEADER_RULE_ID_SPAN = 256;

const MENU_ANALYZE_SUBJECT = 'loupe:analyze-subject';
const MENU_ANALYZE_THREAD = 'loupe:analyze-thread';

/** 评论 UI 只在视频页；与 manifest 的 content_scripts 匹配保持一致。 */
const VIDEO_PAGE_PATTERNS = ['https://www.bilibili.com/video/*'];

/** 定位失败统一回这一句（不含内部细节）；内部错误照旧进控制台。 */
const LOCATE_FAILED = '无法在评论区定位，请刷新那个视频页后重试';



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
async function menuCommentId(tabId: number, pageUrl: string): Promise<string | null> {
  const record = await readLastComment(tabId);
  return record !== null && record.pageUrl === pageUrl && record.commentId !== null ? record.commentId : null;
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
  registerHeaderRewrites().catch(reportFailure('注册请求头改写规则'));
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const tabId = tab?.id;
  // 标签页顶层 URL 优先；无论菜单来自哪个 frame，都只接受视频页，杜绝把任意 URL 注入为分析目标。
  const pageUrl = tab?.url ?? info.pageUrl;
  if (tab === undefined || tabId === undefined || pageUrl === undefined) return;
  const wantThread = info.menuItemId === MENU_ANALYZE_THREAD;
  if (!wantThread && info.menuItemId !== MENU_ANALYZE_SUBJECT) return;
  const input = canonicalVideoUrl(pageUrl);
  if (input === null) return;
  const windowId = tab.windowId;
  if (!wantThread) {
    void openAnalysisTab({ input, windowId }).catch(reportFailure('打开分析界面'));
    return;
  }
  // 右键评论：拿到这条评论的 id 才开图谱窗口；取不到（没记录/换了页面）就退到完整工作台，
  // 与视频级入口同一个落地面，绝不猜一个评论 id 去开图。
  void menuCommentId(tabId, pageUrl)
    .then((commentId) => (commentId === null ? openAnalysisTab({ input, windowId }) : openGraphPopup({ input, commentId })))
    .catch(reportFailure('打开分析界面'));
});

/**
 * 页面按钮：内容脚本在点击事件里发来消息。
 * 评论行放大镜（kind=thread）→ 独立图谱窗口；视频级按钮（kind=subject）→ 完整标签页工作台。
 * 两条路线都不需要用户激活（侧栏手势链路已移除）。
 * 目标地址只取标签页当前 URL（不信任消息里的 pageUrl 内容），
 * 但要求两者归一化后一致，防止跨页或伪造上报。
 */
function openForPageRequest(
  message: AnalyzeRequestMessage,
  sender: chrome.runtime.MessageSender,
): Promise<AnalysisSurface> {
  const tab = sender.tab;
  const senderUrl = tab?.url;
  if (tab === undefined || tab.id === undefined || senderUrl === undefined) return Promise.reject(new Error('分析来源无效'));
  const input = canonicalVideoUrl(senderUrl);
  if (input === null || canonicalVideoUrl(message.pageUrl) !== input) return Promise.reject(new Error('分析页面已切换'));
  if (message.kind === 'thread') {
    if (!isCommentId(message.commentId)) return Promise.reject(new Error('评论 ID 无效'));
    return openGraphPopup({ input, commentId: message.commentId });
  }
  return openAnalysisTab({ input, windowId: tab.windowId });
}

/**
 * 工作台 / 图谱窗口的「在评论区定位」：把评论带到它所在视频的评论区。
 *
 * 顺序是固定的：先按视频身份（BV 号）挑已打开的标签页 → 激活它 → 目标在别的窗口就连那个窗口一起
 * 带到前台（否则用户只看到任务栏闪一下）→ 把定位消息发给它的内容脚本。
 * 一个都没命中就写下待办再新开标签页：新页的内容脚本挂载时读一次待办，视频身份对得上才消费。
 *
 * 失败一律回一句给人看的文案（不含内部细节）：定位只是跳转，失败不该让用户去读控制台。
 */
async function locateComment(request: LocateCommentRequest, senderWindowId: number | undefined): Promise<LocateCommentResponse> {
  const input = canonicalVideoUrl(request.input);
  const videoId = input === null ? null : videoIdOf(input);
  if (input === null || videoId === null) return { ok: false, error: '只能在 B 站视频页的评论区定位这条评论' };
  try {
    // host_permissions 已覆盖 bilibili.com，因此按 url 过滤标签页不需要额外的 tabs 权限
    const tabs = await chrome.tabs.query({ url: VIDEO_PAGE_PATTERNS });
    const tab = tabs.find((candidate) => candidate.url !== undefined && videoIdOf(candidate.url) === videoId);
    if (tab?.id === undefined) {
      const pending: PendingLocate = { input, commentId: request.commentId, nonce: crypto.randomUUID() };
      await chrome.storage.local.set({ [LOCATE_PENDING_KEY]: pending });
      await chrome.tabs.create({ url: input });
      return { ok: true };
    }
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId !== undefined && tab.windowId !== senderWindowId) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    // 内容脚本收到后会回执（见 page-reader.ts 的 onRuntimeMessage）：不回执的话端口立刻关闭，
    // 这里只会拿到一个「端口关闭」的错误，「页面还没注入内容脚本」这种真正的失败就被淹没了
    await chrome.tabs.sendMessage(tab.id, { type: LOCATE_COMMENT, input, commentId: request.commentId });
    return { ok: true };
  } catch (error) {
    reportFailure('定位评论')(error);
    return { ok: false, error: LOCATE_FAILED };
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  if (typeof message === 'object' && message !== null && 'type' in message && message.type === 'loupe:embedded-context') {
    const frameUrl = chrome.runtime.getURL('src/ui/embedded.html');
    const input = sender.tab?.url ? canonicalVideoUrl(sender.tab.url) : null;
    if (sender.url?.split('?')[0] !== frameUrl || !input) {
      sendResponse({ ok: false, error: '嵌入来源无效' });
      return;
    }
    sendResponse({ ok: true, input });
    return;
  }
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
    openForPageRequest(message, sender)
      .then((surface) => sendResponse({ ok: true, surface }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : '无法打开分析界面' }));
    return true;
  }
  if (isLocateCommentRequest(message)) {
    locateComment(message, sender.tab?.windowId)
      .then((response) => sendResponse(response))
      // locateComment 自己已经把失败包成响应；走到这里说明是意料之外的错误，也必须给调用方一个回应，
      // 否则消息通道会一直挂着（监听器已经 return true）
      .catch((error: unknown) => {
        reportFailure('定位评论')(error);
        sendResponse({ ok: false, error: LOCATE_FAILED });
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
  if (changeInfo.url) {
    // Content script may not yet exist on a newly navigating page; its initial load reads the setting itself.
    void chrome.tabs.sendMessage(tabId, { type: 'loupe:page-navigation' }).catch(() => {});
  }
});

registerHeaderRewrites().catch(reportFailure('注册请求头改写规则'));
