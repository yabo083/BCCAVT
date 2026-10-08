import { describe, expect, it } from 'vitest';
import { flattenForest, searchComments } from '@/ui/explore';
import type { ExploreQuery } from '@/ui/explore';
import type { Comment } from '@/core/model';
import type { CommentNode, Forest } from '@/core/report';

interface Spec {
  id: string;
  text?: string;
  author?: string;
  likes?: number;
  createdAt?: number;
  children?: Spec[];
}

function buildForest(specs: Spec[]): Forest {
  const byId = new Map<string, CommentNode>();

  const build = (spec: Spec, parent: CommentNode | null): CommentNode => {
    const comment: Comment = {
      id: spec.id,
      rootId: parent ? (parent.comment.rootId ?? parent.comment.id) : null,
      parentId: parent?.comment.id ?? null,
      author: { id: `u-${spec.author ?? spec.id}`, name: spec.author ?? `user${spec.id}` },
      text: spec.text ?? `正文 ${spec.id}`,
      createdAt: spec.createdAt ?? 1_700_000_000_000,
      likes: spec.likes ?? 0,
      replyCount: spec.children?.length ?? 0,
    };
    const node: CommentNode = {
      comment,
      children: [],
      parent,
      depth: parent ? parent.depth + 1 : 0,
      size: 1,
    };
    byId.set(comment.id, node);
    for (const child of spec.children ?? []) node.children.push(build(child, node));
    node.size = 1 + node.children.reduce((sum, child) => sum + child.size, 0);
    return node;
  };

  const roots = specs.map((spec) => build(spec, null));
  return { roots, byId, orphans: 0 };
}

const forest = buildForest([
  {
    id: 'a',
    text: '这个视频太棒了',
    author: '小明',
    likes: 5,
    createdAt: 100,
    children: [
      { id: 'a1', text: '同意，BGM 很好听', author: '小红', likes: 50, createdAt: 300 },
      { id: 'a2', text: '一般般', author: '小刚', likes: 10, createdAt: 200, children: [
        { id: 'a2a', text: '为什么这么说', author: '小红', likes: 1, createdAt: 400 },
      ] },
    ],
  },
  { id: 'b', text: 'UP 主加油', author: '小明', likes: 50, createdAt: 500 },
]);

const query = (patch: Partial<ExploreQuery>): ExploreQuery => ({ text: '', sort: 'likes', depth: 'all', ...patch });

describe('flattenForest', () => {
  it('按深度优先展平，深度、子树规模与所属根都正确', () => {
    const items = flattenForest(forest);
    expect(items.map((item) => item.comment.id)).toEqual(['a', 'a1', 'a2', 'a2a', 'b']);
    expect(items.map((item) => item.depth)).toEqual([0, 1, 1, 2, 0]);
    expect(items.map((item) => item.replies)).toEqual([3, 0, 1, 0, 0]);
    expect(items.map((item) => item.rootId)).toEqual(['a', 'a', 'a', 'a', 'b']);
  });

  it('空森林返回空数组', () => {
    expect(flattenForest({ roots: [], byId: new Map(), orphans: 0 })).toEqual([]);
  });
});

describe('searchComments', () => {
  const items = flattenForest(forest);

  it('按正文子串搜索，忽略大小写', () => {
    const hits = searchComments(items, query({ text: 'BGM' }));
    expect(hits.map((item) => item.comment.id)).toEqual(['a1']);
  });

  it('按作者名搜索', () => {
    const hits = searchComments(items, query({ text: '小红', sort: 'time' }));
    expect(hits.map((item) => item.comment.id)).toEqual(['a2a', 'a1']);
  });

  it('按点赞排序并保持确定性（同分回退到时间，新的在前）', () => {
    const hits = searchComments(items, query({ sort: 'likes' }));
    expect(hits.map((item) => item.comment.id)).toEqual(['b', 'a1', 'a2', 'a', 'a2a']);
  });

  it('按时间排序为新到旧', () => {
    const hits = searchComments(items, query({ sort: 'time' }));
    expect(hits.map((item) => item.comment.id)).toEqual(['b', 'a2a', 'a1', 'a2', 'a']);
  });

  it('按回复数排序', () => {
    const hits = searchComments(items, query({ sort: 'replies' }));
    expect(hits.map((item) => item.comment.id)).toEqual(['a', 'a2', 'a1', 'b', 'a2a']);
  });

  it('深度过滤：仅顶层 / 仅回复 / 深度 ≥ 2', () => {
    expect(searchComments(items, query({ depth: 'roots' })).map((i) => i.comment.id)).toEqual(['b', 'a']);
    expect(searchComments(items, query({ depth: 'replies', sort: 'time' })).map((i) => i.comment.id)).toEqual([
      'a2a',
      'a1',
      'a2',
    ]);
    expect(searchComments(items, query({ depth: 'deep' })).map((i) => i.comment.id)).toEqual(['a2a']);
  });

  it('不修改传入数组的顺序', () => {
    const before = items.map((item) => item.comment.id);
    searchComments(items, query({ sort: 'replies' }));
    expect(items.map((item) => item.comment.id)).toEqual(before);
  });

  it('无匹配返回空数组', () => {
    expect(searchComments(items, query({ text: '不存在的词' }))).toEqual([]);
  });
});
