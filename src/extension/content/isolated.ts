/**
 * 内容脚本（隔离世界）：只做边界校验与转发，把主世界解析出的评论 id 交给后台按标签页暂存。
 */
import { PAGE_BRIDGE_SOURCE, type LastCommentMessage } from '../messages';

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
