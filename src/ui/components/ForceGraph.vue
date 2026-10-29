<script setup lang="ts">
/**
 * 有向回复图：每条评论一个节点、父 → 子一条有向边，d3-force 真仿真（charge / link / collide）。
 * 根钉在视图中心，先按父子环径向播种再跑仿真，避免初始堆叠；悬停高亮祖先链与直接邻居，
 * 正文只在悬浮层用 CommentText 渲染，画布只画结构（点、边、箭头、作者名）。
 * 画布视口尺寸完全由 CSS 决定（absolute inset 0 + 定高窗口），位图大小不可能反过来撑高布局；
 * 仿真到 alphaMin、卸载、页面不可见即停，prefers-reduced-motion 下直接算到收敛不播动画。
 * 选中/聚焦节点上的雷达波只闪两下：选中/聚焦变化与每次适配视图后重播，播完即 cancelAnimationFrame，
 * 波纹停了仍有静态描边 + SELECTED_SCALE 放大标识选中对象。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { forceCollide, forceLink, forceManyBody, forceSimulation } from 'd3-force';
import type { Simulation } from 'd3-force';
import { select } from 'd3-selection';
import { zoom, zoomIdentity } from 'd3-zoom';
import type { ZoomBehavior } from 'd3-zoom';
import IconCrosshairSimple from '~icons/ph/crosshair-simple';
import IconMagnifyingGlassMinus from '~icons/ph/magnifying-glass-minus';
import IconMagnifyingGlassPlus from '~icons/ph/magnifying-glass-plus';
import IconPause from '~icons/ph/pause';
import IconPlay from '~icons/ph/play';
import IconTreeStructure from '~icons/ph/tree-structure';
import AuthorChip from './AuthorChip.vue';
import CommentText from './CommentText.vue';
import InfoTip from './InfoTip.vue';
import { useCanvasTokens, useElementSize } from '../composables/dom';
import { RADAR_PING_CYCLES, buildGraph, fitTransform, highlightOf, pickNode, radarPing } from '../force-graph';
import type { Graph, GraphLink, GraphNode, Highlight, RadarPingOptions, Transform } from '../force-graph';
import { formatCount, formatDateTime } from '../format';
import type { Forest } from '@/core/report';
import type { ThreadDiagnosis } from '@/ai/types';

const props = withDefaults(
  defineProps<{
    forest: Forest;
    selectedId?: string | null;
    focusId?: string | null;
    rootId?: string | null;
    diagnosis?: ThreadDiagnosis | null;
    /** 满窗模式（图谱窗口）：画布铺满容器，工具栏浮在画布上，不留卡片内边距与底部说明行。 */
    frameless?: boolean;
    /** 点选节点后把它移到视图中心（图谱窗口用；工作台只选中不移动视图）。 */
    focusOnSelect?: boolean;
    /** 隐藏内置工具栏（工作台把缩放/适配/暂停搬到自己的浮动工具条里驱动）。默认关闭，行为与之前一致。 */
    hideToolbar?: boolean;
  }>(),
  {
    selectedId: null,
    focusId: null,
    rootId: null,
    diagnosis: null,
    frameless: false,
    focusOnSelect: false,
    hideToolbar: false,
  },
);
const emit = defineEmits<{ select: [id: string]; 'open-thread': [id: string] }>();

const TAU = Math.PI * 2;
const MIN_SCALE = 0.02;
const MAX_SCALE = 8;
const ZOOM_STEP = 1.25;
const PAN_STEP = 60;
/** 箭头：小图始终画，大图只在放大到看得清时画，避免糊成一片。 */
const ARROW_SIZE = 7;
const ARROW_ALWAYS_MAX_NODES = 240;
const ARROW_MIN_SCALE = 0.5;
/** 标签：小图全标，大图只标显眼的节点；字号固定 12px（屏幕像素），不会缩成看不清的字。 */
const LABEL_ALL_MAX_NODES = 40;
const LABEL_MIN_RADIUS = 6;
const LABEL_FONT = '600 12px "Inter Variable", "PingFang SC", "Microsoft YaHei UI", sans-serif';
const CULL_PAD = 32;
const DRAG_SLOP = 9;
/** 选中节点本体的放大比例（原型 .pulse-focus 的 scale(1.12)）；只作用于绘制，拾取半径不变。 */
const SELECTED_SCALE = 1.12;
/** 雷达波基准半径：约节点外圆的两倍，再按 radarPing 的相位外扩、淡出（原型 ::after 的行为）。 */
const RADAR_BASE_MULT = 2;
/** 雷达波参数：固定闪两下（原型是无限循环，按用户反馈收敛成有限次）。模块级复用，draw 每帧零分配。 */
const RADAR_OPTIONS: RadarPingOptions = { cycles: RADAR_PING_CYCLES };
/** 空闲相位哨兵：pulseStart 等于它表示没有脉冲在播，相位按结束态算（画不出波纹，只剩静态描边）。 */
const PULSE_IDLE = -1;

const viewport = ref<HTMLElement | null>(null);
const canvasEl = ref<HTMLCanvasElement | null>(null);
const tipEl = ref<HTMLElement | null>(null);
const { width, height } = useElementSize(viewport);
const tokens = useCanvasTokens();

const graph = computed<Graph>(() => buildGraph(props.forest, props.rootId));
const nodeCount = computed(() => graph.value.nodes.length);
const linkCount = computed(() => graph.value.links.length);

const transform = ref<Transform>({ k: 1, x: 0, y: 0 });
const userAdjusted = ref(false);
const paused = ref(false);
const settled = ref(false);
const reduceMotion = ref(false);
const hoverId = ref<string | null>(null);
/** 悬浮层量过尺寸、摆好位置之前不显示：否则第一帧会按 0×0 夹到视口角落再跳一下。 */
const tipReady = ref(false);

const hoverNode = computed<GraphNode | null>(() => (hoverId.value ? graph.value.byId.get(hoverId.value) ?? null : null));
const highlight = computed<Highlight | null>(() => (hoverId.value ? highlightOf(graph.value, hoverId.value) : null));
const physicsLabel = computed(() => (paused.value ? '已暂停' : settled.value ? '已收敛' : '仿真中'));
/** 画布说明按实际可用的控件生成：满窗模式没有节点下拉框，点选即居中。 */
const canvasLabel = computed(() => {
  const base = `有向回复图：${nodeCount.value} 个节点、${linkCount.value} 条回复边。方向键平移，加减号缩放，0 适配视图，P 暂停仿真`;
  return props.frameless ? `${base}；悬停看正文，点节点选中并居中。` : `${base}；用下拉框按评论选择节点。`;
});

let simulation: Simulation<GraphNode, GraphLink> | null = null;
let zoomBehavior: ZoomBehavior<HTMLCanvasElement, unknown> | null = null;
let frame = 0;
let pulseFrame = 0;
let pulseStart = PULSE_IDLE;
let programmatic = false;
let dragging: GraphNode | null = null;
let dragMoved = false;
let panning = false;
let cursor = '';
let lastTipX = Number.NaN;
let lastTipY = Number.NaN;
const pressPoint = { x: 0, y: 0 };
const tipSize = { w: 0, h: 0 };
const labelWidths = new Map<string, number>();

function primaryRoot(): GraphNode | null {
  const data = graph.value;
  return data.primaryRootId ? data.byId.get(data.primaryRootId) ?? null : null;
}

/* ── 仿真：根钉住，其余靠 charge / link / collide 收敛 ── */

function startSimulation(): void {
  simulation?.stop();
  simulation = null;
  paused.value = false;
  labelWidths.clear();
  settled.value = false;

  const data = graph.value;
  if (data.nodes.length === 0) {
    settled.value = true;
    return;
  }

  const root = primaryRoot();
  if (root) {
    root.fx = root.x;
    root.fy = root.y;
  }

  const sim = forceSimulation<GraphNode, GraphLink>(data.nodes)
    .force(
      'link',
      forceLink<GraphNode, GraphLink>(data.links)
        .id((node) => node.id)
        .distance((link) => link.source.radius + link.target.radius + 26)
        .strength(0.5),
    )
    .force(
      'charge',
      forceManyBody<GraphNode>().strength((node) => -40 - node.radius * 8).distanceMax(1200),
    )
    .force(
      'collide',
      forceCollide<GraphNode>((node) => node.radius + 4),
    )
    .alphaMin(0.02)
    .on('tick', () => {
      autoFit();
      scheduleDraw();
    })
    .on('end', () => {
      settled.value = true;
      autoFit();
      scheduleDraw();
    });
  simulation = sim;

  // 降低动态效果：不播动画，直接算到收敛后画一帧。
  if (reduceMotion.value) {
    sim.stop();
    for (let i = 0; i < 240 && sim.alpha() > sim.alphaMin(); i += 1) sim.tick();
    settled.value = true;
    scheduleDraw();
  }
}

function togglePause(): void {
  if (!simulation) return;
  if (paused.value) {
    paused.value = false;
    settled.value = false;
    simulation.alpha(Math.max(0.3, simulation.alpha())).restart();
  } else {
    paused.value = true;
    simulation.stop();
  }
  scheduleDraw();
}

function onVisibilityChange(): void {
  if (!simulation || paused.value) return;
  if (document.hidden) simulation.stop();
  else if (!settled.value) simulation.restart();
}

/* ── 绘制：每帧零分配（无数组/对象/字符串拼接，高亮集合只在悬停变化时算一次） ── */

function draw(): void {
  const canvas = canvasEl.value;
  const context = canvas?.getContext('2d');
  if (!canvas || !context) return;

  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, width.value);
  const h = Math.max(1, height.value);
  const pixelWidth = Math.round(w * dpr);
  const pixelHeight = Math.round(h * dpr);
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, w, h);

  const data = graph.value;
  const { k, x: originX, y: originY } = transform.value;
  const palette = tokens.value;
  const active = highlight.value;
  const hovered = hoverId.value;
  const dimmed = active !== null;
  const showArrows = data.nodes.length <= ARROW_ALWAYS_MAX_NODES || k >= ARROW_MIN_SCALE;

  // ── 边：父 → 子，箭头指明回复方向 ──
  context.lineCap = 'round';
  for (const link of data.links) {
    const sx = originX + k * link.source.x;
    const sy = originY + k * link.source.y;
    const tx = originX + k * link.target.x;
    const ty = originY + k * link.target.y;
    if (Math.max(sx, tx) < -CULL_PAD || Math.max(sy, ty) < -CULL_PAD) continue;
    if (Math.min(sx, tx) > w + CULL_PAD || Math.min(sy, ty) > h + CULL_PAD) continue;

    const dx = tx - sx;
    const dy = ty - sy;
    const length = Math.hypot(dx, dy);
    if (length < 1) continue;
    const ux = dx / length;
    const uy = dy / length;
    const arrow = showArrows ? ARROW_SIZE : 0;
    const startX = sx + ux * link.source.radius * k;
    const startY = sy + uy * link.source.radius * k;
    const endX = tx - ux * (link.target.radius * k + arrow * 0.6);
    const endY = ty - uy * (link.target.radius * k + arrow * 0.6);

    const strong = active !== null && active.links.has(link);
    context.globalAlpha = dimmed ? (strong ? 1 : 0.1) : 0.42;
    context.strokeStyle = strong ? palette.accent : palette.fgSubtle;
    context.lineWidth = strong ? 2 : 1;
    context.beginPath();
    context.moveTo(startX, startY);
    context.lineTo(endX, endY);
    context.stroke();

    if (showArrows && (strong || !dimmed)) {
      const baseX = endX - ux * ARROW_SIZE;
      const baseY = endY - uy * ARROW_SIZE;
      const nx = -uy * ARROW_SIZE * 0.4;
      const ny = ux * ARROW_SIZE * 0.4;
      context.beginPath();
      context.moveTo(endX, endY);
      context.lineTo(baseX + nx, baseY + ny);
      context.lineTo(baseX - nx, baseY - ny);
      context.closePath();
      context.fillStyle = strong ? palette.accent : palette.fgSubtle;
      context.fill();
    }
  }

  // ── 节点与标签 ──
  context.textBaseline = 'middle';
  context.textAlign = 'left';
  context.font = LABEL_FONT;
  const stanceOf = props.diagnosis?.stanceOf ?? null;
  const labelAll = data.nodes.length <= LABEL_ALL_MAX_NODES;
  const labelFloor = labelAll ? 2.5 : LABEL_MIN_RADIUS;
  const primaryRootId = data.primaryRootId;
  const selectedId = props.selectedId;
  const focusId = props.focusId;
  const stanceCount = palette.stances.length;
  // 雷达波：只在选中/聚焦节点上画，一帧只算一次相位；reduced-motion 下取起始相位画静态环，不播动画。
  const ping = reduceMotion.value
    ? radarPing(0, RADAR_OPTIONS)
    : radarPing(performance.now() - pulseStart, RADAR_OPTIONS);

  for (const node of data.nodes) {
    const px = originX + k * node.x;
    const py = originY + k * node.y;
    const nodeRadiusPx = Math.max(1.5, node.radius * k);
    const isSelected = node.id === selectedId;
    const isFocus = node.id === focusId;
    // 选中节点本体按原型放大；只影响绘制，命中测试仍用 node.radius。
    const radius = isSelected ? nodeRadiusPx * SELECTED_SCALE : nodeRadiusPx;
    if (px + radius < -CULL_PAD || py + radius < -CULL_PAD) continue;
    if (px - radius > w + CULL_PAD || py - radius > h + CULL_PAD) continue;

    const relevant = active !== null && (active.path.has(node.id) || active.neighbors.has(node.id));
    const isHover = node.id === hovered;

    const stance = stanceOf ? stanceOf[node.id] : undefined;
    const fill =
      stance !== undefined
        ? (palette.stances[stance % stanceCount] ?? palette.accent)
        : node.level === 0
          ? palette.accentStrong
          : palette.accent;
    context.globalAlpha = dimmed ? (relevant || isHover ? 1 : 0.14) : Math.max(0.5, 1 - node.level * 0.06);
    context.beginPath();
    context.arc(px, py, radius, 0, TAU);
    context.fillStyle = fill;
    context.fill();

    if (isHover || isSelected || isFocus) {
      context.globalAlpha = dimmed ? (relevant || isHover ? 1 : 0.2) : 1;
      context.beginPath();
      context.arc(px, py, radius + 3, 0, TAU);
      context.strokeStyle = isHover ? palette.fg : isSelected ? palette.accentStrong : palette.fgMuted;
      context.lineWidth = isHover ? 2 : 1.5;
      context.stroke();
    }

    // 雷达环：以约两倍外圆为基准半径，按 radarPing 的相位外扩并淡出；两下播完（alpha 归 0）只剩上面的静态描边。
    if ((isSelected || isFocus) && ping.alpha > 0) {
      context.globalAlpha = (dimmed ? (relevant || isHover ? 1 : 0.2) : 1) * ping.alpha;
      context.beginPath();
      context.arc(px, py, nodeRadiusPx * RADAR_BASE_MULT * ping.scale, 0, TAU);
      context.strokeStyle = palette.accent;
      context.lineWidth = 2;
      context.stroke();
    }

    // 标签固定 12px 屏幕字号；只在节点足够大（或与悬停/选中相关）时画，缩得极小就先隐掉，避免糊成一团。
    const labeled =
      isHover ||
      relevant ||
      node.id === selectedId ||
      radius >= labelFloor ||
      (node.id === primaryRootId && radius >= 2.5);
    if (!labeled) continue;
    context.globalAlpha = dimmed ? (relevant || isHover ? 1 : 0.12) : Math.max(0.62, 1 - node.level * 0.05);
    context.fillStyle = palette.fg;
    const name = node.node.comment.author.name;
    let labelWidth = labelWidths.get(name);
    if (labelWidth === undefined) {
      labelWidth = context.measureText(name).width;
      labelWidths.set(name, labelWidth);
    }
    const right = px + radius + 5;
    if (right + labelWidth <= w - 8) {
      context.textAlign = 'left';
      context.fillText(name, Math.max(8, right), py);
    } else {
      context.textAlign = 'right';
      context.fillText(name, Math.min(w - 8, Math.max(labelWidth + 8, px - radius - 5)), py);
    }
  }

  positionTip(originX, originY, k);
}

/** 悬浮层跟随节点；位置变化小于半像素就不写 DOM，稳态下每帧零分配。 */
function positionTip(originX: number, originY: number, k: number): void {
  const tip = tipEl.value;
  const node = hoverNode.value;
  if (!tip || !node) return;
  const px = originX + k * node.x;
  const py = originY + k * node.y;
  const maxX = Math.max(8, width.value - tipSize.w - 8);
  const maxY = Math.max(8, height.value - tipSize.h - 8);
  const tx = Math.min(Math.max(8, px + 14), maxX);
  const ty = Math.min(Math.max(8, py + 14), maxY);
  if (Math.abs(tx - lastTipX) < 0.5 && Math.abs(ty - lastTipY) < 0.5) return;
  lastTipX = tx;
  lastTipY = ty;
  tip.style.transform = `translate(${tx}px, ${ty}px)`;
}

function scheduleDraw(): void {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    draw();
  });
}

/** 波纹只画在选中/聚焦节点上：没有目标就没有脉冲可播。 */
function pulseTargets(): boolean {
  return (props.selectedId != null || props.focusId != null) && graph.value.nodes.length > 0;
}

/** 本轮脉冲是否已播完（reduced-motion 不播脉冲，静态环也不需要连续重绘）。 */
function pulseDone(): boolean {
  return reduceMotion.value || radarPing(performance.now() - pulseStart, RADAR_OPTIONS).done;
}

/** 是否有脉冲正在播：从未开播或已播完都算没有。 */
function pulsePlaying(): boolean {
  return pulseStart !== PULSE_IDLE && !pulseDone();
}

/** 停掉脉冲：取消在飞的重绘帧，相位归空闲（下一次 draw 直接落到结束态）。 */
function stopPulse(): void {
  if (pulseFrame) cancelAnimationFrame(pulseFrame);
  pulseFrame = 0;
  pulseStart = PULSE_IDLE;
}

/** 播两下的重绘循环：两下播完即停，不留空转的 rAF。 */
function pulseLoop(): void {
  pulseFrame = requestAnimationFrame(() => {
    pulseFrame = 0;
    draw();
    if (!pulseDone()) pulseLoop();
  });
}

/**
 * 重播两下：选中/聚焦变化（force）与每次适配视图之后调用。
 * 没有选中/聚焦节点就没有波纹可画，直接停循环；reduced-motion 下只补一帧静态环、不开循环。
 * 默认不打断正在播的脉冲：自动适配在收敛期间逐帧调用 fitView，若每帧重置相位，波纹会被钉在起点闪不动。
 */
function replayPulse(force = false): void {
  if (!pulseTargets()) {
    stopPulse();
    return;
  }
  if (reduceMotion.value) {
    scheduleDraw();
    return;
  }
  if (!force && pulsePlaying()) return;
  pulseStart = performance.now();
  scheduleDraw();
  if (!pulseFrame) pulseLoop();
}

/* ── 视图变换 ── */

function applyTransform(next: Transform, user = false): void {
  userAdjusted.value = user;
  const canvas = canvasEl.value;
  const behavior = zoomBehavior;
  if (canvas && behavior) {
    programmatic = true;
    select(canvas).call(behavior.transform, zoomIdentity.translate(next.x, next.y).scale(next.k));
    programmatic = false;
  } else {
    transform.value = next;
    scheduleDraw();
  }
}

/**
 * 适配视图：全组件唯一的 fitTransform 调用点（工具栏按钮、键盘 0/f、收敛期间的自动适配、窗口 resize 都走这里）。
 * 适配完顺带重播两下雷达波作为原点提醒；连续适配（自动适配逐帧调用）由 replayPulse 收口，不会把相位钉在起点。
 */
function fitView(): void {
  applyTransform(fitTransform(graph.value, width.value, height.value));
  replayPulse();
}

/**
 * 收敛期间跟着布局重新适配：初始播种的包围盒远小于力展开后的，只适配一次会让图溢出视口。
 * 只在图谱窗口（满窗）且用户还没自己缩放/平移/拖节点时生效——工作台保持既有行为。
 */
function autoFit(): void {
  if (!props.frameless || userAdjusted.value || dragging !== null) return;
  fitView();
}

/** 复位视图 = 适配整张图（不把某条评论顶到中心，否则会裁掉半边图）。 */
function resetView(): void {
  fitView();
}

function centerOn(id: string): void {
  const node = graph.value.byId.get(id);
  if (!node) return;
  const { k } = transform.value;
  applyTransform({ k, x: width.value / 2 - k * node.x, y: height.value / 2 - k * node.y }, true);
}

function zoomBy(factor: number): void {
  const { k, x, y } = transform.value;
  const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, k * factor));
  if (next === k) return;
  const ratio = next / k;
  const centerX = width.value / 2;
  const centerY = height.value / 2;
  applyTransform({ k: next, x: centerX - ratio * (centerX - x), y: centerY - ratio * (centerY - y) }, true);
}

/* ── 指针：点选 / 拖拽节点 / 拖拽平移（交给 d3-zoom） ── */

function setCursor(next: string): void {
  if (cursor === next) return;
  cursor = next;
  const el = viewport.value;
  if (el) el.style.cursor = next;
}

function worldAt(clientX: number, clientY: number): { x: number; y: number } {
  const rect = canvasEl.value?.getBoundingClientRect();
  const { k, x: originX, y: originY } = transform.value;
  return { x: (clientX - (rect?.left ?? 0) - originX) / k, y: (clientY - (rect?.top ?? 0) - originY) / k };
}

function pickAt(event: PointerEvent): GraphNode | null {
  const rect = canvasEl.value?.getBoundingClientRect();
  return pickNode(graph.value, transform.value, event.clientX - (rect?.left ?? 0), event.clientY - (rect?.top ?? 0));
}

function insideTip(target: EventTarget | null): boolean {
  const tip = tipEl.value;
  return tip !== null && target instanceof Node && tip.contains(target);
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0 || insideTip(event.target)) return;
  const node = pickAt(event);
  if (!node) return;

  // 只记录「按下的候选」：不钉位、不升温。纯点击不该扰动仿真——越过拖动阈值后（onPointerMove）
  // 才钉 fx/fy 并升温，否则一次点选会凭空给邻居注入斥力、把它们弹开（逃逸）。
  dragging = node;
  dragMoved = false;
  pressPoint.x = event.clientX;
  pressPoint.y = event.clientY;
  canvasEl.value?.setPointerCapture(event.pointerId);
}

function onPointerMove(event: PointerEvent): void {
  if (dragging) {
    const dx = event.clientX - pressPoint.x;
    const dy = event.clientY - pressPoint.y;
    if (!dragMoved && dx * dx + dy * dy > DRAG_SLOP * DRAG_SLOP) {
      // 真正进入拖动：此刻才升温并开始钉住被拖的节点。
      dragMoved = true;
      if (!paused.value) {
        settled.value = false;
        simulation?.alphaTarget(0.3).restart();
      }
    }
    if (dragMoved) {
      const world = worldAt(event.clientX, event.clientY);
      dragging.fx = world.x;
      dragging.fy = world.y;
      dragging.x = world.x;
      dragging.y = world.y;
      scheduleDraw();
    }
    return;
  }

  // 平移视图时不做命中测试：悬浮层跟着节点走，不会在拖动中乱跳。
  if (panning || insideTip(event.target)) return;
  const hit = pickAt(event);
  setHover(hit?.id ?? null);
  setCursor(hit ? 'pointer' : 'grab');
}

function onPointerUp(event: PointerEvent): void {
  const node = dragging;
  if (!node) return;
  dragging = null;
  const canvas = canvasEl.value;
  if (canvas?.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);

  // 根保持钉住（它就是视图锚点），其余节点松开后继续参与仿真。
  if (node !== primaryRoot()) {
    node.fx = null;
    node.fy = null;
  }
  simulation?.alphaTarget(0);
  if (!dragMoved) {
    emit('select', node.id);
    if (props.focusOnSelect) centerOn(node.id);
  }
  scheduleDraw();
}

function onPointerLeave(): void {
  if (dragging) return;
  setHover(null);
  setCursor('grab');
}

function setHover(id: string | null): void {
  if (hoverId.value === id) return;
  hoverId.value = id;
  lastTipX = Number.NaN;
  lastTipY = Number.NaN;
  tipReady.value = false;
  if (id) void measureTip();
  scheduleDraw();
}

async function measureTip(): Promise<void> {
  const id = hoverId.value;
  await nextTick();
  const tip = tipEl.value;
  if (!tip || hoverId.value !== id) return;
  tipSize.w = tip.offsetWidth;
  tipSize.h = tip.offsetHeight;
  tipReady.value = true;
  scheduleDraw();
}

function onPick(event: Event): void {
  const id = (event.target as HTMLSelectElement).value;
  if (!id) return;
  emit('select', id);
  centerOn(id);
}

/* ── 键盘：平移 / 缩放 / 收敛视图 / 暂停仿真 ── */

function onKeydown(event: KeyboardEvent): void {
  const { k, x, y } = transform.value;
  switch (event.key) {
    case 'ArrowLeft':
      applyTransform({ k, x: x + PAN_STEP, y }, true);
      break;
    case 'ArrowRight':
      applyTransform({ k, x: x - PAN_STEP, y }, true);
      break;
    case 'ArrowUp':
      applyTransform({ k, x, y: y + PAN_STEP }, true);
      break;
    case 'ArrowDown':
      applyTransform({ k, x, y: y - PAN_STEP }, true);
      break;
    case '+':
    case '=':
      zoomBy(ZOOM_STEP);
      break;
    case '-':
    case '_':
      zoomBy(1 / ZOOM_STEP);
      break;
    case '0':
    case 'f':
    case 'F':
      resetView();
      break;
    case 'p':
    case 'P':
    case ' ':
      togglePause();
      break;
    case 'Enter': {
      const anchor = props.selectedId ?? props.focusId;
      if (anchor) centerOn(anchor);
      break;
    }
    default:
      return;
  }
  event.preventDefault();
}

/* ── 生命周期 ── */

onMounted(() => {
  reduceMotion.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const canvas = canvasEl.value;
  if (canvas) {
    setCursor('grab');
    zoomBehavior = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([MIN_SCALE, MAX_SCALE])
      .filter((event) => dragging === null && (!event.ctrlKey || event.type === 'wheel') && !event.button)
      .on('zoom', (event) => {
        transform.value = { k: event.transform.k, x: event.transform.x, y: event.transform.y };
        if (!programmatic) userAdjusted.value = true;
        scheduleDraw();
      })
      .on('start', (event) => {
        if (event.type !== 'mousedown') return;
        panning = true;
        setCursor('grabbing');
      })
      .on('end', () => {
        if (!panning) return;
        panning = false;
        setCursor('grab');
      });
    select(canvas).call(zoomBehavior).on('dblclick.zoom', null);
  }

  document.addEventListener('visibilitychange', onVisibilityChange);
  startSimulation();
  fitView();
});

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange);
  simulation?.stop();
  simulation = null;
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  stopPulse();
  select(canvasEl.value).on('.zoom', null);
});

watch(graph, () => {
  hoverId.value = null;
  startSimulation();
  fitView();
});

watch([width, height], () => {
  if (userAdjusted.value) scheduleDraw();
  else fitView();
});

watch(tokens, scheduleDraw);
watch(
  () => [props.selectedId, props.focusId],
  () => {
    // 选中/聚焦变化：强制从第一下重播（正在播的旧目标波纹让位给新目标）。
    replayPulse(true);
    scheduleDraw();
  },
);

/**
 * 对外控制面：给外层浮动工具条驱动视图用（工作台传 hideToolbar 后自己画工具条）。
 * 只暴露已有能力，不改仿真/绘制；不传 hideToolbar 的调用方（图谱窗口）完全不受影响。
 */
defineExpose({ resetView, zoomBy, togglePause, paused, settled, nodeCount, linkCount });
</script>

<template>
  <div class="force" :class="{ bleed: props.frameless }">
    <div v-if="!props.hideToolbar" class="toolbar row wrap">
      <span class="chip tnum">{{ nodeCount }} 节点 · {{ linkCount }} 边</span>
      <span class="chip">{{ physicsLabel }}</span>
      <span class="grow" />
      <template v-if="!props.frameless">
        <label class="sr-only" for="force-node-picker">选择评论节点</label>
        <select id="force-node-picker" class="select node-picker" :value="selectedId ?? ''" @change="onPick">
          <option value="">选择评论节点…</option>
          <option v-for="node in graph.nodes" :key="node.id" :value="node.id">
            {{ node.node.comment.author.name }} · 赞 {{ formatCount(node.likes) }} · 子树 {{ formatCount(node.size) }}
          </option>
        </select>
      </template>
      <button type="button" class="btn btn-sm btn-ghost btn-icon" title="适配视图" aria-label="适配视图" @click="resetView">
        <IconCrosshairSimple />
      </button>
      <button
        type="button"
        class="btn btn-sm btn-ghost btn-icon"
        title="缩小"
        aria-label="缩小"
        :disabled="transform.k <= MIN_SCALE"
        @click="zoomBy(1 / ZOOM_STEP)"
      >
        <IconMagnifyingGlassMinus />
      </button>
      <button
        type="button"
        class="btn btn-sm btn-ghost btn-icon"
        title="放大"
        aria-label="放大"
        :disabled="transform.k >= MAX_SCALE"
        @click="zoomBy(ZOOM_STEP)"
      >
        <IconMagnifyingGlassPlus />
      </button>
      <button
        type="button"
        class="btn btn-sm btn-ghost btn-icon"
        :title="paused ? '继续物理仿真' : '暂停物理仿真'"
        :aria-label="paused ? '继续物理仿真' : '暂停物理仿真'"
        @click="togglePause"
      >
        <IconPlay v-if="paused" />
        <IconPause v-else />
      </button>
      <InfoTip
        text="节点 = 评论，箭头 = 回复方向，点大小 = 子树规模 + 点赞。滚轮缩放、空白处拖拽平移，拖节点可挪位（松开后回到仿真）；悬停看正文与邻域，点节点选中。方向键平移，+/- 缩放，0 适配视图，P 暂停仿真。"
        label="回复图操作说明"
      />
    </div>

    <div
      ref="viewport"
      class="viewport"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @pointerleave="onPointerLeave"
    >
      <canvas
        ref="canvasEl"
        class="surface"
        tabindex="0"
        role="application"
        :aria-label="canvasLabel"
        @keydown="onKeydown"
      />
      <div v-if="hoverNode" ref="tipEl" class="tip" :class="{ ready: tipReady }" style="transform: translate(-9999px, -9999px)">
        <AuthorChip
          :author="hoverNode.node.comment.author"
          :meta="formatDateTime(hoverNode.node.comment.createdAt)"
        />
        <div class="tip-body">
          <CommentText :text="hoverNode.node.comment.text" :emotes="hoverNode.node.comment.emotes" />
        </div>
        <div class="row wrap small subtle tnum">
          <span>深度 {{ hoverNode.node.depth }}</span>
          <span>子树 {{ formatCount(hoverNode.size) }} 条</span>
          <span>赞 {{ formatCount(hoverNode.likes) }}</span>
        </div>
        <div class="row tip-actions">
          <button type="button" class="btn btn-sm btn-tonal" @click="emit('select', hoverNode.id)">选中</button>
          <button type="button" class="btn btn-sm btn-ghost" @click="emit('open-thread', hoverNode.id)">
            <IconTreeStructure />
            分析此评论树
          </button>
        </div>
      </div>
    </div>

    <p v-if="!props.frameless" class="legend small subtle">节点：评论 · 连线：回复 · 悬停查看正文</p>
  </div>
</template>

<style scoped>
.force {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

/* 满窗模式（图谱窗口）：画布就是整扇窗，工具栏浮在画布之上——不占位、不留白、不加卡片边框。 */
.force.bleed {
  position: relative;
  overflow: hidden;
}

.force.bleed .viewport {
  position: absolute;
  inset: 0;
  min-height: 0;
}

.force.bleed .surface {
  border-radius: 0;
}

.force.bleed .toolbar {
  position: absolute;
  top: var(--sp-3);
  left: var(--sp-3);
  z-index: 1;
  max-width: calc(100% - var(--sp-3) * 2);
  margin: 0;
  padding: var(--sp-1) var(--sp-2);
  border-radius: var(--r-md);
  background: color-mix(in srgb, var(--surface) 88%, transparent);
  backdrop-filter: blur(8px);
  box-shadow: var(--shadow-2);
}

.toolbar {
  gap: var(--sp-1);
  margin-bottom: var(--sp-2);
}

.node-picker {
  max-width: 200px;
  font-size: var(--fs-sm);
}

/* 画布视口：尺寸完全由 CSS 决定（flex 分配），与位图无关。 */
.viewport {
  position: relative;
  flex: 1;
  min-height: 260px;
}

/* 绝对定位 + 100%：位图大小不可能影响父级几何，也不会自增长。 */
.surface {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border-radius: var(--r-sm);
  background: var(--surface);
  touch-action: none;
}

.tip {
  position: absolute;
  top: 0;
  left: 0;
  width: 260px;
  /* 窄窗口（侧栏、被拖小的图谱窗口）里不许撑出视口：宽度封顶，位置由 positionTip 夹住。 */
  max-width: calc(100% - var(--sp-4));
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-sm);
  background: var(--surface);
  box-shadow: var(--shadow-3);
  font-size: var(--fs-sm);
  will-change: transform;
  /* 量好尺寸并摆好位置之前不显示，避免第一帧跳到视口角落。 */
  visibility: hidden;
}

.tip.ready {
  visibility: visible;
}

.tip-actions {
  gap: var(--sp-1);
}

/* 正文可能很长：悬浮层只给一屏以内的窗口，全文在选中详情里。 */
.tip-body {
  max-height: 34vh;
  overflow: auto;
  overscroll-behavior: contain;
  word-break: break-word;
  line-height: var(--lh-normal);
}

.legend {
  flex: none;
  margin: var(--sp-2) 0 0;
}
</style>
