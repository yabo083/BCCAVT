<script setup lang="ts">
/** 渲染 Inline token；bold 递归自身。整棵链路上没有任何 innerHTML。 */
import IconChatCircleText from '~icons/ph/chat-circle-text';
import type { Inline } from '../markdown';

const props = defineProps<{ inline: Inline[]; labelOf?: (commentId: string) => string | undefined }>();
const emit = defineEmits<{ 'open-comment': [id: string] }>();
</script>

<template>
  <template v-for="(node, i) in props.inline" :key="i">
    <strong v-if="node.kind === 'bold'">
      <InlineText :inline="node.children" :label-of="props.labelOf" @open-comment="emit('open-comment', $event)" />
    </strong>
    <code v-else-if="node.kind === 'code'">{{ node.text }}</code>
    <button
      v-else-if="node.kind === 'chip'"
      type="button"
      class="chip chip-accent ref-chip"
      :title="`跳转到评论 ${node.commentId}`"
      @click="emit('open-comment', node.commentId)"
    >
      <IconChatCircleText />
      {{ props.labelOf?.(node.commentId) ?? `评论 ${node.commentId.slice(-4)}` }}
    </button>
    <template v-else>{{ node.text }}</template>
  </template>
</template>

<style scoped>
.ref-chip {
  margin: 0 2px;
  border: 0;
  cursor: pointer;
  font-size: var(--fs-xs);
  vertical-align: baseline;
}
</style>
