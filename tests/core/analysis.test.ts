import { describe, expect, it } from 'vitest';
import { analyzeSubject, analyzeThread } from '@/core/analysis';
import type { Comment, SubjectRef } from '@/core/model';
import { SNAPSHOT_SCHEMA, type Snapshot } from '@/core/report';
import { buildForest } from '@/core/tree';
import { makeComment } from './fakes';

const HOUR = 3_600_000;
const T = Date.UTC(2026, 0, 1);
const up = { id: 'a', name: 'UP主', level: 6 };
const other = { id: 'b', name: '乙', level: 3 };

const ref: SubjectRef = { platform: 'bilibili', kind: 'video', id: 'BV1TEST' };

// r1 → c1 → c2，r1 → c3；r2 → c4 → c5 → c6（c6 是乙回复自己前一条）
const comments: Comment[] = [
  makeComment({
    id: 'r1',
    author: up,
    text: '哈哈哈[doge]这个梗好笑',
    createdAt: T,
    likes: 100,
    replyCount: 3,
    location: 'IP属地：广东',
  }),
  makeComment({ id: 'c1', rootId: 'r1', parentId: 'r1', author: other, createdAt: T + HOUR, likes: 10, location: 'IP属地：上海' }),
  makeComment({ id: 'c2', rootId: 'r1', parentId: 'c1', author: up, createdAt: T + 2 * HOUR, likes: 5, location: 'IP属地：广东' }),
  makeComment({ id: 'c3', rootId: 'r1', parentId: 'r1', author: other, createdAt: T + 3 * HOUR, likes: 0, location: 'IP属地：广东' }),
  makeComment({ id: 'r2', author: other, text: '回复 @某人 : 好笑', createdAt: T + 10 * HOUR, likes: 5, replyCount: 3, location: 'IP属地：上海' }),
  makeComment({ id: 'c4', rootId: 'r2', parentId: 'r2', author: up, createdAt: T + 11 * HOUR, likes: 2 }),
  makeComment({ id: 'c5', rootId: 'r2', parentId: 'c4', author: other, createdAt: T + 12 * HOUR, likes: 1 }),
  makeComment({ id: 'c6', rootId: 'r2', parentId: 'c5', author: other, createdAt: T + 13 * HOUR, likes: 0 }),
  makeComment({ id: 'r3', author: other, text: '好笑[笑哭]', createdAt: T + 20 * HOUR, likes: 3 }),
];

const subjectSnapshot: Snapshot = {
  schema: SNAPSHOT_SCHEMA,
  id: `${ref.id}@1`,
  target: { kind: 'subject', subject: ref },
  subject: { ref, title: '测试视频', url: 'https://example.com/BV1TEST', locator: { oid: 1 } },
  comments,
  fetchedAt: T,
  auth: 'user',
  completeness: { declared: 9, fetched: 9, truncated: false, reasons: [] },
  caps: { maxRoots: 0, maxRepliesPerThread: 0 },
  fetchStats: { requests: 1, cacheHits: 0, retries: 0, durationMs: 5 },
};

describe('analyzeSubject', () => {
  const report = analyzeSubject(subjectSnapshot, buildForest(comments));

  it('概览统计正确', () => {
    expect(report.overview).toEqual({
      total: 9,
      roots: 3,
      replies: 6,
      authors: 2,
      totalLikes: 126,
      medianLikes: 3,
      maxDepth: 3,
      firstAt: T,
      lastAt: T + 20 * HOUR,
    });
  });

  it('跨度一天内用小时桶，且连续无空洞', () => {
    expect(report.timeline.bucketMs).toBe(HOUR);
    expect(report.timeline.buckets).toHaveLength(21);
    expect(report.timeline.buckets[0]!.start).toBe(T);
    expect(report.timeline.buckets[0]!.count).toBe(1);
    expect(report.timeline.buckets[11]!.count).toBe(1);
    expect(report.timeline.buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(9);
  });

  it('关键词剥离 @提及与表情，并过滤停用词', () => {
    expect(report.keywords).toEqual([{ label: '好笑', count: 3 }]);
    const labels = report.keywords.map((item) => item.label);
    for (const noise of ['这个', '视频', '真的', '回复', '某人', 'doge', '笑哭', '哈哈哈', '梗']) {
      expect(labels).not.toContain(noise);
    }
  });

  it('高赞评论与热帖排序正确', () => {
    expect(report.topComments[0]!.id).toBe('r1');
    expect(report.topComments).toHaveLength(9);
    expect(report.hotThreads.map((thread) => [thread.root.id, thread.size, thread.depth, thread.participants])).toEqual([
      ['r1', 4, 2, 2],
      ['r2', 4, 3, 2],
      ['r3', 1, 0, 1],
    ]);
  });

  it('活跃作者、属地、等级、深度直方图正确', () => {
    expect(report.activeAuthors.map((stat) => [stat.author.id, stat.comments, stat.likes])).toEqual([
      ['b', 6, 19],
      ['a', 3, 107],
    ]);
    expect(report.locations).toEqual([
      { label: 'IP属地：广东', count: 3 },
      { label: 'IP属地：上海', count: 2 },
    ]);
    expect(report.levels).toEqual([
      { label: 'Lv0', count: 0 },
      { label: 'Lv1', count: 0 },
      { label: 'Lv2', count: 0 },
      { label: 'Lv3', count: 6 },
      { label: 'Lv4', count: 0 },
      { label: 'Lv5', count: 0 },
      { label: 'Lv6', count: 3 },
    ]);
    expect(report.depthHistogram).toEqual([
      { label: '0', count: 3 },
      { label: '1', count: 3 },
      { label: '2', count: 2 },
      { label: '3', count: 1 },
    ]);
  });

  it('交换对按作者对归并，自回复不计入', () => {
    expect(report.exchanges).toEqual([{ a: up, b: other, turns: 5 }]);
  });

  it('自适应桶宽：30 天用天、200 天用周', () => {
    const spread = (spanMs: number): number => {
      const items = [makeComment({ id: 'x', createdAt: T }), makeComment({ id: 'y', createdAt: T + spanMs })];
      return analyzeSubject({ ...subjectSnapshot, comments: items }, buildForest(items)).timeline.bucketMs;
    };
    expect(spread(2 * 24 * HOUR)).toBe(HOUR);
    expect(spread(30 * 24 * HOUR)).toBe(24 * HOUR);
    expect(spread(200 * 24 * HOUR)).toBe(7 * 24 * HOUR);
  });

  it('空评论集不炸', () => {
    const empty: Snapshot = { ...subjectSnapshot, comments: [] };
    const emptyReport = analyzeSubject(empty, buildForest([]));
    expect(emptyReport.overview.total).toBe(0);
    expect(emptyReport.overview.firstAt).toBeNull();
    expect(emptyReport.overview.medianLikes).toBe(0);
    expect(emptyReport.timeline.buckets).toEqual([]);
    expect(emptyReport.keywords).toEqual([]);
    expect(emptyReport.depthHistogram).toEqual([]);
  });
});

describe('analyzeThread', () => {
  const threadComments = comments.filter((comment) => comment.id === 'r1' || comment.rootId === 'r1');
  const threadSnapshot: Snapshot = {
    ...subjectSnapshot,
    id: `${ref.id}#r1@1`,
    target: { kind: 'thread', subject: ref, commentId: 'r1' },
    rootId: 'r1',
    comments: threadComments,
  };
  const report = analyzeThread(threadSnapshot, buildForest(threadComments), 'r1');

  it('根、焦点与概览正确', () => {
    expect(report.root.id).toBe('r1');
    expect(report.focusId).toBe('r1');
    expect(report.overview).toMatchObject({ total: 4, roots: 1, replies: 3, authors: 2, totalLikes: 115, maxDepth: 2 });
  });

  it('最长回复链从根到最深叶子', () => {
    expect(report.longestChain.map((comment) => comment.id)).toEqual(['r1', 'c1', 'c2']);
  });

  it('参与者与交换对限定在该树内', () => {
    expect(report.participants.map((stat) => stat.author.id)).toEqual(['a', 'b']);
    expect(report.exchanges).toEqual([{ a: up, b: other, turns: 3 }]);
    expect(report.locations.map((item) => item.label)).toEqual(['IP属地：广东', 'IP属地：上海']);
  });

  it('分析根是楼中楼时 root / focusId 都指向它，溯源保留不计入 roots', () => {
    const sub = comments.filter((comment) => comment.id === 'c1' || comment.id === 'c2');
    const subSnapshot: Snapshot = {
      ...threadSnapshot,
      id: `${ref.id}#c1@1`,
      target: { kind: 'thread', subject: ref, commentId: 'c1' },
      rootId: 'c1',
      comments: sub,
    };
    const subReport = analyzeThread(subSnapshot, buildForest(sub), 'c1');
    expect(subReport.root.id).toBe('c1');
    expect(subReport.focusId).toBe('c1');
    expect(subReport.overview.total).toBe(2);
    expect(subReport.overview.roots).toBe(0);
    expect(subReport.longestChain.map((comment) => comment.id)).toEqual(['c1', 'c2']);
  });

  it('快照缺少分析根评论时报 not-found，不回退到第一条根评论', () => {
    expect(() => analyzeThread({ ...threadSnapshot, rootId: 'missing' }, buildForest(threadComments), 'missing')).toThrowError(/分析根评论/);
  });
});
