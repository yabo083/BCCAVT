<script setup lang="ts">
/**
 * 页面评论行放大镜打开的图谱窗口（?view=graph&input=…&comment=…）。
 *
 * 整窗只有力导向图：不渲染顶栏、输入、视图切换、报告头、AI 入口与常驻详情栏；
 * 评论正文沿用图上悬停浮层（ForceGraph 自带），因此不需要第二套阅读面板。
 * 抓取仍走 store 的 URL 入口做这条评论树的全量分析，这里只负责把结果铺满窗口。
 * 窗口还自己按图的实际规模调尺寸（见 fitNow）：创建时那档尺寸只是起点，**挂载后首帧就量一次**，
 * 不等仿真收敛——用户开门看到的就已经是接近最终的尺寸；之后仿真收敛再校准一次，
 * 全程一扇窗只按尺寸变化实际改动窗口，用户动过窗就彻底不抢。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { zoomTransform } from 'd3-zoom';
import IconArrowClockwise from '~icons/ph/arrow-clockwise';
import IconCircleNotch from '~icons/ph/circle-notch';
import IconX from '~icons/ph/x';
import ForceGraph from '../components/ForceGraph.vue';
import { cancelRun, startThread, state } from '../store';
import { formatCount } from '../format';

const thread = computed(() => state.thread);
const rootId = computed(() => thread.value?.snapshot.rootId ?? thread.value?.report.root.id ?? null);
const progress = computed(() => state.run?.progress ?? null);
const fetched = computed(() => progress.value?.fetched ?? 0);
const declared = computed(() => progress.value?.declared);
/** 抓取失败时 state.selectedCommentId 还没写上，重试得回到 URL 上那条评论。 */
const queryCommentId = new URLSearchParams(location.search).get('comment')?.trim() ?? null;

const emptyHint = computed(() => {
  if (state.run) return '正在抓取这条评论树…';
  // 还没开跑（mount 与 init 之间）才说「正在准备」，其余都是「没有图可显示」
  if (thread.value === null && state.subject === null && !state.runError && !state.notice) return '正在准备…';
  return '当前没有可显示的图';
});
/** 抓取成功但树是空的（评论被删/不可见）：给一句说明，不留一片空白画布。 */
const empty = computed(() => thread.value !== null && thread.value.forest.roots.length === 0);

function select(id: string): void {
  state.selectedCommentId = id;
}

/** 图上「分析此评论树」：把这条评论当新的根，重抓它的树（同样全量）。 */
function reroot(id: string): void {
  state.selectedCommentId = id;
  void startThread(id);
}

function retry(): void {
  const id = state.selectedCommentId ?? queryCommentId;
  if (id) void startThread(id);
}

/* ── 窗口自适应：图收敛后按实际规模把这扇弹窗调一次尺寸 ── */

/** 自适应尺寸区间：小图不空荡、大图不溢出；上限还要再夹进屏幕工作区。 */
const MIN_POPUP_WIDTH = 720;
const MIN_POPUP_HEIGHT = 560;
const MAX_POPUP_WIDTH = 1500;
const MAX_POPUP_HEIGHT = 1100;
/** 工作区留白：上限比工作区再小这么多，弹窗不顶到屏幕边。 */
const WORK_AREA_MARGIN = 80;
/** 包围盒外的留白：给悬浮工具栏、状态条与视觉呼吸留位置。 */
const SIZE_PADDING = 120;
/** 画布上算作「画了东西」的透明度阈值（0-255）：抗锯齿边缘与雷达波淡出的尾巴都不算内容。 */
const INK_ALPHA = 32;
/** 收敛信号到了但画布还没画出来时：隔一拍再量，最多重试几次。 */
const MEASURE_RETRY_MS = 400;
const MEASURE_ATTEMPTS = 4;
/**
 * 早测时刻表（ms，从挂载起算）：不等仿真收敛就先量一次——窗口出现的那几百毫秒里用户看到的就是这个尺寸，
 * 等到收敛（几秒后）再量会先大后小地跳一下。三拍足够：画布出内容通常在第一拍之前，
 * 后面两拍只是补上「首帧还没画出来」的那点窗口；每次量完若与上次实际尺寸几乎相同就不动窗口。
 */
const EARLY_FIT_AT_MS = [120, 420, 900] as const;
/** 创建后这段时间里的 bounds 变化不算用户操作：系统/Chrome 自己还可能微调新开的弹窗。 */
const USER_RESIZE_GRACE_MS = 1000;
/** 我们自己刚改过尺寸的这段时间里，回声一样的 bounds 变化同样不算用户操作。 */
const SELF_RESIZE_ECHO_MS = 600;
/** 目标尺寸与上次实际应用的相差不超过这么多像素就不再动窗口：省掉没有意义的缩放闪烁。 */
const SIZE_EPSILON = 8;

const root = ref<HTMLElement | null>(null);
const graphRef = ref<InstanceType<typeof ForceGraph> | null>(null);
/** 用户自己拖过/改过这扇窗：彻底放弃自适应（早测与收敛校准都从这里退出）。 */
let userMoved = false;
let detachBoundsWatch: (() => void) | null = null;
let measureTimer = 0;
let attempts = 0;
let mountedAt = 0;
/** 早测的三个定时器：卸载时一并清掉，免得对着已经关掉的窗口量尺寸。 */
const earlyTimers: number[] = [];
/** 上一次真正写进窗口的尺寸：用来跳过幅度小于 SIZE_EPSILON 的重复应用。 */
let applied: { width: number; height: number } | null = null;
/** 上一次写尺寸的时刻：bounds 变化要据此区分「我们的回声」与「用户自己拖的」。 */
let lastAppliedAt = 0;

/** 夹到 [min, max]；上限比下限还小时（工作区特别窄）取下限，不算出比最小尺寸还小的数。 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * 这扇弹窗的窗口对象：只认 `type === 'popup'` 且没被最大化/全屏的那扇。
 * 拿不到（非扩展环境、`?view=graph` 被手工开在标签页里）返回 null —— 一律安静不做。
 */
async function popupWindow(): Promise<chrome.windows.Window | null> {
  const api = typeof chrome === 'undefined' ? null : chrome.windows;
  if (!api || typeof api.getCurrent !== 'function') return null;
  try {
    const win = await api.getCurrent();
    // 工作台标签页绝不能改窗口大小：只有弹窗、且处于普通态（用户没最大化/全屏）才动
    return win && win.type === 'popup' && win.state === 'normal' ? win : null;
  } catch {
    return null;
  }
}

/** 非标准、但 Chrome 一直有的字段（TS 的 DOM lib 没收录）：工作区左上角在屏幕坐标里的位置。 */
interface ScreenOrigin {
  readonly availLeft?: number;
  readonly availTop?: number;
}

/** 屏幕工作区（当前屏幕的可用区域）；宽高拿不到时为 0，表示「没有这条上限、也不动位置」。 */
function workArea(): { left: number; top: number; width: number; height: number } {
  const finite = (value: number | undefined): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const origin: Screen & ScreenOrigin = screen;
  const width = Math.max(0, finite(screen.availWidth));
  const height = Math.max(0, finite(screen.availHeight));
  return {
    left: width > 0 ? finite(origin.availLeft) : 0,
    top: height > 0 ? finite(origin.availTop) : 0,
    width,
    height,
  };
}

/** 尺寸上限：固定上限与「工作区 - 留白」取小；工作区拿不到时只有固定上限。 */
function sizeLimit(area: number, fixed: number): number {
  return area > 0 ? Math.min(fixed, area - WORK_AREA_MARGIN) : fixed;
}

/** 画布上已画内容的包围盒（位图坐标）；整块画布都没内容时返回 null。 */
function inkBounds(canvas: HTMLCanvasElement): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const context = canvas.getContext('2d');
  if (!context || canvas.width === 0 || canvas.height === 0) return null;
  const bitmapWidth = canvas.width;
  const bitmapHeight = canvas.height;
  const data = context.getImageData(0, 0, bitmapWidth, bitmapHeight).data;
  let minX = bitmapWidth;
  let minY = bitmapHeight;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < bitmapHeight; y += 1) {
    const row = y * bitmapWidth;
    for (let x = 0; x < bitmapWidth; x += 1) {
      if (data[(row + x) * 4 + 3]! < INK_ALPHA) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < minX ? null : { minX, minY, maxX, maxY };
}

/**
 * 图空间里的节点包围盒（k = 1 下的像素）：量画布上内容的包围盒，再除以当前缩放。
 * 画布上的节点按当前缩放画（标签按屏幕字号画），所以「屏幕上多大」不等于「这张图多大」；
 * 缩放取自 d3-zoom 挂在画布元素上的变换（`zoomTransform` 是它的公开读法），与 ForceGraph 看到的同一份。
 * 拿不到内容（还没画出来）返回 null。图比视口还大时量到的只是可见部分（下限），
 * 但那种规模只有 MIN_FIT_SCALE 兜底或用户自己放大过才会出现，量出来照样顶到上限。
 */
function naturalSize(): { width: number; height: number } | null {
  const canvas = root.value?.querySelector('canvas') ?? null;
  const box = canvas ? inkBounds(canvas) : null;
  if (!canvas || !box) return null;
  const cssWidth = canvas.clientWidth;
  if (!(cssWidth > 0)) return null;
  const bitmapScale = canvas.width / cssWidth; // 位图 / CSS，含 devicePixelRatio
  const zoom = zoomTransform(canvas).k;
  if (!(bitmapScale > 0) || !(zoom > 0)) return null;
  return {
    width: (box.maxX - box.minX + 1) / bitmapScale / zoom,
    height: (box.maxY - box.minY + 1) / bitmapScale / zoom,
  };
}

/** 目标尺寸 = 包围盒 + 留白，夹进 [最小, min(最大, 工作区 - 留白)]。 */
async function applySize(natural: { width: number; height: number }): Promise<void> {
  const win = await popupWindow();
  if (!win || win.id === undefined || userMoved) return;
  const area = workArea();
  const width = Math.round(clamp(natural.width + SIZE_PADDING, MIN_POPUP_WIDTH, sizeLimit(area.width, MAX_POPUP_WIDTH)));
  const height = Math.round(clamp(natural.height + SIZE_PADDING, MIN_POPUP_HEIGHT, sizeLimit(area.height, MAX_POPUP_HEIGHT)));
  // 与上次写进去的尺寸几乎一样就不动窗口：早测与收敛校准常常算出同一个目标，
  // 重复 `windows.update` 只会让画布白重排一次（还会顺带重播一次雷达波）。
  if (applied !== null && Math.abs(applied.width - width) <= SIZE_EPSILON && Math.abs(applied.height - height) <= SIZE_EPSILON) return;
  const update: chrome.windows.UpdateInfo = { width, height };
  if (area.width > 0 && area.height > 0) {
    // 位置：以这扇窗当前的中心为准（创建时它就在当前窗口中心），按新尺寸重算后夹回工作区。
    // 工作区拿不到就不带 left/top：`windows.update` 只改尺寸，窗口留在原地。
    const centerX = win.left !== undefined && win.width !== undefined ? win.left + win.width / 2 : area.left + area.width / 2;
    const centerY = win.top !== undefined && win.height !== undefined ? win.top + win.height / 2 : area.top + area.height / 2;
    update.left = Math.round(clamp(centerX - width / 2, area.left, Math.max(area.left, area.left + area.width - width)));
    update.top = Math.round(clamp(centerY - height / 2, area.top, Math.max(area.top, area.top + area.height - height)));
  }
  try {
    await chrome.windows.update(win.id, update);
    applied = { width, height };
    lastAppliedAt = Date.now();
  } catch {
    // 窗口可能已经被用户关掉：自适应失败不值得打扰任何人
  }
}

/**
 * 量一次、按需要调一次窗口（早测与收敛校准共用）。
 * 量不到内容（画布还没画出来）就安静跳过——下一拍或收敛信号会再来。
 */
async function fitNow(): Promise<void> {
  if (userMoved || !state.graphOnly) return;
  const natural = naturalSize();
  if (natural === null) return;
  await applySize(natural);
}

/** 收敛后校准：这一刻画布可能还没画出来（降级路径尤其如此），隔一拍重试几次，超了就安静放弃。 */
async function fitAfterSettle(): Promise<void> {
  if (userMoved || !state.graphOnly) return;
  if (naturalSize() === null) {
    attempts += 1;
    if (attempts <= MEASURE_ATTEMPTS) measureTimer = window.setTimeout(() => void fitAfterSettle(), MEASURE_RETRY_MS);
    return;
  }
  await fitNow();
}

/**
 * 盯着这扇窗的 bounds：用户在收敛期间自己拖过/改过大小，就彻底不抢了。
 * 创建后的一小段时间不算用户操作——系统/Chrome 自己还可能微调刚开的弹窗。
 */
async function watchBounds(): Promise<void> {
  const win = await popupWindow();
  const events = typeof chrome === 'undefined' ? undefined : chrome.windows.onBoundsChanged;
  if (!win || win.id === undefined || !events || typeof events.addListener !== 'function') return;
  const onBounds = (changed: chrome.windows.Window): void => {
    if (changed.id !== win.id) return;
    const now = Date.now();
    if (now - mountedAt < USER_RESIZE_GRACE_MS) return;
    // 我们自己刚写过尺寸：`windows.update` 会回一声 bounds 变化，那不是用户拖的
    if (now - lastAppliedAt < SELF_RESIZE_ECHO_MS) return;
    userMoved = true;
    detachBoundsWatch?.();
  };
  events.addListener(onBounds);
  detachBoundsWatch = () => {
    events.removeListener(onBounds);
    detachBoundsWatch = null;
  };
}

onMounted(() => {
  mountedAt = Date.now();
  void watchBounds();
  // 开窗首帧就量：不等仿真收敛（见文件头与 EARLY_FIT_AT_MS）
  for (const delay of EARLY_FIT_AT_MS) {
    earlyTimers.push(window.setTimeout(() => void fitNow(), delay));
  }
});

onBeforeUnmount(() => {
  if (measureTimer) window.clearTimeout(measureTimer);
  measureTimer = 0;
  for (const timer of earlyTimers) window.clearTimeout(timer);
  earlyTimers.length = 0;
  detachBoundsWatch?.();
});

// 收敛后校准一次：`settled` 由 ForceGraph 在仿真结束（或降级路径直接算完）时置位。
watch(
  () => graphRef.value?.settled === true,
  (done) => {
    if (done) void fitAfterSettle();
  },
  { immediate: true },
);
</script>

<template>
  <div ref="root" class="popup">
    <ForceGraph
      v-if="thread && !empty"
      ref="graphRef"
      frameless
      focus-on-select
      :forest="thread.forest"
      :root-id="rootId"
      :focus-id="thread.report.focusId"
      :selected-id="state.selectedCommentId"
      @select="select"
      @open-thread="reroot"
    />

    <div v-else class="placeholder">
      <IconCircleNotch v-if="!thread" class="spinner" />
      <p class="small subtle">{{ empty ? '这条评论树里没有可显示的评论' : emptyHint }}</p>
    </div>

    <p v-if="state.run" class="status" role="status">
      <IconCircleNotch class="spinner" />
      <span>抓取完整评论树</span>
      <span class="tnum">
        已取 {{ formatCount(fetched) }}<template v-if="declared !== undefined"> / {{ formatCount(declared ?? 0) }}</template> 条
      </span>
      <span v-if="state.run.progress.waitingMs">平台限流，退避等待中…</span>
      <button type="button" class="btn btn-sm btn-icon" title="取消抓取" aria-label="取消抓取" @click="cancelRun">
        <IconX />
      </button>
    </p>
    <p v-else-if="state.runError" class="status status-error" role="alert">
      <span class="chip chip-error">抓取失败</span>
      <span>{{ state.runError }}</span>
      <button type="button" class="btn btn-sm btn-icon" title="重试" aria-label="重试" @click="retry">
        <IconArrowClockwise />
      </button>
    </p>
    <p v-else-if="state.notice" class="status">
      <span>{{ state.notice.text }}</span>
      <button type="button" class="btn btn-sm btn-icon" title="关闭提示" aria-label="关闭提示" @click="state.notice = null">
        <IconX />
      </button>
    </p>
  </div>
</template>

<style scoped>
.popup {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg);
}

.placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-3);
}

.placeholder .spinner {
  width: 22px;
  height: 22px;
  color: var(--accent);
}

.status .spinner {
  width: 13px;
  height: 13px;
  flex: none;
  color: var(--fg-subtle);
}

/* 状态浮层：只在抓取、失败或有提示时出现；平时整扇窗只有画布。 */
.status {
  position: absolute;
  left: 50%;
  bottom: var(--sp-4);
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--sp-2);
  max-width: calc(100% - var(--sp-4) * 2);
  margin: 0;
  padding: var(--sp-1) var(--sp-2) var(--sp-1) var(--sp-3);
  border-radius: var(--r-md);
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  backdrop-filter: blur(8px);
  box-shadow: var(--shadow-2);
  font-size: var(--fs-sm);
  color: var(--fg-muted);
  z-index: 2;
}

.status-error {
  color: var(--fg);
}

.status-error span {
  word-break: break-word;
}
</style>
