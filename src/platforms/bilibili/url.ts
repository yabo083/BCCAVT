/**
 * 用户输入 → 分析目标。纯函数、不发请求。
 * 支持：BV 号、av 号、视频链接（含 m 站），以及 `#reply<rpid>` / `comment_root_id` / `comment_secondary_id` 锚点。
 */
import type { SubjectRef, Target } from '../../core/model';

/** BV 号：`BV` + 10 位 base58 字符（不含 0 I O l）。 */
const BV_RE = /^[Bb][Vv]([1-9A-HJ-NP-Za-km-z]{10})$/;
const AV_RE = /^[Aa][Vv](\d{1,20})$/;
const VIDEO_PATH_RE = /^\/video\/([^/]+)/;
const HASH_REPLY_RE = /^#reply(\d+)$/;

function videoRef(id: string): SubjectRef {
  return { platform: 'bilibili', kind: 'video', id };
}

/** 识别 BV / av 号，返回归一化后的 id；不匹配返回 null。 */
function parseVideoId(text: string): string | null {
  const bv = BV_RE.exec(text);
  if (bv) return `BV${bv[1]}`;
  const av = AV_RE.exec(text);
  if (av) return `av${av[1]!.replace(/^0+(?=\d)/, '')}`;
  return null;
}

function toUrl(text: string): URL | null {
  try {
    return new URL(text);
  } catch {
    // 用户常直接粘贴去掉 scheme 的地址，补上再试一次。
    try {
      return new URL(`https://${text}`);
    } catch {
      return null;
    }
  }
}

function isBilibiliHost(host: string): boolean {
  return host === 'bilibili.com' || host.endsWith('.bilibili.com');
}

function digitsOrNull(value: string | null): string | null {
  return value !== null && /^\d+$/.test(value) ? value : null;
}

/** 评论锚点：query 里的 secondary（更深的那条）优先，其次是 root，最后是 `#reply<rpid>`。 */
function commentAnchor(url: URL): string | null {
  return (
    digitsOrNull(url.searchParams.get('comment_secondary_id')) ??
    digitsOrNull(url.searchParams.get('comment_root_id')) ??
    digitsOrNull(HASH_REPLY_RE.exec(url.hash)?.[1] ?? null)
  );
}

export function parseTarget(input: string): Target | null {
  const text = input.trim();
  if (text === '') return null;

  const bareId = parseVideoId(text);
  if (bareId) return { kind: 'subject', subject: videoRef(bareId) };

  const url = toUrl(text);
  if (!url || !isBilibiliHost(url.hostname)) return null;

  const segment = VIDEO_PATH_RE.exec(url.pathname)?.[1];
  const id = segment ? parseVideoId(segment) : null;
  if (!id) return null;

  const subject = videoRef(id);
  const commentId = commentAnchor(url);
  return commentId ? { kind: 'thread', subject, commentId } : { kind: 'subject', subject };
}
