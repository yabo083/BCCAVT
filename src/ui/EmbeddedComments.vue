<script setup lang="ts">
/**
 * 页面内嵌的评论区阅读器（跑在扩展页 iframe 里，由内容脚本的 page-reader 挂载）。
 *
 * 信任边界：目标地址只认后台回传的规范视频地址（`loupe:embedded-context` 只信 sender.tab.url），
 * 页面 query 与页面消息都不作数。父文档消息必须同时满足 source=window.parent + 桥标记 + 页面源。
 *
 * 六条由「替换 B 站评论区」这个位置决定的做法：
 *   - 滚动：iframe 高度等于内容高度（READER_HEIGHT 上报），滚动条只有宿主页面那一根，因此这里不做窗口化，
 *     评论行按自然高度排布——长正文完整呈现，绝不为了定高而截断；
 *   - 分页：游标分页状态机（infinite-scroll.ts）逐页取顶层评论，只追加、绝不重跑整条链；
 *     「到底」只认平台给的下一个游标（next === null），不按「取到的条数少于请求数」推断；
 *     展开某条评论时才按需抓它的回复树；原生分页（DOM 里那些「加载更多」）完全不参与——
 *     多级关系由 rootId / parentId 自己搭成森林；
 *   - 触发：正确性由宿主推送的视口消息 + 边沿判定（armed）保证——同一段「到底区」只触发一次取数，
 *     取数落定后重新评估，重复请求由状态机的 hasNext / loading 拦下；列表末尾的哨兵 + IntersectionObserver
 *     只是兜底（跨源 iframe 里 rootMargin 会被浏览器忽略，哨兵自身几何只能表示「真的到底了」）；
 *   - 高度：只在 DOM 更新后显式量一次、往上报，只增不减——只有折叠切换、换目标这类结构性缩高事件才允许
 *     提交更小的值，同一个值不重复上报。宿主文档不缩，浏览器就不会把 scrollTop 钳回去（回弹的根因）；
 *   - 限流渲染：可见行分批渲染（一批 ROW_PAGE_SIZE 行，滚到已渲染底部或点按钮再追加），1000+ 行的树
 *     也只铺开已读到的那一段，展开某条评论后把上限抬到它的新位置——上限只增不减，已渲染的行不回收；
 *   - 写操作：点赞 / 回复 / 发表只发意图（READER_WRITE_REQUEST），真正的请求由内容脚本在 B 站页面
 *     上下文里发（csrf 只在写执行时从 cookie 即时读，不跨桥、不进日志/快照/缓存）；结果按 requestId
 *     回来——点赞乐观切换、失败回滚并提示，回复 / 发表成功把返回的评论插进树（多级关系自然成立），
 *     失败留着草稿；
 *   - 读取：评论分页 / 评论树的 GET 也经桥交给内容脚本在 B 站页面上下文执行（READER_FETCH_REQUEST）——
 *     扩展源直连带不上站点 Cookie，会被平台按匿名身份截断（顶层评论约 315 条就停），页面上下文同站带
 *     Cookie，读到的就是原生那份全量；WBI 签名仍在这里算好，桥上只走最终 URL，Cookie 两个方向都不跨桥。
 *     桥不可用时退回扩展源直连（匿名），不硬失败；
 *   - 抓取：进入页面只取一页顶层评论，完整全量分析只在放大镜打开的独立窗口里做。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import IconArrowClockwise from '~icons/ph/arrow-clockwise';
import IconArrowsIn from '~icons/ph/arrows-in';
import IconArrowsOut from '~icons/ph/arrows-out';
import IconCircleNotch from '~icons/ph/circle-notch';
import IconTreeStructure from '~icons/ph/tree-structure';
import IconX from '~icons/ph/x';
import PageCommentRow from './components/PageCommentRow.vue';
import CommentComposer from './components/CommentComposer.vue';
import CompletenessBadge from './components/CompletenessBadge.vue';
import SkeletonRows from './components/SkeletonRows.vue';
import { formatCount } from './format';
import { PARENT_ORIGIN } from './reader-http';
import { ensureHeaderRules, readerHttp, readerWorkbench } from './services';
import { graphPopupUrl } from './surface';
import { openGraphPopupWindow } from '@/extension/open-panel';
import { applyPalette, applyStoredPalette, watchPalette } from './theme';
import { ROW_PAGE_SIZE, collapsibleIds, flattenThread, nextRowCap } from './thread';
import type { ThreadRow } from './thread';
import { CursorPager } from './infinite-scroll';
import type { CursorPage, CursorPagerState } from './infinite-scroll';
import {
  NEW_COMMENT_KEY,
  commentIntent,
  commentTextError,
  createWriteClient,
  blockIntent,
  deleteIntent,
  dislikeIntent,
  likeIntent,
  mergeComments,
  replyIntent,
  reportIntent,
} from './reader-comments';
import type { RowLikeState, RowReplyState } from './reader-comments';
import {
  EMBEDDED_CONTEXT,
  PAGE_COMMENTS_ENABLED_KEY,
  READER_DEFAULT_ORDER_KEY,
  READER_BRIDGE_SOURCE,
  READER_HEIGHT,
  READER_NAVIGATION,
  READER_READY,
  READER_USER_CARD,
  isEmbeddedContextResponse,
  isExtensionContextInvalidated,
  isReaderBridgeMessage,
  isReaderFetchResult,
  isReaderLocateMessage,
  isReaderThemeMessage,
  isReaderViewportMessage,
  isReaderWriteResult,
} from '@/extension/page-comments';
import type { ReaderTheme, UserCardRect } from '@/extension/page-comments';
import type { Comment, RootOrder, Subject, SubjectRef } from '@/core/model';
import { PlatformError } from '@/core/errors';
import { buildForest } from '@/core/tree';
import type {
  CommentNode,
  Completeness,
  CrawlOptions,
  CrawlPhase,
  CrawlProgress,
  Forest,
  RefreshMode,
} from '@/core/report';

/**
 * 每页根评论的楼中楼抓取上限：与平台顶层分页自带的预览数齐平（B 站一页 20 条，每条带 3 条预览），
 * 于是取一页顶层评论不会连带发评论树请求——想看更多回复请展开那一条。
 */
const PAGE_REPLIES = 3;
/** 展开一条评论时最多取这么多回复；再多请用放大镜在独立窗口里看完整树。 */
const EXPANDED_REPLIES = 200;
/** 宿主视口底边距已渲染内容底部小于它，就去取下一页顶层评论 / 追加一批渲染行。 */
const LOAD_MORE_MARGIN = 480;
/** 内容再少也留出这么高，避免刚进页面时 iframe 抖成一条。 */
const MIN_CONTENT_HEIGHT = 360;

/** 扩展被重载后本页所有 chrome.* 都已作废：给一句能自救的话，不再自动重试。 */
const STALE_EXTENSION = '扩展已更新，请刷新页面后重试';
/** 取消用的错误名：状态机据此把「用户中断」与「取数失败」分开（见 CursorPager 的 isCanceled）。 */
const CANCELED_ERROR_NAME = 'LoupeCanceled';

const PHASE_LABELS: Record<CrawlPhase, string> = {
  session: '获取登录态',
  subject: '获取视频信息',
  roots: '抓取顶层评论',
  threads: '抓取评论树',
  analyze: '生成阅读视图',
  done: '完成',
};

/** 操作反馈：写操作的失败 / 提示都走这一条，不占用加载错误的位置。 */
interface Notice {
  tone: 'error' | 'info';
  text: string;
}

const progress = ref<CrawlProgress | null>(null);
const input = ref<string | null>(null);
const selectedId = ref<string | null>(null);
/** 首屏还没落定（含失败）：顶部显示抓取进度，落定后交棒给底部的加载态。 */
const booting = ref(true);
/** 当前目标的主体元数据（标题等），由第一页的结果带回来。 */
const subject = shallowRef<Subject | null>(null);
const collapsed = ref<ReadonlySet<string>>(new Set<string>());
/**
 * 「全部折叠」是否仍然生效：新取回的页、新写成的评论也一并折叠，直到用户点「全部展开」。
 * 它只影响「新出现的行」，用户随后单独展开的那一行不会被重新折回去（见补折 watcher）。
 */
const foldAllActive = ref(false);
/** 见过的评论 id（只做记账，不参与渲染）：用来分辨哪些节点是「新出现的」。 */
const knownIds = new Set<string>();
/** 按需抓到的回复，按「被展开的那条评论 id」存：叠在已取回的页之上，重新取数不会把它们冲掉。 */
const loaded = shallowRef<ReadonlyMap<string, readonly Comment[]>>(new Map<string, readonly Comment[]>());
/** 正在按需抓取回复树的评论 id。 */
const expanding = ref<ReadonlySet<string>>(new Set<string>());
/** 本次会话新写成的评论（发表 / 回复）：并入森林，重新抓取也留着。 */
const added = shallowRef<readonly Comment[]>([]);
/** 本会话点赞过的评论 id：模型里没有「我点过赞」，显示态只能由这里叠加。 */
const liked = shallowRef<ReadonlySet<string>>(new Set<string>());
/** 本次会话点踩过的评论 id：与 liked 互斥；平台 action=2 的初始态在 likeStateOf 里合进来。 */
const disliked = shallowRef<ReadonlySet<string>>(new Set<string>());
/** 本次会话「取消点踩」过的评论 id：覆盖平台带回来的 disliked 初始态。 */
const undisliked = shallowRef<ReadonlySet<string>>(new Set<string>());
/** 删除成功后从视图剔除的评论 id：整棵子树随合流层一起消失。 */
const removed = shallowRef<ReadonlySet<string>>(new Set<string>());
/** 当前登录用户 mid：只有自己的评论才显示「删除」。session 只在首次进入时取一次。 */
const sessionUserId = shallowRef<string | null>(null);
/** 点赞请求在飞的评论 id。 */
const likeBusy = shallowRef<ReadonlySet<string>>(new Set<string>());
/** 草稿：键是评论 id，顶层评论用 NEW_COMMENT_KEY。 */
const drafts = shallowRef<ReadonlyMap<string, string>>(new Map<string, string>());
/** 正在发送的草稿键。 */
const sending = shallowRef<ReadonlySet<string>>(new Set<string>());
/** 发送失败的原因，按草稿键存：失败后草稿留着，就地提示。 */
const draftErrors = shallowRef<ReadonlyMap<string, string>>(new Map<string, string>());
/** 当前打开着回复框的评论 id（同时只开一个）。 */
const replyTo = ref<string | null>(null);
const notice = ref<Notice | null>(null);
/** 已渲染的评论行数上限：大树分批铺，滚到底自动追加。 */
const rowCap = ref(ROW_PAGE_SIZE);
/** 扩展上下文失效：熔断，自动路径不再重试。 */
const stale = ref(false);
/** 非取数类失败（展开回复 / 打开图谱 / 还原原生评论区）：与取数错误分开，走顶部状态条。 */
const actionError = ref<string | null>(null);
/**
 * 定位块：「在评论区定位」到一条不在已读范围内的评论时，经 workbench.locateComment 定点取回
 * 它的根评论块，钉在评论流上方（与原生置顶同款位置）。它不进流、不改流的行序（ADR-0004）。
 */
const located = shallowRef<{ root: Comment; comments: Comment[] } | null>(null);
/**
 * 顶层排序：'hot' 最热（与原生默认一致）/ 'time' 最新。切换是**换数据集**而不是客户端重排
 * （ADR-0004：渲染层永不动已取回的行序）——reset + 从新序的游标起点重取，页键带 order
 * 所以来回切换直接命中各自缓存。不持久化、不设选项。
 */
const order = ref<RootOrder>('hot');
if (typeof chrome !== 'undefined' && chrome.storage?.local) {
  void chrome.storage.local.get(READER_DEFAULT_ORDER_KEY).then((bag) => { const v = bag?.[READER_DEFAULT_ORDER_KEY]; if (v === 'time' || v === 'hot') order.value = v; }).catch(() => {});
}

/**
 * 游标分页状态机：它自己不是响应式的，变化时换成一份状态快照存进 pagerState。
 * 它同时是「重复加载」的唯一防线——同一时刻只允许一次取数在途，到底（next === null）后不再发请求。
 */
const pager = new CursorPager<Comment>({
  fetchPage,
  // 用户点「取消」或阅读器卸载造成的中断不是失败：状态机据此不记账，界面也不会弹错误
  isCanceled: (error) => error instanceof Error && error.name === CANCELED_ERROR_NAME,
});
const pagerState = shallowRef<CursorPagerState<Comment>>(pager.state());
pager.subscribe(() => {
  pagerState.value = pager.state();
  // 到底了就不必再分批：取数已经结束，剩下的行一次铺开。
  // 否则「最后一组」会与中途的行为不一致——中途滚到底自动铺开，到底之后反而要手动点一次。
  if (!pagerState.value.hasNext) revealAllRows();
  // 首屏之前挂起的定位请求：第一页一落定就执行（找不到会照实提示，不会一直悬着）
  flushPendingLocate();
});
const running = computed(() => pagerState.value.loading);
const hasItems = computed(() => pagerState.value.items.length > 0);
const hasNext = computed(() => pagerState.value.hasNext);

let controller: AbortController | null = null;
let heightObserver: ResizeObserver | null = null;
let sentinelObserver: IntersectionObserver | null = null;
/** 配色偏好的退订函数：工作台里改了主色，本页（另一个文档）跟着换，不用刷新。 */
let unwatchPalette: (() => void) | null = null;
/**
 * 首屏之前到的定位请求：内容脚本在 `READER_READY` 之后就会补发，那一刻本页一页数据都还没有，
 * 直接判定「不在已读范围内」是错的。先记下，等第一页落定再执行一次（见 flushPendingLocate）。
 */
let pendingLocate: string | null = null;
/**
 * 当前目标的**身份**（平台 + 主体 id），由每一次取数在解析规范地址后写入，换目标时清空。
 * 它是「宿主说地址变了」到底算不算换目标的唯一判据：URL 抖动（`?spm_id_from` / `?vd_source` / `#锚点`）
 * 解析出的身份与它相同，换视频才不同（见 onNavigation）。
 */
let targetId: string | null = null;
/** 已渲染内容的高度（本文档像素）：既上报给内容脚本，也用来判断「快滚到底了」。 */
let contentHeight = 0;
/**
 * 已提交给宿主的槽位高度（本文档像素）。宿主文档的高度就是它：把它改小等于缩短宿主文档，
 * 浏览器随之把 scrollTop 钳回（观感就是回弹），所以只有「确认变大」或结构性缩高事件才允许下调。
 */
let committedHeight = 0;
/** 最近一次宿主视口底边（嵌入文档坐标系）：-Infinity = 还没收到过视口消息。 */
let visibleBottom = -Infinity;
/** 哨兵是否在视口里：IntersectionObserver 的兜底信号（跨源 iframe 里它可能不投递）。 */
let sentinelVisible = false;
/**
 * 取数闸门：「当前这段到底区还没触发过取数」。进入到底区触发一次即解除，离开到底区重新武装；
 * 取数落定后再评估一次（人还停在底部就继续取下一页）。于是宿主多推几条视口消息也不会反复触发取数。
 */
let armed = true;
/** 下一次取数用的刷新方式：首屏与追加都是 cache-first，只有「刷新」按钮显式回源。 */
let pendingRefresh: RefreshMode = 'cache-first';
/**
 * 用户点过「取消」：中断不是失败（状态机不记账），但落定时也不许自动接着取——取消就是停止自动加载。
 * 只有用户的下一次动作（重试 / 刷新 / 换目标）或重新进入到底区才会恢复。
 */
let canceled = false;

const rootEl = ref<HTMLElement | null>(null);
const sentinelEl = ref<HTMLElement | null>(null);

/**
 * 写客户端：请求投给父文档（B 站页面上下文），结果按 requestId 配回来。
 * 超时 / 投递失败都以 ok:false 收场，所以下面的写流程不需要 try/catch。
 * 读客户端的投递用的是同一个 PARENT_ORIGIN（祖先源只在 reader-http.ts 里推一次）。
 */
const writes = createWriteClient((request) => window.parent.postMessage(request, PARENT_ORIGIN));

/**
 * 展示用的评论 = 已取回的各页 + 按需抓到的回复 + 本次会话新写的评论（按 id 去重，后写的优先）。
 * `mergeComments` 保留**首次出现的位置**，所以这个数组就是「取回顺序」= 平台游标顺序，后到的排在后。
 */
const merged = computed<readonly Comment[]>(() => {
  const gone = removed.value;
  return mergeComments(
    pagerState.value.items.filter((c) => !gone.has(c.id) && (c.rootId === null || !gone.has(c.rootId))),
    ...[...loaded.value.values()].map((list: readonly Comment[]) => list.filter((c: Comment) => !gone.has(c.id) && (c.rootId === null || !gone.has(c.rootId)))),
    added.value.filter((c) => !gone.has(c.id) && (c.rootId === null || !gone.has(c.rootId))),
  );
});
/** 森林：层级 / depth / size / byId 都由它给，但**顶层顺序不取它**（见 roots）。 */
const forest = computed<Forest | null>(() => (merged.value.length === 0 ? null : buildForest([...merged.value])));
/**
 * 顶层行 = **取回顺序**，不是森林的 `createdAt` 升序。
 *
 * 平台按时间倒序分页（mode=2，每页都比上一页更旧），所以「新一页」在时间上是更早的评论。
 * 若按 createdAt 升序渲染，新一页会被整块排到已读内容**之上**：视口一动不动，内容整体下移一页高
 * （真机实测一页 ≈ +30 行 / +3300px），用户看到的就是「加载新评论时被打回刚看过的位置」——
 * 也就是这里必须避免的「回弹」。取回顺序渲染让新一页永远追加在末尾（与 ADR-0003 的只追加契约一致），
 * 已渲染行的位置与几何全程不变。
 *
 * 父评论缺失的孤儿（森林会把它们提升为根）按森林顺序补在末尾，保证渲染集合与森林一致、不丢行。
 */
const roots = computed<CommentNode[]>(() => {
  const current = forest.value;
  if (current === null) return [];
  const seen = new Set<string>();
  const ordered: CommentNode[] = [];
  for (const comment of merged.value) {
    if (comment.rootId !== null) continue;
    const node = current.byId.get(comment.id);
    if (node === undefined || seen.has(node.comment.id)) continue;
    seen.add(node.comment.id);
    ordered.push(node);
  }
  for (const node of current.roots) {
    if (seen.has(node.comment.id)) continue;
    seen.add(node.comment.id);
    ordered.push(node);
  }
  return ordered;
});
const rows = computed(() => roots.value.flatMap((root) => flattenThread(root, collapsed.value)));
/** 本次会话新发、还没被抓回来的顶层评论：钉在列表最上面，抓到之后自然撤掉。 */
const pinned = computed<ThreadRow[]>(() => {
  const known = new Set(pagerState.value.items.map((comment) => comment.id));
  const pinnedRows: ThreadRow[] = [];
  for (const comment of added.value) {
    if (comment.rootId !== null || known.has(comment.id)) continue;
    const node = forest.value?.byId.get(comment.id);
    if (node !== undefined) pinnedRows.push(...flattenThread(node, collapsed.value));
  }
  return pinnedRows;
});
/** 实际渲染的行：钉住的新评论 + 已铺开的那一段（同一 id 只出现一次）。 */
const listRows = computed<ThreadRow[]>(() => {
  const pinnedIds = new Set(pinned.value.map((row) => row.id));
  return [...pinned.value, ...rows.value.slice(0, rowCap.value).filter((row) => !pinnedIds.has(row.id))];
});
const hiddenRows = computed(() => Math.max(0, rows.value.length - rowCap.value));
/** 定位块自己的小森林：与主流同一份规则（buildForest + flattenThread + 同一折叠集）。 */
const locatedForest = computed<Forest | null>(() => {
  const block = located.value;
  return block === null || block.comments.length === 0 ? null : buildForest([...block.comments]);
});
const locatedRows = computed<ThreadRow[]>(() => {
  const block = located.value;
  const node = block === null ? undefined : locatedForest.value?.byId.get(block.root.id);
  return node === undefined ? [] : flattenThread(node, collapsed.value);
});
const title = computed(() => subject.value?.title ?? '');
const commentCount = computed(() => pagerState.value.items.length);
/**
 * 最近一页带回的「身份限制」（例如未登录会被平台截断成几条并直接说「到底」）。
 * 它随页带回、随换目标清空——完整性必须能解释「为什么只有这几条」，不能只给一个数字对不上。
 */
const identityLimitations = ref<readonly string[]>([]);
/**
 * 完整度：平台还给出下一页游标之前都算「还没读完」；到底之后再按平台声明的总数核对一次
 * （声明数包含被删除 / 被折叠的评论，因此「到底但少于声明」不是错误，只是事实），
 * 并把本次读取的身份限制（未登录截断等）一并写进原因。
 */
const completeness = computed<Completeness>(() => {
  const declaredTotal = progress.value?.declared;
  const fetched = pagerState.value.items.length;
  if (hasNext.value) {
    return { declared: declaredTotal, fetched, truncated: true, reasons: ['还没读完：滚到底会自动接着取下一页'] };
  }
  const unproven = declaredTotal === undefined || fetched < declaredTotal;
  const reasons: string[] = [];
  if (declaredTotal !== undefined && fetched < declaredTotal) reasons.push(`平台声明 ${declaredTotal} 条评论，实际读到 ${fetched} 条`);
  if (unproven) {
    for (const limitation of identityLimitations.value) if (!reasons.includes(limitation)) reasons.push(limitation);
  }
  return { declared: declaredTotal, fetched, truncated: reasons.length > 0, reasons };
});
/** 顶部错误：扩展失效 > 首屏取数失败（还没有任何内容）> 展开回复 / 打开图谱这类操作失败。 */
const loadError = computed<string | null>(() => {
  if (stale.value) return STALE_EXTENSION;
  const state = pagerState.value;
  const firstPage = state.items.length === 0 ? state.error : null;
  return firstPage ?? actionError.value;
});
/** 底部错误：已经有内容之后某一页取失败了；扩展失效时顶部已经说过，这里不再重复。 */
const pageError = computed<string | null>(() =>
  stale.value || pagerState.value.items.length === 0 ? null : pagerState.value.error,
);
const phaseLabel = computed(() => (progress.value === null ? '准备中' : PHASE_LABELS[progress.value.phase]));
const counted = computed(() => progress.value?.fetched ?? 0);
const declared = computed(() => progress.value?.declared);
const threadsTotal = computed(() => progress.value?.threadsTotal ?? 0);
const threadsDone = computed(() => progress.value?.threadsDone ?? 0);
const waiting = computed(() => progress.value?.waitingMs !== undefined);
const topDraft = computed(() => drafts.value.get(NEW_COMMENT_KEY) ?? '');
const topSending = computed(() => sending.value.has(NEW_COMMENT_KEY));
const topError = computed(() => draftErrors.value.get(NEW_COMMENT_KEY) ?? null);

/** 不可变集合 / 映射的增删：视图状态全是 shallowRef，改一处就换一份新的。 */
function withId(set: ReadonlySet<string>, id: string, present: boolean): ReadonlySet<string> {
  const next = new Set(set);
  if (present) next.add(id);
  else next.delete(id);
  return next;
}

function withDraft(map: ReadonlyMap<string, string>, key: string, value: string | null): ReadonlyMap<string, string> {
  const next = new Map(map);
  if (value === null) next.delete(key);
  else next.set(key, value);
  return next;
}

/** 嵌入页 → 内容脚本：只往父文档投递（父文档是 B 站页面，收不到也无妨）。 */
function postToParent(type: string, payload: Record<string, unknown> = {}): void {
  window.parent.postMessage({ source: READER_BRIDGE_SOURCE, type, ...payload }, PARENT_ORIGIN);
}

/**
 * 鼠标进/出某位作者（头像或昵称）：请宿主弹**站点自己的**用户卡片。
 *
 * 阅读器不画卡片：站点那份卡片（`bili-user-profile`）只在页面主世界可驱动，嵌入页既拿不到它，
 * 也不该照抄一份会随站点改版过期的 UI。这里只报「谁 + 头像/昵称在本文档里的位置」，
 * 由内容脚本换算成宿主坐标后交给主世界（见 page-comments.ts 的 READER_USER_CARD）。
 */
function onUserCard(hover: { mid: string; rect: UserCardRect | null }): void {
  postToParent(READER_USER_CARD, { mid: hover.mid, rect: hover.rect });
}

/** 统一收口失败文案：扩展上下文失效是熔断（不再自动重试）。 */
function failMessage(caught: unknown, fallback: string): string {
  if (isExtensionContextInvalidated(caught)) {
    stale.value = true;
    return STALE_EXTENSION;
  }
  return caught instanceof Error && caught.message ? caught.message : fallback;
}

/** 非取数类失败（展开回复 / 打开图谱 / 还原原生评论区）：顶部状态条展示。 */
function fail(caught: unknown, fallback: string): void {
  actionError.value = failMessage(caught, fallback);
}

/**
 * 内容高度上报：iframe 高度跟着它长，宿主页面因此只剩一根滚动条。
 *
 * 三条纪律都是冲着「回弹」去的（宿主按更小的值缩短槽位 = 缩短宿主文档，浏览器随即把 scrollTop 钳回）：
 *   1. 必须在 DOM 更新之后量（先 await nextTick），否则量到的是上一帧的布局；
 *   2. 只增不减：只有确认变大、或结构性缩高事件（折叠切换、换目标/重置）才允许提交更小的值；
 *      头像/表情落定、在途状态行出现又消失这类回落都不是内容变少，一律不上报；
 *   3. 同一个值不重复上报（宿主已经按它设过槽位高度，重复写入只是多一次布局失效）。
 */
async function reportHeight(allowShrink = false): Promise<void> {
  await nextTick();
  const el = rootEl.value;
  if (el === null) return;
  contentHeight = el.getBoundingClientRect().height;
  const height = Math.ceil(Math.max(contentHeight, MIN_CONTENT_HEIGHT));
  if (height === committedHeight) return;
  if (!allowShrink && height < committedHeight) return;
  committedHeight = height;
  postToParent(READER_HEIGHT, { height });
}

async function requestContext(): Promise<string> {
  const response: unknown = await chrome.runtime.sendMessage({ type: EMBEDDED_CONTEXT });
  if (!isEmbeddedContextResponse(response) || response.ok !== true || !response.input) {
    const reason = isEmbeddedContextResponse(response) ? response.error : undefined;
    throw new Error(reason ?? '后台未返回当前视频地址');
  }
  return response.input;
}

/**
 * 目标身份：平台 + 主体 id。它是「算不算换目标」的唯一判据 —— 只跟主体走，
 * 与 URL 上的查询串 / 锚点无关（B 站会在同一条视频上反复写 `?spm_id_from`、`?vd_source`、`#`）。
 */
function identityOf(subject: SubjectRef): string {
  return `${subject.platform}:${subject.kind}:${subject.id}`;
}

/**
 * 宿主说「标签页地址变了」——后台对 `chrome.tabs.onUpdated` 的**任何** URL 变化都会发这条，
 * 包括站点自己在同一条视频上反复写的 `history.replaceState`（`?spm_id_from` / `?vd_source` / 锚点）。
 *
 * 所以这里必须先核对**目标身份**：身份没变就不是换目标，什么都不做。旧写法无条件 `resetTarget()`，
 * 一次 URL 抖动就会丢掉全部已读的页、列表退回第一页，并把槽位高度按空白内容重新提交 —— 宿主文档
 * 随之变矮，浏览器把 `scrollTop` 钳回，正是最典型的物理回弹。
 */
async function onNavigation(): Promise<void> {
  if (stale.value) return;
  let canonical: string;
  try {
    canonical = await requestContext();
  } catch {
    // 读不到规范地址（后台暂不可用）：不猜、不动，下一次取数自己会解析
    return;
  }
  input.value = canonical;
  const resolved = readerWorkbench.resolve(canonical);
  if (resolved !== null && identityOf(resolved.target.subject) === targetId) return;
  await resetTarget();
}

/** 取消：中断这一次取数；闸门在落定时合上（见 canceled），下次用户动作才会重新武装。 */
function cancel(): void {
  canceled = true;
  controller?.abort();
  controller = null;
}

/**
 * 一页顶层评论（含该页根评论的楼中楼预览）。缓存键、账号隔离、礼貌与重试都在抓取层
 * （previewRootsPage → crawlRootsPage）；这里只负责把「页面结果之外的东西」交给视图——
 * 主体元数据（标题）、首条根评论（默认选中）——以及失败时给一句能展示的话。
 */
async function fetchPage(cursor: string | null): Promise<CursorPage<Comment>> {
  const refresh = pendingRefresh;
  const abort = new AbortController();
  controller = abort;
  try {
    await ensureHeaderRules();
    const canonical = await requestContext();
    input.value = canonical;
    const resolved = readerWorkbench.resolve(canonical);
    if (resolved === null) throw new Error('无法把当前地址识别为 B 站视频，请在视频页使用');
    // 解析成功即记账：这次取数认的就是这个目标（之后 URL 怎么抖，身份都不会变）
    targetId = identityOf(resolved.target.subject);
    if (sessionUserId.value === null) {
      // 登录用户 mid 只取一次：「删除」菜单项只在评论作者 === 自己时出现
      void Promise.resolve(readerWorkbench.session?.(resolved.adapter.id, abort.signal))
        .then((s) => {
          sessionUserId.value = s.user?.id ?? null;
        })
        .catch(() => {});
    }
    const options: CrawlOptions = { refresh, maxRoots: 0, maxRepliesPerThread: PAGE_REPLIES, order: order.value };
    const page = await readerWorkbench.previewRootsPage(
      resolved.target.subject,
      cursor,
      options,
      (next) => {
        progress.value = next;
      },
      abort.signal,
    );
    if (cursor === null) {
      subject.value = page.subject;
      // 默认选中第一条顶层评论，详情区因此不会空着
      if (selectedId.value === null) selectedId.value = page.roots[0]?.id ?? null;
    }
    // 身份限制（未登录截断等）随页带回：到底时完整性原因里要能说出「为什么只有这几条」
    identityLimitations.value = page.limitations ?? [];
    return { items: page.comments, next: page.next };
  } catch (caught) {
    if (abort.signal.aborted) {
      // 中断不是失败：改成一个状态机能认出来的名字，交给 CursorPager 的取消判定
      const interrupted = new Error('请求已取消');
      interrupted.name = CANCELED_ERROR_NAME;
      throw interrupted;
    }
    throw new Error(failMessage(caught, '加载失败，请重试'));
  } finally {
    if (controller === abort) controller = null;
  }
}

/**
 * 一次取数落定后，闸门要不要重新武装（武装 = 允许下一次取数）。三种落定不武装：
 * 用户取消（取消就是停止，不是失败）、取数失败（游标留着等「重试」，绝不自动重试）、
 * 以及调用方自己判断的「这一页没落定」（见各调用点）。
 */
function rearmGate(): boolean {
  if (canceled) {
    canceled = false;
    armed = false;
    return false;
  }
  if (pagerState.value.error !== null) return false;
  armed = true;
  return true;
}

/** 取下一页并收尾：先量高上报（DOM 更新之后），再重新评估闸门——人还停在底部就继续取下一页。 */
async function loadNextPage(): Promise<void> {
  await pager.next();
  await reportHeight();
  if (!rearmGate()) return;
  evaluateTrigger();
}

/** 首屏：进度归零，从游标起点取第一页。 */
async function loadFirstPage(): Promise<void> {
  booting.value = true;
  progress.value = null;
  try {
    await pager.next();
  } finally {
    booting.value = false;
  }
  await reportHeight();
  if (!rearmGate()) return;
  evaluateTrigger();
}

/**
 * 换目标（首次进页面 / 页面地址变化）：折叠、选中、按需抓到的回复、写状态、渲染批次全都不再属于新目标。
 * 紧接着的那次高度上报是结构性缩高事件（旧内容已经不在 DOM 里），允许提交更小的值；
 * 高度下界（committedHeight）仍然持有，同一个值不会重复上报。
 */
async function resetTarget(): Promise<void> {
  pager.reset();
  // 新目标的身份由下一取数落定（在 fetchPage 解析之后写入）
  targetId = null;
  collapsed.value = new Set<string>();
  loaded.value = new Map<string, readonly Comment[]>();
  added.value = [];
  liked.value = new Set<string>();
  disliked.value = new Set<string>();
  undisliked.value = new Set<string>();
  removed.value = new Set<string>();
  likeBusy.value = new Set<string>();
  drafts.value = new Map<string, string>();
  sending.value = new Set<string>();
  draftErrors.value = new Map<string, string>();
  replyTo.value = null;
  notice.value = null;
  actionError.value = null;
  located.value = null;
  subject.value = null;
  identityLimitations.value = [];
  rowCap.value = ROW_PAGE_SIZE;
  selectedId.value = null;
  visibleBottom = -Infinity;
  sentinelVisible = false;
  armed = true;
  canceled = false;
  // 旧目标的内容已经不在 DOM 里：这是结构性缩高事件，允许下一帧提交更小的值
  // （同一个值仍然不重复上报——高度下界由 committedHeight 继续持有）
  await reportHeight(true);
  await loadFirstPage();
}

/**
 * 切换顶层排序（最热 ↔ 最新）：换数据集，不是客户端重排（ADR-0004）。
 * 中断旧序的在途页（pager 的 generation 也让它即使晚到也丢弃）、回到游标起点重取第一页；
 * 目标身份 / 主体 / 定位块 / 已展开的回复 / 主题全部保留，渲染批次与折叠态清零。
 * 页键带 order，来回切直接命中各自缓存。
 */
async function switchOrder(next: RootOrder): Promise<void> {
  if (next === order.value) return;
  order.value = next;
  // 旧序的在途请求作废：abort 让它走取消判定，generation++ 保证晚到的结果也进不了新状态
  controller?.abort();
  controller = null;
  pager.reset();
  collapsed.value = new Set<string>();
  selectedId.value = null;
  rowCap.value = ROW_PAGE_SIZE;
  visibleBottom = -Infinity;
  sentinelVisible = false;
  armed = true;
  canceled = false;
  await loadFirstPage();
  // 换序是结构性变化（旧序内容已从 DOM 消失）：允许往宿主上报更小的值
  await reportHeight(true);
  // 头被滚出视野时把它拽回来——新序的第一页在最上面，用户该从那里看起
  const head = rootEl.value?.querySelector('.list-head');
  if (head !== null && head !== undefined && head.getBoundingClientRect().top < 0) head.scrollIntoView({ block: 'start' });
}

/**
 * 重放已加载的页：游标链回到起点逐页再取一遍（同 id 覆盖原位，列表不塌也不闪），
 * 重放目标是重放前已取回的页数（更早的页不补、更深的页不追）。
 * refresh 为 full 时连主体元数据一起回源；incremental 用在「平台说发布成功却没回传评论」——
 * 把顶层分页重走一遍，把那条评论抓回来。
 */
async function refreshLoadedPages(refresh: RefreshMode = 'full'): Promise<void> {
  if (running.value || stale.value) return;
  actionError.value = null;
  canceled = false;
  const target = pager.pagesLoaded;
  pendingRefresh = refresh;
  pager.restart();
  try {
    while (hasNext.value && pager.pagesLoaded < target) {
      const before = pager.pagesLoaded;
      await pager.next();
      // 这一页没落定（失败 / 用户取消）：停在这里，剩下的页交给「重试」或下一次刷新
      if (pager.pagesLoaded === before) break;
    }
  } finally {
    pendingRefresh = 'cache-first';
  }
  await reportHeight();
  if (!rearmGate()) return;
  evaluateTrigger();
}

/** 顶部「重试」：取数失败就从失败的那一页继续（游标还留着），其它失败把已加载的页重取一遍。 */
async function retry(): Promise<void> {
  actionError.value = null;
  canceled = false;
  if (pagerState.value.error !== null) {
    armed = true;
    await loadNextPage();
    return;
  }
  await refreshLoadedPages();
}

/** 再铺开一批渲染行：点「继续显示」或滚到已渲染底部时调用（只长高，不取数）。 */
function showMoreRows(): void {
  rowCap.value = nextRowCap(rowCap.value, rows.value.length);
  void reportHeight();
}

/**
 * 一次铺开全部已取回的行（到底时调用）：取数结束时渲染不必再分批，DOM 最终状态与用户手动点完一样。
 * 在此之前刻意分批，是为了让「边滚边取」的每一帧只patch一小段；到底之后已无新数据，再留着手动那一步
 * 只会让「最后一组」与中途的行为不一致。
 */
function revealAllRows(): void {
  if (rowCap.value >= rows.value.length) return;
  rowCap.value = rows.value.length;
  void reportHeight();
}

/** 人是否还在「快到底」的区域：宿主给的视口底边已经进入已渲染内容末尾的提前量之内。 */
function inLoadZone(): boolean {
  return visibleBottom >= contentHeight - LOAD_MORE_MARGIN;
}

/**
 * 取数的唯一闸门：宿主视口消息与哨兵都汇到这里（触发源跨文档、投递时机不受控，判定只有一处）。
 *
 * 边沿触发——同一段「到底区」只取一次（armed），离开到底区重新武装，取数落定后再评估一次。
 * 这不是「每条视口消息都试一次」：宿主在滚动、尺寸变化、每次高度上报之后都会推视口消息，
 * 没有这道闸门就会被推成「消息风暴 → 连环取数」。
 *
 * 顺序上**先铺开已取回的行、再考虑取数**：铺开是纯渲染动作，与游标状态无关。
 * 反过来（先判「还有下一页」再铺开）会让到底之后剩下的那批行突然要求用户手动点一次
 * ——「最后一组」与中途的行为就不一致了。
 * 状态机的 hasNext / loading / error 是取数侧的第二道门：到底之后、取数途中、失败未重试时都不发请求。
 */
function evaluateTrigger(): void {
  if (!inLoadZone() && !sentinelVisible) {
    armed = true;
    return;
  }
  if (!armed) return;
  if (hiddenRows.value > 0) {
    // 渲染上限挡住的行先铺开（只长高、不取数），把取数留给真正的列表末尾
    showMoreRows();
    return;
  }
  const state = pagerState.value;
  if (!state.hasNext || state.loading || state.error !== null || stale.value) return;
  armed = false;
  void loadNextPage();
}

/**
 * 哨兵观察（兜底触发，不是正确性的唯一依赖）：跨源 iframe 里 `rootMargin` 被忽略、`rootBounds` 为 null，
 * 回调里只有 `isIntersecting` 可信；提前量已经做进哨兵自身的几何（见模板里的 translateY）。
 * 回调只做一件事——更新哨兵可见性并让闸门重新评估一次（hasNext / loading 的守卫全在 evaluateTrigger 里）。
 * 实测这个回调在某些环境下不总交付，所以宿主视口消息那条通道必须保持可用。
 */
function observeSentinel(): void {
  sentinelObserver?.disconnect();
  sentinelObserver = null;
  const el = sentinelEl.value;
  if (el === null || typeof IntersectionObserver !== 'function') return;
  sentinelObserver = new IntersectionObserver((entries) => {
    const entry = entries[entries.length - 1];
    if (entry === undefined) return;
    sentinelVisible = entry.isIntersecting;
    evaluateTrigger();
  });
  sentinelObserver.observe(el);
}

/** 哨兵随列表一起出现（首屏落定后才渲染），出现即挂上观察。 */
watch(sentinelEl, observeSentinel, { flush: 'post' });

/** 展开某条评论：它的回复还没取全时按需抓这棵树——首屏绝不主动抓评论树。 */
async function expandReplies(node: CommentNode): Promise<void> {
  const canonical = input.value;
  const id = node.comment.id;
  if (canonical === null || stale.value) return;
  // 已取全、已经在取、或者这条树已经按需取过（取到单树上限为止）都不再重复请求
  if (node.children.length >= node.comment.replyCount || expanding.value.has(id) || loaded.value.has(id)) return;
  const resolved = readerWorkbench.resolve(canonical);
  if (resolved === null) return;
  expanding.value = new Set(expanding.value).add(id);
  try {
    const analysis = await readerWorkbench.previewThread(
      resolved.target.subject,
      id,
      { refresh: 'cache-first', maxRoots: 0, maxRepliesPerThread: EXPANDED_REPLIES },
      () => {},
      new AbortController().signal,
    );
    if (input.value !== canonical) return; // 期间换过视频：这次结果不再属于当前视图
    const block = located.value;
    if (block !== null && locatedForest.value?.byId.has(id) === true && forest.value?.byId.has(id) !== true) {
      // 定位块里的展开：取回的子树并进定位块，不进主流（流里没有它的根，并进去会变成孤儿行）
      located.value = { ...block, comments: mergeComments(block.comments, analysis.snapshot.comments) };
    } else {
      const next = new Map(loaded.value);
      next.set(id, analysis.snapshot.comments);
      loaded.value = next;
    }
    // 回复树落定即量一次：这些行多半还会继续长（图片/表情），ResizeObserver 只作补报
    await reportHeight();
  } catch (caught) {
    fail(caught, '加载这条评论的回复失败，请重试');
  } finally {
    const next = new Set(expanding.value);
    next.delete(id);
    expanding.value = next;
  }
}

/** 行事件统一在这里找节点：定位块里的行不在主流森林里，两片森林都查。 */
function nodeOf(id: string): CommentNode | null {
  return forest.value?.byId.get(id) ?? locatedForest.value?.byId.get(id) ?? null;
}

function toggleFold(id: string): void {
  const next = new Set(collapsed.value);
  if (next.has(id)) {
    next.delete(id);
    const node = nodeOf(id);
    if (node !== null) void expandReplies(node);
  } else {
    next.add(id);
  }
  collapsed.value = next;
  // 展开会露出更多行：抬一格渲染上限，别让新行卡在窗口之外
  if (!next.has(id)) rowCap.value = nextRowCap(rowCap.value, rows.value.length);
  // 折叠 / 展开是结构性缩高事件：折叠让内容真的变少，允许往宿主上报更小的值
  void reportHeight(true);
}

function foldAll(): void {
  const current = forest.value;
  if (current === null) return;
  // 一次意图，不只是当下这一屏：置上之后新取回的页 / 新写成的评论也一起折叠（见下面的补折 watcher）
  foldAllActive.value = true;
  const next = new Set<string>();
  for (const root of current.roots) for (const id of collapsibleIds(root)) next.add(id);
  collapsed.value = next;
  void reportHeight(true);
}

function expandAll(): void {
  foldAllActive.value = false;
  collapsed.value = new Set<string>();
  rowCap.value = nextRowCap(rowCap.value, rows.value.length);
  void reportHeight(true);
}

/**
 * 「全部折叠」之后新出现的行也要折叠——旧写法只折当时森林里的 id，于是「加载新评论后它们又是展开的」。
 * 只把**新出现**的可折叠 id 并进 `collapsed`（不重算整份集合），所以用户随后单独展开某一行不会被重新折回去。
 * flush 默认 'pre'：在渲染前补上，新行不会先展开一帧再折起来。
 */
watch(forest, (current) => {
  if (current === null) return;
  const fresh: string[] = [];
  for (const node of current.byId.values()) {
    if (knownIds.has(node.comment.id)) continue;
    knownIds.add(node.comment.id);
    if (node.children.length > 0) fresh.push(node.comment.id);
  }
  if (fresh.length === 0 || !foldAllActive.value) return;
  collapsed.value = new Set([...collapsed.value, ...fresh]);
});

/* ── 写操作：点赞 / 回复 / 发表（意图经桥交给内容脚本，csrf 只在那边读） ── */

function commentOf(id: string): Comment | null {
  return nodeOf(id)?.comment ?? null;
}

/** 点赞 / 取消点赞：先乐观切换，失败回滚并提示。 */
async function toggleLike(id: string): Promise<void> {
  if (stale.value || likeBusy.value.has(id)) return;
  const wasLiked = liked.value.has(id);
  liked.value = withId(liked.value, id, !wasLiked);
  likeBusy.value = withId(likeBusy.value, id, true);
  notice.value = null;
  const outcome = await writes.send(likeIntent(id, wasLiked));
  if (!outcome.ok) {
    liked.value = withId(liked.value, id, wasLiked);
    notice.value = { tone: 'error', text: outcome.error ?? (wasLiked ? '取消点赞失败' : '点赞失败') };
  }
  likeBusy.value = withId(likeBusy.value, id, false);
}

/**
 * 新写成的评论要立刻看得见：父级折叠着就先展开，再把渲染上限抬到它那一行。
 * （钉在列表顶上的新顶层评论不在 rows 里，找不到就什么都不用做。）
 */
async function revealWritten(comment: Comment): Promise<void> {
  const parentKey = comment.parentId ?? comment.rootId;
  if (parentKey !== null && collapsed.value.has(parentKey)) collapsed.value = withId(collapsed.value, parentKey, false);
  await nextTick();
  const index = rows.value.findIndex((row) => row.id === comment.id);
  if (index >= 0) rowCap.value = Math.max(rowCap.value, index + 1);
  selectedId.value = comment.id;
  // 新评论插进来、父级又被展开：内容只会变高，允许缩高只是因为可能同时撤掉了折叠态
  void reportHeight(true);
}

/** 回复一条评论 / 发表新顶层评论：成功把返回的评论插进树，失败留着草稿并就地提示。 */
async function submitComment(target: Comment | null, text: string): Promise<void> {
  const key = target?.id ?? NEW_COMMENT_KEY;
  const invalid = commentTextError(text);
  if (invalid !== null) {
    draftErrors.value = withDraft(draftErrors.value, key, invalid);
    return;
  }
  if (stale.value || sending.value.has(key)) return;
  draftErrors.value = withDraft(draftErrors.value, key, null);
  sending.value = withId(sending.value, key, true);
  notice.value = null;
  const outcome = await writes.send(target === null ? commentIntent(text) : replyIntent(target, text));
  if (!outcome.ok) {
    draftErrors.value = withDraft(draftErrors.value, key, outcome.error ?? '发送失败，请重试');
    sending.value = withId(sending.value, key, false);
    return;
  }
  drafts.value = withDraft(drafts.value, key, null);
  replyTo.value = null;
  sending.value = withId(sending.value, key, false);
  const created = outcome.comment;
  if (created === undefined) {
    // 平台说成功却没回传归一化评论：草稿已清，把已加载的页按增量重走一遍把这条评论抓回来
    notice.value = { tone: 'info', text: '评论已发布，正在刷新列表…' };
    await refreshLoadedPages('incremental');
    return;
  }
  const block = located.value;
  if (
    target !== null &&
    block !== null &&
    locatedForest.value?.byId.has(target.id) === true &&
    forest.value?.byId.has(target.id) !== true
  ) {
    // 在定位块里回复：新评论并进定位块，不进主流（流里没有它的根，并进去会变孤儿行）
    located.value = { ...block, comments: mergeComments(block.comments, [created]) };
    selectedId.value = created.id;
    await scrollFlashRow(created.id);
    void reportHeight();
    return;
  }
  added.value = [...added.value, created];
  await revealWritten(created);
}

/** 点踩 / 取消点踩：与点赞互斥（原生同款）——踩一个赞过的评论先取消赞（计数乐观回落）。 */
async function toggleDislike(id: string): Promise<void> {
  if (stale.value || likeBusy.value.has(id)) return;
  const was = disliked.value.has(id) || (commentOf(id)?.disliked === true && !undisliked.value.has(id));
  likeBusy.value = withId(likeBusy.value, id, true);
  if (was) {
    disliked.value = withId(disliked.value, id, false);
    undisliked.value = withId(undisliked.value, id, true);
  } else {
    disliked.value = withId(disliked.value, id, true);
    undisliked.value = withId(undisliked.value, id, false);
    // 互斥：赞过就先撤掉赞（计数回到 comment.likes）
    liked.value = withId(liked.value, id, false);
  }
  const outcome = await writes.send(dislikeIntent(id, was));
  likeBusy.value = withId(likeBusy.value, id, false);
  if (!outcome.ok) {
    if (was) {
      undisliked.value = withId(undisliked.value, id, false);
      disliked.value = withId(disliked.value, id, true);
    } else {
      disliked.value = withId(disliked.value, id, false);
      undisliked.value = withId(undisliked.value, id, false);
    }
    notice.value = { tone: 'error', text: outcome.error ?? (was ? '取消点踩失败' : '点踩失败') };
  }
}

/** 复制评论链接：${subject.url}#reply<id>；成功给一个短提示。 */
async function copyCommentLink(id: string): Promise<void> {
  const url = subject.value?.url;
  if (url === undefined) return;
  try {
    await navigator.clipboard.writeText(`${url}#reply${id}`);
    notice.value = { tone: 'info', text: '已复制链接' };
  } catch {
    notice.value = { tone: 'error', text: '复制失败，请重试' };
  }
}

/** 删除自己的评论（两段确认在行内完成）：成功后把它和整棵子树从视图剔除——结构性缩高。 */
async function deleteComment(id: string): Promise<void> {
  if (stale.value) return;
  const outcome = await writes.send(deleteIntent(id));
  if (!outcome.ok) {
    notice.value = { tone: 'error', text: outcome.error ?? '删除失败，请重试' };
    return;
  }
  removed.value = withId(removed.value, id, true);
  if (selectedId.value === id) selectedId.value = null;
  void reportHeight(true);
}

/** 拉黑作者：写链路在页面上下文执行 csrf；成功后仅提示（不隐藏行，与原生一致）。 */
async function blockUser(mid: string): Promise<void> {
  if (stale.value) return;
  const outcome = await writes.send(blockIntent(mid));
  notice.value = outcome.ok
    ? { tone: 'info', text: '已加入黑名单' }
    : { tone: 'error', text: outcome.error ?? '拉黑失败，请重试' };
}

/** 举报评论：理由与可选备注由行内对话框选好，桥送 op=report。 */
async function reportComment(id: string, reason: number, content?: string): Promise<void> {
  if (stale.value) return;
  const outcome = await writes.send(reportIntent(id, reason, content));
  notice.value = outcome.ok
    ? { tone: 'info', text: '已提交举报' }
    : { tone: 'error', text: outcome.error ?? '举报失败，请重试' };
}

function submitReply(id: string, text: string): void {
  const comment = commentOf(id);
  if (comment === null) return;
  void submitComment(comment, text);
}

function setDraft(key: string, text: string): void {
  drafts.value = withDraft(drafts.value, key, text);
  if (draftErrors.value.has(key)) draftErrors.value = withDraft(draftErrors.value, key, null);
}

function openReply(id: string): void {
  replyTo.value = id;
}

function closeReply(id: string): void {
  if (replyTo.value !== id) return;
  replyTo.value = null;
  draftErrors.value = withDraft(draftErrors.value, id, null);
}

function likeStateOf(row: ThreadRow): RowLikeState {
  const isLiked = liked.value.has(row.id);
  const isDisliked = disliked.value.has(row.id) || (row.node.comment.disliked === true && !undisliked.value.has(row.id));
  return { count: row.node.comment.likes + (isLiked ? 1 : 0), liked: isLiked, disliked: isDisliked, busy: likeBusy.value.has(row.id) };
}

function replyStateOf(id: string): RowReplyState {
  return {
    text: drafts.value.get(id) ?? '',
    sending: sending.value.has(id),
    error: draftErrors.value.get(id) ?? null,
  };
}

/**
 * 图谱分析：开一个独立小窗口（popup），带规范地址与选中的评论，交给 store 的 `?view=graph&input=&comment=` 处理；
 * 那个窗口只有一张满窗力导向图（没有顶栏/输入/切换/详情栏），全量抓取只发生在它里面。
 */
async function openGraph(): Promise<void> {
  const canonical = input.value;
  const commentId = selectedId.value;
  if (canonical === null || commentId === null) return;
  try {
    const url = graphPopupUrl(chrome.runtime.getURL('src/ui/app.html'), canonical, commentId);
    // 窗口的摆位与尺寸由 openGraphPopupWindow 统一负责：初始居中、打开后按图规模自适应一次
    await openGraphPopupWindow(url);
  } catch (caught) {
    fail(caught, '无法打开图谱窗口，请重试');
  }
}

/**
 * 第一页落定后补执行一次挂起的定位请求（见 `pendingLocate`）。
 * 只在真有数据之后放行：在流里就走原路，不在流里就由 locateComment 发一次定点定位。
 */
function flushPendingLocate(): void {
  const id = pendingLocate;
  if (id === null || pagerState.value.items.length === 0) return;
  pendingLocate = null;
  void locateComment(id);
}

/**
 * 让某条评论行滚到视野中央并闪一下：先等 Vue 的 patch 落定（选中态是 class 绑定，
 * 下一次 patch 会**重写整个 class 属性**，顺手把刚挂上的闪烁类抹掉），再按 data-comment-id
 * 线性找行元素（行元素不写 id：平台 id 不一定能直进食选择器）——只发生在一次定位动作里。
 * 同一个类连加两次不重放动画：先摘 → 强制重排 → 再加。
 */
async function scrollFlashRow(commentId: string): Promise<void> {
  await nextTick();
  const found = rootEl.value?.querySelectorAll<HTMLElement>('[data-comment-id]') ?? [];
  const row = Array.from(found).find((el) => el.dataset.commentId === commentId) ?? null;
  if (row === null) return;
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  row.classList.remove('flash-highlight');
  void row.offsetWidth;
  row.classList.add('flash-highlight');
}

/** 关掉定位块：结构性缩高（块从 DOM 里消失），允许向宿主上报更小的值。 */
function closeLocated(): void {
  located.value = null;
  void reportHeight(true);
}

/**
 * 流内定位路径（目标的评论在评论流里，或刚被并进流里）：三步缺一不可——
 * ①目标可能被某个祖先的折叠藏起来 → 先展开从根到它的整条祖先链；
 * ②大树是分批铺的，它可能落在渲染上限之外 → 把上限抬到它那一行；③渲染出来才滚动与闪烁。
 */
async function locateInStream(commentId: string): Promise<void> {
  const node = forest.value?.byId.get(commentId) ?? null;
  if (node === null) return; // 理论上不会走到：进来前都查过森林；真走了只可能是其间换了目标
  const unfolded = new Set(collapsed.value);
  for (let up = node.parent; up !== null; up = up.parent) unfolded.delete(up.comment.id);
  if (unfolded.size !== collapsed.value.size) collapsed.value = unfolded;
  await nextTick();
  const index = rows.value.findIndex((row) => row.id === commentId);
  if (index < 0) return;
  if (index + 1 > rowCap.value) rowCap.value = index + 1;
  selectedId.value = commentId;
  await scrollFlashRow(commentId);
  // 展开折叠、抬渲染上限都只会让内容变高，所以走「只增不减」这条（绝不借机往宿主报更矮的槽位）
  void reportHeight();
}

/**
 * 定位到某条评论（工作台 / 图谱 →「在评论区定位」）：宿主把评论 id 投进来。
 *
 * 已在评论流里：走 `locateInStream` 原路径。不在已读范围内：经 workbench.locateComment
 * 定点取回（快照已含则零请求，否则一次 seek）——取回的**根**若已经在流里（目标只是
 * 一条还没加载的楼中楼），把评论块并进主流再按流内路径定位，不钉定位块；根也不在流里
 * 才钉定位块。评论不存在就照实说。
 */
async function locateComment(commentId: string): Promise<void> {
  // 一页都还没落定：没有数据可查，先挂起（内容脚本补发定位的时机就在 READER_READY 之后）
  if (pagerState.value.items.length === 0) {
    pendingLocate = commentId;
    return;
  }
  if (forest.value?.byId.has(commentId) === true) {
    await locateInStream(commentId);
    return;
  }
  const canonical = input.value;
  if (canonical === null || stale.value) return;
  const resolved = readerWorkbench.resolve(canonical);
  if (resolved === null) return;
  try {
    const found = await readerWorkbench.locateComment(
      resolved.target.subject,
      commentId,
      () => {},
      new AbortController().signal,
    );
    if (input.value !== canonical) return; // 期间换过视频：这次结果不再属于当前视图
    if (forest.value?.byId.has(found.root.id) === true) {
      // 目标的根已经在流里：评论块并进它的「按需回复」位（与 expandReplies 同一个 merged 通道），
      // 不丢已加载的回复，然后按流内路径定位——定位块只留给「根也不在流里」的情况
      const mergedLoaded = new Map(loaded.value);
      mergedLoaded.set(found.root.id, mergeComments(mergedLoaded.get(found.root.id) ?? [], found.comments));
      loaded.value = mergedLoaded;
      await nextTick();
      await locateInStream(commentId);
      return;
    }
    located.value = { root: found.root, comments: found.comments };
    selectedId.value = commentId;
    await scrollFlashRow(commentId);
    // 定位块只让内容变高，走「只增不减」这条
    void reportHeight();
  } catch (caught) {
    notice.value =
      caught instanceof PlatformError && caught.kind === 'not-found'
        ? { tone: 'info', text: '这条评论不存在或已被删除' }
        : { tone: 'error', text: failMessage(caught, '定位这条评论失败，请重试') };
  }
}

/**
 * 兜底：DNR/接口失败时把开关改回关闭，内容脚本随即撤掉本页并还原原生评论区。
 */
async function restoreNative(): Promise<void> {
  try {
    await chrome.storage.local.set({ [PAGE_COMMENTS_ENABLED_KEY]: false });
  } catch (caught) {
    fail(caught, '无法还原 B 站原版评论区，请刷新页面');
  }
}

/** 宿主主题落到 <html data-theme>：令牌的显式入口，明暗颜色全在 tokens.css 里。 */
function applyTheme(theme: ReaderTheme): void {
  document.documentElement.dataset.theme = theme;
}

function onParentMessage(event: MessageEvent): void {
  if (event.source !== window.parent) return;
  if (PARENT_ORIGIN !== '*' && event.origin !== PARENT_ORIGIN) return;
  if (isReaderFetchResult(event.data)) {
    // 读结果：按 requestId 配回发起它的那次 GET（桥不可用时不会走到这里）
    readerHttp.settle(event.data);
    return;
  }
  if (isReaderWriteResult(event.data)) {
    writes.settle(event.data);
    return;
  }
  if (isReaderThemeMessage(event.data)) {
    applyTheme(event.data.theme);
    return;
  }
  if (isReaderViewportMessage(event.data)) {
    // 宿主说人滚到哪了：汇进唯一闸门（边沿触发 —— 同一段到底区只取一次，见 evaluateTrigger）
    visibleBottom = event.data.visibleBottom;
    evaluateTrigger();
    return;
  }
  if (isReaderLocateMessage(event.data)) {
    // 工作台 / 图谱点「在评论区定位」：把那一行展开、渲染、滚到中间并闪一下
    void locateComment(event.data.commentId);
    return;
  }
  if (!isReaderBridgeMessage(event.data, READER_NAVIGATION)) return;
  void onNavigation();
}

onMounted(async () => {
  window.addEventListener('message', onParentMessage);
  const el = rootEl.value;
  if (el !== null) {
    // 只作补报：图片 / 头像落定这类不在我们控制内的尺寸变化；每次取数落定后我们自己会量
    heightObserver = new ResizeObserver(() => void reportHeight());
    heightObserver.observe(el);
  }
  await nextTick();
  // 主色偏好存在扩展存储里（工作台里改），阅读器是另一个文档：挂载时应用一次，之后跟着存储变更走
  void applyStoredPalette();
  unwatchPalette = watchPalette((pref) => applyPalette(pref));
  // UI 已挂载就先放行「隐藏原生评论区」：抓取必须当场可见进度，不能等抓完
  postToParent(READER_READY);
  void resetTarget();
});

onBeforeUnmount(() => {
  window.removeEventListener('message', onParentMessage);
  heightObserver?.disconnect();
  heightObserver = null;
  sentinelObserver?.disconnect();
  sentinelObserver = null;
  unwatchPalette?.();
  unwatchPalette = null;
  cancel();
  // 用户卡片不用在这里收：槽位被拆时内容脚本自己会做全局收起（dismissUserCard）
  writes.dropAll('阅读器已关闭');
  readerHttp.dropAll('阅读器已关闭');
});
</script>

<template>
  <div ref="rootEl" class="reader stack">
    <header class="bar head row wrap">
      <span class="row brand">
        <IconTreeStructure />
        <strong>Loupe 评论区</strong>
      </span>
      <span v-if="title" class="subtle small ellipsis" :title="title">{{ title }}</span>
      <span class="grow" />
      <IconCircleNotch v-if="expanding.size > 0" class="spinner" role="img" aria-label="正在加载这条评论的回复" title="正在加载这条评论的回复" />
      <CompletenessBadge v-if="hasItems" :completeness="completeness" />
      <span v-if="hasItems" class="count tnum">{{ formatCount(commentCount) }} 条评论</span>
      <span class="bar-tools row">
        <button
          type="button"
          class="btn btn-sm btn-icon"
          title="全部折叠"
          aria-label="全部折叠"
          :disabled="!hasItems"
          @click="foldAll"
        >
          <IconArrowsIn />
        </button>
        <button
          type="button"
          class="btn btn-sm btn-icon"
          title="全部展开"
          aria-label="全部展开"
          :disabled="!hasItems"
          @click="expandAll"
        >
          <IconArrowsOut />
        </button>
        <button
          type="button"
          class="btn btn-sm btn-icon"
          title="重新抓取已加载的这部分(完整回源请用放大镜开独立窗口)"
          aria-label="刷新"
          :disabled="running"
          @click="refreshLoadedPages()"
        >
          <IconArrowClockwise />
        </button>
        <button
          v-if="running"
          type="button"
          class="btn btn-sm btn-icon"
          title="取消抓取"
          aria-label="取消抓取"
          @click="cancel"
        >
          <IconX />
        </button>
        <button type="button" class="btn btn-sm btn-ghost" title="关闭替换并还原 B 站原版评论区" @click="restoreNative">
          恢复原版评论
        </button>
      </span>
    </header>

    <p v-if="loadError" class="status row wrap small">
      <span class="chip chip-error">加载失败</span>
      <span>{{ loadError }}</span>
      <span class="grow" />
      <button v-if="!stale" type="button" class="btn btn-sm btn-ghost" :disabled="running" @click="retry">
        重试
      </button>
      <button type="button" class="btn btn-sm btn-tonal" @click="restoreNative">恢复原版评论</button>
    </p>
    <p v-else-if="booting" class="status row wrap small subtle">
      <IconCircleNotch class="spinner" aria-hidden="true" />
      <span>{{ phaseLabel }}</span>
      <span class="tnum">
        已取 {{ formatCount(counted) }}<template v-if="declared !== undefined"> / {{ formatCount(declared ?? 0) }}</template> 条
      </span>
      <span v-if="threadsTotal > 0" class="tnum">评论树 {{ threadsDone }}/{{ threadsTotal }}</span>
      <span v-if="waiting">平台限流，退避等待中…</span>
    </p>
    <p v-else-if="!hasItems" class="status row small subtle">
      <IconCircleNotch class="spinner" aria-hidden="true" />
      <span>正在准备…</span>
    </p>

    <!-- 首屏还没有任何评论（加载中 / 尚未落定）时用骨架占位；第一页渲染出来自然卸载 -->
    <SkeletonRows v-if="!hasItems && !loadError" />

    <p v-if="notice" class="status row wrap small">
      <span class="chip" :class="notice.tone === 'error' ? 'chip-error' : 'chip-info'">
        {{ notice.tone === 'error' ? '操作失败' : '提示' }}
      </span>
      <span>{{ notice.text }}</span>
      <span class="grow" />
      <button type="button" class="btn btn-sm btn-ghost" aria-label="关闭提示" title="关闭提示" @click="notice = null">
        <IconX />
      </button>
    </p>

    <CommentComposer
      v-if="hasItems && !stale"
      :text="topDraft"
      :sending="topSending"
      :error="topError"
      placeholder="发一条评论…"
      submit-label="发表评论"
      @input="setDraft(NEW_COMMENT_KEY, $event)"
      @submit="submitComment(null, $event)"
    />

    <!-- 定位块：「在评论区定位」到未读评论时钉在评论流上方，流的行序不受影响 -->
    <section v-if="locatedRows.length > 0" class="located-block">
      <div class="located-head row">
        <span class="located-title small">定位到的评论</span>
        <span class="grow" />
        <button type="button" class="btn btn-sm btn-icon" title="关闭定位" aria-label="关闭定位" @click="closeLocated">
          <IconX />
        </button>
      </div>
      <PageCommentRow
        v-for="row in locatedRows"
        :key="`located-${row.id}`"
        :row="row"
        :like="likeStateOf(row)"
        :subject-url="subject?.url"
        :session-user-id="sessionUserId"
        :reply="row.id === replyTo ? replyStateOf(row.id) : null"
        :selected="row.id === selectedId"
        :busy="expanding.has(row.id)"
        @select="selectedId = $event"
        @fold="toggleFold"
        @analyze="selectedId = $event; openGraph()"
        @user-card="onUserCard"
        @toggle-like="toggleLike"
        @toggle-dislike="toggleDislike"
        @copy-link="copyCommentLink"
        @delete-comment="deleteComment"
        @block-user="blockUser"
        @report-comment="reportComment"
        @open-reply="openReply"
        @close-reply="closeReply"
        @reply-input="setDraft"
        @submit-reply="submitReply"
      />
    </section>

    <div v-if="hasItems" class="comment-list">
      <div class="list-head row">
        <h2 class="list-title">评论</h2>
        <span class="list-count tnum">{{ formatCount(commentCount) }}</span>
        <span class="sort-toggle small" role="group" aria-label="排序方式">
          <button type="button" class="sort-opt" :class="{ active: order === 'hot' }" :aria-pressed="order === 'hot'" @click="switchOrder('hot')">最热</button>
          <span class="sort-sep" aria-hidden="true">|</span>
          <button type="button" class="sort-opt" :class="{ active: order === 'time' }" :aria-pressed="order === 'time'" @click="switchOrder('time')">最新</button>
        </span>
        <span class="grow" />
        <span v-if="hiddenRows > 0" class="subtle small tnum">已显示 {{ formatCount(listRows.length) }} 行</span>
      </div>
      <PageCommentRow
        v-for="row in listRows"
        :key="row.id"
        :row="row"
        :like="likeStateOf(row)"
        :subject-url="subject?.url"
        :session-user-id="sessionUserId"
        :reply="row.id === replyTo ? replyStateOf(row.id) : null"
        :selected="row.id === selectedId"
        :busy="expanding.has(row.id)"
        @select="selectedId = $event"
        @fold="toggleFold"
        @analyze="selectedId = $event; openGraph()"
        @user-card="onUserCard"
        @toggle-like="toggleLike"
        @toggle-dislike="toggleDislike"
        @copy-link="copyCommentLink"
        @delete-comment="deleteComment"
        @block-user="blockUser"
        @report-comment="reportComment"
        @open-reply="openReply"
        @close-reply="closeReply"
        @reply-input="setDraft"
        @submit-reply="submitReply"
      />
      <p v-if="listRows.length === 0" class="empty">这个视频还没有可读的评论。</p>
      <!-- 哨兵：零高度标记，只作兜底触发。跨源 iframe 里 rootMargin 会被忽略，提前量只能做进哨兵自身几何：
           用 transform 把它上移 LOAD_MORE_MARGIN（不占布局、不加内容高度，因此不影响上报的槽位高度），
           于是它和宿主视口消息用的是同一个阈值——渲染成一条留白会撑高内容，把「iframe 高度 = 内容高度」算坏。 -->
      <div
        ref="sentinelEl"
        class="sentinel"
        :style="{ transform: `translateY(${-LOAD_MORE_MARGIN}px)` }"
        aria-hidden="true"
      />
      <!-- 页脚常驻：高度靠 min-height 钉住，加载中 / 到底 / 出错之间切换不会让内容忽高忽低 -->
      <div class="more">
        <button v-if="hiddenRows > 0" type="button" class="btn more-btn" @click="showMoreRows">
          继续显示 {{ formatCount(hiddenRows) }} 条
        </button>
        <template v-else-if="pageError">
          <span class="row small">
            <span class="chip chip-error">加载失败</span>
            <span>{{ pageError }}</span>
          </span>
          <button type="button" class="btn btn-sm btn-ghost" @click="retry">重试</button>
        </template>
        <span v-else-if="running" class="row small subtle">
          <IconCircleNotch class="spinner" aria-hidden="true" />
          <span>{{ phaseLabel }}</span>
        </span>
        <span v-else-if="!hasNext" class="small subtle">没有更多评论了</span>
        <span v-else class="small subtle">滚动到底会自动继续</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 高度由内容自然撑开(宿主页面滚动),因此这里没有任何固定高度与内部滚动条。 */
.reader {
  gap: var(--sp-3);
  padding: var(--sp-4) var(--sp-5) var(--sp-6);
  /* 底色不自己画：这一层是宿主页面里的 iframe，透明才能让 B 站评论区自己的底色透上来，
     浅色/深色/以后换主题都与站点同色（`body` 那份也一并透明，见 base.css 的 body.reader-view）。 */
  background: transparent;
  overflow: hidden;
}

.bar,
.status {
  flex: none;
  gap: var(--sp-2);
}

/* 头部:像 B 站评论区顶栏——品牌与标题在左,计数与工具在右,底部一条细线收口。 */
.head {
  align-items: center;
  padding-bottom: var(--sp-3);
  border-bottom: 1px solid var(--border);
}

.brand {
  font-size: var(--fs-md);
  font-weight: 600;
  color: #00aeec;
}

.brand svg {
  width: 16px;
  height: 16px;
}

.count {
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--fg-muted);
}

.bar-tools {
  /* 右端收口：头部在窄屏换行时工具组也跟着贴右，而不是掉到下一行从左边开始。 */
  margin-left: auto;
  flex: none;
  gap: var(--sp-1);
}

.ellipsis {
  max-width: 42ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 状态条:不再裸排文字,统一成浅底圆条,错误/提示自带语义底色。 */
.status {
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-sm);
  background: var(--surface-2);
  color: var(--fg-muted);
  line-height: var(--lh-tight);
}

.status .chip {
  flex: none;
}

.comment-list {
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: transparent;
}

/* 定位块：与原生置顶同款位置（流上方），细边与底色把它和主流分开。 */
.located-block {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--surface-2);
}

.located-head {
  align-items: center;
  padding: var(--sp-1) var(--sp-2);
  border-bottom: 1px solid var(--border);
}

.located-title {
  font-weight: 600;
  color: var(--fg-muted);
}

/* 列表题头:「评论 312」——B 站评论区的第一行。 */
.list-head {
  align-items: baseline;
  gap: var(--sp-2);
  padding-bottom: var(--sp-2);
}

.list-title {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: 600;
  letter-spacing: 0.01em;
}

.list-count {
  font-size: var(--fs-sm);
  color: var(--fg-subtle);
}

/* 排序切换：与原生「最热 | 最新」同款的分段文本控件，只用既有令牌。 */
.sort-toggle {
  align-items: baseline;
  display: inline-flex;
  gap: var(--sp-1);
}

.sort-opt {
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  color: var(--fg-muted);
  cursor: pointer;
}

.sort-opt:hover {
  color: var(--fg);
}

.sort-opt.active {
  color: var(--fg);
  font-weight: 600;
}

.sort-sep {
  color: var(--border-strong);
}

/* 哨兵：零高度、不占布局，只给 IntersectionObserver 一个「已渲染内容末尾」的观测点。 */
.sentinel {
  height: 0;
}

/* 页脚：min-height 钉住 = padding(24+8) + 按钮(36)，于是「按钮 / 加载中 / 已到底」之间切换不再改变高度 */
.more {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  min-height: 68px;
  padding: var(--sp-5) 0 var(--sp-2);
}

.more-btn {
  min-width: 240px;
  min-height: 36px;
  border-radius: var(--r-pill);
}

@media (max-width: 640px) {
  .reader {
    padding: var(--sp-3) var(--sp-3) var(--sp-5);
  }

  .ellipsis {
    max-width: 24ch;
  }

  .head .brand strong {
    font-size: var(--fs-sm);
  }
}
</style>
