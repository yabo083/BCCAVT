<script setup lang="ts">
/** 目标入口：说明、抓取选项、最近快照。 */
import IconCompass from '~icons/ph/compass';
import IconClockCounterClockwise from '~icons/ph/clock-counter-clockwise';
import CrawlOptionsPanel from '../components/CrawlOptionsPanel.vue';
import { openSnapshot, state } from '../store';
import { formatCount, formatRelative } from '../format';
</script>

<template>
  <div class="stack">
    <section class="card stack">
      <div class="card-head">
        <h2 class="card-title"><IconCompass /> 快速开始</h2>
      </div>
      <p class="small muted">
        粘贴视频链接、BV 号或带 <code>#reply</code> 的评论链接，然后点「分析评论区」；链接里带评论时可直接「分析评论树」。
        抓取只使用你当前的浏览器登录态，数据与结果都留在本机。
      </p>
      <CrawlOptionsPanel />
    </section>

    <section v-if="state.history.length" class="card stack">
      <div class="card-head">
        <h2 class="card-title"><IconClockCounterClockwise /> 最近快照</h2>
        <button type="button" class="btn btn-sm btn-ghost" @click="state.view = 'history'">全部</button>
      </div>
      <button
        v-for="item in state.history.slice(0, 5)"
        :key="item.id"
        type="button"
        class="history-row"
        @click="openSnapshot(item.id)"
      >
        <span class="grow history-title">{{ item.title }}</span>
        <span class="subtle small tnum">
          {{ formatCount(item.commentCount) }} 条 · {{ formatRelative(item.fetchedAt) }}
        </span>
      </button>
    </section>

    <p v-else class="empty">还没有抓取记录。分析完成后，报告、评论树与历史快照都会出现在这里。</p>
  </div>
</template>

<style scoped>
.history-row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  width: 100%;
  padding: var(--sp-2);
  border: 0;
  border-radius: var(--r-sm);
  background: var(--surface-2);
  text-align: left;
  cursor: pointer;
}

.history-row:hover {
  background: var(--surface-3);
}

.history-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-sm);
}
</style>
