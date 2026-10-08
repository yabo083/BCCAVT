/**
 * 内容脚本（隔离世界）：
 * 1. 捕获页面按钮的真实点击并同步 sendMessage。点击手势必须留在事件里：一旦 await/异步桥转手，
 *    后台的 chrome.sidePanel.open 就会因缺少用户激活被拒。
 * 2. 把主世界右键解析出的评论 id 交给后台按标签页暂存。
 */
import {
  ANALYZE_REQUEST,
  PAGE_BRIDGE_SOURCE,
  isAnalyzeRequestMessage,
  isCommentId,
  type AnalyzeRequestMessage,
  type LastCommentMessage,
} from '../messages';
import { LOUPE_ACTION_CLASS, LOUPE_KIND_ATTRIBUTE, LOUPE_RPID_ATTRIBUTE } from './targets';

document.addEventListener(
  'click',
  (event) => {
    // 只认真实点击：页面脚本合成的事件不能用来打开侧边栏
    if (!event.isTrusted) return;
    // 按钮可能挂在 open shadow root 里，事件会被重定向，必须走 composedPath
    const button = event.composedPath().find((node) => node instanceof HTMLElement && node.classList.contains(LOUPE_ACTION_CLASS));
    if (!(button instanceof HTMLElement)) return;
    const kind = button.getAttribute(LOUPE_KIND_ATTRIBUTE);
    const commentId = button.getAttribute(LOUPE_RPID_ATTRIBUTE);
    const message: AnalyzeRequestMessage = {
      type: ANALYZE_REQUEST,
      kind: kind === 'thread' ? 'thread' : 'subject',
      ...(kind === 'thread' && isCommentId(commentId) ? { commentId } : {}),
      pageUrl: location.href,
    };
    if (!isAnalyzeRequestMessage(message)) return;
    // 不让点击继续传给站点的评论交互
    event.preventDefault();
    event.stopPropagation();
    chrome.runtime.sendMessage(message).catch((error: unknown) => {
      console.warn('[Loupe] 上报页面按钮点击失败', error);
    });
  },
  true,
);

interface PageBridgeMessage {
  commentId: string | null;
  pageUrl: string;
}

function asPageBridgeMessage(value: unknown): PageBridgeMessage | null {
  if (typeof value !== 'object' || value === null) return null;
  const { source, commentId, pageUrl } = value as Record<string, unknown>;
  if (source !== PAGE_BRIDGE_SOURCE) return null;
  if (commentId !== null && typeof commentId !== 'string') return null;
  if (typeof pageUrl !== 'string') return null;
  return { commentId, pageUrl };
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const bridge = asPageBridgeMessage(event.data);
  if (bridge === null) return;
  const message: LastCommentMessage = {
    type: 'loupe:last-comment',
    commentId: bridge.commentId,
    pageUrl: bridge.pageUrl,
  };
  chrome.runtime.sendMessage(message).catch((error: unknown) => {
    console.warn('[Loupe] 上报评论上下文失败', error);
  });
});
