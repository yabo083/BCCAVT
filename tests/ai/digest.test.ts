import { describe, expect, it } from 'vitest';
import { buildSubjectDigest, buildThreadDigest } from '../../src/ai/digest';
import { comment, makeForest, subjectResult, threadResult } from './fakes';

const BASE = 1_700_000_000_000;

describe('buildSubjectDigest', () => {
  const comments = Array.from({ length: 40 }, (_, i) =>
    comment({ id: `c${i}`, createdAt: BASE + i * 60_000, likes: i, text: `第 ${i} 条评论，内容比较长一些。`.repeat(8) }),
  );
  const result = subjectResult(comments, {
    topComments: [comments[39]!, comments[38]!, comments[37]!],
    hotThreads: [{ root: comments[36]!, size: 5, depth: 3, participants: 4 }],
    keywords: [{ label: '价格', count: 12 }],
    locations: [{ label: '广东', count: 30 }],
  });

  it('受 maxChars 约束，且不含表情符号', () => {
    const digest = buildSubjectDigest(result, 600);
    expect(digest.text.length).toBeLessThanOrEqual(600);
    expect(digest.text).toContain('【标题】');
    expect(digest.text).toContain('【数据】');
    expect(digest.text).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    expect(digest.text).toContain('[赞');
  });

  it('代表评论去重，短序号可映射回真实 id', () => {
    const digest = buildSubjectDigest(result, 24_000);
    const lines = digest.text.split('\n').filter((line) => /^#\d+ \[赞\d+\]/.test(line));
    expect(lines.length).toBeGreaterThan(0);
    expect(new Set(lines).size).toBe(lines.length);
    expect(new Set(digest.indexToId.values()).size).toBe(digest.indexToId.size);
    for (const [index, id] of digest.indexToId) {
      expect(digest.text).toContain(`#${index} `);
      expect(comments.some((item) => item.id === id)).toBe(true);
    }
    expect(digest.text).toContain(`[赞${comments[39]?.likes ?? 0}]`);
  });

  it('极小预算也不会超长', () => {
    expect(buildSubjectDigest(result, 80).text.length).toBeLessThanOrEqual(80);
  });

  it('小预算下短序号映射与文本保持一致', () => {
    const digest = buildSubjectDigest(result, 300);
    expect(digest.text.length).toBeLessThanOrEqual(300);
    for (const [index, id] of digest.indexToId) {
      expect(digest.text).toContain(`#${index} `);
      expect(comments.some((item) => item.id === id)).toBe(true);
    }
  });
});

describe('buildThreadDigest', () => {
  const root = comment({ id: 'r', createdAt: BASE, likes: 10, replyCount: 3, text: '根评论：这个方案值不值得做？' });
  const a = comment({ id: 'a', rootId: 'r', parentId: 'r', createdAt: BASE + 1_000, text: '值得，成本可控。' });
  const b = comment({ id: 'b', rootId: 'r', parentId: 'a', createdAt: BASE + 2_000, text: '但忽略了运维复杂度。' });
  const c = comment({ id: 'c', rootId: 'r', parentId: 'r', createdAt: BASE + 3_000, text: '我持保留意见。' });
  const result = threadResult(root, [a, b, c], { focusId: 'b', longestChain: [root, a, b] });

  it('时间序输出缩进文本，并保留根 / 焦点 / 最长链', () => {
    const digest = buildThreadDigest(result, 1_000);
    expect(digest.text.length).toBeLessThanOrEqual(1_000);
    expect(digest.text).toContain('用户r');
    expect(digest.text).toContain('用户a');
    expect(digest.text).toContain('用户b');
    expect(digest.text).toContain('→用户r');
    expect([...digest.indexToId.values()]).toEqual(['r', 'a', 'b', 'c']);
    expect(digest.indexToId.get(0)).toBe('r');
    // 缩进体现层级：a 与 c 在根下一层
    const lines = digest.text.split('\n');
    expect(lines.some((line) => line.startsWith('  #1 '))).toBe(true);
  });

  it('预算不够时丢弃非必要行但仍不超长', () => {
    const digest = buildThreadDigest(result, 200);
    expect(digest.text.length).toBeLessThanOrEqual(200);
    expect(digest.indexToId.get(0)).toBe('r');
  });

  it('根评论不在森林里时也会被补进摘录', () => {
    const lonely = threadResult(root, [], { focusId: 'r' });
    lonely.forest = { roots: [], byId: new Map(), orphans: 0 };
    const digest = buildThreadDigest(lonely, 500);
    expect(digest.indexToId.get(0)).toBe('r');
    expect(digest.text).toContain('根评论：这个方案值不值得做？');
  });

  it('只摘录传入的评论子树，不夹带快照里的旁支评论', () => {
    const scoped = threadResult(root, [a, b, c], { focusId: 'b', longestChain: [root, a, b] });
    const outsider = comment({ id: 'z', rootId: 'r', parentId: 'r', createdAt: BASE + 9_000, text: '不该出现的旁支' });
    scoped.snapshot.comments = [...scoped.snapshot.comments, outsider];
    scoped.forest = makeForest([root, a, b, c]);
    const digest = buildThreadDigest(scoped, 1_000);
    expect(digest.text).not.toContain('不该出现的旁支');
    expect([...digest.indexToId.values()]).toEqual(['r', 'a', 'b', 'c']);
  });

  it('节点很多时仍严格受 maxChars 约束且短序号映射一致', () => {
    const bigRoot = comment({ id: 'big-r', createdAt: BASE, text: '根评论' });
    const replies = Array.from({ length: 300 }, (_, i) =>
      comment({ id: `x${i}`, rootId: 'big-r', parentId: 'big-r', createdAt: BASE + i + 1, text: '较长的回复内容，用来撑爆预算。'.repeat(6) }),
    );
    const digest = buildThreadDigest(threadResult(bigRoot, replies), 1_500);
    expect(digest.text.length).toBeLessThanOrEqual(1_500);
    const all = [bigRoot, ...replies];
    for (const [index, id] of digest.indexToId) {
      expect(digest.text).toContain(`#${index} `);
      expect(all.some((item) => item.id === id)).toBe(true);
    }
  });
});
