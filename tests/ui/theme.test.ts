// @vitest-environment happy-dom
/**
 * 配色令牌的读写契约。三条硬约束在这里盯住：
 *   1) 存储内容不可信——非对象 / 未知 id / 非法 hex 一律回落默认，脏值不能落到 `<html>`；
 *   2) 预设靠 `data-palette` 属性选择器、自定义靠内联变量，两条路都只动 accent 系令牌；
 *   3) 从自定义切回预设必须清掉内联覆盖——残留的 `--accent` 会赢过属性选择器，把整套色带偏。
 * 这个环境没有扩展 API，所以同时盯住「读不到存储也不能抛错」。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyPalette,
  applyStoredPalette,
  DEFAULT_PALETTE,
  loadPalette,
  normalizePalette,
  PALETTES,
  savePalette,
  watchPalette,
} from '@/ui/theme';

const root = (): HTMLElement => document.documentElement;

beforeEach(() => {
  root().removeAttribute('data-palette');
  root().removeAttribute('style');
});

describe('normalizePalette：存储是不可信输入', () => {
  it('非对象一律回落默认', () => {
    for (const value of [null, undefined, 'teal', 42, true, ['teal']]) {
      expect(normalizePalette(value)).toEqual(DEFAULT_PALETTE);
    }
  });

  it('未知 / 缺失 id 回落默认', () => {
    expect(normalizePalette({ id: 'magenta' })).toEqual(DEFAULT_PALETTE);
    expect(normalizePalette({ id: 'custom' })).toEqual(DEFAULT_PALETTE);
    expect(normalizePalette({})).toEqual(DEFAULT_PALETTE);
  });

  it('非法自定义主色回落默认（颜色名 / 缩写 / 位数不对 / 非字符串）', () => {
    for (const custom of ['red', '#abc', '#abcd', '#aabbccd', 0x112233, null]) {
      expect(normalizePalette({ id: 'custom', custom })).toEqual(DEFAULT_PALETTE);
    }
  });

  it('合法输入保留：预设 id 与自定义 hex（去空白并转小写）', () => {
    for (const option of PALETTES) {
      expect(normalizePalette({ id: option.id, custom: null })).toEqual({ id: option.id, custom: null });
    }
    expect(normalizePalette({ id: 'custom', custom: '#AABBCC' })).toEqual({ id: 'custom', custom: '#aabbcc' });
    expect(normalizePalette({ id: 'custom', custom: '  #0f0f0f ' })).toEqual({ id: 'custom', custom: '#0f0f0f' });
  });

  it('预设 id 不携带自定义值：custom 只在 custom 模式下有意义', () => {
    expect(normalizePalette({ id: 'pink', custom: '#aabbcc' })).toEqual({ id: 'pink', custom: null });
  });
});

describe('applyPalette：预设走属性选择器、自定义走内联变量', () => {
  it('预设只写 data-palette，不写内联变量', () => {
    applyPalette({ id: 'amber', custom: null });
    expect(root().dataset.palette).toBe('amber');
    expect(root().style.getPropertyValue('--accent')).toBe('');
    expect(root().getAttribute('style')).toBeFalsy();
  });

  it('自定义写 data-palette=custom 与 4 个内联变量（hex 直给，bg/border 按 18% / 40% 混色）', () => {
    applyPalette({ id: 'custom', custom: '#123456' });
    const style = root().style;
    expect(root().dataset.palette).toBe('custom');
    expect(style.getPropertyValue('--accent')).toBe('#123456');
    expect(style.getPropertyValue('--accent-strong')).toBe('#123456');
    expect(style.getPropertyValue('--accent-bg')).toContain('color-mix');
    expect(style.getPropertyValue('--accent-bg')).toContain('#123456');
    expect(style.getPropertyValue('--accent-bg')).toContain('18%');
    expect(style.getPropertyValue('--accent-border')).toContain('color-mix');
    expect(style.getPropertyValue('--accent-border')).toContain('40%');
  });

  it('从自定义切回预设必须清掉内联覆盖（残留 accent 会赢过属性选择器）', () => {
    applyPalette({ id: 'custom', custom: '#123456' });
    expect(root().style.getPropertyValue('--accent')).toBe('#123456');

    applyPalette({ id: 'blue', custom: null });
    expect(root().dataset.palette).toBe('blue');
    for (const key of ['--accent', '--accent-strong', '--accent-bg', '--accent-border', '--selection-bg']) {
      expect(root().style.getPropertyValue(key)).toBe('');
    }
  });

  it('自定义值非法时只留 data-palette，不写内联（划词高亮仍由 CSS 从 --accent 派生）', () => {
    applyPalette({ id: 'custom', custom: 'red' });
    expect(root().dataset.palette).toBe('custom');
    expect(root().style.getPropertyValue('--accent')).toBe('');
  });
});

describe('存储读写：没有扩展 API 也要能安静退让', () => {
  it('读不到 chrome.storage 时回落默认配色，并把默认色落到 <html>', async () => {
    await expect(loadPalette()).resolves.toEqual(DEFAULT_PALETTE);
    await expect(applyStoredPalette()).resolves.toEqual(DEFAULT_PALETTE);
    expect(root().dataset.palette).toBe('teal');
  });

  it('写入与订阅在无 chrome 时是 no-op：订阅返回可安全调用的退订函数', async () => {
    await expect(savePalette({ id: 'pink', custom: null })).resolves.toBeUndefined();
    const unwatch = watchPalette(() => {
      throw new Error('没有外部变更时不该回调');
    });
    expect(typeof unwatch).toBe('function');
    expect(() => unwatch()).not.toThrow();
  });
});
