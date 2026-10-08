/**
 * 安全的最小 Markdown 子集解析器：只支持标题、段落、有序/无序列表、**粗体**、`行内代码`
 * 以及 [[c:<commentId>]] 引用标记。输出结构化 token，由 Vue 模板渲染（绝不用 innerHTML），
 * 因此模型输出的任何 HTML 都只是文本。
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'chip'; commentId: string };

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; inline: Inline[] }
  | { kind: 'paragraph'; inline: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] };

const CHIP_RE = /^\[\[c:([A-Za-z0-9_-]+)\]\]/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const UL_RE = /^[-*]\s+(.*)$/;
const OL_RE = /^\d+[.)]\s+(.*)$/;

function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let buffer = '';
  const flush = () => {
    if (buffer) out.push({ kind: 'text', text: buffer });
    buffer = '';
  };

  for (let i = 0; i < source.length; ) {
    const rest = source.slice(i);

    const chip = CHIP_RE.exec(rest);
    if (chip) {
      flush();
      out.push({ kind: 'chip', commentId: chip[1]! });
      i += chip[0].length;
      continue;
    }

    if (rest.startsWith('**')) {
      const close = rest.indexOf('**', 2);
      if (close > 2) {
        flush();
        out.push({ kind: 'bold', children: parseInline(rest.slice(2, close)) });
        i += close + 2;
        continue;
      }
    }

    if (rest.startsWith('`')) {
      const close = rest.indexOf('`', 1);
      if (close > 1) {
        flush();
        out.push({ kind: 'code', text: rest.slice(1, close) });
        i += close + 1;
        continue;
      }
    }

    buffer += source[i];
    i += 1;
  }

  flush();
  return out;
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: Inline[][] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', inline: parseInline(paragraph.join(' ')) });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push({ kind: 'list', ordered: list.ordered, items: list.items });
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(3, heading[1]!.length) as 1 | 2 | 3;
      blocks.push({ kind: 'heading', level, inline: parseInline(heading[2]!.trim()) });
      continue;
    }

    const ordered = OL_RE.exec(line);
    const unordered = ordered ? null : UL_RE.exec(line);
    if (ordered || unordered) {
      flushParagraph();
      const isOrdered = ordered !== null;
      const text = (ordered ?? unordered)![1]!.trim();
      if (list && list.ordered !== isOrdered) flushList();
      if (!list) list = { ordered: isOrdered, items: [] };
      list.items.push(parseInline(text));
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();
  return blocks;
}
