<script setup lang="ts">
/**
 * 评论探索：搜索（内容/作者）、排序、深度过滤，窗口化列表，点击即在画布上定位该节点。
 * 列表数据源（全评论区 / 当前评论树）会同步给外层画布，避免「列表里点了一条，画布上却找不到」。
 */
import { computed, ref, watch } from 'vue';
import IconListMagnifyingGlass from '~icons/ph/list-magnifying-glass';
import CommentList from '../components/CommentList.vue';
import { DEFAULT_EXPLORE_QUERY, flattenForest, searchComments } from '../explore';
import type { DepthFilter, SortKey } from '../explore';
import { openComment, state } from '../store';
import { formatCount } from '../format';

const SORT_LABELS: Record<SortKey, string> = { likes: '按点赞', time: '按时间', replies: '按回复数' };
const DEPTH_LABELS: Record<DepthFilter, string> = { all: '全部深度', roots: '仅顶层', replies: '仅回复', deep: '深度 ≥ 2' };

const emit = defineEmits<{ 'source-change': [source: 'subject' | 'thread'] }>();

const source = ref<'subject' | 'thread'>(state.subject ? 'subject' : 'thread');
const query = ref({ ...DEFAULT_EXPLORE_QUERY });
const list = ref<InstanceType<typeof CommentList> | null>(null);

const subjectItems = computed(() => (state.subject ? flattenForest(state.subject.forest) : []));
const threadItems = computed(() => (state.thread ? flattenForest(state.thread.forest) : []));
const items = computed(() => (source.value === 'thread' ? threadItems.value : subjectItems.value));
const filtered = computed(() => searchComments(items.value, query.value));

watch(source, (next) => emit('source-change', next));

/** 在画布上选中的评论，如果当前列表里能看到，就滚到它那一行。 */
watch(
  () => state.selectedCommentId,
  (id) => {
    if (id && filtered.value.some((item) => item.comment.id === id)) list.value?.scrollToId(id);
  },
);
</script>

<template>
  <div class="explorer">
    <section class="card stack">
      <input
        v-model="query.text"
        class="input"
        type="search"
        placeholder="搜索评论内容或作者"
        aria-label="搜索评论"
      />
      <div class="row wrap">
        <select v-model="query.sort" class="select grow" aria-label="排序方式">
          <option v-for="(text, value) in SORT_LABELS" :key="value" :value="value">{{ text }}</option>
        </select>
        <select v-model="query.depth" class="select grow" aria-label="深度过滤">
          <option v-for="(text, value) in DEPTH_LABELS" :key="value" :value="value">{{ text }}</option>
        </select>
      </div>
      <div v-if="state.subject && state.thread" class="segmented" role="group" aria-label="列表数据源">
        <button
          type="button"
          class="segment"
          :class="{ active: source === 'subject' }"
          :aria-pressed="source === 'subject'"
          @click="source = 'subject'"
        >
          全评论区
        </button>
        <button
          type="button"
          class="segment"
          :class="{ active: source === 'thread' }"
          :aria-pressed="source === 'thread'"
          @click="source = 'thread'"
        >
          当前评论树
        </button>
      </div>
      <p class="row small subtle tnum count">
        <IconListMagnifyingGlass class="grow-icon" />
        <span>匹配 {{ formatCount(filtered.length) }} / {{ formatCount(items.length) }} 条</span>
      </p>
    </section>

    <section class="card list-card">
      <CommentList
        ref="list"
        :items="filtered"
        :selected-id="state.selectedCommentId"
        empty-text="没有匹配的评论，换个关键词或放宽深度过滤。"
        @select="openComment"
        @open-thread="openComment"
      />
    </section>
  </div>
</template>

<style scoped>
.explorer {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  flex: 1;
  min-height: 0;
}

.list-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: var(--sp-2);
}

.count {
  gap: var(--sp-2);
}

.grow-icon {
  width: 13px;
  height: 13px;
}

.segmented {
  display: inline-flex;
  padding: 2px;
  border-radius: var(--r-sm);
  background: var(--surface-2);
}

.segment {
  flex: 1;
  border: 0;
  padding: 4px var(--sp-2);
  border-radius: calc(var(--r-sm) - 2px);
  background: transparent;
  color: var(--fg-muted);
  font-size: var(--fs-sm);
  cursor: pointer;
}

.segment:hover {
  color: var(--fg);
}

.segment.active {
  background: var(--surface);
  color: var(--fg);
  font-weight: 600;
  box-shadow: var(--shadow-1);
}
</style>
