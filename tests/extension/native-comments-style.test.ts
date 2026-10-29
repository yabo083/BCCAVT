// @vitest-environment happy-dom
/**
 * 原生评论 Reddit 风格增强的 DOM 行为测试。结构按实机 + 上游 Bilibili-Evolved 的 v3 组件链复刻
 * （与 injector.test.ts 同一份形状）：
 *   bili-comments（open shadow root）→ bili-comment-thread-renderer → shadow 里是 bili-comment-renderer
 *   （shadow #main>#header/#content/#footer>bili-comment-action-buttons-renderer）与楼中楼
 *   bili-comment-replies-renderer → bili-comment-reply-renderer。
 *
 * 断言只针对「同一张样式表被采纳 / 被摘除」这一可观察契约：happy-dom 不做样式匹配，也不解析
 * 声明的计算值，因此这里验证的是注入位置、幂等、清理与开关桥，视觉结果需在真实页面复核。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NATIVE_COMMENT_STYLE_CSS,
  createNativeCommentStyler,
  startNativeCommentStyler,
  type NativeCommentStyler,
} from '@/extension/content/native-comments-style';
import {
  NATIVE_STYLE_BRIDGE_SOURCE,
  isNativeStyleRequestMessage,
  isNativeStyleToggleMessage,
} from '@/extension/page-comments';
import { COMMENT_AREA_SELECTOR, collectShadowRoots } from '@/extension/content/targets';
import {
  THREAD_DEPTH_PROPERTY,
  THREAD_ORDER_PROPERTY,
  THREAD_ORDERED_ATTRIBUTE,
  THREAD_TOGGLE_CLASS,
} from '@/extension/content/native-thread';

/** 一条评论的组件链（与实机同形）；scopes 是它带出的全部 open shadow root。 */
interface CommentFixture {
  host: HTMLElement;
  scopes: ShadowRoot[];
}

function buildComment(tag: string): CommentFixture {
  const host = document.createElement(tag);
  const hostShadow = host.attachShadow({ mode: 'open' });
  const renderer = document.createElement('bili-comment-renderer');
  const rendererShadow = renderer.attachShadow({ mode: 'open' });
  const main = document.createElement('div');
  main.id = 'main';
  const header = document.createElement('div');
  header.id = 'header';
  const content = document.createElement('div');
  content.id = 'content';
  const footer = document.createElement('div');
  footer.id = 'footer';
  const actions = document.createElement('bili-comment-action-buttons-renderer');
  const actionsShadow = actions.attachShadow({ mode: 'open' });
  for (const id of ['pubdate', 'like', 'dislike', 'reply', 'more']) {
    const child = document.createElement('span');
    child.id = id;
    actionsShadow.append(child);
  }
  footer.append(actions);
  main.append(header, content, footer);
  rendererShadow.append(main);
  hostShadow.append(renderer);
  return { host, scopes: [hostShadow, rendererShadow, actionsShadow] };
}

let area: HTMLElement;
let areaShadow: ShadowRoot;
let replyList: HTMLElement;
let replyListShadow: ShadowRoot;
let styler: NativeCommentStyler;

function buildPage(): void {
  area = document.createElement(COMMENT_AREA_SELECTOR);
  areaShadow = area.attachShadow({ mode: 'open' });
  const root = buildComment('bili-comment-thread-renderer');
  const sub = buildComment('bili-comment-reply-renderer');
  replyList = document.createElement('bili-comment-replies-renderer');
  replyListShadow = replyList.attachShadow({ mode: 'open' });
  replyListShadow.append(sub.host);
  areaShadow.append(root.host, replyList);
  document.body.append(area);
}

/** 文档里当前评论区的全部 open shadow root（评论区根 + 子树里的嵌套 root）。 */
function currentScopes(): ShadowRoot[] {
  const element = document.querySelector(COMMENT_AREA_SELECTOR);
  const root = element?.shadowRoot ?? null;
  if (root === null) return [];
  return [root, ...collectShadowRoots(root)];
}

/** 是否每个 scope 都恰好采纳了 count 张样式表：默认 0，开启后 1。 */
function allScopesHave(count: number): boolean {
  return currentScopes().every((root) => root.adoptedStyleSheets.length === count);
}

function makeSheet(): CSSStyleSheet {
  const sheet = new (document.defaultView?.CSSStyleSheet ?? CSSStyleSheet)();
  sheet.replaceSync(':host { outline: 0; }');
  return sheet;
}

const originalPostMessage = Object.getOwnPropertyDescriptor(window, 'postMessage');

/**
 * 记录 window.postMessage 的调用而不真正投递：happy-dom 的 postMessage 走它自己的定时器派发，
 * 依赖它会引入不必要的时序假设；桥的方向性用「谁发了什么」即可验证。
 */
function recordPostMessage(): unknown[] {
  const posted: unknown[] = [];
  Object.defineProperty(window, 'postMessage', {
    configurable: true,
    writable: true,
    value: (message: unknown) => {
      posted.push(message);
    },
  });
  return posted;
}

/** 推进合并重扫（styler 用 setTimeout 合并变更）与 whenDefined 的微任务。 */
async function flush(): Promise<void> {
  for (let round = 0; round < 4; round += 1) {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
  }
}

beforeEach(() => {
  // 只接管 styler 用的 setTimeout；happy-dom 的 MutationObserver 走 queueMicrotask，保持真实
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  if (customElements.get(COMMENT_AREA_SELECTOR) === undefined) {
    customElements.define(COMMENT_AREA_SELECTOR, class extends HTMLElement {});
  }
  document.body.innerHTML = '';
  buildPage();
  styler = createNativeCommentStyler(document);
});

afterEach(() => {
  styler.dispose();
  document.body.innerHTML = '';
  if (originalPostMessage === undefined) Reflect.deleteProperty(window, 'postMessage');
  else Object.defineProperty(window, 'postMessage', originalPostMessage);
  vi.useRealTimers();
});

describe('样式注入', () => {
  it('默认关闭：不采纳任何样式，也不动原生评论根', async () => {
    styler.start();
    await flush();

    expect(currentScopes().length).toBeGreaterThanOrEqual(8);
    expect(allScopesHave(0)).toBe(true);
    expect(area.isConnected).toBe(true);
    expect(area.style.display).toBe('');
  });

  it('开启后每个 open shadow root 采纳同一张样式表，且不改 DOM、不插 <style>', async () => {
    styler.start();
    styler.setEnabled(true);
    await flush();

    const scopes = currentScopes();
    expect(scopes.length).toBeGreaterThanOrEqual(8);
    for (const root of scopes) expect(root.adoptedStyleSheets).toHaveLength(1);
    // 全站共用同一张样式表实例：不会每个 root 各建一份、规则也不累积
    const [first] = scopes;
    for (const root of scopes) expect(root.adoptedStyleSheets[0]).toBe(first?.adoptedStyleSheets[0]);
    // 不注入节点：light DOM 与各 shadow root 里都没有 <style>
    expect(area.children).toHaveLength(0);
    for (const root of scopes) expect(root.querySelector('style')).toBeNull();
    // 原生根仍在且未被隐藏
    expect(area.isConnected).toBe(true);
    expect(area.style.display).toBe('');
  });

  it('重复开启与重复重扫不重复注入', async () => {
    styler.start();
    styler.setEnabled(true);
    styler.setEnabled(true);
    styler.reconcile();
    styler.reconcile();
    await flush();

    expect(allScopesHave(1)).toBe(true);
  });

  it('后加入的嵌套 shadow root（楼中楼）会被发现并注入', async () => {
    styler.start();
    styler.setEnabled(true);
    await flush();

    const late = buildComment('bili-comment-reply-renderer');
    replyListShadow.append(late.host);
    await flush();

    for (const root of late.scopes) expect(root.adoptedStyleSheets).toHaveLength(1);
    expect(allScopesHave(1)).toBe(true);
  });

  it('只处理评论区下的 open shadow root：closed root 与评论区外的 root 都不碰', async () => {
    const closedHost = document.createElement('bili-comment-thread-renderer');
    const closed = closedHost.attachShadow({ mode: 'closed' });
    areaShadow.append(closedHost);
    const outsiderHost = document.createElement('div');
    const outsider = outsiderHost.attachShadow({ mode: 'open' });
    document.body.append(outsiderHost);

    styler.start();
    styler.setEnabled(true);
    await flush();

    expect(closed.adoptedStyleSheets).toHaveLength(0);
    expect(outsider.adoptedStyleSheets).toHaveLength(0);
    expect(allScopesHave(1)).toBe(true);
  });
});

describe('关闭与清理', () => {
  it('关闭后摘掉全部自有样式，且不再观察新出现的 root', async () => {
    styler.start();
    styler.setEnabled(true);
    await flush();
    expect(allScopesHave(1)).toBe(true);

    styler.setEnabled(false);
    await flush();
    expect(allScopesHave(0)).toBe(true);

    const late = buildComment('bili-comment-reply-renderer');
    replyListShadow.append(late.host);
    await flush();
    for (const root of late.scopes) expect(root.adoptedStyleSheets).toHaveLength(0);
  });

  it('不覆盖站点/其它扩展已有的样式表，关闭后只剩它们', async () => {
    const preexisting = makeSheet();
    areaShadow.adoptedStyleSheets = [preexisting];

    styler.start();
    styler.setEnabled(true);
    await flush();
    expect(areaShadow.adoptedStyleSheets).toHaveLength(2);
    expect(areaShadow.adoptedStyleSheets[0]).toBe(preexisting);

    styler.setEnabled(false);
    await flush();
    expect(areaShadow.adoptedStyleSheets).toHaveLength(1);
    expect(areaShadow.adoptedStyleSheets[0]).toBe(preexisting);
  });

  it('关闭后可以再次开启（往返幂等）', async () => {
    styler.start();
    styler.setEnabled(true);
    await flush();
    styler.setEnabled(false);
    await flush();
    expect(allScopesHave(0)).toBe(true);

    styler.setEnabled(true);
    await flush();
    expect(allScopesHave(1)).toBe(true);
  });

  it('dispose 摘掉全部样式、停止观察，此后的开关消息是空操作', async () => {
    styler.start();
    styler.setEnabled(true);
    await flush();
    const scopes = currentScopes();
    expect(scopes.length).toBeGreaterThanOrEqual(8);

    styler.dispose();
    for (const root of scopes) expect(root.adoptedStyleSheets).toHaveLength(0);

    const late = buildComment('bili-comment-reply-renderer');
    replyListShadow.append(late.host);
    await flush();
    for (const root of late.scopes) expect(root.adoptedStyleSheets).toHaveLength(0);

    styler.setEnabled(true);
    await flush();
    for (const root of scopes) expect(root.adoptedStyleSheets).toHaveLength(0);
  });
});

describe('评论区根被整块替换', () => {
  it('新评论区的 root 被注入，旧 root 恢复默认', async () => {
    styler.start();
    styler.setEnabled(true);
    await flush();
    const oldScopes = currentScopes();

    const replacement = document.createElement(COMMENT_AREA_SELECTOR);
    const replacementShadow = replacement.attachShadow({ mode: 'open' });
    const fresh = buildComment('bili-comment-thread-renderer');
    replacementShadow.append(fresh.host);
    area.replaceWith(replacement);
    await flush();

    expect(replacementShadow.adoptedStyleSheets).toHaveLength(1);
    for (const root of fresh.scopes) expect(root.adoptedStyleSheets).toHaveLength(1);
    // 旧 root 不留我们的样式表：即使仍被外部引用也回到站点默认
    for (const root of oldScopes) expect(root.adoptedStyleSheets).toHaveLength(0);
  });
});

describe('开关桥', () => {
  it('启动时 request 一次当前状态，并只认本窗口的 toggle 消息', async () => {
    const posted = recordPostMessage();
    const bridged = startNativeCommentStyler(document, window);
    expect(posted.filter(isNativeStyleRequestMessage)).toHaveLength(1);

    // 来源不是本窗口：忽略
    window.dispatchEvent(
      new MessageEvent('message', { data: { source: NATIVE_STYLE_BRIDGE_SOURCE, type: 'toggle', enabled: true }, source: null }),
    );
    await flush();
    expect(allScopesHave(0)).toBe(true);

    // 标记不对：忽略
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'toggle', enabled: true }, source: window }));
    await flush();
    expect(allScopesHave(0)).toBe(true);

    // 正确的开关消息：开启 → 注入，关闭 → 摘除
    window.dispatchEvent(
      new MessageEvent('message', { data: { source: NATIVE_STYLE_BRIDGE_SOURCE, type: 'toggle', enabled: true }, source: window }),
    );
    await flush();
    expect(allScopesHave(1)).toBe(true);

    window.dispatchEvent(
      new MessageEvent('message', { data: { source: NATIVE_STYLE_BRIDGE_SOURCE, type: 'toggle', enabled: false }, source: window }),
    );
    await flush();
    expect(allScopesHave(0)).toBe(true);

    bridged.dispose();
  });

  it('桥消息守卫拒绝非法载荷', () => {
    expect(isNativeStyleToggleMessage({ source: NATIVE_STYLE_BRIDGE_SOURCE, type: 'toggle', enabled: true })).toBe(true);
    expect(isNativeStyleToggleMessage({ source: NATIVE_STYLE_BRIDGE_SOURCE, type: 'toggle', enabled: 'yes' })).toBe(false);
    expect(isNativeStyleToggleMessage({ source: 'other', type: 'toggle', enabled: true })).toBe(false);
    expect(isNativeStyleToggleMessage(null)).toBe(false);
    expect(isNativeStyleRequestMessage({ source: NATIVE_STYLE_BRIDGE_SOURCE, type: 'request' })).toBe(true);
    expect(isNativeStyleRequestMessage({ source: NATIVE_STYLE_BRIDGE_SOURCE, type: 'toggle', enabled: true })).toBe(false);
  });
});

describe('样式表内容', () => {
  it('覆盖正文/作者行/操作区/回复层级/分支边界，并只取站点变量兜底', () => {
    for (const anchor of [
      ':host(bili-comment-thread-renderer) #div',
      ':host(bili-comment-renderer) #content',
      ':host(bili-comment-user-info) #user-name',
      ':host(bili-rich-text) #contents',
      ':host(bili-comment-action-buttons-renderer) #pubdate::after',
      ':host(bili-comment-replies-renderer) #expander-contents',
      // 楼中楼之间不再有相邻兄弟选择器：容器改成视觉 flex 列后，DOM 相邻 ≠ 视觉相邻，
      // 间距改由每条回复自己的 padding 给（见 native-thread.ts 重排）；这里改钉回复自己的列
      ':host(bili-comment-reply-renderer) #body',
    ]) {
      expect(NATIVE_COMMENT_STYLE_CSS).toContain(anchor);
    }
    // 只改视觉，不隐藏原生节点、不接管点击
    expect(NATIVE_COMMENT_STYLE_CSS).not.toContain('display: none');
    expect(NATIVE_COMMENT_STYLE_CSS).not.toContain('pointer-events');
    expect(NATIVE_COMMENT_STYLE_CSS).not.toContain('visibility: hidden');
  });
});

/**
 * 实机 DOM dump 复刻（2026-10，BV1bT411w78C；上游 Bilibili-Evolved discussion #4804 里那张
 * bili-comment-thread-renderer 的结构截图）：把样式表依赖的每一个 id/标签都搭出来，
 * 用来证明「选择器不是猜的」。层级与 native-comments-style.ts 文件头注释一致。
 * 头像按实机的两种形态分别搭：根评论是 bili-avatar 组件（它自带 shadow，外侧只看到宿主），
 * 楼中楼是 #user-avatar 里的普通 img。
 */
function buildRealComment(tag: string): HTMLElement {
  const host = document.createElement(tag);
  const shadow = host.attachShadow({ mode: 'open' });
  const body = document.createElement('div');
  body.id = 'body';
  const avatar = document.createElement('a');
  avatar.id = 'user-avatar';
  if (tag === 'bili-comment-reply-renderer') {
    avatar.append(document.createElement('img'));
  } else {
    avatar.append(document.createElement('bili-avatar'));
  }
  const main = document.createElement('div');
  main.id = 'main';
  const wrap = (id: string, child: Element): HTMLElement => {
    const box = document.createElement('div');
    box.id = id;
    box.append(child);
    return box;
  };
  const userInfo = document.createElement('bili-comment-user-info');
  const userInfoShadow = userInfo.attachShadow({ mode: 'open' });
  const info = document.createElement('div');
  info.id = 'info';
  const userName = document.createElement('div');
  userName.id = 'user-name';
  const level = document.createElement('div');
  level.id = 'user-level';
  // 实机把等级徽章画成 #user-level 里的普通 <img>（站点自己的 shadow 里就写着
  // `#user-level img { width: 30px; height: 30px }`，见 tmp/preview-site.ts）——夹具照搭
  level.append(document.createElement('img'));
  info.append(userName, level);
  userInfoShadow.append(info);
  const richText = document.createElement('bili-rich-text');
  const richTextShadow = richText.attachShadow({ mode: 'open' });
  const contents = document.createElement('p');
  contents.id = 'contents';
  contents.append(document.createElement('img'));
  richTextShadow.append(contents);
  const footer = document.createElement('div');
  footer.id = 'footer';
  const actions = document.createElement('bili-comment-action-buttons-renderer');
  const actionsShadow = actions.attachShadow({ mode: 'open' });
  const pubdate = document.createElement('div');
  pubdate.id = 'pubdate';
  for (const id of ['like', 'dislike', 'reply', 'more']) {
    const item = document.createElement('div');
    item.id = id;
    item.append(document.createElement('button'));
    actionsShadow.append(item);
  }
  actionsShadow.prepend(pubdate);
  const count = document.createElement('span');
  count.id = 'count';
  actionsShadow.querySelector('#like button')?.append(count);
  footer.append(actions);
  if (tag === 'bili-comment-reply-renderer') {
    // 楼中楼没有 #header/#content：作者行、头像、正文都是 #main 的直接子节点，#footer 与 #main 平级
    main.append(userInfo, avatar, richText);
    body.append(main, footer);
  } else {
    main.append(wrap('header', userInfo), wrap('content', richText), footer);
    body.append(avatar, main);
  }
  shadow.append(body);
  return host;
}

/**
 * 一条根评论 = 一个讨论块：正文 + 楼中楼 + 原生分隔线。
 * 实机里 thread-renderer 外面还套一层无属性的 <div>（Lit 片段，见 tmp/slice00.png）——讨论块之间
 * 因此永远不是兄弟节点，样式表里也不能有 thread 之间的相邻兄弟规则（写了不生效，已删）。
 */
function buildRealThread(): HTMLElement {
  const thread = document.createElement('bili-comment-thread-renderer');
  const shadow = thread.attachShadow({ mode: 'open' });
  const replies = document.createElement('div');
  replies.id = 'replies';
  const repliesRenderer = document.createElement('bili-comment-replies-renderer');
  const repliesShadow = repliesRenderer.attachShadow({ mode: 'open' });
  const expander = document.createElement('div');
  expander.id = 'expander';
  const expanderContents = document.createElement('div');
  expanderContents.id = 'expander-contents';
  expanderContents.append(buildRealComment('bili-comment-reply-renderer'), buildRealComment('bili-comment-reply-renderer'));
  const viewMore = document.createElement('div');
  viewMore.id = 'view-more';
  expander.append(expanderContents, viewMore);
  repliesShadow.append(expander);
  replies.append(repliesRenderer);
  const replyContainer = document.createElement('div');
  replyContainer.id = 'reply-container';
  const divider = document.createElement('div');
  divider.id = 'div';
  shadow.append(buildRealComment('bili-comment-renderer'), replies, replyContainer, divider);
  // 与实机一致：讨论块 = <div> 包着 thread-renderer，所以两个讨论块之间不存在相邻兄弟关系
  const wrapper = document.createElement('div');
  wrapper.append(thread);
  return wrapper;
}

/**
 * 从样式表里取出每条规则的选择器（我们的 CSS 没有嵌套规则，去掉注释后按 `}` 切块即可）。
 * `@media` 这类 at-rule 只剥掉前置声明（我们只用它包普通规则，里面不嵌套别的 at-rule），
 * 里面的选择器照常参与「选择器是否命中」的检查——否则窄屏那批规则会脱离监控。
 */
function ruleSelectors(css: string): string[] {
  const selectors: string[] = [];
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@[a-z-]+[^{]*\{/gi, '');
  for (const block of withoutComments.split('}')) {
    const brace = block.indexOf('{');
    if (brace === -1) continue;
    for (const selector of block.slice(0, brace).split(',')) {
      const trimmed = selector.trim();
      if (trimmed !== '') selectors.push(trimmed);
    }
  }
  return selectors;
}

/**
 * 一个选择器在实机结构里是否真能命中：`:host(tag)` 只在 host 为 tag 的 shadow root 内生效，
 * 所以先按 host 过滤候选 scope 再去掉前缀；`:hover` / `::after` 这类状态与伪元素在
 * querySelector 里匹配不到，比较前去掉。
 */
function selectorHits(selector: string, scopes: ShadowRoot[]): boolean {
  const hostMatch = /^:host\(([^)]+)\)\s*([\s\S]*)$/.exec(selector);
  const rest = (hostMatch?.[2] ?? selector).replace(/::?[a-z-]+/g, '').trim();
  const candidates = hostMatch === null ? scopes : scopes.filter((scope) => scope.host.tagName.toLowerCase() === hostMatch[1]);
  // 只有 `:host(tag)` 的规则（例如给 host 传 CSS 变量）：host 存在即有效
  if (rest === '') return candidates.length > 0;
  return candidates.some((scope) => scope.querySelector(rest) !== null);
}

describe('选择器与实机结构对齐', () => {
  it('样式表里的每个选择器都能命中实机结构的某个节点（不猜无效选择器）', () => {
    const area = document.createElement(COMMENT_AREA_SELECTOR);
    const areaShadow = area.attachShadow({ mode: 'open' });
    areaShadow.append(buildRealThread(), buildRealThread());
    document.body.append(area);
    const scopes = [areaShadow, ...collectShadowRoots(areaShadow)];

    const selectors = ruleSelectors(NATIVE_COMMENT_STYLE_CSS);
    expect(selectors.length).toBeGreaterThan(20);
    for (const selector of selectors) {
      expect(selectorHits(selector, scopes), `无效选择器：${selector}`).toBe(true);
    }
  });

  it('所有 id 规则都用 :host(...) 锁在持有它的 shadow root 里（不误伤同名 id）', () => {
    for (const selector of ruleSelectors(NATIVE_COMMENT_STYLE_CSS)) {
      if (!selector.includes('#')) continue;
      expect(selector.startsWith(':host('), `未加 :host 前缀的 id 规则：${selector}`).toBe(true);
    }
  });
});

/** 组件数据（实机形状）：主世界从 `__data` / `.data` 读 rpid、parent 与回复总数。 */
function withComponentData(element: Element, data: Record<string, string | number>): void {
  (element as Element & { __data?: unknown }).__data = data;
}

/**
 * 给实机结构的一条线程挂上组件数据（根评论 + 两条楼中楼，第二条挂在第一条下面），
 * 返回断言要用的原生节点。
 */
function attachRealThreadData(
  wrapper: HTMLElement,
  rootId: string,
): { contents: HTMLElement; repliesRoot: ShadowRoot; replies: HTMLElement[]; rootActions: HTMLElement } {
  const thread = wrapper.querySelector('bili-comment-thread-renderer');
  const threadShadow = thread?.shadowRoot ?? null;
  const rootComment = threadShadow?.querySelector('bili-comment-renderer') ?? null;
  const repliesRoot = threadShadow?.querySelector('bili-comment-replies-renderer')?.shadowRoot ?? null;
  const contents = repliesRoot?.querySelector('#expander-contents') ?? null;
  const rootActions = rootComment?.shadowRoot?.querySelector('bili-comment-action-buttons-renderer') ?? null;
  if (
    !(rootComment instanceof HTMLElement) ||
    !(rootActions instanceof HTMLElement) ||
    !(contents instanceof HTMLElement) ||
    repliesRoot === null
  ) {
    throw new Error('实机结构夹具不完整：线程里找不到根评论、操作行或楼中楼容器');
  }
  const rootData = { rpid_str: rootId, root_str: '0', parent_str: '0', rcount: 9 };
  withComponentData(rootComment, rootData);
  withComponentData(rootActions, rootData);
  const replies = [...contents.querySelectorAll('bili-comment-reply-renderer')].filter(
    (element): element is HTMLElement => element instanceof HTMLElement,
  );
  const ids = ['9001', '9002'];
  for (const [index, reply] of replies.entries()) {
    withComponentData(reply, {
      rpid_str: ids[index] ?? `90${index}`,
      root_str: rootId,
      parent_str: index === 0 ? rootId : (ids[index - 1] ?? rootId),
      rcount: 0,
    });
  }
  return { contents, repliesRoot, replies, rootActions };
}

/**
 * 多级回复重排与折叠跟同一枚开关的生老病死：`startNativeCommentStyler` 同时驱动样式增强器与重排器，
 * 两者各自维护自己的样式表与还原记录；这里验「打开一起生效、关闭各自全部还原」。
 */
describe('多级回复重排随同一枚开关（生命周期集成）', () => {
  it('打开：前序/层级变量与折叠控件随样式一起生效；关闭：两边各自全部还原', async () => {
    const wrapper = buildRealThread();
    const { contents, repliesRoot, replies, rootActions } = attachRealThreadData(wrapper, '9000');
    areaShadow.append(wrapper);

    recordPostMessage();
    const bridged = startNativeCommentStyler(document, window);

    window.dispatchEvent(
      new MessageEvent('message', { data: { source: NATIVE_STYLE_BRIDGE_SOURCE, type: 'toggle', enabled: true }, source: window }),
    );
    await flush();

    // 样式增强照旧注入每个 scope；重排器只把它那张样式表放进真正用到的 root（这里是容器所在 root）
    expect(areaShadow.adoptedStyleSheets).toHaveLength(1);
    expect(repliesRoot.adoptedStyleSheets).toHaveLength(2);
    expect(contents.hasAttribute(THREAD_ORDERED_ATTRIBUTE)).toBe(true);
    expect(replies.map((reply) => reply.style.getPropertyValue(THREAD_ORDER_PROPERTY))).toEqual(['0', '1']);
    expect(replies.map((reply) => reply.style.getPropertyValue(THREAD_DEPTH_PROPERTY))).toEqual(['0', '1']);

    const toggle = rootActions.shadowRoot?.querySelector(`.${THREAD_TOGGLE_CLASS}`) ?? null;
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(toggle?.getAttribute('title')).toBe('折叠 2 条已加载回复（平台声明 9 条）');

    window.dispatchEvent(
      new MessageEvent('message', { data: { source: NATIVE_STYLE_BRIDGE_SOURCE, type: 'toggle', enabled: false }, source: window }),
    );
    await flush();

    expect(allScopesHave(0)).toBe(true);
    expect(contents.hasAttribute(THREAD_ORDERED_ATTRIBUTE)).toBe(false);
    expect(replies.map((reply) => reply.style.getPropertyValue(THREAD_ORDER_PROPERTY))).toEqual(['', '']);
    expect(rootActions.shadowRoot?.querySelector(`.${THREAD_TOGGLE_CLASS}`) ?? null).toBeNull();

    bridged.dispose();
  });
});
