// @vitest-environment happy-dom
/**
 * 站点用户卡片适配器（主世界）的测试。
 *
 * 这里**不给站点元素做替身以外的任何假设**：适配器只做三件事——造一个带 `data-user-profile-id`
 * 的不可见参考元素、把它摆到给定坐标、派发 mouseenter/mouseleave。测试用一个假的
 * `bili-user-profile` 元素验证这三件事，并验证站点的元素接口不在时**整体放弃**而不是半渲染。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { USER_CARD_BRIDGE_SOURCE } from '@/extension/page-comments';
import type { UserCardBridgeMessage } from '@/extension/page-comments';
import type * as UserCardModule from '@/extension/content/user-card';

/** 假站点卡片：只记录「被 setup 的参考元素」与收到的进出事件，形状对齐站点真实实现。 */
class FakeSiteCard extends HTMLElement {
  readonly setupCalls: Element[] = [];
  readonly events: string[] = [];

  setup(reference: Element): void {
    this.setupCalls.push(reference);
    reference.addEventListener('mouseenter', () => void this.events.push('enter'));
    reference.addEventListener('mouseleave', () => void this.events.push('leave'));
  }
}

const TAG = 'bili-user-profile';

/**
 * 适配器持有模块级单例（站点卡片 + 参考元素 + 当前显示的 mid），每个用例都要一份干净实例。
 * 这正是「测试刻意验证模块加载边界」的例外：动态 import 而非静态，理由与 page-reader.test.ts 相同。
 */
async function loadAdapter(): Promise<typeof UserCardModule> {
  vi.resetModules();
  return await import('@/extension/content/user-card');
}

beforeEach(() => {
  // 文档在同一个文件内是共享的：清空 body，避免上一个用例留下的卡片干扰断言
  document.body.innerHTML = '';
  if (customElements.get(TAG) === undefined) customElements.define(TAG, FakeSiteCard);
});

describe('站点用户卡片适配器', () => {
  it('第一次悬停：造参考元素 → setup → 摆到宿主坐标 → 派发 mouseenter', async () => {
    const { showUserCard } = await loadAdapter();
    showUserCard('12345', { left: 120, top: 240, width: 44, height: 44 });

    const card = document.body.querySelector(TAG) as FakeSiteCard | null;
    expect(card).not.toBeNull();
    expect(card!.setupCalls).toHaveLength(1);
    const reference = card!.setupCalls[0] as HTMLElement;
    expect(reference.getAttribute('data-user-profile-id')).toBe('12345');
    expect(reference.isConnected).toBe(true);
    // 参考元素只是锚：不可见、不吃指针事件
    expect(reference.style.opacity).toBe('0');
    expect(reference.style.pointerEvents).toBe('none');
    expect(reference.style.left).toBe('120px');
    expect(reference.style.top).toBe('240px');
    expect(card!.events).toEqual(['enter']);
  });

  it('同一个用户重复悬停不重复派发；换用户则改属性再派发', async () => {
    const { showUserCard } = await loadAdapter();
    showUserCard('12345', { left: 10, top: 20, width: 44, height: 44 });
    showUserCard('12345', { left: 12, top: 22, width: 44, height: 44 });

    const card = document.body.querySelector(TAG) as FakeSiteCard;
    const reference = card.setupCalls[0] as HTMLElement;
    expect(card.events).toEqual(['enter']);
    expect(reference.style.left).toBe('12px');

    showUserCard('67890', { left: 30, top: 40, width: 30, height: 30 });
    expect(reference.getAttribute('data-user-profile-id')).toBe('67890');
    expect(card.events).toEqual(['enter', 'enter']);
  });

  it('收起走站点元素自己的 mouseleave 路径', async () => {
    const { showUserCard, hideUserCard } = await loadAdapter();
    showUserCard('12345', { left: 1, top: 2, width: 3, height: 4 });
    hideUserCard();
    const card = document.body.querySelector(TAG) as FakeSiteCard;
    expect(card.events).toEqual(['enter', 'leave']);
  });

  it('带 mid 的迟到收起不关掉已经换到别人身上的卡片', async () => {
    const { showUserCard, hideUserCard } = await loadAdapter();
    showUserCard('12345', { left: 1, top: 2, width: 3, height: 4 });
    showUserCard('67890', { left: 5, top: 6, width: 3, height: 4 });
    hideUserCard('12345'); // 迟到的「离开 12345」
    const card = document.body.querySelector(TAG) as FakeSiteCard;
    expect(card.events).toEqual(['enter', 'enter']);

    hideUserCard('67890');
    expect(card.events).toEqual(['enter', 'enter', 'leave']);

    // 不带 mid = 无条件收起（槽位被拆 / 宿主滚动 / 指针离开阅读器）
    showUserCard('12345', { left: 1, top: 2, width: 3, height: 4 });
    hideUserCard();
    expect(card.events).toEqual(['enter', 'enter', 'leave', 'enter', 'leave']);
  });

  it('参考元素被站点摘掉后，下一次悬停会重新造一份', async () => {
    const { showUserCard } = await loadAdapter();
    showUserCard('12345', { left: 1, top: 2, width: 3, height: 4 });
    const first = document.body.querySelector(TAG) as FakeSiteCard;
    first.remove();
    (first.setupCalls[0] as HTMLElement).remove();

    showUserCard('12345', { left: 1, top: 2, width: 3, height: 4 });
    const cards = document.body.querySelectorAll(TAG);
    expect(cards).toHaveLength(1);
    expect(cards[0]).not.toBe(first);
  });

  it('消息路由：show / hide 都认，非法消息一律忽略', async () => {
    const { handleUserCardMessage } = await loadAdapter();
    const show: UserCardBridgeMessage = { source: USER_CARD_BRIDGE_SOURCE, type: 'show', mid: '12345', rect: { left: 0, top: 0, width: 10, height: 10 } };
    expect(handleUserCardMessage(show)).toBe(true);
    expect(handleUserCardMessage({ source: USER_CARD_BRIDGE_SOURCE, type: 'hide' })).toBe(true);
    expect(handleUserCardMessage({ source: USER_CARD_BRIDGE_SOURCE, type: 'hide', mid: '12345' })).toBe(true);
    expect(handleUserCardMessage({ source: USER_CARD_BRIDGE_SOURCE, type: 'hide', mid: 'abc' })).toBe(false);

    expect(handleUserCardMessage(null)).toBe(false);
    expect(handleUserCardMessage({ source: 'loupe-something-else', type: 'show', mid: '12345' })).toBe(false);
    expect(handleUserCardMessage({ source: USER_CARD_BRIDGE_SOURCE, type: 'show', mid: 'abc' })).toBe(false);
    expect(handleUserCardMessage({ source: USER_CARD_BRIDGE_SOURCE, type: 'show', mid: '12345' })).toBe(false);
    expect(handleUserCardMessage({ source: USER_CARD_BRIDGE_SOURCE, type: 'show', mid: '12345', rect: { left: 0, top: 0, width: Number.NaN, height: 10 } })).toBe(false);
  });
});
