import { describe, expect, it } from 'vitest';
import { computeWindow, scrollTopForIndex } from '@/ui/virtual';

const base = { scrollTop: 0, viewportHeight: 300, itemHeight: 100, count: 50, overscan: 2 };

describe('computeWindow', () => {
  it('空列表不渲染任何行', () => {
    expect(computeWindow({ ...base, count: 0 })).toEqual({ start: 0, end: 0, offsetY: 0, totalHeight: 0 });
  });

  it('行高非法时退化为空窗口，避免除零', () => {
    expect(computeWindow({ ...base, itemHeight: 0 })).toEqual({ start: 0, end: 0, offsetY: 0, totalHeight: 0 });
  });

  it('顶部窗口带 overscan，且不超出总数', () => {
    expect(computeWindow(base)).toEqual({ start: 0, end: 5, offsetY: 0, totalHeight: 5000 });
  });

  it('滚动到中间时窗口跟随', () => {
    const range = computeWindow({ ...base, scrollTop: 2500 });
    expect(range.start).toBe(23);
    expect(range.end).toBe(30);
    expect(range.offsetY).toBe(2300);
  });

  it('滚动超出内容底部时钳制到最后一屏', () => {
    const range = computeWindow({ ...base, scrollTop: 999999 });
    expect(range.end).toBe(50);
    expect(range.start).toBe(45);
  });

  it('视口高于内容时全部渲染且不出现负偏移', () => {
    const range = computeWindow({ ...base, count: 2, viewportHeight: 900 });
    expect(range.start).toBe(0);
    expect(range.end).toBe(2);
  });

  it('负 scrollTop 按 0 处理', () => {
    expect(computeWindow({ ...base, scrollTop: -400 }).start).toBe(0);
  });

  it('overscan 为 0 时只渲染可视行', () => {
    expect(computeWindow({ ...base, overscan: 0 })).toEqual({ start: 0, end: 3, offsetY: 0, totalHeight: 5000 });
  });
});

describe('scrollTopForIndex', () => {
  it('把目标行滚到视口中间', () => {
    expect(scrollTopForIndex(10, 100, 300)).toBe(900);
  });

  it('顶部附近不产生负滚动', () => {
    expect(scrollTopForIndex(0, 100, 300)).toBe(0);
  });
});
