/**
 * 原始评论 JSON → 领域 Comment。原始回复的根/父字段用 '0' 表示“无”，
 * 这里负责把字符串 id、秒级时间戳、IP 属地前缀等平台细节抹平。
 */
import type { Author, Comment, Emote } from '../../core/model';
import { asRecord, idField, numField, optId, optNum, optionalRecord, optStr, strField } from './raw';
import type { RawObject } from './raw';

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

/** 允许的表情图 CDN 顶级域；主机名必须精确等于它或为它的子域（`i0.hdslb.com` 这类）。 */
const EMOTE_CDN_DOMAINS = ['hdslb.com', 'bilibili.com'];
/** 表情图尺寸是渲染提示，超出这个区间的数值按“平台没给”处理，不因此判整条评论非法。 */
const EMOTE_MIN_DIMENSION = 1;
const EMOTE_MAX_DIMENSION = 512;

/**
 * 图片 URL 的协议升级：协议相对（`//i0.hdslb.com/...`）与平台历史遗留的 http 一律升到 https。
 * 扩展页面运行在安全上下文里，http 图片会被浏览器按 Mixed Content 自动升级并在控制台告警
 * （实机：头像兜底 `http://i0.hdslb.com/bfs/face/member/noface.jpg`），所以在这里统一升级，
 * 绝不把 http 地址带进渲染层。认不出协议的值原样返回——不猜、也不因此丢掉图片。
 */
export function httpsImageUrl(value: string): string {
  const raw = value.trim();
  return raw.startsWith('//') ? `https:${raw}` : raw.replace(/^http:/i, 'https:');
}

/**
 * 表情图 URL 边界校验：只放行 Bilibili CDN 的 https 地址。
 * 协议相对与平台历史遗留的 http 先经 {@link httpsImageUrl} 升级；
 * 其余协议（data:/javascript:/file:…）、非 CDN 主机、带凭据的 URL 全部丢弃。
 * 返回规范化后的 href，非法返回 undefined。
 */
function emoteUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const raw = value.trim();
  if (raw === '') return undefined;
  const candidate = httpsImageUrl(raw);
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:') return undefined;
  if (url.username !== '' || url.password !== '') return undefined;
  const host = url.hostname.toLowerCase();
  const onCdn = EMOTE_CDN_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  return onCdn ? url.href : undefined;
}

/** 表情宽高只是渲染提示：必须是这个区间内的整数，否则按“平台没给”处理。 */
function isEmoteDimension(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= EMOTE_MIN_DIMENSION &&
    value <= EMOTE_MAX_DIMENSION
  );
}

/**
 * `content.emote`：token → 图片。表情是可选装饰，任何一条非法只丢这一条，
 * 绝不因此把整条评论判为协议错误（正文照旧可读，token 会按字面文本渲染）。
 */
function normalizeEmotes(content: RawObject): Record<string, Emote> | undefined {
  const raw = optionalRecord(content['emote']);
  if (!raw) return undefined;
  const entries: [string, Emote][] = [];
  for (const [token, value] of Object.entries(raw)) {
    if (token === '') continue;
    const entry = optionalRecord(value);
    if (!entry) continue;
    const url = emoteUrl(entry['url']);
    if (!url) continue;
    const emote: Emote = { url };
    if (isEmoteDimension(entry['width'])) emote.width = entry['width'];
    if (isEmoteDimension(entry['height'])) emote.height = entry['height'];
    entries.push([token, emote]);
  }
  // fromEntries 走 CreateDataProperty，token 恰为 `__proto__` 时也只会成为普通键，不污染原型。
  return entries.length > 0 ? (Object.fromEntries(entries) as Record<string, Emote>) : undefined;
}

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
  // 主页地址与站点原版一致：`//space.bilibili.com/<mid>`（原生头像/昵称的 `<a href>` 就长这样）
  if (/^\d+$/.test(mid)) author.profileUrl = `https://space.bilibili.com/${mid}`;
  const avatar = optStr(member, 'avatar');
  if (avatar) author.avatarUrl = httpsImageUrl(avatar);
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
  const emotes = normalizeEmotes(content);
  if (emotes) comment.emotes = emotes;
  if (options.pinned) comment.pinned = true;
  if (options.upperMid !== undefined) comment.byCreator = mid === options.upperMid;
  if (optionalRecord(reply['up_action'])?.['like'] === true) comment.creatorLiked = true;
  // action: 0 无操作 1 已赞 2 已踩（当前用户视角，不做进 liked 会话态——阅读器对赞只跟踪本次会话）
  if (optNum(reply, 'action') === 2) comment.disliked = true;
  // members / at_name_to_mid → 正文 @ 提及的主页链接（与 Author.profileUrl 同形）
  const mentionMap = new Map<string, string>();
  const members = content['members'];
  if (Array.isArray(members)) {
    for (const m of members) {
      const rec = optionalRecord(m);
      if (!rec) continue;
      const mid = optId(rec, 'mid');
      const name = optStr(rec, 'uname') ?? '';
      if (mid !== undefined && /^\d+$/.test(mid) && name !== '') mentionMap.set(name, `https://space.bilibili.com/${mid}`);
    }
  }
  const atMap = optionalRecord(content['at_name_to_mid']);
  if (atMap) {
    for (const [name, midRaw] of Object.entries(atMap)) {
      const mid = String(midRaw);
      if (name !== '' && /^\d+$/.test(mid)) mentionMap.set(name, `https://space.bilibili.com/${mid}`);
    }
  }
  if (mentionMap.size > 0) comment.mentions = [...mentionMap.entries()].map(([name, profileUrl]) => ({ name, profileUrl }));
  // jump_url: {<kw>: {title, pc_url, ...}} → 正文关键词的跳转链接；只收 http(s)，其余整条丢弃
  const jumpMap = optionalRecord(content['jump_url']);
  if (jumpMap) {
    const jumps: { keyword: string; url: string }[] = [];
    for (const [keyword, value] of Object.entries(jumpMap)) {
      if (keyword === '') continue;
      const rec = optionalRecord(value);
      const candidate = typeof rec?.['pc_url'] === 'string' ? rec['pc_url'] : keyword;
      if (/^https?:\/\//i.test(candidate)) jumps.push({ keyword, url: candidate });
    }
    if (jumps.length > 0) comment.jumps = jumps;
  }
  return comment;
}
