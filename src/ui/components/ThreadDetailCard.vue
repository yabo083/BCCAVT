<script setup lang="ts">
/** 选中评论的详情：全文、从根到这里的路径、立场/谬误标注、子树折叠。 */
import { computed } from 'vue';
import IconTreeStructure from '~icons/ph/tree-structure';
import IconCaretRight from '~icons/ph/caret-right';
import IconFlag from '~icons/ph/flag';
import AuthorChip from './AuthorChip.vue';
import StanceLegend from './StanceLegend.vue';
import { formatCount, formatDateTime } from '../format';
import type { CommentNode } from '@/core/report';
import type { FallacyNote, ThreadDiagnosis } from '@/ai/types';

const props = defineProps<{
  node: CommentNode | null;
  focusId?: string | null;
  diagnosis?: ThreadDiagnosis | null;
  collapsed?: boolean;
}>();

const emit = defineEmits<{ select: [id: string]; 'toggle-collapse': [id: string] }>();

const path = computed<CommentNode[]>(() => {
  const chain: CommentNode[] = [];
  for (let current = props.node; current; current = current.parent) chain.push(current);
  return chain.reverse();
});

const fallacies = computed<FallacyNote[]>(() => {
  const id = props.node?.comment.id;
  return props.diagnosis && id ? props.diagnosis.fallacies.filter((note) => note.commentId === id) : [];
});

const stanceIndex = computed<number | null>(() => {
  const id = props.node?.comment.id;
  const diagnosis = props.diagnosis;
  if (!id || !diagnosis) return null;
  return diagnosis.stanceOf[id] ?? null;
});
</script>

<template>
  <div v-if="props.node" class="detail stack">
    <header class="stack">
      <AuthorChip :author="props.node.comment.author" :meta="formatDateTime(props.node.comment.createdAt)" />
      <div class="row wrap small subtle tnum">
        <span class="chip tnum">深度 {{ props.node.depth }}</span>
        <span class="chip tnum">子树 {{ formatCount(props.node.size) }} 条</span>
        <span class="chip tnum">赞 {{ formatCount(props.node.comment.likes) }}</span>
        <span v-if="props.node.comment.location" class="chip">{{ props.node.comment.location }}</span>
      </div>
    </header>

    <p class="body">{{ props.node.comment.text }}</p>

    <div v-if="stanceIndex !== null && props.diagnosis" class="row wrap">
      <span class="small subtle">立场</span>
      <StanceLegend :stances="[props.diagnosis.stances[stanceIndex]!]" />
      <span v-if="props.diagnosis.turningPoints.includes(props.node.comment.id)" class="chip chip-warning">
        <IconFlag />
        讨论转折点
      </span>
    </div>

    <ul v-if="fallacies.length" class="notes stack">
      <li v-for="note in fallacies" :key="note.type + note.note" class="note">
        <span class="chip chip-warning">{{ note.type }}</span>
        <span class="small">{{ note.note }}</span>
      </li>
    </ul>

    <section v-if="path.length > 1" class="stack">
      <span class="small subtle">从根到这里的路径</span>
      <div class="row wrap path">
        <template v-for="(step, i) in path" :key="step.comment.id">
          <IconCaretRight v-if="i > 0" class="caret" />
          <button
            type="button"
            class="chip path-step"
            :class="{ current: step.comment.id === props.node.comment.id }"
            @click="emit('select', step.comment.id)"
          >
            {{ step.comment.author.name }}
          </button>
        </template>
      </div>
    </section>

    <button
      v-if="props.node.children.length"
      type="button"
      class="btn btn-sm"
      @click="emit('toggle-collapse', props.node.comment.id)"
    >
      <IconTreeStructure />
      {{ props.collapsed ? `展开 ${props.node.children.length} 条回复` : '折叠该子树' }}
    </button>
  </div>
  <p v-else class="empty">在右侧树上点击一个节点，这里显示评论全文与上下文。</p>
</template>

<style scoped>
.detail {
  gap: var(--sp-3);
}

.body {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: var(--fs-md);
  background: var(--surface-2);
  border-radius: var(--r-sm);
  padding: var(--sp-2) var(--sp-3);
}

.notes {
  list-style: none;
  margin: 0;
  padding: 0;
}

.note {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2);
}

.path {
  gap: 2px;
}

.path-step {
  border: 0;
  cursor: pointer;
  font-size: var(--fs-xs);
}

.path-step.current {
  background: var(--accent-bg);
  color: var(--accent-strong);
}

.caret {
  width: 12px;
  height: 12px;
  color: var(--fg-subtle);
}
</style>
