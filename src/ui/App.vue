<script setup lang="ts">
/** 应用外壳：顶栏 + 视图切换 + 每个面板的错误边界 + 后台意图消费。 */
import { onBeforeUnmount, onMounted } from 'vue';
import type { Component } from 'vue';
import IconLinkSimple from '~icons/ph/link-simple';
import IconChartBar from '~icons/ph/chart-bar';
import IconTreeStructure from '~icons/ph/tree-structure';
import IconListMagnifyingGlass from '~icons/ph/list-magnifying-glass';
import IconSparkle from '~icons/ph/sparkle';
import IconClockCounterClockwise from '~icons/ph/clock-counter-clockwise';
import ErrorBoundary from './components/ErrorBoundary.vue';
import RunPanel from './components/RunPanel.vue';
import TopBar from './components/TopBar.vue';
import AiPanel from './views/AiPanel.vue';
import ExplorerView from './views/ExplorerView.vue';
import HistoryView from './views/HistoryView.vue';
import SubjectView from './views/SubjectView.vue';
import TargetView from './views/TargetView.vue';
import ThreadView from './views/ThreadView.vue';
import { consumeIntent, state } from './store';
import type { View } from './store';
import { INTENT_KEY } from '@/extension/messages';

interface Tab {
  id: View;
  label: string;
  icon: Component;
  enabled: () => boolean;
}

const tabs: Tab[] = [
  { id: 'target', label: '输入', icon: IconLinkSimple, enabled: () => true },
  { id: 'subject', label: '报告', icon: IconChartBar, enabled: () => state.subject !== null },
  { id: 'thread', label: '评论树', icon: IconTreeStructure, enabled: () => state.thread !== null },
  {
    id: 'explorer',
    label: '探索',
    icon: IconListMagnifyingGlass,
    enabled: () => state.subject !== null || state.thread !== null,
  },
  { id: 'ai', label: 'AI', icon: IconSparkle, enabled: () => true },
  { id: 'history', label: '历史', icon: IconClockCounterClockwise, enabled: () => true },
];

const VIEW_TITLES: Record<View, string> = {
  target: '输入面板',
  subject: '主体报告',
  thread: '评论树报告',
  explorer: '评论探索',
  ai: 'AI 解读',
  history: '历史与缓存',
};

function onStorageChanged(changes: Record<string, chrome.storage.StorageChange>, areaName: string): void {
  if (areaName !== 'session') return;
  const change = changes[INTENT_KEY];
  if (change) void consumeIntent(change.newValue);
}

onMounted(() => chrome.storage.onChanged.addListener(onStorageChanged));
onBeforeUnmount(() => chrome.storage.onChanged.removeListener(onStorageChanged));
</script>

<template>
  <div class="app" :class="state.wide ? 'wide' : 'panel'">
    <header class="app-header stack">
      <TopBar />
      <nav class="tabs" aria-label="视图切换">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="tab"
          :class="{ active: state.view === tab.id }"
          :disabled="!tab.enabled()"
          :aria-current="state.view === tab.id ? 'page' : undefined"
          @click="state.view = tab.id"
        >
          <component :is="tab.icon" />
          {{ tab.label }}
        </button>
      </nav>
    </header>

    <main class="app-body">
      <RunPanel />

      <p v-if="state.notice" class="notice" :class="`notice-${state.notice.tone}`" role="status">
        <span class="grow">{{ state.notice.text }}</span>
        <button type="button" class="btn btn-sm btn-ghost" @click="state.notice = null">关闭</button>
      </p>

      <div class="view-host" :class="{ fill: state.view === 'explorer' }">
        <ErrorBoundary :title="VIEW_TITLES[state.view]">
          <TargetView v-if="state.view === 'target'" />
          <SubjectView v-else-if="state.view === 'subject'" />
          <ThreadView v-else-if="state.view === 'thread'" />
          <ExplorerView v-else-if="state.view === 'explorer'" />
          <AiPanel v-else-if="state.view === 'ai'" />
          <HistoryView v-else />
        </ErrorBoundary>
      </div>
    </main>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.app.wide {
  max-width: 1680px;
  margin: 0 auto;
}

.app-header {
  gap: 0;
  padding: var(--sp-3) var(--sp-3) 0;
  background: var(--surface);
  box-shadow: var(--shadow-1);
  z-index: 2;
}

.app.wide .app-header {
  padding: var(--sp-4) var(--sp-4) 0;
}

.tabs {
  display: flex;
  gap: 2px;
  overflow-x: auto;
  scrollbar-width: none;
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  padding: 6px var(--sp-3);
  border: 0;
  border-radius: var(--r-sm) var(--r-sm) 0 0;
  background: transparent;
  color: var(--fg-muted);
  font-size: var(--fs-sm);
  cursor: pointer;
  white-space: nowrap;
}

.tab svg {
  width: 14px;
  height: 14px;
}

.tab:hover:not(:disabled) {
  background: var(--surface-2);
}

.tab.active {
  background: var(--accent-bg);
  color: var(--fg);
  font-weight: 600;
  box-shadow: inset 0 -2px 0 var(--accent);
}

.tab:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.app-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding: var(--sp-3);
}

.app.wide .app-body {
  padding: var(--sp-4);
}

.view-host {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
}

.view-host.fill {
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.notice {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: 0;
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-sm);
  font-size: var(--fs-sm);
  background: var(--info-bg);
  color: var(--info);
}

.notice-error {
  background: var(--error-bg);
  color: var(--error);
}
</style>
