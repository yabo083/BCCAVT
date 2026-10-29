<script setup lang="ts">
/** 抓取选项：刷新方式与上限，改完立即持久化到 chrome.storage.local。 */
import { state, updateOptions } from '../store';
import { REFRESH_MODE_HINTS, REFRESH_MODE_LABELS } from '../prefs';
import type { RefreshMode } from '@/core/report';

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
  <!-- 紧凑网格：刷新方式独占一行（它带一句会变的解释），两个上限并排。
       解释一律进 title，正文只留标签与值——面板默认收在「输入」tab 的折叠摘要里。 -->
  <div class="options">
    <div class="field full">
      <label for="crawl-refresh">刷新方式</label>
      <select
        id="crawl-refresh"
        class="select"
        :value="state.options.refresh"
        :title="REFRESH_MODE_HINTS[state.options.refresh]"
        @change="updateOptions({ refresh: ($event.target as HTMLSelectElement).value as RefreshMode })"
      >
        <option v-for="(text, value) in REFRESH_MODE_LABELS" :key="value" :value="value">{{ text }}</option>
      </select>
    </div>
    <div class="field">
      <label for="crawl-roots" title="顶层评论抓多少条，0 = 不限">顶层上限</label>
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
    <div class="field">
      <label for="crawl-replies" title="每棵评论树抓多少条回复，0 = 不限">单树回复</label>
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
</template>

<style scoped>
.options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-2) var(--sp-3);
  padding: var(--sp-1) 0 var(--sp-2);
}

.options .full {
  grid-column: 1 / -1;
}

/* 网格里的字段：标签更小、控件更矮，整块比原来的三行表单矮一半以上。 */
.options :deep(.field > label) {
  font-size: var(--fs-xs);
  color: var(--fg-subtle);
}

.options :deep(.input),
.options :deep(.select) {
  min-height: 28px;
  padding: 2px var(--sp-2);
  font-size: var(--fs-sm);
}
</style>
