<script setup lang="ts">
/**
 * 主题配色选择器（5 套预设色点 + 自定义取色器）。工作台顶栏与工具栏设置弹窗挂的是同一个组件。
 *
 * 它自己读写 `loupe.palette`：挂载读一次、跟随 `chrome.storage.onChanged`（另一处改了这里跟着变），
 * 点选即应用并持久化——所以两处入口天然同步，不需要把状态提到 store 里。
 * 选中态**不靠颜色**表达（外圈加粗 + 内点缩小）：灰度下也认得出当前是哪一颗。
 * 取色器的值同样过 `normalizePalette`（非 `#rrggbb` 一律回落，不写进 DOM）。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import {
  DEFAULT_PALETTE,
  PALETTES,
  PRESET_LIGHT_ACCENT,
  applyPalette,
  loadPalette,
  normalizePalette,
  savePalette,
  watchPalette,
} from '../theme';
import type { PaletteId, PalettePref } from '../theme';

defineProps<{
  /** 给设置面板那种「有标题的表单」用的可见标题；顶栏紧凑场景不传。 */
  label?: string;
}>();

const palette = ref<PalettePref>({ ...DEFAULT_PALETTE });
/** 取色器的值：有自定义主色就用它，否则是当前预设的浅色主色（深色主题下也拿浅色基准）。 */
const customColor = ref(PRESET_LIGHT_ACCENT.teal);
let unwatch: (() => void) | null = null;

/**
 * 取色器的值跟着当前主色走：自定义就是那个 hex，预设就是该预设的浅色主色。
 * 不跟的话，切到别的预设后取色器还停在上一个色，用户拿它微调会从错的地方起步。
 */
function syncCustomColor(pref: PalettePref): void {
  const preset = PALETTES.find((option) => option.id === pref.id);
  customColor.value = pref.custom ?? PRESET_LIGHT_ACCENT[preset?.id ?? 'teal'];
}

function commit(pref: PalettePref): void {
  palette.value = pref;
  syncCustomColor(pref);
  applyPalette(pref);
  void savePalette(pref);
}

function choose(id: Exclude<PaletteId, 'custom'>): void {
  commit({ id, custom: null });
}

function onCustomColor(event: Event): void {
  const pref = normalizePalette({ id: 'custom', custom: (event.target as HTMLInputElement).value });
  if (pref.id !== 'custom' || pref.custom === null) return;
  commit(pref);
}

onMounted(async () => {
  const pref = await loadPalette();
  palette.value = pref;
  syncCustomColor(pref);
  unwatch = watchPalette((next) => {
    palette.value = next;
    syncCustomColor(next);
  });
});

onBeforeUnmount(() => unwatch?.());
</script>

<template>
  <div class="palette-field">
    <!-- 标题只是视觉分组：分组名由下面 radiogroup 的 aria-label 给读屏，别重复播报。 -->
    <span v-if="label" class="palette-caption" aria-hidden="true">{{ label }}</span>
    <div class="palette" role="radiogroup" aria-label="主题配色">
      <button
        v-for="option in PALETTES"
        :key="option.id"
        type="button"
        class="palette-dot"
        role="radio"
        :aria-checked="palette.id === option.id"
        :title="option.label"
        :aria-label="option.label"
        :style="{ '--dot': option.swatch }"
        @click="choose(option.id)"
      />
      <!-- 自选颜色入口：不是第 6 颗预设——彩虹环是「自选颜色」的图标语义（吸管/调色盘），
           选中自定义后才实心显示那个颜色。label 包住真正的 input（透明铺满），
           点击与键盘 Tab 都能唤起系统取色器。 -->
      <label
        class="palette-custom"
        :class="{ 'is-active': palette.custom !== null }"
        :style="{ '--dot': customColor }"
      >
        <input
          class="palette-input"
          type="color"
          aria-label="自定义主色"
          :value="customColor"
          @change="onCustomColor"
        />
      </label>
    </div>
  </div>
</template>

<style scoped>
.palette-field {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  min-width: 0;
}

/* 与 base.css 的 `.field > label` 同一套排版：标题是次要信息，色点才是控件。 */
.palette-caption {
  font-size: var(--fs-sm);
  font-weight: 500;
  color: var(--fg-muted);
}

/* 一排紧凑色点：窄到设置面板的 320px 也能一行放下（放不下就换行，不挤成一团）。 */
.palette {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  flex-wrap: wrap;
}

.palette-dot,
.palette-custom {
  width: 18px;
  height: 18px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  background: none;
  cursor: pointer;
  transition:
    border-color var(--dur-fast) var(--ease-standard),
    transform var(--dur-micro) var(--ease-spring);
}

/* 色点本体 15px，底色来自行内 `--dot`（swatch 是这里唯一允许的硬编码颜色）。 */
.palette-dot::after {
  content: '';
  display: block;
  width: 15px;
  height: 15px;
  margin: auto;
  border-radius: var(--r-pill);
  background: var(--dot);
}

/* 选中态不靠颜色表达：外圈加粗到 2px、内点收到 11px，灰度下也认得出是哪一颗。 */
.palette-dot[aria-checked='true'] {
  border-width: 2px;
  border-color: var(--fg);
}

.palette-dot[aria-checked='true']::after {
  width: 11px;
  height: 11px;
}

.palette-dot:hover,
.palette-custom:hover {
  border-color: var(--fg-muted);
}

.palette-dot:active,
.palette-custom:active {
  transform: scale(0.9);
}

/* 自选颜色入口：与预设色点之间留一档间距并加一个「+」，一眼读作「更多/自选」而不是第 6 颗预设。
   未选自定义时是彩虹环（唯一的硬编码颜色：它不是产品配色，是「自选颜色」的图标语义）；
   选中自定义后实心显示当前自定义主色。选中态与预设同一套（外圈加粗 + 内点缩小）。 */
.palette-custom {
  position: relative;
  display: block;
  width: 18px;
  height: 18px;
  margin-left: var(--sp-2);
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  cursor: pointer;
  transition:
    border-color var(--dur-fast) var(--ease-standard),
    transform var(--dur-micro) var(--ease-spring);
}

/* 彩虹环铺在边框内侧的圆环上，中心镂空露出底色（「+」就坐在镂空里）。 */
.palette-custom::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: var(--r-pill);
  padding: 2px;
  background: conic-gradient(
    from 200deg,
    #f66 0%,
    #fc3 18%,
    #fe6 32%,
    #6c6 48%,
    #4bc 66%,
    #55f 82%,
    #d59 100%
  );
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  mask-composite: exclude;
}

/* 未选中：中心镂空里一个「+」提示可自选；实心色由 is-active 的 ::after 盖上。 */
.palette-custom::after {
  content: '+';
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--fg-muted);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
}

.palette-custom.is-active::before {
  content: none;
}

.palette-custom.is-active::after {
  content: '';
  width: 15px;
  height: 15px;
  margin: auto;
  border-radius: var(--r-pill);
  background: var(--dot);
}

/* 选中态与预设色点同一套：外圈加粗 + 内点缩小，灰度下也认得出当前是哪一颗。 */
.palette-custom.is-active {
  border-width: 2px;
  border-color: var(--fg);
}

.palette-custom.is-active::after {
  width: 11px;
  height: 11px;
}

.palette-custom:hover {
  border-color: var(--fg-muted);
}

.palette-custom:active {
  transform: scale(0.9);
}

/* 真正的取色器：透明铺满 label，点击/键盘都可及；视觉全由 label 画。 */
.palette-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  padding: 0;
  border: 0;
  cursor: pointer;
}
</style>
