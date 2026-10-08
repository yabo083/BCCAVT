<script setup lang="ts">
/** 历史快照与缓存：打开/删除快照，查看命中统计与占用，确认后清空缓存。 */
import { computed, onMounted, ref } from 'vue';
import IconClockCounterClockwise from '~icons/ph/clock-counter-clockwise';
import IconTrash from '~icons/ph/trash';
import IconBroom from '~icons/ph/broom';
import IconArrowClockwise from '~icons/ph/arrow-clockwise';
import IconDatabase from '~icons/ph/database';
import IconWarningCircle from '~icons/ph/warning-circle';
import { clearCache, deleteSnapshot, openSnapshot, refreshHistory, state } from '../store';
import { workbench } from '../services';
import { formatBytes, formatCount, formatRelative } from '../format';
import type { CacheStats } from '@/core/cache/types';

const usage = ref<{ entries: number; bytes: number } | null>(null);
const stats = ref<CacheStats | null>(null);
const pending = ref<string | null>(null);

const cacheRows = computed(() => {
  const value = stats.value;
  if (!value) return [];
  return [
    { label: '内存命中 / 未命中', value: `${formatCount(value.memory.hits)} / ${formatCount(value.memory.misses)}` },
    { label: '磁盘命中 / 未命中', value: `${formatCount(value.disk.hits)} / ${formatCount(value.disk.misses)}` },
    { label: '回源次数', value: formatCount(value.loads) },
    { label: '并发合并', value: formatCount(value.coalesced) },
    { label: '降级回源', value: formatCount(value.degraded) },
  ];
});

async function refreshCache(): Promise<void> {
  stats.value = workbench.cacheStats();
  usage.value = await workbench.cacheUsage();
}

async function confirmDelete(id: string): Promise<void> {
  pending.value = null;
  await deleteSnapshot(id);
  await refreshCache();
}

async function confirmClear(): Promise<void> {
  pending.value = null;
  await clearCache();
  await refreshCache();
}

onMounted(async () => {
  await refreshHistory();
  await refreshCache();
});
</script>

<template>
  <div class="stack view">
    <section class="card stack">
      <div class="card-head">
        <h2 class="card-title"><IconClockCounterClockwise /> 历史快照</h2>
        <button type="button" class="btn btn-sm btn-ghost" @click="refreshHistory">
          <IconArrowClockwise />
          刷新
        </button>
      </div>

      <ul v-if="state.history.length" class="list">
        <li v-for="item in state.history" :key="item.id" class="row wrap entry">
          <button type="button" class="grow title" :title="item.target.kind === 'thread' ? '评论树快照' : '评论区快照'" @click="openSnapshot(item.id)">
            {{ item.title }}
          </button>
          <span v-if="item.truncated" class="chip chip-warning">不完整</span>
          <span class="chip tnum">{{ formatCount(item.commentCount) }} 条</span>
          <span class="small subtle tnum">{{ formatRelative(item.fetchedAt) }}</span>
          <template v-if="pending === item.id">
            <span class="small confirm-text">删除这条快照？</span>
            <button type="button" class="btn btn-sm btn-danger" @click="confirmDelete(item.id)">确认</button>
            <button type="button" class="btn btn-sm btn-ghost" @click="pending = null">取消</button>
          </template>
          <button v-else type="button" class="btn btn-sm btn-ghost" title="删除快照" @click="pending = item.id">
            <IconTrash />
          </button>
        </li>
      </ul>
      <p v-else class="empty">还没有快照。每次抓取完成都会在这里留下一条不可变记录。</p>
    </section>

    <section class="card stack">
      <div class="card-head">
        <h2 class="card-title"><IconDatabase /> 缓存</h2>
        <span class="small subtle tnum">
          {{ usage ? `${formatCount(usage.entries)} 条 · ${formatBytes(usage.bytes)}` : '读取中' }}
        </span>
      </div>

      <dl v-if="cacheRows.length" class="stats">
        <template v-for="row in cacheRows" :key="row.label">
          <dt class="small subtle">{{ row.label }}</dt>
          <dd class="small tnum">{{ row.value }}</dd>
        </template>
      </dl>

      <div class="row wrap">
        <template v-if="pending === 'cache'">
          <span class="small confirm-text">
            <IconWarningCircle class="inline-icon" />
            清空后所有快照与缓存分页都会消失，需要重新抓取。确认清空？
          </span>
          <button type="button" class="btn btn-sm btn-danger" @click="confirmClear">确认清空</button>
          <button type="button" class="btn btn-sm btn-ghost" @click="pending = null">取消</button>
        </template>
        <button v-else type="button" class="btn" @click="pending = 'cache'">
          <IconBroom />
          清空缓存
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.view {
  gap: var(--sp-3);
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.entry {
  padding: var(--sp-2);
  border-radius: var(--r-sm);
  background: var(--surface-2);
}

.title {
  border: 0;
  background: none;
  text-align: left;
  cursor: pointer;
  font-size: var(--fs-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 120px;
}

.title:hover {
  color: var(--accent);
}

.confirm-text {
  color: var(--error);
}

.stats {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--sp-1) var(--sp-3);
  margin: 0;
}

.stats dd {
  margin: 0;
  text-align: right;
}

.inline-icon {
  width: 13px;
  height: 13px;
  vertical-align: -2px;
}
</style>
