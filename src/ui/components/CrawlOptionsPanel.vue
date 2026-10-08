<script setup lang="ts">
/** 抓取选项：刷新方式与上限，改完立即持久化到 chrome.storage.local。 */
import { state, updateOptions } from '../store';
import type { RefreshMode } from '@/core/report';

const REFRESH_LABELS: Record<RefreshMode, string> = {
  'cache-first': '缓存优先',
  incremental: '增量重抓',
  full: '全量回源',
};

const REFRESH_HINTS: Record<RefreshMode, string> = {
  'cache-first': '有快照直接复用，不发请求',
  incremental: '重扫顶层，只补变化的评论树',
  full: '忽略缓存全部重新抓取',
};

function commitLimit(key: 'maxRoots' | 'maxRepliesPerThread', event: Event): void {
  const input = event.target as HTMLInputElement;
  const parsed = Number.parseInt(input.value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    input.value = String(state.options[key]);
    return;
  }
  updateOptions(key === 'maxRoots' ? { maxRoots: parsed } : { maxRepliesPerThread: parsed });
  input.value = String(state.options[key]);
}
</script>

<template>
  <div class="stack options">
    <div class="field">
      <label for="crawl-refresh">刷新方式</label>
      <select
        id="crawl-refresh"
        class="select"
        :value="state.options.refresh"
        @change="updateOptions({ refresh: ($event.target as HTMLSelectElement).value as RefreshMode })"
      >
        <option v-for="(text, value) in REFRESH_LABELS" :key="value" :value="value">{{ text }}</option>
      </select>
      <span class="hint">{{ REFRESH_HINTS[state.options.refresh] }}</span>
    </div>
    <div class="row">
      <div class="field grow">
        <label for="crawl-roots">顶层评论上限（0 = 不限）</label>
        <input
          id="crawl-roots"
          class="input tnum"
          type="number"
          min="0"
          step="100"
          :value="state.options.maxRoots"
          @change="commitLimit('maxRoots', $event)"
        />
      </div>
      <div class="field grow">
        <label for="crawl-replies">单棵树回复上限（0 = 不限）</label>
        <input
          id="crawl-replies"
          class="input tnum"
          type="number"
          min="0"
          step="100"
          :value="state.options.maxRepliesPerThread"
          @change="commitLimit('maxRepliesPerThread', $event)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.options {
  gap: var(--sp-3);
}
</style>
