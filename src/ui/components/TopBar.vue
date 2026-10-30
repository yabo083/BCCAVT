<script setup lang="ts">
/**
 * 顶部浮动总览，分两级：
 *   第一级「是什么」——品牌、当前画布数据源的主体标题、右侧动作（刷新 / 明暗主题）；
 *      主题配色只在设置弹窗里改（顶栏不再放色点），改完两边的文档通过存储事件各自跟随。
 *   第二级「多少、什么状态」——顺序固定为**数据源 → 主体数字 → 图的规模（小一号衬影文字）→
 *      完整度 → 抓取时间 → 状态 chip**：先说是哪份数据，再给量级，最后给状态。
 *      登录态那一段文字已删——`SessionChip` 已经把身份摆在同一排，再写一句「登录态/匿名」是重复。
 * 输入与抓取选项在左侧「输入」面板里（TargetView），这里只读不写。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import IconChatCircleText from '~icons/ph/chat-circle-text';
import IconGraph from '~icons/ph/graph';
import IconTreeStructure from '~icons/ph/tree-structure';
import IconArrowClockwise from '~icons/ph/arrow-clockwise';
import IconWarningCircle from '~icons/ph/warning-circle';
import IconSun from '~icons/ph/sun';
import IconMoon from '~icons/ph/moon-stars';
import CompletenessBadge from './CompletenessBadge.vue';
import SessionChip from './SessionChip.vue';
import { refreshSubject, startThread, state } from '../store';
import { formatCount, formatRelative } from '../format';

const props = defineProps<{
  kind: 'subject' | 'thread' | null;
  /** 画布数据源名（评论区回复图 / 评论树 / 暂无数据）。 */
  scopeLabel: string;
  /** 图规模与仿真状态：没有图时三项都为 null，参数行只留报告侧数字。 */
  nodes: number | null;
  links: number | null;
  paused: boolean | null;
  settled: boolean | null;
}>();

/**
 * 工作台(app.html)没有宿主页可跟随,主题由这里手动切换:
 * 显式值落在 `html[data-theme]`(tokens.css 的显式入口)并持久到 localStorage,
 * 首次没有持久值时跟随系统 prefers-color-scheme——只影响工作台,评论区仍跟宿主。
 */
const THEME_KEY = 'loupe.theme';
type Theme = 'light' | 'dark';

const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
const persistedTheme = localStorage.getItem(THEME_KEY);
if (persistedTheme === 'light' || persistedTheme === 'dark') {
  document.documentElement.dataset.theme = persistedTheme;
}
const storedTheme = document.documentElement.dataset.theme;
const theme = ref<Theme>(
  storedTheme === 'light' || storedTheme === 'dark'
    ? storedTheme
    : systemDark.matches
      ? 'dark'
      : 'light',
);

/** 还没手动选过时,按钮图标跟着系统走;切过之后 data-theme 恒有值,不再受系统影响。 */
function onSystemThemeChange(): void {
  const explicit = document.documentElement.dataset.theme;
  if (explicit !== 'light' && explicit !== 'dark') theme.value = systemDark.matches ? 'dark' : 'light';
}

function toggleTheme(): void {
  const next: Theme = theme.value === 'dark' ? 'light' : 'dark';
  theme.value = next;
  document.documentElement.dataset.theme = next;
  localStorage.setItem(THEME_KEY, next);
}

function onReduceMotionChange(): void {
  reduceMotion.value = reduceMotionQuery.matches;
}

onMounted(() => {
  systemDark.addEventListener('change', onSystemThemeChange);
  reduceMotionQuery.addEventListener('change', onReduceMotionChange);
  rotateTimer = window.setInterval(() => {
    if (holdNumbers.value || numberSlices.value.length < 2) return;
    activeNumber.value = (activeNumber.value + 1) % numberSlices.value.length;
  }, NUMBER_ROTATE_MS);
  clockTimer = window.setInterval(() => {
    nowTick.value = Date.now();
  }, 30_000);
});
onBeforeUnmount(() => {
  systemDark.removeEventListener('change', onSystemThemeChange);
  reduceMotionQuery.removeEventListener('change', onReduceMotionChange);
  if (rotateTimer !== undefined) window.clearInterval(rotateTimer);
  if (clockTimer !== undefined) window.clearInterval(clockTimer);
});

const result = computed(() =>
  props.kind === 'thread' ? state.thread : props.kind === 'subject' ? state.subject : null,
);
const report = computed(() => result.value?.report ?? null);
const snapshot = computed(() => result.value?.snapshot ?? null);
const limitations = computed(() => (state.session && !state.session.loggedIn ? state.session.limitations : []));
/**
 * 参数行的数字分片：报告侧（评论 / 参与者）与画布侧（节点 / 边）。
 * 两片同时平铺时这一排会变成四个数字、横向拉得很长，于是收进**同一格轮播**——
 * 宽度取两片的最大值，所以换片不跳版；悬停即暂停；`prefers-reduced-motion` 下退回平铺
 * （不做动效，也不再隐藏信息）。
 */
const numberSlices = computed<Array<{ key: string; text: string }>>(() => {
  const slices: Array<{ key: string; text: string }> = [];
  if (report.value !== null && snapshot.value !== null) {
    slices.push({
      key: 'report',
      text: `${formatCount(report.value.overview.total)} 条评论 · ${formatCount(report.value.overview.authors)} 位参与者`,
    });
  }
  if (props.nodes !== null) {
    slices.push({ key: 'graph', text: `${formatCount(props.nodes)} 节点 · ${formatCount(props.links ?? 0)} 边` });
  }
  return slices;
});
const NUMBER_ROTATE_MS = 6000;
const reduceMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const reduceMotion = ref(reduceMotionQuery.matches);
const rotatingNumbers = computed(() => numberSlices.value.length > 1 && !reduceMotion.value);
const activeNumber = ref(0);
/** 悬停 / 键盘焦点在读这一片时停住，别在眼皮底下换掉。 */
const holdNumbers = ref(false);
const numbersText = computed(() => numberSlices.value.map((slice) => slice.text).join(' · '));
watch(numberSlices, (slices) => {
  if (activeNumber.value >= slices.length) activeNumber.value = 0;
});
/**
 * 「抓取于…」必须自己走时：快照不变时组件不会重渲染，之前那句「刚刚」会一直停在刚刚。
 * 30 秒推一次，粒度正好是相对时间的显示精度（分钟）。
 */
const nowTick = ref(Date.now());
const fetchedLabel = computed(() =>
  snapshot.value === null ? '' : `抓取于 ${formatRelative(snapshot.value.fetchedAt, nowTick.value)}`,
);
let rotateTimer: number | undefined;
let clockTimer: number | undefined;
/** 仿真状态：暂停中 / 已收敛 / 仍在跑；还没建图时不出这个 chip。 */
const physicsLabel = computed(() =>
  props.paused === null ? null : props.paused ? '已暂停' : props.settled ? '已收敛' : '仿真中',
);

/** 刷新当前画布数据源：评论树重抓同一棵树，主体走子树级增量。 */
function refresh(): void {
  if (props.kind === 'thread') {
    const focusId = state.thread?.report.focusId;
    if (focusId) void startThread(focusId);
    return;
  }
  void refreshSubject();
}
</script>

<template>
  <header class="top stack">
    <div class="row top-head">
      <span class="row brand">
        <IconChatCircleText class="brand-icon" />
        <strong>Loupe</strong>
        <span class="brand-sub">评鉴</span>
      </span>

      <span v-if="snapshot" class="row subject">
        <span class="title" :title="snapshot.subject.title">{{ snapshot.subject.title }}</span>
        <span v-if="props.kind === 'thread'" class="chip">评论树</span>
      </span>

      <span class="grow" />

      <div class="row top-actions">
        <span v-if="limitations.length" class="chip chip-warning" :title="limitations.join('；')">
          <IconWarningCircle />
          未登录受限
        </span>
        <SessionChip />

        <button
          v-if="result"
          type="button"
          class="btn btn-sm btn-icon"
          title="重新抓取当前视图"
          aria-label="重新抓取当前视图"
          :disabled="!!state.run"
          @click="refresh"
        >
          <IconArrowClockwise />
        </button>
        <button
          type="button"
          class="btn btn-sm btn-icon"
          :title="theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'"
          :aria-label="theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'"
          @click="toggleTheme"
        >
          <IconSun v-if="theme === 'dark'" />
          <IconMoon v-else />
        </button>
      </div>
    </div>

    <p class="row wrap params tnum">
      <!-- ① 数据源：这一排所有数字都属于它，所以它排在最前（连同图标）。 -->
      <IconTreeStructure v-if="props.kind === 'thread'" class="scope-icon" />
      <IconGraph v-else class="scope-icon" />
      <span class="scope-label">{{ props.scopeLabel }}</span>

      <!-- ② 数字：报告侧与画布侧共用一格轮播（悬停暂停；减少动效偏好下平铺） -->
      <template v-if="numberSlices.length > 0">
        <span class="sep" aria-hidden="true">·</span>
        <span
          v-if="rotatingNumbers"
          class="numbers tnum"
          :title="numbersText"
          :aria-label="numbersText"
          @mouseenter="holdNumbers = true"
          @mouseleave="holdNumbers = false"
          @focusin="holdNumbers = true"
          @focusout="holdNumbers = false"
        >
          <span
            v-for="(slice, index) in numberSlices"
            :key="slice.key"
            class="number-slice"
            :class="{ active: index === activeNumber }"
            :aria-hidden="index !== activeNumber"
          >{{ slice.text }}</span>
        </span>
        <template v-else>
          <span v-for="(slice, index) in numberSlices" :key="slice.key">
            <span v-if="index > 0" class="sep minor" aria-hidden="true">·</span>
            <span :class="{ minor: slice.key === 'graph' }">{{ slice.text }}</span>
          </span>
        </template>
      </template>

      <!-- ③ 完整度与抓取时间，④ 状态 chip 收尾。 -->
      <template v-if="report && snapshot">
        <span class="sep" aria-hidden="true">·</span>
        <CompletenessBadge :completeness="snapshot.completeness" compact />
        <span class="minor">{{ fetchedLabel }}</span>
      </template>
      <span v-if="result?.fromSnapshot" class="chip chip-info minor">来自快照</span>
      <span v-if="physicsLabel" class="chip">{{ physicsLabel }}</span>
    </p>
  </header>
</template>

<style scoped>
.top {
  gap: var(--sp-1);
}

/* 轮播格：两片叠在同一格里，格子宽度取较宽的那片，所以换片时整排不跳。 */
.numbers {
  display: inline-grid;
  grid-template-areas: 'slot';
  vertical-align: baseline;
}

.number-slice {
  grid-area: slot;
  transition: opacity 220ms ease;
}

/* 隐掉的片仍参与布局（占位不塌），但不进无障碍树。 */
.number-slice:not(.active) {
  opacity: 0;
  visibility: hidden;
}

/* 第一级：品牌 + 标题 + 动作，动作组不换行，标题自己省略号收尾。 */
.top-head {
  gap: var(--sp-2) var(--sp-3);
  min-width: 0;
}

.top-actions {
  flex: none;
  gap: var(--sp-2);
}

.brand {
  gap: var(--sp-1);
  flex: none;
}

.brand-icon {
  width: 18px;
  height: 18px;
  color: var(--accent);
}

.brand-sub {
  font-size: var(--fs-xs);
  color: var(--fg-subtle);
  letter-spacing: 0.08em;
}

.subject {
  gap: var(--sp-2);
  min-width: 0;
  max-width: 48ch;
}

.title {
  font-size: var(--fs-md);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 第二级：一行参数，比标题低一档；分隔点统一收窄，读起来是一条而不是一堆散件。 */
.params {
  margin: 0;
  /* 参数行在整块顶栏里居中（顶栏宽度由最宽的那一行决定，参数行比它短时否则会偏左）。 */
  justify-content: center;
  gap: var(--sp-2);
  font-size: var(--fs-sm);
  color: var(--fg-muted);
}

/* 第三档：次要元数据（抓取于 … / N 节点 · M 边）。`.minor` 在 App.vue 里只被窄屏隐藏规则用到，
   一直没有视觉规则——等于没生效，这几个词和主指标一样亮、一样大。原型这一档是 --fg-subtle + --fs-xs
   （见 detail-deck 的次要行 L1438）；chip 自带语义色、sep 只是分隔点，两者都不吃这档文字色。 */
.minor {
  font-size: var(--fs-xs);
}

.minor:not(.chip):not(.sep) {
  color: var(--fg-subtle);
}

.scope-icon {
  width: 15px;
  height: 15px;
  color: var(--accent);
}

.scope-label {
  font-weight: 600;
}

/* 参数之间的「·」是分隔线不是文字：原型用 --border-strong（L1378 的内联色），
   浅色下退成极淡的隔断、深色下不至于亮成第二排文字。 */
.sep {
  color: var(--border-strong);
}
</style>
