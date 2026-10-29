<script setup lang="ts">
/**
 * 「输入」面板：分析目标输入 + 两个分析入口 + 抓取选项 + 最近快照。
 * 原顶栏的输入区搬到这里，顶栏只留只读总览；分析成功后 store 会把 view 切到报告/评论树，面板自动收起。
 */
import { computed } from 'vue';
import IconClockCounterClockwise from '~icons/ph/clock-counter-clockwise';
import IconGearSix from '~icons/ph/gear-six';
import IconLinkSimple from '~icons/ph/link-simple';
import IconMagnifyingGlass from '~icons/ph/magnifying-glass';
import IconTreeStructure from '~icons/ph/tree-structure';
import CrawlOptionsPanel from '../components/CrawlOptionsPanel.vue';
import { openSnapshot, resolveInput, startSubject, startThread, state } from '../store';
import { REFRESH_MODE_LABELS, limitsSummary } from '../prefs';
import { workbench } from '../services';
import { formatCount, formatRelative } from '../format';

const resolved = computed(() => (state.input.trim() ? workbench.resolve(state.input.trim()) : null));
/** 评论树分析目标：链接里带的评论优先，其次是在画布上选中的那条。 */
const commentTarget = computed(() =>
  resolved.value?.target.kind === 'thread' ? resolved.value.target.commentId : state.selectedCommentId,
);
/** 折叠摘要行：刷新方式 + 两处上限（文案与抓取面板共用同一份，见 prefs.ts）。 */
const optionsSummary = computed(
  () => `${REFRESH_MODE_LABELS[state.options.refresh]} · ${limitsSummary(state.options.maxRoots, state.options.maxRepliesPerThread)}`,
);

function analyzeSubject(): void {
  void startSubject();
}

function analyzeThread(): void {
  const commentId = commentTarget.value;
  if (commentId) void startThread(commentId, resolved.value?.target.subject);
}

function useSuggestion(): void {
  if (!state.suggestion) return;
  state.input = state.suggestion;
  state.suggestion = null;
  state.inputError = null;
}

/** 失焦时校验一次：粘贴了不认识的链接能立刻看到原因。 */
function validateInput(): void {
  if (state.input.trim()) resolveInput(state.input);
  else state.inputError = null;
}
</script>

<template>
  <div class="stack panel-view">
    <section class="card stack">
      <div class="row wrap input-row">
        <input
          v-model="state.input"
          class="input grow"
          type="text"
          placeholder="粘贴视频链接、BV 号或评论链接"
          aria-label="分析目标"
          @input="state.inputError = null"
          @blur="validateInput"
          @keydown.enter="analyzeSubject"
        />
      </div>
      <div class="row wrap">
        <button type="button" class="btn btn-primary grow" :disabled="!!state.run" @click="analyzeSubject">
          <IconMagnifyingGlass />
          分析评论区
        </button>
        <button
          type="button"
          class="btn btn-tonal grow"
          :disabled="!!state.run || !commentTarget"
          :title="commentTarget ? `分析评论 ${commentTarget} 所在的评论树` : '链接里带评论，或先在画布上选中一条评论'"
          @click="analyzeThread"
        >
          <IconTreeStructure />
          分析评论树
        </button>
      </div>
      <p v-if="state.inputError" class="note error">{{ state.inputError }}</p>
      <p v-else-if="commentTarget" class="note subtle">
        <IconLinkSimple />
        已定位评论 {{ commentTarget }}
      </p>
      <p v-else class="note subtle">用当前登录态抓取，数据只留本机</p>
      <button v-if="state.suggestion && !state.input" type="button" class="note suggestion" @click="useSuggestion">
        <IconLinkSimple />
        使用当前标签页：{{ state.suggestion }}
      </button>
    </section>

    <!-- 抓取选项默认收成一行摘要（当前刷新方式 + 两处上限），点开才铺开；
         摘要那句「现在是什么配置」是收起时唯一的信息出口，所以它必须随选项实时变。 -->
    <details class="options-disclosure">
      <summary class="disclosure-head row">
        <IconGearSix class="disclosure-icon" />
        <span class="disclosure-title">抓取选项</span>
        <span class="disclosure-summary tnum">{{ optionsSummary }}</span>
      </summary>
      <CrawlOptionsPanel />
    </details>

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
.input-row {
  gap: var(--sp-2);
}

.panel-view {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.note {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--fg-muted);
  border: 0;
  background: none;
  text-align: left;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.note svg {
  width: 13px;
  height: 13px;
  flex: none;
}

.error {
  color: var(--error);
}

.suggestion {
  cursor: pointer;
  padding: 0;
}

.suggestion:hover {
  color: var(--accent);
}

.history-row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  width: 100%;
  padding: var(--sp-2) var(--sp-1);
  border: 0;
  border-bottom: 1px solid var(--border);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.history-row:hover {
  background: var(--surface-2);
}

/* 最后一行不画收尾线：面板底部已有自己的边界。 */
.history-row:last-child {
  border-bottom: 0;
}

.history-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-sm);
}

/* ── 抓取选项折叠条 ──
   面板里最次要的一块，默认只占一行：左边名字、右边「现在是什么配置」。摘要行本身是 <summary>，
   键盘可达、点击展开，展开后铺开紧凑网格（见 CrawlOptionsPanel）。 */
.options-disclosure {
  border-radius: var(--r-md);
  background: var(--surface-2);
}

.disclosure-head {
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-md);
  font-size: var(--fs-sm);
  color: var(--fg-muted);
  cursor: pointer;
  list-style: none;
}

/* 收掉浏览器默认的三角标：展开态由图标自身的色调交代，不再多一个位图符号。 */
.disclosure-head::-webkit-details-marker {
  display: none;
}

.disclosure-head:hover {
  color: var(--fg);
}

.disclosure-icon {
  width: 14px;
  height: 14px;
  flex: none;
}

/* 名字不让位：窄面板里先截断摘要，而不是把「抓取选项」压成两行。 */
.disclosure-title {
  flex: none;
  font-weight: 500;
  white-space: nowrap;
}

.disclosure-summary {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: var(--fs-xs);
  color: var(--fg-subtle);
  text-align: right;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.options-disclosure[open] .disclosure-head {
  border-bottom: 1px solid var(--border);
  border-radius: var(--r-md) var(--r-md) 0 0;
}

.options-disclosure[open] .disclosure-icon {
  color: var(--accent);
}
</style>
