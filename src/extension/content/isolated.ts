/**
 * 内容脚本（隔离世界）：
 * 1. 捕获页面按钮的真实点击并发 sendMessage 给后台；后台按 kind 决定落地面（视频级 → 完整标签页，
 *    评论行放大镜 → 独立图谱窗口），两条路线都不依赖用户激活，所以这里不再需要「手势留在事件里」。
 * 2. 把主世界右键解析出的评论 id 交给后台按标签页暂存。
 * 3. 启动页面评论区替换（page-reader）：开关开启时隐藏原生评论根、挂载自绘的 iframe 阅读器，
 *    并承接阅读器的写意图（写请求在页面上下文发出，csrf 只在那边现读现用）。
 *
 * 注意：页面开关已不再驱动原生样式增强（native-comments-style / native-thread 保留为未接线能力），
 * 本文件因此不再推样式开关；开关的唯一语义是「替换原生评论区」。
 */
import {
  ANALYZE_REQUEST,
  PAGE_BRIDGE_SOURCE,
  isAnalyzeRequestMessage,
  isCommentId,
  type AnalyzeRequestMessage,
  type LastCommentMessage,
} from '../messages';
import { isExtensionContextInvalidated } from '../page-comments';
import { startPageReader } from './page-reader';
import { LOUPE_ACTION_CLASS, LOUPE_KIND_ATTRIBUTE, LOUPE_RPID_ATTRIBUTE } from './targets';

/** 后台的失败原因（已是一句可直接展示的中文）；拿不到就退回通用文案。 */
function errorTextOf(result: unknown): string {
  if (typeof result === 'object' && result !== null) {
    const { error } = result as Record<string, unknown>;
    if (typeof error === 'string' && error !== '') return error;
  }
  return '无法打开分析界面';
}

async function requestAnalysis(message: AnalyzeRequestMessage, button: HTMLElement): Promise<void> {
  try {
    const result: unknown = await chrome.runtime.sendMessage(message);
    if (typeof result !== 'object' || result === null || !('ok' in result) || result.ok !== true) {
      // 后台已经把「来源无效 / 页面已切换 / 评论 ID 无效 / 打开失败」说清楚了，原样展示
      throw new Error(errorTextOf(result));
    }
  } catch (error) {
    const feedback = document.createElement('span');
    feedback.setAttribute('role', 'alert');
    // 扩展被重载后这里的调用会失败：给一句能自救的话，而不是英文的 'Extension context invalidated'
    let text = '无法打开分析界面';
    if (error instanceof Error) text = isExtensionContextInvalidated(error) ? '扩展已更新，请刷新页面后重试' : error.message;
    feedback.textContent = text;
    feedback.style.cssText = 'display:block;color:var(--stress_red,#b3261e);font-size:12px;max-width:320px;';
    button.after(feedback);
    setTimeout(() => feedback.remove(), 10000);
  }
}

document.addEventListener(
  'click',
  (event) => {
    // 只认真实点击：页面脚本合成的点击不该能驱动扩展去开界面
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
    void requestAnalysis(message, button);
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
  try {
    // 扩展重载后 sendMessage 是同步抛错（而不是返回被拒的 promise），两种都要接住
    chrome.runtime.sendMessage(message).catch((error: unknown) => {
      console.warn('[Loupe] 上报评论上下文失败', error);
    });
  } catch (error) {
    console.warn('[Loupe] 上报评论上下文失败', error);
  }
});

// 页面评论区替换：开关读盘、隐藏原生评论根、挂载 iframe 阅读器与写意图回投都在 page-reader 里，
// 这里只负责启动它（它自带幂等与上下文失效熔断）。
startPageReader();
