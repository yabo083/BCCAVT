import { describe, expect, it } from 'vitest';
import {
  MAX_FIT_SCALE,
  MAX_NODE_RADIUS,
  MIN_FIT_SCALE,
  MIN_NODE_RADIUS,
  buildGraph,
  fitTransform,
  highlightOf,
  nodeRadius,
  pickNode,
  radarPing,
  seedPositions,
} from '@/ui/force-graph';
import type { Graph } from '@/ui/force-graph';
import type { Comment } from '@/core/model';
import type { CommentNode, Forest } from '@/core/report';

interface Spec {
  id: string;
  likes?: number;
  children?: Spec[];
}

function buildNode(spec: Spec, parent: CommentNode | null): CommentNode {
  const comment: Comment = {
    id: spec.id,
    rootId: parent ? parent.comment.rootId ?? parent.comment.id : null,
    parentId: parent?.comment.id ?? null,
    author: { id: `u-${spec.id}`, name: `user${spec.id}` },
    text: `正文 ${spec.id}`,
    createdAt: 1_700_000_000_000,
    likes: spec.likes ?? 0,
    replyCount: spec.children?.length ?? 0,
  };
  const node: CommentNode = { comment, children: [], parent, depth: parent ? parent.depth + 1 : 0, size: 1 };
  for (const child of spec.children ?? []) node.children.push(buildNode(child, node));
  node.size = 1 + node.children.reduce((sum, child) => sum + child.size, 0);
  return node;
}

function forestOf(specs: Spec[]): Forest {
  const roots = specs.map((spec) => buildNode(spec, null));
  const byId = new Map<string, CommentNode>();
  const walk = (node: CommentNode): void => {
    byId.set(node.comment.id, node);
    for (const child of node.children) walk(child);
  };
  for (const root of roots) walk(root);
  return { roots, byId, orphans: 0 };
}

/** a ├─ b ── d
 *    └─ c      */
const tree = forestOf([{ id: 'a', likes: 10, children: [{ id: 'b', likes: 2, children: [{ id: 'd', likes: 100 }] }, { id: 'c' }] }]);

const ids = (graph: Graph): string[] => graph.nodes.map((node) => node.id);
const positions = (graph: Graph): string[] =>
  graph.nodes.map((node) => `${node.id}:${node.x.toFixed(3)},${node.y.toFixed(3)}`);
const coords = (graph: Graph): string[] => graph.nodes.map((node) => `${node.x.toFixed(3)},${node.y.toFixed(3)}`);

describe('buildGraph', () => {
  it('节点 = 评论、边 = 真实父子关系，且父先于子（前序）', () => {
    const graph = buildGraph(tree);
    expect(ids(graph)).toEqual(['a', 'b', 'd', 'c']);
    expect(graph.links.map((link) => `${link.fromId}>${link.toId}`)).toEqual(['a>b', 'b>d', 'a>c']);
    expect(graph.nodes.map((node) => node.level)).toEqual([0, 1, 2, 1]);
    expect(graph.nodes.map((node) => node.parentId)).toEqual([null, 'a', 'b', 'a']);
    expect(graph.primaryRootId).toBe('a');
    expect(graph.roots.map((root) => root.id)).toEqual(['a']);
  });

  it('指定 rootId 时只画这棵子树，层级从它重新起算', () => {
    const graph = buildGraph(tree, 'b');
    expect(ids(graph)).toEqual(['b', 'd']);
    expect(graph.nodes.map((node) => node.level)).toEqual([0, 1]);
    expect(graph.nodes.map((node) => node.parentId)).toEqual([null, 'b']);
    expect(graph.primaryRootId).toBe('b');
  });

  it('rootId 不存在时退化为整片森林，不抛错', () => {
    expect(ids(buildGraph(tree, '不存在'))).toEqual(['a', 'b', 'd', 'c']);
  });

  it('整片评论区：钉住的根取子树最大的那个', () => {
    const forest = forestOf([{ id: 'small', children: [{ id: 's1' }] }, { id: 'big', children: [{ id: 'b1' }, { id: 'b2', children: [{ id: 'b3' }] }] }]);
    const graph = buildGraph(forest);
    expect(graph.primaryRootId).toBe('big');
    expect(graph.roots.map((root) => root.id)).toEqual(['small', 'big']);
    // 多个根不能都堆在原点
    const small = graph.byId.get('small')!;
    const big = graph.byId.get('big')!;
    expect(Math.hypot(small.x - big.x, small.y - big.y)).toBeGreaterThan(1);
  });

  it('子树规模与点赞数都进半径，但有界', () => {
    const graph = buildGraph(tree);
    const a = graph.byId.get('a')!;
    const d = graph.byId.get('d')!;
    expect(a.radius).toBe(nodeRadius(a.size, a.likes));
    expect(d.radius).toBeGreaterThan(graph.byId.get('c')!.radius);
    expect(a.radius).toBeGreaterThanOrEqual(MIN_NODE_RADIUS);
    expect(d.radius).toBeLessThanOrEqual(MAX_NODE_RADIUS);
  });

  it('邻接表同时记录父与子，供悬停高亮用', () => {
    const graph = buildGraph(tree);
    expect(graph.neighbors.get('b')!.map((node) => node.id).sort()).toEqual(['a', 'd']);
    expect(graph.neighbors.get('a')!.map((node) => node.id).sort()).toEqual(['b', 'c']);
    expect(graph.childrenOf.get('a')!.map((node) => node.id)).toEqual(['b', 'c']);
  });
});

describe('seedPositions', () => {
  it('确定性：同样的树两次播种得到同样坐标', () => {
    expect(positions(buildGraph(tree))).toEqual(positions(buildGraph(tree)));
  });

  it('径向铺开：根在原点，子节点逐层向外，且没有两点重合', () => {
    const graph = buildGraph(tree);
    const root = graph.byId.get('a')!;
    expect(Math.hypot(root.x, root.y)).toBeCloseTo(0, 6);
    expect(Math.hypot(graph.byId.get('b')!.x, graph.byId.get('b')!.y)).toBeGreaterThan(0);
    expect(Math.hypot(graph.byId.get('d')!.x, graph.byId.get('d')!.y)).toBeGreaterThan(
      Math.hypot(graph.byId.get('b')!.x, graph.byId.get('b')!.y),
    );
    expect(new Set(coords(graph)).size).toBe(graph.nodes.length);
  });

  it('重复播种（例如重新适配视图前）不改变结果', () => {
    const graph = buildGraph(tree);
    const before = positions(graph);
    seedPositions(graph);
    expect(positions(graph)).toEqual(before);
  });
});

describe('nodeRadius', () => {
  it('有界且对规模、点赞单调不减', () => {
    expect(nodeRadius(1, 0)).toBe(MIN_NODE_RADIUS);
    expect(nodeRadius(1, 0)).toBeLessThanOrEqual(nodeRadius(20, 0));
    expect(nodeRadius(20, 0)).toBeLessThanOrEqual(nodeRadius(2000, 0));
    expect(nodeRadius(20, 0)).toBeLessThanOrEqual(nodeRadius(20, 50));
    expect(nodeRadius(2000, 100000)).toBe(MAX_NODE_RADIUS);
  });

  it('异常输入不产生 NaN / 负半径', () => {
    expect(nodeRadius(0, -5)).toBe(MIN_NODE_RADIUS);
    expect(nodeRadius(Number.NaN, Number.NaN)).toBe(MIN_NODE_RADIUS);
  });
});

describe('highlightOf', () => {
  it('祖先链 + 直接邻居 + 相连的边', () => {
    const graph = buildGraph(tree);
    const highlight = highlightOf(graph, 'b')!;
    expect([...highlight.path].sort()).toEqual(['a', 'b']);
    expect([...highlight.neighbors].sort()).toEqual(['a', 'd']);
    expect([...highlight.links].map((link) => `${link.fromId}>${link.toId}`).sort()).toEqual(['a>b', 'b>d']);
  });

  it('叶子节点的邻居只有父，路径包含整条祖先链', () => {
    const graph = buildGraph(tree);
    const highlight = highlightOf(graph, 'd')!;
    expect([...highlight.path].sort()).toEqual(['a', 'b', 'd']);
    expect([...highlight.neighbors]).toEqual(['b']);
  });

  it('子树模式下路径止于可视根，不会牵出图外的祖先', () => {
    const graph = buildGraph(tree, 'b');
    expect([...highlightOf(graph, 'd')!.path].sort()).toEqual(['b', 'd']);
  });

  it('未知 id 返回 null', () => {
    expect(highlightOf(buildGraph(tree), '不存在')).toBeNull();
  });
});

describe('fitTransform', () => {
  it('把整张图框进视口（含节点半径），不留 100% 的小图', () => {
    const graph = buildGraph(tree);
    const transform = fitTransform(graph, 600, 400);
    expect(transform.k).toBeGreaterThan(MIN_FIT_SCALE);
    expect(transform.k).toBeLessThanOrEqual(MAX_FIT_SCALE);
    for (const node of graph.nodes) {
      const x = transform.x + transform.k * node.x;
      const y = transform.y + transform.k * node.y;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(600);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(400);
    }
  });

  it('单节点也放大到看得见，而不是缩成 0', () => {
    const graph = buildGraph(forestOf([{ id: 'solo' }]));
    const transform = fitTransform(graph, 600, 400);
    expect(transform.k).toBe(MAX_FIT_SCALE);
    expect(transform.x).toBeCloseTo(300, 6);
    expect(transform.y).toBeCloseTo(200, 6);
  });

  it('空图不炸', () => {
    const transform = fitTransform(buildGraph(forestOf([])), 600, 400);
    expect(transform).toEqual({ k: 1, x: 300, y: 200 });
  });
});

describe('pickNode', () => {
  it('命中节点自身的屏幕坐标，远处返回 null', () => {
    const graph = buildGraph(tree);
    const transform = { k: 1, x: 0, y: 0 };
    const b = graph.byId.get('b')!;
    expect(pickNode(graph, transform, b.x, b.y)?.id).toBe('b');
    expect(pickNode(graph, transform, b.x + 5000, b.y + 5000)).toBeNull();
  });

  it('缩放后仍按屏幕位置命中', () => {
    const graph = buildGraph(tree);
    const transform = fitTransform(graph, 600, 400);
    const d = graph.byId.get('d')!;
    const x = transform.x + transform.k * d.x;
    const y = transform.y + transform.k * d.y;
    expect(pickNode(graph, transform, x, y)?.id).toBe('d');
  });

  it('重叠时取后画的（子节点在父节点之上）', () => {
    const graph = buildGraph(tree);
    const b = graph.byId.get('b')!;
    const d = graph.byId.get('d')!;
    d.x = b.x;
    d.y = b.y;
    expect(pickNode(graph, { k: 1, x: 0, y: 0 }, b.x, b.y)?.id).toBe('d');
  });
});

describe('radarPing', () => {
  it('相位 0 是起始态：scale 0.95、alpha 1、未播完', () => {
    expect(radarPing(0)).toEqual({ scale: 0.95, alpha: 1, done: false });
  });

  it('接近周期末：scale 趋近 1.75、alpha 趋近 0', () => {
    const end = radarPing(1400 - 0.001);
    expect(end.scale).toBeCloseTo(1.75, 3);
    expect(end.alpha).toBeCloseTo(0, 3);
    expect(end.done).toBe(false);
  });

  it('两个周期各自 scale 单调升、alpha 单调降，且都没播完', () => {
    for (const base of [0, 1400]) {
      let lastScale = -Infinity;
      let lastAlpha = Infinity;
      for (let ms = 0; ms < 1400; ms += 50) {
        const { scale, alpha, done } = radarPing(base + ms);
        expect(scale).toBeGreaterThan(lastScale);
        expect(alpha).toBeLessThan(lastAlpha);
        expect(done).toBe(false);
        lastScale = scale;
        lastAlpha = alpha;
      }
    }
  });

  it('第二个周期按同一相位重放：闪两下而不是一下', () => {
    for (let ms = 0; ms < 1400; ms += 50) {
      expect(radarPing(1400 + ms)).toEqual(radarPing(ms));
    }
  });

  it('播满两下即进入结束态：不再回绕、alpha 归 0', () => {
    const done = { scale: 1.75, alpha: 0, done: true };
    expect(radarPing(1400 * 2)).toEqual(done);
    expect(radarPing(1400 * 2 + 1)).toEqual(done);
    expect(radarPing(1400 * 7 + 350)).toEqual(done);
  });

  it('默认周期 1400ms：中点恰好是一半进度', () => {
    const mid = radarPing(700);
    expect(mid.scale).toBeCloseTo(1.35, 6);
    expect(mid.alpha).toBeCloseTo(0.5, 6);
  });

  it('可指定周期与次数：到 cycles * cycleMs 才结束', () => {
    const options = { cycleMs: 500, cycles: 3 };
    expect(radarPing(1250, options)).toEqual({ scale: 1.35, alpha: 0.5, done: false });
    expect(radarPing(1499, options).done).toBe(false);
    expect(radarPing(1500, options)).toEqual({ scale: 1.75, alpha: 0, done: true });
  });

  it('cycles 非正或非有限：没有可播的脉冲，直接给结束态', () => {
    const done = { scale: 0.95, alpha: 0, done: true };
    expect(radarPing(0, { cycles: 0 })).toEqual(done);
    expect(radarPing(500, { cycles: -2 })).toEqual(done);
    expect(radarPing(500, { cycles: Number.NaN })).toEqual(done);
    expect(radarPing(500, { cycles: Number.POSITIVE_INFINITY })).toEqual(done);
  });

  it('非法 elapsed / cycleMs 安全退让到起始态，不产生 NaN', () => {
    const start = { scale: 0.95, alpha: 1, done: false };
    expect(radarPing(Number.NaN)).toEqual(start);
    expect(radarPing(Number.POSITIVE_INFINITY)).toEqual(start);
    expect(radarPing(Number.NEGATIVE_INFINITY)).toEqual(start);
    expect(radarPing(-1)).toEqual(start);
    expect(radarPing(500, { cycleMs: 0 })).toEqual(start);
    expect(radarPing(500, { cycleMs: -1400 })).toEqual(start);
    expect(radarPing(500, { cycleMs: Number.NaN })).toEqual(start);
  });

  it('极端输入下 scale/alpha 始终有限、done 始终是布尔', () => {
    for (const elapsed of [0, 1, 2799.9, 2800, 1e12, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      for (const options of [
        {},
        { cycleMs: 0 },
        { cycleMs: Number.NaN },
        { cycles: 0 },
        { cycles: Number.NaN },
        { cycles: 1e308 },
      ]) {
        const state = radarPing(elapsed, options);
        expect(Number.isFinite(state.scale)).toBe(true);
        expect(Number.isFinite(state.alpha)).toBe(true);
        expect(typeof state.done).toBe('boolean');
      }
    }
  });
});
