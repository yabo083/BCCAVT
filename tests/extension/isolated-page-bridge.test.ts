// @vitest-environment happy-dom
/**
 * 隔离世界内容脚本入口（isolated.ts）的桥测试：
 *   1. 替换模式：页面开关（PAGE_COMMENTS_ENABLED_KEY）驱动的是评论区替换——开启即挂载自绘阅读器
 *      iframe（原生评论根在阅读器就绪前保持可见），关闭即撤掉；
 *   2. 解耦：开关不再推「原生评论样式增强」的桥消息（native-comments-style / native-thread 保留但未接线）。
 *
 * 替换模式自身的生命周期（就绪后才隐藏原生根、精确还原、单例、导航、超时）在 page-reader.test.ts，
 * 写意图的落地在 reader-writes.test.ts 与 page-reader.test.ts 的写路由用例。
 *
 * isolated.ts 是内容脚本入口（模块级副作用），静态 import 只能拿到首个实例，因此每个用例都
 * `vi.resetModules()` 后动态 import（这是「测试模块加载边界」的例外）。断言只看 window.postMessage
 * 收到了什么：记录而不真正投递，避免依赖 happy-dom 自己的定时器派发。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Window as HappyWindow } from 'happy-dom';
import {
  NATIVE_STYLE_BRIDGE_SOURCE,
  PAGE_COMMENTS_ENABLED_KEY,
} from '@/extension/page-comments';

type StorageListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;
type RuntimeListener = (message: unknown) => void;

const originalPostMessage = Object.getOwnPropertyDescriptor(window, 'postMessage');

const EXTENSION_ORIGIN = 'chrome-extension://loupe-test-extension';
const VIDEO_URL = 'https://www.bilibili.com/video/BV1UbpP6EEGu/';

let stored: Record<string, unknown>;
let storageListeners: StorageListener[];
let posted: unknown[];
let observers: MutationObserver[];

/**
 * 桩 MutationObserver：记录实例，便于 afterEach 断开上一个模块实例遗留的观察者。
 * page-reader 是模块级单例，`vi.resetModules()` 只让下一个用例拿到新实例，旧实例的观察者仍连着同一个
 * document——不主动断开，它会在下一个用例往 body 写评论装置时按旧开关状态再挂一个 iframe。
 */
class TrackedObserver extends MutationObserver {
  constructor(callback: MutationCallback) {
    super(callback);
    observers.push(this);
  }
}

/** 记录 window.postMessage 的调用而不真正投递。 */
function recordPostMessage(): unknown[] {
  const messages: unknown[] = [];
  Object.defineProperty(window, 'postMessage', {
    configurable: true,
    writable: true,
    value: (message: unknown) => {
      messages.push(message);
    },
  });
  return messages;
}

function defaultGet(keys: string | string[]): Promise<Record<string, unknown>> {
  const list = Array.isArray(keys) ? keys : [keys];
  return Promise.resolve(Object.fromEntries(list.map((key) => [key, stored[key]])));
}

function installChrome(getImpl?: (keys: string | string[]) => Promise<Record<string, unknown>>): void {
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: async () => ({ ok: true }),
      getURL: (path: string) => (path === '' ? `${EXTENSION_ORIGIN}/` : `${EXTENSION_ORIGIN}/${path}`),
      onMessage: {
        addListener: (_listener: RuntimeListener) => {},
      },
    },
    storage: {
      local: { get: getImpl ?? defaultGet },
      onChanged: {
        addListener: (listener: StorageListener) => {
          storageListeners.push(listener);
        },
      },
    },
  });
}

/** 推进读盘（Promise 链）与合并重扫（setTimeout）；用假定时器，不真实等待。 */
async function flush(): Promise<void> {
  for (let round = 0; round < 4; round += 1) {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
  }
}

async function start(): Promise<void> {
  await import('@/extension/content/isolated');
  await flush();
}

function slots(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-loupe-page-reader]'));
}

function setEnabled(value: boolean): void {
  for (const listener of storageListeners) listener({ [PAGE_COMMENTS_ENABLED_KEY]: { newValue: value } }, 'local');
}

beforeEach(() => {
  (window as unknown as HappyWindow).happyDOM.settings.disableIframePageLoading = true;
  vi.resetModules();
  // 只接管合并重扫用的 setTimeout；happy-dom 的 MutationObserver 走 queueMicrotask，保持真实
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  stored = {};
  storageListeners = [];
  posted = recordPostMessage();
  observers = [];
  vi.stubGlobal('MutationObserver', TrackedObserver);
  installChrome();
  Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
  vi.stubGlobal('location', { href: VIDEO_URL });
  document.body.innerHTML = '';
});

afterEach(() => {
  // 先断开上一个实例的观察者，再清 DOM：否则它在清空/重建评论装置时又会挂一个槽位
  for (const observer of observers) observer.disconnect();
  observers = [];
  document.body.innerHTML = '';
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (originalPostMessage === undefined) Reflect.deleteProperty(window, 'postMessage');
  else Object.defineProperty(window, 'postMessage', originalPostMessage);
});

describe('页面评论区替换（页面开关的主路径）', () => {
  it('开关开启时挂载自绘阅读器 iframe，原生评论根在就绪前保持可见', async () => {
    stored = { [PAGE_COMMENTS_ENABLED_KEY]: true };
    document.body.innerHTML = '<div id="commentapp"><bili-comments></bili-comments></div>';
    await start();

    const inserted = slots();
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.querySelector('iframe')?.getAttribute('src')).toBe(`${EXTENSION_ORIGIN}/src/ui/embedded.html`);
    // 阅读器没发 reader-ready 之前绝不隐藏原生评论：抓取进度要能看到，失败时原生评论仍在
    expect(document.querySelector<HTMLElement>('bili-comments')?.style.display ?? '').toBe('');
  });

  it('开关关闭时撤掉 iframe，不碰原生评论根', async () => {
    stored = { [PAGE_COMMENTS_ENABLED_KEY]: true };
    document.body.innerHTML = '<div id="commentapp"><bili-comments></bili-comments></div>';
    await start();
    expect(slots()).toHaveLength(1);

    setEnabled(false);
    await flush();

    expect(slots()).toHaveLength(0);
    expect(document.querySelector<HTMLElement>('bili-comments')?.style.display ?? '').toBe('');
  });

  it('开关关闭时启动不挂 iframe', async () => {
    document.body.innerHTML = '<div id="commentapp"><bili-comments></bili-comments></div>';
    await start();

    expect(slots()).toHaveLength(0);
  });

  it('开关只驱动替换：不再推原生样式增强的桥消息', async () => {
    stored = { [PAGE_COMMENTS_ENABLED_KEY]: true };
    document.body.innerHTML = '<div id="commentapp"><bili-comments></bili-comments></div>';
    await start();
    setEnabled(true);
    await flush();

    const styleMessages = posted.filter(
      (message) => typeof message === 'object' && message !== null && (message as Record<string, unknown>).source === NATIVE_STYLE_BRIDGE_SOURCE,
    );
    expect(styleMessages).toHaveLength(0);
    expect(slots()).toHaveLength(1);
  });
});
