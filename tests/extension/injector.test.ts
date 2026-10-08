// @vitest-environment happy-dom
/**
 * 页面按钮注入的 DOM 行为测试。结构按实机 + 上游 Bilibili-Evolved 的 v3 组件链复刻：
 * bili-comments（open shadow root）→ bili-comment-thread-renderer（根评论）→ shadow
 * bili-comment-renderer → shadow #main>#footer → bili-comment-action-buttons-renderer
 * （按钮挂点，shadow 子节点 #pubdate/#like/#dislike/#reply/#more）；楼中楼是
 * bili-comment-reply-renderer，操作行同为 action-buttons-renderer。组件数据用 `__data.rpid_str`。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

function setData(element: Element, rpid: string): void {
  const carrier = element as CommentDataCarrier;
  carrier.__data = { rpid_str: rpid };
}

/** 复刻一条评论的组件链，返回按钮应落在的操作行。 */
function buildComment(tag: string, rpid: string): CommentFixture {
  const host = document.createElement(tag);
  setData(host, rpid);
  const hostShadow = host.attachShadow({ mode: 'open' });
  const renderer = document.createElement('bili-comment-renderer');
  setData(renderer, rpid);
  const rendererShadow = renderer.attachShadow({ mode: 'open' });
  const main = document.createElement('div');
  main.id = 'main';
  const footer = document.createElement('div');
  footer.id = 'footer';
  const actionsRow = document.createElement('bili-comment-action-buttons-renderer');
  setData(actionsRow, rpid);
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
 * 推进注入器自己安排的合并重扫（它用 setTimeout 合并同一批变更）。
 * 先让 happy-dom 的 MutationObserver 回调（微任务）把定时器排上，再用假定时器推进——
 * 不依赖真实时间，也不会随机器负载抖动。
 */
async function flush(): Promise<void> {
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
}

/** 视频按钮只在 window load（站点 hydration 结束）之后才插；测试里用 load 事件推进这一步。 */
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
  injector = createPageActionInjector(document);
});

afterEach(() => {
  injector.dispose();
  document.body.innerHTML = '';
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
    expect(rootButton?.textContent).toBe('Loupe 分析评论树');
  });

  it('视频按钮追加在原生操作行内部，不插兄弟节点', async () => {
    await startLoaded();
    const row = document.querySelector(VIDEO_ACTIONS_SELECTOR);
    const videoButton = row?.querySelector(`.${LOUPE_ACTION_CLASS}`);
    expect(videoButton?.getAttribute(LOUPE_KIND_ATTRIBUTE)).toBe('subject');
    expect(videoButton?.getAttribute(LOUPE_RPID_ATTRIBUTE)).toBeNull();
    expect(videoButton?.textContent).toBe('Loupe 分析评论区');
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
    setData(root.actionsRow, '999');
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
