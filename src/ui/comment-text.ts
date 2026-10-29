/**
 * 评论正文 → 渲染段。纯逻辑：表情 token 按「最长字面量优先」匹配，
 * 未命中的 token、HTML、Unicode emoji（含 ZWJ/VS16 序列）都原样留在文本段里。
 * 视图只消费这里的结构化结果，绝不拼接 HTML。
 * 唯一的一处正则是「回复 @某人：」前缀（原型 `parseCommentText` 逐字照抄），见 `splitMention`。
 */
import type { Comment, Emote } from '@/core/model';

export type CommentSegment =
  | { kind: 'text'; text: string }
  | { kind: 'emote'; token: string; url: string; width?: number; height?: number }
  | { kind: 'link'; text: string; url: string };

/** 正文里的可点击引用：@ 提及（members/at_name_to_mid）与跳转关键词（jump_url）。 */
export type CommentRefs = Pick<Comment, 'mentions' | 'jumps'>;

/**
 * 「回复 @某人：正文」前缀。提及名不含 `@`，冒号半角全角都认，「回复」与 `@` 之间允许空白。
 * 正文允许为空、允许含换行（`[\s\S]`）。
 */
const MENTION_PREFIX = /^回复\s*@([^:\s]+)\s*[:：]\s*([\s\S]*)$/;

/**
 * 把「回复 @某人：正文」拆成提及名与去前缀的正文：命中 → `mention` 为提及名、`body` 去前缀；
 * 未命中 → `mention` 为 null、`body` 原样。
 * **只服务渲染**：`thread.ts#preview`、详情卡与 AI 拿到的仍是原始文本。
 */
export function splitMention(text: string): { mention: string | null; body: string } {
  const match = MENTION_PREFIX.exec(text);
  if (match) return { mention: match[1]!, body: match[2]! };
  return { mention: null, body: text };
}

/** 按首字符分桶、桶内按长度降序：扫描时只比较同首字符的候选，最长者胜出。 */
function indexTokens(emotes?: Record<string, Emote>): Map<string, string[]> {
  const byFirst = new Map<string, string[]>();
  if (!emotes) return byFirst;
  for (const token of Object.keys(emotes)) {
    if (token === '') continue;
    const bucket = byFirst.get(token[0]!);
    if (bucket) bucket.push(token);
    else byFirst.set(token[0]!, [token]);
  }
  for (const bucket of byFirst.values()) bucket.sort((a, b) => b.length - a.length);
  return byFirst;
}

/** 裸 URL：http(s) 开头，吃到下一个空白/中文标点/引号为止。 */
const BARE_URL = /^https?:\/\/[^\s<>"'，。；！？（）【】《》]+/i;

export function tokenizeComment(text: string, emotes?: Record<string, Emote>, refs?: CommentRefs): CommentSegment[] {
  const byFirst = indexTokens(emotes);
  // 链接候选按首字符分桶、桶内最长优先（与表情同一策略）：`@名字` 提及与 jump_url 关键词
  const linkBuckets = new Map<string, { text: string; url: string }[]>();
  const addLink = (text2: string, url: string): void => {
    if (text2 === '') return;
    const bucket = linkBuckets.get(text2[0]!) ?? [];
    bucket.push({ text: text2, url });
    linkBuckets.set(text2[0]!, bucket);
  };
  for (const m of refs?.mentions ?? []) addLink(`@${m.name}`, m.profileUrl);
  for (const j of refs?.jumps ?? []) addLink(j.keyword, j.url);
  for (const bucket of linkBuckets.values()) bucket.sort((a, b) => b.text.length - a.text.length);

  const segments: CommentSegment[] = [];
  let plain = '';
  const flushPlain = (): void => {
    if (plain !== '') {
      segments.push({ kind: 'text', text: plain });
      plain = '';
    }
  };

  for (let i = 0; i < text.length; ) {
    const token = byFirst.get(text[i]!)?.find((candidate) => text.startsWith(candidate, i));
    const emote = token ? emotes?.[token] : undefined;
    if (token && emote) {
      flushPlain();
      const segment: CommentSegment = { kind: 'emote', token, url: emote.url };
      if (emote.width !== undefined) segment.width = emote.width;
      if (emote.height !== undefined) segment.height = emote.height;
      segments.push(segment);
      i += token.length;
      continue;
    }
    const link = linkBuckets.get(text[i]!)?.find((candidate) => text.startsWith(candidate.text, i));
    const urlMatch = link === undefined ? BARE_URL.exec(text.slice(i)) : null;
    if (link !== undefined) {
      flushPlain();
      segments.push({ kind: 'link', text: link.text, url: link.url });
      i += link.text.length;
      continue;
    }
    if (urlMatch !== null) {
      flushPlain();
      segments.push({ kind: 'link', text: urlMatch[0], url: urlMatch[0] });
      i += urlMatch[0].length;
      continue;
    }
    // 逐 UTF-16 码元累积：代理对、ZWJ、VS16 序列都按原样保留，重拼后与输入完全一致。
    plain += text[i];
    i += 1;
  }
  flushPlain();
  return segments;
}
