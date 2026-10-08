import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@/ui/markdown';

describe('parseMarkdown 块级', () => {
  it('空输入产出空块列表', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('\n\n  \n')).toEqual([]);
  });

  it('标题层级被钳制在 1..3', () => {
    const blocks = parseMarkdown('# 一\n#### 深');
    expect(blocks).toEqual([
      { kind: 'heading', level: 1, inline: [{ kind: 'text', text: '一' }] },
      { kind: 'heading', level: 3, inline: [{ kind: 'text', text: '深' }] },
    ]);
  });

  it('连续文本行合成一个段落', () => {
    expect(parseMarkdown('第一行\n第二行')).toEqual([
      { kind: 'paragraph', inline: [{ kind: 'text', text: '第一行 第二行' }] },
    ]);
  });

  it('无序与有序列表各自成块，类型切换会断块', () => {
    const blocks = parseMarkdown('- a\n- b\n\n1. c\n2. d');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ kind: 'list', ordered: false });
    expect(blocks[1]).toMatchObject({ kind: 'list', ordered: true });
    expect(blocks[1]).toMatchObject({ items: [[{ kind: 'text', text: 'c' }], [{ kind: 'text', text: 'd' }]] });
  });
});

describe('parseMarkdown 行内', () => {
  it('解析 [[c:id]] 引用为芯片 token', () => {
    expect(parseMarkdown('见 [[c:3760801399]] 的回复')).toEqual([
      {
        kind: 'paragraph',
        inline: [
          { kind: 'text', text: '见 ' },
          { kind: 'chip', commentId: '3760801399' },
          { kind: 'text', text: ' 的回复' },
        ],
      },
    ]);
  });

  it('粗体内部仍可识别芯片', () => {
    expect(parseMarkdown('**重点 [[c:abc_1]]**')).toEqual([
      {
        kind: 'paragraph',
        inline: [{ kind: 'bold', children: [{ kind: 'text', text: '重点 ' }, { kind: 'chip', commentId: 'abc_1' }] }],
      },
    ]);
  });

  it('未闭合的粗体标记按字面文本处理', () => {
    expect(parseMarkdown('**没闭合')).toEqual([{ kind: 'paragraph', inline: [{ kind: 'text', text: '**没闭合' }] }]);
  });

  it('行内代码与芯片共存', () => {
    const blocks = parseMarkdown('用 `--flag` 后 [[c:9]] 生效');
    expect(blocks[0]).toEqual({
      kind: 'paragraph',
      inline: [
        { kind: 'text', text: '用 ' },
        { kind: 'code', text: '--flag' },
        { kind: 'text', text: ' 后 ' },
        { kind: 'chip', commentId: '9' },
        { kind: 'text', text: ' 生效' },
      ],
    });
  });

  it('列表项内的芯片也能识别', () => {
    const blocks = parseMarkdown('- 反驳 [[c:42]]');
    expect(blocks[0]).toEqual({
      kind: 'list',
      ordered: false,
      items: [[{ kind: 'text', text: '反驳 ' }, { kind: 'chip', commentId: '42' }]],
    });
  });

  it('HTML 只作为纯文本 token，绝不产生结构', () => {
    const blocks = parseMarkdown('<script>alert(1)</script>');
    expect(blocks).toEqual([{ kind: 'paragraph', inline: [{ kind: 'text', text: '<script>alert(1)</script>' }] }]);
  });

  it('非法的芯片标记保持原样', () => {
    expect(parseMarkdown('[[c:]] 与 [[c:有空格]]')).toEqual([
      { kind: 'paragraph', inline: [{ kind: 'text', text: '[[c:]] 与 [[c:有空格]]' }] },
    ]);
  });
});
