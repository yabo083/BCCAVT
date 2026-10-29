/**
 * 多级回复布局内核（`native-thread-layout.ts`，纯逻辑、不碰 DOM）的单元测试。
 * 只验算法契约：父先子后前序、层级封顶、孤立标记、剪环、折叠叠加与已加载后代数。
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_THREAD_DEPTH,
  layoutThread,
  type ThreadLayoutEntry,
  type ThreadRelation,
} from '@/extension/content/native-thread-layout';

const NONE: ReadonlySet<string> = new Set<string>();

function entryOf(entries: readonly ThreadLayoutEntry[], id: string): ThreadLayoutEntry {
  const found = entries.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`布局结果里没有 id=${id} 的条目`);
  return found;
}

function idsOf(entries: readonly ThreadLayoutEntry[]): string[] {
  return entries.map((entry) => entry.id);
}

describe('父先子后前序', () => {
  it('乱序输入（子在前、父在后）也按父先子后输出，前序下标连续', () => {
    const relations: ThreadRelation[] = [
      { id: '3', parentId: '2' },
      { id: '1', parentId: '100' },
      { id: '2', parentId: '1' },
    ];
    const entries = layoutThread(relations, '100', NONE);

    expect(idsOf(entries)).toEqual(['1', '2', '3']);
    expect(entries.map((entry) => entry.order)).toEqual([0, 1, 2]);
    expect(entries.map((entry) => entry.depth)).toEqual([0, 1, 2]);
    expect(entries.map((entry) => entry.descendantCount)).toEqual([2, 1, 0]);
    expect(entries.every((entry) => !entry.orphan && !entry.hidden)).toBe(true);
  });

  it('同层保持输入顺序，不按 id 或时间重排', () => {
    const entries = layoutThread(
      [
        { id: 'b', parentId: '100' },
        { id: 'a', parentId: '100' },
        { id: 'c', parentId: '100' },
      ],
      '100',
      NONE,
    );
    expect(idsOf(entries)).toEqual(['b', 'a', 'c']);
    expect(entries.map((entry) => entry.order)).toEqual([0, 1, 2]);
  });

  it('先出现的分支整棵排在后面的分支之前（深度优先前序）', () => {
    const entries = layoutThread(
      [
        { id: 'a', parentId: '100' },
        { id: 'b', parentId: '100' },
        { id: 'a1', parentId: 'a' },
        { id: 'a2', parentId: 'a1' },
        { id: 'b1', parentId: 'b' },
      ],
      '100',
      NONE,
    );
    expect(idsOf(entries)).toEqual(['a', 'a1', 'a2', 'b', 'b1']);
    expect(entries.map((entry) => entry.depth)).toEqual([0, 1, 2, 0, 1]);
    expect(entryOf(entries, 'a').descendantCount).toBe(2);
    expect(entryOf(entries, 'b').descendantCount).toBe(1);
  });

  it('id 一律按字符串比较：超过 2^53 的 rpid 不会互相并成一条', () => {
    const big = '3807562709260000926';
    const other = '3807562709260000927';
    const entries = layoutThread(
      [
        { id: other, parentId: big },
        { id: big, parentId: '100' },
      ],
      '100',
      NONE,
    );
    expect(idsOf(entries)).toEqual([big, other]);
    expect(entryOf(entries, other).depth).toBe(1);
  });
});

describe('层级与孤立条目', () => {
  it('层级逐级递增，封顶到 MAX_THREAD_DEPTH', () => {
    const relations: ThreadRelation[] = [{ id: '1', parentId: '100' }];
    for (let index = 2; index <= 12; index += 1) relations.push({ id: String(index), parentId: String(index - 1) });
    const entries = layoutThread(relations, '100', NONE);

    expect(entries.map((entry) => entry.depth).slice(0, MAX_THREAD_DEPTH + 1)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(entries.every((entry) => entry.depth <= MAX_THREAD_DEPTH)).toBe(true);
    expect(entries[entries.length - 1]?.depth).toBe(MAX_THREAD_DEPTH);
  });

  it('父缺失 / 平台给 0 / 没有父：显示在当前顶层并标 orphan，层级从 0 重新起算', () => {
    const entries = layoutThread(
      [
        { id: 'x', parentId: '999' },
        { id: 'y', parentId: null },
        { id: 'x1', parentId: 'x' },
      ],
      '100',
      NONE,
    );

    expect(entryOf(entries, 'x').depth).toBe(0);
    expect(entryOf(entries, 'x').orphan).toBe(true);
    expect(entryOf(entries, 'y').depth).toBe(0);
    expect(entryOf(entries, 'y').orphan).toBe(true);
    // 孤立条目自己的后代照常嵌套在它下面，且不算孤立
    expect(entryOf(entries, 'x1').depth).toBe(1);
    expect(entryOf(entries, 'x1').orphan).toBe(false);
    expect(entryOf(entries, 'x').descendantCount).toBe(1);
  });

  it('父就是线程根评论：顶层且不算孤立', () => {
    const entries = layoutThread([{ id: '1', parentId: '100' }], '100', NONE);
    expect(entryOf(entries, '1').depth).toBe(0);
    expect(entryOf(entries, '1').orphan).toBe(false);
  });
});

describe('脏数据防护', () => {
  it('父链成环：收敛成有限层级、无重复、无隐藏', () => {
    const entries = layoutThread(
      [
        { id: '1', parentId: '2' },
        { id: '2', parentId: '1' },
      ],
      '100',
      NONE,
    );

    expect(entries).toHaveLength(2);
    expect(new Set(idsOf(entries)).size).toBe(2);
    expect(entries.map((entry) => entry.order)).toEqual([0, 1]);
    expect(entries.map((entry) => entry.depth)).toEqual([0, 1]);
    expect(entries.every((entry) => !entry.hidden)).toBe(true);
    // 环被剪断，两条都在：一条顶层（标孤立），另一条嵌在它下面
    expect(entries.filter((entry) => entry.orphan)).toHaveLength(1);
  });

  it('自引用父（parentId === id）也收敛，不死循环', () => {
    const entries = layoutThread([{ id: '5', parentId: '5' }], '100', NONE);
    expect(entries).toHaveLength(1);
    expect(entryOf(entries, '5').depth).toBe(0);
    expect(entryOf(entries, '5').orphan).toBe(true);
  });

  it('三节点环 + 挂在环上的子树：全部有输出、无重复、顺序有限', () => {
    const entries = layoutThread(
      [
        { id: 'x', parentId: 'y' },
        { id: 'y', parentId: 'z' },
        { id: 'z', parentId: 'x' },
        { id: 'leaf', parentId: 'z' },
      ],
      '100',
      NONE,
    );
    expect(entries).toHaveLength(4);
    expect(new Set(idsOf(entries)).size).toBe(4);
    expect(entries.map((entry) => entry.order)).toEqual([0, 1, 2, 3]);
    expect(entryOf(entries, 'leaf').depth).toBeGreaterThanOrEqual(1);
  });

  it('重复 id 只认第一条（复用方的边界保护；原生增强在更早一步就整容器跳过）', () => {
    const entries = layoutThread(
      [
        { id: 'a', parentId: '100' },
        { id: 'a', parentId: '100' },
      ],
      '100',
      NONE,
    );
    expect(entries).toHaveLength(1);
  });

  it('空输入返回空结果', () => {
    expect(layoutThread([], '100', NONE)).toEqual([]);
  });

  it('长链不爆栈：500 条仍然收敛且前序连续', () => {
    const relations: ThreadRelation[] = [{ id: '1', parentId: '100' }];
    for (let index = 2; index <= 500; index += 1) relations.push({ id: String(index), parentId: String(index - 1) });
    const entries = layoutThread(relations, '100', NONE);
    expect(entries).toHaveLength(500);
    expect(entries.map((entry) => entry.order)).toEqual(Array.from({ length: 500 }, (_, index) => index));
  });
});

describe('折叠标记', () => {
  // 100（线程根）→ 1 → 2 → 3，另有 1 的兄弟 4
  const relations: ThreadRelation[] = [
    { id: '1', parentId: '100' },
    { id: '2', parentId: '1' },
    { id: '3', parentId: '2' },
    { id: '4', parentId: '100' },
  ];

  it('线程根折叠：整棵已加载列表都标记隐藏（含孤立顶层条目）', () => {
    const entries = layoutThread([...relations, { id: '9', parentId: '999' }], '100', new Set(['100']));
    expect(entries.every((entry) => entry.hidden)).toBe(true);
    // 折叠只改标记，不改「已加载后代数」
    expect(entryOf(entries, '1').descendantCount).toBe(2);
  });

  it('折叠只看后代：被折叠的那条自己不隐藏，兄弟与祖先不动', () => {
    const entries = layoutThread(relations, '100', new Set(['1']));
    expect(entryOf(entries, '1').hidden).toBe(false);
    expect(entryOf(entries, '2').hidden).toBe(true);
    expect(entryOf(entries, '3').hidden).toBe(true);
    expect(entryOf(entries, '4').hidden).toBe(false);
  });

  it('祖先折叠叠加自身折叠：展开祖先后自身折叠照旧生效', () => {
    const both = layoutThread(relations, '100', new Set(['1', '2']));
    expect(both.map((entry) => entry.hidden)).toEqual([false, true, true, false]);

    const onlyChild = layoutThread(relations, '100', new Set(['2']));
    expect(entryOf(onlyChild, '1').hidden).toBe(false);
    expect(entryOf(onlyChild, '2').hidden).toBe(false);
    expect(entryOf(onlyChild, '3').hidden).toBe(true);
    expect(entryOf(onlyChild, '4').hidden).toBe(false);
  });

  it('折叠状态与顺序无关：折叠不改变前序与层级', () => {
    const open = layoutThread(relations, '100', NONE);
    const folded = layoutThread(relations, '100', new Set(['1']));
    expect(idsOf(folded)).toEqual(idsOf(open));
    expect(folded.map((entry) => entry.depth)).toEqual(open.map((entry) => entry.depth));
  });
});
