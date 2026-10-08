<script setup lang="ts">
/** 横向条形榜（关键词/属地/等级）：标签 + SVG 条 + 数值。 */
import { computed } from 'vue';
import { scaleBars } from '../charts';
import { formatCount } from '../format';
import type { CountItem } from '@/core/report';

const props = withDefaults(defineProps<{ items: CountItem[]; limit?: number }>(), { limit: 8 });

const rows = computed(() => props.items.slice(0, props.limit));
const ratios = computed(() => scaleBars(rows.value.map((item) => item.count)));
</script>

<template>
  <ol v-if="props.items.length" class="bars">
    <li v-for="(item, i) in rows" :key="item.label" :title="`${item.label}：${formatCount(item.count)}`">
      <span class="name">{{ item.label }}</span>
      <svg class="track" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">
        <rect class="bg" x="0" y="0" width="100" height="6" rx="3" />
        <rect class="fg" x="0" y="0" :width="Math.max(1.5, ratios[i]! * 100)" height="6" rx="3" />
      </svg>
      <span class="value tnum">{{ formatCount(item.count) }}</span>
    </li>
  </ol>
  <p v-else class="empty">暂无数据</p>
</template>

<style scoped>
.bars {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}

.bars li {
  display: grid;
  grid-template-columns: minmax(48px, 5.5em) 1fr auto;
  align-items: center;
  gap: var(--sp-2);
}

.name {
  font-size: var(--fs-sm);
  color: var(--fg-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.track {
  width: 100%;
  height: 6px;
  display: block;
}

.bg {
  fill: var(--surface-3);
}

.fg {
  fill: var(--c1);
}

.value {
  font-size: var(--fs-xs);
  color: var(--fg-muted);
}
</style>
