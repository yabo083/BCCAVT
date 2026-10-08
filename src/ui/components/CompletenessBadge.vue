<script setup lang="ts">
/** 完整度徽标：数字常显，缺失原因进共享气泡。 */
import { computed } from 'vue';
import IconCheckCircle from '~icons/ph/check-circle';
import IconWarningCircle from '~icons/ph/warning-circle';
import InfoTip from './InfoTip.vue';
import { formatCount } from '../format';
import type { Completeness } from '@/core/report';

const props = defineProps<{ completeness: Completeness }>();

const detail = computed(() => {
  const { declared, fetched, reasons } = props.completeness;
  const head = declared === undefined ? '平台未声明总数' : `平台声明 ${declared} 条`;
  const tail = reasons.length ? reasons.join('\n') : '未发现缺失';
  return `${head}，已取 ${fetched} 条。\n${tail}`;
});
</script>

<template>
  <span class="row completeness small">
    <span class="badge" :class="completeness.truncated ? 'badge-warning' : 'badge-success'">
      <IconWarningCircle v-if="completeness.truncated" />
      <IconCheckCircle v-else />
      {{ completeness.truncated ? '不完整' : '完整' }}
    </span>
    <span class="tnum subtle">
      {{ formatCount(completeness.fetched) }}<template v-if="completeness.declared !== undefined"> / {{ formatCount(completeness.declared) }}</template>
    </span>
    <InfoTip :text="detail" :label="'完整度：' + detail" />
  </span>
</template>

<style scoped>
.completeness {
  gap: var(--sp-1);
}
</style>
