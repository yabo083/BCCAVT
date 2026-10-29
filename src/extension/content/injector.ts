/**
 * 页面按钮注入器（主世界）：
 *   - 原生操作行 `.video-toolbar-right` 内部追加「Loupe 分析评论区」icon-only 放大镜按钮（视频级入口）：
 *     按钮先装进我们自己的宿主容器（`.loupe-host`），容器再被**一次性**追加进操作行——站点那一侧
 *     只此一次写入，此后容器内部怎么变都是我们自己的事，不再碰站点 DOM（除非工具栏整块被换掉）；
 *   - 每条评论（含楼中楼）自己的操作行里注入一个 icon-only 放大镜按钮，按钮带该评论 id。
 *     没有任何前置门限：评论操作行里的按钮只露图标、悬停即见，评论量大小不影响入口出现与否。
 * 按钮只画图标、不放文字：可访问名走 aria-label/title，命中区固定 24×24，行内布局不随文字宽度跳动。
 * 图标数据是 Phosphor `ph:magnifying-glass`（见下方常量），不手绘、不用 innerHTML 拼字符串。
 * 按钮不挂事件监听：点击由隔离世界在真实事件里同步 sendMessage（消息必须在点击事件里发出）。
 * 两种按钮的落地面由后台按 kind 决定（视频级 → 完整标签页，评论行 → 独立图谱窗口，见 open-panel.ts）。
 * 发现模型沿用上游 Bilibili-Evolved 的 shadow-root 条目树（MIT，见 README「上游参考」）：
 * 只盯 bili-comments 评论区及其下已发现的 open shadow root，每个 shadow root 一个
 * childList+subtree 观察者，变更只重扫所属评论区；自己插入按钮产生的变更被识别并跳过。
 * 文档级观察者只认「评论区/播放器工具栏出现或消失」与「自己的按钮被站点清掉」，页面其它地方的
 * 高频变更（弹幕、播放器、封面）不触发重扫。不做定时全文档扫描，也没有通用 DOM 爬虫——锚点
 * 就是评论组件自己的操作行。
 *
 * 生命周期：站点首次挂载（SSR 水合）结束之前绝不写页面 DOM。两道门都过才写：
 *   1) window load（站点 hydration 的常规结束点，见 pageReady）；
 *   2) SSR 水合标记 `data-server-rendered` 已从文档里消失（见 siteMountFinished）——Vue 2 在 patch
 *      一开始就把它从根容器上摘掉，而整棵 SSR DOM 的水合是在同一个同步任务里做完的，所以「标记没了」
 *      就等于「水合已经结束」（无论是水合成功，还是走了「丢弃 SSR DOM 重新渲染」的回退）。
 * 第 2 道门是实机事故的修复：只要在水合前把我们的宿主容器追加进站点 vnode 树管理的
 * `.video-toolbar-right`，Vue 2 的 hydration 遍历就会失配 → 整棵 SSR DOM 被丢弃重建 → 页头组件
 * `MainHeaderV3` 二次 `mounted()` → `bili-header` 二次 `init()` 同一个 `#biliMainHeader`（它先
 * `container.innerHTML=""` 再 patch 上一个 app 的旧 vnode 树，抛 `nextSibling(null)`）→ **顶部全局
 * header 就此变空消失**（控制台即 `[Vue warn] already an app instance mounted` + `nextSibling`）。
 * 实机对照：水合前插一个节点 = `BiliHeader.init` 跑两次、header 变空；等到水合之后再插 = 只跑一次、
 * header 完好。窗口 load 早于站点水合时（冷缓存、慢网络、页面更重）第一道门拦不住，所以必须有第二道。
 * 评论区另等 `customElements.whenDefined('bili-comments')` 后再做限定范围的发现；视频按钮还要等
 * 操作行**连续多轮**扫描完全不变（同一个元素、孩子数不变、这段时间内它内部没有 childList 变更、
 * 也没有新的导航信号）才挂进去——导航/水合进行中绝不写 DOM，导航回调只作废稳定观察并排一次重扫。
 *
 * 绝不改写页面全局：SPA 换页（pushState/replaceState）不产生 childList 变更，靠 Navigation API
 * 的 navigate 事件补一次重扫，没有它时退回 popstate/hashchange——全是只读监听。早期版本猴补丁过
 * `history.pushState/replaceState`，实机把已挂载的全局 header 又 init 了一次（Vue「already an app
 * instance mounted」+ `nextSibling(null)`，顶部 header 消失）：`history` 是站点路由与风控的公共
 * 契约，它的方法身份一个字节都不该被我们改写。
 *
 * 诊断（默认关，见 DIAGNOSTICS）：复现「顶部 header 偶发消失」这类问题时把它改成 true 重新构建，
 * 主世界会打 `[loupe] {...}` 结构化日志——每次按钮插入的目标/时间、导航信号、观察器回调、
 * 工具栏命中/未命中。日志只含标签名/类名/计数/时间戳，绝不输出凭据、Cookie、响应头或页面文本。
 */
import type { AnalyzeKind } from '../messages';
import {
  COMMENT_ACTIONS_SELECTOR,
  COMMENT_AREA_SELECTOR,
  LOUPE_ACTION_CLASS,
  LOUPE_HOST_CLASS,
  LOUPE_KIND_ATTRIBUTE,
  LOUPE_RPID_ATTRIBUTE,
  VIDEO_ACTIONS_SELECTOR,
  VIDEO_CONTAINER_SELECTOR,
  collectShadowRoots,
  commentRpid,
  findVideoActionsAnchor,
  isOwnNode,
} from './targets';

export interface PageActionInjector {
  /** 开始观察并做首次扫描。 */
  start(): void;
  /** 立即重扫一次（导航后与测试用）。 */
  reconcile(): void;
  /** 停止观察、摘掉导航监听并移除已注入的按钮。 */
  dispose(): void;
}

/**
 * 站点 SSR 水合标记：Vue 2 的 `data-server-rendered`，服务端渲染的根容器上带它。
 * 它在 `patch()` 一开始就被 `removeAttribute` 摘掉，而整棵 SSR DOM 的水合（含失败后丢弃重建）在同一个
 * 同步任务里完成——于是「文档里再也找不到这个标记」等价于「站点首次挂载已经结束」，中间没有可观测的
 * 缝隙（MutationObserver 回调是微任务，永远排在那个同步任务之后）。水合前写页面 DOM 会让水合失配，
 * 后果见文件头「生命周期」。
 */
const SSR_MOUNT_MARKER_ATTRIBUTE = 'data-server-rendered';

const OBSERVER_OPTIONS: MutationObserverInit = { childList: true, subtree: true };

/**
 * 文档级观察者比 shadow root 的多盯一个属性：SSR 水合标记被摘掉的那一刻（见
 * SSR_MOUNT_MARKER_ATTRIBUTE）——窗口 load 早于站点水合时，这是让视频按钮那道门打开的**唯一**信号，
 * 不盯它就永远等不到重扫。`attributeFilter` 限定成这一个名字，页面其它属性变更一个都进不来。
 */
const DOCUMENT_OBSERVER_OPTIONS: MutationObserverInit = {
  ...OBSERVER_OPTIONS,
  attributes: true,
  attributeFilter: [SSR_MOUNT_MARKER_ATTRIBUTE],
};

const VIDEO_BUTTON_LABEL = 'Loupe 分析评论区';
/** 评论行放大镜的可访问名（title + aria-label）；按钮本身不放文字。 */
const COMMENT_BUTTON_LABEL = 'Loupe 分析评论树';

/**
 * 评论行放大镜的图标数据：Phosphor 的 `ph:magnifying-glass`，逐字取自
 * `@iconify-json/ph` 的 `icons['magnifying-glass']`（body 里那一条 `<path>` 的 `d`，
 * viewBox 由该包的 width/height = 256 得出；Phosphor Icons，MIT）。
 *
 * 内容脚本是单独构建的自包含 IIFE，没有 `~icons` 虚拟模块，而整包 icons.json 有 4.4 MB
 * （不可能塞进每个视频页都要跑的页面脚本），所以这里内联这一条路径数据。
 * tests/extension/injector.test.ts 会把它与包里的数据逐字比对，防止两处漂移。
 */
const MAGNIFYING_GLASS_VIEW_BOX = '0 0 256 256';
const MAGNIFYING_GLASS_PATH =
  'm229.66 218.34l-50.07-50.06a88.11 88.11 0 1 0-11.31 11.31l50.06 50.07a8 8 0 0 0 11.32-11.32M40 112a72 72 0 1 1 72 72a72.08 72.08 0 0 1-72-72';

/** 图标绘制尺寸；命中区（按钮）固定 24×24，图标在中间不参与行内基线。 */
const ICON_SIZE = 16;

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/** 用 CSSOM 写入样式，绕开页面 CSP 对 `<style>` / style 属性的限制；颜色沿用站点变量并给兜底值。 */
const BUTTON_BASE_CSS = [
  'display:inline-flex',
  'align-items:center',
  'border:1px solid var(--line_regular,#e3e5e7)',
  'border-radius:6px',
  'background:var(--bg1,#fff)',
  'color:var(--text1,#18191c)',
  'font-family:inherit',
  'cursor:pointer',
  'vertical-align:middle',
].join(';');

/** 按钮样式：icon-only，命中区固定 24×24（含边框），不随内容重排。 */
const ICON_BUTTON_CSS = [
  BUTTON_BASE_CSS,
  'justify-content:center',
  'box-sizing:border-box',
  'width:24px',
  'height:24px',
  'padding:0',
  'margin:0 0 0 8px',
  'flex:none',
  'line-height:0',
].join(';');

/** 宿主容器样式：一层不参与排版的壳（按钮自带外边距），视觉与直接插按钮一致。 */
const HOST_CSS = ['display:inline-flex', 'align-items:center', 'flex:none'].join(';');

/**
 * 连续多少轮扫描看到操作行完全不变才插按钮：站点渲染是分批的，一轮不足以证明它停下来了。
 * 2 = 至少跨两个独立扫描周期，且两轮之间操作行内部没有任何 childList 变更、没有新的导航信号；
 * 导航信号之后再 +1 轮（见 extraStableScans）——换页往往连页面 header 一起重挂，多留一份余量。
 */
const VIDEO_STABLE_SCANS = 2;

/**
 * 诊断开关：默认关。复现「顶部 header 偶发消失」这类问题时把这一行改成 `= true`，重新构建并重载
 * 扩展，主世界就会按 `[loupe] {...}` 打结构化日志（插入目标/时间、导航信号、观察器回调、工具栏
 * 命中/未命中）。日志只含标签名/类名/计数/时间戳，绝不输出凭据、Cookie、响应头或页面文本。
 * 显式标 `boolean`（不写成字面量类型）：关掉时编译器也就不会把这条日志路径当成不可达代码。
 */
const DIAGNOSTICS: boolean = false;

/** 一条结构化诊断日志；DIAGNOSTICS 关掉时立即返回，除了调用点的那个小字面量不做任何事。 */
function diag(event: string, detail: Record<string, unknown>): void {
  if (!DIAGNOSTICS) return;
  console.info(`[loupe] ${JSON.stringify({ t: new Date().toISOString(), event, ...detail })}`);
}

/** 诊断里描述元素：只取标签名与类名（截断到 96 字符），绝不读文本内容或属性值。 */
function describeElement(element: Element): string {
  const classes = (element.getAttribute('class') ?? '').trim().replace(/\s+/g, '.');
  const described = classes === '' ? element.tagName.toLowerCase() : `${element.tagName.toLowerCase()}.${classes}`;
  return described.length > 96 ? `${described.slice(0, 96)}...` : described;
}

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
  /** 我们自己的视频按钮宿主容器（内含按钮）：插进站点操作行后就属于「不再改动」的那部分。 */
  let videoHost: HTMLDivElement | null = null;
  /** 上一轮扫描看到的操作行、它的孩子数、当时的工具栏改动序号与导航序号：四者连续多轮一致才插。 */
  let videoAnchorSeen: Element | null = null;
  let videoAnchorChildCount = -1;
  let videoAnchorMutationSeq = -1;
  let videoAnchorNavSeq = -1;
  let videoAnchorStableScans = 0;
  /** 操作行内部（childList）改动序号：站点渲染栈动过它一次就自增，用来作废稳定判定。 */
  let toolbarMutationSeq = 0;
  /** 导航序号：每次导航信号自增——导航/水合进行中绝不写 DOM，稳定判定连同作废。 */
  let navigationSeq = 0;
  /**
   * 导航之后额外要求的安静轮数：站点换页往往会把 header 与工具栏一起重挂，多等一轮才插。
   * 装上宿主容器后清零（只有「刚导航过」这一种情况才需要这份余量）。
   */
  let extraStableScans = 0;
  /** 摘掉导航监听的撤销函数（start 装上，dispose 摘掉）。 */
  let stopNavigation: (() => void) | null = null;
  /** 第一道门：window load 之前不碰页面 DOM（站点 hydration 的常规结束点）。 */
  let pageReady = doc.readyState === 'complete';
  /** 第二道门：站点首次挂载（SSR 水合）是否已经结束，见 siteMountFinished。 */
  let siteMounted = false;
  /** bili-comments 定义后再扫评论区：实机评论区是懒渲染的，定义前 DOM 里什么都没有。 */
  let commentsReady = false;
  let scheduled = false;
  let disposed = false;

  const documentObserver = new MutationObserver((records) => {
    let relevant = false;
    for (const record of records) {
      if (isOwnInsertion(record)) continue;
      // 站点渲染栈动过操作行的孩子：稳定判定作废，下一次插入至少要重新观察满 VIDEO_STABLE_SCANS 轮
      if (record.target instanceof Element && record.target.closest(VIDEO_ACTIONS_SELECTOR) !== null) {
        toolbarMutationSeq += 1;
      }
      if (isRelevantDocumentChange(record)) relevant = true;
    }
    diag('observer', { scope: 'document', records: records.length, relevant });
    if (relevant) schedule();
  });

  /**
   * 文档级只关心五件事：评论区出现/消失、视频按钮还没就位时工具栏出现或其内部渲染、我们自己的
   * 按钮被站点清掉、工具栏被站点整块换掉（我们的容器随之离开文档）、以及 **SSR 水合标记被摘掉**
   * （水合结束，视频按钮的第二道门开了）。评论内部的变更由各 shadow root 的观察者负责；页面别处
   * （弹幕、播放器、封面、首页信息流）的高频变更一律忽略——它们一个都影响不了注入结果。
   * window load 之前恒为 false：那段时间页面正在首次渲染（变更最密），而 scan() 还没资格写 DOM；
   * 水合标记若在 load 之前就被摘掉，由 onPageReady 排的那一次重扫接手，不会漏。
   */
  function isRelevantDocumentChange(record: MutationRecord): boolean {
    if (!pageReady) return false;
    if (record.type === 'attributes') return record.attributeName === SSR_MOUNT_MARKER_ATTRIBUTE;
    for (const node of record.removedNodes) {
      if (isOwnNode(node)) return true;
      // 站点换掉整个工具栏时被移走的是容器的祖先：不认出这一层，按钮就再也不会回来
      if (videoHost !== null && node instanceof Element && node.contains(videoHost)) return true;
    }
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches(COMMENT_AREA_SELECTOR) || node.querySelector(COMMENT_AREA_SELECTOR) !== null) return true;
      // 宿主容器就位后，工具栏的出现/消失也不再需要重扫
      if (
        videoHost === null &&
        (node.matches(VIDEO_ACTIONS_SELECTOR) || node.querySelector(VIDEO_ACTIONS_SELECTOR) !== null)
      ) {
        return true;
      }
    }
    // 宿主容器还没就位时，工具栏内部的渲染变更也值得再看一眼（操作行可能刚渲染出内容）
    return videoHost === null && record.target instanceof Element && record.target.closest(VIDEO_CONTAINER_SELECTOR) !== null;
  }

  /**
   * 站点首次挂载（SSR 水合）是否已经结束——见 SSR_MOUNT_MARKER_ATTRIBUTE 与文件头「生命周期」。
   * 判过一次就记住：标记不会再被写回来。没有 SSR 标记的文档（非 SSR 页）第一轮扫描即通过。
   */
  function siteMountFinished(): boolean {
    if (siteMounted) return true;
    if (doc.querySelector(`[${SSR_MOUNT_MARKER_ATTRIBUTE}]`) !== null) return false;
    siteMounted = true;
    diag('site-mounted', { path: doc.location.pathname });
    return true;
  }

  function onPageReady(): void {
    pageReady = true;
    diag('page-ready', { path: doc.location.pathname });
    schedule();
  }

  function onCommentsReady(): void {
    commentsReady = true;
    diag('comments-ready', {});
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
    diag('observer', { scope: 'comment', records: records.length, touched });
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
        if (commentId === null) continue;
        ensureCommentButton(row, commentId);
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

  /** 稳定判定的观察作废：下一次插入前必须重新连续观察满 VIDEO_STABLE_SCANS 轮。 */
  function resetVideoStability(): void {
    videoAnchorSeen = null;
    videoAnchorChildCount = -1;
    videoAnchorMutationSeq = -1;
    videoAnchorNavSeq = -1;
    videoAnchorStableScans = 0;
  }

  /**
   * 视频按钮：按钮先装进我们自己的宿主容器（`.loupe-host`），容器再被**一次性**追加进原生操作行
   * `.video-toolbar-right` **内部**——不插兄弟节点，也不用 `#playerWrap`/`#bilibili-player` 这类早期
   * 容器兜底（那会打乱站点脚本的挂载，实测导致 #commentapp 挂载失败）。装好之后这一侧就再不写入了：
   * 容器里的东西全是自己的，站点只多了一个 inert 节点。
   *
   * 时机：调用方已保证 window load（站点 hydration 结束）之后才走到这里；这里还要求操作行**连续多轮
   * 扫描完全不变**——同一个元素、孩子数不变、这段时间内它内部没有 childList 变更、也没有新的导航信号
   * ——才挂上去，绝不在站点正产出这个容器的过程中插节点。稳定性还没坐实就排下一轮（走合并窗口的
   * 定时器，不在站点渲染栈里写 DOM）。
   */
  function ensureVideoButton(): void {
    const anchor = findVideoActionsAnchor(doc);
    if (anchor === null) {
      resetVideoStability();
      diag('video-anchor', { hit: false });
      return;
    }
    if (videoHost !== null && videoHost.isConnected && videoHost.parentNode === anchor) return;
    if (videoHost !== null && !videoHost.isConnected) diag('video-host-lost', { target: describeElement(anchor) });
    const childCount = anchor.childElementCount;
    const unchanged =
      videoAnchorSeen === anchor &&
      videoAnchorChildCount === childCount &&
      videoAnchorMutationSeq === toolbarMutationSeq &&
      videoAnchorNavSeq === navigationSeq;
    if (!unchanged) {
      videoAnchorSeen = anchor;
      videoAnchorChildCount = childCount;
      videoAnchorMutationSeq = toolbarMutationSeq;
      videoAnchorNavSeq = navigationSeq;
      videoAnchorStableScans = 1;
      diag('video-anchor', { hit: true, stable: false, childCount, scans: videoAnchorStableScans });
      schedule();
      return;
    }
    videoAnchorStableScans += 1;
    const requiredScans = VIDEO_STABLE_SCANS + extraStableScans;
    if (videoAnchorStableScans < requiredScans) {
      diag('video-anchor', { hit: true, stable: false, childCount, scans: videoAnchorStableScans, requiredScans });
      schedule();
      return;
    }
    installVideoHost(anchor, childCount);
  }

  /**
   * 把宿主容器（内含按钮）一次性追加进操作行。整条链路只有这一处写进站点管理的节点：
   * 容器与按钮都在内存里造好再整体插入，观察者只会看到「多了一个自己的容器」这一次变更。
   */
  function installVideoHost(anchor: Element, childCount: number): void {
    videoHost?.remove();
    const host = doc.createElement('div');
    host.className = LOUPE_HOST_CLASS;
    host.style.cssText = HOST_CSS;
    host.append(createButton('subject', VIDEO_BUTTON_LABEL));
    anchor.appendChild(host);
    videoHost = host;
    // 站点把工具栏整块换掉后不许立刻插进新容器：下一次重插前重新确认一遍稳定性
    resetVideoStability();
    extraStableScans = 0;
    diag('video-button-insert', { target: describeElement(anchor), childrenBefore: childCount });
  }

  /**
   * 评论行放大镜的图标：`createElementNS` + `setAttribute` 逐个属性构造，绝不碰 innerHTML，
   * 页面上的评论内容再怎么注入也进不到这个 SVG 里。
   */
  function createMagnifyingGlassIcon(): SVGSVGElement {
    const svg = doc.createElementNS(SVG_NAMESPACE, 'svg');
    svg.setAttribute('viewBox', MAGNIFYING_GLASS_VIEW_BOX);
    svg.setAttribute('width', String(ICON_SIZE));
    svg.setAttribute('height', String(ICON_SIZE));
    // 图标只是装饰：可访问名在按钮的 aria-label 上，读屏不该把图标再念一遍
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const path = doc.createElementNS(SVG_NAMESPACE, 'path');
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('d', MAGNIFYING_GLASS_PATH);
    svg.append(path);
    return svg;
  }

  /**
   * 按钮节点：统一为 icon-only 放大镜（复用同一图标工厂与固定 24×24 尺寸），
   * 文字只进 title 与 aria-label（可访问名），不产生可见文字节点。
   * `kind` 区分视频级（subject，无 commentId）与评论树（thread，带 commentId）。
   */
  function createButton(kind: AnalyzeKind, label: string, commentId?: string): HTMLButtonElement {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = LOUPE_ACTION_CLASS;
    button.setAttribute(LOUPE_KIND_ATTRIBUTE, kind);
    if (commentId !== undefined) button.setAttribute(LOUPE_RPID_ATTRIBUTE, commentId);
    button.title = label;
    button.setAttribute('aria-label', label);
    // 先把图标装进按钮再整体插入：观察者只会看到「自己插了一个按钮」这一次变更
    button.append(createMagnifyingGlassIcon());
    button.style.cssText = ICON_BUTTON_CSS;
    return button;
  }

  function scan(): void {
    if (disposed) return;
    const mounted = siteMountFinished();
    diag('scan', { pageReady, mounted, commentsReady, areas: areas.size });
    // 站点首次挂载（水合）结束前一个页面节点都不写（见文件头「生命周期」）：水合前插节点会让站点
    // 水合失配 → 整棵 SSR DOM 被丢弃重建 → 页头组件二次 mounted → bili-header 二次 init → header 变空。
    // 观察者照常登记（只读），按钮等到这一刻之后才落盘。
    if (!pageReady || !mounted) return;
    ensureVideoButton();
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

  /**
   * 导航信号：只作废视频按钮的稳定观察并排一次重扫——绝不在导航回调里同步写 DOM。
   * SPA 换页之后紧接着就是站点水合，此刻往工具栏里插节点正是把它的挂载游标带偏的时机；
   * 作废稳定判定后，按钮至少要在导航之后重新安静观察 VIDEO_STABLE_SCANS + 1 轮才会出现。
   */
  function onNavigation(signal: string): void {
    if (disposed) return;
    navigationSeq += 1;
    extraStableScans = 1;
    resetVideoStability();
    diag('navigation', { signal, path: doc.location.pathname });
    schedule();
  }

  /**
   * 装上导航监听并返回摘除函数。全程只读，不改写任何全局。
   * Navigation API 的 `navigate` 覆盖 pushState/replaceState 与前进/后退（Chrome 116+，manifest 的
   * minimum_chrome_version 已对齐），是首选；没有它的环境退回 popstate/hashchange——回退里
   * pushState 型换页不产生任何事件，那种导航由文档观察者看到新 DOM（评论区换新）后自行重扫，
   * 因此漏一次信号最多晚一拍，不会漏掉注入。
   */
  function watchNavigation(win: Window): () => void {
    const navigation: Navigation | undefined = win.navigation;
    const bindings: Array<{ target: EventTarget; type: string }> =
      navigation !== undefined
        ? [{ target: navigation, type: 'navigate' }]
        : [
            { target: win, type: 'popstate' },
            { target: win, type: 'hashchange' },
          ];
    const listeners = bindings.map(({ target, type }) => {
      const listener = (): void => onNavigation(type);
      target.addEventListener(type, listener);
      return { target, type, listener };
    });
    diag('nav-listen', { signals: bindings.map(({ type }) => type) });
    return () => {
      for (const { target, type, listener } of listeners) target.removeEventListener(type, listener);
    };
  }

  return {
    start(): void {
      if (disposed) return;
      diag('start', { readyState: doc.readyState, path: doc.location.pathname });
      documentObserver.observe(doc, DOCUMENT_OBSERVER_OPTIONS);
      const win = doc.defaultView;
      if (win !== null) {
        stopNavigation = watchNavigation(win);
        // 站点 hydration 未完成时等 window load；SPA 换页后 readyState 已是 complete，直接生效
        if (!pageReady) win.addEventListener('load', onPageReady, { once: true });
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
      diag('dispose', {});
      documentObserver.disconnect();
      for (const observer of scopeObserverByRoot.values()) observer.disconnect();
      scopeObserverByRoot.clear();
      stopNavigation?.();
      stopNavigation = null;
      doc.defaultView?.removeEventListener('load', onPageReady);
      for (const area of areas) {
        for (const scope of area.scopes) {
          for (const button of scope.querySelectorAll(`.${LOUPE_ACTION_CLASS}`)) button.remove();
        }
      }
      areas.clear();
      videoHost?.remove();
      videoHost = null;
    },
  };
}
