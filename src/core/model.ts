/**
 * 平台无关的评论领域模型。所有适配器把平台原始数据归一化为这里的类型；
 * 引擎、分析、可视化、AI 只认这些类型，不触碰任何平台原始字段。
 */

/** 已接入的平台。新增平台 = 在此并入一个字面量 + 实现一个 PlatformAdapter。 */
export type PlatformId = 'bilibili';

/** 被评论的主体引用（视频 / 动态 / 帖子）。可序列化，作为缓存键的一部分。 */
export interface SubjectRef {
  platform: PlatformId;
  /** 平台内主体类型，例如 bilibili 的 'video'。 */
  kind: string;
  /** 平台内稳定 id，例如 BV 号。 */
  id: string;
}

export interface Author {
  id: string;
  name: string;
  avatarUrl?: string;
  /** 平台等级（bilibili 0–6）。 */
  level?: number;
}

/** 已解析的主体元数据。 */
export interface Subject {
  ref: SubjectRef;
  title: string;
  url: string;
  coverUrl?: string;
  author?: Author;
  /** epoch ms */
  publishedAt?: number;
  /** 平台声明的评论总数，用于计算完整度。 */
  declaredCommentCount?: number;
  /** 适配器私有定位参数（如 bilibili 的 oid/type），引擎原样传回，不解读。 */
  locator: Record<string, string | number>;
}

export interface Comment {
  id: string;
  /** 顶层评论为 null。 */
  rootId: string | null;
  /** 顶层评论为 null；直接回复根评论时等于 rootId。 */
  parentId: string | null;
  author: Author;
  text: string;
  /** epoch ms */
  createdAt: number;
  likes: number;
  /** 平台声明的该根评论下的回复总数；非根评论为 0。 */
  replyCount: number;
  /** IP 属地等地区标签（平台提供时）。 */
  location?: string;
  pinned?: boolean;
  /** 作者是主体的创作者（UP 主）。 */
  byCreator?: boolean;
  /** 创作者点赞过。 */
  creatorLiked?: boolean;
}

/** 分析目标：整个主体的评论区，或一条评论（含其全部后代）构成的子树。 */
export type Target =
  | { kind: 'subject'; subject: SubjectRef }
  /**
   * commentId 是被选中的分析根，可以是根评论也可以是楼中楼。
   * 适配器负责定位它所在的真实根评论以取全拓扑；引擎再把结果裁剪为「选中评论 + 其后代」。
   */
  | { kind: 'thread'; subject: SubjectRef; commentId: string };

/** 不透明游标，由适配器定义，必须可 JSON 序列化。 */
export type Cursor = string;

export interface Page<T> {
  items: T[];
  /** null 表示已到末页。 */
  next: Cursor | null;
}

export interface ThreadPage extends Page<Comment> {
  /** 首页（cursor 为 null 的请求）必须携带真实根评论；后续页可省略。 */
  root?: Comment;
}

export interface Session {
  platform: PlatformId;
  loggedIn: boolean;
  user?: Author;
  /** 当前身份下的能力限制，一条一句，直接展示给用户。空数组表示无限制。 */
  limitations: string[];
}

/** 稳定的目标键，用于缓存与快照索引。 */
export function targetKey(target: Target): string {
  const s = target.subject;
  const base = `${s.platform}:${s.kind}:${s.id}`;
  return target.kind === 'subject' ? base : `${base}#${target.commentId}`;
}

export function subjectKey(ref: SubjectRef): string {
  return `${ref.platform}:${ref.kind}:${ref.id}`;
}
