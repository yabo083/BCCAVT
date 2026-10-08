<script setup lang="ts">
/** 评论探索：搜索（内容/作者）、排序、深度过滤，窗口化列表，点击即在评论树中定位。 */
import { computed, ref, watch } from 'vue';
import IconListMagnifyingGlass from '~icons/ph/list-magnifying-glass';
import CommentList from '../components/CommentList.vue';
import { DEFAULT_EXPLORE_QUERY, flattenForest, searchComments } from '../explore';
import type { DepthFilter, SortKey } from '../explore';
import { openComment, state } from '../store';
import { formatCount } from '../format';

const SORT_LABELS: Record<SortKey, string> = { likes: '按点赞', time: '按时间', replies: '按回复数' };
const DEPTH_LABELS: Record<DepthFilter, string> = { all: '全部深度', roots: '仅顶层', replies: '仅回复', deep: '深度 ≥ 2' };

const source = ref<'subject' | 'thread'>(state.subject ? 'subject' : 'thread');
const query = ref({ ...DEFAULT_EXPLORE_QUERY });
const list = ref<InstanceType<typeof CommentList> | null>(null);

const subjectItems = computed(() => (state.subject ? flattenForest(state.subject.forest) : []));
const threadItems = computed(() => (state.thread ? flattenForest(state.thread.forest) : []));
const items = computed(() => (source.value === 'thread' ? threadItems.value : subjectItems.value));
const filtered = computed(() => searchComments(items.value, query.value));

/** 在树里选中的评论，如果当前列表里能看到，就滚到它那一行。 */
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
      <div class="row wrap">
        <input
          v-model="query.text"
          class="input grow"
          type="search"
          placeholder="搜索评论内容或作者"
          aria-label="搜索评论"
        />
        <select v-model="query.sort" class="select" aria-label="排序方式">
          <option v-for="(text, value) in SORT_LABELS" :key="value" :value="value">{{ text }}</option>
        </select>
        <select v-model="query.depth" class="select" aria-label="深度过滤">
          <option v-for="(text, value) in DEPTH_LABELS" :key="value" :value="value">{{ text }}</option>
        </select>
      </div>
      <div class="row wrap small subtle tnum">
        <IconListMagnifyingGlass class="grow-icon" />
        <span>匹配 {{ formatCount(filtered.length) }} / {{ formatCount(items.length) }} 条</span>
        <span class="grow" />
        <span v-if="state.subject && state.thread" class="row segmented">
          <button type="button" class="btn btn-sm" :class="{ 'btn-tonal': source === 'subject' }" @click="source = 'subject'">
            全评论区
          </button>
          <button type="button" class="btn btn-sm" :class="{ 'btn-tonal': source === 'thread' }" @click="source = 'thread'">
            当前评论树
          </button>
        </span>
        <span class="hint">点击任意评论即在评论树中定位</span>
      </div>
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
}

.segmented {
  gap: 2px;
}

.grow-icon {
  width: 13px;
  height: 13px;
}
</style>
