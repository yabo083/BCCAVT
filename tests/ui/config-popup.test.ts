// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import ConfigPopup from '@/ui/ConfigPopup.vue';
import { READER_DEFAULT_ORDER_KEY } from '@/extension/page-comments';

const bag: Record<string, unknown> = {};
const setCalls: Record<string, unknown>[] = [];

beforeEach(() => {
  for (const key of Object.keys(bag)) delete bag[key];
  setCalls.length = 0;
  bag[READER_DEFAULT_ORDER_KEY] = 'hot';
  vi.stubGlobal('chrome', {
    runtime: { sendMessage: async () => ({ ok: true }), getURL: (p: string) => `chrome-extension://loupe/${p}` },
    storage: {
      local: {
        get: async (key: unknown) => {
          if (typeof key === 'string') return { [key]: bag[key] };
          if (Array.isArray(key)) return Object.fromEntries(key.map((k) => [k, bag[k]]));
          return { ...bag };
        },
        set: async (items: Record<string, unknown>) => {
          setCalls.push(items);
          Object.assign(bag, items);
        },
      },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
    windows: { create: async () => ({}) },
    tabs: {},
  });
});

describe('配置弹窗', () => {
  it('「评论区排序」分段控件写 READER_DEFAULT_ORDER_KEY', async () => {
    const wrapper = mount(ConfigPopup, { global: { stubs: { PalettePicker: true } } });
    await new Promise((r) => setTimeout(r, 0));
    const seg = wrapper.findAll('.seg-opt');
    expect(seg).toHaveLength(2);
    expect(seg[0]!.attributes('aria-checked')).toBe('true');
    expect(seg[1]!.attributes('aria-checked')).toBe('false');
    await seg[1]!.trigger('click');
    expect(setCalls.at(-1)).toEqual({ [READER_DEFAULT_ORDER_KEY]: 'time' });
    await seg[0]!.trigger('click');
    expect(setCalls.at(-1)).toEqual({ [READER_DEFAULT_ORDER_KEY]: 'hot' });
    wrapper.unmount();
  });
});
