/**
 * 页面评论区替换（内容脚本·隔离世界）。
 *
 * 设置开启且当前是 B 站视频页时，把原生评论区换成 Loupe 的嵌入阅读页（单例 iframe）；
 * 关闭、离开视频页或原生评论区消失时，精确还原页面。
 *
 * 硬约束：
 *   - 绝不删除、移动站点节点：只对原生评论区根写 `display`，并保存原值以便还原；
 *   - iframe 只是原生评论区的**相邻**自有槽位（原生根的下一个兄弟），因此隐藏原生根不会连带隐藏它；
 *     也就永远不需要（也绝不能）去隐藏它的祖先容器 `#commentapp`；站点页头（biliMainHeader 之类）
 *     与评论区的任何祖先都不碰，不写它们的 DOM 与样式；
 *   - 站点页头应用挂载完成之前绝不写页面 DOM：B 站头部用 `createApp().mount(容器)` 挂载，
 *     会先清空页头容器再渲染（未完成时容器上还没有 `data-v-app`），我们的写入必须在那个窗口之外；
 *     等待有上限（见 HEADER_WAIT_MS），页头脚本被挡住时阅读器照常挂载；
 *   - 观察范围随阶段收窄：只在「还没找到评论区容器 / 页头还在挂载」时用文档级观察者，
 *     之后只盯评论容器子树与容器父元素的直接子节点——页面其它地方的变更不排重扫，
 *     我们的 DOM 写入因此不会落在站点自己的重渲染里；
 *   - 槽位高度 = 嵌入页上报的内容高度，页面只有宿主这一根滚动条，iframe 内部不出现滚动条
 *     （长评论按自然高度排布，绝不因为固定高度而被裁掉）；
 *   - 明暗主题只读宿主（cookie / 底色亮度 / `<html>` 标记），经桥告知嵌入页，不写宿主任何样式；
 *   - 只有嵌入页发来 reader-ready（UI 已挂载）之后才隐藏原生评论，抓取期间用户先看到进度；
 *     且只认仍挂在文档里的那个 iframe 发来的消息——iframe 被拆掉后绝不再隐藏原生评论；
 *   - 内容脚本也只在 reader-ready 之后才往嵌入页投递：在那之前 iframe 的文档还停在 about:blank
 *     （源是宿主页面），带扩展源 targetOrigin 的 postMessage 只会被丢弃并在控制台留一条 origin 警告；
 *     主题与可见范围在就绪时会各重发一次，因此提前不发不丢信息；
 *   - 「在评论区定位」同理且**绝不丢**：后台只把请求发给按视频身份匹配到的那个标签页，本模块再对一次
 *     身份（BV 号）后投进嵌入页；iframe 还没挂载或还没就绪时先存在模块里，reader-ready 之后补发一次。
 *     挂载时还会读一次后台写下的待办定位（没开标签页时它先记在 storage.local），身份一致才消费（读后即删）；
 *   - 槽位永远最多一个：任何触发路径都先做幂等的「就位检查」，重复变更不会产生第二个 iframe；
 *   - 触发源只有三处（不做定时扫描）：DOM 的 MutationObserver（观察范围见上）、后台的
 *     `loupe:page-navigation`、开关的 storage.onChanged；
 *   - 写操作（点赞 / 取消点赞 / 回复 / 发表）由 iframe 发意图、本模块在页面上下文执行：
 *     bili_jct 只在执行的那一刻从 document.cookie 现读（见 reader-writes.ts），绝不跨桥；
 *     结果按 requestId 回投给发起的那个 iframe，iframe 被换掉后一律丢弃；
 *   - 读操作（顶层分页 / 评论树）同样由 iframe 发请求、本模块在页面上下文执行（见 reader-reads.ts）：
 *     读接口只有同站带 Cookie 才给全量，扩展源直连会被平台按匿名身份截断（顶层评论约 315 条就停）；
 *     只放行 api.bilibili.com 的只读 GET，结果只有解析后的 JSON 或错误类别与文案，Cookie 两个方向都不跨桥；
 *   - 扩展上下文失效（扩展被重载 / 更新 / 停用）后本页所有 chrome.* 都已作废：立刻熔断、
 *     还原页面并停止一切观察，控制台只留一条警告——否则每次 DOM 变更都会重复抛一次。
 *
 * 评论区是懒渲染的：`#commentapp` / `bili-comments` 都可能晚于内容脚本出现，且可能整块被替换，
 * 所以每次重估都重新查询原生根，而不是缓存元素。
 */
import {
  EMBEDDED_PAGE_PATH,
  LOCATE_PENDING_KEY,
  PAGE_COMMENTS_ENABLED_KEY,
  READER_BRIDGE_SOURCE,
  READER_LOCATE,
  READER_NAVIGATION,
  READER_READY,
  READER_THEME,
  READER_VIEWPORT,
  isExtensionContextInvalidated,
  isPageNavigationMessage,
  isPendingLocate,
  isReaderBridgeMessage,
  isReaderFetchRequest,
  isReaderHeightMessage,
  isReaderUserCardMessage,
  isReaderWriteRequest,
  USER_CARD_BRIDGE_SOURCE,
  videoIdOf,
} from '../page-comments';
import type {
  ReaderBridgeMessage,
  ReaderLocateMessage,
  ReaderUserCardMessage,
  ReaderFetchRequest,
  ReaderFetchResult,
  ReaderTheme,
  ReaderThemeMessage,
  ReaderViewportMessage,
  ReaderWriteRequest,
  ReaderWriteResult,
} from '../page-comments';
import { isLocateCommentRequest } from '../messages';
import { isVideoPageUrl } from '../url';
import { executeReaderFetch } from './reader-reads';
import { executeReaderWrite } from './reader-writes';
import { COMMENT_AREA_SELECTOR } from './targets';

/** 自有槽位标记：用来识别「这是自己插的节点」，避免观察者被自己的写入反复触发。 */
const SLOT_ATTRIBUTE = 'data-loupe-page-reader';
const SLOT_CLASS = 'loupe-page-reader';

/** 原生评论区的挂载容器：评论区懒渲染，它先出现才轮得到 `bili-comments`。 */
const COMMENT_CONTAINER_SELECTOR = '#commentapp';

/** 站点页头：槽位绝不落进它或它的后代——固定定位的头部不能被牵连。 */
const MAIN_HEADER_SELECTOR = '#biliMainHeader, bili-main-header';

/**
 * 站点页头应用挂载完成的标记：B 站头部用 Vue 3 的 `createApp().mount(容器)` 挂载，
 * 运行时会在根容器上写 `data-v-app`（见 bili-header.umd.js 里的 createApp 包装）。
 * 它出现之前页面头部还处于「清空容器 → 重新渲染」的过程中，本模块绝不在那一刻写页面 DOM。
 */
const HEADER_MOUNTED_MARKER = 'data-v-app';

/**
 * 站点 SSR 水合标记（Vue 2 的 `data-server-rendered`）：它在 `patch()` 一开始就被摘掉，而整棵 SSR DOM 的
 * 水合（含失败后丢弃重建）在同一个同步任务里完成——所以「文档里再也找不到它」等价于「站点首次挂载已经
 * 结束」。水合前写页面 DOM 会让站点 hydration 失配 → 整棵 SSR DOM 被丢弃重建 → 页头组件二次 `mounted()`
 * → `bili-header` 二次 `init()` 同一个 `#biliMainHeader`（先清空容器、再 patch 上一个 app 的旧 vnode 树）
 * → 顶部全局 header 变空消失。因此「页头迟迟不来」的兜底也必须等到这一刻之后（见 headerSettled）。
 */
const SSR_MOUNT_MARKER_ATTRIBUTE = 'data-server-rendered';

/**
 * 等站点页头挂载的上限：页头脚本被网络策略挡住或站点改版时，不能让阅读器永远不出现——
 * 超时后不再把「页头已挂载」当作写页面的前置条件（但「站点首次挂载结束」仍然是硬前置，见 headerSettled）。
 */
const HEADER_WAIT_MS = 8_000;

/**
 * 槽位（嵌入页 iframe 的容器）：高度完全由嵌入页上报的内容高度决定（READER_HEIGHT），
 * 评论流有多长就多长，宿主页面因此只有一根滚动条。
 * 这里给的只是第一帧的占位高度：上报到达前先钉住，避免 iframe 从默认的 150px 往上跳。
 */
const SLOT_CSS = 'display:block;width:100%;margin:8px 0;overflow:hidden';
const SLOT_PLACEHOLDER_HEIGHT = 'min(70vh, 720px)';
const FRAME_CSS = 'display:block;width:100%;height:100%;border:0;background:transparent';

/**
 * 嵌入页迟迟不发 reader-ready（扩展页加载失败等）：撤掉槽位并暂停重试，
 * 等下一次导航或开关变化再试，避免「撤掉 → 观察者重估 → 重建」的无限重试。
 */
const READY_TIMEOUT_MS = 20_000;

export function startPageReader(): void {
  if (started) return;
  started = true;
  try {
    // 不用 new URL(...).origin：Node 的 URL 会把 chrome-extension 这类非特殊 scheme 的源算成 "null"
    extensionOrigin = chrome.runtime.getURL('').replace(/\/+$/, '');
  } catch (error) {
    // 扩展刚被重载/更新：本页所有 chrome.* 都已作废，什么页面都不动（刷新页面即可恢复）
    stop('扩展上下文已失效，无法读取嵌入页地址', error);
    return;
  }
  pageReady = document.readyState === 'complete';

  syncObservers();
  // 页头挂载有上限：超时后照常挂载（宁可晚一点，也不赌页头一定来）
  headerTimer = window.setTimeout(onHeaderWaitExpired, HEADER_WAIT_MS);
  // 宿主明暗只在 <html> 的标记变化时重判一次（不写宿主任何东西）
  themeObserver = new MutationObserver(notifyTheme);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
  if (!pageReady) window.addEventListener('load', onWindowLoad, { once: true });
  window.addEventListener('message', onWindowMessage);
  chrome.runtime.onMessage.addListener(onRuntimeMessage);
  chrome.storage.onChanged.addListener(onStorageChanged);

  void readEnabled();
  void readPendingLocate();
  schedule();
}

// ───────────────────────── 模块级单例状态 ─────────────────────────

let started = false;
/** 设置：默认关闭，读盘成功后按实际值决定。 */
let enabled = false;
/** 站点 hydration 完成（window load）前不碰页面 DOM，避免打乱站点脚本的挂载游标。 */
let pageReady = false;
/** 地址变化后重新解析；就绪超时置位，暂停自动重试直到下一次导航/开关变化。 */
let retryBlocked = false;
/** 扩展上下文已失效：此后再不碰页面 DOM，也不再重试（刷新页面才能恢复）。 */
let invalidated = false;

/** 引导观察者：还没找到评论区容器时的文档级观察者（找到容器就立刻收窄）。 */
let bootstrapObserver: MutationObserver | null = null;
/** 容器观察者：只盯 `#commentapp` 子树——原生评论根被换掉、我们自己的槽位被清掉都发生在这里。 */
let containerObserver: MutationObserver | null = null;
/** 锚点观察者：只盯容器父元素的直接子节点——容器本身被换掉或槽位被摘掉。 */
let anchorObserver: MutationObserver | null = null;
/** 页头挂载等待期间的观察者：只盯页头容器，就绪后立刻摘掉。 */
let headerObserver: MutationObserver | null = null;
/** 观察者当前盯着的容器、锚点与页头：站点整块换掉它们时必须重新对齐。 */
let observedContainer: Element | null = null;
let observedAnchor: Element | null = null;
let observedHeader: Element | null = null;
let themeObserver: MutationObserver | null = null;
/** 页头挂载等待：超时后不再把「页头已挂载」当作写页面的前置条件。 */
let headerTimer: number | null = null;
let headerWaitExpired = false;
/** 站点首次挂载（SSR 水合）是否已经结束，见 siteMountFinished：判过一次就记住。 */
let siteMounted = false;
let slot: HTMLElement | null = null;
let frame: HTMLIFrameElement | null = null;
let readyTimer: number | null = null;
let viewportTimer: number | null = null;
let scheduled = false;
/**
 * 当前 iframe 是否已就绪（发过 reader-ready）：决定原生评论区能不能被隐藏，
 * 也决定内容脚本能不能往它投递——未就绪时 iframe 的文档还停在 about:blank（源是宿主页面），
 * 带扩展源 targetOrigin 的投递会被丢弃并在宿主控制台留一条 origin 警告。
 */
let readerReady = false;
/** 最近一次告知嵌入页的宿主主题；置空表示「还没告诉过」，重建 iframe 后必须重发。 */
let sentTheme: ReaderTheme | null = null;

/**
 * 待发定位：iframe 还没挂载或还没就绪时先存在这里，reader-ready 之后补发一次（定位绝不丢）。
 * 连它所属的视频身份一起存：地址换到别的视频后这条待办作废，绝不投给不对的页面（见 flushLocate）。
 */
let pendingLocate: { videoId: string; commentId: string } | null = null;

/** 被隐藏的原生评论区根，以及它被隐藏前的行内 display 原值。 */
let hiddenRoot: HTMLElement | null = null;
let savedDisplay: string | null = null;
let lastNativeDisplay: string | null = null;
let styleObserver: MutationObserver | null = null;

let extensionOrigin = '';

// ───────────────────────── 触发源 ─────────────────────────

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  // 合并同一批变更；用定时器而非 rAF：后台标签页里 rAF 会被暂停
  setTimeout(run, 0);
}

function run(): void {
  scheduled = false;
  if (invalidated) return;
  syncObservers();
  ensure();
}

/**
 * 观察范围随阶段收窄，绝不长期盯着整个文档：
 *   - 评论区容器还没出现：文档级 childList+subtree（只为发现容器，找到就立刻收窄）；
 *   - 容器出现后：只盯 `#commentapp` 子树与容器父元素的直接子节点；
 *   - 站点页头还在挂载时额外盯住页头容器：它是「可以开始写页面」的信号源，就绪后立刻摘掉。
 * 页面其它地方的变更（播放器、推荐列表、工具栏在 SPA 换页时的重建）因此不再排我们的重扫，
 * 我们的 DOM 写入也就不会落在站点自己的重渲染里。
 */
function syncObservers(): void {
  const container = document.querySelector(COMMENT_CONTAINER_SELECTOR);
  const header = headerSettled() ? null : document.querySelector<Element>(MAIN_HEADER_SELECTOR);

  if (header === null) {
    headerObserver?.disconnect();
    headerObserver = null;
    observedHeader = null;
  } else if (observedHeader !== header) {
    headerObserver?.disconnect();
    // 就绪与否交给 headerSettled 判断，这里只负责「页头有动静就重估一次」
    headerObserver = new MutationObserver(schedule);
    headerObserver.observe(header, { childList: true, subtree: true });
    observedHeader = header;
  }

  if (container === null) {
    // 还不知道评论区容器在哪：只能文档级观察，找到容器立刻收窄
    containerObserver?.disconnect();
    containerObserver = null;
    observedContainer = null;
    anchorObserver?.disconnect();
    anchorObserver = null;
    observedAnchor = null;
    if (bootstrapObserver === null) {
      bootstrapObserver = new MutationObserver(onDocumentMutations);
      bootstrapObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
    return;
  }
  bootstrapObserver?.disconnect();
  bootstrapObserver = null;
  if (observedContainer !== container) {
    containerObserver?.disconnect();
    containerObserver = new MutationObserver(onDocumentMutations);
    containerObserver.observe(container, { childList: true, subtree: true });
    observedContainer = container;
  }
  const anchor = container.parentElement;
  if (anchor !== null && observedAnchor !== anchor) {
    anchorObserver?.disconnect();
    anchorObserver = new MutationObserver(onDocumentMutations);
    // 只盯直接子节点：容器本身被换掉、我们的槽位被摘掉都在这一层
    anchorObserver.observe(anchor, { childList: true });
    observedAnchor = anchor;
  }
}

/**
 * 站点首次挂载（SSR 水合）是否已经结束——见 SSR_MOUNT_MARKER_ATTRIBUTE。判过一次就记住：
 * 标记不会再被写回来；没有 SSR 标记的文档（非 SSR 页）第一次问就通过。
 */
function siteMountFinished(): boolean {
  if (siteMounted) return true;
  if (document.querySelector(`[${SSR_MOUNT_MARKER_ATTRIBUTE}]`) !== null) return false;
  siteMounted = true;
  return true;
}

/**
 * 可以开始写页面了：**站点首次挂载（SSR 水合）已经结束**，且页头应用已挂载（容器不存在或容器上带
 * `data-v-app`）或页头等待已超时。水合结束是硬前置——水合前写页面 DOM 会让站点 hydration 失配，
 * 后果见 SSR_MOUNT_MARKER_ATTRIBUTE。
 */
function headerSettled(): boolean {
  if (!siteMountFinished()) return false;
  if (headerWaitExpired) return true;
  const header = document.querySelector<HTMLElement>(MAIN_HEADER_SELECTOR);
  return header === null || header.hasAttribute(HEADER_MOUNTED_MARKER);
}

/**
 * 页头迟迟不挂载：放弃等待「页头已挂载」这一条，但**不放弃**「站点首次挂载已结束」——
 * 还没结束就再等一轮（页头脚本被挡时水合通常早就结束了，这条分支只在极慢的页面里走到）。
 */
function onHeaderWaitExpired(): void {
  headerTimer = null;
  if (!siteMountFinished()) {
    headerTimer = window.setTimeout(onHeaderWaitExpired, HEADER_WAIT_MS);
    return;
  }
  headerWaitExpired = true;
  // 一次性事件，没有要合并的 DOM 变更：直接重估，不必再进合并窗口
  run();
}

/**
 * 熔断：扩展上下文失效后本页再没有任何可用的 chrome.*，于是立刻还原页面并停掉所有观察与监听。
 * 此后 run() 直接返回，扩展重载前积累的 MutationObserver 噪音不会再重复抛错。
 */
function stop(reason: string, cause: unknown): void {
  if (invalidated) return;
  invalidated = true;
  console.warn(`[Loupe] ${reason}；页面评论区替换已停止，刷新页面即可恢复`, cause);
  teardown();
  bootstrapObserver?.disconnect();
  bootstrapObserver = null;
  containerObserver?.disconnect();
  containerObserver = null;
  anchorObserver?.disconnect();
  anchorObserver = null;
  headerObserver?.disconnect();
  headerObserver = null;
  observedContainer = null;
  observedAnchor = null;
  observedHeader = null;
  themeObserver?.disconnect();
  themeObserver = null;
  if (headerTimer !== null) {
    clearTimeout(headerTimer);
    headerTimer = null;
  }
  window.removeEventListener('load', onWindowLoad);
  window.removeEventListener('message', onWindowMessage);
}

async function readEnabled(): Promise<void> {
  try {
    const bag = await chrome.storage.local.get(PAGE_COMMENTS_ENABLED_KEY);
    enabled = bag[PAGE_COMMENTS_ENABLED_KEY] === true;
  } catch (error) {
    // 读不到开关就当关闭：宁可不动页面，也不能凭猜测替换用户界面
    // 上下文失效则连重试都不必：此后任何 chrome.* 调用都只会再抛一次
    if (isExtensionContextInvalidated(error)) {
      stop('读取页面评论区开关时扩展上下文已失效', error);
      return;
    }
    console.warn('[Loupe] 读取页面评论区开关失败', error);
    enabled = false;
  }
  schedule();
}

/**
 * 挂载时读一次待办定位（点「在评论区定位」时那个视频没开标签页，后台先把这次定位记在这里再新开页，
 * 见 page-comments.ts 的 LOCATE_PENDING_KEY）：**视频身份与当前页一致才消费**，读后即删——下次刷新
 * 页面不该重复定位；身份不一致就留着不动，那是别的视频的待办，本页消费不了（换页时后台会再写新的）。
 *
 * 消费到的定位同样先存进 pendingLocate，等 reader-ready 之后再投给嵌入页。
 */
async function readPendingLocate(): Promise<void> {
  let stored: unknown;
  try {
    const bag = await chrome.storage.local.get(LOCATE_PENDING_KEY);
    stored = bag[LOCATE_PENDING_KEY];
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      stop('读取待办定位时扩展上下文已失效', error);
      return;
    }
    console.warn('[Loupe] 读取待办定位失败', error);
    return;
  }
  const pageId = videoIdOf(location.href);
  if (pageId === null || !isPendingLocate(stored) || videoIdOf(stored.input) !== pageId) return;
  try {
    await chrome.storage.local.remove(LOCATE_PENDING_KEY);
  } catch (error) {
    // 删不掉也照常定位：宁可下次刷新多定位一次，也不能把这次定位吞掉
    if (isExtensionContextInvalidated(error)) {
      stop('消费待办定位时扩展上下文已失效', error);
      return;
    }
    console.warn('[Loupe] 消费待办定位失败', error);
  }
  queueLocate(pageId, stored.commentId);
}

function onWindowLoad(): void {
  pageReady = true;
  schedule();
}

/**
 * 运行期消息（后台 → 内容脚本）。
 *
 * `respond` 只在定位这条路上用：后台 await 那条消息，内容脚本不回执的话端口会立刻关闭、
 * 发送方只会拿到一个「端口关闭」的错误——回执才能把「收到了」与「没人在 / 身份对不上」分开。
 * 身份校验按本文件既有的做法（消息形状 + 当前页身份）：内容脚本的 runtime 通道页面脚本进不来，
 * 后台也已经按视频身份挑过标签页，这里再对一次 BV 号即可，不额外查 sender。
 */
function onRuntimeMessage(message: unknown, _sender: chrome.runtime.MessageSender, respond: (response?: unknown) => void): void {
  if (isLocateCommentRequest(message)) {
    // 后台只把定位发给按视频身份匹配到的那个标签页；身份对不上就当没收到（不回执）：
    // 发送方那边会落到一句「请刷新那个视频页后重试」，比静默丢掉这次定位实在
    const pageId = videoIdOf(location.href);
    if (pageId === null || videoIdOf(message.input) !== pageId) return;
    queueLocate(pageId, message.commentId);
    respond();
    return;
  }
  if (!isPageNavigationMessage(message)) return;
  retryBlocked = false;
  notifyFrame();
  if (!isVideoPageUrl(location.href)) teardown();
  schedule();
}

function onStorageChanged(changes: Record<string, chrome.storage.StorageChange>, area: string): void {
  if (area !== 'local') return;
  const change = changes[PAGE_COMMENTS_ENABLED_KEY];
  if (change === undefined) return;
  enabled = change.newValue === true;
  retryBlocked = false;
  if (!enabled) teardown();
  schedule();
}

function onDocumentMutations(records: MutationRecord[]): void {
  for (const record of records) {
    if (isRelevant(record)) {
      schedule();
      return;
    }
  }
}

/**
 * 文档级只关心：评论区（或它的容器）出现/消失、我们自己的槽位被站点清掉。
 * 自己插入槽位产生的变更必须跳过，否则观察者会被自己的写入反复触发。
 */
function isRelevant(record: MutationRecord): boolean {
  for (const node of record.removedNodes) {
    if (isSlotNode(node)) return true;
    if (slot !== null && node instanceof Element && node.contains(slot)) return true;
    if (isCommentNode(node)) return true;
  }
  for (const node of record.addedNodes) {
    if (isSlotNode(node)) continue;
    if (isCommentNode(node)) return true;
  }
  return false;
}

function isSlotNode(node: Node): boolean {
  return node instanceof Element && node.hasAttribute(SLOT_ATTRIBUTE);
}

function isCommentNode(node: Node): boolean {
  return (
    node instanceof Element &&
    (node.matches(COMMENT_AREA_SELECTOR) ||
      node.matches(COMMENT_CONTAINER_SELECTOR) ||
      node.querySelector(`${COMMENT_AREA_SELECTOR},${COMMENT_CONTAINER_SELECTOR}`) !== null)
  );
}

// ───────────────────────── 槽位生命周期 ─────────────────────────

function ensure(): void {
  if (!enabled || retryBlocked || !pageReady || !isVideoPageUrl(location.href)) {
    teardown();
    return;
  }
  // 站点页头还在挂载就先等：绝不在站点自己的 mount/首屏渲染窗口里写页面 DOM（等待有上限）
  if (!headerSettled()) return;
  const native = document.querySelector<HTMLElement>(COMMENT_AREA_SELECTOR);
  if (native === null) {
    teardown();
    return;
  }
  // 已就位（槽位是同一个原生根的下一个兄弟）就不重建：这是唯一的幂等判据，重复触发不会长出第二个 iframe
  if (slot !== null && slot.isConnected && slot.previousElementSibling === native) {
    // 原生根可能刚被站点整块换掉：iframe 已就绪时把新的原生根也隐藏起来，不必重建 iframe
    if (readerReady) hideNative(native);
    return;
  }
  mount(native);
}

function mount(native: HTMLElement): void {
  // 硬约束：槽位绝不落进站点页头（固定定位）——那会牵动 biliMainHeader 的布局
  if (native.closest(MAIN_HEADER_SELECTOR) !== null) return;
  teardown();

  // 先取地址：上下文已失效时这里就熔断，绝不留半个槽位在页面上
  const source = embeddedPageUrl();
  if (source === null) return;

  const created = document.createElement('div');
  created.setAttribute(SLOT_ATTRIBUTE, '');
  created.className = SLOT_CLASS;
  created.style.cssText = SLOT_CSS;
  created.style.height = SLOT_PLACEHOLDER_HEIGHT;

  const embedded = document.createElement('iframe');
  embedded.className = 'loupe-page-reader-frame';
  embedded.title = 'Loupe 评论区';
  embedded.src = source;
  embedded.style.cssText = FRAME_CSS;

  created.append(embedded);
  native.after(created);

  slot = created;
  frame = embedded;
  readerReady = false;
  readyTimer = window.setTimeout(onReadyTimeout, READY_TIMEOUT_MS);
  // 宿主滚动时把「嵌入页可见到哪」告诉它（自身滚动条已交给宿主页面）
  window.addEventListener('scroll', onHostViewport, { passive: true });
  window.addEventListener('resize', onHostViewport);
  // 指针移出阅读器（跨文档时嵌入页不一定收得到 mouseleave）⇒ 由宿主这侧收起用户卡片
  slot.addEventListener('mouseleave', dismissUserCard);
  // 首次可见范围不在这里发：此刻嵌入页的文档还在 about:blank，投过去只会被丢弃（就绪时会重发一次）
}

/** 扩展页地址；上下文失效时熔断并返回 null。 */
function embeddedPageUrl(): string | null {
  try {
    return chrome.runtime.getURL(EMBEDDED_PAGE_PATH);
  } catch (error) {
    stop('扩展上下文已失效，无法加载嵌入页', error);
    return null;
  }
}

function teardown(): void {
  if (readyTimer !== null) {
    clearTimeout(readyTimer);
    readyTimer = null;
  }
  if (viewportTimer !== null) {
    clearTimeout(viewportTimer);
    viewportTimer = null;
  }
  window.removeEventListener('scroll', onHostViewport);
  window.removeEventListener('resize', onHostViewport);
  restoreNative();
  dismissUserCard();
  slot?.remove();
  slot = null;
  frame = null;
  readerReady = false;
  sentTheme = null;
}

function onReadyTimeout(): void {
  readyTimer = null;
  if (frame === null) return;
  retryBlocked = true;
  teardown();
}

// ───────────────────────── 内容脚本 → 嵌入页 ─────────────────────────

/**
 * 内容脚本 → 嵌入页的消息（READER_HEIGHT / READER_WRITE_REQUEST / READER_FETCH_REQUEST 是反方向，不在此列）。
 */
type ReaderToFrameMessage =
  | ReaderBridgeMessage
  | ReaderLocateMessage
  | ReaderViewportMessage
  | ReaderThemeMessage
  | ReaderWriteResult
  | ReaderFetchResult;

/**
 * 页面地址变了：重新解析目标，并重判一次宿主主题（换页可能整块换掉主题标记）。
 * 此刻还没有 iframe 就交给上面的 ensure 重建。
 */
function notifyFrame(): void {
  if (!readerReady || frame === null) return;
  postToFrame({ source: READER_BRIDGE_SOURCE, type: READER_NAVIGATION });
  notifyTheme();
}

/** 记下一条定位并尽力立刻投递；iframe 还没挂载或还没就绪就先存着，等 reader-ready 补发（见 pendingLocate）。 */
function queueLocate(videoId: string, commentId: string): void {
  pendingLocate = { videoId, commentId };
  flushLocate();
}

/** reader-ready（或新定位到达）时把待发定位投出去；地址已经换到别的视频就作废，绝不投给不对的页面。 */
function flushLocate(): void {
  const pending = pendingLocate;
  if (pending === null || !readerReady || frame === null) return;
  pendingLocate = null;
  if (pending.videoId !== videoIdOf(location.href)) return;
  postToFrame({ source: READER_BRIDGE_SOURCE, type: READER_LOCATE, commentId: pending.commentId });
}

/**
 * 只在扩展源内投递：targetOrigin 由 iframe 自己的 src 解析，页面脚本收不到。
 * 「地址变化 / 可见范围 / 主题」这三类同步由各自的调用点在就绪前拦下（未就绪的 iframe 文档还停在
 * about:blank，投递只会被丢弃并在控制台留一条 origin 警告；就绪时它们各会重发一次）；
 * 写结果是收到请求之后的应答——会发请求的 iframe 必然已就绪，因此不经这道闸。
 */
function postToFrame(message: ReaderToFrameMessage): void {
  const current = frame;
  const target = current?.contentWindow ?? null;
  if (current === null || target === null) return;
  target.postMessage(message, new URL(current.src).origin);
}

/** 宿主滚动/尺寸变化合并成一次上报：scroll 事件可能每帧都来。 */
function onHostViewport(): void {
  if (viewportTimer !== null) return;
  viewportTimer = window.setTimeout(() => {
    viewportTimer = null;
    postViewport();
  }, 0);
  // 卡片锚在视口坐标上：宿主一滚就与头像对不上了，先收起（用户再悬停一次就会按新位置重开）
  dismissUserCard();
}

/** 告诉嵌入页「宿主视口底边在嵌入文档坐标系里的位置」：它据此在快滚到底时取下一页顶层评论。 */
function postViewport(): void {
  const current = slot;
  if (!readerReady || frame === null || current === null) return;
  const visibleBottom = window.innerHeight - current.getBoundingClientRect().top;
  postToFrame({ source: READER_BRIDGE_SOURCE, type: READER_VIEWPORT, visibleBottom });
}

/**
 * 把阅读器的「鼠标进了/出了某位作者」转给主世界：站点自己的用户卡片在主世界驱动（见 page-comments.ts）。
 * 这里只做坐标换算——iframe 与槽位同宽同高、内部不滚动，所以「嵌入文档坐标 + 槽位视口偏移」即宿主坐标。
 */
function forwardUserCard(message: ReaderUserCardMessage): void {
  const current = slot;
  if (current === null) return;
  if (message.rect === null) {
    window.postMessage({ source: USER_CARD_BRIDGE_SOURCE, type: 'hide', mid: message.mid }, window.location.origin);
    return;
  }
  const slotRect = current.getBoundingClientRect();
  window.postMessage(
    {
      source: USER_CARD_BRIDGE_SOURCE,
      type: 'show',
      mid: message.mid,
      rect: {
        left: slotRect.left + message.rect.left,
        top: slotRect.top + message.rect.top,
        width: message.rect.width,
        height: message.rect.height,
      },
    },
    window.location.origin,
  );
}

/** 收起卡片：槽位被拆、页面滚了、换页了——任何一种都对不上原来那个锚点了。 */
function dismissUserCard(): void {
  window.postMessage({ source: USER_CARD_BRIDGE_SOURCE, type: 'hide' }, window.location.origin);
}

/** 宿主主题变了（或嵌入页刚就绪）才上报，避免重复消息。未就绪时连账都不记：就绪时会重报一次。 */
function notifyTheme(): void {
  if (!readerReady) return;
  const theme = detectHostTheme();
  if (theme === null || theme === sentTheme) return;
  sentTheme = theme;
  postToFrame({ source: READER_BRIDGE_SOURCE, type: READER_THEME, theme });
}

/**
 * 只读宿主页面的明暗，判断不出时返回 null（不打扰嵌入页自己的默认）。
 * 顺序：B 站自己的 theme_style cookie → 页面底色亮度（最接近用户看到的）→ `<html>` 上的标记。
 */
function detectHostTheme(): ReaderTheme | null {
  const cookie = /(?:^|;\s*)theme_style=(dark|light)\b/i.exec(document.cookie);
  if (cookie !== null) return cookie[1]!.toLowerCase() === 'dark' ? 'dark' : 'light';

  const luminance = bodyLuminance();
  if (luminance !== null) return luminance < 0.5 ? 'dark' : 'light';

  const root = document.documentElement;
  const marker = `${root.getAttribute('data-theme') ?? ''} ${root.className}`.toLowerCase();
  if (marker.includes('dark') || marker.includes('night')) return 'dark';
  return marker.includes('light') ? 'light' : null;
}

/** 宿主底色亮度（0 黑 → 1 白）；底色透明（颜色来自祖先）时返回 null。 */
function bodyLuminance(): number | null {
  if (document.body === null) return null;
  const parts = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g);
  if (parts === null || parts.length < 3) return null;
  const [r = '0', g = '0', b = '0', alpha = '1'] = parts;
  if (Number(alpha) === 0) return null;
  return (0.2126 * Number(r) + 0.7152 * Number(g) + 0.0722 * Number(b)) / 255;
}

// ───────────────────────── 隐藏 / 还原原生评论区 ─────────────────────────

function onWindowMessage(event: MessageEvent): void {
  const current = frame;
  // 只认自己那个仍挂在文档里的 iframe 发来的消息（frame-only），且必须来自扩展源。
  // iframe 脱离文档后 contentWindow 会变 null，而消息的 source 也可能是 null：两边撞成相等时，
  // 「槽位已被拆掉的旧实例」会把别人的消息当成自己的，去隐藏原生评论区（页面同时失去两边）。
  if (current === null || !current.isConnected || event.source !== current.contentWindow) return;
  if (event.origin !== extensionOrigin) return;

  if (isReaderHeightMessage(event.data)) {
    // 内容高度：槽位跟着内容长，于是滚动条只剩宿主那一根（长评论不会被固定高度裁掉）
    if (slot !== null) slot.style.height = `${event.data.height}px`;
    postViewport();
    return;
  }
  if (isReaderUserCardMessage(event.data)) {
    // 用户卡片：只把「谁 + 在哪儿」转给主世界——站点那个卡片元素只在主世界能驱动（见 page-comments.ts）
    forwardUserCard(event.data);
    return;
  }
  if (isReaderFetchRequest(event.data)) {
    // 读请求：同样在页面上下文执行（同站带 Cookie，只读 api.bilibili.com），结果按 requestId 回投
    void respondToFetch(event.data, current);
    return;
  }
  if (isReaderWriteRequest(event.data)) {
    // 写意图：执行在页面上下文（csrf 只在那边现读现用），结果按 requestId 回投给同一个 iframe
    void respondToWrite(event.data, current);
    return;
  }
  if (!isReaderBridgeMessage(event.data, READER_READY)) return;

  if (readyTimer !== null) {
    clearTimeout(readyTimer);
    readyTimer = null;
  }
  readerReady = true;
  const native = document.querySelector<HTMLElement>(COMMENT_AREA_SELECTOR);
  if (native !== null && enabled) hideNative(native);
  // 就绪即对齐：此刻该看到的主题、可见范围与待发定位
  notifyTheme();
  postViewport();
  flushLocate();
}

function hideNative(native: HTMLElement): void {
  if (hiddenRoot === native) return;
  restoreNative();
  savedDisplay = native.style.display;
  lastNativeDisplay = savedDisplay;
  native.style.display = 'none';
  hiddenRoot = native;
  // 站点重写 style 时把 display:none 补回去；值已一致时不写，观察者因此不会自激
  styleObserver = new MutationObserver(() => {
    if (hiddenRoot === native && native.style.display !== 'none') native.style.display = 'none';
  });
  styleObserver.observe(native, { attributes: true, attributeFilter: ['style'] });
}

function restoreNative(): void {
  styleObserver?.disconnect();
  styleObserver = null;
  const target = hiddenRoot ?? (!enabled || !isVideoPageUrl(location.href) ? document.querySelector<HTMLElement>(COMMENT_AREA_SELECTOR) : null);
  const display = savedDisplay ?? lastNativeDisplay ?? '';
  hiddenRoot = null;
  savedDisplay = null;
  if (target === null) return;
  target.style.display = display;
  // A queued observer callback from the hide write may still run after disconnect;
  // re-assert the original value after that callback has drained.
  queueMicrotask(() => {
    if (!enabled || !isVideoPageUrl(location.href)) target.style.display = display;
  });
}

// ───────────────────────── 读 / 写请求（iframe → 内容脚本） ─────────────────────────

/**
 * 执行一次读请求并把结果回投给发起的那个 iframe。
 * 执行器（reader-reads.ts）在页面上下文（同站、带 Cookie）发只读 GET；这里只负责「谁的请求、投给谁」。
 * iframe 被换掉（或槽位已撤）后结果一律丢弃：requestId 对不上新文档，投过去只是噪音。
 */
function respondToFetch(request: ReaderFetchRequest, source: HTMLIFrameElement): void {
  void executeReaderFetch(request).then((result) => {
    if (frame === source) postToFrame(result);
  });
}

/**
 * 执行一次写意图并把结果回投给发起的那个 iframe。
 * 执行器（reader-writes.ts）在页面上下文里现读 csrf、调平台写接口；这里只负责「谁的请求、投给谁」。
 * iframe 被换掉（或槽位已撤）后结果一律丢弃：requestId 对不上新文档，投过去只是噪音。
 */
function respondToWrite(request: ReaderWriteRequest, source: HTMLIFrameElement): void {
  void executeReaderWrite(request).then((result) => {
    if (frame === source) postToFrame(result);
  });
}
