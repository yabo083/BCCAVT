<script setup lang="ts">
/**
 * 工具栏弹窗：Loupe 的紧凑设置面板（不加载工作台导航 / 分析输入 / 报告 / AI）。
 * 只读写 chrome.storage.local 里的一个页面级设置，并跟随外部变化：
 *   - 自绘评论区开关（替换原生评论区，默认关闭）。
 * 读盘完成前禁用控件：避免用默认值把用户真实设置覆盖掉；写入进行中也禁用控件：
 * 避免并发写入把回滚建立在一个已被新值覆盖的前值上。写入被拒时回滚本地值并提示。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import IconArrowSquareOut from '~icons/ph/arrow-square-out';
import IconSlidersHorizontal from '~icons/ph/sliders-horizontal';
import IconWarningCircle from '~icons/ph/warning-circle';
import PalettePicker from './components/PalettePicker.vue';
import { PAGE_COMMENTS_ENABLED_KEY } from '@/extension/page-comments';

const enabled = ref(false);
/** 读盘完成前禁用控件，避免用默认值把用户真实设置覆盖掉。 */
const ready = ref(false);
/** 写入进行中：禁用控件，避免并发写入把回滚建立在一个已被新值覆盖的前值上。 */
const saving = ref(false);
const error = ref<string | null>(null);

/** 次级命令的落地：整页工作台（`?view=tab`），不再有侧栏这条路。 */
const WORKBENCH_URL = 'src/ui/app.html?view=tab';

function describeFailure(action: string, cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return `${action}失败：${message}`;
}

function onStorageChanged(changes: Record<string, chrome.storage.StorageChange>, area: string): void {
  if (area !== 'local') return;
  const enabledChange = changes[PAGE_COMMENTS_ENABLED_KEY];
  if (enabledChange !== undefined) enabled.value = enabledChange.newValue === true;
}

/** 写入一项设置；失败时返回 false，由调用方回滚本地值并提示。 */
async function persist(key: string, value: unknown): Promise<boolean> {
  saving.value = true;
  try {
    await chrome.storage.local.set({ [key]: value });
    error.value = null;
    return true;
  } catch (cause) {
    error.value = describeFailure('保存设置', cause);
    return false;
  } finally {
    saving.value = false;
  }
}

async function onToggle(event: Event): Promise<void> {
  const next = (event.target as HTMLInputElement).checked;
  const previous = enabled.value;
  enabled.value = next;
  if (!(await persist(PAGE_COMMENTS_ENABLED_KEY, next))) enabled.value = previous;
}

async function openWorkbench(): Promise<void> {
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL(WORKBENCH_URL) });
    window.close();
  } catch (cause) {
    error.value = describeFailure('打开完整工作台', cause);
  }
}

onMounted(async () => {
  try {
    const bag = await chrome.storage.local.get(PAGE_COMMENTS_ENABLED_KEY);
    enabled.value = bag[PAGE_COMMENTS_ENABLED_KEY] === true;
    ready.value = true;
    chrome.storage.onChanged.addListener(onStorageChanged);
  } catch (cause) {
    // 读不到真实设置就不能让用户改：保持禁用并说明原因，避免用默认值覆盖已存设置
    error.value = describeFailure('读取设置', cause);
  }
});

onBeforeUnmount(() => chrome.storage.onChanged.removeListener(onStorageChanged));
</script>

<template>
  <main class="config">
    <header class="config-head">
      <IconSlidersHorizontal class="config-mark" aria-hidden="true" />
      <div>
        <h1 class="config-title">Loupe · 评鉴</h1>
      </div>
    </header>

    <p v-if="error" class="config-error" role="alert">
      <IconWarningCircle aria-hidden="true" />
      <span>{{ error }}</span>
    </p>

    <!-- 页面设置：一行一个设置（左名右控件），解释全部收进 title（悬停才出现），正文不写说明文 -->
    <section class="config-group" aria-label="页面设置">
      <label
        class="config-row clickable"
        title="把 B 站视频页的原生评论区换成 Loupe 自绘评论区：评论树由扩展自己抓取，点赞/回复/发评都在自绘区完成；关闭即恢复原生评论区"
      >
        <span class="config-name">自绘评论区</span>
        <input class="switch" type="checkbox" :checked="enabled" :disabled="!ready || saving" @change="onToggle" />
      </label>
    </section>

    <section class="config-group" aria-label="外观">
      <PalettePicker label="主题配色" />
    </section>

    <button
      type="button"
      class="btn btn-sm btn-ghost config-open"
      title="输入分析对象、查看评论树/图谱与 AI 诊断等完整功能在工作台"
      @click="openWorkbench"
    >
      <IconArrowSquareOut aria-hidden="true" />
      <span>打开工作台</span>
    </button>
  </main>
</template>

<style scoped>
.config {
  width: 320px;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-4);
}

.config-head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

.config-mark {
  width: 22px;
  height: 22px;
  flex: none;
  color: var(--accent);
}

.config-title {
  font-size: var(--fs-lg);
  font-weight: 600;
  line-height: var(--lh-tight);
}

.config-error {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2);
  margin: 0;
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-sm);
  background: var(--error-bg);
  color: var(--error);
  font-size: var(--fs-sm);
}

.config-error svg {
  width: 15px;
  height: 15px;
  flex: none;
  margin-top: 2px;
}

/* 分组：同块设置共用一块轻底面，内边距收窄，纵向紧贴（正文只有控件本身，没有说明行）。 */
.config-group {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  padding: var(--sp-2);
  border-radius: var(--r-md);
  background: var(--surface-2);
}

/* 一行设置：左名右控件，两端对齐；行内 hover 提亮（沿 base.css 的 state layer 思路）。 */
.config-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  min-height: 28px;
  padding: 0 var(--sp-2);
  border-radius: var(--r-sm);
}

/* 整行可点的布尔行：文字与控件一起接 hover，点击落点大。 */
.config-row.clickable {
  cursor: pointer;
}

.config-row.clickable:hover {
  background: var(--surface-3);
}

/* 点名：次要层级（与 .field > label 同一套字号字重），不占独立一行。 */
.config-name {
  font-size: var(--fs-sm);
  font-weight: 500;
  color: var(--fg-muted);
}

.config-open {
  align-self: flex-start;
}
</style>
