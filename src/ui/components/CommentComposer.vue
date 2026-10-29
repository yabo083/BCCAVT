<script setup lang="ts">
/**
 * 评论输入框：页面替换阅读器的「发表评论」与「回复」共用一个控件（版面只差一行提示与取消键）。
 *
 * 受控组件：正文、发送态、错误都由父级持有——失败后草稿必须留着，成功才清空，
 * 这些状态属于阅读器的写流程，不属于输入框自己。这里只收集输入并上报。
 */
import { computed } from 'vue';
import { READER_COMMENT_MAX_LENGTH } from '@/extension/page-comments';
import { commentTextError } from '../reader-comments';

const props = withDefaults(
  defineProps<{
    text: string;
    placeholder: string;
    submitLabel: string;
    sending?: boolean;
    error?: string | null;
    cancellable?: boolean;
  }>(),
  { sending: false, error: null, cancellable: false },
);
const emit = defineEmits<{ input: [text: string]; submit: [text: string]; cancel: [] }>();

const count = computed(() => props.text.length);
const canSubmit = computed(() => !props.sending && commentTextError(props.text) === null);

function submit(): void {
  if (canSubmit.value) emit('submit', props.text);
}
</script>

<template>
  <div class="composer">
    <textarea
      class="field"
      :value="props.text"
      :placeholder="props.placeholder"
      :maxlength="READER_COMMENT_MAX_LENGTH"
      :disabled="props.sending"
      rows="2"
      @input="emit('input', ($event.target as HTMLTextAreaElement).value)"
      @keydown.enter.ctrl.prevent="submit"
      @keydown.enter.meta.prevent="submit"
    />
    <div class="bar">
      <span class="hint tnum">{{ count }} / {{ READER_COMMENT_MAX_LENGTH }}</span>
      <span class="hint sep">Ctrl + Enter 发送</span>
      <span class="grow" />
      <button
        v-if="props.cancellable"
        type="button"
        class="ghost"
        :disabled="props.sending"
        @click="emit('cancel')"
      >
        取消
      </button>
      <button type="button" class="send" :disabled="!canSubmit" @click="submit">
        {{ props.sending ? '发送中…' : props.submitLabel }}
      </button>
    </div>
    <p v-if="props.error" class="fail">
      <span class="chip chip-error">发送失败</span>
      <span>{{ props.error }}</span>
    </p>
  </div>
</template>

<style scoped>
/* 发评框整体:一块浅灰圆角面板,聚焦时描蓝边——B 站评论输入框的形态 */
.composer {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3) var(--sp-2);
  border: 1px solid transparent;
  border-radius: var(--r-md);
  background: var(--surface-2);
  transition: border-color var(--dur-fast) ease, background var(--dur-fast) ease;
}

.composer:focus-within {
  border-color: #00aeec;
  background: var(--surface);
}

/* B 站式输入:浅底、细边、聚焦变蓝;不用全局 .textarea 的等宽体 + inset 阴影方盒 */
.field {
  width: 100%;
  min-height: 52px;
  padding: 2px 0;
  border: 0;
  background: transparent;
  color: var(--fg);
  font-family: var(--font-sans);
  font-size: var(--fs-md);
  line-height: 1.55;
  resize: vertical;
}

.field:focus {
  outline: none;
}

.field::placeholder {
  color: var(--fg-subtle);
}

.field:disabled {
  opacity: 0.7;
}

.bar {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

.grow {
  flex: 1 1 auto;
}

.hint {
  font-size: var(--fs-xs);
  color: var(--fg-subtle);
}

.sep {
  padding-left: var(--sp-2);
  border-left: 1px solid var(--border);
}

.ghost {
  height: 28px;
  padding: 0 var(--sp-3);
  border: 0;
  border-radius: var(--r-pill);
  background: transparent;
  color: var(--fg-muted);
  font-size: var(--fs-sm);
  cursor: pointer;
  transition: background var(--dur-fast) ease, color var(--dur-fast) ease;
}

.ghost:hover:not(:disabled) {
  background: color-mix(in srgb, var(--fg) 8%, transparent);
  color: var(--fg);
}

/* 发送按钮:B 站蓝胶囊 */
.send {
  height: 30px;
  padding: 0 var(--sp-4);
  border: 0;
  border-radius: var(--r-pill);
  background: #00aeec;
  color: #fff;
  font-size: var(--fs-sm);
  font-weight: 500;
  cursor: pointer;
  transition: background var(--dur-fast) ease, opacity var(--dur-fast) ease;
}

.send:hover:not(:disabled) {
  background: #00a1d6;
}

.send:disabled {
  background: color-mix(in srgb, #00aeec 40%, var(--surface-3));
  color: color-mix(in srgb, #fff 80%, var(--surface-3));
  opacity: 0.9;
  cursor: not-allowed;
}

.fail {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2);
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--error);
}
</style>
