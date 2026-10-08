<script setup lang="ts">
/** 评论列表（窗口化）。行高固定，文本最多 3 行，保证 10k+ 条也顺滑。 */
import { ref } from 'vue';
import VirtualList from './VirtualList.vue';
import CommentRow from './CommentRow.vue';
import type { CommentListItem } from '../explore';

const props = withDefaults(
  defineProps<{
    items: CommentListItem[];
    itemHeight?: number;
    selectedId?: string | null;
    threadAction?: boolean;
    emptyText?: string;
  }>(),
  { itemHeight: 118, selectedId: null, threadAction: false },
);

const emit = defineEmits<{ select: [id: string]; 'open-thread': [id: string] }>();
const list = ref<InstanceType<typeof VirtualList> | null>(null);

defineExpose({
  scrollToId(id: string): void {
    const index = props.items.findIndex((item) => item.comment.id === id);
    if (index >= 0) list.value?.scrollToIndex(index);
  },
});
</script>

<template>
  <VirtualList v-if="props.items.length" ref="list" :count="props.items.length" :item-height="props.itemHeight">
    <template #default="{ index }">
      <CommentRow
        :comment="props.items[index]!.comment"
        :depth="props.items[index]!.depth"
        :replies="props.items[index]!.replies"
        :selected="props.items[index]!.comment.id === props.selectedId"
        :thread-action="props.threadAction"
        @select="emit('select', $event)"
        @open-thread="emit('open-thread', $event)"
      />
    </template>
  </VirtualList>
  <p v-else class="empty">{{ props.emptyText ?? '没有匹配的评论' }}</p>
</template>
