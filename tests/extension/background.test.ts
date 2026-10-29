/**
 * 后台入口路由的回归测试：内容脚本 / 右键菜单发出的分析请求落到哪个界面。
 * 侧栏已彻底移除——视频级入口开完整标签页工作台，评论行放大镜开独立图谱窗口，两者都不降级。
 * 校验仍以 sender 的标签页地址为准（不信任消息里的 pageUrl）。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ANALYZE_REQUEST, LAST_COMMENT_KEY, LOCATE_COMMENT } from '@/extension/messages';
import { LOCATE_PENDING_KEY } from '@/extension/page-comments';

const EXTENSION_ID = 'loupe-extension-id';
const PAGE_URL = 'https://www.bilibili.com/video/BV1UbpP6EEGu/?p=1';
const COMMENT_ID = '316401376609';
const TAB_ID = 7;
const WINDOW_ID = 3;
/** 菜单 id 与 background.ts 里注册的一致（用户可见的右键菜单项）。 */
const MENU_SUBJECT = 'loupe:analyze-subject';
const MENU_THREAD = 'loupe:analyze-thread';

type MessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
) => unknown;
type MenuListener = (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => void;

const listeners: { message: MessageListener | null; menu: MenuListener | null } = { message: null, menu: null };

const tabsCreate = vi.fn().mockResolvedValue({ id: 9 });
const tabsQuery = vi.fn().mockResolvedValue([]);
const tabsUpdate = vi.fn().mockResolvedValue({ id: 7 });
const tabsSendMessage = vi.fn().mockResolvedValue(undefined);
const windowsCreate = vi.fn().mockResolvedValue({ id: 11 });
const windowsUpdate = vi.fn().mockResolvedValue({ id: 11 });
const sessionGet = vi.fn().mockResolvedValue({});
const sessionSet = vi.fn().mockResolvedValue(undefined);
const localSet = vi.fn().mockResolvedValue(undefined);

function noopEvent() {
  return { addListener: vi.fn() };
}

// chrome stub 故意不提供 sidePanel：侧栏路线若回归，测试会直接炸（undefined.open），不会悄悄通过
beforeAll(async () => {
  vi.stubGlobal('chrome', {
    runtime: {
      id: EXTENSION_ID,
      getURL: (path: string) => `chrome-extension://${EXTENSION_ID}/${path}`,
      onInstalled: noopEvent(),
      onStartup: noopEvent(),
      onMessage: {
        addListener: vi.fn((listener: MessageListener) => {
          listeners.message = listener;
        }),
      },
    },
    contextMenus: {
      removeAll: vi.fn(),
      create: vi.fn(),
      onClicked: {
        addListener: vi.fn((listener: MenuListener) => {
          listeners.menu = listener;
        }),
      },
    },
    declarativeNetRequest: {
      updateSessionRules: vi.fn().mockResolvedValue(undefined),
      RuleActionType: { MODIFY_HEADERS: 'modifyHeaders' },
      HeaderOperation: { SET: 'set' },
      ResourceType: { XMLHTTPREQUEST: 'xmlhttprequest', OTHER: 'other' },
    },
    storage: {
      session: { get: sessionGet, set: sessionSet, remove: vi.fn().mockResolvedValue(undefined) },
      local: { get: vi.fn().mockResolvedValue({}), set: localSet, remove: vi.fn().mockResolvedValue(undefined) },
    },
    tabs: {
      create: tabsCreate,
      query: tabsQuery,
      update: tabsUpdate,
      sendMessage: tabsSendMessage,
      onRemoved: noopEvent(),
      onUpdated: noopEvent(),
    },
    windows: { create: windowsCreate, update: windowsUpdate },
  });
  // 必须动态 import：background 在模块求值期就调用 chrome.* 注册监听器并注册请求头规则，
  // 静态 import 会被提升到 stub 之前，模块一加载就炸。
  await import('@/extension/background');
});

afterEach(() => {
  vi.clearAllMocks();
});

function sender(overrides: { id?: string; pageUrl?: string } = {}): chrome.runtime.MessageSender {
  const url = overrides.pageUrl ?? PAGE_URL;
  return {
    id: overrides.id ?? EXTENSION_ID,
    url,
    tab: { id: TAB_ID, url, windowId: WINDOW_ID },
  } as unknown as chrome.runtime.MessageSender;
}

function menuTab(): chrome.tabs.Tab {
  return { id: TAB_ID, url: PAGE_URL, windowId: WINDOW_ID } as chrome.tabs.Tab;
}

/** 直接驱动 onMessage 监听器：等它回应后返回 sendResponse 收到的那份响应。 */
async function dispatch(message: unknown, from: chrome.runtime.MessageSender): Promise<unknown> {
  const listener = listeners.message;
  if (listener === null) throw new Error('background 没有注册 onMessage 监听器');
  const sendResponse = vi.fn();
  // 异步响应：监听器必须 return true，否则 Chrome 会提前关掉 sendResponse 通道
  expect(listener(message, from, sendResponse)).toBe(true);
  await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
  return sendResponse.mock.calls[0]![0];
}

function threadRequest(pageUrl = PAGE_URL): unknown {
  return { type: ANALYZE_REQUEST, kind: 'thread', commentId: COMMENT_ID, pageUrl };
}

describe('页面按钮的路由', () => {
  it('评论行放大镜：开独立图谱窗口，不碰标签页', async () => {
    const response = await dispatch(threadRequest(), sender());
    expect(response).toEqual({ ok: true, surface: 'popup' });
    expect(windowsCreate).toHaveBeenCalledTimes(1);
    const options = windowsCreate.mock.calls[0]![0];
    expect(options.type).toBe('popup');
    const url = new URL(options.url);
    expect(url.searchParams.get('view')).toBe('graph');
    expect(url.searchParams.get('input')).toBe(PAGE_URL);
    expect(url.searchParams.get('comment')).toBe(COMMENT_ID);
    expect(tabsCreate).not.toHaveBeenCalled();
  });

  it('视频级按钮：开完整标签页工作台', async () => {
    const response = await dispatch({ type: ANALYZE_REQUEST, kind: 'subject', pageUrl: PAGE_URL }, sender());
    expect(response).toEqual({ ok: true, surface: 'tab' });
    expect(tabsCreate).toHaveBeenCalledTimes(1);
    const options = tabsCreate.mock.calls[0]![0];
    expect(options.windowId).toBe(WINDOW_ID);
    const url = new URL(options.url);
    expect(url.searchParams.get('view')).toBe('tab');
    expect(url.searchParams.get('input')).toBe(PAGE_URL);
    expect(url.searchParams.has('comment')).toBe(false);
    expect(windowsCreate).not.toHaveBeenCalled();
  });

  it('消息里的页面与标签页当前地址不一致时拒绝，什么都不开', async () => {
    const response = await dispatch(threadRequest('https://www.bilibili.com/video/BV1other/'), sender());
    expect(response).toMatchObject({ ok: false });
    expect(windowsCreate).not.toHaveBeenCalled();
    expect(tabsCreate).not.toHaveBeenCalled();
  });

  it('sender 不在视频页时拒绝，不做任何降级', async () => {
    const bangumi = 'https://www.bilibili.com/bangumi/play/ep1';
    const response = await dispatch(threadRequest(bangumi), sender({ pageUrl: bangumi }));
    expect(response).toMatchObject({ ok: false });
    expect(windowsCreate).not.toHaveBeenCalled();
    expect(tabsCreate).not.toHaveBeenCalled();
  });

  it('不是本扩展发来的消息一律忽略', () => {
    const listener = listeners.message;
    expect(listener).not.toBeNull();
    const returned = listener?.(threadRequest(), sender({ id: 'other-extension' }), () => {
      throw new Error('不该回应外部消息');
    });
    expect(returned).toBeUndefined();
    expect(windowsCreate).not.toHaveBeenCalled();
    expect(tabsCreate).not.toHaveBeenCalled();
  });
});

describe('右键菜单的路由', () => {
  it('右键评论：记录里有这条评论才开图谱窗口', async () => {
    sessionGet.mockResolvedValue({
      [`${LAST_COMMENT_KEY}:${TAB_ID}`]: { commentId: COMMENT_ID, pageUrl: PAGE_URL },
    });
    listeners.menu?.({ menuItemId: MENU_THREAD, pageUrl: PAGE_URL } as chrome.contextMenus.OnClickData, menuTab());
    await vi.waitFor(() => expect(windowsCreate).toHaveBeenCalledTimes(1));
    const url = new URL(windowsCreate.mock.calls[0]![0].url);
    expect(url.searchParams.get('view')).toBe('graph');
    expect(url.searchParams.get('comment')).toBe(COMMENT_ID);
    expect(tabsCreate).not.toHaveBeenCalled();
  });

  it('右键评论但取不到评论 id 时退到完整工作台，绝不猜一个 id 去开图', async () => {
    sessionGet.mockResolvedValue({});
    listeners.menu?.({ menuItemId: MENU_THREAD, pageUrl: PAGE_URL } as chrome.contextMenus.OnClickData, menuTab());
    await vi.waitFor(() => expect(tabsCreate).toHaveBeenCalledTimes(1));
    const url = new URL(tabsCreate.mock.calls[0]![0].url);
    expect(url.searchParams.get('view')).toBe('tab');
    expect(url.searchParams.has('comment')).toBe(false);
    expect(windowsCreate).not.toHaveBeenCalled();
  });

  it('右键视频：开完整工作台，不读评论上下文', async () => {
    listeners.menu?.({ menuItemId: MENU_SUBJECT, pageUrl: PAGE_URL } as chrome.contextMenus.OnClickData, menuTab());
    await vi.waitFor(() => expect(tabsCreate).toHaveBeenCalledTimes(1));
    expect(new URL(tabsCreate.mock.calls[0]![0].url).searchParams.get('view')).toBe('tab');
    expect(sessionGet).not.toHaveBeenCalled();
    expect(windowsCreate).not.toHaveBeenCalled();
  });
});

describe('在评论区定位的路由', () => {
  /** 另一个窗口里的 B 站视频标签页；地址带分集参数，身份仍按 BV 号匹配。 */
  const OPEN_TAB_ID = 21;
  const OPEN_TAB_WINDOW_ID = 8;
  const OTHER_VIDEO_URL = 'https://www.bilibili.com/video/BV1xx411c7mD/';

  function locateRequest(input = PAGE_URL): unknown {
    return { type: LOCATE_COMMENT, input, commentId: COMMENT_ID };
  }

  it('命中已打开的标签页：先激活、跨窗口再聚焦那个窗口，最后才把定位发给它的内容脚本', async () => {
    tabsQuery.mockResolvedValue([
      { id: 22, url: OTHER_VIDEO_URL, windowId: OPEN_TAB_WINDOW_ID },
      { id: OPEN_TAB_ID, url: `${PAGE_URL}&spm_id_from=333.999`, windowId: OPEN_TAB_WINDOW_ID },
    ]);

    const response = await dispatch(locateRequest(), sender());

    expect(response).toEqual({ ok: true });
    expect(tabsQuery).toHaveBeenCalledWith({ url: ['https://www.bilibili.com/video/*'] });
    expect(tabsUpdate).toHaveBeenCalledWith(OPEN_TAB_ID, { active: true });
    expect(windowsUpdate).toHaveBeenCalledWith(OPEN_TAB_WINDOW_ID, { focused: true });
    expect(tabsSendMessage).toHaveBeenCalledWith(OPEN_TAB_ID, {
      type: LOCATE_COMMENT,
      input: PAGE_URL,
      commentId: COMMENT_ID,
    });
    // 顺序：激活 → 聚焦 → 发送（发送排最后，激活还没生效就投递会白投）
    const order = [tabsUpdate, windowsUpdate, tabsSendMessage].map((mock) => mock.mock.invocationCallOrder[0]!);
    expect(order).toEqual([...order].sort((left, right) => left - right));
    expect(tabsCreate).not.toHaveBeenCalled();
    expect(localSet).not.toHaveBeenCalled();
  });

  it('目标就在发送方那个窗口时不去动窗口焦点', async () => {
    tabsQuery.mockResolvedValue([{ id: OPEN_TAB_ID, url: PAGE_URL, windowId: WINDOW_ID }]);

    expect(await dispatch(locateRequest(), sender())).toEqual({ ok: true });

    expect(tabsUpdate).toHaveBeenCalledWith(OPEN_TAB_ID, { active: true });
    expect(windowsUpdate).not.toHaveBeenCalled();
  });

  it('没有已打开的该视频标签页：写下待办再新开标签页，不投给别的视频', async () => {
    tabsQuery.mockResolvedValue([{ id: 22, url: OTHER_VIDEO_URL, windowId: OPEN_TAB_WINDOW_ID }]);

    expect(await dispatch(locateRequest(), sender())).toEqual({ ok: true });

    const pending = localSet.mock.calls[0]?.[0][LOCATE_PENDING_KEY];
    expect(pending).toMatchObject({ input: PAGE_URL, commentId: COMMENT_ID });
    expect(typeof pending.nonce).toBe('string');
    expect(pending.nonce).not.toBe('');
    expect(tabsCreate).toHaveBeenCalledWith({ url: PAGE_URL });
    expect(tabsUpdate).not.toHaveBeenCalled();
    expect(tabsSendMessage).not.toHaveBeenCalled();
  });

  it('地址不是 B 站视频页时直接回一句给人看的原因，什么都不开', async () => {
    const response = await dispatch(locateRequest('https://www.bilibili.com/bangumi/play/ep1'), sender());

    expect(response).toMatchObject({ ok: false });
    expect(tabsQuery).not.toHaveBeenCalled();
    expect(tabsCreate).not.toHaveBeenCalled();
    expect(localSet).not.toHaveBeenCalled();
  });

  it('转发失败时回一句给人看的原因，不漏内部细节', async () => {
    tabsQuery.mockResolvedValue([{ id: OPEN_TAB_ID, url: PAGE_URL, windowId: WINDOW_ID }]);
    tabsSendMessage.mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.'));

    const response = await dispatch(locateRequest(), sender());

    expect(response).toMatchObject({ ok: false });
    expect((response as { error: string }).error).not.toContain('Receiving end');
  });

  it('形状不合法的定位消息一律不处理，也不炸', () => {
    const listener = listeners.message;
    expect(listener).not.toBeNull();

    for (const message of [
      { type: LOCATE_COMMENT, input: PAGE_URL, commentId: 'abc' },
      { type: LOCATE_COMMENT, input: '', commentId: COMMENT_ID },
      { type: LOCATE_COMMENT, commentId: COMMENT_ID },
      { type: LOCATE_COMMENT, input: PAGE_URL, commentId: 316401376609 },
      null,
    ]) {
      const sendResponse = vi.fn();
      expect(listener?.(message, sender(), sendResponse)).toBeUndefined();
      expect(sendResponse).not.toHaveBeenCalled();
    }

    expect(tabsQuery).not.toHaveBeenCalled();
    expect(tabsCreate).not.toHaveBeenCalled();
  });
});
