import { describe, expect, it } from 'vitest';
import { buildForest } from '@/core/tree';
import { makeComment } from './fakes';

describe('buildForest', () => {
  it('按 parentId 建立层级，depth / size / parent 正确', () => {
    const comments = [
      makeComment({ id: 'r1', createdAt: 100 }),
      makeComment({ id: 'r2', createdAt: 50 }),
      makeComment({ id: 'c1', rootId: 'r1', parentId: 'r1', createdAt: 10 }),
      makeComment({ id: 'c2', rootId: 'r1', parentId: 'c1', createdAt: 20 }),
      makeComment({ id: 'c3', rootId: 'r1', parentId: 'c1', createdAt: 5 }),
    ];
    const forest = buildForest(comments);

    expect(forest.roots.map((node) => node.comment.id)).toEqual(['r2', 'r1']);
    expect(forest.orphans).toBe(0);

    const r1 = forest.byId.get('r1')!;
    expect(r1.depth).toBe(0);
    expect(r1.size).toBe(4);
    expect(r1.parent).toBeNull();
    expect(r1.children.map((node) => node.comment.id)).toEqual(['c1']);

    const c1 = forest.byId.get('c1')!;
    expect(c1.depth).toBe(1);
    expect(c1.size).toBe(3);
    expect(c1.parent?.comment.id).toBe('r1');
    // 兄弟按 createdAt 升序
    expect(c1.children.map((node) => node.comment.id)).toEqual(['c3', 'c2']);

    const c2 = forest.byId.get('c2')!;
    expect(c2.depth).toBe(2);
    expect(c2.size).toBe(1);
  });

  it('同 createdAt 时按 id 排序，保证顺序稳定', () => {
    const forest = buildForest([
      makeComment({ id: 'r', createdAt: 1 }),
      makeComment({ id: 'b', rootId: 'r', parentId: 'r', createdAt: 7 }),
      makeComment({ id: 'a', rootId: 'r', parentId: 'r', createdAt: 7 }),
      makeComment({ id: 'c', rootId: 'r', parentId: 'r', createdAt: 7 }),
    ]);
    expect(forest.byId.get('r')!.children.map((node) => node.comment.id)).toEqual(['a', 'b', 'c']);
  });

  it('父评论缺失时退回 rootId 挂载并计入 orphan', () => {
    const forest = buildForest([
      makeComment({ id: 'r', createdAt: 1, replyCount: 2 }),
      // parentId 指向被删的评论，但 rootId 还在
      makeComment({ id: 'c1', rootId: 'r', parentId: 'gone', createdAt: 2 }),
      // parentId 与 rootId 都找不到
      makeComment({ id: 'c2', rootId: 'gone2', parentId: 'gone', createdAt: 3 }),
    ]);

    expect(forest.orphans).toBe(2);
    expect(forest.byId.get('c1')!.parent?.comment.id).toBe('r');
    expect(forest.byId.get('c2')!.parent).toBeNull();
    expect(forest.roots.map((node) => node.comment.id)).toEqual(['r', 'c2']);
    expect(forest.byId.get('r')!.size).toBe(2);
  });

  it('处理自环与互环，不丢节点也不死循环', () => {
    const forest = buildForest([
      makeComment({ id: 'a', rootId: 'b', parentId: 'b', createdAt: 1 }),
      makeComment({ id: 'b', rootId: 'a', parentId: 'a', createdAt: 2 }),
      makeComment({ id: 'self', rootId: 'self', parentId: 'self', createdAt: 3 }),
    ]);

    expect(forest.byId.size).toBe(3);
    expect(forest.roots.reduce((sum, node) => sum + node.size, 0)).toBe(3);
    for (const node of forest.byId.values()) {
      expect(Number.isFinite(node.depth)).toBe(true);
    }
    expect(forest.orphans).toBeGreaterThan(0);
  });

  it('深链不递归爆栈', () => {
    const depth = 20_000;
    const comments = [makeComment({ id: 'n0', createdAt: 0 })];
    for (let i = 1; i < depth; i++) {
      comments.push(makeComment({ id: `n${i}`, rootId: 'n0', parentId: `n${i - 1}`, createdAt: i }));
    }
    const forest = buildForest(comments);

    expect(forest.roots).toHaveLength(1);
    expect(forest.roots[0]!.size).toBe(depth);
    expect(forest.roots[0]!.depth).toBe(0);
    expect(forest.byId.get(`n${depth - 1}`)!.depth).toBe(depth - 1);
    expect(forest.byId.get(`n${depth - 1}`)!.size).toBe(1);
    expect(forest.orphans).toBe(0);
  });

  it('重复 id 只保留一条', () => {
    const forest = buildForest([
      makeComment({ id: 'r', createdAt: 1, text: '第一次' }),
      makeComment({ id: 'r', createdAt: 1, text: '第二次' }),
    ]);
    expect(forest.byId.size).toBe(1);
    expect(forest.roots).toHaveLength(1);
    expect(forest.byId.get('r')!.comment.text).toBe('第一次');
  });

  it('空输入得到空森林', () => {
    const forest = buildForest([]);
    expect(forest.roots).toEqual([]);
    expect(forest.byId.size).toBe(0);
    expect(forest.orphans).toBe(0);
  });
});
