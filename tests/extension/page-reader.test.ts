// @vitest-environment happy-dom
/**
 * 页面评论区替换的生命周期测试：
 * 单例 iframe、就绪前不隐藏原生评论、精确还原、开关/导航触发、原生评论区被整块替换后的行为，
 * 以及写意图的路由（守卫 → 执行器 → 结果回投给发起的 iframe）。
 *
 * page-reader 是内容脚本单例（模块级状态），静态 import 只能拿到首个实例，因此每个用例都
 * `vi.resetModules()` 后动态 import 才能拿到全新实例（这正是「测试模块加载边界」的例外）。
 * 上一个实例遗留的 MutationObserver 由 TrackedObserver 桩接管并在 afterEach 断开，
 * 遗留的 window 消息监听则因为它的 iframe 已脱离文档而认不出新消息——onWindowMessage 只认仍挂在
 * 文档里的 iframe（happy-dom 里 contentWindow 本来就是 null，光比 source 认不出「谁的 iframe」）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { Window as HappyWindow } from 'happy-dom';
import {
  LOCATE_PENDING_KEY,
  PAGE_COMMENTS_ENABLED_KEY,
  READER_BRIDGE_SOURCE,
  READER_LOCATE,
  READER_READY,
  READER_USER_CARD,
  READER_WRITE_REQUEST,
  READER_WRITE_RESULT,
  USER_CARD_BRIDGE_SOURCE,
  isReaderLocateMessage,
  isUserCardBridgeMessage,
  type ReaderWriteRequest,
  type ReaderWriteResult,
} from '@/extension/page-comments';
import { LOCATE_COMMENT } from '@/extension/messages';
import { COMMENT_AREA_SELECTOR } from '@/extension/content/targets';

/**
 * 写执行器在页面上下文里真的会发网络请求，因此这里只替换它、专注路由与守卫：
 * 执行器自己的行为由 reader-writes.test.ts 用假适配器覆盖。
 */
const writeBridge = vi.hoisted(() => ({
  executeReaderWrite: vi.fn<(request: ReaderWriteRequest) => Promise<ReaderWriteResult>>(),
}));

vi.mock('@/extension/content/reader-writes', () => ({ executeReaderWrite: writeBridge.executeReaderWrite }));

const EXTENSION_ID = 'loupe-test-extension';
const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`;
const VIDEO_URL = 'https://www.bilibili.com/video/BV1UbpP6EEGu/';
const NON_VIDEO_URL = 'https://www.bilibili.com/bangumi/play/ep1';

type RuntimeListener = (message: unknown, sender: unknown, respond: (response?: unknown) => void) => void;
type StorageListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;

let stored: Record<string, unknown>;
let runtimeListeners: RuntimeListener[];
let storageListeners: StorageListener[];
let observers: MutationObserver[];
/** 只 stub 一次并复用同一个对象：测试里改 href 即可模拟 SPA 换页。 */
let locationStub: { href: string };

/** 桩 MutationObserver：记录实例，便于 afterEach 断开上一个模块实例遗留的观察者。 */
class TrackedObserver extends MutationObserver {
  constructor(callback: MutationCallback) {
    super(callback);
    observers.push(this);
  }
}

function installChrome(): void {
  vi.stubGlobal('chrome', {
    runtime: {
      getURL: (path: string) => (path === '' ? `${EXTENSION_ORIGIN}/` : `${EXTENSION_ORIGIN}/${path}`),
      onMessage: {
        addListener: (listener: RuntimeListener) => {
          runtimeListeners.push(listener);
        },
      },
    },
    storage: {
      local: {
        get: async (key: string) => ({ [key]: stored[key] }),
        set: async (patch: Record<string, unknown>) => {
          Object.assign(stored, patch);
        },
        remove: async (key: string) => {
          delete stored[key];
        },
      },
      onChanged: {
        addListener: (listener: StorageListener) => {
          storageListeners.push(listener);
        },
      },
    },
  });
}

function buildPage(): void {
  document.body.innerHTML = `<div id="commentapp"><${COMMENT_AREA_SELECTOR}></${COMMENT_AREA_SELECTOR}></div>`;
}

function nativeRoot(): HTMLElement {
  const element = document.querySelector<HTMLElement>(COMMENT_AREA_SELECTOR);
  if (element === null) throw new Error('缺少原生评论区测试装置');
  return element;
}

function slots(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-loupe-page-reader]'));
}

/** 推进读盘（Promise 链）与合并重扫（setTimeout）；多来几轮，避免依赖微任务的具体轮数。 */
async function flush(): Promise<void> {
  for (let round = 0; round < 4; round += 1) {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
  }
}

async function start(): Promise<void> {
  const module = await import('@/extension/content/page-reader');
  module.startPageReader();
  await flush();
}

/** 模拟嵌入页发来的就绪信号：source 必须是当前 iframe 的 contentWindow。 */
function dispatchBridge(type: string, origin = EXTENSION_ORIGIN): void {
  const frame = document.querySelector('iframe');
  const init: MessageEventInit = {
    data: { source: READER_BRIDGE_SOURCE, type },
    origin,
    source: (frame?.contentWindow ?? null) as MessageEventSource | null,
  };
  window.dispatchEvent(new MessageEvent('message', init));
}

function sendNavigation(): void {
  for (const listener of runtimeListeners) listener({ type: 'loupe:page-navigation' }, undefined, () => {});
}

interface FrameTarget {
  postMessage: (message: unknown) => void;
}

/**
 * happy-dom 不加载 iframe 文档（contentWindow 为 null），而 page-reader 的消息守卫要求
 * 「来源就是当前 iframe 的 contentWindow」、结果也要投回同一个窗口：这里给实例补一个替身，
 * 同时充当消息来源与结果去向。
 */
function attachFrameWindow(): { target: FrameTarget; sent: unknown[] } {
  const frame = document.querySelector('iframe');
  if (frame === null) throw new Error('缺少嵌入页测试装置');
  const sent: unknown[] = [];
  const target: FrameTarget = { postMessage: (message) => void sent.push(message) };
  Object.defineProperty(frame, 'contentWindow', { configurable: true, value: target });
  return { target, sent };
}

function dispatchWrite(data: unknown, source: FrameTarget, origin = EXTENSION_ORIGIN): void {
  window.dispatchEvent(new MessageEvent('message', { data, origin, source: source as unknown as MessageEventSource }));
}

function setEnabled(value: boolean): void {
  for (const listener of storageListeners) listener({ [PAGE_COMMENTS_ENABLED_KEY]: { newValue: value } }, 'local');
}

beforeEach(() => {
  (window as unknown as HappyWindow).happyDOM.settings.disableIframePageLoading = true;
  writeBridge.executeReaderWrite.mockReset();
  // 只接管注入器用的 setTimeout；happy-dom 的 MutationObserver 走 queueMicrotask，保持真实
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.resetModules();
  observers = [];
  runtimeListeners = [];
  storageListeners = [];
  stored = { [PAGE_COMMENTS_ENABLED_KEY]: true };
  installChrome();
  vi.stubGlobal('MutationObserver', TrackedObserver);
  Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
  locationStub = { href: VIDEO_URL };
  vi.stubGlobal('location', locationStub);
  document.body.innerHTML = '';
});

afterEach(() => {
  for (const observer of observers) observer.disconnect();
  observers = [];
  document.body.innerHTML = '';
  vi.clearAllTimers();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('页面评论区替换', () => {
  it('开启且是视频页时插入单个 iframe，槽位紧跟在原生评论区之后', async () => {
    buildPage();
    await start();

    const inserted = slots();
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.previousElementSibling).toBe(nativeRoot());
    expect(nativeRoot().parentElement?.id).toBe('commentapp');
    expect(inserted[0]!.querySelector('iframe')?.getAttribute('src')).toBe(`${EXTENSION_ORIGIN}/src/ui/embedded.html`);
    // 未就绪前不隐藏原生评论区：抓取进度要能看到，且失败时原生评论仍在
    expect(nativeRoot().style.display).toBe('');
  });

  it('就绪后才隐藏原生评论区，关闭开关时精确还原原值', async () => {
    buildPage();
    nativeRoot().style.display = 'block';
    await start();
    expect(nativeRoot().style.display).toBe('block');

    dispatchBridge(READER_READY);
    expect(nativeRoot().style.display).toBe('none');

    setEnabled(false);
    await flush();
    expect(slots()).toHaveLength(0);
    expect(nativeRoot().style.display).toBe('block');
  });

  it('来源不符或标记不符的页面消息不会隐藏原生评论区', async () => {
    buildPage();
    await start();

    dispatchBridge(READER_READY, 'https://evil.example');
    expect(nativeRoot().style.display).toBe('');

    dispatchBridge('loupe:not-a-reader-message');
    expect(nativeRoot().style.display).toBe('');
  });

  it('槽位里的 iframe 被移除后，迟到的就绪信号不会隐藏原生评论区', async () => {
    buildPage();
    await start();

    // 嵌入页被摘掉、只剩空槽位：此刻迟到的 reader-ready 不能隐藏原生评论区，
    // 否则页面会同时失去原生评论与替代内容
    slots()[0]!.querySelector('iframe')!.remove();
    await flush();

    dispatchBridge(READER_READY);
    expect(nativeRoot().style.display).toBe('');
  });

  it('没有设置键时按默认关闭处理，不插入 iframe', async () => {
    stored = {};
    buildPage();
    await start();
    expect(slots()).toHaveLength(0);
  });

  it('非视频页不插入 iframe', async () => {
    locationStub.href = NON_VIDEO_URL;
    buildPage();
    await start();
    expect(slots()).toHaveLength(0);
  });

  it('原生评论根落在站点页头里时不挂槽位，页头始终原样', async () => {
    document.body.innerHTML = `<div id="biliMainHeader"><${COMMENT_AREA_SELECTOR}></${COMMENT_AREA_SELECTOR}></div>`;
    await start();

    expect(slots()).toHaveLength(0);
    const header = document.querySelector<HTMLElement>('#biliMainHeader');
    expect(header).not.toBeNull();
    expect(header?.style.cssText ?? '').toBe('');
    expect(document.querySelector<HTMLElement>(COMMENT_AREA_SELECTOR)?.style.display ?? '').toBe('');
  });

  it('导航到非视频页时撤掉 iframe 并还原原生评论区', async () => {
    buildPage();
    await start();
    dispatchBridge(READER_READY);
    expect(nativeRoot().style.display).toBe('none');

    locationStub.href = NON_VIDEO_URL;
    sendNavigation();
    await flush();

    expect(slots()).toHaveLength(0);
    expect(nativeRoot().style.display).toBe('');
  });

  it('原生评论区被整块换掉时仍是单例，并隐藏新的原生根', async () => {
    buildPage();
    await start();
    dispatchBridge(READER_READY);
    const oldRoot = nativeRoot();
    expect(oldRoot.style.display).toBe('none');

    const replacement = document.createElement(COMMENT_AREA_SELECTOR);
    oldRoot.replaceWith(replacement);
    await flush();

    expect(slots()).toHaveLength(1);
    expect(slots()[0]!.previousElementSibling).toBe(replacement);
    expect(replacement.style.display).toBe('none');
  });

  it('重复变更与重复导航不会产生第二个 iframe', async () => {
    buildPage();
    await start();
    dispatchBridge(READER_READY);

    document.querySelector('#commentapp')!.append(document.createElement('span'));
    sendNavigation();
    sendNavigation();
    await flush();

    expect(slots()).toHaveLength(1);
  });

  it('站点页头还没挂载完就不写页面 DOM，挂载完成后照常挂槽位', async () => {
    // 实机：#biliMainHeader 由站点 SSR 出骨架，站点头部应用挂载后才会在容器上留下 data-v-app；
    // 在那之前容器正处于「清空 → 重新渲染」，本模块必须完全不碰页面
    document.body.innerHTML = `<div id="biliMainHeader" style="min-height:64px"></div><div id="commentapp"><${COMMENT_AREA_SELECTOR}></${COMMENT_AREA_SELECTOR}></div>`;
    await start();

    expect(slots()).toHaveLength(0);
    expect(nativeRoot().style.display).toBe('');

    const header = document.querySelector<HTMLElement>('#biliMainHeader')!;
    header.setAttribute('data-v-app', '');
    header.append(document.createElement('div'));
    await flush();

    expect(slots()).toHaveLength(1);
    expect(slots()[0]!.closest('#biliMainHeader')).toBeNull();
  });

  it('页头迟迟不挂载时超时后照常挂载，页头原样不动', async () => {
    document.body.innerHTML = `<div id="biliMainHeader"><span>骨架</span></div><div id="commentapp"><${COMMENT_AREA_SELECTOR}></${COMMENT_AREA_SELECTOR}></div>`;
    await start();
    expect(slots()).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(8_000);
    await flush();

    expect(slots()).toHaveLength(1);
    expect(nativeRoot().style.display).toBe('');
    expect(document.querySelector('#biliMainHeader')?.getAttribute('style')).toBeNull();
  });

  it('站点 SSR 水合没结束前，页头超时兜底也不写页面 DOM', async () => {
    // 水合前写页面 DOM 会让站点 hydration 失配 → 整棵 SSR DOM 被丢弃重建 → 页头组件二次 mounted
    // → bili-header 二次 init 同一个 #biliMainHeader → 顶部 header 变空消失
    document.body.innerHTML = `<div id="app" data-server-rendered="true"><div id="biliMainHeader"><span>骨架</span></div><div id="commentapp"><${COMMENT_AREA_SELECTOR}></${COMMENT_AREA_SELECTOR}></div></div>`;
    await start();
    await vi.advanceTimersByTimeAsync(8_000);
    await flush();
    expect(slots()).toHaveLength(0);
    expect(nativeRoot().style.display).toBe('');
    // 水合结束：Vue 2 在 patch 一开始就把标记摘掉；兜底再等一轮后槽位照常挂上
    document.querySelector('#app')!.removeAttribute('data-server-rendered');
    await vi.advanceTimersByTimeAsync(8_000);
    await flush();
    expect(slots()).toHaveLength(1);
    expect(document.querySelector('#biliMainHeader')?.getAttribute('style')).toBeNull();
  });

  it('观察范围随阶段收窄：容器出现后页面其它地方的变更不再重扫', async () => {
    buildPage();
    document.body.insertAdjacentHTML('afterbegin', '<div id="playerWrap"></div>');
    await start();
    expect(slots()).toHaveLength(1);

    const spy = vi.spyOn(document, 'querySelector');
    document.querySelector('#playerWrap')!.append(document.createElement('div'));
    await flush();
    // 播放器里的变更不再排重扫：ensure 没有重新查过原生评论区
    expect(spy.mock.calls.some(([selector]) => selector === COMMENT_AREA_SELECTOR)).toBe(false);

    nativeRoot().replaceWith(document.createElement(COMMENT_AREA_SELECTOR));
    await flush();
    expect(spy.mock.calls.some(([selector]) => selector === COMMENT_AREA_SELECTOR)).toBe(true);
    spy.mockRestore();
  });

  it('嵌入页一直不就绪时超时撤掉槽位，原生评论区保持可用', async () => {
    buildPage();
    await start();
    expect(slots()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(20_000);
    await flush();

    expect(slots()).toHaveLength(0);
    expect(nativeRoot().style.display).toBe('');
  });
});

describe('写意图路由（iframe → 内容脚本）', () => {
  const likeRequest = {
    source: READER_BRIDGE_SOURCE,
    type: READER_WRITE_REQUEST,
    requestId: 'w-1',
    op: 'like',
    commentId: '123',
  } as const;

  const replyRequest = {
    source: READER_BRIDGE_SOURCE,
    type: READER_WRITE_REQUEST,
    requestId: 'w-2',
    op: 'reply',
    rootId: '123',
    parentId: '456',
    text: '你好',
  } as const;

  const okResult: ReaderWriteResult = { source: READER_BRIDGE_SOURCE, type: READER_WRITE_RESULT, requestId: 'w-1', ok: true };

  it('把写意图原样交给执行器，并把结果回投给发起的那个 iframe', async () => {
    buildPage();
    await start();
    const { target, sent } = attachFrameWindow();
    writeBridge.executeReaderWrite.mockResolvedValue(okResult);

    dispatchWrite(likeRequest, target);
    dispatchWrite(replyRequest, target);
    await flush();

    expect(writeBridge.executeReaderWrite.mock.calls).toEqual([[likeRequest], [replyRequest]]);
    expect(sent).toEqual([okResult, okResult]);
  });

  it('来源或标记不符的写意图一律不执行', async () => {
    buildPage();
    await start();
    const { target, sent } = attachFrameWindow();
    writeBridge.executeReaderWrite.mockResolvedValue(okResult);

    dispatchWrite(likeRequest, target, 'https://evil.example');
    dispatchWrite({ ...likeRequest, source: 'other' }, target);
    dispatchWrite({ ...likeRequest, op: 'delete' }, target);
    dispatchWrite({ ...likeRequest, requestId: '' }, target);
    dispatchWrite('loupe:reader-write', target);
    await flush();

    expect(writeBridge.executeReaderWrite).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it('槽位里的 iframe 被移除后，迟到的写意图不执行', async () => {
    buildPage();
    await start();
    const { target } = attachFrameWindow();
    slots()[0]!.querySelector('iframe')!.remove();
    await flush();

    dispatchWrite(likeRequest, target);
    await flush();

    expect(writeBridge.executeReaderWrite).not.toHaveBeenCalled();
  });

  it('iframe 被撤掉后，迟到的写结果不投给已经换掉的 iframe', async () => {
    buildPage();
    await start();
    const { target, sent } = attachFrameWindow();
    // 写落地要跨至少一个微任务：撤掉槽位发生在此之前
    writeBridge.executeReaderWrite.mockImplementation(async () => {
      await Promise.resolve();
      return okResult;
    });

    dispatchWrite(likeRequest, target);
    // 关掉开关：槽位与 iframe 一起撤掉，之后才落地的结果不能投给已经不存在的 iframe
    setEnabled(false);
    await flush();

    expect(sent).toHaveLength(0);
  });
});

describe('作者入口：用户卡片转给主世界', () => {
  it('把嵌入文档坐标换算成宿主坐标后转给主世界；收起与非法消息各有其道', async () => {
    buildPage();
    await start();
    const { target } = attachFrameWindow();
    const slot = slots()[0]!;
    // happy-dom 不做布局：给槽位一个确定的位置，断言「换算 = 嵌入坐标 + 槽位视口偏移」
    vi.spyOn(slot, 'getBoundingClientRect').mockReturnValue({
      left: 100, top: 40, width: 800, height: 1200, right: 900, bottom: 1240, x: 100, y: 40, toJSON: () => ({}),
    } as DOMRect);

    const posted: unknown[] = [];
    const spy = vi.spyOn(window, 'postMessage').mockImplementation((message: unknown) => void posted.push(message));
    const forwarded = () => posted.filter(isUserCardBridgeMessage);

    dispatchWrite(
      { source: READER_BRIDGE_SOURCE, type: READER_USER_CARD, mid: '703148042', rect: { left: 10, top: 200, width: 44, height: 44 } },
      target,
    );
    expect(forwarded()).toEqual([
      { source: USER_CARD_BRIDGE_SOURCE, type: 'show', mid: '703148042', rect: { left: 110, top: 240, width: 44, height: 44 } },
    ]);

    posted.length = 0;
    dispatchWrite({ source: READER_BRIDGE_SOURCE, type: READER_USER_CARD, mid: '703148042', rect: null }, target);
    expect(forwarded()).toEqual([{ source: USER_CARD_BRIDGE_SOURCE, type: 'hide', mid: '703148042' }]);

    // 非法消息（mid 不是纯数字 / rect 缺字段）一律不转，也不抛
    posted.length = 0;
    dispatchWrite(
      { source: READER_BRIDGE_SOURCE, type: READER_USER_CARD, mid: 'abc', rect: { left: 1, top: 2, width: 3, height: 4 } },
      target,
    );
    dispatchWrite(
      { source: READER_BRIDGE_SOURCE, type: READER_USER_CARD, mid: '703148042', rect: { left: 1, top: 2 } },
      target,
    );
    expect(forwarded()).toHaveLength(0);

    spy.mockRestore();
  });
});

describe('指针离开阅读器', () => {
  it('指针移出槽位时收起用户卡片（跨文档时嵌入页不一定收得到 mouseleave）', async () => {
    buildPage();
    await start();
    const posted: unknown[] = [];
    const spy = vi.spyOn(window, 'postMessage').mockImplementation((message: unknown) => void posted.push(message));

    slots()[0]!.dispatchEvent(new MouseEvent('mouseleave'));

    expect(posted.filter(isUserCardBridgeMessage)).toEqual([{ source: USER_CARD_BRIDGE_SOURCE, type: 'hide' }]);
    spy.mockRestore();
  });
});

describe('在评论区定位（后台 → 内容脚本 → 嵌入阅读器）', () => {
  const COMMENT_ID = '316401376609';
  /** 另一个视频的地址：定位请求只对「当前页那个视频」有效。 */
  const OTHER_VIDEO_URL = 'https://www.bilibili.com/video/BV1xx411c7mD/';

  const expected = [{ source: READER_BRIDGE_SOURCE, type: READER_LOCATE, commentId: COMMENT_ID }];
  const locates = (sent: unknown[]): unknown[] => sent.filter(isReaderLocateMessage);

  /**
   * 后台发来的定位请求走的是运行期消息（不是桥消息）；返回的回执就是后台 await 的那次应答
   * ——内容脚本不回执，发送方只会拿到一个端口错误（见 page-reader.ts 的 onRuntimeMessage）。
   */
  function sendLocate(input: string, commentId = COMMENT_ID): Mock {
    const respond = vi.fn();
    for (const listener of runtimeListeners) listener({ type: LOCATE_COMMENT, input, commentId }, undefined, respond);
    return respond;
  }

  it('就绪之前到的定位先存着，reader-ready 之后补发一次（绝不丢）', async () => {
    buildPage();
    await start();
    const { target, sent } = attachFrameWindow();

    const respond = sendLocate(VIDEO_URL);
    // 收下了就回执：后台 await 的正是这次应答
    expect(respond).toHaveBeenCalledTimes(1);
    expect(locates(sent)).toHaveLength(0);

    dispatchWrite({ source: READER_BRIDGE_SOURCE, type: READER_READY }, target);

    expect(locates(sent)).toEqual(expected);
  });

  it('已就绪的阅读器收到定位立刻转发', async () => {
    buildPage();
    await start();
    const { target, sent } = attachFrameWindow();
    dispatchWrite({ source: READER_BRIDGE_SOURCE, type: READER_READY }, target);
    sent.length = 0;

    expect(sendLocate(VIDEO_URL)).toHaveBeenCalledTimes(1);

    expect(locates(sent)).toEqual(expected);
  });

  it('请求的视频不是本页那个就不转发，也不回执（发送方据此报「没定位成功」）', async () => {
    buildPage();
    await start();
    const { target, sent } = attachFrameWindow();
    dispatchWrite({ source: READER_BRIDGE_SOURCE, type: READER_READY }, target);
    sent.length = 0;

    expect(sendLocate(OTHER_VIDEO_URL)).not.toHaveBeenCalled();

    expect(locates(sent)).toHaveLength(0);
  });

  it('形状不合法的定位请求一律不转发，也不炸', async () => {
    buildPage();
    await start();
    const { target, sent } = attachFrameWindow();

    for (const message of [
      { type: LOCATE_COMMENT, input: VIDEO_URL, commentId: 'abc' },
      { type: LOCATE_COMMENT, input: '', commentId: COMMENT_ID },
      { type: LOCATE_COMMENT, input: VIDEO_URL, commentId: 316401376609 },
      { type: LOCATE_COMMENT, input: VIDEO_URL },
    ]) {
      const respond = vi.fn();
      for (const listener of runtimeListeners) listener(message, undefined, respond);
      expect(respond).not.toHaveBeenCalled();
    }
    dispatchWrite({ source: READER_BRIDGE_SOURCE, type: READER_READY }, target);

    expect(locates(sent)).toHaveLength(0);
  });

  it('挂载时消费待办定位：身份一致才消费（读后即删），就绪后补发', async () => {
    stored[LOCATE_PENDING_KEY] = { input: VIDEO_URL, commentId: COMMENT_ID, nonce: 'n-1' };
    buildPage();
    await start();
    const { target, sent } = attachFrameWindow();

    dispatchWrite({ source: READER_BRIDGE_SOURCE, type: READER_READY }, target);

    expect(locates(sent)).toEqual(expected);
    // 读后即删：下次刷新页面不该重复定位
    expect(stored[LOCATE_PENDING_KEY]).toBeUndefined();
  });

  it('待办属于别的视频时留着不动，也不定位', async () => {
    const pending = { input: OTHER_VIDEO_URL, commentId: COMMENT_ID, nonce: 'n-1' };
    stored[LOCATE_PENDING_KEY] = pending;
    buildPage();
    await start();
    const { target, sent } = attachFrameWindow();

    dispatchWrite({ source: READER_BRIDGE_SOURCE, type: READER_READY }, target);

    expect(locates(sent)).toHaveLength(0);
    // 那是别的视频的待办，本页消费不了：留着等它自己那一页来消费
    expect(stored[LOCATE_PENDING_KEY]).toEqual(pending);
  });

  it('待办形状不合法时既不消费也不定位', async () => {
    const malformed = { input: VIDEO_URL, commentId: 'abc', nonce: '' };
    stored[LOCATE_PENDING_KEY] = malformed;
    buildPage();
    await start();
    const { target, sent } = attachFrameWindow();

    dispatchWrite({ source: READER_BRIDGE_SOURCE, type: READER_READY }, target);

    expect(locates(sent)).toHaveLength(0);
    expect(stored[LOCATE_PENDING_KEY]).toEqual(malformed);
  });
});
