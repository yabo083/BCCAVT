<script setup lang="ts">
/** 分类直方图（深度/等级）：每列一个柱，数值常显，不需要悬停才能读到值。 */
import { computed, ref } from 'vue';
import { scaleBars } from '../charts';
import { formatCount } from '../format';
import type { CountItem } from '@/core/report';

const props = defineProps<{ items: CountItem[]; unit?: string }>();

const heights = computed(() => scaleBars(props.items.map((item) => item.count)));
const index = ref<number | null>(null);

function label(item: CountItem): string {
  return props.unit ? `${item.label}${props.unit}` : item.label;
}
</script>

<template>
  <div
    v-if="props.items.length"
    class="hist"
    :style="{ gridTemplateColumns: `repeat(${props.items.length}, minmax(0, 1fr))` }"
  >
    <div
      v-for="(item, i) in props.items"
      :key="item.label"
      class="col"
      :title="`${label(item)}：${formatCount(item.count)}`"
      @mouseenter="index = i"
      @mouseleave="index = null"
    >
      <span class="count tnum small">{{ formatCount(item.count) }}</span>
      <svg class="track" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
        <rect class="bar" :class="{ active: i === index }" :y="1 - heights[i]!" width="1" :height="heights[i]!" />
      </svg>
      <span class="name tnum">{{ label(item) }}</span>
    </div>
  </div>
  <p v-else class="empty">暂无数据</p>
</template>

<style scoped>
.hist {
  display: grid;
  gap: var(--sp-1);
  align-items: end;
}

.col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 0;
}

.track {
  width: 100%;
  height: 56px;
  border-radius: var(--r-xs);
  background: var(--surface-2);
}

.bar {
  fill: var(--c1);
}

.bar.active {
  fill: var(--accent-strong);
}

.name {
  font-size: var(--fs-xs);
  color: var(--fg-subtle);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.count {
  color: var(--fg-muted);
}
</style>
