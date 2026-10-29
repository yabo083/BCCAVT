<script setup lang="ts">
/**
 * 底部浮动工具条：只有工具——立场图例、分组跳转、图/树切换、缩放/适配/暂停、诊断。
 * 画布数据源、节点·边计数与仿真状态是「参数」不是「工具」，已移到顶栏第二行。
 * 图控制不直接碰 ForceGraph：缩放/适配/暂停都 emit 给外层（外层拿 ForceGraph 暴露的控制面驱动）。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import IconGraph from '~icons/ph/graph';
import IconTreeStructure from '~icons/ph/tree-structure';
import IconCrosshairSimple from '~icons/ph/crosshair-simple';
import IconMagnifyingGlassMinus from '~icons/ph/magnifying-glass-minus';
import IconMagnifyingGlassPlus from '~icons/ph/magnifying-glass-plus';
import IconPause from '~icons/ph/pause';
import IconPlay from '~icons/ph/play';
import IconSparkle from '~icons/ph/sparkle';
import IconSquaresFour from '~icons/ph/squares-four';
import StanceLegend from './StanceLegend.vue';
import { formatCount } from '../format';
import type { Forest } from '@/core/report';
import type { ThreadDiagnosis } from '@/ai/types';

/** 一个分组只保留代表节点（组内点赞最高的那条），点分组即跳到它。 */
interface ClusterGroup {
  key: string;
  label: string;
  count: number;
  topId: string;
  color: string | null;
}

const props = defineProps<{
  kind: 'subject' | 'thread' | null;
  mode: 'graph' | 'tree';
  canTree: boolean;
  paused: boolean | null;
  forest: Forest | null;
  diagnosis: ThreadDiagnosis | null;
  busy: boolean;
}>();

const emit = defineEmits<{
  zoom: [factor: number];
  fit: [];
  pause: [];
  mode: ['graph' | 'tree'];
  diagnose: [];
  select: [id: string];
}>();

const clusterOpen = ref(false);
const clusterEl = ref<HTMLElement | null>(null);

/**
 * 面板本身带 backdrop-filter，会成为 fixed 后代的包含块，所以「点外面关掉」不能用全屏遮罩，
 * 只能在打开期间挂一个捕获阶段的原生监听（点在本组内则忽略）。
 */
function onDocumentPointerDown(event: PointerEvent): void {
  if (event.target instanceof Node && clusterEl.value?.contains(event.target)) return;
  clusterOpen.value = false;
}

watch(clusterOpen, (open) => {
  if (open) document.addEventListener('pointerdown', onDocumentPointerDown, true);
  else document.removeEventListener('pointerdown', onDocumentPointerDown, true);
});

onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointerDown, true));

/**
 * 分组汇总：有诊断就按立场分，否则按顶层评论树分（取最大的 8 棵）。
 * 只是「按组汇总 + 跳到代表节点」，画布上的布局聚类要图引擎支持，这里不做。
 */
const clusters = computed<ClusterGroup[]>(() => {
  const forest = props.forest;
  if (!forest) return [];
  const diagnosis = props.diagnosis;
  if (diagnosis) {
    const buckets = new Map<number, { count: number; topId: string; likes: number }>();
    for (const node of forest.byId.values()) {
      const stance = diagnosis.stanceOf[node.comment.id];
      if (stance === undefined) continue;
      const bucket = buckets.get(stance);
      if (!bucket) {
        buckets.set(stance, { count: 1, topId: node.comment.id, likes: node.comment.likes });
        continue;
      }
      bucket.count += 1;
      if (node.comment.likes > bucket.likes) {
        bucket.likes = node.comment.likes;
        bucket.topId = node.comment.id;
      }
    }
    return [...buckets.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([stance, bucket]) => ({
        key: `stance-${stance}`,
        label: diagnosis.stances[stance]?.label ?? `立场 ${stance + 1}`,
        count: bucket.count,
        topId: bucket.topId,
        color: `var(--c${(stance % 6) + 1})`,
      }));
  }
  return [...forest.roots]
    .sort((a, b) => b.size - a.size)
    .slice(0, 8)
    .map((root) => ({
      key: root.comment.id,
      label: root.comment.author.name,
      count: root.size,
      topId: root.comment.id,
      color: null,
    }));
});

function pick(group: ClusterGroup): void {
  clusterOpen.value = false;
  emit('select', group.topId);
}
</script>

<template>
  <div class="tools row wrap">
    <StanceLegend v-if="props.diagnosis" :stances="props.diagnosis.stances" />

    <span ref="clusterEl" class="cluster">
      <button
        type="button"
        class="btn btn-sm btn-icon"
        :class="{ 'btn-tonal': clusterOpen }"
        title="分组汇总：按立场或顶层评论树，点分组跳到代表节点"
        aria-label="分组汇总"
        :aria-expanded="clusterOpen"
        @click="clusterOpen = !clusterOpen"
      >
        <IconSquaresFour />
      </button>
      <div v-if="clusterOpen" class="cluster-popover" role="group" aria-label="分组汇总">
        <p class="popover-title">{{ props.diagnosis ? '按立场分组' : '按顶层评论树分组' }}</p>
        <button
          v-for="group in clusters"
          :key="group.key"
          type="button"
          class="group"
          @click="pick(group)"
        >
          <span class="dot" :style="group.color ? { background: group.color } : undefined" aria-hidden="true" />
          <span class="grow group-label">{{ group.label }}</span>
          <span class="tnum subtle">{{ formatCount(group.count) }}</span>
        </button>
        <p class="popover-hint">跳到组内最显眼的一条；按分组重排画布需要图引擎支持。</p>
      </div>
    </span>

    <div v-if="props.canTree" class="segmented" role="group" aria-label="显示方式">
      <button
        type="button"
        class="segment"
        :class="{ active: props.mode === 'graph' }"
        :aria-pressed="props.mode === 'graph'"
        @click="emit('mode', 'graph')"
      >
        <IconGraph /> 图
      </button>
      <button
        type="button"
        class="segment"
        :class="{ active: props.mode === 'tree' }"
        :aria-pressed="props.mode === 'tree'"
        @click="emit('mode', 'tree')"
      >
        <IconTreeStructure /> 树
      </button>
    </div>

    <template v-if="props.mode === 'graph' && props.kind !== null">
      <button
        type="button"
        class="btn btn-sm btn-icon"
        title="缩小"
        aria-label="缩小"
        @click="emit('zoom', 1 / 1.25)"
      >
        <IconMagnifyingGlassMinus />
      </button>
      <button
        type="button"
        class="btn btn-sm btn-icon"
        title="放大"
        aria-label="放大"
        @click="emit('zoom', 1.25)"
      >
        <IconMagnifyingGlassPlus />
      </button>
      <button type="button" class="btn btn-sm btn-icon" title="适配视图" aria-label="适配视图" @click="emit('fit')">
        <IconCrosshairSimple />
      </button>
      <button
        type="button"
        class="btn btn-sm btn-icon"
        :title="props.paused ? '继续物理仿真' : '暂停物理仿真'"
        :aria-label="props.paused ? '继续物理仿真' : '暂停物理仿真'"
        :aria-pressed="props.paused === true"
        @click="emit('pause')"
      >
        <IconPlay v-if="props.paused" />
        <IconPause v-else />
      </button>
    </template>

    <button
      v-if="props.kind === 'thread'"
      type="button"
      class="btn btn-sm btn-tonal"
      :disabled="props.busy"
      @click="emit('diagnose')"
    >
      <IconSparkle />
      诊断讨论
    </button>
  </div>
</template>

<style scoped>
.tools {
  gap: var(--sp-2);
}

.cluster {
  position: relative;
  display: inline-flex;
}

.cluster-popover {
  position: absolute;
  right: 0;
  bottom: calc(100% + var(--sp-2));
  z-index: 2;
  width: min(320px, 70vw);
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--sp-2);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--surface);
  box-shadow: var(--shadow-3);
}

.popover-title {
  margin: 0 0 var(--sp-1);
  padding: 0 var(--sp-1);
  font-size: var(--fs-xs);
  color: var(--fg-subtle);
  letter-spacing: 0.06em;
}

.group {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  width: 100%;
  padding: var(--sp-1) var(--sp-2);
  border: 0;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--fg);
  font-size: var(--fs-sm);
  text-align: left;
  cursor: pointer;
}

.group:hover {
  background: var(--surface-2);
}

.dot {
  width: 8px;
  height: 8px;
  flex: none;
  border-radius: var(--r-pill);
  background: var(--border-strong);
}

.group-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.popover-hint {
  margin: var(--sp-1) 0 0;
  padding: 0 var(--sp-1);
  font-size: var(--fs-xs);
  color: var(--fg-subtle);
  line-height: 1.5;
}

/* 分段控件照原型 .segmented-control / .segment-btn（L1112-1147）：胶囊形、2px 内衬 + 2px 缝、
   标签走 --fs-xs 且一律 600。生产原来是 r-sm 圆角 + 13px + 仅激活态加粗，比方一号也大一号。 */
.segmented {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: var(--r-pill);
  background: var(--surface-2);
}

.segment {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  border: 0;
  padding: var(--sp-1) 10px;
  border-radius: var(--r-pill);
  background: transparent;
  color: var(--fg-muted);
  font-size: var(--fs-xs);
  font-weight: 600;
  cursor: pointer;
}

.segment svg {
  width: 13px;
  height: 13px;
}

.segment:hover {
  color: var(--fg);
}

.segment.active {
  background: var(--surface);
  color: var(--fg);
  box-shadow: var(--shadow-1);
}
</style>
