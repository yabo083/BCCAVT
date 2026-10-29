// @vitest-environment happy-dom
/**
 * 原生多级回复重排与分支折叠的 DOM 行为测试。
 *
 * 结构按实机复刻：`bili-comments`（open shadow root）→ wrapper `<div>` → `bili-comment-thread-renderer`
 * → shadow 里是根评论 `bili-comment-renderer`（自带操作行）与 `#replies > bili-comment-replies-renderer`
 * → shadow 里 `#expander > #expander-contents`（楼中楼平铺的直接子元素）+ `#expander-footer`，
 * 编辑器 `#reply-container` 在容器外。评论数据按实机的组件数据形状挂在 `__data` 上
 * （`rpid_str` / `root_str` / `parent_str` / `rcount`，纯数字字符串）。
 *
 * happy-dom 不算样式，也不解析 `calc()`；这里验证的是可观察契约：容器标记、每条的视觉序号/层级变量、
 * 折叠标记与控件（属性、文案、点击行为）、结构变脏时的 fail-safe 还原、关闭后的彻底还原，
 * 以及「节点身份与 DOM 顺序不变、原生事件照旧」。视觉结果需在真实页面复核。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { icons as phosphorIcons } from '@iconify-json/ph';
import {
  NATIVE_THREAD_CSS,
  THREAD_DEPTH_PROPERTY,
  THREAD_HIDDEN_ATTRIBUTE,
  THREAD_ORDER_PROPERTY,
  THREAD_ORDERED_ATTRIBUTE,
  THREAD_ORPHAN_ATTRIBUTE,
  THREAD_TOGGLE_CLASS,
  THREAD_TOGGLE_ID_ATTRIBUTE,
  THREAD_TOGGLE_ROOT_ATTRIBUTE,
  createNativeThreadOrganizer,
  type NativeThreadOrganizer,
} from '@/extension/content/native-thread';
import { MAX_THREAD_DEPTH } from '@/extension/content/native-thread-layout';
import { COMMENT_AREA_SELECTOR } from '@/extension/content/targets';

/** 图标数据的真值来源：与 injector 同一套做法，回读包里的数据逐字比对（图标不许手绘、不许漂移）。 */
const CARET_BODY = phosphorIcons.icons['caret-down']?.body ?? '';
const CARET_VIEW_BOX = `0 0 ${phosphorIcons.width} ${phosphorIcons.height}`;
const CARET_PATH = /d="([^"]+)"/.exec(CARET_BODY)?.[1] ?? '';

interface CommentShell {
  host: HTMLElement;
  shadow: ShadowRoot;
  actions: HTMLElement;
  actionsShadow: ShadowRoot;
}

/** 一条评论的组件外壳：自己的 shadow root（#main/#footer）+ 操作行（自带 shadow root）。 */
function buildComment(tag: string): CommentShell {
  const host = document.createElement(tag);
  const shadow = host.attachShadow({ mode: 'open' });
  const main = document.createElement('div');
  main.id = 'main';
  const footer = document.createElement('div');
  footer.id = 'footer';
  const actions = document.createElement('bili-comment-action-buttons-renderer');
  const actionsShadow = actions.attachShadow({ mode: 'open' });
  const pubdate = document.createElement('div');
  pubdate.id = 'pubdate';
  actionsShadow.append(pubdate);
  footer.append(actions);
  shadow.append(main, footer);
  return { host, shadow, actions, actionsShadow };
}

/** 组件数据（实机形状）：`__data` 与 `.data` 两处都读，测试里统一挂 `__data`。 */
function withData(element: Element, data: Record<string, unknown>): void {
  (element as Element & { __data?: unknown }).__data = data;
}

/** 摘掉组件数据（模拟「这条读不出 rpid」的未知组件版本）。 */
function clearData(element: Element): void {
  delete (element as Element & { __data?: unknown }).__data;
}

interface ThreadFixture {
  rootId: string;
  host: HTMLElement;
  comment: CommentShell;
  repliesHost: HTMLElement;
  repliesShadow: ShadowRoot;
  contents: HTMLElement;
  viewMore: HTMLElement;
  editor: HTMLElement;
  wrapper: HTMLElement;
}

/** 一个讨论块：根评论 + 楼中楼容器（`#expander > #expander-contents`）+ 容器外的分页入口与编辑器。 */
function buildThread(rootId: string, declaredReplies = 0): ThreadFixture {
  const host = document.createElement('bili-comment-thread-renderer');
  const shadow = host.attachShadow({ mode: 'open' });
  const comment = buildComment('bili-comment-renderer');
  const rootData = { rpid_str: rootId, root_str: '0', parent_str: '0', rcount: declaredReplies };
  withData(comment.host, rootData);
  withData(comment.actions, rootData);

  const repliesHost = document.createElement('bili-comment-replies-renderer');
  const repliesShadow = repliesHost.attachShadow({ mode: 'open' });
  const expander = document.createElement('div');
  expander.id = 'expander';
  const contents = document.createElement('div');
  contents.id = 'expander-contents';
  const expanderFooter = document.createElement('div');
  expanderFooter.id = 'expander-footer';
  const viewMore = document.createElement('span');
  viewMore.id = 'view-more';
  expanderFooter.append(viewMore);
  expander.append(contents, expanderFooter);
  repliesShadow.append(expander);

  const repliesWrap = document.createElement('div');
  repliesWrap.id = 'replies';
  repliesWrap.append(repliesHost);
  const editor = document.createElement('div');
  editor.id = 'reply-container';
  shadow.append(comment.host, repliesWrap, editor, document.createElement('div'));

  // 实机里每个 thread-renderer 外面还套一层无属性的 <div>（Lit 片段），这里照做
  const wrapper = document.createElement('div');
  wrapper.append(host);
  return { rootId, host, comment, repliesHost, repliesShadow, contents, viewMore, editor, wrapper };
}

type DataPlacement = 'host' | 'actionRow' | 'none';

/** 一条楼中楼：数据默认同时在 reply host 与操作行上（实机两处都有），可按需只挂一处或都不挂。 */
function buildReply(rootId: string, id: string, parent: string | null, placement: DataPlacement = 'host'): CommentShell {
  const comment = buildComment('bili-comment-reply-renderer');
  const data = { rpid_str: id, root_str: rootId, parent_str: parent ?? '0', rcount: 0 };
  if (placement === 'host') {
    withData(comment.host, data);
    withData(comment.actions, data);
  }
  if (placement === 'actionRow') withData(comment.actions, data);
  return comment;
}

interface ReplySpec {
  id: string;
  parent: string | null;
  placement?: DataPlacement;
}

/** 按给定顺序把楼中楼追加进容器（顺序就是原生 DOM 顺序）。 */
function appendReplies(thread: ThreadFixture, specs: readonly ReplySpec[]): CommentShell[] {
  return specs.map((spec) => {
    const reply = buildReply(thread.rootId, spec.id, spec.parent, spec.placement ?? 'host');
    thread.contents.append(reply.host);
    return reply;
  });
}

function toggleIn(comment: CommentShell): HTMLButtonElement | null {
  return comment.actionsShadow.querySelector<HTMLButtonElement>(`.${THREAD_TOGGLE_CLASS}`);
}

function orderOf(element: HTMLElement): string {
  return element.style.getPropertyValue(THREAD_ORDER_PROPERTY);
}

function depthOf(element: HTMLElement): string {
  return element.style.getPropertyValue(THREAD_DEPTH_PROPERTY);
}

let area: HTMLElement;
let areaShadow: ShadowRoot;
let organizer: NativeThreadOrganizer;

function buildArea(): void {
  area = document.createElement(COMMENT_AREA_SELECTOR);
  areaShadow = area.attachShadow({ mode: 'open' });
  document.body.append(area);
}

/** 推进合并重扫（重排器用 setTimeout 合并变更）与 whenDefined 的微任务。 */
async function flush(): Promise<void> {
  for (let round = 0; round < 4; round += 1) {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
  }
}

async function enable(): Promise<void> {
  organizer.setEnabled(true);
  await flush();
}

beforeEach(() => {
  // 只接管重排器用的 setTimeout；happy-dom 的 MutationObserver 走 queueMicrotask，保持真实
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  if (customElements.get(COMMENT_AREA_SELECTOR) === undefined) {
    customElements.define(COMMENT_AREA_SELECTOR, class extends HTMLElement {});
  }
  document.body.innerHTML = '';
  buildArea();
  organizer = createNativeThreadOrganizer(document);
  organizer.start();
});

afterEach(() => {
  organizer.dispose();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('父先子后重排（DOM 不移动）', () => {
  it('乱序 DOM（孙排在父前面）按前序写下视觉序号，节点身份与 DOM 顺序原样', async () => {
    const thread = buildThread('100');
    const [grandChild, parent, child] = appendReplies(thread, [
      { id: '3', parent: '2' },
      { id: '1', parent: '100' },
      { id: '2', parent: '1' },
    ]);
    areaShadow.append(thread.wrapper);
    const before = [...thread.contents.childNodes];

    await enable();

    expect(thread.contents.hasAttribute(THREAD_ORDERED_ATTRIBUTE)).toBe(true);
    expect([orderOf(parent!.host), orderOf(child!.host), orderOf(grandChild!.host)]).toEqual(['0', '1', '2']);
    expect([depthOf(parent!.host), depthOf(child!.host), depthOf(grandChild!.host)]).toEqual(['0', '1', '2']);
    // DOM 一个节点都没移动：顺序、父子关系、节点身份全部原样（逐个按同一性比对）
    expect(thread.contents.childNodes).toHaveLength(before.length);
    for (const [index, node] of before.entries()) expect(thread.contents.childNodes[index]).toBe(node);
    for (const node of before) expect(node.parentNode).toBe(thread.contents);
    expect(thread.contents.children).toHaveLength(3);
    // 不写原生节点的 display，也不隐藏任何没被标记的节点
    for (const reply of [parent!, child!, grandChild!]) expect(reply.host.style.display).toBe('');
  });

  it('同层保持原生 DOM 顺序（不按 id 或时间重排）', async () => {
    const thread = buildThread('100');
    const [y, z, x] = appendReplies(thread, [
      { id: '11', parent: '100' },
      { id: '12', parent: '100' },
      { id: '13', parent: '100' },
    ]);
    areaShadow.append(thread.wrapper);

    await enable();

    expect([orderOf(y!.host), orderOf(z!.host), orderOf(x!.host)]).toEqual(['0', '1', '2']);
    expect([y!.host, z!.host, x!.host].map(depthOf)).toEqual(['0', '0', '0']);
  });

  it('层级逐级递增并封顶到 MAX_THREAD_DEPTH（样式表也 clamp 到同一个值）', async () => {
    const thread = buildThread('100');
    // 从最深的往浅的 append：DOM 顺序与层级顺序相反，顺带验「乱序也要父先子后」
    const replies = new Map<string, CommentShell>();
    for (let index = 12; index >= 1; index -= 1) {
      const reply = buildReply('100', String(index), index === 1 ? '100' : String(index - 1));
      thread.contents.append(reply.host);
      replies.set(String(index), reply);
    }
    areaShadow.append(thread.wrapper);

    await enable();

    // 12 → 6 都封顶在 MAX_THREAD_DEPTH，5 → 1 逐级递减到 0
    expect([...replies.keys()].map((id) => depthOf(replies.get(id)!.host))).toEqual([
      '5',
      '5',
      '5',
      '5',
      '5',
      '5',
      '5',
      '4',
      '3',
      '2',
      '1',
      '0',
    ]);
    expect([...replies.keys()].map((id) => orderOf(replies.get(id)!.host))).toEqual([
      '11',
      '10',
      '9',
      '8',
      '7',
      '6',
      '5',
      '4',
      '3',
      '2',
      '1',
      '0',
    ]);
    expect(MAX_THREAD_DEPTH).toBe(5);
    expect(NATIVE_THREAD_CSS).toContain(`min(var(${THREAD_DEPTH_PROPERTY}, 0), ${MAX_THREAD_DEPTH})`);
  });

  it('父评论不在已加载列表里：显示在当前顶层并标孤立（样式表就地说明，不假装属于某条分支）', async () => {
    const thread = buildThread('100');
    const [orphan, nested] = appendReplies(thread, [
      { id: '9', parent: '999' },
      { id: '10', parent: '9' },
    ]);
    areaShadow.append(thread.wrapper);

    await enable();

    expect(orderOf(orphan!.host)).toBe('0');
    expect(depthOf(orphan!.host)).toBe('0');
    expect(orphan!.host.hasAttribute(THREAD_ORPHAN_ATTRIBUTE)).toBe(true);
    // 它自己的后代照常嵌套在它下面，不算孤立
    expect(depthOf(nested!.host)).toBe('1');
    expect(nested!.host.hasAttribute(THREAD_ORPHAN_ATTRIBUTE)).toBe(false);
    expect(NATIVE_THREAD_CSS).toContain(`[${THREAD_ORPHAN_ATTRIBUTE}]::before`);
    expect(NATIVE_THREAD_CSS).toContain("content: '父评论未加载'");
  });

  it('父链成环：不挂死、两条都排上、没有隐藏', async () => {
    const thread = buildThread('100');
    const [first, second] = appendReplies(thread, [
      { id: '1', parent: '2' },
      { id: '2', parent: '1' },
    ]);
    areaShadow.append(thread.wrapper);

    await enable();

    expect([orderOf(first!.host), orderOf(second!.host)].sort()).toEqual(['0', '1']);
    for (const reply of [first!, second!]) expect(reply.host.hasAttribute(THREAD_HIDDEN_ATTRIBUTE)).toBe(false);
    // 环被剪断：一条顶层并标孤立，另一条嵌在它下面
    expect([first!.host, second!.host].filter((host) => host.hasAttribute(THREAD_ORPHAN_ATTRIBUTE))).toHaveLength(1);
  });
});

describe('折叠控件与祖先叠加', () => {
  it('只有「有已加载后代」的评论才有控件，且文案只报已加载条数（平台声明另附）', async () => {
    const thread = buildThread('100', 12);
    const [parent, leaf] = appendReplies(thread, [
      { id: '1', parent: '100' },
      { id: '2', parent: '1' },
    ]);
    areaShadow.append(thread.wrapper);

    await enable();

    const rootToggle = toggleIn(thread.comment);
    expect(rootToggle).not.toBeNull();
    expect(rootToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(rootToggle?.title).toBe('折叠 2 条已加载回复（平台声明 12 条）');
    expect(rootToggle?.getAttribute('aria-label')).toBe(rootToggle?.title);
    expect(rootToggle?.getAttribute(THREAD_TOGGLE_ID_ATTRIBUTE)).toBe('100');
    expect(rootToggle?.getAttribute(THREAD_TOGGLE_ROOT_ATTRIBUTE)).toBe('100');

    const parentToggle = toggleIn(parent!);
    expect(parentToggle?.title).toBe('折叠 1 条已加载回复');
    // 叶子没有已加载后代：不给控件
    expect(toggleIn(leaf!)).toBeNull();
  });

  it('点击折叠只隐藏已加载后代（节点保留、容器外的分页与编辑器不动），再点恢复', async () => {
    const thread = buildThread('100', 30);
    const [parent, child, sibling] = appendReplies(thread, [
      { id: '1', parent: '100' },
      { id: '2', parent: '1' },
      { id: '3', parent: '100' },
    ]);
    areaShadow.append(thread.wrapper);
    await enable();

    const toggle = toggleIn(thread.comment);
    toggle?.click();

    for (const reply of [parent!, child!, sibling!]) expect(reply.host.hasAttribute(THREAD_HIDDEN_ATTRIBUTE)).toBe(true);
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(toggle?.title).toBe('已折叠 3 条已加载回复，点击展开（平台声明 30 条）');
    // 只隐藏「已加载」的那几条：节点仍在 DOM 里，容器外的分页入口、编辑器与根评论都不动
    expect(thread.contents.children).toHaveLength(3);
    expect(thread.viewMore.hasAttribute(THREAD_HIDDEN_ATTRIBUTE)).toBe(false);
    expect(thread.editor.hasAttribute(THREAD_HIDDEN_ATTRIBUTE)).toBe(false);
    expect(thread.comment.host.hasAttribute(THREAD_HIDDEN_ATTRIBUTE)).toBe(false);
    expect(thread.contents.style.display).toBe('');

    toggle?.click();
    for (const reply of [parent!, child!, sibling!]) expect(reply.host.hasAttribute(THREAD_HIDDEN_ATTRIBUTE)).toBe(false);
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
  });

  it('祖先折叠叠加自身折叠：展开祖先后，子分支自己的折叠照旧生效', async () => {
    const thread = buildThread('100');
    const [parent, child, grandChild, sibling] = appendReplies(thread, [
      { id: '1', parent: '100' },
      { id: '2', parent: '1' },
      { id: '3', parent: '2' },
      { id: '4', parent: '100' },
    ]);
    areaShadow.append(thread.wrapper);
    await enable();

    const parentToggle = toggleIn(parent!);
    const childToggle = toggleIn(child!);
    parentToggle?.click(); // 折叠 1 → 2、3 隐藏
    childToggle?.click(); // 叠一层：2 自己也折叠
    expect([parent!, child!, grandChild!, sibling!].map((reply) => reply.host.hasAttribute(THREAD_HIDDEN_ATTRIBUTE))).toEqual([
      false,
      true,
      true,
      false,
    ]);

    parentToggle?.click(); // 展开 1：2 自己可见，但它折叠着，3 仍然隐藏
    expect(child!.host.hasAttribute(THREAD_HIDDEN_ATTRIBUTE)).toBe(false);
    expect(grandChild!.host.hasAttribute(THREAD_HIDDEN_ATTRIBUTE)).toBe(true);
    expect(sibling!.host.hasAttribute(THREAD_HIDDEN_ATTRIBUTE)).toBe(false);

    childToggle?.click(); // 再展开 2：3 恢复
    expect(grandChild!.host.hasAttribute(THREAD_HIDDEN_ATTRIBUTE)).toBe(false);
  });

  it('分页追加：折叠中的评论，后加载的后代继承折叠状态，计数跟着涨', async () => {
    const thread = buildThread('100');
    const [parent, child] = appendReplies(thread, [
      { id: '1', parent: '100' },
      { id: '2', parent: '1' },
    ]);
    areaShadow.append(thread.wrapper);
    await enable();

    const parentToggle = toggleIn(parent!);
    parentToggle?.click();
    expect(parentToggle?.title).toBe('已折叠 1 条已加载回复，点击展开');

    const [deeper, secondChild] = appendReplies(thread, [
      { id: '3', parent: '2' },
      { id: '4', parent: '1' },
    ]);
    await flush();

    for (const reply of [child!, deeper!, secondChild!]) expect(reply.host.hasAttribute(THREAD_HIDDEN_ATTRIBUTE)).toBe(true);
    expect(parentToggle?.title).toBe('已折叠 3 条已加载回复，点击展开');
    // 新加载的条目也拿到了序号与层级
    expect(orderOf(deeper!.host)).toBe('2');
    expect(depthOf(deeper!.host)).toBe('2');
    expect(orderOf(secondChild!.host)).toBe('3');
    expect(depthOf(secondChild!.host)).toBe('1');
  });

  it('原生节点身份与事件不变：只有自己控件的点击被拦下，原生点击照旧', async () => {
    const thread = buildThread('100');
    const [parent, child] = appendReplies(thread, [
      { id: '1', parent: '100' },
      { id: '2', parent: '1' },
    ]);
    areaShadow.append(thread.wrapper);
    await enable();

    const nativeClicks: string[] = [];
    const containerClicks: string[] = [];
    parent!.host.addEventListener('click', () => nativeClicks.push('native'));
    thread.contents.addEventListener('click', () => containerClicks.push('container'));

    toggleIn(parent!)?.click();
    expect(nativeClicks).toEqual([]);
    expect(containerClicks).toEqual([]);
    expect(child!.host.hasAttribute(THREAD_HIDDEN_ATTRIBUTE)).toBe(true);

    parent!.host.click();
    expect(nativeClicks).toEqual(['native']);
    expect(containerClicks).toEqual(['container']);
  });

  it('控件图标逐字取自 @iconify-json/ph 的 caret-down', async () => {
    const thread = buildThread('100');
    appendReplies(thread, [{ id: '1', parent: '100' }]);
    areaShadow.append(thread.wrapper);
    await enable();

    const button = toggleIn(thread.comment);
    const svg = button?.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe(CARET_VIEW_BOX);
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    const paths = [...(button?.querySelectorAll('path') ?? [])];
    expect(paths).toHaveLength(1);
    expect(paths[0]?.getAttribute('d')).toBe(CARET_PATH);
    expect(paths[0]?.getAttribute('fill')).toBe('currentColor');
  });
});

describe('未知 / 脏结构 fail-safe', () => {
  it('容器里混着非回复子元素（#expander-footer 与未知残留）：只跳过它们，容器照旧重排+折叠', async () => {
    const thread = buildThread('100');
    const [reply] = appendReplies(thread, [{ id: '1', parent: '100' }]);
    // 实机形状（已取证）：#expander-contents 的直接子元素 = N 个 reply renderer + 一个 #expander-footer。
    // 这里把夹具里的分页入口挪进容器，再塞一个换版残留的未知元素——两者都不参与排序
    const footer = thread.contents.parentElement?.querySelector<HTMLElement>('#expander-footer') ?? null;
    if (footer === null) throw new Error('夹具不完整：找不到 #expander-footer');
    const stranger = document.createElement('div');
    thread.contents.append(footer, stranger);
    areaShadow.append(thread.wrapper);

    await enable();

    // 容器判定是「直接子元素里至少有一个 reply renderer」：混着非回复节点照样重排、照样给控件
    expect(thread.contents.hasAttribute(THREAD_ORDERED_ATTRIBUTE)).toBe(true);
    expect(orderOf(reply!.host)).toBe('0');
    expect(depthOf(reply!.host)).toBe('0');
    expect(toggleIn(thread.comment)).not.toBeNull();
    // 非回复子元素不排、不隐藏、不写自有属性；只在样式表里靠 order 让位给回复
    for (const node of [footer, stranger]) {
      expect(node.hasAttribute(THREAD_ORDERED_ATTRIBUTE)).toBe(false);
      expect(node.hasAttribute(THREAD_HIDDEN_ATTRIBUTE)).toBe(false);
      expect(node.hasAttribute(THREAD_ORPHAN_ATTRIBUTE)).toBe(false);
      expect(node.style.cssText).toBe('');
    }
    expect(thread.viewMore.hasAttribute(THREAD_HIDDEN_ATTRIBUTE)).toBe(false);
  });

  it('容器里一条 reply renderer 都没有（只剩分页入口这类非回复子元素）：整线程不动作', async () => {
    const thread = buildThread('100');
    thread.contents.append(document.createElement('div'));
    areaShadow.append(thread.wrapper);

    await enable();

    expect(thread.contents.hasAttribute(THREAD_ORDERED_ATTRIBUTE)).toBe(false);
    expect(thread.contents.children).toHaveLength(1);
    expect(toggleIn(thread.comment)).toBeNull();
  });

  it('某条读不到 rpid（或 rpid 重复）：整容器跳过，不排不隐藏', async () => {
    const thread = buildThread('100');
    const [reply] = appendReplies(thread, [
      { id: '1', parent: '100' },
      { id: '2', parent: '100', placement: 'none' },
    ]);
    areaShadow.append(thread.wrapper);
    await enable();
    expect(thread.contents.hasAttribute(THREAD_ORDERED_ATTRIBUTE)).toBe(false);
    expect(orderOf(reply!.host)).toBe('');

    // 补上数据后正常重排；再把两条改成同一个 rpid → 又整容器跳过
    withData(thread.contents.children[1]!, { rpid_str: '2', root_str: '100', parent_str: '100', rcount: 0 });
    organizer.reconcile();
    expect(thread.contents.hasAttribute(THREAD_ORDERED_ATTRIBUTE)).toBe(true);
    withData(thread.contents.children[1]!, { rpid_str: '1', root_str: '100', parent_str: '100', rcount: 0 });
    organizer.reconcile();
    expect(thread.contents.hasAttribute(THREAD_ORDERED_ATTRIBUTE)).toBe(false);
  });

  it('根评论数据缺失（评论组件、操作行与 thread host 都没有）：整线程跳过，父 id 无从解释就不排', async () => {
    const thread = buildThread('100');
    const [reply] = appendReplies(thread, [{ id: '1', parent: '100' }]);
    areaShadow.append(thread.wrapper);
    clearData(thread.comment.host);
    clearData(thread.comment.actions);
    clearData(thread.host);

    await enable();

    expect(thread.contents.hasAttribute(THREAD_ORDERED_ATTRIBUTE)).toBe(false);
    expect(orderOf(reply!.host)).toBe('');
    expect(toggleIn(thread.comment)).toBeNull();
  });

  it('数据只在操作行上（reply host 没有）：回退读取成立', async () => {
    const thread = buildThread('100');
    const [parent, child] = appendReplies(thread, [
      { id: '1', parent: '100', placement: 'actionRow' },
      { id: '2', parent: '1', placement: 'actionRow' },
    ]);
    areaShadow.append(thread.wrapper);

    await enable();

    expect(thread.contents.hasAttribute(THREAD_ORDERED_ATTRIBUTE)).toBe(true);
    expect([orderOf(parent!.host), orderOf(child!.host)]).toEqual(['0', '1']);
    expect(depthOf(child!.host)).toBe('1');
  });
});

describe('线程隔离、宿主替换与复用', () => {
  it('折叠状态按线程分开存：两个线程里有同名 id 时也互不影响（切换线程不串）', async () => {
    const first = buildThread('100');
    const second = buildThread('200');
    const [firstReply, firstChild] = appendReplies(first, [
      { id: '1', parent: '100' },
      { id: '9', parent: '1' },
    ]);
    const [secondReply, secondChild] = appendReplies(second, [
      { id: '1', parent: '200' },
      { id: '9', parent: '1' },
    ]);
    areaShadow.append(first.wrapper, second.wrapper);
    await enable();

    // 折叠第一个线程里的回复 1：同一个 id 在第二个线程里不受影响
    toggleIn(firstReply!)?.click();

    expect(firstChild!.host.hasAttribute(THREAD_HIDDEN_ATTRIBUTE)).toBe(true);
    expect(secondReply!.host.hasAttribute(THREAD_HIDDEN_ATTRIBUTE)).toBe(false);
    expect(secondChild!.host.hasAttribute(THREAD_HIDDEN_ATTRIBUTE)).toBe(false);
  });

  it('线程根整块替换：同一 id 的新宿主仍然继承折叠状态', async () => {
    const first = buildThread('100');
    const [reply] = appendReplies(first, [{ id: '1', parent: '100' }]);
    areaShadow.append(first.wrapper);
    await enable();
    toggleIn(first.comment)?.click();
    expect(reply!.host.hasAttribute(THREAD_HIDDEN_ATTRIBUTE)).toBe(true);

    const replacement = buildThread('100');
    const [replacementReply] = appendReplies(replacement, [{ id: '1', parent: '100' }]);
    areaShadow.append(replacement.wrapper);
    first.wrapper.remove();
    await flush();

    expect(replacementReply!.host.hasAttribute(THREAD_HIDDEN_ATTRIBUTE)).toBe(true);
    expect(toggleIn(replacement.comment)?.getAttribute('aria-expanded')).toBe('false');
    // 旧宿主上不留任何自有写入
    expect(orderOf(reply!.host)).toBe('');
    expect(reply!.host.hasAttribute(THREAD_HIDDEN_ATTRIBUTE)).toBe(false);
  });

  it('宿主复用（同一个元素换成另一条评论的数据）：序号、层级与控件指向都跟着更新', async () => {
    const thread = buildThread('100');
    const [parent, reused] = appendReplies(thread, [
      { id: '1', parent: '100' },
      { id: '2', parent: '1' },
    ]);
    areaShadow.append(thread.wrapper);
    await enable();
    expect(depthOf(reused!.host)).toBe('1');
    expect(toggleIn(parent!)?.getAttribute(THREAD_TOGGLE_ID_ATTRIBUTE)).toBe('1');

    // 站点回收复用了这两个元素：第一个换成新 id 并升为顶层父，第二个改挂到它下面
    const firstData = { rpid_str: '9', root_str: '100', parent_str: '100', rcount: 0 };
    withData(parent!.host, firstData);
    withData(parent!.actions, firstData);
    const secondData = { rpid_str: '2', root_str: '100', parent_str: '9', rcount: 0 };
    withData(reused!.host, secondData);
    withData(reused!.actions, secondData);
    organizer.reconcile();

    expect([orderOf(parent!.host), orderOf(reused!.host)]).toEqual(['0', '1']);
    expect([depthOf(parent!.host), depthOf(reused!.host)]).toEqual(['0', '1']);
    // 控件跟着新 id 走：新的父拿到指向 9 的控件，叶子没有
    expect(toggleIn(parent!)?.getAttribute(THREAD_TOGGLE_ID_ATTRIBUTE)).toBe('9');
    expect(toggleIn(parent!)?.title).toBe('折叠 1 条已加载回复');
    expect(toggleIn(reused!)).toBeNull();
  });
});

describe('关闭与清理', () => {
  it('关闭：内联变量回到写之前的原值、自有属性摘掉、控件移除、样式表摘除', async () => {
    const thread = buildThread('100');
    const [reply] = appendReplies(thread, [{ id: '1', parent: '100' }]);
    areaShadow.append(thread.wrapper);
    // 站点自己在这个条目上留的内联声明：关闭后必须逐字保持
    reply!.host.style.setProperty(THREAD_DEPTH_PROPERTY, '7px');
    reply!.host.style.setProperty('--bili-rich-text-font-size', '14px');
    reply!.host.style.setProperty('order', '3');

    await enable();
    expect(depthOf(reply!.host)).toBe('0');
    // 样式表只放进真正用得上它的 root：楼中楼容器所在 root 与控件所在的操作行 root
    expect(thread.repliesShadow.adoptedStyleSheets).toHaveLength(1);
    expect(thread.comment.actionsShadow.adoptedStyleSheets).toHaveLength(1);
    expect(areaShadow.adoptedStyleSheets).toHaveLength(0);

    organizer.setEnabled(false);
    await flush();

    expect(depthOf(reply!.host)).toBe('7px');
    expect(reply!.host.style.getPropertyValue('--bili-rich-text-font-size')).toBe('14px');
    expect(reply!.host.style.getPropertyValue('order')).toBe('3');
    expect(orderOf(reply!.host)).toBe('');
    expect(thread.contents.hasAttribute(THREAD_ORDERED_ATTRIBUTE)).toBe(false);
    expect(toggleIn(thread.comment)).toBeNull();
    expect(areaShadow.adoptedStyleSheets).toHaveLength(0);
    expect(thread.repliesShadow.adoptedStyleSheets).toHaveLength(0);
  });

  it('关闭再开启（往返）幂等：不重复注入样式表、不重复控件', async () => {
    const thread = buildThread('100');
    appendReplies(thread, [{ id: '1', parent: '100' }]);
    areaShadow.append(thread.wrapper);
    await enable();
    organizer.setEnabled(false);
    await flush();
    await enable();

    expect(areaShadow.adoptedStyleSheets).toHaveLength(0);
    expect(thread.repliesShadow.adoptedStyleSheets).toHaveLength(1);
    expect(thread.comment.actionsShadow.querySelectorAll(`.${THREAD_TOGGLE_CLASS}`)).toHaveLength(1);
    expect(thread.contents.hasAttribute(THREAD_ORDERED_ATTRIBUTE)).toBe(true);
  });

  it('dispose：还原全部自有改动、停止观察（后加入的回复不再被改），之后的开启是空操作', async () => {
    const thread = buildThread('100');
    const [reply] = appendReplies(thread, [{ id: '1', parent: '100' }]);
    areaShadow.append(thread.wrapper);
    await enable();
    const adoptedScopes = [thread.repliesShadow, thread.comment.actionsShadow];

    organizer.dispose();
    expect(orderOf(reply!.host)).toBe('');
    expect(thread.contents.hasAttribute(THREAD_ORDERED_ATTRIBUTE)).toBe(false);
    for (const root of [areaShadow, ...adoptedScopes]) expect(root.adoptedStyleSheets).toHaveLength(0);

    const [late] = appendReplies(thread, [{ id: '2', parent: '100' }]);
    await flush();
    organizer.setEnabled(true);
    await flush();

    expect(thread.contents.hasAttribute(THREAD_ORDERED_ATTRIBUTE)).toBe(false);
    expect(orderOf(late!.host)).toBe('');
    expect(toggleIn(thread.comment)).toBeNull();
  });
});

describe('观察者范围与自激', () => {
  it('自己的写入不自激：状态稳定后不再安排新一轮重扫', async () => {
    const thread = buildThread('100');
    appendReplies(thread, [
      { id: '1', parent: '100' },
      { id: '2', parent: '1' },
    ]);
    areaShadow.append(thread.wrapper);
    await enable();

    // 只让观察者的微任务跑完，不推进定时器：自己的控件插入与属性/变量写入都不该排新的重扫
    for (let round = 0; round < 4; round += 1) await Promise.resolve();

    expect(vi.getTimerCount()).toBe(0);
    expect(thread.contents.children).toHaveLength(2);
    expect(toggleIn(thread.comment)).not.toBeNull();
  });

  it('评论区整块替换：新 scope 采纳样式表，旧 scope 摘除', async () => {
    const thread = buildThread('100');
    appendReplies(thread, [{ id: '1', parent: '100' }]);
    areaShadow.append(thread.wrapper);
    await enable();
    const oldScopes = [thread.repliesShadow, thread.comment.actionsShadow];

    const replacement = document.createElement(COMMENT_AREA_SELECTOR);
    const replacementShadow = replacement.attachShadow({ mode: 'open' });
    const fresh = buildThread('200');
    appendReplies(fresh, [{ id: '5', parent: '200' }]);
    replacementShadow.append(fresh.wrapper);
    area.replaceWith(replacement);
    await flush();

    expect(fresh.repliesShadow.adoptedStyleSheets).toHaveLength(1);
    // 用不到的 root（评论区根、评论组件自己的 root）从不放样式表
    expect(replacementShadow.adoptedStyleSheets).toHaveLength(0);
    for (const root of oldScopes) expect(root.adoptedStyleSheets).toHaveLength(0);
  });
});

describe('样式表内容', () => {
  it('重排/缩进/折叠/孤立说明/图标朝向都挂在自有标记上，隐藏只对自有标记生效', () => {
    for (const anchor of [
      `[${THREAD_ORDERED_ATTRIBUTE}] [${THREAD_HIDDEN_ATTRIBUTE}]`,
      // 重排规则挂在自有标记上，并用 :host(...) 锁在楼中楼容器所在的那个 shadow root 里
      `:host(bili-comment-replies-renderer) [${THREAD_ORDERED_ATTRIBUTE}]`,
      // 容器里的非回复子元素（分页入口、加载占位）只在 order 上让位给回复
      `[${THREAD_ORDERED_ATTRIBUTE}] > :not(bili-comment-reply-renderer)`,
      `order: var(${THREAD_ORDER_PROPERTY}, 0)`,
      `padding-left: calc((min(var(${THREAD_DEPTH_PROPERTY}, 0), ${MAX_THREAD_DEPTH}) + 1) * var(--loupe-thread-step))`,
      `[${THREAD_ORPHAN_ATTRIBUTE}]::before`,
      `[data-loupe-thread-toggle][aria-expanded='false'] svg`,
      '@media (max-width: 700px)',
    ]) {
      expect(NATIVE_THREAD_CSS).toContain(anchor);
    }
    // 容器判定是结构探测：样式表同样不许提 `#expander-contents` 这个会随站点改版消失的 id
    expect(NATIVE_THREAD_CSS).not.toContain('#expander-contents');
    // 隐藏只出现在「容器已标记 + 条目已标记」这一条规则里；不接管指针事件、不改原生交互
    expect(NATIVE_THREAD_CSS.match(/display:\s*none/g)).toHaveLength(1);
    expect(NATIVE_THREAD_CSS).not.toContain('pointer-events');
    expect(NATIVE_THREAD_CSS).not.toContain('visibility');
  });
});
