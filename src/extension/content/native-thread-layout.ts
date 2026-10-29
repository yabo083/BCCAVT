/**
 * 多级回复的「父先子后」布局内核：**纯逻辑，不碰 DOM**。
 *
 * 输入只有关系（每条回复的 id 与结构父 id），输出是视觉前序下标、层级、折叠隐藏标记、孤立标记与
 * 已加载后代数。原生页面适配（写入 CSS 变量 / 折叠控件）与将来从平台 API 归一化出来的评论模型
 * 都能用同一份算法——层级构造、剪环、迭代遍历都在这里，只有「数据从哪来、结果写到哪去」不同。
 *
 * 语义（与原生增强的契约一致）：
 *   - `parentId === null`（平台给 0 / 字段缺失）、父不在**已加载**列表里、父链成环被剪断，
 *     三种情况都算「父不在已加载列表里」：该条显示在当前顶层，`orphan` 为真，调用方据此就地说明，
 *     绝不假称它属于某条分支。
 *   - 同层保持输入顺序（原生页面就是 DOM 顺序），不重排兄弟，也不按时间猜。
 *   - 前序用显式栈迭代（无递归），层级封顶到 {@link MAX_THREAD_DEPTH}，任意深/任意宽的链都安全。
 *   - 折叠只影响后代：祖先折叠与自身折叠叠加，展开祖先时自身折叠状态照旧生效。
 *   - id 一律按字符串比较（B 站 rpid 可能超过 2^53，转数字会丢精度并把两条评论并成一条）。
 */
export interface ThreadRelation {
  /** 评论 id（B 站 rpid）。 */
  id: string;
  /** 结构父 id；`null` = 未知 / 平台给 0。 */
  parentId: string | null;
}

export interface ThreadLayoutEntry {
  id: string;
  parentId: string | null;
  /** 视觉前序下标：数组下标即视觉顺序（父先子后）。 */
  order: number;
  /** 容器里的层级（0 = 顶层），已封顶到 {@link MAX_THREAD_DEPTH}。 */
  depth: number;
  /** 有祖先（含线程根评论）已折叠：这条该隐藏。 */
  hidden: boolean;
  /** 父不在已加载列表里（或父链成环被剪断）：显示在当前顶层并说明。 */
  orphan: boolean;
  /** 已加载后代数（不含自己）。 */
  descendantCount: number;
}

/**
 * 层级封顶：再深的父链最多缩进到这里（缩进步长在样式表里，窄屏另有更小的一档）。
 * 这里封顶后，样式表里还会再 `min()` clamp 一次兜底。
 */
export const MAX_THREAD_DEPTH = 5;

interface InternalNode {
  id: string;
  parentId: string | null;
  index: number;
  children: number[];
}

/**
 * 算出线程内「父先子后」的视觉前序。
 *
 * @param relations 线程内**已加载**的回复关系；同层顺序即传入顺序（原生页面传 DOM 顺序）。
 *   重复 id 只认第一条（原生增强在更早一步就整容器跳过，这里是给复用方的边界保护）。
 * @param rootId 线程根评论 id（`parentId` 等于它的条目就是容器顶层）。
 * @param collapsed 已折叠的评论 id 集合；`rootId` 在其中表示线程根评论被折叠（隐藏全部已加载回复）。
 */
export function layoutThread(
  relations: readonly ThreadRelation[],
  rootId: string,
  collapsed: ReadonlySet<string>,
): ThreadLayoutEntry[] {
  const nodes: InternalNode[] = [];
  const indexById = new Map<string, number>();
  for (const relation of relations) {
    if (indexById.has(relation.id)) continue;
    indexById.set(relation.id, nodes.length);
    nodes.push({ id: relation.id, parentId: relation.parentId, index: nodes.length, children: [] });
  }

  // 剪环：沿已加载父链上溯，回到本次链上的节点就剪断那个节点的父边（脏数据里的环只影响环上那几条）。
  // 每条链判定一次并记住结果，整趟线性；链一定终止在「无父 / 已判定节点 / 被剪断的边」上，所以没有环。
  const cut = new Set<number>();
  const settled = new Set<number>();
  for (const node of nodes) {
    if (settled.has(node.index)) continue;
    const path: number[] = [];
    const onPath = new Set<number>();
    let cursor: number | null = node.index;
    while (cursor !== null && !settled.has(cursor)) {
      if (onPath.has(cursor)) {
        cut.add(cursor);
        break;
      }
      onPath.add(cursor);
      path.push(cursor);
      const current: InternalNode | undefined = nodes[cursor];
      cursor = current === undefined || current.parentId === null ? null : (indexById.get(current.parentId) ?? null);
    }
    for (const index of path) settled.add(index);
  }

  const topLevel: number[] = [];
  const parentOf = new Map<number, number>();
  for (const node of nodes) {
    const parentIndex = node.parentId === null ? null : (indexById.get(node.parentId) ?? null);
    // 父是线程根评论、父不在已加载列表里、或这条自己的父边被剪断 → 容器顶层
    if (parentIndex === null || node.parentId === rootId || cut.has(node.index)) {
      topLevel.push(node.index);
      continue;
    }
    parentOf.set(node.index, parentIndex);
    const parent = nodes[parentIndex];
    if (parent !== undefined) parent.children.push(node.index);
  }

  // 前序：显式栈迭代（无递归），层级同步封顶
  const entries: ThreadLayoutEntry[] = [];
  const entryByIndex = new Map<number, ThreadLayoutEntry>();
  const preorderIndices: number[] = [];
  const rootCollapsed = collapsed.has(rootId);
  const stack: { index: number; depth: number; hidden: boolean }[] = [];
  for (let position = topLevel.length - 1; position >= 0; position -= 1) {
    const index = topLevel[position];
    if (index !== undefined) stack.push({ index, depth: 0, hidden: rootCollapsed });
  }
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) continue;
    const node = nodes[frame.index];
    if (node === undefined) continue;
    const entry: ThreadLayoutEntry = {
      id: node.id,
      parentId: node.parentId,
      order: entries.length,
      depth: Math.min(frame.depth, MAX_THREAD_DEPTH),
      hidden: frame.hidden,
      // 没有挂到已加载父上的顶层条目（父未知 / 平台给 0 / 父链成环被剪断）才标孤立
      orphan: !parentOf.has(frame.index) && node.parentId !== rootId,
      descendantCount: 0,
    };
    entries.push(entry);
    entryByIndex.set(frame.index, entry);
    preorderIndices.push(frame.index);
    // 自己折叠只影响后代；祖先折叠与自己的折叠叠加（展开祖先后自身折叠照旧生效）
    const blocked = frame.hidden || collapsed.has(node.id);
    for (let position = node.children.length - 1; position >= 0; position -= 1) {
      const child = node.children[position];
      if (child !== undefined) stack.push({ index: child, depth: frame.depth + 1, hidden: blocked });
    }
  }

  // 已加载后代数：前序逆序累加（前序里子节点一定排在父节点之后）
  for (let position = preorderIndices.length - 1; position >= 0; position -= 1) {
    const index = preorderIndices[position];
    const entry = entries[position];
    if (index === undefined || entry === undefined) continue;
    const parentIndex = parentOf.get(index);
    if (parentIndex === undefined) continue;
    const parentEntry = entryByIndex.get(parentIndex);
    if (parentEntry !== undefined) parentEntry.descendantCount += entry.descendantCount + 1;
  }

  return entries;
}
