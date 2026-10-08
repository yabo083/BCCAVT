<script setup lang="ts">
/** 评论行：作者/时间/点赞/属地 + 文本（最多 3 行）+ 可选的「分析此评论树」。 */
import IconTreeStructure from '~icons/ph/tree-structure';
import IconThumbsUp from '~icons/ph/thumbs-up';
import IconMapPin from '~icons/ph/map-pin';
import IconArrowBendDownRight from '~icons/ph/arrow-bend-down-right';
import AuthorChip from './AuthorChip.vue';
import { formatCount, formatRelative } from '../format';
import type { Comment } from '@/core/model';

const props = withDefaults(
  defineProps<{ comment: Comment; depth?: number; replies?: number; selected?: boolean; threadAction?: boolean }>(),
  { depth: 0, selected: false, threadAction: false },
);

const emit = defineEmits<{ select: [id: string]; 'open-thread': [id: string] }>();
</script>

<template>
  <article
    class="comment"
    :class="{ selected: props.selected }"
    tabindex="0"
    @click="emit('select', props.comment.id)"
    @keydown.enter.prevent="emit('select', props.comment.id)"
  >
    <header class="row wrap head">
      <AuthorChip :author="props.comment.author" />
      <span class="subtle small tnum">{{ formatRelative(props.comment.createdAt) }}</span>
      <span v-if="props.comment.pinned" class="chip chip-info">置顶</span>
      <span v-if="props.comment.byCreator" class="chip chip-accent">UP 主</span>
      <span v-if="props.depth > 0" class="chip tnum">深度 {{ props.depth }}</span>
      <span class="grow" />
      <span v-if="props.comment.location" class="chip">
        <IconMapPin />
        {{ props.comment.location.replace(/^IP属地[:：]/, '') }}
      </span>
      <span class="chip tnum">
        <IconThumbsUp />
        {{ formatCount(props.comment.likes) }}
      </span>
    </header>

    <p class="text">{{ props.comment.text }}</p>

    <footer v-if="props.threadAction || (props.replies ?? 0) > 0" class="row wrap foot">
      <span v-if="(props.replies ?? 0) > 0" class="chip tnum">
        <IconArrowBendDownRight />
        回复 {{ formatCount(props.replies ?? 0) }}
      </span>
      <span class="grow" />
      <button v-if="props.threadAction" type="button" class="btn btn-sm btn-tonal" @click.stop="emit('open-thread', props.comment.id)">
        <IconTreeStructure />
        分析此评论树
      </button>
    </footer>
  </article>
</template>

<style scoped>
.comment {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  width: 100%;
  min-width: 0;
  overflow: hidden;
  padding: var(--sp-2) var(--sp-3);
  background: var(--surface);
  border-radius: var(--r-sm);
  box-shadow: var(--shadow-1);
  transition: background var(--dur-fast) ease;
  cursor: pointer;
}

.comment:hover {
  background: var(--surface-2);
}

.comment.selected {
  background: var(--accent-bg);
  box-shadow: inset 0 0 0 1px var(--accent-border);
}

.head,
.foot {
  gap: var(--sp-2);
}

.text {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-normal);
  white-space: pre-wrap;
  word-break: break-word;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
}
</style>
