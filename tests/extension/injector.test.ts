// @vitest-environment happy-dom
/**
 * 页面按钮注入的 DOM 行为测试。结构按实机 + 上游 Bilibili-Evolved 的 v3 组件链复刻：
 * bili-comments（open shadow root）→ bili-comment-thread-renderer（根评论）→ shadow
 * bili-comment-renderer → shadow #main>#footer → bili-comment-action-buttons-renderer
 * （按钮挂点，shadow 子节点 #pubdate/#like/#dislike/#reply/#more）；楼中楼是
 * bili-comment-reply-renderer，操作行同为 action-buttons-renderer。组件数据用 `__data` 里的
 * `rpid_str`（评论 id）：注入只看操作行能否解析出 rpid，`rcount` 等其余字段都不参与判定。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { icons as phosphorIcons } from '@iconify-json/ph';
import { createPageActionInjector, isOwnInsertion, type PageActionInjector } from '@/extension/content/injector';
import {
  LOUPE_ACTION_CLASS,
  LOUPE_KIND_ATTRIBUTE,
  LOUPE_RPID_ATTRIBUTE,
  VIDEO_ACTIONS_SELECTOR,
  VIDEO_CONTAINER_SELECTOR,
  collectShadowRoots,
  commentRpid,
  contextCommentIdOf,
} from '@/extension/content/targets';

/**
 * 图标数据的来源真值：Phosphor 的 `ph:magnifying-glass`。注入器把这一条路径数据内联成常量
 * （内容脚本是自包含 IIFE，整包 4.4 MB 的 icons.json 不能进每个视频页都要跑的页面脚本），
 * 这里回读包里的数据逐字比对：图标不许手绘，也不许和图标集悄悄漂移。
 */
const MAGNIFYING_GLASS_BODY = phosphorIcons.icons['magnifying-glass']?.body ?? '';
const MAGNIFYING_GLASS_VIEW_BOX = `0 0 ${phosphorIcons.width} ${phosphorIcons.height}`;
const MAGNIFYING_GLASS_PATH = /d="([^"]+)"/.exec(MAGNIFYING_GLASS_BODY)?.[1] ?? '';

interface CommentFixture {
  host: HTMLElement;
  actionsRow: HTMLElement;
  actionsShadow: ShadowRoot;
}

/** 自定义元素实例上的评论数据；实机由站点写入（上游读 `__data`）。 */
interface CommentDataCarrier {
  __data?: unknown;
  data?: unknown;
}

function setData(element: Element, rpid: string, rcount: number | string | null = 0): void {
  const carrier = element as CommentDataCarrier;
  // rcount 是实机字段（回复数，不含根评论）；null = 数据里读不出评论量
  carrier.__data = rcount === null ? { rpid_str: rpid } : { rpid_str: rpid, rcount };
}

/** 复刻一条评论的组件链，返回按钮应落在的操作行。 */
function buildComment(tag: string, rpid: string, rcount: number | null = 12): CommentFixture {
  const host = document.createElement(tag);
  setData(host, rpid, rcount);
  const hostShadow = host.attachShadow({ mode: 'open' });
  const renderer = document.createElement('bili-comment-renderer');
  setData(renderer, rpid, rcount);
  const rendererShadow = renderer.attachShadow({ mode: 'open' });
  const main = document.createElement('div');
  main.id = 'main';
  const footer = document.createElement('div');
  footer.id = 'footer';
  const actionsRow = document.createElement('bili-comment-action-buttons-renderer');
  setData(actionsRow, rpid, rcount);
  const actionsShadow = actionsRow.attachShadow({ mode: 'open' });
  for (const id of ['pubdate', 'like', 'dislike', 'reply', 'more']) {
    const child = document.createElement('span');
    child.id = id;
    actionsShadow.append(child);
  }
  footer.append(actionsRow);
  main.append(footer);
  rendererShadow.append(main);
  hostShadow.append(renderer);
  return { host, actionsRow, actionsShadow };
}

function collectButtons(): HTMLButtonElement[] {
  const scopes: ParentNode[] = [document, ...collectShadowRoots(document.documentElement)];
  const buttons: HTMLButtonElement[] = [];
  for (const scope of scopes) {
    for (const element of scope.querySelectorAll(`.${LOUPE_ACTION_CLASS}`)) {
      if (element instanceof HTMLButtonElement) buttons.push(element);
    }
  }
  return buttons;
}

function commentButtons(): HTMLButtonElement[] {
  return collectButtons().filter((button) => button.getAttribute(LOUPE_KIND_ATTRIBUTE) === 'thread');
}

function commentIds(): string[] {
  return commentButtons()
    .map((button) => button.getAttribute(LOUPE_RPID_ATTRIBUTE) ?? '')
    .sort();
}

/**
 * 推进注入器自己安排的合并重扫（它用 setTimeout 合并同一批变更，一轮扫描里还会再排下一轮——
 * 比如视频按钮要等操作行稳定）。先让 happy-dom 的 MutationObserver 回调（微任务）把定时器排上，
 * 再推进假时钟：推进量必须是正数，`advanceTimersByTimeAsync(0)` 挪不动时钟，跑不到扫描里新排的
 * 那一轮定时器。不依赖真实时间，也不会随机器负载抖动。
 */
async function flush(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1);
  }
}

interface FakeNavigation {
  added: string[];
  removed: string[];
  emit(): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

/** 假的 Navigation 对象：只记注入器装了/摘了哪些监听，并允许手动触发一次 navigate。 */
function installFakeNavigation(): FakeNavigation {
  const listeners = new Set<() => void>();
  const fake: FakeNavigation = {
    added: [],
    removed: [],
    addEventListener(type, listener) {
      fake.added.push(type);
      listeners.add(listener);
    },
    removeEventListener(type, listener) {
      fake.removed.push(type);
      listeners.delete(listener);
    },
    emit() {
      for (const listener of listeners) listener();
    },
  };
  Object.defineProperty(window, 'navigation', { value: fake, configurable: true });
  return fake;
}

/** 推进到「站点 hydration 完成」：视频按钮只在 window load（站点 hydration 结束）之后才插。 */
async function startLoaded(): Promise<void> {
  injector.start();
  window.dispatchEvent(new Event('load'));
  await flush();
}

const ROOT_ID = '316401376609';
const SUB_ID = '316401376610';

let injector: PageActionInjector;
let areaShadow: ShadowRoot;
let root: CommentFixture;
let sub: CommentFixture;

beforeEach(() => {
  // 只接管注入器用的 setTimeout；happy-dom 的 MutationObserver 走 queueMicrotask，保持真实
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  // happy-dom 的 readyState 由内部任务队列推进，时机不定；固定成未完成，让「load 之前」这一段稳定可测
  Object.defineProperty(document, 'readyState', { value: 'interactive', configurable: true });
  // happy-dom 没有 Navigation API，而 lib.dom 把 `window.navigation` 标成必填：钉成「没有」，
  // 默认路径就是 popstate/hashchange 回退；要测 Navigation API 的用例自己装一个假的
  Object.defineProperty(window, 'navigation', { value: undefined, configurable: true });
  // 实机里 bili-comments 由站点定义；测试里先定义好，whenDefined 才会 resolve
  if (customElements.get('bili-comments') === undefined) {
    customElements.define('bili-comments', class extends HTMLElement {});
  }
  document.body.innerHTML =
    '<div class="video-toolbar-container"><div id="arc_toolbar_report"><div class="video-toolbar-left"></div><div class="video-toolbar-right"><div class="video-toolbar-item"></div></div></div></div>';
  const area = document.createElement('bili-comments');
  areaShadow = area.attachShadow({ mode: 'open' });
  document.body.append(area);
  root = buildComment('bili-comment-thread-renderer', ROOT_ID);
  sub = buildComment('bili-comment-reply-renderer', SUB_ID);
  areaShadow.append(root.host);
  // 楼中楼挂在根评论线程内部（与实机一致：回复渲染器在线程渲染器的 shadow 里）
  root.host.shadowRoot?.append(sub.host);
  // 注入器自己不带任何开关状态：扫描到能解析出 rpid 的操作行就注入
  injector = createPageActionInjector(document);
});

afterEach(() => {
  injector.dispose();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('按钮注入', () => {
  it('每条评论一个按钮，挂在它自己的操作行里', async () => {
    await startLoaded();
    expect(commentIds()).toEqual([ROOT_ID, SUB_ID]);
    const rootButton = commentButtons().find((button) => button.getAttribute(LOUPE_RPID_ATTRIBUTE) === ROOT_ID);
    const subButton = commentButtons().find((button) => button.getAttribute(LOUPE_RPID_ATTRIBUTE) === SUB_ID);
    expect(rootButton?.parentNode).toBe(root.actionsShadow);
    expect(subButton?.parentNode).toBe(sub.actionsShadow);
    // 挂载点与数据属性不变，按钮内容换成 icon-only 放大镜（形状见下一条用例）
    expect(rootButton?.textContent).toBe('');
  });

  it('视频按钮追加在原生操作行内部，不插兄弟节点', async () => {
    await startLoaded();
    const row = document.querySelector(VIDEO_ACTIONS_SELECTOR);
    const videoButton = row?.querySelector(`.${LOUPE_ACTION_CLASS}`);
    expect(videoButton?.getAttribute(LOUPE_KIND_ATTRIBUTE)).toBe('subject');
    expect(videoButton?.getAttribute(LOUPE_RPID_ATTRIBUTE)).toBeNull();
    expect(videoButton?.textContent).toBe('');
    expect(videoButton?.getAttribute('aria-label')).toBe('Loupe 分析评论区');
    expect(videoButton?.getAttribute('title')).toBe('Loupe 分析评论区');
    const icon = videoButton?.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute('viewBox')).toBe(MAGNIFYING_GLASS_VIEW_BOX);
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    // 工具栏容器里只有原生工具栏一个孩子：注入没有变成兄弟节点
    expect(document.querySelector(VIDEO_CONTAINER_SELECTOR)?.children).toHaveLength(1);
  });

  it('window load 之前不碰页面 DOM，load 之后才插视频按钮', async () => {
    injector.start();
    await flush();
    const row = document.querySelector(VIDEO_ACTIONS_SELECTOR);
    expect(row?.querySelector(`.${LOUPE_ACTION_CLASS}`)).toBeNull();
    // 挂载游标不会被多出来的兄弟节点带偏：工具栏容器孩子数不变
    expect(document.querySelector(VIDEO_CONTAINER_SELECTOR)?.children).toHaveLength(1);
    window.dispatchEvent(new Event('load'));
    await flush();
    expect(row?.querySelector(`.${LOUPE_ACTION_CLASS}`)).not.toBeNull();
    expect(document.querySelector(VIDEO_CONTAINER_SELECTOR)?.children).toHaveLength(1);
  });

  it('站点 SSR 水合结束前一个页面节点都不写：标记还在就等，标记摘掉后重扫才落盘', async () => {
    // 站点是 SSR 预渲染：根容器带着 Vue 2 的水合标记。此刻写页面 DOM 会让站点 hydration 失配 →
    // 整棵 SSR DOM 被丢弃重建 → 页头组件二次 mounted → bili-header 二次 init 同一个容器
    // （它先清空容器、再 patch 上一个 app 的旧 vnode 树）→ 顶部全局 header 变空消失。
    const ssrRoot = document.createElement('div');
    ssrRoot.id = 'app';
    ssrRoot.setAttribute('data-server-rendered', 'true');
    document.body.append(ssrRoot);
    await startLoaded();
    const row = document.querySelector(VIDEO_ACTIONS_SELECTOR);
    expect(row?.querySelector(`.${LOUPE_ACTION_CLASS}`)).toBeNull();
    expect(commentButtons()).toHaveLength(0);
    expect(document.querySelector(VIDEO_CONTAINER_SELECTOR)?.children).toHaveLength(1);
    // 水合开始：Vue 2 在 patch 一开始就把标记摘掉（整棵树的挂载在同一个同步任务里完成）
    ssrRoot.removeAttribute('data-server-rendered');
    await flush();
    expect(row?.querySelector(`.${LOUPE_ACTION_CLASS}`)).not.toBeNull();
    expect(commentIds()).toEqual([ROOT_ID, SUB_ID]);
    expect(document.querySelector(VIDEO_CONTAINER_SELECTOR)?.children).toHaveLength(1);
  });

  it('懒加载：评论区后加入时按钮一起注入', async () => {
    // 页面滚动后才渲染评论区：初始没有 bili-comments
    areaShadow.host.remove();
    await startLoaded();
    expect(commentButtons()).toEqual([]);
    document.body.append(areaShadow.host);
    await flush();
    expect(commentIds()).toEqual([ROOT_ID, SUB_ID]);
  });

  it('楼中楼后加入（已在观察的 shadow root 内）也会注入', async () => {
    await startLoaded();
    const late = buildComment('bili-comment-reply-renderer', '316401376612');
    root.host.shadowRoot?.append(late.host);
    await flush();
    expect(commentIds()).toEqual([ROOT_ID, SUB_ID, '316401376612']);
  });

  it('楼中楼出现在新的嵌套 shadow root 里也会被发现', async () => {
    await startLoaded();
    const list = document.createElement('bili-comment-replies-renderer');
    const listShadow = list.attachShadow({ mode: 'open' });
    const late = buildComment('bili-comment-reply-renderer', '316401376613');
    listShadow.append(late.host);
    root.host.shadowRoot?.append(list);
    await flush();
    expect(commentIds()).toEqual([ROOT_ID, SUB_ID, '316401376613']);
  });

  it('评论被回收复用时同一个按钮改指新 id', async () => {
    await startLoaded();
    const before = commentButtons().find((button) => button.getAttribute(LOUPE_RPID_ATTRIBUTE) === ROOT_ID);
    setData(root.actionsRow, '999', 12);
    // 站点重渲染会带来 DOM 变更，重扫时按钮跟着换 id
    root.actionsShadow.append(document.createElement('span'));
    await flush();
    expect(commentIds()).toEqual([SUB_ID, '999']);
    expect(commentButtons().find((button) => button.getAttribute(LOUPE_RPID_ATTRIBUTE) === '999')).toBe(before);
  });

  it('重复扫描不会重复注入', async () => {
    await startLoaded();
    injector.reconcile();
    injector.reconcile();
    await flush();
    expect(commentIds()).toEqual([ROOT_ID, SUB_ID]);
    expect(collectButtons()).toHaveLength(3);
  });

  it('dispose 后移除全部按钮', async () => {
    await startLoaded();
    expect(collectButtons().length).toBeGreaterThan(0);
    injector.dispose();
    expect(collectButtons()).toEqual([]);
    expect(document.querySelector(VIDEO_ACTIONS_SELECTOR)?.querySelector(`.${LOUPE_ACTION_CLASS}`)).toBeNull();
  });
});

describe('评论行放大镜', () => {
  it('icon-only：按钮里只有 Phosphor 的 magnifying-glass，文字只做可访问名', async () => {
    await startLoaded();
    const button = commentButtons().find((item) => item.getAttribute(LOUPE_RPID_ATTRIBUTE) === ROOT_ID);
    // 按钮里没有文字节点：评论行不该被一个字串撑开
    expect(button?.textContent).toBe('');
    expect(button?.getAttribute('aria-label')).toBe('Loupe 分析评论树');
    expect(button?.title).toBe('Loupe 分析评论树');
    const icon = button?.querySelector('svg');
    expect(icon?.getAttribute('viewBox')).toBe(MAGNIFYING_GLASS_VIEW_BOX);
    // 图标只是装饰，可访问名在按钮上，读屏不该重复播报
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    const paths = Array.from(button?.querySelectorAll('path') ?? []);
    expect(paths).toHaveLength(1);
    // 与 @iconify-json/ph 里的数据逐字一致：既不手绘，也不随图标集漂移
    expect(paths[0]?.getAttribute('d')).toBe(MAGNIFYING_GLASS_PATH);
    expect(paths[0]?.getAttribute('fill')).toBe('currentColor');
  });

  it('每条评论（含楼中楼）各一个固定尺寸的放大镜，命中区不随评论内容变', async () => {
    await startLoaded();
    // 按钮的发现顺序取决于 shadow root 的遍历顺序，与评论在页面上的先后无关：这里断言集合
    expect(commentIds()).toEqual([ROOT_ID, SUB_ID]);
    const buttons = commentButtons();
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button.style.getPropertyValue('width')).toBe('24px');
      expect(button.style.getPropertyValue('height')).toBe('24px');
      expect(button.style.getPropertyValue('box-sizing')).toBe('border-box');
      const icon = button.querySelector('svg');
      expect(icon?.getAttribute('width')).toBe('16');
      expect(icon?.getAttribute('height')).toBe('16');
    }
  });

  it('视频级按钮同样为 icon-only 放大镜，可访问名为「Loupe 分析评论区」', async () => {
    await startLoaded();
    // VIDEO_ACTIONS_SELECTOR 自带 `.`，这里不能再补一个，否则选择器非法
    const videoButton = document.querySelector(`${VIDEO_ACTIONS_SELECTOR} .${LOUPE_ACTION_CLASS}`) as HTMLButtonElement | null;
    expect(videoButton?.textContent).toBe('');
    expect(videoButton?.getAttribute('aria-label')).toBe('Loupe 分析评论区');
    expect(videoButton?.title).toBe('Loupe 分析评论区');
    expect(videoButton?.style.getPropertyValue('width')).toBe('24px');
    expect(videoButton?.style.getPropertyValue('height')).toBe('24px');
    expect(videoButton?.style.getPropertyValue('box-sizing')).toBe('border-box');
    const icon = videoButton?.querySelector('svg');
    expect(icon?.getAttribute('viewBox')).toBe(MAGNIFYING_GLASS_VIEW_BOX);
    expect(icon?.getAttribute('width')).toBe('16');
    expect(icon?.getAttribute('height')).toBe('16');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    const paths = Array.from(videoButton?.querySelectorAll('path') ?? []);
    expect(paths).toHaveLength(1);
    expect(paths[0]?.getAttribute('d')).toBe(MAGNIFYING_GLASS_PATH);
    expect(paths[0]?.getAttribute('fill')).toBe('currentColor');
  });

  it('重扫不会重建视频级按钮：它始终是同一个节点', async () => {
    injector.dispose();
    injector = createPageActionInjector(document);
    injector.start();
    window.dispatchEvent(new Event('load'));
    await flush();
    const row = document.querySelector(VIDEO_ACTIONS_SELECTOR);
    const videoButton = row?.querySelector(`.${LOUPE_ACTION_CLASS}`);
    expect(videoButton).not.toBeNull();
    expect(videoButton?.getAttribute(LOUPE_KIND_ATTRIBUTE)).toBe('subject');

    // 两侧互不牵连：评论区重扫不会把已经装好的视频按钮换掉
    injector.reconcile();
    await flush();

    expect(row?.querySelector(`.${LOUPE_ACTION_CLASS}`)).toBe(videoButton);
    expect(commentIds()).toEqual([ROOT_ID, SUB_ID]);
  });
});

describe('评论量不参与注入判定', () => {
  /**
   * 用指定评论数据重建注入器（beforeEach 那套先撤掉），返回最终注入的 rpid 集合。
   * rcount 是实机字段「不含根评论的回复数」，注入不再读它——这些用例就是为了证明这一点。
   */
  async function scanWith(rcount: number | string | null): Promise<string[]> {
    injector.dispose();
    setData(root.actionsRow, ROOT_ID, rcount);
    setData(sub.actionsRow, SUB_ID, rcount);
    injector = createPageActionInjector(document);
    await startLoaded();
    return commentIds();
  }

  it('启动即注入：不用等任何桥消息，第一轮扫描就把按钮放好', async () => {
    injector.dispose();
    setData(root.actionsRow, ROOT_ID, 999);
    setData(sub.actionsRow, SUB_ID, 999);
    injector = createPageActionInjector(document);
    injector.start();
    window.dispatchEvent(new Event('load'));
    await flush();
    expect(commentIds()).toEqual([ROOT_ID, SUB_ID]);
  });

  it('评论量读不出来 / 为 0 / 极大：只要操作行解析得出 rpid 就注入', async () => {
    expect(await scanWith(null)).toEqual([ROOT_ID, SUB_ID]);
    expect(await scanWith(0)).toEqual([ROOT_ID, SUB_ID]);
    expect(await scanWith(999999)).toEqual([ROOT_ID, SUB_ID]);
  });

  it('计数长什么样（纯数字串 / 小数 / 非数字串 / 负数）都不影响注入', async () => {
    expect(await scanWith('10')).toEqual([ROOT_ID, SUB_ID]);
    expect(await scanWith(10.5)).toEqual([ROOT_ID, SUB_ID]);
    expect(await scanWith('12a')).toEqual([ROOT_ID, SUB_ID]);
    expect(await scanWith(-1)).toEqual([ROOT_ID, SUB_ID]);
  });

  it('rcount 缺失（只剩 rcount_str / count）也注入', async () => {
    injector.dispose();
    (root.actionsRow as CommentDataCarrier).__data = { rpid_str: ROOT_ID, rcount_str: '12' };
    (sub.actionsRow as CommentDataCarrier).__data = { rpid_str: SUB_ID, count: 0 };
    injector = createPageActionInjector(document);
    await startLoaded();
    expect(commentIds()).toEqual([ROOT_ID, SUB_ID]);
  });

  it('同一操作行只有一个按钮：rpid 变了就改指新 id，评论量怎么变都一样', async () => {
    await startLoaded();
    const before = commentButtons().find((button) => button.getAttribute(LOUPE_RPID_ATTRIBUTE) === ROOT_ID);
    expect(commentIds()).toEqual([ROOT_ID, SUB_ID]);
    expect(commentButtons()).toHaveLength(2);

    // rpid 换人，且评论量从 12 变成读不出来：判定只看 rpid，按钮原地改指
    setData(root.actionsRow, '999', null);
    // 站点重渲染会带来 DOM 变更，重扫时按钮跟着换 id
    root.actionsShadow.append(document.createElement('span'));
    await flush();

    expect(commentIds()).toEqual([SUB_ID, '999']);
    // 没有多出第二个按钮：还是同一个 DOM 节点，只是改了 id
    expect(commentButtons()).toHaveLength(2);
    expect(commentButtons().find((button) => button.getAttribute(LOUPE_RPID_ATTRIBUTE) === '999')).toBe(before);
  });
});

describe('SPA 导航检测', () => {
  it('不改写 history：站点那两个方法的身份原样保留', async () => {
    const pushState = history.pushState;
    const replaceState = history.replaceState;
    await startLoaded();
    expect(history.pushState).toBe(pushState);
    expect(history.replaceState).toBe(replaceState);
  });

  it('站点自己调 pushState 不触发我们动 DOM（没有补丁就没有副作用）', async () => {
    await startLoaded();
    // 只改组件数据、不做任何 DOM 变更：观察者不会醒，重扫与否完全取决于导航信号
    setData(root.actionsRow, '999', 12);
    history.pushState({}, '', '/video/BV1aaa411bbb/');
    await flush();
    expect(commentIds()).toEqual([ROOT_ID, SUB_ID]);
  });

  it('没有 Navigation API 时靠 popstate/hashchange 补一次重扫', async () => {
    await startLoaded();
    setData(root.actionsRow, '999', 12);
    window.dispatchEvent(new Event('popstate'));
    await flush();
    expect(commentIds()).toEqual([SUB_ID, '999']);
    setData(root.actionsRow, ROOT_ID, 12);
    window.dispatchEvent(new Event('hashchange'));
    await flush();
    expect(commentIds()).toEqual([ROOT_ID, SUB_ID]);
  });

  it('有 Navigation API 时走 navigate，不再挂 popstate/hashchange', async () => {
    const navigation = installFakeNavigation();
    await startLoaded();
    expect(navigation.added).toEqual(['navigate']);
    setData(root.actionsRow, '999', 12);
    // 回退路径没挂：popstate 不该带来重扫
    window.dispatchEvent(new Event('popstate'));
    await flush();
    expect(commentIds()).toEqual([ROOT_ID, SUB_ID]);
    navigation.emit();
    await flush();
    expect(commentIds()).toEqual([SUB_ID, '999']);
  });

  it('dispose 摘掉自己装的那一套导航监听', async () => {
    const navigation = installFakeNavigation();
    await startLoaded();
    expect(navigation.removed).toEqual([]);
    injector.dispose();
    expect(navigation.removed).toEqual(['navigate']);
    // 摘干净了：dispose 之后再来的 navigate 不该再排重扫
    navigation.emit();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('回退路径的监听在 dispose 时也摘干净', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    await startLoaded();
    const added = add.mock.calls.map((call) => call[0]);
    expect(added).toEqual(expect.arrayContaining(['popstate', 'hashchange']));
    expect(added).not.toContain('navigate');
    injector.dispose();
    const removed = remove.mock.calls.map((call) => call[0]);
    expect(removed).toEqual(expect.arrayContaining(['popstate', 'hashchange']));
  });
});

describe('视频按钮注入时机', () => {
  it('操作行还在被站点改写时不碰它，连续两轮孩子数一致才插', async () => {
    injector.start();
    window.dispatchEvent(new Event('load'));
    const row = document.querySelector(VIDEO_ACTIONS_SELECTOR);
    const injected = (): Element | null | undefined => row?.querySelector(`.${LOUPE_ACTION_CLASS}`);
    // 第一轮只认下操作行（站点这时还在往工具栏里渲染）
    injector.reconcile();
    expect(injected()).toBeNull();
    row?.append(document.createElement('span'));
    // 内容又变了：还没稳定，继续只观察
    injector.reconcile();
    expect(injected()).toBeNull();
    // 连续两轮孩子数一致 → 挂进去
    injector.reconcile();
    expect(injected()).not.toBeNull();
    expect(row?.children).toHaveLength(3);
  });

  it('操作行被站点整块换掉后不立刻插进新容器，先确认它稳定', async () => {
    await startLoaded();
    const first = document.querySelector(VIDEO_ACTIONS_SELECTOR);
    const replacement = document.createElement('div');
    // 选择器去掉前导 `.` 就是类名：站点重建工具栏时换的是同一个锚点类的新元素
    replacement.className = VIDEO_ACTIONS_SELECTOR.slice(1);
    first?.replaceWith(replacement);
    injector.reconcile();
    expect(replacement.querySelector(`.${LOUPE_ACTION_CLASS}`)).toBeNull();
    injector.reconcile();
    expect(replacement.querySelector(`.${LOUPE_ACTION_CLASS}`)).not.toBeNull();
  });
});

describe('isOwnInsertion', () => {
  const record = (addedNodes: Node[], removedNodes: Node[] = []): MutationRecord =>
    ({ addedNodes, removedNodes }) as unknown as MutationRecord;

  it('只有自己插入的节点才被忽略', () => {
    const button = document.createElement('button');
    button.className = LOUPE_ACTION_CLASS;
    expect(isOwnInsertion(record([button]))).toBe(true);
    expect(isOwnInsertion(record([document.createElement('div')]))).toBe(false);
    expect(isOwnInsertion(record([button, document.createElement('div')]))).toBe(false);
    expect(isOwnInsertion(record([button], [document.createElement('div')]))).toBe(false);
    expect(isOwnInsertion(record([], [button]))).toBe(false);
    expect(isOwnInsertion(record([]))).toBe(false);
  });
});

describe('评论 id 解析', () => {
  it('优先读组件数据，其次旧版 DOM 的 id 属性', () => {
    const element = document.createElement('bili-comment-action-buttons-renderer');
    setData(element, '123');
    expect(commentRpid(element)).toBe('123');
    expect(contextCommentIdOf(element)).toBe('123');
    const legacy = document.createElement('div');
    legacy.setAttribute('data-reply-id', '456');
    expect(commentRpid(legacy)).toBeNull();
    expect(contextCommentIdOf(legacy)).toBe('456');
  });

  it('`.data` 兜底、非数字一律不认', () => {
    const element = document.createElement('bili-comment-action-buttons-renderer');
    const carrier = element as CommentDataCarrier;
    carrier.data = { rpid_str: '789' };
    expect(commentRpid(element)).toBe('789');
    carrier.data = { rpid: 1.5 };
    expect(commentRpid(element)).toBeNull();
    carrier.data = { rpid_str: '12a' };
    expect(commentRpid(element)).toBeNull();
  });
});
