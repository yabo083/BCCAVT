/**
 * 页面按钮注入器（主世界）：
 *   - 原生操作行 `.video-toolbar-right` 内部追加「Loupe 分析评论区」按钮；
 *   - 每条评论（含楼中楼）自己的操作行里注入「Loupe 分析评论树」按钮，按钮带该评论 id。
 * 按钮不挂事件监听：点击由隔离世界在真实事件里同步 sendMessage，
 * 用户激活必须留在点击事件里，异步桥会让 sidePanel.open 被拒。
 *
 * 发现模型沿用上游 Bilibili-Evolved 的 shadow-root 条目树（MIT，见 README「上游参考」）：
 * 只盯 bili-comments 评论区及其下已发现的 open shadow root，每个 shadow root 一个
 * childList+subtree 观察者，变更只重扫所属评论区；自己插入按钮产生的变更被识别并跳过。
 * 不做定时全文档扫描，也没有通用 DOM 爬虫——锚点就是评论组件自己的操作行。
 *
 * 生命周期：站点 hydration（window load）之前不碰页面 DOM，也不插兄弟节点——实测在 Vue 管理的
 * 工具栏片段里插节点会让站点脚本抛 HierarchyRequestError、评论区挂载失败。评论区另等
 * `customElements.whenDefined('bili-comments')` 后再做限定范围的发现。
 */
import type { AnalyzeKind } from '../messages';
import {
  COMMENT_ACTIONS_SELECTOR,
  COMMENT_AREA_SELECTOR,
  LOUPE_ACTION_CLASS,
  LOUPE_KIND_ATTRIBUTE,
  LOUPE_RPID_ATTRIBUTE,
  VIDEO_ACTIONS_SELECTOR,
  VIDEO_CONTAINER_SELECTOR,
  collectShadowRoots,
  commentRpid,
  isOwnNode,
} from './targets';

export interface PageActionInjector {
  /** 开始观察并做首次扫描。 */
  start(): void;
  /** 立即重扫一次（导航后与测试用）。 */
  reconcile(): void;
  /** 停止观察、撤销 history 补丁并移除已注入的按钮。 */
  dispose(): void;
}

const OBSERVER_OPTIONS: MutationObserverInit = { childList: true, subtree: true };

const VIDEO_BUTTON_LABEL = 'Loupe 分析评论区';
const COMMENT_BUTTON_LABEL = 'Loupe 分析评论树';

/** 用 CSSOM 写入样式，绕开页面 CSP 对 `<style>` / style 属性的限制；颜色沿用站点变量并给兜底值。 */
const BUTTON_CSS = [
  'display:inline-flex',
  'align-items:center',
  'height:24px',
  'padding:0 8px',
  'margin:0 0 0 8px',
  'border:1px solid var(--line_regular,#e3e5e7)',
  'border-radius:6px',
  'background:var(--bg1,#fff)',
  'color:var(--text1,#18191c)',
  'font-size:12px',
  'line-height:1',
  'font-family:inherit',
  'cursor:pointer',
  'vertical-align:middle',
].join(';');

/** 自己插入按钮产生的变更：跳过，否则观察者会被自己的写入反复触发。 */
export function isOwnInsertion(record: MutationRecord): boolean {
  if (record.removedNodes.length > 0 || record.addedNodes.length === 0) return false;
  for (const node of record.addedNodes) {
    if (!isOwnNode(node)) return false;
  }
  return true;
}

/** 一个评论区及其下已发现的 open shadow root。 */
interface CommentAreaState {
  element: Element;
  scopes: Set<ShadowRoot>;
}

export function createPageActionInjector(doc: Document): PageActionInjector {
  const areaByElement = new WeakMap<Element, CommentAreaState>();
  const areas = new Set<CommentAreaState>();
  const scopeObserverByRoot = new Map<ShadowRoot, MutationObserver>();
  /** shadow root → 所属评论区；站点重建时用来把它从评论区的扫描范围里摘掉。 */
  const scopeArea = new WeakMap<ShadowRoot, CommentAreaState>();
  /** 操作行元素 → 按钮；同一个操作行永远只挂一个按钮。 */
  const buttonByRow = new WeakMap<Element, HTMLButtonElement>();
  let videoButton: HTMLButtonElement | null = null;
  let undoHistoryPatch: (() => void) | null = null;
  /** 站点 hydration 完成（window load）前不碰页面 DOM：Vue 的挂载游标会被多出来的节点带偏。 */
  let pageReady = doc.readyState === 'complete';
  /** bili-comments 定义后再扫评论区：实机评论区是懒渲染的，定义前 DOM 里什么都没有。 */
  let commentsReady = false;
  let scheduled = false;
  let disposed = false;

  const documentObserver = new MutationObserver((records) => {
    for (const record of records) {
      if (isOwnInsertion(record)) continue;
      if (isRelevantDocumentChange(record)) {
        schedule();
        return;
      }
    }
  });

  /**
   * 文档级只关心：评论区或播放器工具栏出现/消失、我们自己的节点被站点清掉。
   * 评论内部的变更由各 shadow root 的观察者负责，页面其它地方的改动不该触发重扫。
   */
  function isRelevantDocumentChange(record: MutationRecord): boolean {
    for (const node of record.removedNodes) {
      if (isOwnNode(node)) return true;
    }
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches(COMMENT_AREA_SELECTOR) || node.querySelector(COMMENT_AREA_SELECTOR) !== null) return true;
      if (node.matches(VIDEO_ACTIONS_SELECTOR) || node.querySelector(VIDEO_ACTIONS_SELECTOR) !== null) return true;
    }
    // 视频按钮还没就位时，工具栏内部的渲染变更也值得再看一眼（操作行可能刚渲染出内容）
    if (videoButton === null && record.target instanceof Element) {
      return record.target.closest(VIDEO_CONTAINER_SELECTOR) !== null;
    }
    return false;
  }

  function onPageReady(): void {
    pageReady = true;
    schedule();
  }

  function onCommentsReady(): void {
    commentsReady = true;
    schedule();
  }

  function addScope(area: CommentAreaState, root: ShadowRoot): void {
    if (area.scopes.has(root)) return;
    area.scopes.add(root);
    scopeArea.set(root, area);
    const observer = new MutationObserver((records) => handleScopeRecords(area, records));
    observer.observe(root, OBSERVER_OPTIONS);
    scopeObserverByRoot.set(root, observer);
  }

  /** 新加入的节点里可能带出新的 shadow root（评论回复列表等），一并纳入观察。 */
  function registerScopes(area: CommentAreaState, node: Element): void {
    for (const root of collectShadowRoots(node)) addScope(area, root);
  }

  function handleScopeRecords(area: CommentAreaState, records: MutationRecord[]): void {
    let touched = false;
    for (const record of records) {
      if (isOwnInsertion(record)) continue;
      touched = true;
      for (const node of record.addedNodes) {
        if (node instanceof Element) registerScopes(area, node);
      }
    }
    if (touched) schedule();
  }

  function watchArea(element: Element): void {
    if (areaByElement.has(element)) return;
    // shadow root 还没挂上时先放过：下一次重扫（任何相关变更）会再试
    const root = element.shadowRoot;
    if (root === null) return;
    const area: CommentAreaState = { element, scopes: new Set() };
    areaByElement.set(element, area);
    areas.add(area);
    for (const scope of [root, ...collectShadowRoots(root)]) addScope(area, scope);
  }

  /** 评论区被换掉后，它的观察者与注册表都要跟着清理，避免悬空引用。 */
  function sweepAreas(): void {
    for (const area of areas) {
      if (area.element.isConnected) continue;
      for (const root of area.scopes) {
        scopeObserverByRoot.get(root)?.disconnect();
        scopeObserverByRoot.delete(root);
      }
      // 元素被移出文档后又放回来时要能重新认领，所以这里必须把映射删掉
      areaByElement.delete(area.element);
      areas.delete(area);
    }
    for (const [root, observer] of scopeObserverByRoot) {
      if (root.host.isConnected) continue;
      observer.disconnect();
      scopeObserverByRoot.delete(root);
      scopeArea.get(root)?.scopes.delete(root);
    }
  }

  function scanArea(area: CommentAreaState): void {
    for (const scope of area.scopes) {
      for (const row of scope.querySelectorAll(COMMENT_ACTIONS_SELECTOR)) {
        const commentId = commentRpid(row);
        if (commentId !== null) ensureCommentButton(row, commentId);
      }
    }
  }

  /**
   * 按钮挂载点：实机里操作行有 open shadow root，子节点就是 #pubdate/#like/#dislike/#reply/#more，
   * 按钮因此落在 #reply/#more 旁边；shadow root 晚一步挂上时先放 light DOM，下一轮扫描会重新挂好。
   */
  function ensureCommentButton(row: Element, commentId: string): void {
    const container = row.shadowRoot ?? row;
    const mounted = buttonByRow.get(row);
    if (mounted !== undefined && mounted.parentNode === container && mounted.isConnected) {
      // 评论被回收复用时同一个操作行会换成另一条评论：按钮改指新 id
      if (mounted.getAttribute(LOUPE_RPID_ATTRIBUTE) !== commentId) mounted.setAttribute(LOUPE_RPID_ATTRIBUTE, commentId);
      return;
    }
    mounted?.remove();
    const button = createButton('thread', COMMENT_BUTTON_LABEL, commentId);
    container.appendChild(button);
    buttonByRow.set(row, button);
  }

  /**
   * 视频按钮：只往原生操作行 `.video-toolbar-right` **内部**追加，不插兄弟节点，也不用
   * `#playerWrap`/`#bilibili-player` 这类早期容器兜底——那会打乱站点脚本的挂载（实测导致
   * #commentapp 挂载失败）。调用方已保证 window load 之后才走到这里。
   */
  function ensureVideoButton(): void {
    const anchor = doc.querySelector(VIDEO_ACTIONS_SELECTOR);
    if (anchor === null) return;
    if (videoButton !== null && videoButton.isConnected && videoButton.parentNode === anchor) return;
    videoButton?.remove();
    const button = createButton('subject', VIDEO_BUTTON_LABEL);
    anchor.appendChild(button);
    videoButton = button;
  }

  function createButton(kind: AnalyzeKind, label: string, commentId?: string): HTMLButtonElement {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = LOUPE_ACTION_CLASS;
    button.setAttribute(LOUPE_KIND_ATTRIBUTE, kind);
    if (commentId !== undefined) button.setAttribute(LOUPE_RPID_ATTRIBUTE, commentId);
    button.textContent = label;
    button.title = label;
    button.style.cssText = BUTTON_CSS;
    return button;
  }

  function scan(): void {
    if (disposed) return;
    // window load（站点 hydration）之前不碰页面 DOM，避免打乱站点脚本的挂载游标
    if (pageReady) ensureVideoButton();
    if (!commentsReady) return;
    // 每次重扫都重新找一遍评论区：bili-comments 是懒渲染的，元素也可能整块被换掉
    for (const element of doc.querySelectorAll(COMMENT_AREA_SELECTOR)) watchArea(element);
    sweepAreas();
    for (const area of areas) scanArea(area);
  }

  function schedule(): void {
    if (scheduled || disposed) return;
    scheduled = true;
    // 合并同一批变更；用定时器而非 rAF：后台标签页里 rAF 会被暂停
    setTimeout(run, 0);
  }

  function run(): void {
    scheduled = false;
    scan();
  }

  function onNavigation(): void {
    if (disposed) return;
    schedule();
  }

  /** SPA 换页（pushState/replaceState）不产生 childList 变更，需要显式补一次扫描。 */
  function patchHistory(win: Window): () => void {
    const { history } = win;
    const { pushState, replaceState } = history;
    history.pushState = function (this: History, ...args: Parameters<History['pushState']>): void {
      pushState.apply(this, args);
      onNavigation();
    };
    history.replaceState = function (this: History, ...args: Parameters<History['pushState']>): void {
      replaceState.apply(this, args);
      onNavigation();
    };
    return () => {
      history.pushState = pushState;
      history.replaceState = replaceState;
    };
  }

  return {
    start(): void {
      if (disposed) return;
      documentObserver.observe(doc, OBSERVER_OPTIONS);
      const win = doc.defaultView;
      if (win !== null) {
        win.addEventListener('popstate', onNavigation);
        win.addEventListener('hashchange', onNavigation);
        // 站点 hydration 未完成时等 window load；SPA 换页后 readyState 已是 complete，直接生效
        if (!pageReady) win.addEventListener('load', onPageReady, { once: true });
        undoHistoryPatch = patchHistory(win);
      }
      // bili-comments 定义后再扫评论区（定义前 DOM 里什么都还没有）
      void win?.customElements.whenDefined(COMMENT_AREA_SELECTOR).then(onCommentsReady);
      schedule();
    },
    reconcile(): void {
      scan();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      documentObserver.disconnect();
      for (const observer of scopeObserverByRoot.values()) observer.disconnect();
      scopeObserverByRoot.clear();
      undoHistoryPatch?.();
      undoHistoryPatch = null;
      const win = doc.defaultView;
      win?.removeEventListener('popstate', onNavigation);
      win?.removeEventListener('hashchange', onNavigation);
      win?.removeEventListener('load', onPageReady);
      for (const area of areas) {
        for (const scope of area.scopes) {
          for (const button of scope.querySelectorAll(`.${LOUPE_ACTION_CLASS}`)) button.remove();
        }
      }
      areas.clear();
      videoButton?.remove();
      videoButton = null;
    },
  };
}
