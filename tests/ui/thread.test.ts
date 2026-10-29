import { describe, expect, it } from 'vitest';
import { COMPACT_ROW_THRESHOLD, MAX_VISUAL_DEPTH, ROW_PAGE_SIZE, collapsibleIds, flattenThread, nextRowCap } from '@/ui/thread';
import type { Comment } from '@/core/model';
import type { CommentNode } from '@/core/report';

interface Spec {
  id: string;
  text?: string;
  children?: Spec[];
}

function buildNode(spec: Spec, parent: CommentNode | null): CommentNode {
  const comment: Comment = {
    id: spec.id,
    rootId: parent ? (parent.comment.rootId ?? parent.comment.id) : null,
    parentId: parent?.comment.id ?? null,
    author: { id: `u-${spec.id}`, name: `user${spec.id}` },
    text: spec.text ?? `正文 ${spec.id}`,
    createdAt: 1_700_000_000_000,
    likes: 0,
    replyCount: spec.children?.length ?? 0,
  };
  const node: CommentNode = { comment, children: [], parent, depth: parent ? parent.depth + 1 : 0, size: 1 };
  for (const child of spec.children ?? []) node.children.push(buildNode(child, node));
  node.size = 1 + node.children.reduce((sum, child) => sum + child.size, 0);
  return node;
}

/** a ├─ b ── d
 *    └─ c        */
const root = buildNode(
  {
    id: 'a',
    text: '第一行\n\n第二行',
    children: [{ id: 'b', children: [{ id: 'd' }] }, { id: 'c' }],
  },
  null,
);

const idsOf = (collapsed: ReadonlySet<string>): string[] => flattenThread(root, collapsed).map((row) => row.id);

describe('flattenThread', () => {
  it('按前序展平：父在上，直接回复紧跟其后，深度与行号正确', () => {
    const rows = flattenThread(root, new Set());
    expect(rows.map((row) => row.id)).toEqual(['a', 'b', 'd', 'c']);
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 2, 1]);
    expect(rows.map((row) => row.index)).toEqual([0, 1, 2, 3]);
    expect(rows.map((row) => row.hasChildren)).toEqual([true, true, false, false]);
    expect(rows.map((row) => row.col)).toEqual([0, 1, 2, 1]);
    expect(rows.map((row) => row.parentCol)).toEqual([0, 0, 1, 0]);
  });

  it('正文预览压成单行，完整正文不进预览以外的字段', () => {
    const [first] = flattenThread(root, new Set());
    expect(first!.preview).toBe('第一行 第二行');
    expect(first!.node.comment.text).toBe('第一行\n\n第二行');
  });

  it('折叠节点时整棵子树消失，隐藏条数为后代总数', () => {
    const rows = flattenThread(root, new Set(['b']));
    expect(rows.map((row) => row.id)).toEqual(['a', 'b', 'c']);
    expect(rows.find((row) => row.id === 'b')).toMatchObject({ folded: true, hidden: 1, hasChildren: true });
  });

  it('折叠根只剩一行，隐藏条数为其余全部节点', () => {
    const rows = flattenThread(root, new Set(['a']));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'a', folded: true, hidden: 3 });
  });

  it('叶子节点折叠标记无意义也不报错', () => {
    expect(idsOf(new Set(['d']))).toEqual(['a', 'b', 'd', 'c']);
  });

  it('行序只取决于树结构，不受折叠集合里的无关 id 影响', () => {
    expect(idsOf(new Set(['不存在']))).toEqual(['a', 'b', 'd', 'c']);
  });

  it('阈值用于判断是否进入紧凑模式', () => {
    expect(flattenThread(root, new Set()).length).toBeLessThanOrEqual(COMPACT_ROW_THRESHOLD);
  });
});

/** a ── b ├─ c ── d
 *         └─ f        （b 是 a 的独子；c 不是 b 的末位，f 才是） */
const branched = buildNode(
  { id: 'a', children: [{ id: 'b', children: [{ id: 'c', children: [{ id: 'd' }] }, { id: 'f' }] }] },
  null,
);

/** 一条到底的链：每层都是独子（末位），任何一行都不该出现多余的脊线。 */
const chain = buildNode(
  { id: 'a', children: [{ id: 'b', children: [{ id: 'c', children: [{ id: 'd', children: [{ id: 'e' }] }] }] }] },
  null,
);

describe('视觉列与贯穿脊线', () => {
  it('col 封顶到 MAX_VISUAL_DEPTH：更深的回复不再右移，parentCol 仍指向父的视觉列', () => {
    const rows = flattenThread(chain, new Set());
    expect(rows.map((row) => row.col)).toEqual([0, 1, 2, 3, 3]);
    expect(rows.map((row) => row.parentCol)).toEqual([0, 0, 1, 2, 3]);
    expect(rows.at(-1)!.depth).toBe(4);
    expect(rows.at(-1)!.col).toBe(MAX_VISUAL_DEPTH);
  });

  it('根行不带任何脊线，col / parentCol 都是 0', () => {
    const [first] = flattenThread(root, new Set());
    expect(first).toMatchObject({ id: 'a', depth: 0, col: 0, parentCol: 0, rowSpines: [] });
  });

  it('非末位兄弟的父列要穿透本行与它的全部后代', () => {
    const rows = flattenThread(branched, new Set());
    const byId = new Map(rows.map((row) => [row.id, row]));
    // c 不是 b 的末位：b 那一列得从 c 这行继续往下走……
    expect(byId.get('c')!.rowSpines).toEqual([1]);
    // ……并一路穿过后代 d，否则 d 之后的行接不上一根连续的线。
    expect(byId.get('d')!.rowSpines).toEqual([1]);
    // f 是末位，父列在 c 这行就收口了。
    expect(byId.get('f')!.rowSpines).toEqual([]);
  });

  it('末位链上没有多余脊线：每层都是独子时行行干净', () => {
    expect(flattenThread(chain, new Set()).map((row) => row.rowSpines)).toEqual([[], [], [], [], []]);
  });

  it('封顶行 col === parentCol，脊线里不含自己那一列', () => {
    expect(flattenThread(chain, new Set()).at(-1)).toMatchObject({ col: 3, parentCol: 3, rowSpines: [] });
  });

  it('折叠只跳过子树：被折叠的行照常出行，脊线照常算', () => {
    const rows = flattenThread(root, new Set(['b']));
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect([...byId.keys()]).toEqual(['a', 'b', 'c']);
    // b 之后还有兄弟 c，所以根那一列（0）必须穿过 b 这行；c 是末位，什么都不用穿。
    expect(byId.get('b')!.rowSpines).toEqual([0]);
    expect(byId.get('c')!.rowSpines).toEqual([]);
  });
});

describe('collapsibleIds', () => {
  it('只收有子节点的评论，前序返回（含根）', () => {
    expect(collapsibleIds(root)).toEqual(['a', 'b']);
  });

  it('单节点树没有可折叠项', () => {
    expect(collapsibleIds(buildNode({ id: 'solo' }, null))).toEqual([]);
  });
});

describe('nextRowCap', () => {
  it('一次推进一批：1000 行的树不会一口气铺满 DOM', () => {
    expect(nextRowCap(0, 1000)).toBe(ROW_PAGE_SIZE);
    expect(nextRowCap(ROW_PAGE_SIZE, 1000)).toBe(ROW_PAGE_SIZE * 2);
  });

  it('不够一批就铺完剩余的行', () => {
    expect(nextRowCap(90, 120)).toBe(120);
    expect(nextRowCap(ROW_PAGE_SIZE, ROW_PAGE_SIZE)).toBe(ROW_PAGE_SIZE);
  });

  it('上限只增不减：总数临时变小也不回撤已铺开的窗口', () => {
    expect(nextRowCap(500, 1000)).toBe(600);
    // 折叠让总数低于上限时窗口保持不动——收回去会让已渲染的尾部行离开 DOM，
    // 再展开时用户就得重新铺一遍（见 nextRowCap 的注释）
    expect(nextRowCap(500, 300)).toBe(500);
    expect(nextRowCap(0, 0)).toBe(0);
  });
});
