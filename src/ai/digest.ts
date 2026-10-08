/**
 * 把分析结果压成喂给模型的紧凑文本，并给出「短序号 → 真实评论 id」的映射，
 * 让模型用 #序号 引用评论、由调用方换回稳定 id。正文严格受 maxChars 约束。
 */
import type { Comment } from '../core/model';
import type { AnalysisResult, CommentNode, CountItem, SubjectReport, ThreadReport } from '../core/report';

/** 提示词摘录 + 短序号映射。 */
export interface PromptDigest {
  text: string;
  /** `#短序号` → 评论 id。 */
  indexToId: Map<number, string>;
}

const MAX_LINE_TEXT = 200;
const MAX_TOP_COMMENTS = 12;
const MAX_HOT_HEADS = 6;
const MAX_RECENT = 8;
const MAX_INDENT_DEPTH = 8;
const INDENT = '  ';

/** 行预算：普通行放不下就丢弃，强制行放不下就截断，保证总长不超上限。 */
class TextBudget {
  private readonly lines: string[] = [];
  private used = 0;

  constructor(private readonly max: number) {}

  get length(): number {
    return this.used;
  }

  add(line: string, mandatory = false): boolean {
    const gap = this.lines.length > 0 ? 1 : 0;
    const remaining = this.max - this.used - gap;
    if (line.length <= remaining) {
      this.lines.push(line);
      this.used += gap + line.length;
      return true;
    }
    if (!mandatory) return false;
    const keep = remaining - 1;
    if (keep <= 0) return false;
    this.lines.push(`${line.slice(0, keep)}…`);
    this.used += gap + keep + 1;
    return true;
  }

  text(): string {
    return this.lines.join('\n');
  }
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function shorten(text: string, max = MAX_LINE_TEXT): string {
  const flat = oneLine(text);
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function formatDate(ms: number | null): string {
  return ms === null ? '—' : new Date(ms).toISOString().slice(0, 10);
}

function countText(items: CountItem[], limit: number): string {
  return items
    .slice(0, limit)
    .map((item) => `${oneLine(item.label)}(${item.count})`)
    .join(' ');
}

function flattenTree(roots: readonly CommentNode[]): CommentNode[] {
  const out: CommentNode[] = [];
  const walk = (node: CommentNode) => {
    out.push(node);
    for (const child of node.children) walk(child);
  };
  for (const root of roots) walk(root);
  return out;
}

/** 整个视频评论区：标题/统计/关键词/属地 + 按热度与时间抽样的代表评论。 */
export function buildSubjectDigest(result: AnalysisResult<SubjectReport>, maxChars: number): PromptDigest {
  const { snapshot, report } = result;
  const budget = new TextBudget(maxChars);
  budget.add(`【标题】${shorten(snapshot.subject.title, 120)}`, true);
  budget.add(
    `【数据】评论 ${report.overview.total} 条（根 ${report.overview.roots} / 回复 ${report.overview.replies}），` +
      `作者 ${report.overview.authors} 人，总赞 ${report.overview.totalLikes}，最长链 ${report.overview.maxDepth} 层，` +
      `时间 ${formatDate(report.overview.firstAt)}~${formatDate(report.overview.lastAt)}`,
    true,
  );
  budget.add(`【关键词】${countText(report.keywords, 20)}`);
  budget.add(`【热门 IP 属地】${countText(report.locations, 15)}`);
  budget.add('【代表评论】每行 #序号 [赞N] 内容，引用评论请写 #序号：');

  const selected: Comment[] = [];
  const seen = new Set<string>();
  const push = (comment: Comment) => {
    if (seen.has(comment.id)) return;
    seen.add(comment.id);
    selected.push(comment);
  };
  const likedRoots = snapshot.comments
    .filter((comment) => comment.rootId === null)
    .sort((a, b) => b.likes - a.likes);
  for (const comment of likedRoots.slice(0, MAX_TOP_COMMENTS)) push(comment);
  for (const comment of report.topComments.slice(0, MAX_TOP_COMMENTS)) push(comment);
  for (const thread of report.hotThreads.slice(0, MAX_HOT_HEADS)) push(thread.root);
  const recent = [...snapshot.comments].sort((a, b) => b.createdAt - a.createdAt);
  for (const comment of recent.slice(0, MAX_RECENT)) push(comment);

  const indexToId = new Map<number, string>();
  for (const comment of selected) {
    const index = indexToId.size;
    if (!budget.add(`#${index} [赞${comment.likes}] ${shorten(comment.text)}`)) break;
    indexToId.set(index, comment.id);
  }
  const text = budget.text().slice(0, maxChars);
  return { text, indexToId };
}

/** 单条评论树：缩进文本（时间序），预算内优先保留根、焦点与最长链；整行装不下即止，绝不切半行。 */
export function buildThreadDigest(result: AnalysisResult<ThreadReport>, maxChars: number): PromptDigest {
  const { forest, report } = result;
  const chainIds = new Set(report.longestChain.map((comment) => comment.id));
  const nodes = flattenTree(forest.roots);
  const known = new Set(nodes.map((node) => node.comment.id));
  if (!known.has(report.root.id)) {
    nodes.push({ comment: report.root, children: [], parent: null, depth: 0, size: 1 });
  }

  const head = new TextBudget(maxChars);
  head.add(
    `【评论树】共 ${report.overview.total} 条，深度 ${report.overview.maxDepth} 层，` +
      `参与作者 ${report.overview.authors} 人，时间 ${formatDate(report.overview.firstAt)}~${formatDate(report.overview.lastAt)}`,
    true,
  );
  head.add(`【关键词】${countText(report.keywords, 15)}`);
  head.add('【说明】每行格式：#序号 作者→被回复者: 内容；引用评论时只写序号。');
  const remaining = maxChars - head.length - (head.length > 0 ? 1 : 0);

  const candidates = nodes
    .map((node) => {
      const comment = node.comment;
      const repliedTo =
        node.parent && node.parent.comment.id !== comment.id ? node.parent.comment.author.name : undefined;
      return {
        id: comment.id,
        time: comment.createdAt,
        depth: Math.min(node.depth, MAX_INDENT_DEPTH),
        mandatory: comment.id === report.root.id || comment.id === report.focusId || chainIds.has(comment.id),
        body: `${comment.author.name}${repliedTo ? `→${repliedTo}` : ''}: ${shorten(comment.text)}`,
      };
    })
    .sort((a, b) => a.time - b.time || a.depth - b.depth || (a.id < b.id ? -1 : 1));

  const indexWidth = String(candidates.length).length;
  const cost = (candidate: (typeof candidates)[number]) =>
    candidate.depth * INDENT.length + 1 + indexWidth + 1 + candidate.body.length;
  const chosen = new Set<string>();
  let used = 0;
  for (const candidate of candidates) {
    if (!candidate.mandatory || chosen.has(candidate.id)) continue;
    chosen.add(candidate.id);
    used += cost(candidate) + 1;
  }
  for (const candidate of candidates) {
    if (chosen.has(candidate.id)) continue;
    if (used + cost(candidate) + 1 > remaining) continue;
    chosen.add(candidate.id);
    used += cost(candidate) + 1;
  }

  const included = candidates.filter((candidate) => chosen.has(candidate.id));
  const headText = head.text();
  const separator = headText.length > 0 ? 1 : 0;
  const lines: string[] = [];
  const indexToId = new Map<number, string>();
  let bodyLength = 0;
  for (const candidate of included) {
    const line = `${INDENT.repeat(candidate.depth)}#${lines.length} ${candidate.body}`;
    const grown = bodyLength + (lines.length > 0 ? 1 : 0) + line.length;
    // 整行装不下就停止：绝不切半行，保证短序号映射与正文严格一致。
    if (headText.length + separator + grown > maxChars) break;
    indexToId.set(lines.length, candidate.id);
    lines.push(line);
    bodyLength = grown;
  }
  const text = [headText, lines.join('\n')].filter((part) => part.length > 0).join('\n');
  return { text, indexToId };
}
