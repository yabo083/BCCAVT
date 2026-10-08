<script setup lang="ts">
/** KPI 磁贴：数值走 tabular-nums，标签小字中性色。 */
defineProps<{ label: string; value: string; sub?: string }>();
</script>

<template>
  <div class="tile">
    <div class="tile-value tnum">{{ value }}</div>
    <div class="tile-label">{{ label }}</div>
    <div v-if="sub" class="tile-sub subtle">{{ sub }}</div>
  </div>
</template>

<style scoped>
.tile {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: var(--sp-2) var(--sp-3);
  background: var(--surface);
  border-radius: var(--r-sm);
  box-shadow: var(--shadow-1);
  min-width: 0;
}

.tile-value {
  font-size: var(--fs-xl);
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.2;
}

.tile-label {
  font-size: var(--fs-xs);
  color: var(--fg-muted);
}

.tile-sub {
  font-size: var(--fs-xs);
}
</style>
