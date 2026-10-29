/**
 * 有向回复图的纯逻辑：建图（父 → 子有向边）、节点尺寸、径向初始播种、邻域高亮、命中测试与视图适配。
 * 视图（ForceGraph.vue）只负责 d3-force 仿真、绘制与交互；这里的函数不碰 DOM，可在 node 环境单测。
 */
import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force';
import type { CommentNode, Forest } from '@/core/report';

/** 节点半径区间：子树规模与点赞数各自贡献有界增量，避免少数热评把图撑爆。 */
export const MIN_NODE_RADIUS = 4;
export const MAX_NODE_RADIUS = 26;
/** 初始播种环距：每深一层向外推多远；多根时根节点之间的环距更大。 */
export const SEED_RING = 72;
export const SEED_ROOT_RING = 150;
/** 适配视图的缩放区间：大树不缩成一点，单节点也不放大到离谱。 */
export const MIN_FIT_SCALE = 0.02;
export const MAX_FIT_SCALE = 2.2;

/** 仿真节点：d3-force 就地写 x/y/vx/vy，所以建图后这份对象不再重建。 */
export interface GraphNode extends SimulationNodeDatum {
  id: string;
  /** 领域节点：正文、作者、全局深度、子树规模都在这里。 */
  node: CommentNode;
  parentId: string | null;
  /** 相对本次可视化的层级（根 = 0），与领域深度无关（子树根可以领域深度很大）。 */
  level: number;
  size: number;
  likes: number;
  radius: number;
  x: number;
  y: number;
}

/** 有向边：source 是父评论，target 是子评论（箭头即回复方向）。 */
export interface GraphLink extends SimulationLinkDatum<GraphNode> {
  source: GraphNode;
  target: GraphNode;
  fromId: string;
  toId: string;
}

export interface Graph {
  /** 前序（父先于子）：既是遍历顺序也是绘制顺序，子节点压在父节点上。 */
  nodes: GraphNode[];
  links: GraphLink[];
  byId: Map<string, GraphNode>;
  /** 可视化的顶层节点（单根时只有一个，整片评论区时是全部顶层评论）。 */
  roots: GraphNode[];
  /** 仿真的锚点根：子树最大的那个（并列取前序靠前者），建图时钉在它的播种位置上。 */
  primaryRootId: string | null;
  childrenOf: Map<string, GraphNode[]>;
  /** 无向邻接（父 + 子），悬停高亮用。 */
  neighbors: Map<string, GraphNode[]>;
}

export interface Transform {
  k: number;
  x: number;
  y: number;
}

export interface Highlight {
  id: string;
  /** 从可视根到该节点的祖先链（含自身）。 */
  path: Set<string>;
  /** 直接邻居：父 + 子。 */
  neighbors: Set<string>;
  /** 与高亮节点相连的边（对象引用，绘制时零分配）。 */
  links: Set<GraphLink>;
}

/** 有界尺寸：size 与 likes 的增量各自封顶，再整体夹在 [MIN, MAX] 内；非有限输入按 0 处理。 */
export function nodeRadius(size: number, likes: number): number {
  const safeSize = Number.isFinite(size) ? Math.max(0, size) : 0;
  const safeLikes = Number.isFinite(likes) ? Math.max(0, likes) : 0;
  const bySize = Math.min(12, Math.sqrt(Math.max(0, safeSize - 1)) * 2.2);
  const byLikes = Math.min(10, Math.sqrt(safeLikes) * 1.6);
  return Math.min(MAX_NODE_RADIUS, Math.max(MIN_NODE_RADIUS, MIN_NODE_RADIUS + bySize + byLikes));
}

/** 顶层节点：给了 rootId 且能命中就只画它这一棵子树，否则画整片森林。 */
function topNodes(forest: Forest, rootId: string | null | undefined): CommentNode[] {
  if (rootId) {
    const found = forest.byId.get(rootId);
    if (found) return [found];
  }
  return forest.roots;
}

function push(map: Map<string, GraphNode[]>, key: string, value: GraphNode): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** 建图：节点 = 评论，边 = 真实父子关系；返回时已完成径向初始播种。 */
export function buildGraph(forest: Forest, rootId?: string | null): Graph {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const byId = new Map<string, GraphNode>();
  const childrenOf = new Map<string, GraphNode[]>();
  const neighbors = new Map<string, GraphNode[]>();
  const roots: GraphNode[] = [];

  // 显式栈前序：父先出栈，子节点才拿得到父节点对象，边两端都能就地取到。
  const stack: { node: CommentNode; level: number; parent: GraphNode | null }[] = [];
  const tops = topNodes(forest, rootId);
  for (let i = tops.length - 1; i >= 0; i -= 1) {
    const top = tops[i];
    if (top) stack.push({ node: top, level: 0, parent: null });
  }

  while (stack.length > 0) {
    const frame = stack.pop()!;
    const id = frame.node.comment.id;
    if (byId.has(id)) continue; // 重复 id（父缺失时挂到根下）只取第一次

    const graphNode: GraphNode = {
      id,
      node: frame.node,
      parentId: frame.parent?.id ?? null,
      level: frame.level,
      size: frame.node.size,
      likes: frame.node.comment.likes,
      radius: nodeRadius(frame.node.size, frame.node.comment.likes),
      x: 0,
      y: 0,
    };
    nodes.push(graphNode);
    byId.set(id, graphNode);

    if (frame.parent) {
      links.push({ source: frame.parent, target: graphNode, fromId: frame.parent.id, toId: id });
      push(childrenOf, frame.parent.id, graphNode);
      push(neighbors, frame.parent.id, graphNode);
      push(neighbors, id, frame.parent);
    } else {
      roots.push(graphNode);
    }

    for (let i = frame.node.children.length - 1; i >= 0; i -= 1) {
      const child = frame.node.children[i];
      if (child) stack.push({ node: child, level: frame.level + 1, parent: graphNode });
    }
  }

  let primary: GraphNode | null = roots[0] ?? null;
  for (const root of roots) {
    if (primary && root.size > primary.size) primary = root;
  }

  const graph: Graph = {
    nodes,
    links,
    byId,
    roots,
    primaryRootId: primary?.id ?? null,
    childrenOf,
    neighbors,
  };
  seedPositions(graph);
  return graph;
}

/**
 * 径向初始播种：每个子树分到一段扇区、子节点在扇区内均分（单根居中、扇区铺满整圈），
 * 保证同层节点角度不重叠、逐层向外推进。确定性，不用随机数。
 */
export function seedPositions(graph: Graph): void {
  const roots = graph.roots;
  if (roots.length === 0) return;

  const slice = (Math.PI * 2) / roots.length;
  for (let i = 0; i < roots.length; i += 1) {
    const root = roots[i]!;
    const start = i * slice;
    const end = start + slice;
    if (roots.length === 1) {
      root.x = 0;
      root.y = 0;
    } else {
      const angle = (start + end) / 2;
      root.x = Math.cos(angle) * SEED_ROOT_RING;
      root.y = Math.sin(angle) * SEED_ROOT_RING;
    }
    seedSubtree(graph, root, start, end);
  }
}

/** 迭代（不用递归）把子树铺到逐层递增的环上：子节点均分父节点的扇区。 */
function seedSubtree(graph: Graph, root: GraphNode, start: number, end: number): void {
  const stack: { node: GraphNode; start: number; end: number }[] = [{ node: root, start, end }];

  while (stack.length > 0) {
    const frame = stack.pop()!;
    const children = graph.childrenOf.get(frame.node.id);
    if (!children || children.length === 0) continue;

    const span = frame.end - frame.start;
    const radius = Math.hypot(frame.node.x, frame.node.y) + SEED_RING;
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i]!;
      const childStart = frame.start + (span * i) / children.length;
      const childEnd = frame.start + (span * (i + 1)) / children.length;
      const angle = (childStart + childEnd) / 2;
      child.x = Math.cos(angle) * radius;
      child.y = Math.sin(angle) * radius;
      stack.push({ node: child, start: childStart, end: childEnd });
    }
  }
}

/** 悬停高亮：祖先链 + 直接邻居 + 相连的边。找不到 id 返回 null。 */
export function highlightOf(graph: Graph, id: string): Highlight | null {
  const target = graph.byId.get(id);
  if (!target) return null;

  const path = new Set<string>();
  for (let current: GraphNode | undefined = target; current; ) {
    path.add(current.id);
    current = current.parentId ? graph.byId.get(current.parentId) : undefined;
  }

  const neighbors = new Set<string>();
  for (const neighbor of graph.neighbors.get(id) ?? []) neighbors.add(neighbor.id);

  const links = new Set<GraphLink>();
  for (const link of graph.links) {
    if (link.fromId === id || link.toId === id) links.add(link);
  }

  return { id, path, neighbors, links };
}

/** 视图适配：按节点包围盒（含半径）算缩放与平移，让图填满视口而不是停在 100% 缩成一小团。 */
export function fitTransform(graph: Graph, width: number, height: number, padding = 28): Transform {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  if (graph.nodes.length === 0) return { k: 1, x: w / 2, y: h / 2 };

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const node of graph.nodes) {
    if (node.x - node.radius < minX) minX = node.x - node.radius;
    if (node.x + node.radius > maxX) maxX = node.x + node.radius;
    if (node.y - node.radius < minY) minY = node.y - node.radius;
    if (node.y + node.radius > maxY) maxY = node.y + node.radius;
  }

  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const usableW = Math.max(1, w - padding * 2);
  const usableH = Math.max(1, h - padding * 2);
  const k = Math.min(MAX_FIT_SCALE, Math.max(MIN_FIT_SCALE, Math.min(usableW / spanX, usableH / spanY)));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  return { k, x: w / 2 - k * centerX, y: h / 2 - k * centerY };
}

/** 命中测试：从后往前（子先于父）取第一个落在半径 + 容差内的节点，即视觉上最上层的那个。 */
export function pickNode(
  graph: Graph,
  transform: Transform,
  x: number,
  y: number,
  tolerance = 4,
): GraphNode | null {
  const { k, x: originX, y: originY } = transform;
  for (let i = graph.nodes.length - 1; i >= 0; i -= 1) {
    const node = graph.nodes[i]!;
    const dx = originX + k * node.x - x;
    const dy = originY + k * node.y - y;
    const reach = node.radius * k + tolerance;
    if (dx * dx + dy * dy <= reach * reach) return node;
  }
  return null;
}

/** 雷达波扩散周期（毫秒），与原型 CSS 动画 `radar-ping 1.4s` 对齐。 */
export const RADAR_PING_MS = 1400;
/** 扩散值域：起始/终止缩放逐字取自原型 keyframes 的 0.95 → 1.75。 */
export const RADAR_PING_START_SCALE = 0.95;
export const RADAR_PING_END_SCALE = 1.75;
/** 默认播放次数：原型是无限循环，这里按用户反馈收敛成「闪两下就停」。 */
export const RADAR_PING_CYCLES = 2;

/** 雷达波参数：周期毫秒与播放次数都可省（默认 RADAR_PING_MS / RADAR_PING_CYCLES）。 */
export interface RadarPingOptions {
  cycleMs?: number;
  cycles?: number;
}

/** 雷达波相位：一个周期内的扩散值 + 是否已播满。done 为 true 时调用方应停掉重绘循环。 */
export interface RadarPingState {
  scale: number;
  alpha: number;
  done: boolean;
}

/**
 * 雷达波相位：把已流逝毫秒映射到「有限次扩散」中的某一点，播满 cycles 个周期就停，不再回绕。
 * 前 cycles 个周期内每个周期各自 scale 从 0.95 单调升到 1.75、alpha 从 1 单调降到 0，与原型 radar-ping 的 0%→100% 对应；
 * 播满（elapsed >= cycles * cycleMs）即进入结束态 done === true、alpha 归 0。
 * 非法输入一律安全退让：非有限或负的 elapsed、非有限或非正的 cycleMs 退让到起始态（done 为 false）；
 * 非有限或非正的 cycles（含乘积溢出成非有限）视为没有可播的脉冲，直接给结束态。不抛错、不产生 NaN。
 */
export function radarPing(elapsedMs: number, options: RadarPingOptions = {}): RadarPingState {
  const cycles = options.cycles ?? RADAR_PING_CYCLES;
  if (!Number.isFinite(cycles) || cycles <= 0) return { scale: RADAR_PING_START_SCALE, alpha: 0, done: true };

  const cycleMs = options.cycleMs ?? RADAR_PING_MS;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || !Number.isFinite(cycleMs) || cycleMs <= 0) {
    return { scale: RADAR_PING_START_SCALE, alpha: 1, done: false };
  }

  const totalMs = cycles * cycleMs;
  if (!Number.isFinite(totalMs) || elapsedMs >= totalMs) {
    return { scale: RADAR_PING_END_SCALE, alpha: 0, done: true };
  }
  const phase = (elapsedMs % cycleMs) / cycleMs;
  return {
    scale: RADAR_PING_START_SCALE + (RADAR_PING_END_SCALE - RADAR_PING_START_SCALE) * phase,
    alpha: 1 - phase,
    done: false,
  };
}
