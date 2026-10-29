// @vitest-environment happy-dom
/**
 * 评论输入框的渲染与交互测试：受控正文、提交可用性、Ctrl + Enter、发送态与失败提示。
 * 正文与发送态都归父级持有，所以父级没回填正文时按钮就不该可用——这一条正是「失败后草稿还在」的前提。
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import CommentComposer from '@/ui/components/CommentComposer.vue';
import { READER_COMMENT_MAX_LENGTH } from '@/extension/page-comments';

interface ComposerOptions {
  text?: string;
  sending?: boolean;
  error?: string | null;
  cancellable?: boolean;
}

function mountComposer(options: ComposerOptions = {}) {
  return mount(CommentComposer, {
    props: { text: '', placeholder: '发一条评论…', submitLabel: '发表评论', ...options },
  });
}

describe('CommentComposer', () => {
  it('正文为空时不能提交；输入上报父级，回填后才可提交', async () => {
    const wrapper = mountComposer();
    expect(wrapper.get('.send').attributes('disabled')).toBeDefined();

    await wrapper.get('textarea').setValue('第一条评论');
    expect(wrapper.emitted('input')?.[0]).toEqual(['第一条评论']);
    // 受控组件：父级还没回填，按钮仍然不可用
    expect(wrapper.get('.send').attributes('disabled')).toBeDefined();

    await wrapper.setProps({ text: '第一条评论' });
    expect(wrapper.get('.send').attributes('disabled')).toBeUndefined();
    await wrapper.get('.send').trigger('click');
    expect(wrapper.emitted('submit')?.[0]).toEqual(['第一条评论']);
  });

  it('Ctrl + Enter 提交；正文为空 / 发送中都不提交', async () => {
    const wrapper = mountComposer({ text: '键盘提交' });
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter', ctrlKey: true });
    expect(wrapper.emitted('submit')?.[0]).toEqual(['键盘提交']);

    const empty = mountComposer();
    await empty.get('textarea').trigger('keydown', { key: 'Enter', ctrlKey: true });
    expect(empty.emitted('submit')).toBeUndefined();

    const sending = mountComposer({ text: '发送中', sending: true });
    await sending.get('textarea').trigger('keydown', { key: 'Enter', ctrlKey: true });
    expect(sending.emitted('submit')).toBeUndefined();
  });

  it('发送中：按钮改文案并禁用，正文框也不可编辑', () => {
    const wrapper = mountComposer({ text: '内容', sending: true });
    expect(wrapper.get('.send').text()).toContain('发送中');
    expect(wrapper.get('.send').attributes('disabled')).toBeDefined();
    expect(wrapper.get('textarea').attributes('disabled')).toBeDefined();
  });

  it('失败原因就地展示（草稿不动）', () => {
    const wrapper = mountComposer({ text: '内容', error: '平台拒绝：评论已被关闭' });
    const fail = wrapper.get('.fail');
    expect(fail.text()).toContain('平台拒绝：评论已被关闭');
    expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toBe('内容');
  });

  it('只有可取消时才给取消键，点击上报 cancel', async () => {
    expect(mountComposer({ text: 'x' }).find('.ghost').exists()).toBe(false);

    const wrapper = mountComposer({ text: 'x', cancellable: true });
    await wrapper.get('.ghost').trigger('click');
    expect(wrapper.emitted('cancel')).toHaveLength(1);
  });

  it('输入框限长与守卫同一个常量，字数跟着正文走', async () => {
    const wrapper = mountComposer({ text: '你好' });
    expect(wrapper.get('textarea').attributes('maxlength')).toBe(String(READER_COMMENT_MAX_LENGTH));
    expect(wrapper.get('.hint').text()).toContain(`2 / ${READER_COMMENT_MAX_LENGTH}`);
  });
});
