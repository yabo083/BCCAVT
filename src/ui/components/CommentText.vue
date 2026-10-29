<script setup lang="ts">
/**
 * 评论正文渲染：纯文本 + Bilibili 表情图片。全程 Vue 插值 / <img>，绝无 innerHTML，
 * 模型或平台塞进来的 HTML 只会作为文本显示。表情加载失败退回原始 token，
 * 未知 token 与 Unicode emoji（含 ZWJ/VS16）原样保留，字号/行高完全继承父级。
 */
import { computed, reactive } from 'vue';
import { tokenizeComment } from '../comment-text';
import type { CommentSegment } from '../comment-text';
import type { Comment } from '@/core/model';

const props = defineProps<{ text: string; emotes?: Comment['emotes']; mentions?: Comment['mentions']; jumps?: Comment['jumps'] }>();

const segments = computed<CommentSegment[]>(() => tokenizeComment(props.text, props.emotes, { mentions: props.mentions, jumps: props.jumps }));
/** URL 级失败记录：同名表情换成有效图片后仍可正常加载。 */
const broken = reactive(new Set<string>());
function secureImageUrl(url: string): string {
  return url.startsWith('//') ? `https:${url}` : url.replace(/^http:/i, 'https:');
}
</script>

<template>
  <span class="comment-text">
    <template v-for="(segment, i) in segments" :key="i">
      <img
        v-if="segment.kind === 'emote' && !broken.has(segment.url)"
        class="emote"
        :src="secureImageUrl(segment.url)"
        :alt="segment.token"
        :title="segment.token"
        :style="segment.width && segment.height ? { aspectRatio: `${segment.width} / ${segment.height}` } : {}"
        loading="lazy"
        decoding="async"
        referrerpolicy="no-referrer"
        @error="broken.add(segment.url)"
      />
      <span v-else-if="segment.kind === 'emote'">{{ segment.token }}</span>
      <a
        v-else-if="segment.kind === 'link'"
        class="cmt-link"
        :href="segment.url"
        target="_blank"
        rel="noopener noreferrer"
        @click.stop
        >{{ segment.text }}</a
      >
      <span v-else>{{ segment.text }}</span>
    </template>
  </span>
</template>

<style scoped>
.comment-text {
  /* 继承设计系统的无衬线栈，再补上各平台彩色 emoji 字体，避免系统用单色/豆腐块渲染。 */
  font-family: var(--font-sans), 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji';
}

.cmt-link {
  color: var(--link);
  text-decoration: none;
}

.cmt-link:hover {
  text-decoration: underline;
}

.emote {
  height: 1.2em;
  width: auto;
  max-width: 6em;
  vertical-align: -0.2em;
  object-fit: contain;
  margin: 0 1px;
}
</style>
