/**
 * Bilibili 平台适配器：把评论区 API 拼装成平台无关的 Target/Comment 分页。
 * 重试、退避、并发由引擎按 politeness 执行，这里只负责协议本身。
 */
import { PlatformError } from '../../core/errors';
import { createHttpClient } from '../../core/http';
import type { Comment, Cursor, Page, RootOrder, Subject, SubjectRef, ThreadPage } from '../../core/model';
import type { FetchContext, PlatformAdapter, SeekResult } from '../../core/platform';
import {
  createBilibiliWrites,
  fetchRootPage,
  fetchSession,
  fetchThreadPage,
  fetchVideoView,
  locatorOf,
  type RawThreadPage,
} from './api';
import { normalizeReply, rawRootId } from './normalize';
import { parseTarget } from './url';
import { asRecord, strField } from './raw';

const LOCATOR_TYPE_VIDEO = 1;

async function getSubject(ref: SubjectRef, ctx: FetchContext): Promise<Subject> {
  if (ref.kind !== 'video') {
    throw new PlatformError('invalid-input', `Bilibili 不支持的主体类型：${ref.kind}`, { platform: 'bilibili' });
  }
  const view = await fetchVideoView(ref, ctx);
  const subject: Subject = {
    ref,
    title: view.title,
    url: `https://www.bilibili.com/video/${view.bvid}`,
    author: view.owner,
    publishedAt: view.publishedAt,
    declaredCommentCount: view.commentCount,
    locator: { oid: view.aid, type: LOCATOR_TYPE_VIDEO },
  };
  if (view.coverUrl !== undefined) subject.coverUrl = view.coverUrl;
  return subject;
}

async function listRoots(subject: Subject, cursor: Cursor | null, order: RootOrder, ctx: FetchContext): Promise<Page<Comment>> {
  const page = await fetchRootPage(locatorOf(subject), cursor, order, ctx);
  const upperMid = page.upperMid ?? undefined;
  const items: Comment[] = [];
  const seen = new Set<string>();

  // 置顶热评只在首页出现，且可能同时留在时间流里，先收置顶再按 id 去重。
  if (cursor === null) {
    for (const [index, raw] of page.topReplies.entries()) {
      const comment = normalizeReply(raw, { upperMid, pinned: true, path: `top_replies[${index}]` });
      seen.add(comment.id);
      items.push(comment);
    }
  }
  for (const [index, entry] of page.replies.entries()) {
    const path = `replies[${index}]`;
    const comment = normalizeReply(entry.reply, { upperMid, path });
    if (!seen.has(comment.id)) {
      seen.add(comment.id);
      items.push(comment);
    }
    for (const [previewIndex, preview] of entry.previews.entries()) {
      const inline = normalizeReply(preview, { upperMid, path: `${path}.replies[${previewIndex}]` });
      if (!seen.has(inline.id)) {
        seen.add(inline.id);
        items.push(inline);
      }
    }
  }

  return { items, next: page.isEnd || page.nextOffset === null ? null : page.nextOffset };
}

/** 评论树游标必须自带真实根 id，后续页才能继续翻同一棵树。 */
function buildThreadPage(page: RawThreadPage, rootId: string, root?: Comment): ThreadPage {
  const upperMid = page.upperMid ?? undefined;
  const items = page.replies.map((raw, index) =>
    normalizeReply(raw, { upperMid, path: `detail.data.root.replies[${index}]` }),
  );
  const next =
    page.isEnd || page.nextOffset === null ? null : JSON.stringify({ root: rootId, offset: page.nextOffset });
  return root === undefined ? { items, next } : { root, items, next };
}

function decodeThreadCursor(cursor: Cursor): { root: string; offset: string } {
  try {
    const parsed = asRecord(JSON.parse(cursor) as unknown, '游标');
    return { root: strField(parsed, 'root', '游标'), offset: strField(parsed, 'offset', '游标') };
  } catch (cause) {
    throw new PlatformError('invalid-input', `无法解析的评论树翻页游标：${cursor}`, { platform: 'bilibili', cause });
  }
}

/**
 * 按评论 id 定点取回它所在的根评论块：seek_rpid 让平台把目标的根评论置顶在 replies[0]
 * （目标是楼中楼时它会出现在 replies[0].replies 的内联预览里）。
 * 只收 replies[0] 这一块：返回的根 id 必须是 commentId 本身、或其内联预览里含有它——
 * 都对不上（含空 replies）就是「评论不存在或已删除」，绝不把碰巧排在第一的另一条评论交回去。
 */
async function seekRoot(subject: Subject, commentId: string, ctx: FetchContext): Promise<SeekResult> {
  const page = await fetchRootPage(locatorOf(subject), null, 'time', ctx, commentId);
  const first = page.replies[0];
  if (first === undefined) {
    throw new PlatformError('not-found', '评论不存在或已删除', { platform: 'bilibili' });
  }
  const upperMid = page.upperMid ?? undefined;
  const root = normalizeReply(first.reply, { upperMid, path: 'replies[0]' });
  const items: Comment[] = [];
  const seen = new Set<string>();
  const push = (comment: Comment): void => {
    if (seen.has(comment.id)) return;
    seen.add(comment.id);
    items.push(comment);
  };
  push(root);
  let found = root.id === commentId;
  for (const [index, raw] of first.previews.entries()) {
    const preview = normalizeReply(raw, { upperMid, path: `replies[0].replies[${index}]` });
    if (preview.id === commentId) found = true;
    push(preview);
  }
  if (!found) {
    throw new PlatformError('not-found', '评论不存在或已删除', { platform: 'bilibili' });
  }
  return { root, items };
}

async function listThread(
  subject: Subject,
  commentId: string,
  cursor: Cursor | null,
  ctx: FetchContext,
): Promise<ThreadPage> {
  const locator = locatorOf(subject);
  if (cursor !== null) {
    const { root, offset } = decodeThreadCursor(cursor);
    return buildThreadPage(await fetchThreadPage(locator, root, offset, ctx), root);
  }

  let page = await fetchThreadPage(locator, commentId, null, ctx);
  const rootId = rawRootId(page.root, 'detail.data.root');
  // 传入的是楼中楼：detail 把它当根返回，此时需要再取一次真正的根那棵树。
  if (rootId !== commentId) page = await fetchThreadPage(locator, rootId, null, ctx);
  const root = normalizeReply(page.root, { upperMid: page.upperMid ?? undefined, path: 'detail.data.root' });
  return buildThreadPage(page, rootId, root);
}

export const bilibiliAdapter: PlatformAdapter = {
  id: 'bilibili',
  name: '哔哩哔哩',
  hostPermissions: ['https://*.bilibili.com/*'],
  headerRewrites: [
    {
      // 扩展页面发出的请求带 Origin: chrome-extension:// 会被风控（HTTP 412），改写成站内来源。
      urlFilter: '||api.bilibili.com/',
      set: { Origin: 'https://www.bilibili.com', Referer: 'https://www.bilibili.com/' },
    },
  ],
  politeness: { concurrency: 3, minIntervalMs: 250 },
  parseTarget,
  getSession: fetchSession,
  getSubject,
  listRoots,
  listThread,
  seekRoot,
  // 写请求也走同一套传输层（带 Cookie、同一份 Origin/Referer 改写与风控退避）：
  // 内容脚本拿到这个实例后，用内容脚本上下文的 fetch 发出请求。
  writes: createBilibiliWrites(createHttpClient()),
};
