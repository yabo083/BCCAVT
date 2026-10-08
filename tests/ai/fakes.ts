/** 测试替身：内存设置存储、内存缓存、最小可用的快照 / 森林 / 报告构造器。 */
import type { Cache, CacheEntry, CacheStats, Freshness } from '../../src/core/cache/types';
import type { AiSettings, SettingsStorage } from '../../src/ai/types';
import type { Comment } from '../../src/core/model';
import type {
  AnalysisResult,
  CommentNode,
  Forest,
  Overview,
  Snapshot,
  SubjectReport,
  ThreadReport,
} from '../../src/core/report';
import { SNAPSHOT_SCHEMA } from '../../src/core/report';

export interface MemorySettingsStorage extends SettingsStorage {
  data: Map<string, unknown>;
}

export function createMemoryStorage(): MemorySettingsStorage {
  const data = new Map<string, unknown>();
  return {
    data,
    async get<T>(key: string): Promise<T | undefined> {
      return data.get(key) as T | undefined;
    },
    async set<T>(key: string, value: T): Promise<void> {
      data.set(key, value);
    },
  };
}

export interface FakeCache extends Cache {
  entries: Map<string, unknown>;
}

export function createFakeCache(): FakeCache {
  const entries = new Map<string, unknown>();
  return {
    entries,
    async get<T>(key: string): Promise<CacheEntry<T> | undefined> {
      if (!entries.has(key)) return undefined;
      return { key, value: entries.get(key) as T, storedAt: 0, expiresAt: null };
    },
    async set<T>(key: string, value: T, _freshness: Freshness): Promise<void> {
      entries.set(key, value);
    },
    async getOrLoad<T>(key: string, _freshness: Freshness, loader: () => Promise<T>): Promise<{ value: T; source: 'network'; storedAt: number }> {
      const value = await loader();
      entries.set(key, value);
      return { value, source: 'network', storedAt: 0 };
    },
    async delete(key: string): Promise<void> {
      entries.delete(key);
    },
    async deletePrefix(prefix: string): Promise<void> {
      for (const key of [...entries.keys()]) if (key.startsWith(prefix)) entries.delete(key);
    },
    async keys(prefix: string): Promise<string[]> {
      return [...entries.keys()].filter((key) => key.startsWith(prefix));
    },
    stats(): CacheStats {
      return { memory: { hits: 0, misses: 0 }, disk: { hits: 0, misses: 0 }, loads: 0, coalesced: 0, degraded: 0 };
    },
    async usage(): Promise<{ entries: number; bytes: number }> {
      return { entries: entries.size, bytes: 0 };
    },
  };
}

export interface FetchStub {
  fetch: typeof fetch;
  calls: { url: string; init: RequestInit }[];
  bodyOf(index: number): Record<string, unknown>;
  headersOf(index: number): Record<string, string>;
}

export function createFetchStub(handler: (url: string, init: RequestInit, callIndex: number) => Response | Promise<Response>): FetchStub {
  const calls: { url: string; init: RequestInit }[] = [];
  const stub = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const requestInit = init ?? {};
    calls.push({ url, init: requestInit });
    return handler(url, requestInit, calls.length - 1);
  }) as typeof fetch;
  return {
    fetch: stub,
    calls,
    bodyOf(index) {
      return JSON.parse(String(calls[index]?.init.body ?? '{}')) as Record<string, unknown>;
    },
    headersOf(index) {
      return (calls[index]?.init.headers ?? {}) as Record<string, string>;
    },
  };
}

export function sseResponse(chunks: readonly string[], init: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status: 200, ...init });
}

export function sseDelta(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

export function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

export function completeResponse(content: string): Response {
  return jsonResponse({ choices: [{ message: { content } }] });
}

export function testSettings(overrides: Partial<AiSettings> = {}): AiSettings {
  return {
    enabled: true,
    baseUrl: 'https://api.test/v1',
    apiKey: 'sk-secret-key',
    model: 'test-model',
    extraBody: {},
    maxInputChars: 24_000,
    ...overrides,
  };
}

let nextId = 0;

export function comment(overrides: Partial<Comment> & { id: string }): Comment {
  const { id, ...rest } = overrides;
  return {
    id,
    rootId: null,
    parentId: null,
    author: { id: `u-${id}`, name: `用户${id}` },
    text: `评论内容 ${id}`,
    createdAt: 1_700_000_000_000 + nextId++,
    likes: 0,
    replyCount: 0,
    ...rest,
  };
}

export function makeForest(comments: readonly Comment[]): Forest {
  const byId = new Map<string, CommentNode>();
  for (const item of comments) byId.set(item.id, { comment: item, children: [], parent: null, depth: 0, size: 1 });
  const roots: CommentNode[] = [];
  let orphans = 0;
  for (const item of comments) {
    const node = byId.get(item.id);
    const parent = item.parentId === null ? undefined : byId.get(item.parentId);
    if (node && parent && parent !== node) {
      node.parent = parent;
      parent.children.push(node);
    } else {
      if (item.parentId !== null) orphans += 1;
      if (node) roots.push(node);
    }
  }
  const visit = (node: CommentNode, depth: number): number => {
    node.depth = depth;
    let size = 1;
    for (const child of node.children) size += visit(child, depth + 1);
    node.size = size;
    return size;
  };
  for (const root of roots) visit(root, 0);
  return { roots, byId, orphans };
}

export function overviewOf(comments: readonly Comment[]): Overview {
  const likes = comments.map((item) => item.likes).sort((a, b) => a - b);
  const times = comments.map((item) => item.createdAt);
  return {
    total: comments.length,
    roots: comments.filter((item) => item.rootId === null).length,
    replies: comments.filter((item) => item.rootId !== null).length,
    authors: new Set(comments.map((item) => item.author.id)).size,
    totalLikes: comments.reduce((sum, item) => sum + item.likes, 0),
    medianLikes: likes.length === 0 ? 0 : (likes[Math.floor(likes.length / 2)] ?? 0),
    maxDepth: 1,
    firstAt: times.length === 0 ? null : Math.min(...times),
    lastAt: times.length === 0 ? null : Math.max(...times),
  };
}

function snapshotOf(target: Snapshot['target'], comments: readonly Comment[]): Snapshot {
  return {
    schema: SNAPSHOT_SCHEMA,
    id: 'target@1',
    target,
    subject: {
      ref: { platform: 'bilibili', kind: 'video', id: 'BV1' },
      title: '测试视频标题',
      url: 'https://www.bilibili.com/video/BV1',
      locator: { oid: 1 },
    },
    comments: [...comments],
    fetchedAt: 1_700_000_000_000,
    auth: 'user',
    completeness: { fetched: comments.length, truncated: false, reasons: [] },
    caps: { maxRoots: 0, maxRepliesPerThread: 0 },
    fetchStats: { requests: 1, cacheHits: 0, retries: 0, durationMs: 1 },
  };
}

export function subjectResult(
  comments: readonly Comment[],
  report: Partial<SubjectReport> = {},
): AnalysisResult<SubjectReport> {
  return {
    snapshot: snapshotOf({ kind: 'subject', subject: { platform: 'bilibili', kind: 'video', id: 'BV1' } }, comments),
    forest: makeForest(comments),
    report: {
      overview: overviewOf(comments),
      timeline: { bucketMs: 86_400_000, buckets: [] },
      keywords: [],
      topComments: [],
      hotThreads: [],
      activeAuthors: [],
      locations: [],
      levels: [],
      depthHistogram: [],
      exchanges: [],
      ...report,
    },
    fromSnapshot: false,
  };
}

export function threadResult(
  root: Comment,
  replies: readonly Comment[],
  report: Partial<ThreadReport> = {},
): AnalysisResult<ThreadReport> {
  const all = [root, ...replies];
  return {
    snapshot: snapshotOf({ kind: 'thread', subject: { platform: 'bilibili', kind: 'video', id: 'BV1' }, commentId: root.id }, all),
    forest: makeForest(all),
    report: {
      overview: overviewOf(all),
      root,
      focusId: root.id,
      timeline: { bucketMs: 86_400_000, buckets: [] },
      participants: [],
      exchanges: [],
      longestChain: [root],
      keywords: [],
      locations: [],
      ...report,
    },
    fromSnapshot: false,
  };
}
