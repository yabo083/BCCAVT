<script setup lang="ts">
/** 定高窗口化列表：只渲染可视区（含 overscan）的行，10k+ 条也只是几十个 DOM 节点。 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { computeWindow, scrollTopForIndex } from '../virtual';

const props = withDefaults(defineProps<{ count: number; itemHeight: number; overscan?: number }>(), { overscan: 4 });

const container = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const viewportHeight = ref(0);
let observer: ResizeObserver | null = null;

const range = computed(() =>
  computeWindow({
    scrollTop: scrollTop.value,
    viewportHeight: viewportHeight.value,
    itemHeight: props.itemHeight,
    count: props.count,
    overscan: props.overscan,
  }),
);

const indexes = computed(() => {
  const { start, end } = range.value;
  return Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i);
});

onMounted(() => {
  const el = container.value;
  if (!el) return;
  viewportHeight.value = el.clientHeight;
  observer = new ResizeObserver(() => {
    viewportHeight.value = el.clientHeight;
  });
  observer.observe(el);
});

onBeforeUnmount(() => observer?.disconnect());

function onScroll(event: Event): void {
  scrollTop.value = (event.currentTarget as HTMLElement).scrollTop;
}

defineExpose({
  scrollToIndex(index: number): void {
    const el = container.value;
    if (el) el.scrollTop = scrollTopForIndex(index, props.itemHeight, el.clientHeight);
  },
});
</script>

<template>
  <div ref="container" class="vlist scroll" @scroll.passive="onScroll">
    <div class="vlist-inner" :style="{ height: `${range.totalHeight}px` }">
      <div class="vlist-window" :style="{ transform: `translateY(${range.offsetY}px)` }">
        <div v-for="index in indexes" :key="index" class="vlist-row" :style="{ height: `${itemHeight}px` }">
          <slot :index="index" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.vlist {
  position: relative;
  flex: 1 1 auto;
  height: 100%;
  min-height: 0;
}

.vlist-inner {
  position: relative;
}

.vlist-window {
  position: absolute;
  inset-inline: 0;
  top: 0;
  will-change: transform;
}

.vlist-row {
  display: flex;
  align-items: stretch;
  padding-bottom: var(--sp-2);
}
</style>
