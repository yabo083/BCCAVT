/**
 * 写执行器（内容脚本·隔离世界）：把嵌入页的写意图落到平台的写接口上。
 *
 * 为什么在这里而不是在 iframe 里：写请求必须由 bilibili 页面上下文发出——cookie（含 bili_jct）
 * 与 Origin 都只属于页面；iframe 是扩展源，既拿不到站点的 cookie，也发不出站点形态的写请求。
 * iframe 只表达意图（READER_WRITE_REQUEST），拿结果（READER_WRITE_RESULT）。
 *
 * csrf 红线：bili_jct 只在写的那一刻从 document.cookie 现读，只作为局部变量传给写层、只进请求体。
 * 不跨桥、不进日志、不进错误文本、不进 storage 与缓存键——本模块里它没有第二个归宿。
 *
 * 主体解析：写接口要 subject.locator（oid/type），而内容脚本手里只有页面地址，因此按
 * parseTarget(location.href) → getSubject 解析一次，整页复用（换页即重新解析，失败不缓存）。
 * getSubject 走页面上下文的 fetch；缓存用内存实现，绝不往页面源的 IndexedDB 落盘。
 *
 * 执行器按适配器构造（测试用假适配器），生产用下面的 bilibiliAdapter 单例。
 */
import { createMemoryCache } from '../../core/cache/memory';
import { PlatformError } from '../../core/errors';
import { createHttpClient } from '../../core/http';
import type { Subject } from '../../core/model';
import type { FetchContext, PlatformAdapter } from '../../core/platform';
import { bilibiliAdapter } from '../../platforms/bilibili';
import { READER_BRIDGE_SOURCE, READER_WRITE_RESULT, type ReaderWriteRequest, type ReaderWriteResult } from '../page-comments';

export type ReaderWriteExecutor = (request: ReaderWriteRequest) => Promise<ReaderWriteResult>;

/**
 * 失败原因：PlatformError 的文案已经是可直接展示的中文，其余异常退回一句通用话。
 * 只取 message，绝不把 csrf 或请求参数带进结果。
 */
function failureText(error: unknown): string {
  if (error instanceof PlatformError) return error.message;
  if (error instanceof Error && error.message !== '') return error.message;
  return '写操作失败，请稍后重试';
}

/** 桥守卫已保证这些字段存在；这里显式断言（而不是静默兜底），契约被绕过时要立刻炸。 */
function required<T>(value: T | undefined, field: string): T {
  if (value === undefined) throw new Error(`写意图缺少必填字段 ${field}`);
  return value;
}

export function createReaderWriteExecutor(adapter: PlatformAdapter): ReaderWriteExecutor {
  /** 当前页面的主体：整页只解析一次；`href` 变了（SPA 换页）就重解析。 */
  let subjectHref = '';
  let subjectPending: Promise<Subject> | null = null;

  async function loadSubject(href: string): Promise<Subject> {
    const target = adapter.parseTarget(href);
    if (target === null) throw new Error('当前页面不是可写评论的 B 站视频页');
    const ctx: FetchContext = { http: createHttpClient(), cache: createMemoryCache(), signal: new AbortController().signal };
    return adapter.getSubject(target.subject, ctx);
  }

  /** 解析当前页面主体（单飞）：同一地址的并发写只发一次元数据请求。 */
  async function resolveSubject(): Promise<Subject> {
    const href = location.href;
    if (subjectPending !== null && subjectHref === href) return subjectPending;
    subjectHref = href;
    const pending = loadSubject(href);
    subjectPending = pending;
    try {
      return await pending;
    } catch (error) {
      // 解析失败不留缓存：下一次写再试（网络抖动不该让整页的写操作永久失效）
      if (subjectPending === pending) {
        subjectPending = null;
        subjectHref = '';
      }
      throw error;
    }
  }

  /**
   * 执行一次写意图：绝不抛——任何失败都变成 `ok: false` 的结果，嵌入页只需要展示原因。
   * 入参必须是 isReaderWriteRequest 通过的对象（本模块不做第二遍校验）。
   */
  return async function executeReaderWrite(request: ReaderWriteRequest): Promise<ReaderWriteResult> {
    const base = {
      source: READER_BRIDGE_SOURCE,
      type: READER_WRITE_RESULT,
      requestId: request.requestId,
    } as const;

    const csrf = /(?:^|;\s*)bili_jct=([^;]*)/.exec(document.cookie)?.[1]?.trim() ?? '';
    if (csrf === '') return { ...base, ok: false, error: '未登录：请在 B 站登录后再点赞或回复' };

    const writes = adapter.writes;
    if (writes === undefined) return { ...base, ok: false, error: '当前平台不支持写操作' };

    try {
      const subject = await resolveSubject();
      if (request.op === 'reply') {
        const comment = await writes.replyComment(
          {
            subject,
            commentId: request.parentId ?? null,
            rootId: request.rootId ?? null,
            text: required(request.text, 'text'),
          },
          { csrf },
        );
        return { ...base, ok: true, comment };
      }
      await writes.likeComment({ subject, commentId: required(request.commentId, 'commentId'), action: request.op }, { csrf });
      return { ...base, ok: true };
    } catch (error) {
      return { ...base, ok: false, error: failureText(error) };
    }
  };
}

/** 内容脚本用的执行器：B 站适配器（写能力已绑定页面上下文的 fetch）。 */
export const executeReaderWrite: ReaderWriteExecutor = createReaderWriteExecutor(bilibiliAdapter);
