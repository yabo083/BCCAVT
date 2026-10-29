<script setup lang="ts">
/**
 * 单棵评论树：纵向缩进树——父在上、直接回复在下一层，缩进线画出分支。
 * 节点主标签是作者名（头像 + 昵称 + 等级），正文只在 hover 悬浮层与选中详情里完整出现。
 * 工具条全部是 Phosphor icon-only 控件（aria-label + title），缩放读数只是状态文本。
 * 视口尺寸完全由 CSS 决定（内容层 absolute inset 0 + 定高窗口化列表），
 * 内容再多也不会反过来撑高布局，旧的画布自增长反馈即由此切断。
 */
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import IconArrowBendDownRight from '~icons/ph/arrow-bend-down-right';
import IconArrowsIn from '~icons/ph/arrows-in';
import IconArrowsOut from '~icons/ph/arrows-out';
import IconCaretDown from '~icons/ph/caret-down';
import IconCaretRight from '~icons/ph/caret-right';
import IconCrosshairSimple from '~icons/ph/crosshair-simple';
import IconFlag from '~icons/ph/flag';
import IconMagnifyingGlassMinus from '~icons/ph/magnifying-glass-minus';
import IconMagnifyingGlassPlus from '~icons/ph/magnifying-glass-plus';
import IconThumbsUp from '~icons/ph/thumbs-up';
import CommentText from './CommentText.vue';
import InfoTip from './InfoTip.vue';
import VirtualList from './VirtualList.vue';
import { COMPACT_ROW_THRESHOLD, flattenThread } from '../thread';
import type { ThreadRow } from '../thread';
import { formatCount, formatDateTime, formatRelative } from '../format';
import { scrollTopForIndex } from '../virtual';
import type { CommentNode, Forest } from '@/core/report';
import type { ThreadDiagnosis } from '@/ai/types';

const props = withDefaults(
  defineProps<{
    forest: Forest;
    rootId?: string | null;
    focusId?: string | null;
    selectedId?: string | null;
    diagnosis?: ThreadDiagnosis | null;
    collapsed?: ReadonlySet<string>;
  }>(),
  { rootId: null, focusId: null, selectedId: null, diagnosis: null, collapsed: () => new Set<string>() },
);
const emit = defineEmits<{
  select: [id: string];
  'toggle-collapse': [id: string];
  'collapse-all': [];
  'expand-all': [];
}>();

/** 行内度量（未缩放像素）；CSS 用 --s 乘同一批数字，两边必须一致，否则正文会被裁掉。 */
const LINE_HEIGHT = 24;
const PREVIEW_LINE_HEIGHT = 18;
const PREVIEW_LINES = 2;
const ROW_PADDING = 6;
/** VirtualList 每行自带 8px 底距，缩进线靠它接续。 */
const LIST_GAP = 8;
const INDENT_STEP = 16;
const MIN_SCALE = 0.85;
const MAX_SCALE = 1.6;
const ZOOM_STEP = 1.15;
const HOVER_DELAY = 180;

const viewport = ref<HTMLElement | null>(null);
const list = ref<InstanceType<typeof VirtualList> | null>(null);
const scrollEl = ref<HTMLElement | null>(null);
const tipEl = ref<HTMLElement | null>(null);
const scale = ref(1);
const hoverRow = ref<ThreadRow | null>(null);
const panning = ref(false);
const brokenAvatars = reactive(new Set<string>());

const threadRoot = computed<CommentNode | null>(() => {
  const byRootId = props.rootId ? props.forest.byId.get(props.rootId) : undefined;
  return byRootId ?? props.forest.roots[0] ?? null;
});

const rows = computed<ThreadRow[]>(() => (threadRoot.value ? flattenThread(threadRoot.value, props.collapsed) : []));
const activeId = ref<string | null>(props.selectedId ?? props.focusId ?? threadRoot.value?.comment.id ?? null);
/** 小树给足正文预览，大树只留作者与关系，正文交给悬浮层。 */
const compact = computed(() => rows.value.length > COMPACT_ROW_THRESHOLD);
const indentWidth = computed(() => Math.round(INDENT_STEP * scale.value));
const rowHeight = computed(() =>
  Math.round(
    (LINE_HEIGHT + (compact.value ? 0 : PREVIEW_LINES * PREVIEW_LINE_HEIGHT) + ROW_PADDING * 2) * scale.value,
  ),
);
const itemHeight = computed(() => rowHeight.value + LIST_GAP);
const viewportStyle = computed<Record<string, string>>(() => ({ '--s': String(scale.value) }));
const turningPoints = computed(() => new Set(props.diagnosis?.turningPoints ?? []));
/** 悬浮层是长正文的唯一完整出口（另一个是选中详情卡），所以这里不做截断，只让它在框内滚动。 */
const hoverText = computed(() => hoverRow.value?.node.comment.text ?? '');
/** 回复关系：悬浮层里点名父评论作者，读树时不必反推缩进。 */
const hoverParentName = computed(() => hoverRow.value?.node.parent?.comment.author.name ?? null);

/** 立场着色：有诊断按立场，否则根用主色、回复用中性色。 */
function stanceClass(row: ThreadRow): string {
  const stance = props.diagnosis?.stanceOf[row.id];
  if (stance === undefined) return row.depth === 0 ? 'root' : 'plain';
  return `s${(stance % 6) + 1}`;
}

/* ── 缩放与滚动：都在定高窗口化列表上做，不碰布局高度 ── */

function scrollRowIntoView(index: number): void {
  const el = scrollEl.value;
  if (!el) return;
  const top = index * itemHeight.value;
  const bottom = top + itemHeight.value;
  if (top < el.scrollTop) el.scrollTop = top;
  else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
}

function setScale(next: number): void {
  const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
  if (clamped === scale.value) return;
  const el = scrollEl.value;
  const anchor = el ? Math.floor(el.scrollTop / itemHeight.value) : 0;
  scale.value = clamped;
  if (!el) return;
  void nextTick(() => {
    el.scrollTop = anchor * itemHeight.value;
  });
}

function resetView(): void {
  scale.value = 1;
  const anchorId = props.selectedId ?? props.focusId ?? threadRoot.value?.comment.id ?? null;
  const found = anchorId ? rows.value.findIndex((row) => row.id === anchorId) : 0;
  const index = found >= 0 ? found : 0;
  activeId.value = rows.value[index]?.id ?? null;
  void nextTick(() => {
    const el = scrollEl.value;
    if (el) el.scrollTop = scrollTopForIndex(index, itemHeight.value, el.clientHeight);
  });
}

function moveActive(index: number): void {
  const target = rows.value[Math.min(rows.value.length - 1, Math.max(0, index))];
  if (!target) return;
  activeId.value = target.id;
  void nextTick(() => scrollRowIntoView(target.index));
}

/* ── 指针：单击选中、双击折叠、拖拽平移、Ctrl/⌘ + 滚轮缩放 ── */

const pointer = { x: 0, y: 0 };
const pan = { active: false, moved: false, x: 0, y: 0, left: 0, top: 0 };
let suppressClick = false;
let hoverTimer: number | undefined;

function positionTip(): void {
  const tip = tipEl.value;
  const host = viewport.value;
  if (!tip || !host) return;
  const left = Math.max(4, Math.min(pointer.x + 14, host.clientWidth - tip.offsetWidth - 4));
  const top = Math.max(4, Math.min(pointer.y + 14, host.clientHeight - tip.offsetHeight - 4));
  tip.style.transform = `translate(${left}px, ${top}px)`;
}

function hideHover(): void {
  window.clearTimeout(hoverTimer);
  hoverRow.value = null;
}

function onPointerOver(event: PointerEvent): void {
  const id = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-id]')?.dataset.id;
  if (!id || id === hoverRow.value?.id) return;
  window.clearTimeout(hoverTimer);
  hoverRow.value = null;
  hoverTimer = window.setTimeout(() => {
    const row = rows.value.find((item) => item.id === id);
    if (row) {
      hoverRow.value = row;
      void nextTick(positionTip);
    }
  }, HOVER_DELAY);
}

function onPointerOut(event: PointerEvent): void {
  const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-id]');
  const next = event.relatedTarget as Node | null;
  if (!target || (next && target.contains(next))) return;
  hideHover();
}

function onPointerDown(event: PointerEvent): void {
  const el = scrollEl.value;
  if (event.button !== 0 || !el) return;
  pan.active = true;
  pan.moved = false;
  pan.x = event.clientX;
  pan.y = event.clientY;
  pan.left = el.scrollLeft;
  pan.top = el.scrollTop;
  viewport.value?.setPointerCapture(event.pointerId);
}

function onPointerMove(event: PointerEvent): void {
  const host = viewport.value;
  if (!host) return;
  const rect = host.getBoundingClientRect();
  pointer.x = event.clientX - rect.left;
  pointer.y = event.clientY - rect.top;

  if (pan.active) {
    const el = scrollEl.value;
    if (!el) return;
    const dx = event.clientX - pan.x;
    const dy = event.clientY - pan.y;
    if (!pan.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    pan.moved = true;
    panning.value = true;
    el.scrollLeft = pan.left - dx;
    el.scrollTop = pan.top - dy;
    hideHover();
    return;
  }
  if (!hoverRow.value) return;
  // 指针已在悬浮层内（它可滚动）时不再跟随，否则悬浮层会追着指针跑。
  const target = event.target as Node | null;
  if (target && tipEl.value?.contains(target)) return;
  positionTip();
}

function onPointerUp(event: PointerEvent): void {
  if (!pan.active) return;
  suppressClick = pan.moved;
  pan.active = false;
  panning.value = false;
  const host = viewport.value;
  if (host?.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
}

function onClickCapture(event: MouseEvent): void {
  if (!suppressClick) return;
  suppressClick = false;
  event.preventDefault();
  event.stopPropagation();
}

function onWheel(event: WheelEvent): void {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  setScale(scale.value * (event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP));
}

function onRowClick(row: ThreadRow): void {
  activeId.value = row.id;
  emit('select', row.id);
  scrollEl.value?.focus({ preventScroll: true });
}

function onRowDoubleClick(row: ThreadRow): void {
  if (row.hasChildren) emit('toggle-collapse', row.id);
}

/* ── 键盘：容器持有焦点，aria-activedescendant 指向当前行（虚拟列表下不会丢焦点） ── */

function onKeydown(event: KeyboardEvent): void {
  const current = rows.value.findIndex((row) => row.id === activeId.value);
  const row = current >= 0 ? rows.value[current]! : null;

  if (event.key === 'ArrowDown') moveActive(current + 1);
  else if (event.key === 'ArrowUp') moveActive(current - 1);
  else if (event.key === 'Home') moveActive(0);
  else if (event.key === 'End') moveActive(rows.value.length - 1);
  else if (event.key === 'ArrowRight' && row) {
    if (row.hasChildren && row.folded) emit('toggle-collapse', row.id);
    else moveActive(current + 1);
  } else if (event.key === 'ArrowLeft' && row) {
    if (row.hasChildren && !row.folded) emit('toggle-collapse', row.id);
    else if (row.depth > 0) {
      let parent = current - 1;
      while (parent > 0 && rows.value[parent]!.depth >= row.depth) parent -= 1;
      moveActive(parent);
    }
  } else if ((event.key === 'Enter' || event.key === ' ') && row) emit('select', row.id);
  else if (event.key === '+' || event.key === '=') setScale(scale.value * ZOOM_STEP);
  else if (event.key === '-') setScale(scale.value / ZOOM_STEP);
  else if (event.key === '0') resetView();
  else return;
  event.preventDefault();
}

/* ── 同步外部状态 ── */

watch(list, (instance) => {
  scrollEl.value = (instance?.$el as HTMLElement | undefined) ?? null;
  scrollEl.value?.addEventListener('scroll', hideHover, { passive: true });
});

watch(
  () => props.selectedId,
  (id) => {
    if (!id) return;
    const row = rows.value.find((item) => item.id === id);
    if (!row) return;
    activeId.value = id;
    void nextTick(() => scrollRowIntoView(row.index));
  },
);

watch(rows, (next) => {
  if (next.length && !next.some((row) => row.id === activeId.value)) activeId.value = next[0]!.id;
});

onBeforeUnmount(() => {
  window.clearTimeout(hoverTimer);
  scrollEl.value?.removeEventListener('scroll', hideHover);
});
</script>

<template>
  <div class="thread">
    <div class="bar row between">
      <span class="hint small subtle">单击选中 · 双击折叠 · 方向键移动 · Ctrl/⌘ + 滚轮缩放</span>
      <div class="row tools">
        <button
          type="button"
          class="btn btn-sm btn-ghost btn-icon"
          title="缩小"
          aria-label="缩小评论树"
          :disabled="scale <= MIN_SCALE"
          @click="setScale(scale / ZOOM_STEP)"
        >
          <IconMagnifyingGlassMinus />
        </button>
        <span class="zoom tnum" title="当前缩放">{{ Math.round(scale * 100) }}%</span>
        <button
          type="button"
          class="btn btn-sm btn-ghost btn-icon"
          title="放大"
          aria-label="放大评论树"
          :disabled="scale >= MAX_SCALE"
          @click="setScale(scale * ZOOM_STEP)"
        >
          <IconMagnifyingGlassPlus />
        </button>
        <button
          type="button"
          class="btn btn-sm btn-ghost btn-icon"
          title="重置视图与缩放"
          aria-label="重置视图与缩放"
          @click="resetView"
        >
          <IconCrosshairSimple />
        </button>
        <button
          type="button"
          class="btn btn-sm btn-ghost btn-icon"
          title="折叠全部子树"
          aria-label="折叠全部子树"
          @click="emit('collapse-all')"
        >
          <IconArrowsIn />
        </button>
        <button
          type="button"
          class="btn btn-sm btn-ghost btn-icon"
          title="展开全部"
          aria-label="展开全部"
          @click="emit('expand-all')"
        >
          <IconArrowsOut />
        </button>
        <InfoTip
          text="Ctrl/⌘ + 滚轮缩放，拖拽平移；方向键在节点间移动，Enter 选中，→ 展开、← 折叠；双击节点折叠该子树。"
          label="评论树操作说明"
        />
      </div>
    </div>

    <div
      ref="viewport"
      class="viewport"
      :class="{ panning }"
      :style="viewportStyle"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @pointerleave="hideHover"
      @pointerover="onPointerOver"
      @pointerout="onPointerOut"
      @wheel="onWheel"
      @click.capture="onClickCapture"
    >
      <div class="tree-host">
        <VirtualList
          v-if="threadRoot"
          ref="list"
          class="tree"
          role="tree"
          tabindex="0"
          aria-label="评论树：方向键移动，Enter 选中，双击折叠子树"
          :aria-activedescendant="activeId ? `tree-row-${activeId}` : undefined"
          :count="rows.length"
          :item-height="itemHeight"
          @keydown="onKeydown"
        >
          <template #default="{ index }">
            <div
              class="thread-row"
              :class="{ selected: rows[index]!.id === selectedId, active: rows[index]!.id === activeId }"
              :id="`tree-row-${rows[index]!.id}`"
              :data-id="rows[index]!.id"
              role="treeitem"
              :aria-level="rows[index]!.depth + 1"
              :aria-selected="rows[index]!.id === selectedId"
              :aria-expanded="rows[index]!.hasChildren ? !rows[index]!.folded : undefined"
              @click="onRowClick(rows[index]!)"
              @dblclick="onRowDoubleClick(rows[index]!)"
            >
              <span class="indent" :style="{ width: `${rows[index]!.depth * indentWidth}px` }" aria-hidden="true">
                <span
                  v-for="level in rows[index]!.depth"
                  :key="level"
                  class="guide"
                  :class="{ elbow: level === rows[index]!.depth }"
                  :style="{ left: `${(level - 1) * indentWidth + 8}px` }"
                />
              </span>

              <div class="body">
                <div class="line">
                  <span class="rail" :class="stanceClass(rows[index]!)" aria-hidden="true" />
                  <img
                    v-if="rows[index]!.node.comment.author.avatarUrl && !brokenAvatars.has(rows[index]!.id)"
                    class="avatar"
                    :src="rows[index]!.node.comment.author.avatarUrl"
                    alt=""
                    loading="lazy"
                    decoding="async"
                    referrerpolicy="no-referrer"
                    @error="brokenAvatars.add(rows[index]!.id)"
                  />
                  <span v-else class="avatar fallback" aria-hidden="true">
                    {{ rows[index]!.node.comment.author.name.slice(0, 1) }}
                  </span>
                  <span class="name">{{ rows[index]!.node.comment.author.name }}</span>
                  <span v-if="rows[index]!.node.comment.author.level !== undefined" class="lv tnum">
                    Lv{{ rows[index]!.node.comment.author.level }}
                  </span>
                  <span v-if="rows[index]!.id === focusId" class="chip chip-accent focus-chip">分析根</span>
                  <span v-if="turningPoints.has(rows[index]!.id)" class="mark" title="讨论转折点">
                    <IconFlag />
                  </span>
                  <span class="meta tnum">{{ formatRelative(rows[index]!.node.comment.createdAt) }}</span>
                  <span class="meta tnum">
                    <IconThumbsUp />
                    {{ formatCount(rows[index]!.node.comment.likes) }}
                  </span>
                </div>
                <p v-if="!compact" class="preview"><CommentText :text="rows[index]!.preview" :emotes="rows[index]!.node.comment.emotes" /></p>
              </div>

              <button
                v-if="rows[index]!.hasChildren"
                type="button"
                class="caret"
                :title="rows[index]!.folded ? '展开该子树' : '折叠该子树'"
                :aria-label="
                  rows[index]!.folded
                    ? `展开 ${rows[index]!.node.children.length} 条回复`
                    : `折叠 ${rows[index]!.node.children.length} 条回复`
                "
                @click.stop="emit('toggle-collapse', rows[index]!.id)"
              >
                <IconCaretDown v-if="!rows[index]!.folded" />
                <IconCaretRight v-else />
                <span v-if="rows[index]!.hidden" class="tnum">+{{ formatCount(rows[index]!.hidden) }}</span>
              </button>
            </div>
          </template>
        </VirtualList>
        <p v-else class="empty">这棵树没有可显示的评论</p>
      </div>

      <div v-if="hoverRow" ref="tipEl" class="hover">
        <div class="who">
          <span class="who-name">{{ hoverRow.node.comment.author.name }}</span>
          <span v-if="hoverRow.node.comment.author.level !== undefined" class="who-lv tnum">
            Lv{{ hoverRow.node.comment.author.level }}
          </span>
        </div>
        <div v-if="hoverParentName" class="hover-rel">
          <IconArrowBendDownRight />
          <span>回复 {{ hoverParentName }}</span>
        </div>
        <div class="hover-meta tnum">
          {{ formatDateTime(hoverRow.node.comment.createdAt) }} · 深度 {{ hoverRow.depth }} ·
          {{ formatCount(hoverRow.node.comment.likes) }} 赞
          <template v-if="hoverRow.node.children.length">
            · 直接回复 {{ formatCount(hoverRow.node.children.length) }}
          </template>
          <template v-if="hoverRow.hidden"> · 已折叠 {{ formatCount(hoverRow.hidden) }}</template>
          <template v-if="hoverRow.node.comment.location"> · {{ hoverRow.node.comment.location }}</template>
        </div>
        <p class="hover-text"><CommentText :text="hoverText" :emotes="hoverRow.node.comment.emotes" /></p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.thread {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  gap: var(--sp-2);
}

.bar {
  flex: none;
  gap: var(--sp-2);
}

.hint {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tools {
  flex: none;
  gap: 2px;
  align-items: center;
}

/* 缩放读数是状态而不是控件：高频操作一律 icon-only，读数保持纯文本。 */
.zoom {
  min-width: 44px;
  padding: 0 var(--sp-1);
  text-align: center;
  font-size: var(--fs-xs);
  color: var(--fg-subtle);
}

/* 视口：高度由 CSS（卡片高度 / flex）决定；内容层绝对定位 + 定高窗口化列表，
   任何内容尺寸都不可能反过来撑高布局。 */
.viewport {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border-radius: var(--r-sm);
  background: var(--surface);
  cursor: grab;
  touch-action: pan-y;
}

.viewport.panning {
  cursor: grabbing;
}

.tree-host {
  position: absolute;
  inset: 0;
}

.tree {
  user-select: none;
}

.thread-row {
  display: flex;
  align-items: flex-start;
  width: 100%;
  height: 100%;
  padding: calc(6px * var(--s)) calc(8px * var(--s));
  border-radius: var(--r-sm);
  cursor: pointer;
}

.thread-row:hover {
  background: var(--surface-2);
}

.thread-row.selected {
  background: var(--accent-bg);
  box-shadow: inset 0 0 0 1px var(--accent-border);
}

.tree:focus-visible .thread-row.active {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

/* 缩进线：整行高度（含行间距）贯通，末级带一个指向节点的肘形接头。 */
.indent {
  position: relative;
  flex: none;
  align-self: stretch;
}

.guide {
  position: absolute;
  top: 0;
  bottom: calc(-8px);
  width: 1px;
  background: var(--border);
}

.guide.elbow::after {
  content: '';
  position: absolute;
  left: 0;
  top: calc(12px * var(--s));
  width: calc(8px * var(--s));
  height: 1px;
  background: var(--border);
}

.body {
  flex: 1;
  min-width: 0;
}

.line {
  display: flex;
  align-items: center;
  gap: calc(6px * var(--s));
  height: calc(24px * var(--s));
  min-width: 0;
}

.rail {
  flex: none;
  width: 3px;
  height: calc(14px * var(--s));
  border-radius: var(--r-pill);
  background: var(--border-strong);
}

.rail.root {
  background: var(--accent);
}

.rail.s1 {
  background: var(--c1);
}

.rail.s2 {
  background: var(--c2);
}

.rail.s3 {
  background: var(--c3);
}

.rail.s4 {
  background: var(--c4);
}

.rail.s5 {
  background: var(--c5);
}

.rail.s6 {
  background: var(--c6);
}

.avatar {
  flex: none;
  width: calc(18px * var(--s));
  height: calc(18px * var(--s));
  border-radius: var(--r-pill);
  object-fit: cover;
  background: var(--surface-2);
}

.avatar.fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: calc(var(--fs-xs) * var(--s));
  color: var(--fg-muted);
}

.name {
  flex: 0 1 auto;
  min-width: 0;
  font-size: calc(var(--fs-sm) * var(--s));
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lv,
.meta {
  flex: none;
  font-size: calc(var(--fs-xs) * var(--s));
  color: var(--fg-subtle);
}

.meta {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.meta svg {
  width: calc(11px * var(--s));
  height: calc(11px * var(--s));
}

.focus-chip {
  flex: none;
  font-size: calc(var(--fs-xs) * var(--s));
}

.mark {
  display: inline-flex;
  flex: none;
  color: var(--warning);
}

.mark svg {
  width: calc(12px * var(--s));
  height: calc(12px * var(--s));
}

.preview {
  margin: 0;
  height: calc(36px * var(--s));
  font-size: calc(var(--fs-sm) * var(--s));
  line-height: calc(18px * var(--s));
  color: var(--fg-muted);
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.caret {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex: none;
  height: calc(24px * var(--s));
  padding: 0 calc(4px * var(--s));
  border: 0;
  border-radius: var(--r-xs);
  background: none;
  color: var(--fg-subtle);
  cursor: pointer;
}

.caret:hover {
  background: var(--surface-3);
  color: var(--fg);
}

.caret svg {
  width: calc(14px * var(--s));
  height: calc(14px * var(--s));
}

.caret span {
  font-size: calc(var(--fs-xs) * var(--s));
}

/* 悬浮详情：作者名在前，其次回复关系与元信息，最后是完整正文（超长在框内滚动）。 */
.hover {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  max-width: 380px;
  max-height: 76%;
  overflow: hidden;
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-sm);
  background: var(--surface);
  box-shadow: var(--shadow-3);
  pointer-events: auto;
  will-change: transform;
}

.who {
  display: flex;
  align-items: baseline;
  gap: var(--sp-1);
  font-size: var(--fs-sm);
}

.who-name {
  font-weight: 600;
}

.who-lv {
  font-size: var(--fs-xs);
  color: var(--fg-subtle);
}

.hover-rel {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: var(--fs-xs);
  color: var(--fg-muted);
}

.hover-rel svg {
  width: 12px;
  height: 12px;
  color: var(--fg-subtle);
}

.hover-meta {
  font-size: var(--fs-xs);
  color: var(--fg-subtle);
}

.hover-text {
  margin: 0;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  font-size: var(--fs-sm);
  line-height: var(--lh-normal);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

@media (max-width: 719px) {
  .hint {
    display: none;
  }
}
</style>
