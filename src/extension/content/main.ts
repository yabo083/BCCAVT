/**
 * 内容脚本（主世界）：新版评论 UI 是自定义元素，评论对象挂在元素实例的 `.data` 上，
 * 只有主世界读得到；隔离世界拿不到，所以由这里监听右键、解析出评论 id 后 postMessage 转发。
 */
import { PAGE_BRIDGE_SOURCE } from '../messages';

/** 旧版评论 DOM 上的 id 属性；内层（楼中楼）优先。 */
const REPLY_ID_ATTRIBUTES = ['data-reply-id', 'data-root-reply-id'];

function replyIdFromReplyData(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const { rpid_str, rpid } = data as Record<string, unknown>;
  if (typeof rpid_str === 'string' && rpid_str !== '') return rpid_str;
  if (typeof rpid === 'number' || typeof rpid === 'string') return String(rpid);
  return null;
}

function replyIdFromElement(element: Element): string | null {
  const fromData = replyIdFromReplyData((element as Element & { data?: unknown }).data);
  if (fromData !== null) return fromData;
  for (const attribute of REPLY_ID_ATTRIBUTES) {
    const value = element.getAttribute(attribute);
    if (value) return value;
  }
  return null;
}

window.addEventListener(
  'contextmenu',
  (event) => {
    // composedPath() 由内向外，第一个命中的就是最内层评论元素（楼中楼优先于其所属根评论）
    let commentId: string | null = null;
    for (const node of event.composedPath()) {
      if (!(node instanceof Element)) continue;
      commentId = replyIdFromElement(node);
      if (commentId !== null) break;
    }
    window.postMessage({ source: PAGE_BRIDGE_SOURCE, commentId, pageUrl: window.location.href }, window.location.origin);
  },
  true,
);
