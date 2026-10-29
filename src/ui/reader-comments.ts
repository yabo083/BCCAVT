/**
 * 页面替换阅读器的评论数据逻辑：写意图 / 结果协议、正文校验、评论合并与行内写显示态。
 *
 * 视图只负责收集输入与渲染，跨世界的投递（window.postMessage）与网络都在别处；
 * 本模块无 DOM、无 chrome.*、不读 cookie（csrf 只在内容脚本的写执行点即时取），全部可单测。
 */
import type { Comment } from '@/core/model';
import {
  READER_BRIDGE_SOURCE,
  READER_COMMENT_MAX_LENGTH,
  READER_WRITE_REQUEST,
  READER_WRITE_RESULT,
} from '@/extension/page-comments';
import type { ReaderWriteOp, ReaderWriteRequest, ReaderWriteResult } from '@/extension/page-comments';

/** 写请求超时：内容脚本没回结果（页面被卸载、接口挂住）时兜底，绝不悬挂。 */
export const WRITE_TIMEOUT_MS = 20_000;

/** 本次会话新发评论的草稿键（顶层评论没有 id 可用）：平台 id 都是数字串，不会撞上。 */
export const NEW_COMMENT_KEY = '__new__';

/** 写意图：UI 输入的最小集合；桥字段（source / type / requestId）在构造请求时补上。 */
export interface WriteIntent {
  op: ReaderWriteOp;
  commentId?: string;
  rootId?: string;
  parentId?: string;
  text?: string;
  userId?: string;
  reason?: number;
  content?: string;
}

/** 评论行的点赞显示态：计数已含本次会话的乐观增量。 */
export interface RowLikeState {
  count: number;
  liked: boolean;
  /** 点踩态（平台 action=2 或本次会话乐观踩）；与 liked 互斥，原生同款。 */
  disliked: boolean;
  busy: boolean;
}

/** 评论行的回复框状态：草稿与发送态都由父级持有，失败后草稿留着。 */
export interface RowReplyState {
  text: string;
  sending: boolean;
  error: string | null;
}

/** 点赞 / 取消点赞：liked 是点击前的状态。 */
export function likeIntent(commentId: string, liked: boolean): WriteIntent {
  return { op: liked ? 'unlike' : 'like', commentId };
}

/** 点踩 / 取消点踩：disliked 是点击前的状态。 */
export function dislikeIntent(commentId: string, disliked: boolean): WriteIntent {
  return { op: disliked ? 'undislike' : 'dislike', commentId };
}

/** 拉黑评论作者：两段确认在 UI 层做，意图携带作者 mid。 */
export function blockIntent(userId: string): WriteIntent {
  return { op: 'block', userId };
}

/** 举报评论：对话框选 reason（0=其他须带 content）。 */
export function reportIntent(commentId: string, reason: number, content?: string): WriteIntent {
  return { op: 'report', commentId, reason, content };
}

/** 删除自己的评论：两段确认在 UI 层做，意图本身只有评论 id。 */
export function deleteIntent(commentId: string): WriteIntent {
  return { op: 'delete', commentId };
}

/**
 * 回复一条评论：root 是它所属线程的根评论（顶层评论自身即根），parent 就是被回复的它。
 * 两个 id 必须成对出现（桥上的守卫这么要求），因此不带 commentId——回复的目标由 parent 表达。
 */
export function replyIntent(comment: Comment, text: string): WriteIntent {
  return {
    op: 'reply',
    rootId: comment.rootId ?? comment.id,
    parentId: comment.id,
    text: normalizeCommentText(text),
  };
}

/** 发表新顶层评论：不带 root / parent，内容脚本据此走顶层评论分支。 */
export function commentIntent(text: string): WriteIntent {
  return { op: 'reply', text: normalizeCommentText(text) };
}

/** 正文规范化：平台侧同样按去首尾空白后的文本判空。 */
export function normalizeCommentText(text: string): string {
  return text.trim();
}

/** 正文校验：返回可直接展示的错误，或 null 表示可提交。 */
export function commentTextError(text: string): string | null {
  const trimmed = normalizeCommentText(text);
  if (trimmed.length === 0) return '内容不能为空';
  if (trimmed.length > READER_COMMENT_MAX_LENGTH) return `最多 ${READER_COMMENT_MAX_LENGTH} 个字`;
  return null;
}

/** 补上桥字段：source / type 固定，requestId 由调用方生成（结果按它配对）。 */
export function buildWriteRequest(intent: WriteIntent, requestId: string): ReaderWriteRequest {
  const request: ReaderWriteRequest = {
    source: READER_BRIDGE_SOURCE,
    type: READER_WRITE_REQUEST,
    requestId,
    op: intent.op,
  };
  if (intent.commentId !== undefined) request.commentId = intent.commentId;
  if (intent.rootId !== undefined) request.rootId = intent.rootId;
  if (intent.parentId !== undefined) request.parentId = intent.parentId;
  if (intent.text !== undefined) request.text = intent.text;
  if (intent.userId !== undefined) request.userId = intent.userId;
  if (intent.reason !== undefined) request.reason = intent.reason;
  if (intent.content !== undefined) request.content = intent.content;
  return request;
}

/**
 * 合并评论来源（靠前者优先级低）：快照 → 按需抓到的回复 → 本次会话新写的评论。
 * 同 id 后者覆盖前者；新写的回复按 rootId / parentId 挂载，与原生分页无关。
 */
export function mergeComments(...sources: readonly (readonly Comment[])[]): Comment[] {
  const byId = new Map<string, Comment>();
  for (const source of sources) for (const comment of source) byId.set(comment.id, comment);
  return [...byId.values()];
}

export interface WriteClient {
  /** 发一条写意图并等结果。永不 reject：超时 / 投递失败 / 撤销都以 ok:false 收场。 */
  send(intent: WriteIntent): Promise<ReaderWriteResult>;
  /** 收到内容脚本的结果：按 requestId 配对；不是自己发的请求一律丢弃（页面脚本可以伪造消息）。 */
  settle(result: ReaderWriteResult): void;
  /** 撤销全部未决请求（换目标 / 卸载）：以失败收场并清掉定时器。 */
  dropAll(reason: string): void;
}

/**
 * 写客户端：把意图变成桥请求投出去，并按 requestId 把结果配回来。
 * 只投给父文档（B 站页面上下文）——csrf 由内容脚本在写执行时从 cookie 即时读，绝不跨桥。
 */
export function createWriteClient(
  post: (request: ReaderWriteRequest) => void,
  options: { timeoutMs?: number; newId?: () => string } = {},
): WriteClient {
  const timeoutMs = options.timeoutMs ?? WRITE_TIMEOUT_MS;
  let seq = 0;
  const newId = options.newId ?? ((): string => `w${(seq += 1).toString(36)}${Date.now().toString(36)}`);
  const pending = new Map<string, { resolve: (result: ReaderWriteResult) => void; timer: ReturnType<typeof setTimeout> }>();

  /** 以失败收场一条未决请求：清定时器 + 从表里摘掉（重复调用是空操作）。 */
  function fail(requestId: string, error: string): void {
    const entry = pending.get(requestId);
    if (entry === undefined) return;
    pending.delete(requestId);
    clearTimeout(entry.timer);
    entry.resolve({ source: READER_BRIDGE_SOURCE, type: READER_WRITE_RESULT, requestId, ok: false, error });
  }

  return {
    send(intent) {
      const request = buildWriteRequest(intent, newId());
      return new Promise<ReaderWriteResult>((resolve) => {
        const timer = setTimeout(() => fail(request.requestId, '写操作超时，请重试'), timeoutMs);
        pending.set(request.requestId, { resolve, timer });
        try {
          post(request);
        } catch (caught) {
          fail(request.requestId, caught instanceof Error && caught.message ? caught.message : '无法发送写请求');
        }
      });
    },

    settle(result) {
      const entry = pending.get(result.requestId);
      if (entry === undefined) return;
      pending.delete(result.requestId);
      clearTimeout(entry.timer);
      entry.resolve(result);
    },

    dropAll(reason) {
      for (const requestId of [...pending.keys()]) {
        fail(requestId, reason);
      }
    },
  };
}
