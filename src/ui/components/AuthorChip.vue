<script setup lang="ts">
/** 作者：头像 + 昵称 +（有则）等级。头像走 no-referrer，加载失败只隐藏图片。 */
import { ref } from 'vue';
import type { Author } from '@/core/model';

const props = defineProps<{ author: Author; meta?: string }>();
const broken = ref(false);
</script>

<template>
  <span class="author">
    <img
      v-if="props.author.avatarUrl && !broken"
      class="avatar"
      :src="props.author.avatarUrl"
      alt=""
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
      @error="broken = true"
    />
    <span v-else class="avatar avatar-fallback">{{ props.author.name.slice(0, 1) }}</span>
    <span class="name">{{ props.author.name }}</span>
    <span v-if="props.author.level !== undefined" class="chip level tnum">Lv{{ props.author.level }}</span>
    <span v-if="props.meta" class="subtle meta tnum">{{ props.meta }}</span>
  </span>
</template>

<style scoped>
.author {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  min-width: 0;
}

.avatar {
  width: 18px;
  height: 18px;
  border-radius: var(--r-pill);
  object-fit: cover;
  flex: none;
  background: var(--surface-2);
}

.avatar-fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-xs);
  color: var(--fg-muted);
}

.name {
  font-size: var(--fs-sm);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 12em;
}

.level {
  font-size: 10px;
  padding: 0 4px;
  line-height: 1.6;
}

.meta {
  font-size: var(--fs-xs);
}
</style>
