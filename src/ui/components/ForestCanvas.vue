<script setup lang="ts">
/**
 * 全评论区森林：径向 cluster 布局（d3-hierarchy），点大小 = 子树规模，颜色深浅 = 层级；
 * d3-zoom 缩放平移，Canvas 绘制带视口裁剪与 devicePixelRatio 处理，10k+ 节点也只有一张画布。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { cluster, hierarchy } from 'd3-hierarchy';
import type { HierarchyPointNode } from 'd3-hierarchy';
import { select } from 'd3-selection';
import { zoom, zoomIdentity } from 'd3-zoom';
import type { ZoomBehavior } from 'd3-zoom';
import IconCrosshairSimple from '~icons/ph/crosshair-simple';
import { useCanvasTokens, useElementSize } from '../composables/dom';
import { formatCount } from '../format';
import type { CommentNode, Forest } from '@/core/report';

const props = defineProps<{ forest: Forest; selectedRootId?: string | null }>();
const emit = defineEmits<{ 'open-thread': [rootId: string] }>();

const TAU = Math.PI * 2;
const WORLD_RADIUS = 1000;

interface Datum {
  node: CommentNode | null;
}

interface Placed {
  x: number;
  y: number;
  radius: number;
  depth: number;
  rootId: string;
  node: CommentNode;
}

const viewport = ref<HTMLElement | null>(null);
const canvasEl = ref<HTMLCanvasElement | null>(null);
const tipEl = ref<HTMLElement | null>(null);
const tipPoint = ref<Placed | null>(null);
const { width, height } = useElementSize(viewport);
const tokens = useCanvasTokens();

const transform = ref({ k: 1, x: 0, y: 0 });
const userAdjusted = ref(false);
let zoomBehavior: ZoomBehavior<HTMLCanvasElement, unknown> | null = null;
let frame = 0;
let programmatic = false;

const layout = computed<Placed[]>(() => {
  const roots = props.forest.roots;
  if (!roots.length) return [];
  const toDatum = (node: CommentNode): Datum => ({ node });
  const root = cluster<Datum>().size([TAU, WORLD_RADIUS])(
    hierarchy<Datum>({ node: null }, (datum) =>
      datum.node ? datum.node.children.map(toDatum) : roots.map(toDatum),
    ),
  );

  const placed: Placed[] = [];
  const walk = (node: HierarchyPointNode<Datum>, rootId: string): void => {
    const own = node.data.node;
    const nextRootId = own && node.depth === 1 ? own.comment.id : rootId;
    if (own) {
      placed.push({
        x: Math.cos(node.x) * node.y,
        y: Math.sin(node.x) * node.y,
        radius: 1.5 + Math.min(5.5, Math.sqrt(own.size) * 0.35),
        depth: node.depth - 1,
        rootId: nextRootId,
        node: own,
      });
    }
    for (const child of node.children ?? []) walk(child, nextRootId);
  };
  walk(root, '');
  return placed;
});

const nodeCount = computed(() => layout.value.length);

function fitTransform(): { k: number; x: number; y: number } {
  const w = Math.max(1, width.value);
  const h = Math.max(1, height.value);
  const k = Math.max(0.02, ((Math.min(w, h) / 2) * 0.92) / WORLD_RADIUS);
  return { k, x: w / 2, y: h / 2 };
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
  const hoveredId = tipPoint.value?.node.comment.id ?? null;
  const pad = 40;

  for (const point of layout.value) {
    const screenX = originX + k * point.x;
    const screenY = originY + k * point.y;
    if (screenX < -pad || screenY < -pad || screenX > w + pad || screenY > h + pad) continue;

    const hovered = point.node.comment.id === hoveredId;
    const radius = Math.max(0.7, Math.min(7, point.radius * k));
    context.globalAlpha = hovered ? 1 : Math.max(0.3, 1 - point.depth * 0.13);
    context.beginPath();
    context.arc(screenX, screenY, hovered ? radius + 2 : radius, 0, TAU);
    context.fillStyle = hovered || point.depth === 0 ? palette.accentStrong : palette.accent;
    context.fill();
    context.globalAlpha = 1;

    if (hovered || point.rootId === props.selectedRootId) {
      context.beginPath();
      context.arc(screenX, screenY, radius + 3.5, 0, TAU);
      context.strokeStyle = hovered ? palette.fg : palette.fgMuted;
      context.lineWidth = 1.5;
      context.stroke();
    }
  }
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

  let best: Placed | null = null;
  let bestDistance = 13 * 13;
  for (const point of layout.value) {
    const dx = originX + k * point.x - pointerX;
    const dy = originY + k * point.y - pointerY;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = point;
    }
  }
  return best;
}

function onPointerMove(event: PointerEvent): void {
  const canvas = canvasEl.value;
  if (!canvas) return;
  const hit = pick(event.clientX, event.clientY);
  if (canvas.style.cursor !== (hit ? 'pointer' : 'grab')) canvas.style.cursor = hit ? 'pointer' : 'grab';
  if (tipPoint.value?.node.comment.id !== hit?.node.comment.id) {
    tipPoint.value = hit;
    scheduleDraw();
  }
  const tip = tipEl.value;
  if (tip && hit) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.min(Math.max(8, event.clientX - rect.left + 12), Math.max(8, rect.width - 220));
    const y = Math.min(Math.max(8, event.clientY - rect.top + 12), Math.max(8, rect.height - 80));
    tip.style.transform = `translate(${x}px, ${y}px)`;
  }
}

function onClick(): void {
  const hit = tipPoint.value;
  if (hit) emit('open-thread', hit.rootId);
}

function applyTransform(next: { k: number; x: number; y: number }, user = false): void {
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

function resetView(): void {
  applyTransform(fitTransform());
}

function onKeydown(event: KeyboardEvent): void {
  const step = 40;
  const { k, x, y } = transform.value;
  if (event.key === 'ArrowLeft') applyTransform({ k, x: x + step, y }, true);
  else if (event.key === 'ArrowRight') applyTransform({ k, x: x - step, y }, true);
  else if (event.key === 'ArrowUp') applyTransform({ k, x, y: y + step }, true);
  else if (event.key === 'ArrowDown') applyTransform({ k, x, y: y - step }, true);
  else if (event.key === '+' || event.key === '=') applyTransform({ k: k * 1.25, x, y }, true);
  else if (event.key === '-') applyTransform({ k: k / 1.25, x, y }, true);
  else return;
  event.preventDefault();
}

onMounted(() => {
  const canvas = canvasEl.value;
  if (!canvas) return;
  canvas.style.cursor = 'grab';
  zoomBehavior = zoom<HTMLCanvasElement, unknown>()
    .scaleExtent([0.05, 12])
    .on('zoom', (event) => {
      transform.value = { k: event.transform.k, x: event.transform.x, y: event.transform.y };
      if (!programmatic) userAdjusted.value = true;
      scheduleDraw();
    });
  select(canvas).call(zoomBehavior).on('dblclick.zoom', null);
  applyTransform(fitTransform());
});

onBeforeUnmount(() => {
  if (frame) cancelAnimationFrame(frame);
  select(canvasEl.value).on('.zoom', null);
});

watch(layout, () => {
  applyTransform(fitTransform());
});
watch([width, height], () => {
  if (!userAdjusted.value) applyTransform(fitTransform());
  else scheduleDraw();
});
watch(tokens, scheduleDraw);
watch(
  () => props.selectedRootId,
  () => scheduleDraw(),
);
</script>

<template>
  <div class="forest">
    <div ref="viewport" class="viewport">
      <canvas
        ref="canvasEl"
        class="surface"
        tabindex="0"
        role="application"
        aria-label="评论区森林图：拖拽或滚轮缩放，方向键平移，加减号缩放，点击节点打开评论树"
        @pointermove="onPointerMove"
        @pointerleave="tipPoint = null"
        @click="onClick"
        @keydown="onKeydown"
      />
      <div v-if="tipPoint" ref="tipEl" class="tip">
        <strong>{{ tipPoint.node.comment.author.name }}</strong>
        <p>
          {{ tipPoint.node.comment.text.slice(0, 90) }}{{ tipPoint.node.comment.text.length > 90 ? '…' : '' }}
        </p>
        <span class="subtle small tnum">
          子树 {{ formatCount(tipPoint.node.size) }} 条 · 深度 {{ tipPoint.depth }}
        </span>
      </div>
      <div class="overlay row">
        <span class="chip tnum">{{ formatCount(nodeCount) }} 节点</span>
        <span class="grow" />
        <button type="button" class="btn btn-sm btn-ghost" title="重置视图" @click="resetView">
          <IconCrosshairSimple />
          重置
        </button>
      </div>
    </div>
    <p class="legend small subtle">点大小 = 子树规模 · 颜色越浅层级越深 · 点击进入评论树</p>
  </div>
</template>

<style scoped>
.forest {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

/* 画布视口：尺寸完全由 CSS（flex 分配 / min-height）决定，与位图无关，
   从而切断 canvas.width/height 属性 → 布局高度 → 测量的自增长反馈。 */
.viewport {
  position: relative;
  flex: 1;
  min-height: 220px;
}

/* 绝对定位 + 100% 尺寸：位图大小不可能影响父级几何。 */
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
  max-width: 220px;
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

.overlay {
  position: absolute;
  top: var(--sp-2);
  left: var(--sp-2);
  right: var(--sp-2);
}

.overlay .chip {
  background: var(--surface-2);
}

.legend {
  flex: none;
  margin: var(--sp-1) 0 0;
}
</style>
