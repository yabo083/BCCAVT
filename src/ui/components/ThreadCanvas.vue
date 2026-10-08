<script setup lang="ts">
/**
 * 单棵评论树：水平 tidy tree（d3-hierarchy），有立场诊断时按立场着色、否则按层级；
 * 折叠状态由父组件持有（受控组件），这里只负责布局、绘制、命中与缩放平移。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { hierarchy, tree } from 'd3-hierarchy';
import { select } from 'd3-selection';
import { zoom, zoomIdentity } from 'd3-zoom';
import type { ZoomBehavior } from 'd3-zoom';
import IconCrosshairSimple from '~icons/ph/crosshair-simple';
import IconArrowsIn from '~icons/ph/arrows-in';
import IconArrowsOut from '~icons/ph/arrows-out';
import { useCanvasTokens, useElementSize } from '../composables/dom';
import type { CommentNode, Forest } from '@/core/report';
import type { ThreadDiagnosis } from '@/ai/types';

const props = withDefaults(
  defineProps<{
    forest: Forest;
    rootId?: string | null;
    focusId?: string | null;
    selectedId?: string | null;
    diagnosis?: ThreadDiagnosis | null;
    collapsed?: ReadonlySet<string>;
  }>(),
  { rootId: null, focusId: null, selectedId: null, diagnosis: null, collapsed: () => new Set<string>() },
);
const emit = defineEmits<{
  select: [id: string];
  'toggle-collapse': [id: string];
  'collapse-all': [];
  'expand-all': [];
}>();

const COL = 180;
const ROW = 26;
const MINIMAP_WIDTH = 96;
const MINIMAP_HEIGHT = 132;
const LABEL_FONT = '11px -apple-system, "PingFang SC", "Microsoft YaHei UI", sans-serif';

interface Datum {
  node: CommentNode;
}

interface Placed {
  x: number;
  y: number;
  depth: number;
  label: string;
  hidden: number;
  node: CommentNode;
}

const host = ref<HTMLElement | null>(null);
const canvasEl = ref<HTMLCanvasElement | null>(null);
const minimapEl = ref<HTMLCanvasElement | null>(null);
const tipEl = ref<HTMLElement | null>(null);
const tipPoint = ref<Placed | null>(null);
const { width, height } = useElementSize(host);
const tokens = useCanvasTokens();

const transform = ref({ k: 1, x: 0, y: 0 });
let zoomBehavior: ZoomBehavior<HTMLCanvasElement, unknown> | null = null;
let frame = 0;

const threadRoot = computed<CommentNode | null>(() => {
  const byRootId = props.rootId ? props.forest.byId.get(props.rootId) : undefined;
  return byRootId ?? props.forest.roots[0] ?? null;
});

const layout = computed(() => {
  const root = threadRoot.value;
  const empty = { nodes: [] as Placed[], positions: new Map<string, Placed>(), minX: 0, maxX: 1, minY: 0, maxY: 1 };
  if (!root) return empty;

  const hierarchyRoot = tree<Datum>().nodeSize([ROW, COL])(
    hierarchy<Datum>({ node: root }, (datum) =>
      props.collapsed.has(datum.node.comment.id) ? [] : datum.node.children.map((child) => ({ node: child })),
    ),
  );

  const nodes: Placed[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const node of hierarchyRoot.descendants()) {
    minX = Math.min(minX, node.y);
    maxX = Math.max(maxX, node.y);
    minY = Math.min(minY, node.x);
    maxY = Math.max(maxY, node.x);
    nodes.push({
      x: node.y,
      y: node.x,
      depth: node.depth,
      label: node.data.node.comment.text.replace(/\s+/g, ' ').slice(0, 22),
      hidden: props.collapsed.has(node.data.node.comment.id) ? node.data.node.children.length : 0,
      node: node.data.node,
    });
  }
  return { nodes, positions: new Map(nodes.map((point) => [point.node.comment.id, point])), minX, maxX, minY, maxY };
});

function nodeColor(id: string, depth: number): string {
  const diagnosis = props.diagnosis;
  const palette = tokens.value;
  if (diagnosis) {
    const stance = diagnosis.stanceOf[id];
    if (stance !== undefined) return palette.stances[stance % palette.stances.length]!;
  }
  return depth === 0 ? palette.accentStrong : palette.accent;
}

function fitTransform(): { k: number; x: number; y: number } {
  const w = Math.max(1, width.value);
  const h = Math.max(1, height.value);
  const { minX, maxX, minY, maxY } = layout.value;
  const treeWidth = Math.max(1, maxX - minX);
  const treeHeight = Math.max(1, maxY - minY);
  const k = Math.min(1, Math.max(0.01, Math.min((w - 48) / treeWidth, (h - 48) / treeHeight)));
  return { k, x: (w - k * treeWidth) / 2 - k * minX, y: h / 2 - k * (minY + treeHeight / 2) };
}

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

  const { k, x: originX, y: originY } = transform.value;
  const palette = tokens.value;
  const nodes = layout.value.nodes;
  const labelsVisible = k * ROW >= 16;
  const pad = 60;
  const hoveredId = tipPoint.value?.node.comment.id ?? null;

  // 使用真实父节点坐标，避免把跨层回复画成无连接的平行横线。
  const positions = layout.value.positions;
  context.beginPath();
  for (const point of nodes) {
    if (!point.node.parent) continue;
    const parent = positions.get(point.node.parent.comment.id);
    if (!parent) continue;
    const px = originX + k * parent.x;
    const py = originY + k * parent.y;
    const cx = originX + k * point.x;
    const cy = originY + k * point.y;
    const bend = (px + cx) / 2;
    context.moveTo(px, py);
    context.bezierCurveTo(bend, py, bend, cy, cx, cy);
  }
  context.strokeStyle = palette.border;
  context.lineWidth = 1;
  context.stroke();

  context.font = LABEL_FONT;
  for (const point of nodes) {
    const screenX = originX + k * point.x;
    const screenY = originY + k * point.y;
    if (screenX < -pad || screenY < -pad || screenX > w + pad || screenY > h + pad) continue;

    const hovered = point.node.comment.id === hoveredId;
    const isSelected = point.node.comment.id === props.selectedId;
    const isFocus = point.node.comment.id === props.focusId;
    const radius = Math.max(2, Math.min(9, 4 * k + 1.5));

    context.beginPath();
    context.arc(screenX, screenY, hovered || isSelected ? radius + 2 : radius, 0, Math.PI * 2);
    context.fillStyle = nodeColor(point.node.comment.id, point.depth);
    context.fill();

    if (isFocus || isSelected || hovered) {
      context.beginPath();
      context.arc(screenX, screenY, radius + 4, 0, Math.PI * 2);
      context.strokeStyle = isFocus ? palette.accentStrong : palette.fg;
      context.lineWidth = isFocus ? 2 : 1.5;
      context.stroke();
    }

    if (point.hidden > 0) {
      context.beginPath();
      context.arc(screenX + radius + 5, screenY - radius - 4, 6.5, 0, Math.PI * 2);
      context.fillStyle = palette.surface2;
      context.fill();
      context.fillStyle = palette.fgMuted;
      context.textAlign = 'center';
      context.fillText(String(point.hidden), screenX + radius + 5, screenY - radius - 1);
    }

    if (labelsVisible || isFocus || isSelected) {
      context.fillStyle = isSelected || hovered ? palette.fg : palette.fgMuted;
      context.textAlign = 'left';
      context.fillText(point.label, screenX + radius + 4, screenY + 3.5, Math.max(24, k * COL - 16));
    }
  }
  drawMinimap();
}

function drawMinimap(): void {
  const canvas = minimapEl.value;
  const context = canvas?.getContext('2d');
  if (!canvas || !context) return;
  const dpr = window.devicePixelRatio || 1;
  const pixelWidth = Math.round(MINIMAP_WIDTH * dpr);
  const pixelHeight = Math.round(MINIMAP_HEIGHT * dpr);
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, MINIMAP_WIDTH, MINIMAP_HEIGHT);

  const { minX, maxX, minY, maxY, nodes } = layout.value;
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min((MINIMAP_WIDTH - 12) / spanX, (MINIMAP_HEIGHT - 12) / spanY);
  const offsetX = 6 - minX * scale;
  const offsetY = 6 - minY * scale;

  context.fillStyle = tokens.value.fgSubtle;
  for (const point of nodes) context.fillRect(offsetX + point.x * scale, offsetY + point.y * scale, 1.4, 1.4);

  const { k, x: originX, y: originY } = transform.value;
  const left = (0 - originX) / k;
  const top = (0 - originY) / k;
  context.strokeStyle = tokens.value.accentStrong;
  context.lineWidth = 1;
  context.strokeRect(
    offsetX + left * scale,
    offsetY + top * scale,
    Math.max(2, ((width.value - originX) / k - left) * scale),
    Math.max(2, ((height.value - originY) / k - top) * scale),
  );
}

function scheduleDraw(): void {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    draw();
  });
}

function pick(clientX: number, clientY: number): Placed | null {
  const canvas = canvasEl.value;
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const pointerX = clientX - rect.left;
  const pointerY = clientY - rect.top;
  const { k, x: originX, y: originY } = transform.value;
  const toleranceX = Math.max(6, (k * COL) / 2);
  const toleranceY = Math.max(6, (k * ROW) / 2);

  let best: Placed | null = null;
  let bestDistance = Infinity;
  for (const point of layout.value.nodes) {
    const dx = Math.abs(originX + k * point.x - pointerX);
    const dy = Math.abs(originY + k * point.y - pointerY);
    if (dx > toleranceX || dy > toleranceY) continue;
    if (dx + dy < bestDistance) {
      bestDistance = dx + dy;
      best = point;
    }
  }
  return best;
}

function onPointerMove(event: PointerEvent): void {
  const canvas = canvasEl.value;
  if (!canvas) return;
  const hit = pick(event.clientX, event.clientY);
  canvas.style.cursor = hit ? 'pointer' : 'grab';
  if (tipPoint.value?.node.comment.id !== hit?.node.comment.id) {
    tipPoint.value = hit;
    scheduleDraw();
  }
  const tip = tipEl.value;
  if (tip && hit) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.min(Math.max(8, event.clientX - rect.left + 12), Math.max(8, rect.width - 230));
    const y = Math.min(Math.max(8, event.clientY - rect.top + 12), Math.max(8, rect.height - 70));
    tip.style.transform = `translate(${x}px, ${y}px)`;
  }
}

function applyTransform(next: { k: number; x: number; y: number }): void {
  const canvas = canvasEl.value;
  const behavior = zoomBehavior;
  if (canvas && behavior) {
    select(canvas).call(behavior.transform, zoomIdentity.translate(next.x, next.y).scale(next.k));
  } else {
    transform.value = next;
    scheduleDraw();
  }
}

function onMinimapClick(event: MouseEvent): void {
  const canvas = minimapEl.value;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const { minX, maxX, minY, maxY } = layout.value;
  const scale = Math.min(
    (MINIMAP_WIDTH - 12) / Math.max(1, maxX - minX),
    (MINIMAP_HEIGHT - 12) / Math.max(1, maxY - minY),
  );
  const worldX = minX + (event.clientX - rect.left - 6) / scale;
  const worldY = minY + (event.clientY - rect.top - 6) / scale;
  const { k } = transform.value;
  applyTransform({ k, x: width.value / 2 - k * worldX, y: height.value / 2 - k * worldY });
}

function onKeydown(event: KeyboardEvent): void {
  const step = 48;
  const { k, x, y } = transform.value;
  if (event.key === 'ArrowLeft') applyTransform({ k, x: x + step, y });
  else if (event.key === 'ArrowRight') applyTransform({ k, x: x - step, y });
  else if (event.key === 'ArrowUp') applyTransform({ k, x, y: y + step });
  else if (event.key === 'ArrowDown') applyTransform({ k, x, y: y - step });
  else if (event.key === '+' || event.key === '=') applyTransform({ k: k * 1.25, x, y });
  else if (event.key === '-') applyTransform({ k: k / 1.25, x, y });
  else return;
  event.preventDefault();
}

onMounted(() => {
  const canvas = canvasEl.value;
  if (!canvas) return;
  canvas.style.cursor = 'grab';
  zoomBehavior = zoom<HTMLCanvasElement, unknown>()
    .scaleExtent([0.01, 8])
    .on('zoom', (event) => {
      transform.value = { k: event.transform.k, x: event.transform.x, y: event.transform.y };
      scheduleDraw();
    });
  select(canvas).call(zoomBehavior).on('dblclick.zoom', null);
  applyTransform(fitTransform());
});

onBeforeUnmount(() => {
  if (frame) cancelAnimationFrame(frame);
  select(canvasEl.value).on('.zoom', null);
});

/** 结构或折叠状态变化后重新适配视图。 */
watch(layout, () => {
  applyTransform(fitTransform());
});
watch([width, height], () => applyTransform(fitTransform()));
watch(tokens, scheduleDraw);
watch(
  () => props.selectedId,
  () => scheduleDraw(),
);
</script>

<template>
  <div ref="host" class="thread">
    <canvas
      ref="canvasEl"
      class="surface"
      tabindex="0"
      role="application"
      aria-label="评论树：拖拽或滚轮缩放，方向键平移，单击选中评论，双击折叠子树"
      @pointermove="onPointerMove"
      @pointerleave="tipPoint = null"
      @click="tipPoint && emit('select', tipPoint.node.comment.id)"
      @dblclick="tipPoint && tipPoint.node.children.length && emit('toggle-collapse', tipPoint.node.comment.id)"
      @keydown="onKeydown"
    />
    <div v-if="tipPoint" ref="tipEl" class="tip">
      <strong>{{ tipPoint.node.comment.author.name }}</strong>
      <p>
        {{ tipPoint.node.comment.text.slice(0, 90) }}{{ tipPoint.node.comment.text.length > 90 ? '…' : '' }}
      </p>
      <span class="subtle small tnum">深度 {{ tipPoint.depth }} · 子树 {{ tipPoint.node.size }} 条</span>
    </div>
    <div class="minimap">
      <canvas
        ref="minimapEl"
        :width="MINIMAP_WIDTH"
        :height="MINIMAP_HEIGHT"
        :style="{ width: `${MINIMAP_WIDTH}px`, height: `${MINIMAP_HEIGHT}px` }"
        @click="onMinimapClick"
      />
    </div>
    <div class="toolbar row">
      <button type="button" class="btn btn-sm btn-ghost" title="折叠全部子树" @click="emit('collapse-all')">
        <IconArrowsIn />
      </button>
      <button type="button" class="btn btn-sm btn-ghost" title="展开全部" @click="emit('expand-all')">
        <IconArrowsOut />
      </button>
      <button type="button" class="btn btn-sm btn-ghost" title="重置视图" @click="applyTransform(fitTransform())">
        <IconCrosshairSimple />
      </button>
    </div>
    <p class="legend small subtle">单击选中 · 双击折叠 · 滚轮缩放 · 拖拽平移</p>
  </div>
</template>

<style scoped>
.thread {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.surface {
  flex: 1;
  width: 100%;
  min-height: 260px;
  border-radius: var(--r-sm);
  background: var(--surface);
  touch-action: none;
}

.tip {
  position: absolute;
  top: 0;
  left: 0;
  max-width: 230px;
  padding: var(--sp-2);
  border-radius: var(--r-sm);
  background: var(--surface);
  box-shadow: var(--shadow-3);
  pointer-events: none;
  font-size: var(--fs-sm);
  will-change: transform;
}

.tip p {
  margin: 2px 0;
  color: var(--fg-muted);
  font-size: var(--fs-xs);
  line-height: 1.4;
}

.minimap {
  position: absolute;
  top: var(--sp-2);
  right: var(--sp-2);
  border-radius: var(--r-xs);
  background: color-mix(in srgb, var(--surface) 88%, transparent);
  box-shadow: var(--shadow-1);
  overflow: hidden;
  cursor: crosshair;
}

.toolbar {
  position: absolute;
  top: var(--sp-2);
  left: var(--sp-2);
  gap: 2px;
  padding: 2px;
  border-radius: var(--r-sm);
  background: color-mix(in srgb, var(--surface) 88%, transparent);
  box-shadow: var(--shadow-1);
}

.legend {
  margin: var(--sp-1) 0 0;
}
</style>
