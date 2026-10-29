/**
 * 原生多级回复的 Reddit 式视觉重排与分支折叠（内容脚本·主世界）。
 *
 * 站点把一条根评论下的所有楼中楼**平铺**在同一个容器里（`bili-comment-replies-renderer` 的 shadow
 * root 里那个「直接子元素里有 `bili-comment-reply-renderer`」的元素，实机是 `#expander > #expander-contents`，
 * 元素子节点就是一条条 `bili-comment-reply-renderer`，彼此是
 * 兄弟）；层级只存在于组件数据里（`__data` / `.data` 的 `rpid_str` / `parent_str` / `root_str`），
 * 视觉上完全没有分支感。但 `#expander-footer`（分页「点击查看」）与 `#reply-container`（编辑器）
 * 不参与重排，也永远不会被隐藏。这里做两件事：
 *
 *   1. 用已加载的父链算出「父先子后」的前序（算法在 `native-thread-layout.ts`：纯逻辑、不碰 DOM，
 *      层级构造 / 剪环 / 迭代遍历都在那里，将来从平台 API 归一化出的评论模型可以复用同一份）；
 *      本文件只做原生页面适配：把前序下标与层级写进每条的 CSS 变量
 *      （`--loupe-thread-order` / `--loupe-thread-depth`），容器在自有样式表里变成纵列 flex——
 *      **一个原生节点都不移动**，改变的只是视觉顺序；缩进按层级加在条目自己的 padding 上，
 *      每一层的纵向 rail 用重复渐变画进同一段 padding（几层就有几条竖线，线距正好一个缩进步长），
 *      层级在算的时候封顶，样式表里再 `min()` clamp 一次兜底。
 *   2. 给每条「有已加载后代」的评论在自己的操作行里挂一个折叠控件（按钮 + caret 图标 + 数量 +
 *      `title` / `aria-label` / `aria-expanded`）。点它只隐藏**已加载**的后代（打 `data-loupe-thread-hidden`，
 *      由样式表 `display: none`），节点保留、原生事件与写操作一律照旧；折叠状态按评论 id 存，
 *      同一线程后加载进来的回复会继承。控件挂进操作行的 open shadow root（和放大镜同一挂载点），
 *      不用 `innerHTML`，也不动任何原生节点。
 *
 * 边界与 fail-safe：
 *   - 容器靠**结构探测**找：`bili-comment-replies-renderer` 的 shadow root 里，直接子元素里有
 *     `bili-comment-reply-renderer` 的元素（多个候选取最内层），**不认 `#expander-contents` 这个
 *     id**——id 会随站点改版消失，认 id 会让整块功能静默失效。容器里的非回复子元素（分页入口、
 *     加载占位）一律不排、不隐藏、不写自有属性，只在视觉顺序上让位给回复。
 *   - 只在容器结构可读时动手：容器里至少有一条 `bili-comment-reply-renderer`，且每条都能读到
 *     纯数字 rpid、rpid 不重复。任何一条对不上（未知组件版本、重复 id、数据缺失）就整容器跳过
 *     ——不排、不缩进、不折叠、不隐藏，原生顺序与显隐原样保留；连一条回复都找不到也什么都不做。
 *   - 根评论 id 读不出来（`__data`/`.data` 都没有或不是数字）时整线程跳过：父 id 无从解释，宁可不排。
 *   - 父 id 读不到、平台给 `0`、或不在**已加载**的回复里：该条显示在当前顶层，标
 *     `data-loupe-thread-orphan`，样式表就地写「父评论未加载」，绝不假称它属于某条分支。
 *   - 折叠文案只报**已加载**条数，平台声明的总数另附在括号里，不把已加载冒充全量。
 *   - 关闭开关或 dispose：内联变量精确还原（写之前是什么就是什么）、自有属性摘掉、折叠控件移除、
 *     自有样式表摘除，页面回到站点原样。
 *
 * 观察者只有自己的范围：document 上盯评论区出现/消失（评论区以下的变更不看），评论区下每个已发现的
 * open shadow root 各挂一个，用来发现后加入的回复、容器与嵌套 root。只观察 childList+subtree，
 * 自己的内联变量/属性写入不产生记录；自己插入或移除的折叠控件在记录里被识别并跳过，因此不会自激。
 */
import { COMMENT_ACTIONS_SELECTOR, COMMENT_AREA_SELECTOR, collectShadowRoots, commentTreeSize } from './targets';
import { MAX_THREAD_DEPTH, layoutThread } from './native-thread-layout';

export interface NativeThreadOrganizer {
  /** 开始按当前开关状态工作（默认关闭：收到开关前不动页面）。 */
  start(): void;
  /** 打开/关闭重排与折叠：打开即扫描并观察，关闭即还原全部自有改动。 */
  setEnabled(enabled: boolean): void;
  /** 立即按当前状态重扫一次（导航后与测试用）。 */
  reconcile(): void;
  /** 停止观察并还原全部自有改动（此前记下的折叠状态一并丢弃）。 */
  dispose(): void;
}

/** 折叠控件的类名与数据属性。刻意不复用放大镜的 `loupe-action`：那个类名绑定隔离世界的后台动作协议。 */
export const THREAD_TOGGLE_CLASS = 'loupe-thread-toggle';
/** 控件指向的评论 id（点它折叠/展开的就是这条评论的后代）。 */
export const THREAD_TOGGLE_ID_ATTRIBUTE = 'data-loupe-thread-toggle';
/** 控件上的数量徽标类名：显示这条评论有多少条已加载后代（与 title/aria-label 同一个数）。 */
const TOGGLE_COUNT_CLASS = 'loupe-thread-toggle-count';
/** 控件所属线程的根评论 id：折叠状态按线程分开存，切换线程不串。 */
export const THREAD_TOGGLE_ROOT_ATTRIBUTE = 'data-loupe-thread-root';
/** 容器已被按前序重排（样式表里所有重排/折叠规则都挂在这个属性上）。 */
export const THREAD_ORDERED_ATTRIBUTE = 'data-loupe-thread-ordered';
/** 该条是某个已折叠评论的已加载后代：由样式表隐藏，节点本身保留。 */
export const THREAD_HIDDEN_ATTRIBUTE = 'data-loupe-thread-hidden';
/** 该条的父不在已加载列表里：显示在当前顶层并就地说明。 */
export const THREAD_ORPHAN_ATTRIBUTE = 'data-loupe-thread-orphan';
/** 每条回复的两个 CSS 变量：视觉前序下标与层级（0 = 容器顶层）。 */
export const THREAD_ORDER_PROPERTY = '--loupe-thread-order';
export const THREAD_DEPTH_PROPERTY = '--loupe-thread-depth';

const THREAD_SELECTOR = 'bili-comment-thread-renderer';
/** 根评论组件（楼中楼是 `bili-comment-reply-renderer`，标签名不同，不会误配）。 */
const COMMENT_SELECTOR = 'bili-comment-renderer';
const REPLY_SELECTOR = 'bili-comment-reply-renderer';
const REPLIES_HOST_SELECTOR = 'bili-comment-replies-renderer';

/**
 * 非回复子元素在 flex 排序空间里被让到的位置。`order` 是容器里所有子元素共享的一条数轴，
 * 不把分页入口/加载占位钉到回复后面，回复的 `order` 就会把它们插进分支中间；取值远超任何
 * 已加载回复的条数（平台分页不可能到这个量级），只让顺序、不隐藏、不写自有属性。
 */
const NON_REPLY_ORDER = 999999;

const OBSERVER_OPTIONS: MutationObserverInit = { childList: true, subtree: true };

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const ICON_SIZE = 12;

/**
 * 折叠控件的图标数据：Phosphor 的 `ph:caret-down`，逐字取自 `@iconify-json/ph` 的
 * `icons['caret-down']`（body 里那条 `<path>` 的 `d`，viewBox 由该包 width/height = 256 得出；
 * Phosphor Icons，MIT）。展开时向下、折叠时由样式表转 -90° 指向右——不换图标、不改 DOM。
 * 内容脚本是自包含 IIFE，整包 icons.json 不能进页面脚本，所以这里内联这一条；
 * tests/extension/native-thread.test.ts 会把它与包里的数据逐字比对，防止两处漂移。
 */
const CARET_VIEW_BOX = '0 0 256 256';
const CARET_DOWN_PATH =
  'm213.66 101.66l-80 80a8 8 0 0 1-11.32 0l-80-80a8 8 0 0 1 11.32-11.32L128 164.69l74.34-74.35a8 8 0 0 1 11.32 11.32';

/** 控件样式用 CSSOM 写内联，绕开页面 CSP；颜色沿用站点变量并给兜底值。 */
const TOGGLE_CSS = [
  'display:inline-flex',
  'align-items:center',
  'justify-content:center',
  'box-sizing:border-box',
  'height:20px',
  'min-width:20px',
  'padding:0 6px',
  'margin:0 8px 0 0',
  'flex:none',
  'line-height:1',
  'border:1px solid var(--line_regular,#e3e5e7)',
  'border-radius:10px',
  'background:transparent',
  'color:var(--text2,#61666d)',
  'font-family:inherit',
  'font-size:12px',
  'cursor:pointer',
  'vertical-align:middle',
].join(';');

/**
 * 自有样式表：重排、缩进、折叠、孤立条目说明与控件的图标朝向。全部挂在自有属性/变量上，
 * 结构不合预期（容器没被标记 `data-loupe-thread-ordered`）时整批规则失效——fail-safe 不隐藏。
 * 样式表里的层级封顶值直接取布局内核的 {@link MAX_THREAD_DEPTH}，两边不会各写一个数。
 */
export const NATIVE_THREAD_CSS = `
/* 折叠：只隐藏我们标记过的「已加载后代」。规则挂在容器标记下，未标记的容器一条都不生效 */
[data-loupe-thread-ordered] [data-loupe-thread-hidden] {
  display: none;
}
/* 纵列 flex：order 只在 flex/grid 项目上有意义。DOM 一个节点都不移动，换的只是视觉顺序。
   缩进步长定义在容器上、条目继承，窄屏只改这一处（见文件末尾的媒体查询） */
:host(bili-comment-replies-renderer) [data-loupe-thread-ordered] {
  display: flex;
  flex-direction: column;
  --loupe-thread-step: 22px;
}
/* 容器里的非回复子元素（分页入口、加载占位……）：order 是容器里所有子元素共享的一条数轴，
   不把它们让到回复后面，回复的 order 就会把它们插进分支中间。只让顺序，不动它们的 DOM、
   不隐藏、也不写任何自有属性 */
:host(bili-comment-replies-renderer) [data-loupe-thread-ordered] > :not(bili-comment-reply-renderer) {
  order: ${NON_REPLY_ORDER};
}
/* 每条楼中楼：按层级缩进，并在自己的左缘画出「祖先各层」的一条条纵向 rail。
   rail 用重复渐变画进 padding 区：图案宽度 = 层数 × 步长（层数由布局内核按已加载父链算出并封顶，
   这里再 clamp 一次兜底），所以几层就有几条竖线，线距正好是一个缩进步长；
   第 0 层（根评论的直接回复）也画一条——它是这一整段回复与上面那条评论的连接线 */
:host(bili-comment-replies-renderer) [data-loupe-thread-ordered] > bili-comment-reply-renderer {
  order: var(--loupe-thread-order, 0);
  padding-left: calc((min(var(--loupe-thread-depth, 0), ${MAX_THREAD_DEPTH}) + 1) * var(--loupe-thread-step));
  background-image: repeating-linear-gradient(
    to right,
    var(--text3, #9499a0) 0 2px,
    transparent 2px var(--loupe-thread-step)
  );
  background-size: calc((min(var(--loupe-thread-depth, 0), ${MAX_THREAD_DEPTH}) + 1) * var(--loupe-thread-step)) 100%;
  background-repeat: no-repeat;
}
/* 父评论不在已加载列表里：条目仍显示在当前顶层，并就地说明，不假装它属于某条分支 */
:host(bili-comment-replies-renderer) [data-loupe-thread-ordered] > bili-comment-reply-renderer[data-loupe-thread-orphan]::before {
  content: '父评论未加载';
  display: block;
  margin-bottom: 2px;
  font-size: 12px;
  line-height: 18px;
  color: var(--text3, #9499a0);
}
/* 折叠控件：挂在操作行末尾（DOM 位置不变），靠 order 提到行首，落在作者行下方的最左边 */
[data-loupe-thread-toggle] {
  order: -1;
}
/* 同一枚 caret 图标，折叠时转 -90° 指向右（不换图标数据、不动 DOM） */
[data-loupe-thread-toggle] svg {
  flex: none;
  transition: transform 0.15s ease;
}
[data-loupe-thread-toggle][aria-expanded='false'] svg {
  transform: rotate(-90deg);
}
/* 控件上的数量：与 title/aria-label 同源的「已加载后代条数」，图标右侧的小号数字 */
[data-loupe-thread-toggle] .loupe-thread-toggle-count {
  margin-left: 3px;
  font-size: 11px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
/* 窄屏：站点的左栏缩进本就紧，缩进步长收一档（只改容器上的这一个值，条目跟着变） */
@media (max-width: 700px) {
  :host(bili-comment-replies-renderer) [data-loupe-thread-ordered] {
    --loupe-thread-step: 12px;
  }
}
`.trim();

/** 组件数据载体：上游读 `__data`，实机同时有 `.data`。 */
interface CommentDataCarrier extends Element {
  __data?: unknown;
  data?: unknown;
}

/** 纯数字 B 站 id（一律按字符串处理：rpid 可能超过 2^53）；`'0'`、前导零、缺失与其它类型都不算 id。 */
function idOrNull(value: unknown): string | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  if (typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value)) return value === '0' ? null : value;
  return null;
}

/** `*_str` 优先（避免大整数精度丢失），回退数字字段；`'0'` 与缺失同等对待（无）。 */
function idField(raw: Record<string, unknown>, name: string): string | null {
  return idOrNull(raw[`${name}_str`]) ?? idOrNull(raw[name]);
}

function rawDataOf(element: Element | null): Record<string, unknown> | null {
  if (element === null) return null;
  const carrier = element as CommentDataCarrier;
  for (const value of [carrier.__data, carrier.data]) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  }
  return null;
}

interface CommentData {
  id: string;
  /** 结构父（`parent`/`parent_str`，`'0'`/缺失 = 未知）。`dialog` 是 @目标，不参与层级。 */
  parentId: string | null;
}

/** 评论的 id 与结构父：读不到（或不是数字）返回 null，调用方据此 fail-safe 跳过。 */
function commentDataOf(element: Element | null): CommentData | null {
  const raw = rawDataOf(element);
  if (raw === null) return null;
  const id = idField(raw, 'rpid');
  if (id === null) return null;
  return { id, parentId: idField(raw, 'parent') };
}

/** 平台声明的回复总数（只用于折叠文案里说明「已加载之外还有多少」）；认不出来返回 null。 */
function declaredReplyCountOf(element: Element | null): number | null {
  if (element === null) return null;
  const size = commentTreeSize(element);
  return size === null ? null : Math.max(0, size - 1);
}

/** 我们写在某个原生元素上的东西：内联变量的原值与自有属性，供关闭时逐条还原。 */
interface ElementWrites {
  /** 写之前的内联值（null = 之前没有这个声明，还原时 removeProperty）。 */
  originals: Map<string, string | null>;
  /** 我们加上的自有属性。 */
  attributes: Set<string>;
}

/** 容器里的一条楼中楼：原生元素 + 从组件数据读出的关系（布局算法只需后者）。 */
interface ReplyRow {
  element: HTMLElement;
  /** 该评论自己的操作行（折叠控件挂它里面）；读不到就没有控件，但不影响重排。 */
  actionRow: HTMLElement | null;
  id: string;
  parentId: string | null;
}

/** 一个已认出的楼中楼容器：它所在的 shadow root、容器元素与里面（只含回复）的条目。 */
interface RepliesScope {
  root: ShadowRoot;
  container: HTMLElement;
  rows: ReplyRow[];
}

/** 共享的空折叠集合：没被折叠过的线程不建 Set，避免无意义分配。 */
const NO_COLLAPSED: ReadonlySet<string> = new Set<string>();

function createStyleSheet(doc: Document): CSSStyleSheet {
  const sheet = new (doc.defaultView?.CSSStyleSheet ?? CSSStyleSheet)();
  sheet.replaceSync(NATIVE_THREAD_CSS);
  return sheet;
}

export function createNativeThreadOrganizer(doc: Document): NativeThreadOrganizer {
  const sheet = createStyleSheet(doc);
  /** 已采纳本样式表的 open shadow root；关闭时按它精确摘除。 */
  const styledRoots = new Set<ShadowRoot>();
  /** shadow root → 观察者；用来发现后加入的回复、容器与嵌套 root。 */
  const observerByRoot = new Map<ShadowRoot, MutationObserver>();
  /** 写过东西的原生元素 → 还原记录（关闭与结构变更时按它精确还原）。 */
  const writesByElement = new Map<HTMLElement, ElementWrites>();
  /** 评论元素 → 我们挂在它操作行里的折叠控件。 */
  const toggleByComment = new Map<HTMLElement, HTMLButtonElement>();
  /** 线程根 id → 已折叠的评论 id 集合。按线程分开：切换线程不串，同线程新加载的回复继承。 */
  const collapsedByThread = new Map<string, Set<string>>();
  /** 线程根 id → 它的根元素；元素脱离文档后连同折叠状态一起回收。 */
  const hostByThreadId = new Map<string, Element>();
  let documentObserver: MutationObserver | null = null;
  let enabled = false;
  let scheduled = false;
  let disposed = false;

  // ────────── 自有写入与还原 ──────────

  function writesFor(element: HTMLElement): ElementWrites {
    const existing = writesByElement.get(element);
    if (existing !== undefined) return existing;
    const created: ElementWrites = { originals: new Map(), attributes: new Set() };
    writesByElement.set(element, created);
    return created;
  }

  /** 写自有 CSS 变量：只记一次原值，同值不重复写。绝不整段覆盖 style 属性。 */
  function setOwnVariable(element: HTMLElement, property: string, value: string): void {
    const writes = writesFor(element);
    if (!writes.originals.has(property)) {
      const previous = element.style.getPropertyValue(property);
      writes.originals.set(property, previous === '' ? null : previous);
    }
    if (element.style.getPropertyValue(property) !== value) element.style.setProperty(property, value);
  }

  /** 加/摘自有属性：摘除只对自己加过的属性生效。 */
  function setOwnFlag(element: HTMLElement, attribute: string, present: boolean): void {
    const writes = writesFor(element);
    if (present) {
      writes.attributes.add(attribute);
      if (!element.hasAttribute(attribute)) element.setAttribute(attribute, '');
      return;
    }
    if (!writes.attributes.delete(attribute)) return;
    element.removeAttribute(attribute);
  }

  /** 还原一个元素上的一切自有写入（内联变量回到原值，自有属性摘掉）。 */
  function releaseElement(element: HTMLElement): void {
    const writes = writesByElement.get(element);
    if (writes === undefined) return;
    writesByElement.delete(element);
    for (const [property, original] of writes.originals) {
      if (original === null) element.style.removeProperty(property);
      else element.style.setProperty(property, original);
    }
    for (const attribute of writes.attributes) element.removeAttribute(attribute);
  }

  function removeToggle(comment: HTMLElement): void {
    const mounted = toggleByComment.get(comment);
    if (mounted === undefined) return;
    toggleByComment.delete(comment);
    mounted.remove();
  }

  function releaseComment(comment: HTMLElement | null): void {
    if (comment === null) return;
    releaseElement(comment);
    removeToggle(comment);
  }

  /** 容器及其元素子节点上的一切自有写入（含折叠控件）：结构不合预期时整块还原。 */
  function releaseContainer(container: HTMLElement | null): void {
    if (container === null) return;
    for (const child of [...container.children]) if (child instanceof HTMLElement) releaseComment(child);
    releaseElement(container);
  }

  // ────────── 结构定位（全部从原生结构出发，不做任何猜测） ──────────

  /** 评论自己的操作行：优先它自己的 shadow root，再往下钻一层嵌套 shadow root。 */
  function actionRowOf(comment: Element | null): HTMLElement | null {
    if (comment === null) return null;
    const own = comment.shadowRoot;
    if (own === null) return null;
    const direct = own.querySelector(COMMENT_ACTIONS_SELECTOR);
    if (direct instanceof HTMLElement) return direct;
    for (const root of collectShadowRoots(own)) {
      const row = root.querySelector(COMMENT_ACTIONS_SELECTOR);
      if (row instanceof HTMLElement) return row;
    }
    return null;
  }

  function rootCommentOf(thread: Element): HTMLElement | null {
    const shadow = thread.shadowRoot;
    if (shadow === null) return null;
    const comment = shadow.querySelector(COMMENT_SELECTOR);
    return comment instanceof HTMLElement ? comment : null;
  }

  /**
   * 楼中楼容器（**结构探测，不认 id**）：`bili-comment-replies-renderer` 的 shadow root 里，
   * 「直接子元素里至少有一个 `bili-comment-reply-renderer`」的元素。实机容器的直接子元素里还有
   * 分页入口（`#expander-footer`）与加载占位这类非回复节点，所以判定只看「有没有回复」，
   * 不要求「全是回复」——那些节点一律不排、不隐藏、不写自有属性（顺序让位见样式表）。
   *
   * 认结构而不认 `#expander-contents` 这个 id：id 会随站点改版消失，而「容器里有回复组件」
   * 是它自己的渲染契约；多个候选取最内层（最深）的一个，最内层读不出 rpid 时退到次内层，
   * 一个可用的都没有就返回 null——调用方据此整线程跳过（fail-safe 不动作）。
   * 样式表只放进这个 root（规则只在这里用得上）。
   */
  function repliesScopeOf(thread: Element): RepliesScope | null {
    const shadow = thread.shadowRoot;
    if (shadow === null) return null;
    for (const host of shadow.querySelectorAll(REPLIES_HOST_SELECTOR)) {
      const hostShadow = host.shadowRoot;
      if (hostShadow === null) continue;
      for (const container of candidateContainers(hostShadow)) {
        const rows = parseReplies(container);
        if (rows !== null) return { root: hostShadow, container, rows };
      }
    }
    return null;
  }

  /** 候选容器按「最内层优先」：同层保持文档顺序（`sort` 稳定），最内层读不出 rpid 时由调用方退下一个。 */
  function candidateContainers(root: ShadowRoot): HTMLElement[] {
    const found: { element: HTMLElement; depth: number }[] = [];
    for (const element of root.querySelectorAll<HTMLElement>('*')) {
      if (![...element.children].some((child) => child.matches(REPLY_SELECTOR))) continue;
      found.push({ element, depth: depthWithin(root, element) });
    }
    found.sort((left, right) => right.depth - left.depth);
    return found.map((entry) => entry.element);
  }

  /** 元素在给定 shadow root 里的层数（root 的直接子元素为 1）：用来在多个候选里挑最内层的那个。 */
  function depthWithin(root: ShadowRoot, element: Element): number {
    let depth = 0;
    for (let node: Node | null = element; node !== null && node !== root; node = node.parentNode) depth += 1;
    return depth;
  }

  /** 节点所处的 shadow root（节点自己就是 shadow root 时返回它自己）；不在 shadow 里返回 null。 */
  function scopeOf(node: Node): ShadowRoot | null {
    const root = node instanceof ShadowRoot ? node : node.getRootNode();
    return root instanceof ShadowRoot ? root : null;
  }

  /**
   * 容器里的回复条目：只看**直接子元素里的** `bili-comment-reply-renderer`（分页入口、加载占位等
   * 非回复子元素一律跳过，不排、不隐藏、不写）；一条回复都没有、或某条读不到 id / id 重复，
   * 就返回 null——未知结构绝不假排列（fail-safe：不排、不缩进、不折叠、不隐藏）。
   */
  function parseReplies(container: HTMLElement): ReplyRow[] | null {
    const rows: ReplyRow[] = [];
    const ids = new Set<string>();
    for (const child of [...container.children]) {
      if (!(child instanceof HTMLElement) || !child.matches(REPLY_SELECTOR)) continue;
      const actionRow = actionRowOf(child);
      const data = commentDataOf(child) ?? commentDataOf(actionRow);
      if (data === null || ids.has(data.id)) return null;
      ids.add(data.id);
      rows.push({ element: child, actionRow, id: data.id, parentId: data.parentId });
    }
    return rows;
  }

  // ────────── 折叠控件 ──────────

  function caretIcon(): SVGSVGElement {
    const svg = doc.createElementNS(SVG_NAMESPACE, 'svg');
    svg.setAttribute('viewBox', CARET_VIEW_BOX);
    svg.setAttribute('width', String(ICON_SIZE));
    svg.setAttribute('height', String(ICON_SIZE));
    // 图标只是装饰：可访问名在按钮的 title/aria-label 上，读屏不该把图标再念一遍
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const path = doc.createElementNS(SVG_NAMESPACE, 'path');
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('d', CARET_DOWN_PATH);
    svg.append(path);
    return svg;
  }

  /** 只拦自己这个控件的点击：不让它冒泡去触发站点的评论交互，也不碰任何原生按钮。 */
  function onToggleClick(event: Event): void {
    const button = event.currentTarget;
    if (!(button instanceof HTMLButtonElement)) return;
    event.preventDefault();
    event.stopPropagation();
    if (disposed || !enabled) return;
    const commentId = button.getAttribute(THREAD_TOGGLE_ID_ATTRIBUTE);
    const threadId = button.getAttribute(THREAD_TOGGLE_ROOT_ATTRIBUTE);
    if (commentId === null || threadId === null) return;
    const collapsed = collapsedByThread.get(threadId) ?? new Set<string>();
    if (collapsed.has(commentId)) collapsed.delete(commentId);
    else collapsed.add(commentId);
    collapsedByThread.set(threadId, collapsed);
    // 折叠是用户动作：立刻同步重算一次，不排进合并窗口，省得显隐滞后一帧
    scan();
  }

  /**
   * 折叠控件：挂在该评论操作行（`row`，已由调用方解析一次）的 open shadow root 里（与放大镜同一挂载点），
   * 复用同一个按钮节点，站点的 Lit 把它清掉后下一轮重扫会重建。`aria-expanded` 跟着折叠状态走，
   * 文案只报已加载条数。
   */
  function ensureToggle(
    comment: HTMLElement,
    row: HTMLElement | null,
    threadId: string,
    commentId: string,
    loadedCount: number,
    declaredCount: number | null,
    collapsed: boolean,
  ): void {
    if (row === null) {
      removeToggle(comment);
      return;
    }
    const container = row.shadowRoot ?? row;
    // 控件的图标朝向规则就在它所在的这个 root 里：样式表只放到真正用到的 root
    const scope = scopeOf(container);
    if (scope !== null) applyTo(scope);
    let button = toggleByComment.get(comment);
    if (button === undefined || !button.isConnected || button.parentNode !== container) {
      button?.remove();
      button = doc.createElement('button');
      button.type = 'button';
      button.className = THREAD_TOGGLE_CLASS;
      button.append(caretIcon());
      button.style.cssText = TOGGLE_CSS;
      button.addEventListener('click', onToggleClick);
      container.append(button);
      toggleByComment.set(comment, button);
    }
    // 控件上的数量：与 title/aria-label 同源的「已加载后代条数」，折叠时也照旧显示
    let count = button.querySelector<HTMLElement>(`.${TOGGLE_COUNT_CLASS}`);
    if (count === null) {
      count = doc.createElement('span');
      count.className = TOGGLE_COUNT_CLASS;
      button.append(count);
    }
    // 数量没变就不重写：按 DOM 规定，赋同样的文字也会替换掉文本节点，白白多出一条变更记录
    const countText = String(loadedCount);
    if (count.textContent !== countText) count.textContent = countText;
    button.setAttribute(THREAD_TOGGLE_ID_ATTRIBUTE, commentId);
    button.setAttribute(THREAD_TOGGLE_ROOT_ATTRIBUTE, threadId);
    button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    // 「已加载」写进可访问名：隐藏的只是已加载的那几条，平台另有声明时把声明数一并写清楚
    const declared = declaredCount !== null && declaredCount > loadedCount ? `（平台声明 ${declaredCount} 条）` : '';
    const label = collapsed
      ? `已折叠 ${loadedCount} 条已加载回复，点击展开${declared}`
      : `折叠 ${loadedCount} 条已加载回复${declared}`;
    button.title = label;
    button.setAttribute('aria-label', label);
  }

  // ────────── 观察与扫描 ──────────

  /**
   * 自己写入的记录：`target` 落在折叠控件内部（徽标、文本节点等），或增删的节点就是控件自己。
   * 两者都跳过，否则观察者会被自己的写入反复触发——控件插入、徽标文本改写各会产生一条记录，
   * 认不出来就会自激成「扫描→写入→再排一轮」的死循环。
   */
  function isOwnRecord(record: MutationRecord): boolean {
    const target = record.target;
    if (target instanceof Element && target.closest(`.${THREAD_TOGGLE_CLASS}`) !== null) return true;
    const nodes = [...record.addedNodes, ...record.removedNodes];
    if (nodes.length === 0) return false;
    for (const node of nodes) {
      const element = node instanceof Element ? node : node.parentElement;
      if (element === null || element.closest(`.${THREAD_TOGGLE_CLASS}`) === null) return false;
    }
    return true;
  }

  function watchScope(root: ShadowRoot): void {
    if (observerByRoot.has(root)) return;
    const observer = new MutationObserver((records) => {
      let touched = false;
      for (const record of records) {
        if (isOwnRecord(record)) continue;
        touched = true;
        for (const node of record.addedNodes) {
          if (node instanceof Element) for (const nested of collectShadowRoots(node)) watchScope(nested);
        }
      }
      if (touched) schedule();
    });
    observer.observe(root, OBSERVER_OPTIONS);
    observerByRoot.set(root, observer);
  }

  /** 采纳样式表：已在列表里就不重复写入，规则也不会累积。 */
  function applyTo(root: ShadowRoot): void {
    if (root.adoptedStyleSheets.includes(sheet)) return;
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    styledRoots.add(root);
  }

  /** 摘除样式表，只动自己这一张：站点或别的扩展放的样式表原样保留。 */
  function removeFrom(root: ShadowRoot): void {
    styledRoots.delete(root);
    if (!root.adoptedStyleSheets.includes(sheet)) return;
    root.adoptedStyleSheets = root.adoptedStyleSheets.filter((candidate) => candidate !== sheet);
  }

  /** 评论区下的 open shadow root：评论区根自己 + 其子树里的全部嵌套 shadow root。 */
  function commentScopes(): ShadowRoot[] {
    const scopes: ShadowRoot[] = [];
    for (const element of doc.querySelectorAll(COMMENT_AREA_SELECTOR)) {
      const root = element.shadowRoot;
      if (root === null) continue;
      scopes.push(root, ...collectShadowRoots(root));
    }
    return scopes;
  }

  /** 评论区被整块换掉后，旧 root 与它的观察者都要清理，并让旧 root 恢复默认样式。 */
  function sweepRoots(): void {
    for (const [root, observer] of observerByRoot) {
      if (root.host.isConnected) continue;
      observer.disconnect();
      observerByRoot.delete(root);
      removeFrom(root);
    }
  }

  function releaseThread(rootComment: HTMLElement | null, container: HTMLElement | null): void {
    releaseContainer(container);
    releaseComment(rootComment);
  }

  function organizeThread(thread: Element, seen: Set<HTMLElement>, organizedIds: Set<string>): void {
    const rootComment = rootCommentOf(thread);
    const rootActionRow = actionRowOf(rootComment);
    // 根评论的数据可能挂在评论组件、它的操作行或 thread host 上（实机与预览都可能落在任一处），依次试
    const rootData = commentDataOf(rootComment) ?? commentDataOf(rootActionRow) ?? commentDataOf(thread);
    const scope = repliesScopeOf(thread);
    // 根评论数据缺失（父 id 无从解释）、容器认不出、或容器里的回复读不出 id：整线程跳过，
    // 之前排过的自有写入一并还原（fail-safe：不排、不缩进、不折叠、不隐藏）
    if (rootData === null || scope === null) {
      releaseThread(rootComment, scope?.container ?? null);
      return;
    }
    const { container, rows } = scope;
    // 重排/缩进/折叠/孤立说明的规则都在容器所在这个 root 里：样式表只放到真正用到的 root
    applyTo(scope.root);

    const rootId = rootData.id;
    const collapsed = collapsedByThread.get(rootId) ?? NO_COLLAPSED;
    const layout = layoutThread(rows, rootId, collapsed);
    const rowById = new Map<string, ReplyRow>();
    for (const row of rows) rowById.set(row.id, row);

    // 容器：标记「已按前序重排」——样式表里所有规则都挂在这个标记上
    seen.add(container);
    setOwnFlag(container, THREAD_ORDERED_ATTRIBUTE, true);
    for (const entry of layout) {
      const row = rowById.get(entry.id);
      if (row === undefined) continue;
      seen.add(row.element);
      setOwnVariable(row.element, THREAD_ORDER_PROPERTY, String(entry.order));
      setOwnVariable(row.element, THREAD_DEPTH_PROPERTY, String(entry.depth));
      setOwnFlag(row.element, THREAD_HIDDEN_ATTRIBUTE, entry.hidden);
      setOwnFlag(row.element, THREAD_ORPHAN_ATTRIBUTE, entry.orphan);
    }

    // 折叠控件：有已加载后代的每一条都有（线程根评论也一样，它折叠的是整条已加载回复列表）
    if (rootComment !== null) {
      if (layout.length > 0) {
        seen.add(rootComment);
        ensureToggle(
          rootComment,
          rootActionRow,
          rootId,
          rootId,
          layout.length,
          declaredReplyCountOf(rootActionRow ?? rootComment),
          collapsed.has(rootId),
        );
      } else {
        removeToggle(rootComment);
      }
    }
    for (const entry of layout) {
      const row = rowById.get(entry.id);
      if (row === undefined) continue;
      if (entry.descendantCount > 0) {
        ensureToggle(
          row.element,
          row.actionRow,
          rootId,
          entry.id,
          entry.descendantCount,
          declaredReplyCountOf(row.actionRow),
          collapsed.has(entry.id),
        );
      } else {
        removeToggle(row.element);
      }
    }

    organizedIds.add(rootId);
    hostByThreadId.set(rootId, thread);
  }

  /** 本轮没被认领的元素（站点丢了评论、结构变脏、线程消失）逐条还原，不留悬空的自有写入。 */
  function restoreUnseen(seen: Set<HTMLElement>): void {
    for (const element of [...writesByElement.keys()]) {
      if (seen.has(element)) continue;
      releaseElement(element);
    }
    for (const [comment, button] of [...toggleByComment]) {
      if (seen.has(comment)) continue;
      toggleByComment.delete(comment);
      button.remove();
    }
  }

  /** 线程根元素从文档里消失后，连同它的折叠状态一起回收（切换线程因此不会串味）。 */
  function pruneThreadState(organizedIds: Set<string>): void {
    for (const [id, host] of [...hostByThreadId]) {
      if (organizedIds.has(id)) continue;
      if (host.isConnected) continue;
      hostByThreadId.delete(id);
      collapsedByThread.delete(id);
    }
  }

  function scan(): void {
    if (disposed || !enabled) return;
    // 每次重扫都重新找一遍评论区：bili-comments 是懒渲染的，元素也可能整块被换掉。
    // 观察者挂到评论区下每个已发现的 open shadow root（发现后加入的回复与嵌套 root）；
    // 样式表本身只放进真正用得上它的 root（容器所在 root 与控件所在 root），不铺满所有 scope。
    const scopes = commentScopes();
    for (const root of scopes) watchScope(root);
    sweepRoots();
    const seen = new Set<HTMLElement>();
    const organizedIds = new Set<string>();
    for (const scope of scopes) {
      for (const thread of scope.querySelectorAll(THREAD_SELECTOR)) organizeThread(thread, seen, organizedIds);
    }
    restoreUnseen(seen);
    pruneThreadState(organizedIds);
  }

  function schedule(): void {
    if (scheduled || disposed || !enabled) return;
    // 合并同一批变更；用定时器而非 rAF：后台标签页里 rAF 会被暂停
    setTimeout(run, 0);
    scheduled = true;
  }

  function run(): void {
    scheduled = false;
    scan();
  }

  /** 文档级只关心评论区的出现/消失：评论区内部的变更由各 shadow root 的观察者负责。 */
  function isCommentAreaChange(record: MutationRecord): boolean {
    for (const node of [...record.addedNodes, ...record.removedNodes]) {
      if (!(node instanceof Element)) continue;
      if (node.matches(COMMENT_AREA_SELECTOR) || node.querySelector(COMMENT_AREA_SELECTOR) !== null) return true;
    }
    return false;
  }

  function enable(): void {
    if (documentObserver === null) {
      documentObserver = new MutationObserver((records) => {
        for (const record of records) {
          if (!isCommentAreaChange(record)) continue;
          schedule();
          return;
        }
      });
      documentObserver.observe(doc, OBSERVER_OPTIONS);
    }
    scan();
  }

  function disable(): void {
    documentObserver?.disconnect();
    documentObserver = null;
    for (const observer of observerByRoot.values()) observer.disconnect();
    observerByRoot.clear();
    for (const root of [...styledRoots]) removeFrom(root);
    styledRoots.clear();
    for (const element of [...writesByElement.keys()]) releaseElement(element);
    for (const button of toggleByComment.values()) button.remove();
    toggleByComment.clear();
    // 开关关掉就不留任何记忆：连折叠状态一起丢，重开是干净的初始状态
    hostByThreadId.clear();
    collapsedByThread.clear();
  }

  return {
    start(): void {
      if (disposed) return;
      // bili-comments 定义后再扫：定义前它的 shadow root 还不存在（attachShadow 不产生变更记录）
      void doc.defaultView?.customElements.whenDefined(COMMENT_AREA_SELECTOR).then(schedule);
    },
    setEnabled(next: boolean): void {
      if (disposed) return;
      // 重复开启只重扫一次，不会重复注入；重复关闭是空操作
      if (next === enabled) {
        if (next) scan();
        return;
      }
      enabled = next;
      if (next) enable();
      else disable();
    },
    reconcile(): void {
      scan();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      enabled = false;
      disable();
    },
  };
}
