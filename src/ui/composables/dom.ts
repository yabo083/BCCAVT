/** 视图层共用的 DOM 工具：元素尺寸观察、主题令牌读取（Canvas 需要具体颜色值）。 */
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import type { Ref } from 'vue';

export function useElementSize(target: Ref<HTMLElement | null>) {
  const width = ref(0);
  const height = ref(0);
  let observer: ResizeObserver | null = null;

  const measure = (): void => {
    const el = target.value;
    if (!el) return;
    width.value = el.clientWidth;
    height.value = el.clientHeight;
  };

  onMounted(() => {
    measure();
    observer = new ResizeObserver(measure);
    if (target.value) observer.observe(target.value);
  });

  onBeforeUnmount(() => observer?.disconnect());

  return { width, height, measure };
}

export type CanvasTokens = {
  accent: string;
  accentStrong: string;
  fg: string;
  fgMuted: string;
  fgSubtle: string;
  surface: string;
  surface2: string;
  surface3: string;
  border: string;
  onAccent: string;
  stances: string[];
};

const TOKEN_NAMES: Record<keyof Omit<CanvasTokens, 'stances'>, string> = {
  accent: '--accent',
  accentStrong: '--accent-strong',
  fg: '--fg',
  fgMuted: '--fg-muted',
  fgSubtle: '--fg-subtle',
  surface: '--surface',
  surface2: '--surface-2',
  surface3: '--surface-3',
  border: '--border',
  onAccent: '--fg-on-accent',
};

/**
 * 读一次 CSS 变量，并跟随 prefers-color-scheme 变化与令牌重新解析。
 * 明暗与配色也可能由 `<html data-theme / data-palette / style>` 显式切换（工作台顶栏、跨文档跟随），
 * 那不会触发媒体查询，所以同时盯住根元素这几个属性——否则画布上的文字留在旧主题的颜色里。
 */
export function useCanvasTokens(): Ref<CanvasTokens> {
  const tokens = shallowRef<CanvasTokens>(readTokens());
  let media: MediaQueryList | null = null;
  let observer: MutationObserver | null = null;
  const refresh = (): void => {
    tokens.value = readTokens();
  };

  onMounted(() => {
    media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', refresh);
    observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-palette', 'style'] });
    refresh();
  });

  onBeforeUnmount(() => {
    media?.removeEventListener('change', refresh);
    observer?.disconnect();
  });

  return tokens;
}

function readTokens(): CanvasTokens {
  const styles = getComputedStyle(document.documentElement);
  const value = (name: string): string => styles.getPropertyValue(name).trim() || '#808080';
  const base = Object.fromEntries(
    Object.entries(TOKEN_NAMES).map(([key, name]) => [key, value(name)]),
  ) as Omit<CanvasTokens, 'stances'>;
  return { ...base, stances: [1, 2, 3, 4, 5, 6].map((i) => value(`--c${i}`)) };
}
