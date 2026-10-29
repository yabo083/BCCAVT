// @vitest-environment happy-dom
/**
 * 站点改版（页面上没有 `bili-user-profile` 的定义）时，适配器必须**整体放弃**这次交互：
 * 既不能抛错，也不能往页面里插入半个自制卡片——宁可没有悬停卡片，也不给用户一份会过期的仿制品。
 */
import { describe, expect, it } from 'vitest';
import { handleUserCardMessage, hideUserCard, showUserCard } from '@/extension/content/user-card';
import { USER_CARD_BRIDGE_SOURCE } from '@/extension/page-comments';

describe('站点用户卡片适配器（站点元素未注册）', () => {
  it('元素不存在时安静地什么都不做', () => {
    expect(customElements.get('bili-user-profile')).toBeUndefined();

    expect(() => showUserCard('12345', { left: 0, top: 0, width: 10, height: 10 })).not.toThrow();
    expect(() => hideUserCard()).not.toThrow();
    expect(
      handleUserCardMessage({
        source: USER_CARD_BRIDGE_SOURCE,
        type: 'show',
        mid: '12345',
        rect: { left: 0, top: 0, width: 1, height: 1 },
      }),
    ).toBe(true);

    expect(document.body.innerHTML).toBe('');
  });
});
