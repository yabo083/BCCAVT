/**
 * 主题配色（accent 系）：与「明暗」正交的一条轴。
 *   1) 预设 5 套走 `<html data-palette='x'>` 属性选择器（tokens.css 末尾）；
 *   2) 自定义只写内联变量（`data-palette='custom'` + --accent* 四个令牌），预设与自定义都只动
 *      accent 系令牌，中性色阶与语义色不受影响。
 * chrome.storage.local 里的内容是**不可信输入**：读盘一律过 normalizePalette，非法值回落默认；
 * 自定义主色必须是 `#rrggbb`（取色器与手写存储都按这个口径校验）。
 * 所有 document / chrome 访问都要在没有它们的环境里安静退让（单测跑在 happy-dom 下，没有扩展 API）。
 */
export type PaletteId = 'teal' | 'pink' | 'blue' | 'violet' | 'amber' | 'custom';

export interface PalettePref {
  id: PaletteId;
  /** 仅 `id === 'custom'` 时有值，且必为小写 `#rrggbb`；预设配色恒为 null。 */
  custom: string | null;
}

export const PALETTE_KEY = 'loupe.palette';

/** 预设配色：label 供色点的 title/aria-label，swatch 是色点底色（色点之外不硬编码颜色）。 */
export const PALETTES: readonly { id: Exclude<PaletteId, 'custom'>; label: string; swatch: string }[] = [
  { id: 'teal', label: '经典青墨', swatch: '#45c2c0' },
  { id: 'pink', label: '哔哩粉', swatch: '#fb7299' },
  { id: 'blue', label: '极光蓝', swatch: '#60a5fa' },
  { id: 'violet', label: '暗夜紫', swatch: '#a78bfa' },
  { id: 'amber', label: '琥珀金', swatch: '#fbbf24' },
];

export const DEFAULT_PALETTE: PalettePref = { id: 'teal', custom: null };

/**
 * 预设的浅色主色：取色器在「没有自定义值」时的落点。
 * 不能读 `--accent` 的计算值——深色主题下那是另一套取值，取色器要的是浅色基准。
 */
export const PRESET_LIGHT_ACCENT: Readonly<Record<Exclude<PaletteId, 'custom'>, string>> = {
  teal: '#0e6d74',
  pink: '#fb7299',
  blue: '#1d4ed8',
  violet: '#7c3aed',
  amber: '#b45309',
};

const HEX_RE = /^#[0-9a-f]{6}$/i;

/** 内联覆盖的令牌。预设模式必须逐个清掉：残留的内联值会赢过属性选择器，把整套色带偏。 */
const INLINE_KEYS = ['--accent', '--accent-strong', '--accent-bg', '--accent-border', '--selection-bg'] as const;

/**
 * 存储读回来的东西一律过这里：非对象、未知 id、非法 hex 全部回落默认。
 * 预设 id 不带自定义值（custom 只在 `id === 'custom'` 时有意义），所以顺手清成 null。
 */
export function normalizePalette(value: unknown): PalettePref {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_PALETTE };
  const { id, custom } = value as { id?: unknown; custom?: unknown };
  if (id === 'custom') {
    const hex = typeof custom === 'string' ? custom.trim().toLowerCase() : '';
    return HEX_RE.test(hex) ? { id: 'custom', custom: hex } : { ...DEFAULT_PALETTE };
  }
  const preset = typeof id === 'string' ? PALETTES.find((option) => option.id === id) : undefined;
  return preset ? { id: preset.id, custom: null } : { ...DEFAULT_PALETTE };
}

/** 把配色落到 `<html>`：预设靠属性选择器，自定义写内联变量；两者都先清掉上一次的内联覆盖。 */
export function applyPalette(pref: PalettePref): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const key of INLINE_KEYS) root.style.removeProperty(key);
  root.dataset.palette = pref.id;

  const hex = pref.id === 'custom' && pref.custom !== null && HEX_RE.test(pref.custom)
    ? pref.custom.toLowerCase()
    : null;
  if (hex === null) return;

  root.style.setProperty('--accent', hex);
  root.style.setProperty('--accent-strong', hex);
  root.style.setProperty('--accent-bg', `color-mix(in srgb, ${hex} 18%, transparent)`);
  root.style.setProperty('--accent-border', `color-mix(in srgb, ${hex} 40%, transparent)`);
}

/** 没有扩展 API（单测 / 非扩展页面）时当作「没存过」，不抛错。 */
function storageArea(): chrome.storage.StorageArea | null {
  if (typeof chrome === 'undefined') return null;
  return chrome.storage?.local ?? null;
}

export async function loadPalette(): Promise<PalettePref> {
  const area = storageArea();
  if (!area) return { ...DEFAULT_PALETTE };
  try {
    const bag = await area.get(PALETTE_KEY);
    return normalizePalette(bag[PALETTE_KEY]);
  } catch {
    return { ...DEFAULT_PALETTE };
  }
}

export async function savePalette(pref: PalettePref): Promise<void> {
  const area = storageArea();
  if (!area) return;
  try {
    await area.set({ [PALETTE_KEY]: pref });
  } catch {
    // 写失败只影响下次启动读回来的值，当前会话已经生效，不打断界面。
  }
}

/** 挂载前调用：读回已存配色并应用，失败照样用默认配色落地（界面绝不能因为配色挂不上）。 */
export async function applyStoredPalette(): Promise<PalettePref> {
  const pref = await loadPalette();
  applyPalette(pref);
  return pref;
}

/** 跟随其它窗口 / 页面的改动；返回退订函数，没有 chrome.storage 时退化成 no-op。 */
export function watchPalette(onChange: (pref: PalettePref) => void): () => void {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => {};
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
    if (area !== 'local') return;
    const change = changes[PALETTE_KEY];
    if (!change) return;
    onChange(normalizePalette(change.newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  // 退订可能发生在扩展上下文已失效之后（页面卸载、扩展重载）：那时 `chrome` 整块没了，
  // 读它的属性会抛 ReferenceError，而这是卸载路径，抛出去只会变成噪音。
  return () => {
    try {
      chrome.storage.onChanged.removeListener(listener);
    } catch {
      // 上下文已失效：监听器随文档一起没了，无需再摘
    }
  };
}
