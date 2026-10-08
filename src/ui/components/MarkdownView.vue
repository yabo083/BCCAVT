<script setup lang="ts">
/** 最小 Markdown 视图（标题/段落/列表/粗体/行内代码 + 评论引用芯片）。 */
import { computed } from 'vue';
import InlineText from './InlineText.vue';
import { parseMarkdown } from '../markdown';

const props = defineProps<{ markdown: string; labelOf?: (commentId: string) => string | undefined }>();
const emit = defineEmits<{ 'open-comment': [id: string] }>();

/** 归一化成「标签 + 内联 + 列表项」，模板里就不需要判别联合类型。 */
const blocks = computed(() =>
  parseMarkdown(props.markdown).map((block) => ({
    tag: block.kind === 'heading' ? `h${block.level + 2}` : block.kind === 'list' ? (block.ordered ? 'ol' : 'ul') : 'p',
    inline: block.kind === 'list' ? [] : block.inline,
    items: block.kind === 'list' ? block.items : [],
  })),
);
</script>

<template>
  <div class="md">
    <component :is="block.tag" v-for="(block, i) in blocks" :key="i">
      <template v-if="block.items.length">
        <li v-for="(item, j) in block.items" :key="j">
          <InlineText :inline="item" :label-of="props.labelOf" @open-comment="emit('open-comment', $event)" />
        </li>
      </template>
      <InlineText v-else :inline="block.inline" :label-of="props.labelOf" @open-comment="emit('open-comment', $event)" />
    </component>
  </div>
</template>

<style scoped>
.md {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  font-size: var(--fs-md);
  line-height: var(--lh-normal);
  word-break: break-word;
}

.md :is(h3, h4, h5) {
  font-size: var(--fs-md);
  font-weight: 600;
  color: var(--fg);
}

.md :is(h3, h4, h5):not(:first-child) {
  margin-top: var(--sp-2);
}

.md p {
  margin: 0;
  white-space: pre-wrap;
}

.md :is(ul, ol) {
  margin: 0;
  padding-left: 1.4em;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.md code {
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  padding: 0 4px;
  border-radius: var(--r-xs);
  background: var(--surface-2);
}
</style>
