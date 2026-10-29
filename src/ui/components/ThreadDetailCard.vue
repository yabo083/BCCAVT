<script setup lang="ts">
/** 选中评论的详情：全文、作者、回复关系、从根到这里的路径、立场/谬误标注、子树折叠。 */
import { computed, nextTick, ref, watch } from 'vue';
import IconArrowBendDownRight from '~icons/ph/arrow-bend-down-right';
import IconArrowsIn from '~icons/ph/arrows-in';
import IconArrowsOut from '~icons/ph/arrows-out';
import IconCaretRight from '~icons/ph/caret-right';
import IconFlag from '~icons/ph/flag';
import IconMapPin from '~icons/ph/map-pin';
import AuthorChip from './AuthorChip.vue';
import CommentText from './CommentText.vue';
import StanceLegend from './StanceLegend.vue';
import { formatCount, formatDateTime } from '../format';
import type { CommentNode } from '@/core/report';
import type { FallacyNote, ThreadDiagnosis } from '@/ai/types';

const props = defineProps<{
  node: CommentNode | null;
  focusId?: string | null;
  diagnosis?: ThreadDiagnosis | null;
  collapsed?: boolean;
  canCollapse?: boolean;
  /**
   * 这条评论所在的主体是 B 站视频、且当前窗口有对应的视频页评论区可去（图谱窗口只画图，没有）。
   * 由外层判断：卡片不认识 store 与承载面，只负责显示与报告点击。
   */
  locatable?: boolean;
}>();

const emit = defineEmits<{
  select: [id: string];
  'toggle-collapse': [id: string];
  locate: [id: string];
}>();

/** 从根到这里的路径，顺带带上每一步的立场下标，用于给链路染色。 */
const path = computed(() => {
  const chain: { node: CommentNode; stance: number | null }[] = [];
  for (let current = props.node; current; current = current.parent) {
    chain.push({ node: current, stance: props.diagnosis?.stanceOf[current.comment.id] ?? null });
  }
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

/**
 * 换选时重播一次入场（原型 `detail-deck-body-anim` 的手法）。
 * 手法是「先摘类 → `void offsetWidth` 强制重排 → 再挂回」：连续换选时这个元素既不重建、类名也不变，
 * 浏览器认为动画没变、绝不重播；只有摘掉旧类并读一次几何让这次改动算进渲染，再挂回去才会从头播。
 */
const rootEl = ref<HTMLElement | null>(null);

watch(
  () => props.node?.comment.id,
  async () => {
    // 「空态 ↔ 有选中」会让根节点被 v-if 重建，等它进 DOM 再动类（首次出现靠模板里那个类自己入场）。
    await nextTick();
    const el = rootEl.value;
    if (!el) return;
    el.classList.remove('detail-reveal');
    void el.offsetWidth;
    el.classList.add('detail-reveal');
  },
);
</script>

<template>
  <div v-if="props.node" ref="rootEl" class="detail stack detail-reveal">
    <header class="stack">
      <AuthorChip :author="props.node.comment.author" :meta="formatDateTime(props.node.comment.createdAt)" />
      <div class="row wrap small subtle tnum">
        <span class="chip tnum">深度 {{ props.node.depth }}</span>
        <span class="chip tnum">子树 {{ formatCount(props.node.size) }} 条</span>
        <span class="chip tnum">赞 {{ formatCount(props.node.comment.likes) }}</span>
        <span v-if="props.node.comment.location" class="chip">{{ props.node.comment.location }}</span>
      </div>
      <div class="row wrap rel">
        <template v-if="props.node.parent && props.node.comment.id !== props.focusId">
          <IconArrowBendDownRight class="rel-icon" />
          <span class="small subtle">回复</span>
          <button
            type="button"
            class="chip path-step"
            @click="emit('select', props.node.parent.comment.id)"
          >
            {{ props.node.parent.comment.author.name }}
          </button>
        </template>
        <span v-else class="chip chip-accent">分析根</span>
      </div>
      <button
        v-if="props.locatable"
        type="button"
        class="btn btn-sm"
        title="在 B 站视频页的评论区定位这条评论"
        aria-label="在评论区定位这条评论"
        @click="emit('locate', props.node.comment.id)"
      >
        <IconMapPin />
        在评论区定位
      </button>
    </header>

    <p class="body"><CommentText :text="props.node.comment.text" :emotes="props.node.comment.emotes" /></p>

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
        <template v-for="(step, i) in path" :key="step.node.comment.id">
          <IconCaretRight v-if="i > 0" class="caret" />
          <button
            type="button"
            class="chip path-step"
            :class="{ current: step.node.comment.id === props.node.comment.id }"
            @click="emit('select', step.node.comment.id)"
          >
            <span
              v-if="step.stance !== null"
              class="dot"
              :style="{ background: `var(--c${(step.stance % 6) + 1})` }"
              aria-hidden="true"
            />
            {{ step.node.comment.author.name }}
          </button>
        </template>
      </div>
    </section>

    <button
      v-if="props.canCollapse && props.node.children.length"
      type="button"
      class="btn btn-sm"
      @click="emit('toggle-collapse', props.node.comment.id)"
    >
      <IconArrowsOut v-if="props.collapsed" />
      <IconArrowsIn v-else />
      {{ props.collapsed ? `展开 ${formatCount(props.node.size - 1)} 条回复` : '折叠该子树' }}
    </button>
  </div>
  <p v-else class="empty">在评论树里点一个节点，这里显示它的全文、回复关系与上下文。</p>
</template>

<style scoped>
.detail {
  gap: var(--sp-3);
}

/* 换选/展开时的入场（原型 detail-reveal 逐字：240ms 是原型取值，没有对应时长令牌）。
   类由 watch 在换选时摘掉重挂，好让同一个元素上的动画重播；节点重建时它自然入场，两处只跑一套。 */
.detail-reveal {
  animation: detail-reveal 240ms var(--ease-emphasized-decelerate) both;
}

@keyframes detail-reveal {
  from {
    opacity: 0;
    transform: translateX(10px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
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

.rel {
  gap: var(--sp-1);
}

.rel-icon {
  width: 13px;
  height: 13px;
  color: var(--fg-subtle);
}

.path {
  gap: 2px;
}

.path-step {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  border: 0;
  cursor: pointer;
  font-size: var(--fs-xs);
}

.path-step.current {
  background: var(--accent-bg);
  color: var(--accent-strong);
  /* 与 rail 激活态同一套：底色 + inset 细描边（原型 .rail-tab-btn.active L1064-1068 / .filter-pill.active L540-544）。
     浅色下把当前这条从白玻璃上框出来；深色下 --accent-bg 单靠自己几乎看不出块，靠 --accent-border 定形。 */
  box-shadow: inset 0 0 0 1px var(--accent-border);
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: var(--r-pill);
}

.caret {
  width: 12px;
  height: 12px;
  color: var(--fg-subtle);
}
</style>
