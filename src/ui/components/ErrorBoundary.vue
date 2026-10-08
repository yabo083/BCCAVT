<script setup lang="ts">
/** 面板级错误边界：局部失败只替换这一块，绝不让整个应用白屏。 */
import { onErrorCaptured, ref } from 'vue';
import IconWarningCircle from '~icons/ph/warning-circle';
import IconArrowClockwise from '~icons/ph/arrow-clockwise';

const props = defineProps<{ title?: string }>();
const message = ref<string | null>(null);

onErrorCaptured((error) => {
  message.value = error instanceof Error ? error.message : String(error);
  console.error(`[loupe/ui] ${props.title ?? '面板'} 渲染失败`, error);
  return false;
});
</script>

<template>
  <div v-if="message" class="boundary" role="alert">
    <div class="row">
      <IconWarningCircle class="boundary-icon" />
      <strong>{{ title ?? '这个面板出错了' }}</strong>
    </div>
    <p class="small muted">{{ message }}</p>
    <button type="button" class="btn btn-sm" @click="message = null">
      <IconArrowClockwise />
      重试
    </button>
  </div>
  <slot v-else />
</template>

<style scoped>
.boundary {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  align-items: flex-start;
  padding: var(--sp-3);
  background: var(--error-bg);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-1);
}

.boundary-icon {
  width: 16px;
  height: 16px;
  color: var(--error);
}

p {
  margin: 0;
  word-break: break-word;
}
</style>
