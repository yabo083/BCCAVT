import { PlatformError } from './errors';
import type { Author, Comment } from './model';
import type {
  AuthorStat,
  CommentNode,
  CountItem,
  Exchange,
  Forest,
  Overview,
  Snapshot,
  SubjectReport,
  ThreadDigest,
  ThreadReport,
  TimeBucket,
  Timeline,
} from './report';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const WEEK_MS = 604_800_000;

/** 中文 + 常见网络用语停用词（静态表，纯噪音，不参与话题分析）。 */
const STOPWORDS = new Set([
  '这个', '那个', '这些', '那些', '这样', '那样', '这么', '那么', '这里', '那里', '哪里', '什么', '怎么', '怎样', '为何', '为什么',
  '就是', '不是', '没有', '可以', '自己', '一个', '一些', '一下', '一起', '一样', '一直', '一定', '真的', '确实', '其实', '反正',
  '但是', '可是', '不过', '而且', '所以', '因为', '如果', '还是', '已经', '现在', '时候', '应该', '感觉', '觉得', '知道', '喜欢', '大家',
  '有人', '有点', '一点', '只是', '还有', '然后', '可能', '肯定', '不能', '不会', '不要', '到底', '居然', '竟然', '至于', '关于', '对于',
  '通过', '以及', '并且', '或者', '虽然', '即使', '只要', '只有', '无论', '不管', '为了', '由于', '因此', '否则', '别的', '其他', '东西',
  '事情', '问题', '时间', '今天', '昨天', '明天', '最近', '之前', '之后', '以后', '以前', '上面', '下面', '里面', '外面', '前面', '后面',
  '左边', '右边', '我们', '你们', '他们', '她们', '它们', '别人', '朋友', '大家', '咱们', '上来', '下来', '出来', '进去', '回去', '过来',
  '哈哈', '哈哈哈', '哈哈哈哈', '呵呵', '嘿嘿', '嘻嘻', '233', '2333', 'hhh', 'emm', 'emmm', '666', 'awsl', 'xswl',
  '视频', '评论', '弹幕', '楼主', '前排', '沙发', '路过', '打卡', '一键三连', '三连', '点赞', '投币', '收藏', '关注', '粉丝', '直播',
  'up主', 'up', '支持', '感谢', '谢谢', '辛苦', '加油', '牛逼', '牛批', '离谱', '笑死', '破防', '绝了', '无语', '好评', '差评',
  '卧槽', '我靠', '妈的', '兄弟', '姐妹', '老哥', '大哥',
]);

const SEGMENTER = new Intl.Segmenter('zh', { granularity: 'word' });
/** 楼中楼里的「回复 @某人 :」前缀。 */
const MENTION_PREFIX = /^\s*回复\s*@[^\s:：]+?\s*[:：]\s*/;
/** 平台表情占位符，如 [doge]。 */
const EMOJI_TOKEN = /\[[^[\]]{1,12}\]/g;

function authorKey(author: Author): string {
  return author.id.length > 0 ? author.id : author.name;
}

function extractKeywords(comments: Comment[], limit: number): CountItem[] {
  const counts = new Map<string, number>();
  for (const comment of comments) {
    const text = comment.text.replace(EMOJI_TOKEN, ' ').replace(MENTION_PREFIX, '');
    if (text.length === 0) continue;
    for (const part of SEGMENTER.segment(text)) {
      if (part.isWordLike !== true) continue;
      const word = part.segment;
      if (word.length < 2 || STOPWORDS.has(word)) continue;
      if (/^[\d\s]+$/.test(word)) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
    .slice(0, limit);
}

function buildOverview(comments: Comment[], forest: Forest): Overview {
  const authors = new Set<string>();
  const sortedLikes: number[] = [];
  let totalLikes = 0;
  let roots = 0;
  let firstAt = Infinity;
  let lastAt = -Infinity;
  for (const comment of comments) {
    totalLikes += comment.likes;
    sortedLikes.push(comment.likes);
    if (comment.rootId === null) roots++;
    if (comment.createdAt < firstAt) firstAt = comment.createdAt;
    if (comment.createdAt > lastAt) lastAt = comment.createdAt;
    authors.add(authorKey(comment.author));
  }
  sortedLikes.sort((a, b) => a - b);
  let maxDepth = 0;
  for (const node of forest.byId.values()) {
    if (node.depth > maxDepth) maxDepth = node.depth;
  }
  return {
    total: comments.length,
    roots,
    replies: comments.length - roots,
    authors: authors.size,
    totalLikes,
    medianLikes: sortedLikes.length === 0 ? 0 : (sortedLikes[(sortedLikes.length - 1) >> 1]! + sortedLikes[sortedLikes.length >> 1]!) / 2,
    maxDepth,
    firstAt: comments.length === 0 ? null : firstAt,
    lastAt: comments.length === 0 ? null : lastAt,
  };
}

function buildTimeline(comments: Comment[]): Timeline {
  if (comments.length === 0) return { bucketMs: DAY_MS, buckets: [] };
  let firstAt = Infinity;
  let lastAt = -Infinity;
  for (const comment of comments) {
    if (comment.createdAt < firstAt) firstAt = comment.createdAt;
    if (comment.createdAt > lastAt) lastAt = comment.createdAt;
  }
  const bucketMs = lastAt - firstAt <= 3 * DAY_MS ? HOUR_MS : lastAt - firstAt <= 120 * DAY_MS ? DAY_MS : WEEK_MS;
  const first = Math.floor(firstAt / bucketMs) * bucketMs;
  const last = Math.floor(lastAt / bucketMs) * bucketMs;
  const buckets: TimeBucket[] = [];
  for (let start = first; start <= last; start += bucketMs) buckets.push({ start, end: start + bucketMs, count: 0 });
  for (const comment of comments) {
    const bucket = buckets[Math.floor((comment.createdAt - first) / bucketMs)];
    if (bucket !== undefined) bucket.count++;
  }
  return { bucketMs, buckets };
}

function buildAuthorStats(comments: Comment[], limit: number): AuthorStat[] {
  const byAuthor = new Map<string, AuthorStat>();
  for (const comment of comments) {
    const key = authorKey(comment.author);
    const existing = byAuthor.get(key);
    if (existing === undefined) byAuthor.set(key, { author: comment.author, comments: 1, likes: comment.likes });
    else {
      existing.comments++;
      existing.likes += comment.likes;
    }
  }
  return [...byAuthor.values()]
    .sort((a, b) => b.comments - a.comments || b.likes - a.likes || (authorKey(a.author) < authorKey(b.author) ? -1 : 1))
    .slice(0, limit);
}

function buildLocations(comments: Comment[], limit: number): CountItem[] {
  const counts = new Map<string, number>();
  for (const comment of comments) {
    if (comment.location === undefined || comment.location.length === 0) continue;
    counts.set(comment.location, (counts.get(comment.location) ?? 0) + 1);
  }
  return [...counts]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
    .slice(0, limit);
}

/** 恒定输出 Lv0…Lv6 七档（无等级的评论不计入）。 */
function buildLevels(comments: Comment[]): CountItem[] {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const comment of comments) {
    const level = comment.author.level;
    if (level === undefined) continue;
    const index = Math.min(6, Math.max(0, Math.floor(level)));
    counts[index] = counts[index]! + 1;
  }
  return counts.map((count, level) => ({ label: `Lv${level}`, count }));
}

function buildDepthHistogram(forest: Forest): CountItem[] {
  const counts: number[] = [];
  for (const node of forest.byId.values()) counts[node.depth] = (counts[node.depth] ?? 0) + 1;
  const histogram: CountItem[] = [];
  for (let depth = 0; depth < counts.length; depth++) histogram.push({ label: String(depth), count: counts[depth] ?? 0 });
  return histogram;
}

/** 作者对之间互相回复的次数；作者对无序，按 id 归并。 */
function buildExchanges(comments: Comment[], limit: number): Exchange[] {
  const byId = new Map(comments.map((comment) => [comment.id, comment] as const));
  const pairs = new Map<string, Exchange>();
  for (const comment of comments) {
    if (comment.parentId === null) continue;
    const parent = byId.get(comment.parentId);
    if (parent === undefined) continue;
    const keyParent = authorKey(parent.author);
    const keyChild = authorKey(comment.author);
    if (keyParent === keyChild) continue;
    const pairKey = keyParent < keyChild ? `${keyParent}\u0000${keyChild}` : `${keyChild}\u0000${keyParent}`;
    const existing = pairs.get(pairKey);
    if (existing === undefined) {
      pairs.set(pairKey, keyParent < keyChild ? { a: parent.author, b: comment.author, turns: 1 } : { a: comment.author, b: parent.author, turns: 1 });
    } else {
      existing.turns++;
    }
  }
  return [...pairs.values()].sort((a, b) => b.turns - a.turns || (authorKey(a.a) < authorKey(b.a) ? -1 : 1)).slice(0, limit);
}

function buildHotThreads(forest: Forest, limit: number): ThreadDigest[] {
  const digests: ThreadDigest[] = [];
  for (const root of forest.roots) {
    const participants = new Set<string>();
    let deepest = 0;
    const stack: CommentNode[] = [root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      participants.add(authorKey(node.comment.author));
      if (node.depth - root.depth > deepest) deepest = node.depth - root.depth;
      for (const child of node.children) stack.push(child);
    }
    digests.push({ root: root.comment, size: root.size, depth: deepest, participants: participants.size });
  }
  return digests
    .sort(
      (a, b) =>
        b.size - a.size ||
        a.root.createdAt - b.root.createdAt ||
        (a.root.id < b.root.id ? -1 : a.root.id > b.root.id ? 1 : 0),
    )
    .slice(0, limit);
}

function longestChainComments(root: CommentNode): Comment[] {
  let deepest = root;
  const stack: CommentNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.depth > deepest.depth) deepest = node;
    for (const child of node.children) stack.push(child);
  }
  const chain: Comment[] = [];
  for (let node: CommentNode | null = deepest; node !== null; node = node.parent) chain.push(node.comment);
  chain.reverse();
  return chain;
}

export function analyzeSubject(snapshot: Snapshot, forest: Forest): SubjectReport {
  const comments = snapshot.comments;
  return {
    overview: buildOverview(comments, forest),
    timeline: buildTimeline(comments),
    keywords: extractKeywords(comments, 50),
    topComments: [...comments]
      .sort((a, b) => b.likes - a.likes || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, 20),
    hotThreads: buildHotThreads(forest, 20),
    activeAuthors: buildAuthorStats(comments, 20),
    locations: buildLocations(comments, 20),
    levels: buildLevels(comments),
    depthHistogram: buildDepthHistogram(forest),
    exchanges: buildExchanges(comments, 20),
  };
}

export function analyzeThread(snapshot: Snapshot, forest: Forest, focusId: string): ThreadReport {
  // 找不到被选中的分析根时绝不回退到「第一条根评论」——那会把整棵根树当成结果静默展示。
  const rootNode = snapshot.rootId !== undefined ? forest.byId.get(snapshot.rootId) : undefined;
  if (rootNode === undefined) {
    throw new PlatformError('not-found', `快照缺少分析根评论 ${snapshot.rootId ?? focusId}，无法生成评论树报告`);
  }
  const comments = snapshot.comments;
  return {
    overview: buildOverview(comments, forest),
    root: rootNode.comment,
    focusId,
    timeline: buildTimeline(comments),
    participants: buildAuthorStats(comments, 20),
    exchanges: buildExchanges(comments, 20),
    longestChain: longestChainComments(rootNode),
    keywords: extractKeywords(comments, 30),
    locations: buildLocations(comments, 20),
  };
}
