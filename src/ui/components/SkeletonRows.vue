<script setup lang="ts">
/**
 * 首屏评论骨架：在真实评论落地前占位，避免加载中一片空白。
 *
 * 纯展示、无外部依赖：不取数、不发消息、不可交互。整体 `aria-hidden`——
 * 加载进度由旁边的阶段文案（`EmbeddedComments` 的 booting 状态行）播报，这里再播一遍只会重复。
 *
 * 尺寸纪律（ADR-0003：iframe 高度只增不减）：每行比真实评论行矮一截、总高低于真实首屏，
 * 骨架卸载后由只增不减的 `reportHeight()` 兜底，绝不让内容先高后低。
 */
withDefaults(defineProps<{ rows?: number }>(), { rows: 3 });
</script>

<template>
  <div class="skeleton-rows" aria-hidden="true">
    <div v-for="row in rows" :key="row" class="skeleton-row">
      <span class="skeleton-avatar" />
      <span class="skeleton-lines">
        <span class="skeleton-shimmer-box" style="width: 42%" />
        <span class="skeleton-shimmer-box" />
        <span class="skeleton-shimmer-box skeleton-short" />
      </span>
    </div>
  </div>
</template>

<style scoped>
.skeleton-rows {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

/* 每行：38px 圆形头像块（对齐 `--avatar-slot`）+ 一组长短不一的灰条 */
.skeleton-row {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-3);
  padding: var(--sp-2) var(--sp-3);
}

.skeleton-avatar {
  flex: none;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: var(--surface-3);
}

.skeleton-lines {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 2px;
}

/* 短的那条窄一半，让占位看着像真的一段话而不是三条等长横杠 */
.skeleton-short {
  width: 50%;
}
</style>
