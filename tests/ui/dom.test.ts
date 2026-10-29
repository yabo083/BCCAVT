// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { useCanvasTokens } from '@/ui/composables/dom';

const probe = defineComponent({
  setup: () => {
    const tokens = useCanvasTokens();
    return () => h('div', { 'data-t': tokens.value.fg });
  },
});

describe('useCanvasTokens', () => {
  let theme = 'light';
  // 令牌解析交给真实实现的环境差异太大：钉住 getComputedStyle 的取值，只验证「属性变化→重新读令牌」这条链。
  beforeEach(() => {
    theme = 'light';
    vi.stubGlobal('getComputedStyle', () => ({
      getPropertyValue: (name: string) => (name === '--fg' ? (theme === 'dark' ? '#fff' : '#111') : ''),
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-palette');
    document.documentElement.removeAttribute('style');
  });

  it('<html data-theme/palette/style> 切换时刷新令牌（MutationObserver 跟随）', async () => {
    const wrapper = mount(probe, { attachTo: document.body });
    await new Promise((r) => setTimeout(r, 0));
    expect(wrapper.get('[data-t]').attributes('data-t')).toBe('#111');

    theme = 'dark';
    document.documentElement.setAttribute('data-theme', 'dark');
    for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
    expect(wrapper.get('[data-t]').attributes('data-t')).toBe('#fff');

    theme = 'light';
    document.documentElement.setAttribute('data-theme', 'light');
    for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
    expect(wrapper.get('[data-t]').attributes('data-t')).toBe('#111');
    wrapper.unmount();
  });
});
