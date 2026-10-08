/**
 * 原始评论 JSON → 领域 Comment。原始回复的根/父字段用 '0' 表示“无”，
 * 这里负责把字符串 id、秒级时间戳、IP 属地前缀等平台细节抹平。
 */
import type { Author, Comment } from '../../core/model';
import { asRecord, idField, numField, optNum, optionalRecord, optStr, strField } from './raw';

export interface ReplyOptions {
  /** 主体作者（UP 主）mid；未知时无法判定 byCreator。 */
  upperMid?: string;
  /** 置顶评论（top_replies）。 */
  pinned?: boolean;
  /** 出错信息里的字段路径，例如 `replies[0]`。 */
  path?: string;
}

/** 属地标签形如 `IP属地：广东`，只保留地区本身。 */
const LOCATION_PREFIX_RE = /^IP属地[:：]/;

/** 读取原始评论所属的根评论 id：顶层评论返回它自己的 id。 */
export function rawRootId(raw: unknown, path: string): string {
  const reply = asRecord(raw, path);
  const id = idField(reply, 'rpid', path);
  const root = idField(reply, 'root', path);
  return root === '0' ? id : root;
}

export function normalizeReply(raw: unknown, options: ReplyOptions = {}): Comment {
  const path = options.path ?? 'reply';
  const reply = asRecord(raw, path);
  const member = asRecord(reply['member'], `${path}.member`);
  const content = asRecord(reply['content'], `${path}.content`);

  const mid = idField(member, 'mid', `${path}.member`);
  const author: Author = { id: mid, name: strField(member, 'uname', `${path}.member`) };
  const avatar = optStr(member, 'avatar');
  if (avatar) author.avatarUrl = avatar;
  const level = optNum(optionalRecord(member['level_info']) ?? {}, 'current_level');
  if (level !== undefined) author.level = level;

  const rootRaw = idField(reply, 'root', path);
  const parentRaw = idField(reply, 'parent', path);
  const body = strField(content, 'message', `${path}.content`);
  const control = optionalRecord(reply['reply_control']) ?? {};
  const location = (optStr(control, 'location') ?? '').replace(LOCATION_PREFIX_RE, '').trim();

  const comment: Comment = {
    id: idField(reply, 'rpid', path),
    rootId: rootRaw === '0' ? null : rootRaw,
    parentId: parentRaw === '0' ? null : parentRaw,
    author,
    text: body,
    createdAt: numField(reply, 'ctime', path) * 1000,
    likes: optNum(reply, 'like') ?? 0,
    // 只有顶层评论带“回复总数”（rcount 才是界面展示的那个数）；楼中楼恒为 0。
    replyCount: rootRaw === '0' ? (optNum(reply, 'rcount') ?? numField(reply, 'count', path)) : 0,
  };
  if (location !== '') comment.location = location;
  if (options.pinned) comment.pinned = true;
  if (options.upperMid !== undefined) comment.byCreator = mid === options.upperMid;
  if (optionalRecord(reply['up_action'])?.['like'] === true) comment.creatorLiked = true;
  return comment;
}
