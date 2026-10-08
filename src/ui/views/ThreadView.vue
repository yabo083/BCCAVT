<script setup lang="ts">
/** 评论树报告：Canvas 树 + 详情卡 + 参与作者/交锋/最长链/关键词/时间分布。 */
import { computed, ref, watch } from 'vue';
import IconSparkle from '~icons/ph/sparkle';
import IconArrowClockwise from '~icons/ph/arrow-clockwise';
import IconUsers from '~icons/ph/users';
import IconShareNetwork from '~icons/ph/share-network';
import IconChatCircleText from '~icons/ph/chat-circle-text';
import IconChartBar from '~icons/ph/chart-bar';
import AuthorChip from '../components/AuthorChip.vue';
import BarList from '../components/BarList.vue';
import CommentRow from '../components/CommentRow.vue';
import CompletenessBadge from '../components/CompletenessBadge.vue';
import ErrorBoundary from '../components/ErrorBoundary.vue';
import StanceLegend from '../components/StanceLegend.vue';
import ThreadCanvas from '../components/ThreadCanvas.vue';
import ThreadDetailCard from '../components/ThreadDetailCard.vue';
import TimelineChart from '../components/TimelineChart.vue';
import { diagnoseThread, startThread, state } from '../store';
import { formatCount, formatDateTime } from '../format';
import type { CommentNode } from '@/core/report';

const result = computed(() => state.thread);
const report = computed(() => result.value?.report ?? null);
const snapshot = computed(() => result.value?.snapshot ?? null);

const collapsedIds = ref<ReadonlySet<string>>(new Set<string>());
const selectedNode = computed<CommentNode | null>(() =>
  state.selectedCommentId ? result.value?.forest.byId.get(state.selectedCommentId) ?? null : null,
);

function toggleCollapse(id: string): void {
  const next = new Set(collapsedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  collapsedIds.value = next;
}

function collapseAll(): void {
  const rootId = result.value?.snapshot.rootId;
  const next = new Set<string>();
  for (const node of result.value?.forest.byId.values() ?? []) {
    if (node.children.length && node.comment.id !== rootId) next.add(node.comment.id);
  }
  collapsedIds.value = next;
}

function select(id: string): void {
  state.selectedCommentId = id;
}

/** 从别处跳过来的评论：把它的祖先链展开，保证可见。 */
watch(
  () => [state.selectedCommentId, result.value?.snapshot.id] as const,
  () => {
    const node = selectedNode.value;
    if (!node) return;
    const ancestors: string[] = [];
    for (let current = node.parent; current; current = current.parent) ancestors.push(current.comment.id);
    if (!ancestors.some((id) => collapsedIds.value.has(id))) return;
    const next = new Set(collapsedIds.value);
    for (const id of ancestors) next.delete(id);
    collapsedIds.value = next;
  },
  { immediate: true },
);

watch(
  () => result.value?.snapshot.id,
  () => {
    collapsedIds.value = new Set<string>();
  },
);

function openDiagnosis(): void {
  state.view = 'ai';
  void diagnoseThread();
}
</script>

<template>
  <div v-if="!result || !report || !snapshot" class="empty">还没有评论树报告，输入带评论的链接或在报告里点「分析此评论树」。</div>

  <div v-else class="stack view">
    <section class="card stack">
      <div class="row between wrap">
        <div class="stack grow">
          <div class="row wrap small subtle">
            <span class="chip chip-accent">评论树</span>
            <span class="tnum">根评论 {{ report.root.id }}</span>
            <span v-if="report.focusId !== report.root.id" class="tnum">定位到 {{ report.focusId }}</span>
          </div>
          <AuthorChip :author="report.root.author" :meta="formatDateTime(report.root.createdAt)" />
          <p class="root-text">{{ report.root.text }}</p>
        </div>
        <div class="stack">
          <CompletenessBadge :completeness="snapshot.completeness" />
          <span class="chip tnum">共 {{ formatCount(report.overview.total) }} 条 · 深 {{ report.overview.maxDepth }}</span>
          <span class="chip tnum">{{ formatCount(report.overview.authors) }} 人参与</span>
        </div>
      </div>
      <div class="row wrap">
        <button type="button" class="btn" :disabled="!!state.run" @click="startThread(report.focusId)">
          <IconArrowClockwise />
          重新抓取
        </button>
        <button type="button" class="btn btn-tonal" :disabled="!!state.ai.busy" @click="openDiagnosis">
          <IconSparkle />
          诊断讨论
        </button>
        <span v-if="state.diagnosis" class="chip chip-info">已诊断 · {{ state.diagnosis.model }}</span>
        <StanceLegend v-if="state.diagnosis" :stances="state.diagnosis.stances" />
      </div>
    </section>

    <div class="columns">
      <section class="card stack canvas-card">
        <ErrorBoundary title="评论树">
          <ThreadCanvas
            :forest="result.forest"
            :root-id="snapshot.rootId ?? report.root.id"
            :focus-id="report.focusId"
            :selected-id="state.selectedCommentId"
            :diagnosis="state.diagnosis"
            :collapsed="collapsedIds"
            @select="select"
            @toggle-collapse="toggleCollapse"
            @collapse-all="collapseAll"
            @expand-all="collapsedIds = new Set<string>()"
          />
        </ErrorBoundary>
      </section>

      <div class="stack column">
        <section class="card">
          <ThreadDetailCard
            :node="selectedNode"
            :focus-id="report.focusId"
            :diagnosis="state.diagnosis"
            :collapsed="selectedNode ? collapsedIds.has(selectedNode.comment.id) : false"
            @select="select"
            @toggle-collapse="toggleCollapse"
          />
        </section>

        <section class="card stack">
          <div class="card-head"><h2 class="card-title"><IconChatCircleText /> 最长回复链</h2></div>
          <div class="stack">
            <CommentRow
              v-for="comment in report.longestChain"
              :key="comment.id"
              :comment="comment"
              :depth="result.forest.byId.get(comment.id)?.depth ?? 0"
              :selected="comment.id === state.selectedCommentId"
              @select="select"
            />
          </div>
        </section>

        <section class="card stack">
          <div class="card-head"><h2 class="card-title"><IconUsers /> 参与作者</h2></div>
          <ol class="authors">
            <li v-for="stat in report.participants" :key="stat.author.id">
              <AuthorChip :author="stat.author" />
              <span class="grow" />
              <span class="small subtle tnum">{{ formatCount(stat.comments) }} 条 · {{ formatCount(stat.likes) }} 赞</span>
            </li>
          </ol>
        </section>

        <section v-if="report.exchanges.length" class="card stack">
          <div class="card-head"><h2 class="card-title"><IconShareNetwork /> 交锋</h2></div>
          <ol class="authors">
            <li v-for="exchange in report.exchanges" :key="exchange.a.id + exchange.b.id">
              <AuthorChip :author="exchange.a" />
              <span class="subtle small">与</span>
              <AuthorChip :author="exchange.b" />
              <span class="grow" />
              <span class="small subtle tnum">{{ formatCount(exchange.turns) }} 回合</span>
            </li>
          </ol>
        </section>

        <section class="card stack">
          <div class="card-head"><h2 class="card-title"><IconChartBar /> 关键词</h2></div>
          <BarList :items="report.keywords" :limit="8" />
        </section>

        <section class="card stack">
          <div class="card-head"><h2 class="card-title"><IconChartBar /> 时间分布</h2></div>
          <TimelineChart :timeline="report.timeline" />
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.view {
  gap: var(--sp-3);
}

.root-text {
  margin: 0;
  font-size: var(--fs-sm);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 5.2em;
  overflow: hidden;
}

.columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--sp-3);
  align-items: start;
}

@media (min-width: 720px) {
  .columns {
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  }
}

.canvas-card {
  min-height: 420px;
}

@media (min-width: 720px) {
  .canvas-card {
    min-height: 620px;
  }
}

.authors {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.authors li {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
</style>
