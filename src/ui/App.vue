<script setup lang="ts">
/**
 * 工作台外壳：一整张铺满视口的力导向画布，四边浮着玻璃面板。
 *   - 顶部：跨全宽的总览条（品牌 / 标题 / 总数 / 完整度 / 登录态 / 明暗主题切换）
 *   - 左侧：按内容自适应的 tab rail（六个 tab 永远一组）；输入/探索/AI/历史展开内容面板，报告与评论树只切画布数据源
 *   - 右侧：选中评论详情，与左侧 rail 镜像等宽（有选中自动展开，无选中收起成等宽竖条）
 *   - 底部：居中的图工具条（计数与仿真状态、图例、分组、图树切换、缩放/适配/暂停）
 * 画布是主角：面板都贴边、可收起，中心永远留给图。
 * `?view=graph`（页面放大镜打开的图谱窗口）走独立分支：整窗只有力导向图。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Component } from 'vue';
import IconLinkSimple from '~icons/ph/link-simple';
import IconChartBar from '~icons/ph/chart-bar';
import IconTreeStructure from '~icons/ph/tree-structure';
import IconListMagnifyingGlass from '~icons/ph/list-magnifying-glass';
import IconSparkle from '~icons/ph/sparkle';
import IconClockCounterClockwise from '~icons/ph/clock-counter-clockwise';
import IconCollapseLeft from '~icons/ph/caret-double-left';
import IconCollapseRight from '~icons/ph/caret-double-right';
import ErrorBoundary from './components/ErrorBoundary.vue';
import ForceGraph from './components/ForceGraph.vue';
import RunPanel from './components/RunPanel.vue';
import ThreadCanvas from './components/ThreadCanvas.vue';
import ThreadDetailCard from './components/ThreadDetailCard.vue';
import TopBar from './components/TopBar.vue';
import WorkbenchTools from './components/WorkbenchTools.vue';
import AiPanel from './views/AiPanel.vue';
import ExplorerView from './views/ExplorerView.vue';
import GraphPopupView from './views/GraphPopupView.vue';
import HistoryView from './views/HistoryView.vue';
import TargetView from './views/TargetView.vue';
import { collapsibleIds } from './thread';
import { diagnoseThread, locateInReader, startThread, state } from './store';
import type { View } from './store';
import { canonicalVideoUrl } from '@/extension/url';
import type { CommentNode } from '@/core/report';

interface RailItem {
  id: View;
  label: string;
  icon: Component;
  /** 该 tab 有没有可展开的面板内容；报告与评论树只切画布数据源。 */
  body: boolean;
  enabled: () => boolean;
}

const RAIL: RailItem[] = [
  { id: 'target', label: '输入', icon: IconLinkSimple, body: true, enabled: () => true },
  { id: 'subject', label: '报告', icon: IconChartBar, body: false, enabled: () => state.subject !== null },
  { id: 'thread', label: '评论树', icon: IconTreeStructure, body: false, enabled: () => state.thread !== null },
  {
    id: 'explorer',
    label: '探索',
    icon: IconListMagnifyingGlass,
    body: true,
    enabled: () => state.subject !== null || state.thread !== null,
  },
  { id: 'ai', label: 'AI', icon: IconSparkle, body: true, enabled: () => true },
  { id: 'history', label: '历史', icon: IconClockCounterClockwise, body: true, enabled: () => true },
];

const VIEW_TITLES: Record<View, string> = {
  target: '输入面板',
  subject: '主体报告',
  thread: '评论树报告',
  explorer: '评论探索',
  ai: 'AI 解读',
  history: '历史与缓存',
};

const graphRef = ref<InstanceType<typeof ForceGraph> | null>(null);
const dockOpen = ref(false);
const detailCollapsed = ref(true);
const treeMode = ref(false);
const collapsedIds = ref<ReadonlySet<string>>(new Set<string>());
const narrow = ref(false);

/** 画布数据源：报告用主体森林、评论树用子树森林，其余 tab 沿用当前那个（缺哪边退到另一边）。 */
const graphSource = ref<'subject' | 'thread'>('subject');
const canvasKind = computed<'subject' | 'thread' | null>(() => {
  if (graphSource.value === 'thread' && state.thread) return 'thread';
  if (state.subject) return 'subject';
  if (state.thread) return 'thread';
  return null;
});
const canvasResult = computed(() =>
  canvasKind.value === 'thread' ? state.thread : canvasKind.value === 'subject' ? state.subject : null,
);
const canvasRootId = computed(() => {
  if (canvasKind.value !== 'thread') return null;
  const result = state.thread;
  if (!result) return null;
  return result.snapshot.rootId ?? result.report.root.id;
});
const canvasFocusId = computed(() =>
  canvasKind.value === 'thread' ? state.thread?.report.focusId ?? null : null,
);

const selectedNode = computed<CommentNode | null>(() => {
  const id = state.selectedCommentId;
  if (!id) return null;
  return state.subject?.forest.byId.get(id) ?? state.thread?.forest.byId.get(id) ?? null;
});

/** 选中评论所属的主体（主体森林优先，其次评论树）：定位要用它判断这条评论是不是 B 站视频下的。 */
const selectedSubject = computed(() => {
  const id = state.selectedCommentId;
  if (!id) return null;
  if (state.subject?.forest.byId.has(id)) return state.subject.snapshot.subject;
  return state.thread?.forest.byId.has(id) ? state.thread.snapshot.subject : null;
});

/**
 * 「在评论区定位」的规范视频地址；不是 B 站视频、或本窗口只画图（`?view=graph` 那个分支根本不渲染
 * 详情卡，这里再拦一道）时为 null——按钮不出现。
 */
const locateInput = computed(() => {
  const subject = state.graphOnly ? null : selectedSubject.value;
  if (subject === null || subject.ref.platform !== 'bilibili' || subject.ref.kind !== 'video') return null;
  return canonicalVideoUrl(subject.url);
});

/** 详情卡的「在评论区定位」：地址取当前选中评论所属主体的规范地址（失败只写提示，见 store.locateInReader）。 */
function locateSelectedInReader(commentId: string): void {
  const input = locateInput.value;
  if (input !== null) void locateInReader(input, commentId);
}

const threadRoot = computed<CommentNode | null>(() => {
  const result = state.thread;
  if (!result) return null;
  const rootId = result.snapshot.rootId ?? result.report.root.id;
  return rootId ? result.forest.byId.get(rootId) ?? null : null;
});
const canTree = computed(() => canvasKind.value === 'thread' && threadRoot.value !== null);

/** 画布当前画的是哪份数据:评论树模式是子树,否则按 canvasKind 退到主体/评论树。 */
const scopeLabel = computed(() =>
  treeMode.value && state.thread ? '评论树' : canvasResult.value ? '评论区回复图' : '暂无数据',
);

/** 图状态直接读 ForceGraph 暴露的控制面（传了 hideToolbar 之后由这里驱动）。 */
const graphNodes = computed(() => graphRef.value?.nodeCount ?? null);
const graphLinks = computed(() => graphRef.value?.linkCount ?? null);
const graphPaused = computed(() => graphRef.value?.paused ?? null);
const graphSettled = computed(() => graphRef.value?.settled ?? null);

/** 左侧展开面板的容器：换视图的方向类挂它身上（见 playViewTransition）。 */
const dockBody = ref<HTMLElement | null>(null);

/**
 * 面板换视图的方向动效（原型 `.view-pane` / `-forward` / `-backward`）。
 * 手法是「先摘类 → `void offsetWidth` 强制重排 → 再挂类」：同一个容器连续换面板时类名集合前后一样，
 * 浏览器认为动画没变、绝不重播；只有把旧类摘掉、并读一次几何让浏览器把这次改动算进渲染，再挂回去，
 * 才会被当成一次全新的动画从头播。
 */
function playViewTransition(to: View, from: View | null): void {
  const el = dockBody.value;
  if (!el) return;
  // 没有上一个视图（首帧 / 重新打开面板）：无方向地淡入；否则按 rail 里的先后判前后。
  const index = (id: View): number => RAIL.findIndex((item) => item.id === id);
  const cls = from === null ? 'view-pane' : index(to) > index(from) ? 'view-pane-forward' : 'view-pane-backward';
  el.classList.remove('view-pane', 'view-pane-forward', 'view-pane-backward');
  void el.offsetWidth;
  el.classList.add(cls);
}

watch(
  () => state.view,
  (view, prev) => {
    if (view === 'thread') graphSource.value = 'thread';
    else if (view === 'subject') graphSource.value = 'subject';
    dockOpen.value = RAIL.find((item) => item.id === view)?.body ?? false;
    // 面板这一帧才渲染出来（首帧、从报告/评论树切回来时都是新建的元素），等 DOM 落地再挂类。
    if (dockOpen.value) void nextTick(() => playViewTransition(view, prev ?? null));
  },
  { immediate: true },
);

watch(canvasKind, (kind) => {
  if (kind !== 'thread') treeMode.value = false;
});

// 有选中就展开详情、没选中就收起；窄屏下两个面板不同时铺开，避免互相压住。
// immediate：启动时可能已经带着选中（?comment= 或快照），初始状态要跟它一致。
watch(
  selectedNode,
  (node) => {
    detailCollapsed.value = node === null;
    if (node && narrow.value) dockOpen.value = false;
  },
  { immediate: true },
);

watch(dockOpen, (open) => {
  if (open && narrow.value) detailCollapsed.value = true;
});

let media: MediaQueryList | null = null;
function onNarrowChange(): void {
  narrow.value = media?.matches ?? false;
  if (!narrow.value) return;
  // 变窄时立刻收敛到「同时只开一个」：有选中就留详情，否则留 rail。
  if (selectedNode.value) dockOpen.value = false;
  else detailCollapsed.value = true;
}

onMounted(() => {
  media = window.matchMedia('(max-width: 900px)');
  onNarrowChange();
  media.addEventListener('change', onNarrowChange);
});

onBeforeUnmount(() => media?.removeEventListener('change', onNarrowChange));

function openView(id: View): void {
  // 同一个 tab 把收起的面板重新打开：state.view 不变，上面的视图监听不会触发，这里补一次入场。
  const reopen = state.view === id && !dockOpen.value;
  state.view = id;
  // 点已经选中的 tab 时 state.view 不变，视图监听不会触发，这里显式同步一次展开态。
  dockOpen.value = RAIL.find((item) => item.id === id)?.body ?? false;
  if (reopen && dockOpen.value) void nextTick(() => playViewTransition(id, null));
}

function select(id: string): void {
  state.selectedCommentId = id;
}

/** 图上「分析此评论树」：把这条评论当新的分析根重抓它的树。 */
function openThread(id: string): void {
  void startThread(id);
}

function openSelectedSubtree(): void {
  if (state.selectedCommentId) void startThread(state.selectedCommentId);
}

function setMode(next: 'graph' | 'tree'): void {
  treeMode.value = next === 'tree';
  if (treeMode.value) dockOpen.value = false;
}

function toggleCollapse(id: string): void {
  const next = new Set(collapsedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  collapsedIds.value = next;
}

function collapseAll(): void {
  const root = threadRoot.value;
  if (!root) return;
  collapsedIds.value = new Set(collapsibleIds(root).filter((id) => id !== root.comment.id));
}

/** 从别处跳过来的评论：把它的祖先链展开，保证在树列表里可见。 */
watch(
  () => [state.selectedCommentId, state.thread?.snapshot.id] as const,
  () => {
    const node = selectedNode.value;
    if (!node) return;
    const ancestors: string[] = [];
    for (let current = node.parent; current; current = current.parent) ancestors.push(current.comment.id);
    if (!ancestors.some((id) => collapsedIds.value.has(id))) return;
    const next = new Set(collapsedIds.value);
    for (const id of ancestors) next.delete(id);
    collapsedIds.value = next;
  },
  { immediate: true },
);

watch(
  () => state.thread?.snapshot.id,
  () => {
    collapsedIds.value = new Set<string>();
  },
);

function openInputPanel(): void {
  state.view = 'target';
}
</script>

<template>
  <ErrorBoundary v-if="state.graphOnly" title="图谱窗口">
    <GraphPopupView />
  </ErrorBoundary>

  <div v-else class="app shell-stagger">
    <section class="stage" aria-label="评论区可视化画布">
      <ErrorBoundary title="可视化画布">
        <ForceGraph
          v-if="canvasResult && !treeMode"
          ref="graphRef"
          frameless
          hide-toolbar
          focus-on-select
          :forest="canvasResult.forest"
          :root-id="canvasRootId"
          :focus-id="canvasFocusId"
          :selected-id="state.selectedCommentId"
          :diagnosis="canvasKind === 'thread' ? state.diagnosis : null"
          @select="select"
          @open-thread="openThread"
        />
        <div v-else-if="!treeMode" class="stage-empty stack">
          <p class="empty-title">还没有可显示的图</p>
          <p class="small muted">输入一个视频链接开始分析，画布会把整片评论区画成有向回复图。</p>
          <button type="button" class="btn btn-primary" @click="openInputPanel">
            <IconLinkSimple />
            输入分析目标
          </button>
        </div>
      </ErrorBoundary>
    </section>

    <div class="overlay">
      <div class="topstack">
        <TopBar
          class="panel topbar-deck"
          :kind="canvasKind"
          :scope-label="scopeLabel"
          :nodes="treeMode ? null : graphNodes"
          :links="treeMode ? null : graphLinks"
          :paused="graphPaused"
          :settled="graphSettled"
        />

        <div v-if="state.run || state.runError || state.notice" class="panel status">
          <RunPanel />
          <p v-if="state.notice" class="notice" :class="`notice-${state.notice.tone}`" role="status">
            <span class="grow">{{ state.notice.text }}</span>
            <button type="button" class="btn btn-sm btn-ghost" @click="state.notice = null">关闭</button>
          </p>
        </div>
      </div>

      <nav class="panel dock rail-deck" aria-label="工作台导航">
        <div class="rail">
          <button
            v-for="item in RAIL"
            :key="item.id"
            type="button"
            class="rail-item"
            :class="{ active: state.view === item.id }"
            :disabled="!item.enabled()"
            :aria-current="state.view === item.id ? 'page' : undefined"
            @click="openView(item.id)"
          >
            <component :is="item.icon" />
            <span class="rail-label">{{ item.label }}</span>
          </button>
        </div>

        <div v-if="dockOpen" ref="dockBody" class="dock-body">
          <header class="dock-head row">
            <h2 class="dock-title">{{ VIEW_TITLES[state.view] }}</h2>
            <span class="grow" />
            <button
              type="button"
              class="btn btn-sm btn-icon"
              title="收起面板"
              aria-label="收起面板"
              @click="dockOpen = false"
            >
              <IconCollapseLeft />
            </button>
          </header>
          <div class="dock-scroll">
            <ErrorBoundary :title="VIEW_TITLES[state.view]">
              <TargetView v-if="state.view === 'target'" />
              <ExplorerView v-else-if="state.view === 'explorer'" @source-change="graphSource = $event" />
              <AiPanel v-else-if="state.view === 'ai'" />
              <HistoryView v-else-if="state.view === 'history'" />
            </ErrorBoundary>
          </div>
        </div>
      </nav>

      <div v-if="treeMode && state.thread" class="panel sheet">
        <ErrorBoundary title="评论树">
          <ThreadCanvas
            :forest="state.thread.forest"
            :root-id="state.thread.snapshot.rootId ?? state.thread.report.root.id"
            :focus-id="state.thread.report.focusId"
            :selected-id="state.selectedCommentId"
            :diagnosis="state.diagnosis"
            :collapsed="collapsedIds"
            @select="select"
            @toggle-collapse="toggleCollapse"
            @collapse-all="collapseAll"
            @expand-all="collapsedIds = new Set<string>()"
          />
        </ErrorBoundary>
      </div>

      <aside class="panel detail-panel detail-deck" :class="{ collapsed: detailCollapsed }" aria-label="选中评论详情">
        <template v-if="!detailCollapsed">
          <header class="dock-head row">
            <h2 class="dock-title">选中评论</h2>
            <span class="grow" />
            <button
              type="button"
              class="btn btn-sm btn-tonal"
              :disabled="!selectedNode || !!state.run"
              @click="openSelectedSubtree"
            >
              <IconTreeStructure />
              分析此评论树
            </button>
            <button
              type="button"
              class="btn btn-sm btn-icon"
              title="收起详情"
              aria-label="收起详情"
              @click="detailCollapsed = true"
            >
              <IconCollapseRight />
            </button>
          </header>
          <div class="detail-scroll">
            <ThreadDetailCard
              :node="selectedNode"
              :focus-id="canvasFocusId"
              :diagnosis="canvasKind === 'thread' ? state.diagnosis : null"
              :locatable="locateInput !== null"
              @select="select"
              @locate="locateSelectedInReader"
            />
          </div>
        </template>
        <button
          v-else
          type="button"
          class="detail-handle"
          title="展开选中评论详情"
          aria-label="展开选中评论详情"
          @click="detailCollapsed = false"
        >
          <IconCollapseLeft />
          <span class="detail-handle-text">详情</span>
        </button>
      </aside>

      <WorkbenchTools
        class="panel tools tools-deck"
        :kind="canvasKind"
        :mode="treeMode ? 'tree' : 'graph'"
        :can-tree="canTree"
        :paused="graphPaused"
        :forest="canvasResult?.forest ?? null"
        :diagnosis="canvasKind === 'thread' ? state.diagnosis : null"
        :busy="!!state.ai.busy"
        @zoom="graphRef?.zoomBy($event)"
        @fit="graphRef?.resetView()"
        @pause="graphRef?.togglePause()"
        @mode="setMode"
        @diagnose="diagnoseThread()"
        @select="select"
      />
    </div>
  </div>
</template>

<style scoped>
.app {
  position: relative;
  height: 100%;
  overflow: hidden;
  background: var(--bg);
}

/* ── 外壳动效 ──
   两组都逐字对齐原型 tmp/mock-redesign.html：换视图的 `.view-pane*` 与四块浮岛的错峰入场 `island-*`。
   曲线/时长只取 :root 已有令牌；降低动态由 base.css 统一收口，这里不另写 prefers-reduced-motion。 */

/* 左侧面板换视图：方向类由 playViewTransition 挂到 dock-body 上（新视图在 rail 里更靠后就从右滑入）。 */
.view-pane {
  animation: view-fade-in var(--dur-dock) var(--ease-emphasized-decelerate) both;
}

.view-pane-forward {
  animation: view-slide-forward var(--dur-dock) var(--ease-emphasized-decelerate) both;
}

.view-pane-backward {
  animation: view-slide-backward var(--dur-dock) var(--ease-emphasized-decelerate) both;
}

@keyframes view-fade-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes view-slide-forward {
  from {
    opacity: 0;
    transform: translateX(20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes view-slide-backward {
  from {
    opacity: 0;
    transform: translateX(-20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

/* 四块浮岛错峰入场：外壳带着 shell-stagger 画第一帧，四块按 0/50/90/120ms 依次落下（原型同序）。
   每块浮岛只有这一套入场动画——原 dock-in（面板容器）与 detail-in（详情浮岛）已并入这里，
   详情里的内容动效另由卡片自己的 detail-reveal 负责，两者不同元素、不会同时跑。 */
.shell-stagger .topbar-deck {
  animation: island-drop 300ms var(--ease-spring) both;
}

.shell-stagger .rail-deck {
  animation: island-slide-left 320ms var(--ease-spring) 50ms both;
}

.shell-stagger .detail-deck {
  animation: island-slide-right 340ms var(--ease-spring) 90ms both;
}

.shell-stagger .tools-deck {
  animation: island-rise 300ms var(--ease-spring) 120ms both;
}

@keyframes island-drop {
  from {
    opacity: 0;
    transform: translateY(-16px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes island-slide-left {
  from {
    opacity: 0;
    transform: translateX(-16px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes island-slide-right {
  from {
    opacity: 0;
    transform: translateX(16px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes island-rise {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 画布铺满整屏（含面板底下），面板只是浮在它上面。 */
.stage {
  position: absolute;
  inset: 0;
  z-index: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* 位图本身透明,底色由这里给:画布走页面底色 + 极淡点阵,浮层才用 --surface,两者拉开层次。
   点阵取值照原型 .stage-canvas-simulation（L920-928）：--border-strong 60% 混色、20px 网格;
   -10px 偏移只是把半格挪到画布外,让点落在格心而不是被裁掉四分之一。 */
.stage :deep(.surface) {
  background-color: var(--bg);
  background-image: radial-gradient(color-mix(in srgb, var(--border-strong) 60%, transparent) 1px, transparent 1px);
  background-size: 20px 20px;
  background-position: -10px -10px;
}

.stage-empty {
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  padding: var(--sp-5);
  text-align: center;
}

.empty-title {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: 600;
}

/* 浮层网格：四边面板贴边，中间那格留空给画布点选（整层不吃指针事件）。 */
.overlay {
  /* 左右镜像的两个规格:--rail-item-w 让「左侧 rail」与「右侧收起把手」同宽,
     --open-panel-w 让「左侧展开面板」与「右侧展开详情」等宽(左右视觉平衡)。
     取「容器默认大小之美」:两侧都按可用宽度收敛,默认比之前更窄更精致,窄屏另有收紧。 */
  --rail-item-w: 48px;
  --side-w: clamp(238px, 19.5vw, 304px);
  --open-panel-w: calc(var(--side-w) + var(--rail-item-w) + var(--sp-2) * 3 + 2px);

  position: absolute;
  inset: 0;
  z-index: 1;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  grid-template-rows: auto minmax(0, 1fr) auto;
  grid-template-areas:
    'top   top    top'
    'dock  sheet  detail'
    'tools tools  tools';
  gap: var(--sp-3);
  padding: var(--sp-3);
  pointer-events: none;
}

.topstack {
  grid-area: top;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  min-width: 0;
  /* 顶栏是浮动卡片不是通栏：整组自适应宽度并水平居中，窄屏再收紧到可用宽度。 */
  justify-self: center;
  align-self: start;
  width: fit-content;
  max-width: 100%;
  /* 状态条要挂在这块浮岛下面当浮层（见下），所以这里必须是个定位上下文。 */
  position: relative;
}

.topstack > .panel {
  max-width: 100%;
}

/* 运行/提示条：抓取期间文案与行数一直在变，**绝不能参与布局**——它一旦长高，
   中段那一排（左 rail / 画布 / 右侧详情）就被整排顶下去，整场抓取界面一直在跳。
   挂成顶栏下方的浮层：它自己随内容变高变矮，两侧浮岛与画布纹丝不动。 */
.topstack > .status {
  position: absolute;
  top: calc(100% + var(--sp-2));
  left: 50%;
  transform: translateX(-50%);
  width: max-content;
  max-width: min(620px, calc(100vw - var(--sp-3) * 2));
  min-width: 0;
  z-index: 2;
}

.panel {
  --glass-hl: color-mix(in srgb, var(--surface) 92%, transparent);
  --glass-edge: rgb(255 255 255 / 6%);
  --glass-shadow: var(--shadow-2);
  /* 贴边浮岛按所在边收拢的投影（原型四块统一用 --shadow-2，方向性是生产特有的细化）。
     值收进变量只为一件事：深色下整组换成令牌深投影——下面那几条是按浅色调的硬编码色，
     在深色底上等于没有，会把这四块浮岛的高度线索抹掉。 */
  --deck-shadow-top: 0 12px 32px -10px rgb(15 20 30 / 16%), 0 2px 8px rgb(15 20 30 / 5%);
  --deck-shadow-bottom: 0 -12px 32px -10px rgb(15 20 30 / 15%), 0 -2px 8px rgb(15 20 30 / 4%);
  --deck-shadow-side: 18px 0 40px -16px rgb(15 20 30 / 16%), 3px 0 10px rgb(15 20 30 / 4%);

  /* 底色/模糊/边框/圆角逐条对齐原型 .glass-deck（mock-redesign.html L1002-1009）：
     surface 90% + blur(18px) + border 75% + --r-md。 */
  border: 1px solid color-mix(in srgb, var(--border) 75%, transparent);
  border-radius: var(--r-md);
  background: color-mix(in srgb, var(--surface) 90%, transparent);
  backdrop-filter: blur(18px);
  /* 两层阴影:外层把面板从画布上抬起,内层顶边高光给玻璃厚度感。 */
  box-shadow:
    var(--glass-shadow),
    inset 0 1px 0 var(--glass-hl),
    inset 0 0 0 1px var(--glass-edge);
  pointer-events: auto;
}

/* 贴边面板的阴影按所在边收拢:顶/底不往画布外飘,侧向更立体。 */
.topstack > .panel {
  box-shadow:
    var(--deck-shadow-top),
    inset 0 1px 0 var(--glass-hl),
    inset 0 0 0 1px var(--glass-edge);
}

.tools {
  box-shadow:
    var(--deck-shadow-bottom),
    inset 0 -1px 0 var(--glass-hl),
    inset 0 0 0 1px var(--glass-edge);
}

.dock,
.detail-panel {
  box-shadow:
    var(--deck-shadow-side),
    inset 0 1px 0 var(--glass-hl),
    inset 0 0 0 1px var(--glass-edge);
}

/* 暗色下阴影吃不住:换深投影、弱化顶边高光。底色不再单独抬高——原型两套都是 surface 90%。 */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) .panel {
    --glass-hl: rgb(255 255 255 / 7%);
    --glass-edge: rgb(255 255 255 / 5%);
    --glass-shadow: 0 16px 44px rgb(0 0 0 / 52%), 0 4px 12px rgb(0 0 0 / 34%);
    --deck-shadow-top: var(--glass-shadow);
    --deck-shadow-bottom: var(--glass-shadow);
    --deck-shadow-side: var(--glass-shadow);
  }
}

:root[data-theme='dark'] .panel {
  --glass-hl: rgb(255 255 255 / 7%);
  --glass-edge: rgb(255 255 255 / 5%);
  --glass-shadow: 0 16px 44px rgb(0 0 0 / 52%), 0 4px 12px rgb(0 0 0 / 34%);
  --deck-shadow-top: var(--glass-shadow);
  --deck-shadow-bottom: var(--glass-shadow);
  --deck-shadow-side: var(--glass-shadow);
}

.topstack > .panel,
.dock,
.detail-panel,
.tools,
.sheet,
.status {
  padding: var(--sp-2) var(--sp-3);
}

/* 顶栏浮岛横向照原型 .topbar-deck（L1011-1019）用 sp-4：参数行贴到圆角边上不再挤在 12px 里。 */
.topstack > .panel {
  padding: var(--sp-2) var(--sp-4);
}

.status {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.notice {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: 0;
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-sm);
  font-size: var(--fs-sm);
  background: var(--info-bg);
  color: var(--info);
}

/* ── 左侧:按内容自适应的图标 rail + 可展开面板 ── */
.dock {
  grid-area: dock;
  display: flex;
  gap: var(--sp-2);
  padding: var(--sp-2);
  min-height: 0;
  /* 高度按内容自适应：默认就只有一列图标 rail 那么高，展开的面板长到中段上限后由内部滚动，
     不再一进来就占满整个中段（右下的详情面板同理，两侧保持同样的收放口径）。 */
  align-self: start;
  max-height: 100%;
}

/* 六个 tab 永远是一组：纵向排布、**从面板顶边往下**排，不拆成上下两块。
   刻意不用居中：面板是按内容自适应的，居中会让这一组图标随面板高度（点开/收起内容面板）上下平移，
   位置每次都在变。锚在顶边后，面板只会往下长，图标一个像素都不动。
   间距照原型 .rail-deck（L1039-1045）。 */
.rail {
  display: flex;
  flex-direction: column;
  align-self: flex-start;
  justify-content: flex-start;
  gap: var(--sp-1);
  flex: none;
}

.rail-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  width: var(--rail-item-w);
  padding: var(--sp-2) 2px;
  border: 0;
  border-radius: var(--r-md);
  background: transparent;
  color: var(--fg-muted);
  font-size: var(--fs-xs);
  /* 原型 rail 标签一律 600（L1047-1061）：11px 的中文在深色浮岛上 400 太细，
     激活态只靠底色 + 描边 + 主色区分，不靠字重。 */
  font-weight: 600;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-standard),
    color var(--dur-fast) var(--ease-standard),
    box-shadow var(--dur-fast) var(--ease-standard),
    transform var(--dur-fast) var(--ease-spring);
}

.rail-item svg {
  width: 19px;
  height: 19px;
  transition: transform var(--dur) var(--ease-spring);
}

.rail-item:hover:not(:disabled) {
  background: var(--surface-2);
  color: var(--fg);
}

.rail-item.active {
  background: var(--accent-bg);
  color: var(--accent-strong);
  /* 激活态 = 底色 + inset 细描边（原型 .rail-tab-btn.active L1064-1068）：
     浅色下把浅青块从白玻璃上框出来，深色下靠更亮的青描边定形，光靠 --accent-bg 在深色里几乎看不出块。 */
  box-shadow: inset 0 0 0 1px var(--accent-border);
  transition:
    background var(--dur) var(--ease-emphasized),
    color var(--dur) var(--ease-emphasized),
    box-shadow var(--dur) var(--ease-emphasized);
}

/* 当前 tab 的图标抬一格，切换时沿 emphasized 滑到位而不是瞬移。 */
.rail-item.active svg {
  transform: scale(1.08);
}

.rail-item:active:not(:disabled) {
  transform: scale(0.96);
}

.rail-item:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.rail-label {
  letter-spacing: 0.02em;
}

.dock-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  width: var(--side-w);
  padding: var(--sp-1) var(--sp-2) 0 var(--sp-3);
  border-left: 1px solid var(--border);
  /* 面板展开不做宽度补间（会抖内容）：宽度直接就位，入场动画由 JS 按切换方向挂的 view-pane* 负责，
     所以这里不写 animation——同一块容器上不该再挂第二套入场动画。 */
}

.dock-head {
  gap: var(--sp-2);
  /* 标题栏压实一档（原 sp-2 下边距在长面板里显得笨重），分隔线仍用 --border。 */
  padding-bottom: var(--sp-1);
  border-bottom: 1px solid var(--border);
  flex: none;
}

.dock-title {
  font-size: var(--fs-sm);
  font-weight: 600;
  letter-spacing: 0.01em;
}

.dock-scroll {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  /* 面板高度按内容自适应（见 `.dock`），长内容由这里滚动——上限就是中段那一格的高度。 */
  overflow-y: auto;
  padding-right: var(--sp-1);
  padding-bottom: var(--sp-2);
}

/* 面板里不再叠卡片：清掉卡面与阴影，只用分区标题的细线分节。 */
.dock-scroll :deep(.card) {
  background: transparent;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  padding: 0;
}

.dock-scroll :deep(.card-head) {
  border-bottom: 1px solid var(--border);
  padding-bottom: var(--sp-2);
  margin-bottom: var(--sp-3);
}

/* ── 中间：评论树列表（可选阅读方式） ── */
.sheet {
  grid-area: sheet;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: var(--sp-3);
}

/* ── 右侧:选中评论详情(与左侧镜像:同起同止,展开等宽、收起同宽) ── */
.detail-panel {
  grid-area: detail;
  display: flex;
  flex-direction: column;
  min-height: 0;
  /* 与左侧 `.dock` 同一口径：按内容自适应高度，长详情到中段上限后由 `detail-scroll` 滚动。 */
  align-self: start;
  max-height: 100%;
  width: var(--open-panel-w);
  /* 四面 sp-3，照原型 .detail-deck（L1070-1079）。 */
  padding: var(--sp-3);
  /* 展开/收起不做宽度补间（会抖内容）：浮岛的入场动画只有 shell-stagger 的 island-slide-right（首帧一次），
     展开/换选的内容动效归卡片自己的 detail-reveal——一块浮岛只跑一套入场动画。 */
}

/* 收起态：面板本体（.panel 的玻璃底 / 边框 / 投影）全部让给把手，避免「方板 + 内层把手」叠成两层壳。
   **顶边与展开态对齐（align-self: start）**：展开/收起切换时这一侧的上边缘不动，
   只换形态（竖把手 ↔ 面板），不然整块会从屏幕中间跳回顶部。
   **与其余三块浮岛同规格**：同样留在 `.overlay` 的 12px 内边距里、同样四面圆角——
   单独一枚贴壁的方角书签在四块浮岛之间会显得是另一个体系。 */
.detail-panel.collapsed {
  width: auto;
  padding: 0;
  align-self: start;
  border: 0;
  border-radius: 0;
  background: transparent;
  backdrop-filter: none;
  box-shadow: none;
}

.detail-scroll {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding-bottom: var(--sp-2);
}

/* 收起把手：一枚竖向小浮岛，规格与其余三块浮岛一致（`--r-md` 四面圆角、四面描边、玻璃底）。
   hover 向左微弹一下表示「可以拉出来」，图标与文字都是竖排的两字。 */
.detail-handle {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-1);
  width: 32px;
  height: 104px;
  padding: var(--sp-2) 0;
  border: 1px solid color-mix(in srgb, var(--border) 75%, transparent);
  border-radius: var(--r-md);
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  backdrop-filter: blur(18px);
  box-shadow: var(--deck-shadow-side), inset 0 1px 0 var(--glass-hl);
  color: var(--fg-muted);
  font-size: var(--fs-xs);
  cursor: pointer;
  transition:
    transform var(--dur-fast) var(--ease-spring),
    background var(--dur-fast) var(--ease-standard),
    color var(--dur-fast) var(--ease-standard);
}

.detail-handle:hover {
  transform: translateX(-4px);
  background: var(--surface);
  color: var(--accent);
}

.detail-handle:active {
  transform: translateX(-2px) scale(0.98);
}

.detail-handle svg {
  width: 14px;
  height: 14px;
  transition: transform var(--dur) var(--ease-spring);
}

.detail-handle:hover svg {
  transform: translateX(-2px);
}

/* 竖排两字：一列一个字符（比 writing-mode 更好控行距与字重）。 */
.detail-handle-text {
  display: flex;
  flex-direction: column;
  align-items: center;
  font-weight: 600;
  line-height: 1.15;
}

/* 降级时取消把手的位移。base.css 的全局规则只压缩时长，改不到「位置变了」这件事本身。 */
@media (prefers-reduced-motion: reduce) {
  .detail-handle:hover,
  .detail-handle:active {
    transform: none;
  }
}

.tools {
  grid-area: tools;
  /* 底部一条居中的工具条:贴内容宽度,窄屏放不下时仍换行铺满。 */
  justify-self: center;
  width: fit-content;
}

/* ── 窄屏：面板收窄贴边，rail 仍在最左；同一时刻只铺开一个面板（JS 互斥），中心不被叠死 ── */
@media (max-width: 900px) {
  .overlay {
    gap: var(--sp-2);
    padding: var(--sp-2);
    --rail-item-w: 42px;
    --side-w: min(232px, 68vw);
  }

  .rail-item {
    font-size: 10px;
    gap: 2px;
  }

  /* 窄屏只留规格里的那几项总览(条数 / 参与者 / 完整度 / 登录态),其余次要元数据让位给画布。 */
  .topstack :deep(.minor) {
    display: none;
  }

  /* 详情展开时不越过左侧竖栏留出的余量,避免窄屏横向溢出。 */
  .detail-panel {
    width: min(var(--open-panel-w), calc(100vw - var(--rail-item-w) - var(--sp-2) * 7 - 2px));
  }
}
</style>
