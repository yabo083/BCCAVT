/** 评论探索列表的纯逻辑：展平森林、搜索、排序、深度过滤。 */
import type { Comment } from '@/core/model';
import type { CommentNode, Forest } from '@/core/report';

export interface CommentListItem {
  comment: Comment;
  /** 顶层评论为 0。 */
  depth: number;
  /** 该评论之下整棵子树的回复数。 */
  replies: number;
  /** 所在评论树的根评论 id；顶层评论即自身。 */
  rootId: string;
}

export type SortKey = 'likes' | 'time' | 'replies';

export type DepthFilter = 'all' | 'roots' | 'replies' | 'deep';

export interface ExploreQuery {
  text: string;
  sort: SortKey;
  depth: DepthFilter;
}

export const DEFAULT_EXPLORE_QUERY: ExploreQuery = { text: '', sort: 'likes', depth: 'all' };

/** 按评论树顺序（深度优先）展平；深度取自节点，避免重算父子关系。 */
export function flattenForest(forest: Forest): CommentListItem[] {
  const items: CommentListItem[] = [];
  const walk = (node: CommentNode, rootId: string): void => {
    items.push({ comment: node.comment, depth: node.depth, replies: node.size - 1, rootId });
    for (const child of node.children) walk(child, rootId);
  };
  for (const root of forest.roots) walk(root, root.comment.id);
  return items;
}

const SORTERS: Record<SortKey, (a: CommentListItem, b: CommentListItem) => number> = {
  likes: (a, b) => b.comment.likes - a.comment.likes || b.comment.createdAt - a.comment.createdAt,
  time: (a, b) => b.comment.createdAt - a.comment.createdAt,
  replies: (a, b) => b.replies - a.replies || b.comment.likes - a.comment.likes,
};

const DEPTH_MATCH: Record<DepthFilter, (depth: number) => boolean> = {
  all: () => true,
  roots: (depth) => depth === 0,
  replies: (depth) => depth >= 1,
  deep: (depth) => depth >= 2,
};

export function searchComments(items: readonly CommentListItem[], query: ExploreQuery): CommentListItem[] {
  const needle = query.text.trim().toLowerCase();
  const matchesDepth = DEPTH_MATCH[query.depth];
  return items
    .filter((item) => {
      if (!matchesDepth(item.depth)) return false;
      if (!needle) return true;
      return (
        item.comment.text.toLowerCase().includes(needle) || item.comment.author.name.toLowerCase().includes(needle)
      );
    })
    .sort(SORTERS[query.sort]);
}
