<script setup lang="ts">
/**
 * 全站唯一的解释气泡：hover 与键盘 focus 都能打开，Esc 关闭；内容以 fixed 层渲染，
 * 不会被窄面板裁掉。长解释只放这里，界面上不再有常驻段落。
 */
import { onBeforeUnmount, ref, useId } from 'vue';
import IconInfo from '~icons/ph/info';

const props = withDefaults(defineProps<{ text: string; label?: string; width?: number }>(), { width: 264 });
const id = useId();
const anchor = ref<HTMLElement | null>(null);
const open = ref(false);
const placement = ref<'below' | 'above'>('below');
const position = ref({ left: 0, top: 0 });
let hideTimer: number | undefined;

function place(): void {
  const el = anchor.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const width = Math.min(props.width, window.innerWidth - 16);
  const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8);
  const above = rect.bottom + 140 > window.innerHeight && rect.top > 140;
  placement.value = above ? 'above' : 'below';
  position.value = { left, top: above ? rect.top - 6 : rect.bottom + 6 };
}

function show(): void {
  window.clearTimeout(hideTimer);
  place();
  open.value = true;
}

function hide(): void {
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    open.value = false;
  }, 120);
}

function toggle(): void {
  if (open.value) hide();
  else show();
}

onBeforeUnmount(() => window.clearTimeout(hideTimer));
</script>

<template>
  <span class="tip">
    <button
      ref="anchor"
      type="button"
      class="tip-trigger"
      :aria-label="label ?? '说明'"
      :aria-describedby="open ? id : undefined"
      :aria-expanded="open"
      @mouseenter="show"
      @mouseleave="hide"
      @focus="show"
      @blur="hide"
      @click.prevent.stop="toggle"
      @keydown.escape="hide"
    >
      <slot name="trigger">
        <IconInfo />
      </slot>
    </button>
    <Teleport to="body">
      <div
        v-if="open"
        :id="id"
        role="tooltip"
        class="tip-pop"
        :class="placement"
        :style="{ left: `${position.left}px`, top: `${position.top}px`, width: `${props.width}px` }"
        @mouseenter="show"
        @mouseleave="hide"
      >
        {{ text }}
      </div>
    </Teleport>
  </span>
</template>

<style scoped>
.tip {
  display: inline-flex;
  vertical-align: middle;
}

.tip-trigger {
  display: inline-flex;
  align-items: center;
  padding: 0;
  border: 0;
  background: none;
  color: var(--fg-subtle);
  cursor: help;
  border-radius: var(--r-pill);
}

.tip-trigger:hover {
  color: var(--fg-muted);
}

.tip-trigger svg {
  width: 13px;
  height: 13px;
}

.tip-pop {
  position: fixed;
  z-index: var(--z-popover);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-sm);
  background: var(--surface);
  color: var(--fg);
  box-shadow: var(--shadow-3);
  font-size: var(--fs-sm);
  line-height: var(--lh-normal);
  white-space: pre-line;
  pointer-events: auto;
}

.tip-pop.above {
  transform: translateY(-100%);
}
</style>
