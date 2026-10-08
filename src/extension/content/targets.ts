/**
 * 页面按钮的锚点与数据解析（纯 DOM，无 chrome API、无全局状态），便于在 happy-dom 下直接测。
 *
 * 锚点与数据访问方式沿用上游 Bilibili-Evolved 的 v3 实现（MIT，见 README「上游参考」）：
 *   - 评论区根：`bili-comments`（open shadow root）
 *     https://github.com/the1812/Bilibili-Evolved/blob/master/src/components/utils/comment/areas/v3.ts
 *   - 每条评论的按钮挂载点：该评论自己的 `bili-comment-action-buttons-renderer`
 *   - 评论 id：组件数据里的 `rpid_str`（上游读 `__data`，实机同时有 `.data`）
 *
 * 实机（2026-10，BV1bT411w78C）复核：bili-comments → bili-comment-thread-renderer（根评论）→ shadow
 * bili-comment-renderer → shadow #main>#footer → bili-comment-action-buttons-renderer（shadow 子节点
 * #pubdate/#like/#dislike/#reply/#more），楼中楼（bili-comment-reply-renderer）的操作行同为该组件。
 */

/** 按钮类名：隔离世界按它识别点击目标。 */
export const LOUPE_ACTION_CLASS = 'loupe-action';
/** 按钮意图属性：subject（评论区）| thread（评论树）。 */
export const LOUPE_KIND_ATTRIBUTE = 'data-loupe-action';
/** 评论按钮上的评论 id 属性。 */
export const LOUPE_RPID_ATTRIBUTE = 'data-loupe-rpid';

/** 新版评论区的根元素（上游 CommentAreaV3.isV3Area 同款判定）。 */
export const COMMENT_AREA_SELECTOR = 'bili-comments';
/** 一条评论（根评论或楼中楼）自己的操作按钮渲染器，按钮就挂在这里。 */
export const COMMENT_ACTIONS_SELECTOR = 'bili-comment-action-buttons-renderer';

/**
 * 视频按钮锚点：播放器下方工具栏里的原生操作行。
 * 只往这个元素**内部追加**，不插兄弟节点——外层是 Vue 管理的片段，在占位锚点旁插节点会让站点脚本
 * 抛 HierarchyRequestError（实测：新注入版本导致 #commentapp 挂载失败）。也不要用 #playerWrap /
 * #bilibili-player 这类早期/播放器容器兜底。
 */
export const VIDEO_ACTIONS_SELECTOR = '.video-toolbar-right';

/** 视频按钮所在工具栏：操作行还没渲染出内容时，靠它判断「工具栏内部有变更，值得再看一眼」。 */
export const VIDEO_CONTAINER_SELECTOR = '.video-toolbar-container';

/** 旧版评论 DOM 上的 id 属性，只用于右键路径兜底。 */
const LEGACY_REPLY_ID_ATTRIBUTES = ['data-reply-id', 'data-root-reply-id'];

/** 新版评论组件把数据挂在实例上（上游读 `__data`，实机同时有 `.data`）。 */
interface CommentDataCarrier extends Element {
  __data?: unknown;
  data?: unknown;
}

function digitsOrNull(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value);
  return /^\d+$/.test(text) ? text : null;
}

/** 评论组件数据里的 rpid（`rpid_str` 优先，避免大整数精度丢失）。 */
function rpidFromData(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const { rpid_str, rpid } = data as Record<string, unknown>;
  return digitsOrNull(rpid_str) ?? digitsOrNull(rpid);
}

/** 组件数据里的评论 id；不是评论组件（或数据没有 rpid）时返回 null。 */
export function commentRpid(element: Element): string | null {
  const carrier = element as CommentDataCarrier;
  // 上游读 `__data`、实机是 `.data`：两处都试，谁先给出 rpid 用谁
  return rpidFromData(carrier.__data) ?? rpidFromData(carrier.data);
}

/** 右键路径的评论 id：评论组件数据优先，其次旧版 DOM 的 id 属性。 */
export function contextCommentIdOf(element: Element): string | null {
  const own = commentRpid(element);
  if (own !== null) return own;
  for (const attribute of LEGACY_REPLY_ID_ATTRIBUTES) {
    const value = digitsOrNull(element.getAttribute(attribute));
    if (value !== null) return value;
  }
  return null;
}

/** 自己注入的节点：识别它们才能跳过重扫，避免观察者被自己的写入反复触发。 */
export function isOwnNode(node: Node): node is Element {
  return node instanceof Element && node.classList.contains(LOUPE_ACTION_CLASS);
}

/**
 * node 及其子树里的 open shadow root（含嵌套）。
 * 等价于上游 ShadowRootObserver.queryAllShadowRoots 的最小实现：只沿「元素 → 它的 open shadow root」下钻。
 */
export function collectShadowRoots(node: Element | ShadowRoot): ShadowRoot[] {
  const roots: ShadowRoot[] = [];
  const scopes: ParentNode[] = [node];
  while (scopes.length > 0) {
    const scope = scopes.pop();
    if (scope === undefined) continue;
    const hosts: Element[] = [...scope.querySelectorAll('*')];
    if (scope instanceof Element && scope.shadowRoot !== null) hosts.push(scope);
    for (const host of hosts) {
      const shadowRoot = host.shadowRoot;
      if (shadowRoot === null || roots.includes(shadowRoot)) continue;
      roots.push(shadowRoot);
      scopes.push(shadowRoot);
    }
  }
  return roots;
}
