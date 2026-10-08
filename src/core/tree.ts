import type { Comment } from './model';
import type { CommentNode, Forest } from './report';

/**
 * 把扁平评论列表搭成森林。全程迭代（无递归），支持任意深的回复链。
 * - 按 parentId 挂载；父评论缺失（被删 / 未抓到）时退回到 rootId，仍缺失则挂到森林根，计入 orphans。
 * - parentId 指向自身或形成环的节点同样退化为挂在根下，保证一定有输出。
 * - 兄弟节点按 createdAt 升序、再按 id 升序，保证渲染顺序稳定。
 */
export function buildForest(comments: Comment[]): Forest {
  const nodes = new Map<string, CommentNode>();
  for (const comment of comments) {
    if (!nodes.has(comment.id)) {
      nodes.set(comment.id, { comment, children: [], parent: null, depth: 0, size: 1 });
    }
  }

  let orphans = 0;
  const parentOf = new Map<CommentNode, CommentNode>();
  const rootNodes: CommentNode[] = [];

  for (const node of nodes.values()) {
    const { rootId, parentId } = node.comment;
    if (rootId === null) {
      rootNodes.push(node);
      continue;
    }
    const direct = parentId !== null ? nodes.get(parentId) : undefined;
    const parent = direct ?? nodes.get(rootId);
    // 父评论缺失，或父指针指向自身 / 造成无根环 → 退化挂到森林根。
    if (parent === undefined || parent === node || parentOf.get(parent) === node) {
      rootNodes.push(node);
      orphans++;
      continue;
    }
    // 父评论被删 / 未抓到，退回根评论挂载，同样算孤儿。
    if (direct === undefined) orphans++;
    parentOf.set(node, parent);
    parent.children.push(node);
  }

  // 环检测：从根出发不可达的节点（只可能处于环里）全部提升为根，避免数据丢失。
  const reachable = new Set<CommentNode>();
  const walk: CommentNode[] = [...rootNodes];
  while (walk.length > 0) {
    const node = walk.pop()!;
    if (reachable.has(node)) continue;
    reachable.add(node);
    for (const child of node.children) walk.push(child);
  }
  if (reachable.size < nodes.size) {
    for (const node of nodes.values()) {
      if (reachable.has(node)) continue;
      const parent = parentOf.get(node);
      if (parent !== undefined) {
        parentOf.delete(node);
        const index = parent.children.indexOf(node);
        if (index >= 0) parent.children.splice(index, 1);
      }
      rootNodes.push(node);
      orphans++;
    }
  }

  // 迭代遍历：确定 parent / depth，并得到「父先于子」的顺序。
  const order: CommentNode[] = [];
  const stack: CommentNode[] = [];
  for (let i = rootNodes.length - 1; i >= 0; i--) stack.push(rootNodes[i]!);
  while (stack.length > 0) {
    const node = stack.pop()!;
    node.children.sort(
      (a, b) => a.comment.createdAt - b.comment.createdAt || (a.comment.id < b.comment.id ? -1 : a.comment.id > b.comment.id ? 1 : 0),
    );
    const parent = parentOf.get(node) ?? null;
    node.parent = parent;
    node.depth = parent === null ? 0 : parent.depth + 1;
    order.push(node);
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]!);
  }

  // 逆序累加子树大小（order 中父先于子）。
  for (let i = order.length - 1; i >= 0; i--) {
    const node = order[i]!;
    let size = 1;
    for (const child of node.children) size += child.size;
    node.size = size;
  }

  return { roots: rootNodes.sort((a, b) => a.comment.createdAt - b.comment.createdAt || (a.comment.id < b.comment.id ? -1 : 1)), byId: nodes, orphans };
}
