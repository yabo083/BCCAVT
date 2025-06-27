export interface CommentData {
  评论ID: number;
  用户名: string;
  评论内容: string;
  点赞数: number;
  回复时间: string;
  父评论ID: number;
  replies: CommentData[];
}

export interface GraphNode {
  id: string;
  name: string;
  content: string;
  likes: number;
  time: number;
  degree: number;
  root: boolean;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  value: number;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface CommentStats {
  totalComments: number;
  totalUsers: number;
  averageCommentLength: number;
  totalLikes: number;
  averageLikes: number;
  replyRate: number;
  earliestComment: number;
  latestComment: number;
  commentPeriod: number;
}

export interface ClusterData {
  radial: {
    centers: GraphNode[];
    children: Map<string, GraphNode[]>;
    links: GraphLink[];
  } | null;
  linear: {
    chains: {
      nodes: GraphNode[];
      links: GraphLink[];
    }[];
  } | null;
  isolated: {
    nodes: GraphNode[];
    links: GraphLink[];
  } | null;
}

export interface RankingData {
  radial: {
    node: GraphNode;
    childCount: number;
  }[];
  linear: {
    nodes: GraphNode[];
    length: number;
  }[];
  isolated: GraphNode[];
}
