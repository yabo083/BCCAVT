import { PlatformError } from '@/core/errors';
import type { Comment, Cursor, Page, PlatformId, Session, Subject, SubjectRef, Target, ThreadPage } from '@/core/model';
import type { HeaderRewrite, PlatformAdapter, Politeness } from '@/core/platform';

export function makeComment(input: Partial<Comment> & { id: string }): Comment {
  return {
    rootId: null,
    parentId: null,
    author: { id: 'u1', name: '用户1' },
    text: '',
    createdAt: 0,
    likes: 0,
    replyCount: 0,
    ...input,
  };
}

export function makeSubject(
  ref: SubjectRef = { platform: 'bilibili', kind: 'video', id: 'BV1TEST' },
  overrides: Partial<Subject> = {},
): Subject {
  return { ref, title: '测试视频', url: `https://www.example.com/${ref.id}`, locator: { oid: 80433022 }, ...overrides };
}

let dbCounter = 0;
/** 每个用例一个独立库名，避免 fake-indexeddb 之间的串扰。 */
export function uniqueDbName(): string {
  dbCounter++;
  return `loupe-test-${dbCounter}`;
}

/** 把评论分页序列包装成游标函数：cursor 为页码数字字符串。 */
export function pagedRoots(pages: Comment[][]): (cursor: Cursor | null) => Page<Comment> {
  return (cursor) => {
    const index = cursor === null ? 0 : Number(cursor);
    const items = pages[index] ?? [];
    const next = index + 1 < pages.length ? String(index + 1) : null;
    return { items, next };
  };
}

/** 一棵评论树：回复按 pageSize 分页，首页带根评论。 */
export function pagedThread(
  root: Comment,
  replies: Comment[],
  pageSize = 2,
): (commentId: string, cursor: Cursor | null) => ThreadPage {
  return (_commentId, cursor) => {
    const index = cursor === null ? 0 : Number(cursor);
    const start = index * pageSize;
    const items = replies.slice(start, start + pageSize);
    const next = start + pageSize < replies.length ? String(index + 1) : null;
    return index === 0 ? { items, next, root } : { items, next };
  };
}

export class FakeAdapter implements PlatformAdapter {
  readonly id: PlatformId = 'bilibili';
  readonly name = '假平台';
  readonly hostPermissions = ['https://api.example.com/*'];
  readonly headerRewrites: readonly HeaderRewrite[] = [];
  politeness: Politeness = { concurrency: 2, minIntervalMs: 0 };

  session: Session = { platform: 'bilibili', loggedIn: true, limitations: [] };
  subject: Subject = makeSubject();
  rootsProvider: (cursor: Cursor | null) => Page<Comment> = () => ({ items: [], next: null });
  threadProvider: (commentId: string, cursor: Cursor | null) => ThreadPage = () => ({ items: [], next: null });
  /** listRoots 进入后先等这个闸门，用于观察并发。 */
  beforeRoots: (() => Promise<void>) | undefined;
  /** 依次消费的注入错误；队列为空时正常返回。 */
  rootFailures: PlatformError[] = [];
  threadFailures: PlatformError[] = [];

  calls = { session: 0, subject: 0, roots: 0, thread: 0 };
  rootCursors: Array<Cursor | null> = [];
  threadCalls: Array<{ commentId: string; cursor: Cursor | null }> = [];
  inFlight = 0;
  maxInFlight = 0;

  get totalCalls(): number {
    return this.calls.session + this.calls.subject + this.calls.roots + this.calls.thread;
  }

  resetCalls(): void {
    this.calls = { session: 0, subject: 0, roots: 0, thread: 0 };
    this.rootCursors = [];
    this.threadCalls = [];
    this.inFlight = 0;
    this.maxInFlight = 0;
  }

  parseTarget(input: string): Target | null {
    return input.includes('BV1TEST') ? { kind: 'subject', subject: this.subject.ref } : null;
  }

  async getSession(): Promise<Session> {
    this.calls.session++;
    return this.session;
  }

  async getSubject(): Promise<Subject> {
    this.calls.subject++;
    return this.subject;
  }

  async listRoots(_subject: Subject, cursor: Cursor | null): Promise<Page<Comment>> {
    this.calls.roots++;
    this.rootCursors.push(cursor);
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (this.beforeRoots !== undefined) await this.beforeRoots();
      const failure = this.rootFailures.shift();
      if (failure !== undefined) throw failure;
      return await this.rootsProvider(cursor);
    } finally {
      this.inFlight--;
    }
  }

  async listThread(_subject: Subject, commentId: string, cursor: Cursor | null): Promise<ThreadPage> {
    this.calls.thread++;
    this.threadCalls.push({ commentId, cursor });
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      const failure = this.threadFailures.shift();
      if (failure !== undefined) throw failure;
      return await this.threadProvider(commentId, cursor);
    } finally {
      this.inFlight--;
    }
  }
}
