<script setup lang="ts">
/**
 * 顶部浮动总览，分两级：
 *   第一级「是什么」——品牌、当前画布数据源的主体标题、右侧动作（刷新 / 主题配色 / 明暗主题）；
 *   第二级「多少、什么状态」——评论/参与者/完整度/登录态/抓取于/来自快照，
 *   同一排接上画布的图数据源、节点·边计数与仿真状态（这三项原来压在底部工具条左端，
 *   工具条只该放工具，参数归顶栏）。
 * 输入与抓取选项在左侧「输入」面板里（TargetView），这里只读不写。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import IconChatCircleText from '~icons/ph/chat-circle-text';
import IconGraph from '~icons/ph/graph';
import IconTreeStructure from '~icons/ph/tree-structure';
import IconArrowClockwise from '~icons/ph/arrow-clockwise';
import IconWarningCircle from '~icons/ph/warning-circle';
import IconSun from '~icons/ph/sun';
import IconMoon from '~icons/ph/moon-stars';
import CompletenessBadge from './CompletenessBadge.vue';
import PalettePicker from './PalettePicker.vue';
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

onMounted(() => systemDark.addEventListener('change', onSystemThemeChange));
onBeforeUnmount(() => systemDark.removeEventListener('change', onSystemThemeChange));

const result = computed(() =>
  props.kind === 'thread' ? state.thread : props.kind === 'subject' ? state.subject : null,
);
const report = computed(() => result.value?.report ?? null);
const snapshot = computed(() => result.value?.snapshot ?? null);
const limitations = computed(() => (state.session && !state.session.loggedIn ? state.session.limitations : []));
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
        <PalettePicker />
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
      <template v-if="report && snapshot">
        <span>{{ formatCount(report.overview.total) }} 条评论</span>
        <span class="sep" aria-hidden="true">·</span>
        <span>{{ formatCount(report.overview.authors) }} 位参与者</span>
        <span class="sep" aria-hidden="true">·</span>
        <CompletenessBadge :completeness="snapshot.completeness" compact />
        <span class="sep" aria-hidden="true">·</span>
        <span>{{ snapshot.auth === 'user' ? '登录态' : '匿名' }}</span>
        <span class="sep minor" aria-hidden="true">·</span>
        <span class="minor">抓取于 {{ formatRelative(snapshot.fetchedAt) }}</span>
        <template v-if="result?.fromSnapshot">
          <span class="sep minor" aria-hidden="true">·</span>
          <span class="chip chip-info minor">来自快照</span>
        </template>
      </template>

      <span class="sep" aria-hidden="true">·</span>
      <IconTreeStructure v-if="props.kind === 'thread'" class="scope-icon" />
      <IconGraph v-else class="scope-icon" />
      <span class="scope-label">{{ props.scopeLabel }}</span>
      <template v-if="props.nodes !== null">
        <span class="minor">{{ formatCount(props.nodes) }} 节点 · {{ formatCount(props.links ?? 0) }} 边</span>
        <span v-if="physicsLabel" class="chip">{{ physicsLabel }}</span>
      </template>
    </p>
  </header>
</template>

<style scoped>
.top {
  gap: var(--sp-1);
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
