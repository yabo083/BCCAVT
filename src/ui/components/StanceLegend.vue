<script setup lang="ts">
/** 立场图例：颜色与评论树着色一一对应。 */
import type { Stance } from '@/ai/types';

defineProps<{ stances: Stance[] }>();
</script>

<template>
  <div class="row wrap legend">
    <span
      v-for="(stance, i) in stances"
      :key="stance.label"
      class="chip"
      :style="{ background: `var(--c${(i % 6) + 1}-bg)`, color: `var(--c${(i % 6) + 1})` }"
      :title="stance.summary"
    >
      {{ stance.label }}
    </span>
  </div>
</template>

<style scoped>
.legend {
  gap: var(--sp-1);
}
</style>
