/** 评论树展示的纯逻辑：可见行展平、密度判定、可折叠节点。视图只负责渲染与交互。 */
import type { CommentNode } from '@/core/report';

export interface ThreadRow {
  node: CommentNode;
  id: string;
  /** 真实深度（根 = 0）。只用于「第 N 层」这类语义提示，不再决定缩进。 */
  depth: number;
  /** 视觉列 = `min(depth, MAX_VISUAL_DEPTH)`：缩进封顶后本行实际占的列，视图按它缩进与画线。 */
  col: number;
  /** 父节点的视觉列（根的直接子代传 0）。 */
  parentCol: number;
  /** 需贯穿本行绘制的祖先竖脊列（升序）。 */
  rowSpines: number[];
  /** 可见行下标（0 起），虚拟列表按它定位。 */
  index: number;
  hasChildren: boolean;
  /** 该节点当前处于折叠态。 */
  folded: boolean;
  /** 折叠时被隐藏的后代条数（含子回复）。 */
  hidden: number;
  /** 单行化后的正文预览（换行/连续空白压成空格），完整正文只在悬浮层与详情里出现。 */
  preview: string;
}

/** 缩进封顶的视觉列数：真实深度超过它就不再右移，更深的回复并到最后一列上，深度语义由「第 N 层」补回。 */
export const MAX_VISUAL_DEPTH = 3;

/**
 * 前序遍历：父在上、直接回复紧跟在下的可见行序列；折叠节点的整棵子树跳过。
 *
 * 每一行除了自己的视觉列（`col`）还带上「要从本行穿过去的祖先列」（`rowSpines`），
 * 视图只管照着画——竖脊在哪一行收口是树结构问题，不该在渲染层按深度猜。
 *
 * 根行固定 `col = parentCol = 0`、不带任何脊线（它是讨论串的起点）；根的直接子代从第 1 列起。
 */
export function flattenThread(root: CommentNode, collapsed: ReadonlySet<string>): ThreadRow[] {
  const rows: ThreadRow[] = [];

  const push = (
    node: CommentNode,
    depth: number,
    col: number,
    parentCol: number,
    rowSpines: number[],
  ): void => {
    const folded = collapsed.has(node.comment.id);
    rows.push({
      node,
      id: node.comment.id,
      depth,
      col,
      parentCol,
      rowSpines,
      index: rows.length,
      hasChildren: node.children.length > 0,
      folded,
      hidden: folded ? node.size - 1 : 0,
      preview: node.comment.text.replace(/\s+/g, ' ').trim(),
    });
  };

  /**
   * 按「兄弟组」递归铺开一层：先算本行的列与脊线并入队，再下探子代。
   *
   * **非末位兄弟的 `parentCol` 必须穿透本行、以及它的全部后代**——这是本轮修掉「悬空半截线 /
   * 缺一条线」的关键。同一列上只要本行之后还有兄弟（`!isLast`），那一列的竖脊就得继续往下走：
   * 它先穿过本行（`rowSpines`），再随 `nextSpines` 传给子代继续穿。漏掉任何一段，后面那个兄弟
   * 的 elbow 都会接在一根断掉的线上。旧版按绝对深度逐列推断「这一列到谁为止」，遇到折叠与封顶
   * 就对不上号（折叠跳过的行不出现在结果里，深度也不再等于列号）。
   *
   * 封顶（`parentCol === col`）时不加这根脊线：父子同列，本行自己的连接段（视图里的 capped 段）
   * 已经承接了上方来线，再加一根同 x 的贯通线只是重复。
   */
  const walk = (
    siblings: readonly CommentNode[],
    parentCol: number,
    activeSpines: ReadonlySet<number>,
    depth: number,
  ): void => {
    siblings.forEach((child, idx) => {
      const isLast = idx === siblings.length - 1;
      const col = Math.min(depth, MAX_VISUAL_DEPTH);
      // 祖先脊线里只有比自己浅的列才有贯穿意义：同列或更深的列画到本行只会多出一根线。
      const spines = new Set([...activeSpines].filter((ancestor) => ancestor < col));
      if (!isLast && parentCol < col) spines.add(parentCol);
      push(child, depth, col, parentCol, [...spines].sort((a, b) => a - b));
      if (collapsed.has(child.comment.id)) return;
      const nextSpines = new Set(activeSpines);
      // 注意加的是**父列**：本行不是末位，父列要在本行的子代里继续贯通。
      if (!isLast) nextSpines.add(parentCol);
      walk(child.children, col, nextSpines, depth + 1);
    });
  };

  push(root, 0, 0, 0, []);
  if (!collapsed.has(root.comment.id)) walk(root.children, 0, new Set(), 1);
  return rows;
}

/** 可见行数超过它就切紧凑模式：只留作者与回复关系，正文留给悬浮层与选中详情。 */
export const COMPACT_ROW_THRESHOLD = 60;

/** 树内所有可折叠节点 id（含根），用于「折叠全部」。 */
export function collapsibleIds(root: CommentNode): string[] {
  const ids: string[] = [];

  const walk = (node: CommentNode): void => {
    if (node.children.length) ids.push(node.comment.id);
    for (const child of node.children) walk(child);
  };

  walk(root);
  return ids;
}

/**
 * 每次追加渲染的行数。页面替换阅读器不做窗口化（行高由正文自然撑开，截断长正文是不可接受的），
 * 因此大树靠「分批渲染 + 折叠」限流：可见行再多也只铺开已读到的那一段，DOM 行数始终受此约束。
 */
export const ROW_PAGE_SIZE = 100;

/**
 * 下一批要渲染的行数：至少推进一批，最多到总数（展开某条评论后用它把新露出的行铺出来）。
 *
 * **只增不减**：`cap` 已经不小于总数时原样返回，绝不「收回到总数」。这不是洁癖——
 * `listRows = rows.slice(0, cap)`，上限一缩，已经渲染出来的尾部行就被移出 DOM：内容高度回落
 * （观感是行凭空消失 + 底下留一块空白，因为槽位高度只增不减），用户之前铺开的窗口白铺。
 * 折叠让总数临时变小、再展开时，收缩过的上限就会立刻咬人（ADR-0003 的「已渲染行上限只增不减」）。
 */
export function nextRowCap(cap: number, total: number): number {
  if (cap >= total) return cap;
  return Math.min(total, cap + ROW_PAGE_SIZE);
}
