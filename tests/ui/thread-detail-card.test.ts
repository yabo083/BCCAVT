// @vitest-environment happy-dom
/**
 * 详情卡上的「在评论区定位」入口：只有外层说「可定位」（当前结果是 B 站视频、且不是图谱窗口）时才出现，
 * 点击只把评论 id 报出去——规范地址与那条请求由 App.vue / store 负责，卡片不认识 store 与承载面。
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import type { DOMWrapper, VueWrapper } from '@vue/test-utils';
import ThreadDetailCard from '@/ui/components/ThreadDetailCard.vue';
import type { Comment } from '@/core/model';
import type { CommentNode } from '@/core/report';

const comment: Comment = {
  id: '316401376609',
  rootId: null,
  parentId: null,
  author: { id: 'u-1', name: 'user1' },
  text: '正文',
  createdAt: 1_700_000_000_000,
  likes: 0,
  replyCount: 0,
};

const node: CommentNode = { comment, children: [], parent: null, depth: 0, size: 1 };

function locateButton(wrapper: VueWrapper): DOMWrapper<HTMLButtonElement> | undefined {
  return wrapper.findAll('button').find((button) => button.text().includes('在评论区定位'));
}

describe('详情卡的「在评论区定位」', () => {
  it('外层说可定位时才出现，且 title 与 aria-label 齐备', () => {
    expect(locateButton(mount(ThreadDetailCard, { props: { node } }))).toBeUndefined();

    const button = locateButton(mount(ThreadDetailCard, { props: { node, locatable: true } }));
    expect(button).toBeDefined();
    expect(button?.attributes('title')).toBe('在 B 站视频页的评论区定位这条评论');
    expect(button?.attributes('aria-label')).toBe('在评论区定位这条评论');
  });

  it('点击只把这条评论的 id 报出去', async () => {
    const wrapper = mount(ThreadDetailCard, { props: { node, locatable: true } });

    await locateButton(wrapper)!.trigger('click');

    expect(wrapper.emitted('locate')).toEqual([[comment.id]]);
  });

  it('没有选中评论时整个卡片是空态，不渲染任何按钮', () => {
    const wrapper = mount(ThreadDetailCard, { props: { node: null, locatable: true } });

    expect(wrapper.text()).toContain('在评论树里点一个节点');
    expect(locateButton(wrapper)).toBeUndefined();
  });
});
