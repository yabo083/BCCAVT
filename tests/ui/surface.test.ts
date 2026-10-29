import { describe, expect, it } from 'vitest';
import { graphPopupUrl, surfaceOf } from '@/ui/surface';

describe('surfaceOf', () => {
  it('缺省与未知 view 都按侧栏面板处理', () => {
    expect(surfaceOf(new URLSearchParams(''))).toBe('panel');
    expect(surfaceOf(new URLSearchParams('?input=BV1xx411c7mD'))).toBe('panel');
    expect(surfaceOf(new URLSearchParams('?view=popup'))).toBe('panel');
    expect(surfaceOf(new URLSearchParams('?view=GRAPH'))).toBe('panel');
  });

  it('view=tab 是整页工作台，view=graph 是图谱窗口', () => {
    expect(surfaceOf(new URLSearchParams('?view=tab'))).toBe('tab');
    expect(surfaceOf(new URLSearchParams('?view=graph'))).toBe('graph');
  });

  it('图谱窗口不会被当成整页：两者的布局与意图分发完全不同', () => {
    expect(surfaceOf(new URLSearchParams('?view=graph&input=BV1xx411c7mD&comment=42'))).not.toBe('tab');
  });
});

describe('graphPopupUrl', () => {
  it('带上 view=graph 与 input/comment', () => {
    const url = new URL(graphPopupUrl('chrome-extension://abc/src/ui/app.html', 'https://www.bilibili.com/video/BV1xx411c7mD', '42'));
    expect(url.searchParams.get('view')).toBe('graph');
    expect(url.searchParams.get('input')).toBe('https://www.bilibili.com/video/BV1xx411c7mD');
    expect(url.searchParams.get('comment')).toBe('42');
    expect(url.pathname).toBe('/src/ui/app.html');
  });

  it('地址里的 & 与 # 只属于 input 一个参数', () => {
    const url = new URL(graphPopupUrl('chrome-extension://abc/src/ui/app.html', 'https://www.bilibili.com/video/BV1xx411c7mD?p=2#reply9', '9'));
    expect(url.searchParams.get('input')).toBe('https://www.bilibili.com/video/BV1xx411c7mD?p=2#reply9');
    expect(url.searchParams.get('comment')).toBe('9');
    expect([...url.searchParams.keys()].sort()).toEqual(['comment', 'input', 'view']);
  });

  it('拼出来的地址回到 surfaceOf 就是图谱窗口（入口与判定共用一份契约）', () => {
    const url = new URL(graphPopupUrl('chrome-extension://abc/src/ui/app.html', 'BV1xx411c7mD', '42'));
    expect(surfaceOf(url.searchParams)).toBe('graph');
  });
});
