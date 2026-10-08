<script setup lang="ts">
/** 时间直方图：柱子用 SVG（非等比拉伸），坐标文字用 HTML，避免缩放糊字；悬停/方向键读数。 */
import { computed, ref } from 'vue';
import { scaleBars } from '../charts';
import { formatBucketWidth, formatCount, formatDate, formatDateTime } from '../format';
import type { Timeline } from '@/core/report';

const props = defineProps<{ timeline: Timeline }>();

const index = ref<number | null>(null);
const counts = computed(() => props.timeline.buckets.map((bucket) => bucket.count));
const heights = computed(() => scaleBars(counts.value));
const total = computed(() => counts.value.reduce((sum, value) => sum + value, 0));
const peak = computed(() => counts.value.reduce((max, value) => (value > max ? value : max), 0));
const gap = computed(() => (counts.value.length > 160 ? 0 : 0.08));
const first = computed(() => props.timeline.buckets[0]);
const last = computed(() => props.timeline.buckets[props.timeline.buckets.length - 1]);
const readout = computed(() => {
  const bucket = index.value === null ? undefined : props.timeline.buckets[index.value];
  if (bucket) return `${formatDateTime(bucket.start)} · ${formatCount(bucket.count)} 条`;
  if (!first.value || !last.value) return '暂无数据';
  return `${formatDate(first.value.start)} 至 ${formatDate(last.value.end)} · 峰值 ${formatCount(peak.value)} 条/格`;
});

function step(delta: number): void {
  const size = props.timeline.buckets.length;
  if (!size) return;
  const current = index.value ?? 0;
  index.value = Math.min(size - 1, Math.max(0, current + delta));
}
</script>

<template>
  <div class="chart">
    <div class="row between readout small">
      <span class="tnum muted">{{ readout }}</span>
      <span class="subtle tnum">{{ formatBucketWidth(props.timeline.bucketMs) }}</span>
    </div>
    <div
      class="plot"
      tabindex="0"
      role="img"
      :aria-label="`时间分布：共 ${total} 条，${props.timeline.buckets.length} 个时间格`"
      @keydown.left.prevent="step(-1)"
      @keydown.right.prevent="step(1)"
      @keydown.escape="index = null"
      @mouseleave="index = null"
    >
      <svg :viewBox="`0 0 ${Math.max(1, heights.length)} 1`" preserveAspectRatio="none" aria-hidden="true">
        <g v-for="(height, i) in heights" :key="i">
          <rect class="hit" :x="i" y="0" width="1" height="1" @mouseenter="index = i" />
          <rect class="bar" :class="{ active: i === index }" :x="i + gap" :y="1 - height" :width="1 - gap * 2" :height="height" />
        </g>
      </svg>
    </div>
    <div class="row between small subtle tnum">
      <span>{{ first ? formatDate(first.start) : '' }}</span>
      <span>{{ last ? formatDate(last.end) : '' }}</span>
    </div>
  </div>
</template>

<style scoped>
.chart {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}

.plot {
  height: 68px;
  border-radius: var(--r-xs);
  background: var(--surface-2);
  overflow: hidden;
}

.plot svg {
  display: block;
  width: 100%;
  height: 100%;
}

.bar {
  fill: var(--c1);
  transition: fill var(--dur-fast) ease;
}

.bar:hover,
.bar.active {
  fill: var(--accent-strong);
}

.hit {
  fill: transparent;
  pointer-events: all;
}
</style>
