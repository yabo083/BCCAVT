/**
 * 原生评论区 Reddit 风格样式增强（内容脚本·主世界）。
 *
 * 只做视觉增强：把一份样式表注入 `bili-comments` 评论区下每一个已发现的 open shadow root，
 * 不隐藏任何原生节点、不改原生 DOM 结构与事件、不调用平台写接口——点赞、回复、发布、排序、
 * 加载更多全部保持原生可用，页面因此不再需要跨源 iframe 重画。
 *
 * 发现模型与 injector.ts 同源：document 上一个 childList+subtree 观察者盯 `bili-comments`
 * 的出现/消失；评论区下每个已发现的 open shadow root 各挂一个观察者，用来发现后加入的嵌套
 * shadow root（楼中楼列表等）。自己只改 `adoptedStyleSheets`（不产生 DOM 变更），观察者因此
 * 不会被自己的写入反复触发。不做定时全文档扫描，也不跨 closed shadow root。
 *
 * 幂等与可撤销：同一份 CSSStyleSheet 实例最多在每个 shadow root 的 `adoptedStyleSheets` 里出现
 * 一次；关闭开关或 dispose 时把它从所有 root 摘掉，root 的样式回到站点原样。站点重建 shadow root
 * 或整块换掉 `bili-comments` 后，新 root 会被重新登记并注入，旧 root 在 sweep 里恢复默认。
 *
 * 开关来自隔离世界：主世界读不到 chrome.storage，开关状态由 isolated.ts 经 window.postMessage
 * 推送（契约见 page-comments.ts）；主世界启动时也主动 request 一次。默认关闭：收到第一条开关
 * 消息前不注入任何样式。
 *
 * 同一枚开关还驱动多级回复的视觉重排与分支折叠（`native-thread.ts` 的重排器，`startNativeCommentStyler`
 * 里按同一份生命周期一起开、一起重扫、一起还原）。两件事各自维护自己的样式表与还原记录，
 * 互不依赖：关掉开关，两边都精确回到站点原样。
 */
import { COMMENT_AREA_SELECTOR, collectShadowRoots } from './targets';
import { NATIVE_STYLE_BRIDGE_SOURCE, isNativeStyleToggleMessage } from '../page-comments';
import { createNativeThreadOrganizer } from './native-thread';

export interface NativeCommentStyler {
  /** 开始按当前开关状态工作（默认关闭，收到开关前不注入）。 */
  start(): void;
  /** 打开/关闭增强：打开即注入并开始观察，关闭即摘掉全部自有样式并停止观察。 */
  setEnabled(enabled: boolean): void;
  /** 立即按当前状态重扫一次（导航后与测试用）。 */
  reconcile(): void;
  /** 停止观察并从所有 shadow root 摘掉自有样式。 */
  dispose(): void;
}

const OBSERVER_OPTIONS: MutationObserverInit = { childList: true, subtree: true };

/**
 * 样式表内容：Reddit 讨论串布局。只改视觉，不隐藏、不移动任何原生节点，不接管点击与滚动。
 *
 * 观感目标（每条根评论 = 一段讨论，楼中楼 = 缩进的分支）：
 *   - 左边一条只放头像的窄栏（根评论 52px、楼中楼 28px），正文不再被站点默认的 80px 空栏挤压；
 *   - 作者行紧凑（头像 + 昵称同排、字号 13px、昵称加重），时间/分数/回复收成次级的一行（12px）；
 *   - 楼中楼先出作者行、再出正文、最后操作行，按层级缩进，纵向 rail 由重排模块画在缩进区里
 *     （见 `native-thread.ts`）——这里只负责缩进的起点与回复列的字号/间距。
 *
 * 颜色一律取站点自身的 CSS 变量并给兜底值，明暗主题随站点切换，不需要单独判断。
 * `:host(...)` 前缀把 id 规则锁死在真正持有它们的 shadow root——这份样式表会被注入评论区下
 * 每一个 open shadow root（组件自己的 `<style>` 也在同一个 root 里），没有 `:host(...)` 的 `#id`
 * 会误伤同名 id（例如评论区外壳自己的 `#header`）。`tag + tag` 这类没有 id 的选择器只依赖评论组件
 * 自己的标签名，不需要前缀。
 *
 * 选择器按实机 shadow 结构复核（站点 id 只用来定位原生节点，改版后不匹配的选择器自然失效，
 * 不影响原生交互；重排/折叠那套规则锚在我们自己的属性上，见 `native-thread.ts`）：
 *   bili-comments
 *   └ bili-comment-thread-renderer                 ← 一条根评论 = 一个讨论块
 *     ├ bili-comment-renderer
 *     │ └ #body > a#user-avatar + #main > #header / #content / #footer
 *     │    #header  bili-comment-user-info > #info > #user-name / #user-level
 *     │    #content bili-rich-text > #contents（正文与表情图都在这里）
 *     │    #footer  bili-comment-action-buttons-renderer > #pubdate / #like / #dislike / #reply / #more
 *     ├ #replies > bili-comment-replies-renderer > #expander > #expander-contents（楼中楼）
 *     └ #div                                     ← 原生分隔线
 * 站点把正文字号/行高接在 `--bili-rich-text-*` 上：根评论的 bili-rich-text 用内联变量把它们接到
 * `--bili-comments-*`（所以改根评论正文要动这两个变量），楼中楼的 bili-rich-text 只内联了行高、
 * 字号走 `--bili-rich-text-font-size` 兜底（所以改回复正文要动的是它）。直接改 `#content` 的
 * `font-size` 对正文没有效果——正文在 bili-rich-text 自己的 shadow 里。
 *
 * 头像有两种形态：根评论是 `#user-avatar > bili-avatar`（头像由组件画在自己 shadow 内的画布上，
 * 画布比宿主大，用来铺挂件层——外侧只看得到 bili-avatar 这个盒子，写 `#user-avatar img` 也够不到），
 * 楼中楼是 `#user-avatar > img`（普通图片，站点用 width/height 属性写死 24px）。样式只钉死宿主的
 * 盒子尺寸与图片的填充方式，不改站点定位（根评论的 top 只跟着 padding-top 一起改）。
 *
 * 楼中楼容器里的分页入口（`#expander-footer`）等非回复子元素不在这份样式表的职责里：重排模块只
 * 认容器里的回复组件，非回复节点一概不写、不隐藏。
 */
export const NATIVE_COMMENT_STYLE_CSS = `
/* ---------- 讨论块边界：每条根评论一段 ---------- */
/* 原生分隔线画在 thread-renderer 自己的 #div 上（margin-left:80px 只对齐正文），
   这里拉通整宽并加呼吸感；不再给 host 加 border-top，避免和原生线叠成双线。
   讨论块之间**不能**用相邻兄弟选择器：实机里每个 thread-renderer 外面还套一层无属性的 <div>
   （Lit 片段，见 tmp/slice00.png），thread 之间永远不是兄弟节点，写了也不会生效 */
bili-comment-thread-renderer {
  display: block;
}
:host(bili-comment-thread-renderer) #div {
  margin-left: 0;
  margin-top: 2px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--graph_bg_thick, var(--line_regular, rgba(128, 128, 128, 0.16)));
}

/* ---------- 根评论：左边一条只放头像的窄栏，正文紧贴其后 ---------- */
/* 正文字号/行高由站点自己的入口传入（见文件头注释），改这两个变量才真的改到正文 */
:host(bili-comment-renderer) {
  --bili-comments-font-size-content: 15px;
  --bili-comments-line-height-content: 26px;
  --bili-comments-font-size-name: 13px;
}
/* 站点默认 padding-left:80px（头像栏 + 空档），Reddit 观感只需要头像那么宽 */
:host(bili-comment-renderer) #body {
  padding-top: 12px;
  padding-left: 52px;
}
:host(bili-comment-renderer) #header {
  margin-bottom: 2px;
}
:host(bili-comment-renderer) #content {
  margin-bottom: 2px;
}

/* 头像：把宿主钉成固定正方形，头像组件只许占这个盒子——图片原始尺寸多大都一样。
   根评论头像在 bili-avatar 组件里（它自带 shadow，头像画在内部那张比宿主大的画布上，用来铺挂件层），
   所以这里只从外侧钉 bili-avatar 的盒子：**不加** overflow 裁剪（会把站点的画布裁歪，只露出头像
   一角），也不写 img 规则（那个 img 在 bili-avatar 的 shadow 里，外侧选择器够不到）。
   盒子跟着上面的 padding-top 走，顶边对齐作者行（站点原来是 padding-top/top 都是 22px；
   这里收成 32px 的小头像，整条作者行因此只有一行高） */
:host(bili-comment-renderer) #user-avatar {
  top: 12px;
  left: 10px;
  width: 32px;
  height: 32px;
}
:host(bili-comment-renderer) #user-avatar bili-avatar {
  display: block;
  width: 100%;
  height: 100%;
}

/* 正文容器：长链接/长串不撑破容器，表情图不溢出（表情在 #contents 里就是 img） */
:host(bili-rich-text) #contents {
  overflow-wrap: anywhere;
}
:host(bili-rich-text) #contents img {
  max-width: 100%;
}

/* 作者行：昵称取正文色并加重（站点默认 --text2 + 500，偏灰、和正文拉不开层次）；
   等级徽章站点画成 30px 的方块，这里收成 20px，作者行才是一行而不是一块 */
:host(bili-comment-user-info) {
  --bili-comment-user-info-name-color: var(--text1, #18191c);
}
:host(bili-comment-user-info) #user-name {
  font-weight: 600;
}
:host(bili-comment-user-info) #user-level {
  margin-left: 4px;
  width: 20px;
  height: 20px;
}
:host(bili-comment-user-info) #user-level img {
  display: block;
  width: 100%;
  height: 100%;
}

/* ---------- 操作行：次级信息，收紧间距，时间与操作之间一个 · 分隔 ---------- */
/* 站点是 nowrap 的单行 flex：窄容器里「回复」会被压成一字一行。允许换行（只在放不下时才换），
   并且每一项都不许断字。折叠控件也挂在这一行里（重排模块挂的，靠 order 提到行首，见
   native-thread.ts 的样式表） */
:host(bili-comment-action-buttons-renderer) {
  flex-wrap: wrap;
  row-gap: 2px;
  font-size: 12px;
}
:host(bili-comment-action-buttons-renderer) #pubdate {
  font-size: 12px;
}
:host(bili-comment-action-buttons-renderer) #pubdate::after {
  content: '·';
  margin: 0 8px;
  color: var(--text3, #9499a0);
}
:host(bili-comment-action-buttons-renderer) #like,
:host(bili-comment-action-buttons-renderer) #dislike,
:host(bili-comment-action-buttons-renderer) #reply,
:host(bili-comment-action-buttons-renderer) #pubdate,
:host(bili-comment-action-buttons-renderer) #more {
  font-size: 12px;
  white-space: nowrap;
}
:host(bili-comment-action-buttons-renderer) #like,
:host(bili-comment-action-buttons-renderer) #dislike,
:host(bili-comment-action-buttons-renderer) #reply {
  margin-left: 12px;
}
/* 站点用 margin-left:20px 拉开各项；时间后面改由上面的 · 分隔，所以紧跟时间的那一项归零。
   注意 #more 不能碰：站点用 margin-left:auto 把它推到最右 */
:host(bili-comment-action-buttons-renderer) #pubdate + * {
  margin-left: 0;
}
:host(bili-comment-action-buttons-renderer) button {
  height: 20px;
  font-size: 12px;
  white-space: nowrap;
}

/* ---------- 楼中楼：缩进的回复列（每层的纵向 rail 由重排模块画，见 native-thread.ts） ---------- */
/* 原生 #expander 用 padding-left:80px 与根评论正文对齐；这里收成「一个缩进步长 + 头像栏」，
   让回复列的左缘（rail 的起点）落在根评论头像栏里，第一条回复的正文与根评论正文同一列。
   容器自己不留左内边距：rail 的起点就是容器左缘（重排模块按层级把缩进加在每条回复上） */
:host(bili-comment-replies-renderer) #expander {
  padding-left: 30px;
  margin-top: 2px;
}
:host(bili-comment-replies-renderer) #expander-contents {
  padding-left: 0;
}
/* 原生折叠入口（收起/展开楼中楼）做成次级链接的样子；不加任何行为，点击照旧走原生 */
:host(bili-comment-replies-renderer) #view-more {
  font-size: 12px;
  color: var(--brand_blue, #00aeec);
}

/* 楼中楼每条回复：作者行、正文、操作行各占一行（站点把作者行与正文排在同一行的内联流里，
   这里把作者行块级化，回复才有 Reddit 那样的「先看谁说的、再看说了什么」） */
/* 站点给回复的 bili-rich-text 只内联了行高、没有内联字号，所以字号走 bili-rich-text 自己的
   --bili-rich-text-font-size（回复元素上没有内联覆盖，能从 reply-renderer 继承到）；
   行高被内联成字面量 24px，CSS 不覆盖站点的内联声明（不加 !important），保持站点原样 */
:host(bili-comment-reply-renderer) {
  --bili-rich-text-font-size: 14px;
  --bili-comments-font-size-name: 12px;
}
:host(bili-comment-reply-renderer) bili-comment-user-info {
  display: block;
}
:host(bili-comment-reply-renderer) #body {
  padding-top: 7px;
  padding-bottom: 7px;
  padding-left: 28px;
}
/* 楼中楼头像是 #user-avatar 里的普通 img（站点用 width/height 属性写死 24x24）——这是外侧选择器
   够得到的形态。属性宽高会被 CSS 覆盖，所以钉死盒子再让图片填满裁圆：图片原始尺寸再大也只占 20px。
   top 必须显式给：作者行块级化后，站点的绝对定位头像会退到作者行**下面**那一行的静态位置 */
:host(bili-comment-reply-renderer) #user-avatar {
  top: 7px;
  left: 0;
  width: 20px;
  height: 20px;
}
:host(bili-comment-reply-renderer) #user-avatar img {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
}

/* ---------- 窄屏（≤700px）：站点的左栏缩进在手机上吃掉正文宽度 ---------- */
/* 只收窄栏宽、头像与缩进步长（步长归重排模块的样式表管），不动层级关系：
   根评论 #body 的 52px → 40px（头像跟着缩到 28px），楼中楼 #expander 的 30px → 28px
   （回复列的左缘仍是 rail 的起点，第一条回复的正文与根评论正文同一列）。
   放在最末尾：与基础规则特异性相同，靠后者生效 */
@media (max-width: 700px) {
  :host(bili-comment-renderer) #body {
    padding-left: 40px;
  }
  :host(bili-comment-renderer) #user-avatar {
    top: 10px;
    left: 8px;
    width: 28px;
    height: 28px;
  }
  :host(bili-comment-replies-renderer) #expander {
    padding-left: 28px;
  }
  :host(bili-comment-replies-renderer) #expander-contents {
    padding-left: 0;
  }
  :host(bili-comment-reply-renderer) #body {
    padding-left: 24px;
  }
  :host(bili-comment-reply-renderer) #user-avatar {
    width: 18px;
    height: 18px;
  }
}
`.trim();

/** 用文档所在窗口的 CSSStyleSheet 构造：主世界里它与页面同一个 realm，可直接被 shadow root 采纳。 */
function createStyleSheet(doc: Document): CSSStyleSheet {
  const sheet = new (doc.defaultView?.CSSStyleSheet ?? CSSStyleSheet)();
  sheet.replaceSync(NATIVE_COMMENT_STYLE_CSS);
  return sheet;
}

export function createNativeCommentStyler(doc: Document): NativeCommentStyler {
  const sheet = createStyleSheet(doc);
  /** 已采纳本样式表的 open shadow root；关闭时按它精确摘除。 */
  const styledRoots = new Set<ShadowRoot>();
  /** shadow root → 观察者；用来发现后加入的嵌套 shadow root。 */
  const observerByRoot = new Map<ShadowRoot, MutationObserver>();
  let documentObserver: MutationObserver | null = null;
  let enabled = false;
  let scheduled = false;
  let disposed = false;

  /** 文档级只关心评论区出现/消失；评论区内部的变更由各 shadow root 的观察者负责。 */
  function isCommentAreaChange(record: MutationRecord): boolean {
    for (const node of [...record.addedNodes, ...record.removedNodes]) {
      if (!(node instanceof Element)) continue;
      if (node.matches(COMMENT_AREA_SELECTOR) || node.querySelector(COMMENT_AREA_SELECTOR) !== null) return true;
    }
    return false;
  }

  function onDocumentRecords(records: MutationRecord[]): void {
    for (const record of records) {
      if (isCommentAreaChange(record)) {
        schedule();
        return;
      }
    }
  }

  function watchScope(root: ShadowRoot): void {
    if (observerByRoot.has(root)) return;
    const observer = new MutationObserver((records) => {
      let touched = false;
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          touched = true;
          for (const nested of collectShadowRoots(node)) watchScope(nested);
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
  function sweep(): void {
    for (const [root, observer] of observerByRoot) {
      if (root.host.isConnected) continue;
      observer.disconnect();
      observerByRoot.delete(root);
      removeFrom(root);
    }
  }

  function scan(): void {
    if (disposed || !enabled) return;
    // 每次重扫都重新找一遍评论区：bili-comments 是懒渲染的，元素也可能整块被换掉
    for (const root of commentScopes()) {
      watchScope(root);
      applyTo(root);
    }
    sweep();
  }

  function enable(): void {
    if (documentObserver === null) {
      documentObserver = new MutationObserver(onDocumentRecords);
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

/**
 * 主世界入口：创建样式增强器与多级回复重排器，接上「开关」桥（隔离世界 → 主世界），并主动拉一次当前状态。
 * 两者共用同一枚开关与同一份生命周期：打开即样式 + 重排/折叠，关闭即各自精确还原（样式表、内联变量、
 * 自有属性与折叠控件）。返回增强器句柄，调用方（入口脚本/测试）可据此 dispose。
 */
export function startNativeCommentStyler(doc: Document, win: Window = doc.defaultView ?? window): NativeCommentStyler {
  const styler = createNativeCommentStyler(doc);
  // 多级回复的视觉重排与分支折叠：与样式增强同一枚开关，各自维护自己的样式表与还原记录
  const organizer = createNativeThreadOrganizer(doc);
  const applyEnabled = (enabled: boolean): void => {
    styler.setEnabled(enabled);
    organizer.setEnabled(enabled);
  };
  styler.start();
  organizer.start();
  win.addEventListener('message', (event) => {
    // 只认本窗口、带桥标记的开关消息；页面脚本伪造它最多只是改样式，不涉及任何数据或接口
    if (event.source !== win) return;
    if (!isNativeStyleToggleMessage(event.data)) return;
    applyEnabled(event.data.enabled);
  });
  // 主世界脚本可能晚于隔离世界注册监听：主动 request 一次，避免丢掉首帧开关状态
  win.postMessage({ source: NATIVE_STYLE_BRIDGE_SOURCE, type: 'request' }, win.location.origin);
  return {
    start(): void {
      styler.start();
      organizer.start();
    },
    setEnabled: applyEnabled,
    reconcile(): void {
      styler.reconcile();
      organizer.reconcile();
    },
    dispose(): void {
      organizer.dispose();
      styler.dispose();
    },
  };
}
