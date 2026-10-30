<script setup lang="ts">
/** 完整度徽标：数字常显，缺失原因进共享气泡。 */
import { computed } from 'vue';
import IconCheckCircle from '~icons/ph/check-circle';
import IconWarningCircle from '~icons/ph/warning-circle';
import InfoTip from './InfoTip.vue';
import { formatCount } from '../format';
import type { Completeness } from '@/core/report';

const props = withDefaults(defineProps<{ completeness: Completeness; compact?: boolean }>(), { compact: false });

const detail = computed(() => {
  const { declared, fetched, reasons } = props.completeness;
  const head = declared === undefined ? '平台未声明总数' : `平台声明 ${declared} 条`;
  const tail = reasons.length ? reasons.join('\n') : '未发现缺失';
  return `${head}，已取 ${fetched} 条。\n${tail}`;
});
</script>

<template>
  <!-- 徽标本身就是气泡的触发器：再点一个 ⓘ 会在同一行出现两个图标，读起来像重复的提示。
       状态图标（✓/!）已经说明「完整与否」，解释放气泡里，指针 hover 或键盘 focus 都能打开。 -->
  <span class="row completeness small">
    <InfoTip :text="detail" :label="'完整度：' + detail">
      <template #trigger>
        <span class="badge" :class="completeness.truncated ? 'badge-warning' : 'badge-success'">
          <IconWarningCircle v-if="completeness.truncated" />
          <IconCheckCircle v-else />
          {{ completeness.truncated ? '不完整' : '完整' }}
        </span>
      </template>
    </InfoTip>
    <span v-if="!props.compact" class="tnum subtle">
      {{ formatCount(completeness.fetched) }}<template v-if="completeness.declared !== undefined"> / {{ formatCount(completeness.declared) }}</template>
    </span>
  </span>
</template>

<style scoped>
.completeness {
  gap: var(--sp-1);
}

/* 触发器换成徽标本身：去掉 ⓘ 的按钮壳样式（颜色 / 光标 / 图标尺寸都跟徽标走）。 */
.completeness :deep(.tip-trigger) {
  color: inherit;
  cursor: help;
}

.completeness :deep(.tip-trigger svg) {
  width: 12px;
  height: 12px;
}
</style>
