import { describe, expect, it } from 'vitest';
import { createRefRewriter, parseThreadDiagnosis } from '../../src/ai/prompts';

describe('createRefRewriter', () => {
  const map = new Map<number, string>([
    [1, 'comment-1'],
    [12, 'comment-12'],
    [3, 'comment-3'],
  ]);

  it('把 #序号 换成稳定标记', () => {
    const rewriter = createRefRewriter(map);
    expect(rewriter.push('见 #1 与 #3。')).toBe('见 [[c:comment-1]] 与 [[c:comment-3]]。');
    expect(rewriter.flush()).toBe('');
  });

  it('跨 chunk 的半截引用不会被误判', () => {
    const rewriter = createRefRewriter(map);
    expect(rewriter.push('见 #1')).toBe('见 ');
    expect(rewriter.push('2 的观点')).toBe('[[c:comment-12]] 的观点');
    expect(rewriter.flush()).toBe('');
  });

  it('flush 结掉末尾残留的 #', () => {
    const rewriter = createRefRewriter(map);
    expect(rewriter.push('末尾 #')).toBe('末尾 ');
    expect(rewriter.flush()).toBe('#');
    const rewriter2 = createRefRewriter(map);
    expect(rewriter2.push('末尾 #7')).toBe('末尾 ');
    expect(rewriter2.flush()).toBe('#7');
  });

  it('Markdown 标题与未知序号不受影响', () => {
    const rewriter = createRefRewriter(map);
    expect(rewriter.push('## 整体情绪 #9。')).toBe('## 整体情绪 #9。');
    const rewriter2 = createRefRewriter(map);
    expect(rewriter2.push('## 主要话题\n#1 值得参考')).toBe('## 主要话题\n[[c:comment-1]] 值得参考');
  });
});

describe('parseThreadDiagnosis', () => {
  const map = new Map<number, string>([
    [0, 'c0'],
    [1, 'c1'],
    [2, 'c2'],
  ]);

  it('解析带代码围栏的 JSON，并丢弃未知序号与越界立场下标', () => {
    const raw = [
      '```json',
      JSON.stringify({
        summary: '  两派争论  ',
        stances: [
          { label: '支持', summary: '值得做' },
          { label: '反对', summary: '成本高' },
        ],
        stanceOf: { 0: 0, 1: 9, 2: -3, 7: 1 },
        fallacies: [
          { idx: 1, type: '稻草人', note: '曲解对方' },
          { idx: 7, type: '诉诸人身', note: '不该出现' },
          { idx: 2, type: '', note: '缺类型' },
        ],
        turningPoints: [2, 2, 9],
        consensus: '  尚未达成共识  ',
      }),
      '```',
    ].join('\n');
    const diagnosis = parseThreadDiagnosis(raw, map);
    expect(diagnosis.summary).toBe('两派争论');
    expect(diagnosis.stances).toHaveLength(2);
    // 9 / -3 越界、7 未知序号：全部丢弃，绝不夹紧到相邻立场。
    expect(diagnosis.stanceOf).toEqual({ c0: 0 });
    expect(diagnosis.fallacies).toEqual([{ commentId: 'c1', type: '稻草人', note: '曲解对方' }]);
    expect(diagnosis.turningPoints).toEqual(['c2']);
    expect(diagnosis.consensus).toBe('尚未达成共识');
  });

  it('越界立场下标一律丢弃，绝不夹紧到相邻立场', () => {
    const raw = JSON.stringify({
      summary: 'x',
      stances: [{ label: 'A', summary: '' }, { label: 'B', summary: '' }],
      stanceOf: { 0: 2, 1: -1, 2: 1 },
    });
    expect(parseThreadDiagnosis(raw, map).stanceOf).toEqual({ c2: 1 });
  });

  it('允许空 stances 数组（无立场时不伪造字段）', () => {
    const diagnosis = parseThreadDiagnosis('{"summary":"x","stances":[]}', map);
    expect(diagnosis.stances).toEqual([]);
    expect(diagnosis.stanceOf).toEqual({});
    expect(diagnosis.fallacies).toEqual([]);
    expect(diagnosis.turningPoints).toEqual([]);
    expect(diagnosis.consensus).toBeNull();
  });

  it('结构损坏时抛出可读错误，而不是伪造空字段', () => {
    expect(() => parseThreadDiagnosis('{"stances":[]}', map)).toThrow('summary');
    expect(() => parseThreadDiagnosis('{"summary":"x"}', map)).toThrow('stances');
    expect(() => parseThreadDiagnosis('{"summary":"x","stances":"oops"}', map)).toThrow('stances');
    expect(() => parseThreadDiagnosis('{"summary":"x","stances":[{"summary":"无 label"}]}', map)).toThrow('label');
    expect(() => parseThreadDiagnosis('[1,2,3]', map)).toThrow('AI 未返回诊断 JSON');
  });

  it('没有可解析的 JSON 时抛错', () => {
    expect(() => parseThreadDiagnosis('完全没有 JSON', map)).toThrow('AI 未返回诊断 JSON');
    expect(() => parseThreadDiagnosis('{不是 JSON}', map)).toThrow('无法解析');
  });
});

