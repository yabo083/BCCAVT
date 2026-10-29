import { afterEach, describe, expect, it, vi } from 'vitest';
import { openAnalysisTab, openGraphPopup } from '@/extension/open-panel';

const input = 'https://www.bilibili.com/video/BV1UbpP6EEGu/';

/** 侧栏已彻底移除：这两个入口只允许碰 tabs.create 与 windows.create。 */
function browserApi() {
  const create = vi.fn().mockResolvedValue({ id: 9 });
  const createWindow = vi.fn().mockResolvedValue({ id: 11 });
  const set = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('chrome', {
    runtime: { getURL: (path: string) => `chrome-extension://loupe/${path}` },
    tabs: { create },
    windows: { create: createWindow },
    storage: { session: { set } },
  });
  return { create, createWindow, set };
}

afterEach(() => vi.unstubAllGlobals());

describe('视频级入口：完整标签页工作台', () => {
  it('开 view=tab 的标签页，带上 input 与评论 id，落在源标签页所在窗口', async () => {
    const api = browserApi();
    expect(await openAnalysisTab({ input, commentId: '316401376609', windowId: 3 })).toBe('tab');
    expect(api.create).toHaveBeenCalledTimes(1);
    const options = api.create.mock.calls[0]![0];
    expect(options.windowId).toBe(3);
    const url = new URL(options.url);
    expect(url.searchParams.get('view')).toBe('tab');
    expect(url.searchParams.get('input')).toBe(input);
    expect(url.searchParams.get('comment')).toBe('316401376609');
    // 不再投递侧栏意图（侧栏与 INTENT_KEY 投递路线已移除），也不开独立窗口
    expect(api.set).not.toHaveBeenCalled();
    expect(api.createWindow).not.toHaveBeenCalled();
  });

  it('没有评论 id 时不带 comment 参数：视频级评论区分析', async () => {
    const api = browserApi();
    await openAnalysisTab({ input, windowId: 1 });
    const url = new URL(api.create.mock.calls[0]![0].url);
    expect(url.searchParams.has('comment')).toBe(false);
    expect(url.searchParams.get('input')).toBe(input);
  });

  it('标签页打不开时原样失败，不静默吞掉', async () => {
    const api = browserApi();
    api.create.mockRejectedValue(new Error('No tab available'));
    await expect(openAnalysisTab({ input, windowId: 1 })).rejects.toThrow('No tab available');
  });
});

describe('评论行放大镜：独立图谱窗口', () => {
  it('开 type:popup 的 view=graph/input/comment 独立窗口，不碰标签页', async () => {
    const api = browserApi();
    expect(await openGraphPopup({ input, commentId: '316401376609' })).toBe('popup');
    expect(api.createWindow).toHaveBeenCalledTimes(1);
    const options = api.createWindow.mock.calls[0]![0];
    expect(options.type).toBe('popup');
    expect(options.focused).toBe(true);
    expect(options.width).toBeGreaterThan(0);
    expect(options.height).toBeGreaterThan(0);
    const url = new URL(options.url);
    expect(url.searchParams.get('view')).toBe('graph');
    expect(url.searchParams.get('input')).toBe(input);
    expect(url.searchParams.get('comment')).toBe('316401376609');
    // 图谱窗口由 URL 上的 input/comment 驱动：不开标签页，也不投递存储意图
    expect(api.create).not.toHaveBeenCalled();
    expect(api.set).not.toHaveBeenCalled();
  });

  it('窗口打不开时原样失败，不降级到完整标签页', async () => {
    const api = browserApi();
    api.createWindow.mockRejectedValue(new Error('No window available'));
    await expect(openGraphPopup({ input, commentId: '1' })).rejects.toThrow('No window available');
    expect(api.create).not.toHaveBeenCalled();
    expect(api.set).not.toHaveBeenCalled();
  });
});
