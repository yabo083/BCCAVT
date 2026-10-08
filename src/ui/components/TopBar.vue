<script setup lang="ts">
/** 顶栏：品牌、登录态、目标输入与两个分析入口、整页打开、当前标签页建议、未登录限制。 */
import { computed } from 'vue';
import IconChatCircleText from '~icons/ph/chat-circle-text';
import IconMagnifyingGlass from '~icons/ph/magnifying-glass';
import IconTreeStructure from '~icons/ph/tree-structure';
import IconArrowSquareOut from '~icons/ph/arrow-square-out';
import IconLinkSimple from '~icons/ph/link-simple';
import IconWarningCircle from '~icons/ph/warning-circle';
import SessionChip from './SessionChip.vue';
import { openInTab, openLoginPage, resolveInput, startSubject, startThread, state } from '../store';
import { workbench } from '../services';

const resolved = computed(() => (state.input.trim() ? workbench.resolve(state.input.trim()) : null));
const commentTarget = computed(() =>
  resolved.value?.target.kind === 'thread' ? resolved.value.target.commentId : state.selectedCommentId,
);
const limitations = computed(() =>
  state.session && !state.session.loggedIn ? state.session.limitations : [],
);

function analyzeSubject(): void {
  void startSubject();
}

function analyzeThread(): void {
  const commentId = commentTarget.value;
  if (commentId) void startThread(commentId);
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
  <header class="bar stack">
    <div class="row between">
      <span class="row brand">
        <IconChatCircleText class="brand-icon" />
        <strong>Loupe</strong>
        <span class="subtle small">评鉴</span>
      </span>
      <span class="row">
        <SessionChip />
        <button type="button" class="btn btn-sm btn-ghost" title="在新标签页打开整页视图" @click="openInTab">
          <IconArrowSquareOut />
        </button>
      </span>
    </div>

    <div class="row input-row">
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
      <button type="button" class="btn btn-primary" :disabled="!!state.run" @click="analyzeSubject">
        <IconMagnifyingGlass />
        分析评论区
      </button>
      <button
        type="button"
        class="btn btn-tonal"
        :disabled="!!state.run || !commentTarget"
        :title="commentTarget ? `分析评论 ${commentTarget} 所在的评论树` : '链接里带评论，或先在报告里选中一条评论'"
        @click="analyzeThread"
      >
        <IconTreeStructure />
        分析评论树
      </button>
    </div>

    <p v-if="state.inputError" class="inline-note small error-note">{{ state.inputError }}</p>
    <p v-else-if="commentTarget" class="inline-note small subtle">
      <IconLinkSimple />
      已定位评论 {{ commentTarget }}
    </p>
    <button v-if="state.suggestion && !state.input" type="button" class="inline-note suggestion" @click="useSuggestion">
      <IconLinkSimple />
      使用当前标签页：{{ state.suggestion }}
    </button>

    <p v-if="limitations.length" class="limits small">
      <IconWarningCircle />
      <span class="grow">{{ limitations.join('；') }}</span>
      <button type="button" class="btn btn-sm btn-tonal" @click="openLoginPage">登录</button>
    </p>
  </header>
</template>

<style scoped>
.bar {
  gap: var(--sp-2);
}

.brand {
  gap: var(--sp-1);
}

.brand-icon {
  width: 18px;
  height: 18px;
  color: var(--accent);
}

.input-row {
  gap: var(--sp-2);
  flex-wrap: wrap;
}

.input-row .input {
  min-width: 180px;
}

.inline-note {
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

.inline-note svg {
  width: 13px;
  height: 13px;
  flex: none;
}

.error-note {
  color: var(--error);
}

.suggestion {
  cursor: pointer;
  padding: 0;
}

.suggestion:hover {
  color: var(--accent);
}

.limits {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: 0;
  padding: var(--sp-2);
  border-radius: var(--r-sm);
  background: var(--warning-bg);
  color: var(--warning);
}

.limits svg {
  width: 14px;
  height: 14px;
  flex: none;
}
</style>
