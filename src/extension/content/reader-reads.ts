/**
 * 读执行器（内容脚本·隔离世界）：把嵌入页的读请求落到平台的只读接口上。
 *
 * 为什么在这里而不是在 iframe 里：读接口必须由 B 站页面上下文发出。iframe 是扩展源，
 * 对 api.bilibili.com 属于跨站请求，带不上站点 Cookie；平台于是按匿名身份给小票，
 * 顶层评论翻到 `is_end` 就停（约 315 条）——这正是页面替换阅读器「加载不动」的原因。
 * 内容脚本的请求以宿主页面为发起源（同站），Cookie 由浏览器自动带上，读到的就是原生那份全量。
 *
 * 凭据红线：Cookie 只在页面上下文由浏览器带上，本模块既不读也不传——请求里只有 URL（含签名）与
 * 可选请求头，结果里只有解析后的 JSON 或错误的类别与文案。不碰 document.cookie、不碰响应头，
 * 也绝不把 URL / 请求头 / 响应体写进日志或错误文本。
 *
 * 执行器按 HttpClient 构造（测试用假传输），生产用下面 createHttpClient 的那个实例。
 */
import { PlatformError } from '../../core/errors';
import type { PlatformErrorKind } from '../../core/errors';
import { createHttpClient } from '../../core/http';
import type { HttpClient } from '../../core/platform';
import {
  READER_BRIDGE_SOURCE,
  READER_FETCH_RESULT,
  type ReaderFetchRequest,
  type ReaderFetchResult,
} from '../page-comments';

export type ReaderFetchExecutor = (request: ReaderFetchRequest) => Promise<ReaderFetchResult>;

/** 失败结果里的三项：类别决定上游能否退避重试，code 只在拿到响应时才有。 */
interface Failure {
  kind: PlatformErrorKind;
  error: string;
  code?: number;
}

/**
 * 把传输层的失败翻译成桥上的失败结果：PlatformError 的类别与文案原样带上（文案已可直接展示），
 * 其余异常一律按协议失败收场。绝不带 cause。
 */
function toFailure(error: unknown): Failure {
  if (error instanceof PlatformError) {
    const failure: Failure = { kind: error.kind, error: error.message };
    if (error.code !== undefined) failure.code = error.code;
    return failure;
  }
  return { kind: 'protocol', error: '读取评论失败，请稍后重试' };
}

export function createReaderFetchExecutor(http: HttpClient): ReaderFetchExecutor {
  /**
   * 执行一次读请求：绝不抛——任何失败都变成 `ok: false` 的结果，嵌入页只需要重建错误。
   * 入参必须是 isReaderFetchRequest 通过的对象（本模块不做第二遍校验）。
   */
  return async function executeReaderFetch(request: ReaderFetchRequest): Promise<ReaderFetchResult> {
    const base = {
      source: READER_BRIDGE_SOURCE,
      type: READER_FETCH_RESULT,
      requestId: request.requestId,
    } as const;
    try {
      // 同站 GET：Cookie 由传输层的 credentials 带上，这里只给 URL 与可选请求头。
      // 请求不能跨页取消（iframe 侧超时后自行丢弃结果），因此只给一个不会被触发的信号。
      const json = await http.getJson({ url: request.url, headers: request.headers }, new AbortController().signal);
      return { ...base, ok: true, json };
    } catch (error) {
      return { ...base, ok: false, ...toFailure(error) };
    }
  };
}

/** 内容脚本用的执行器：传输层在页面上下文发请求（同站带 Cookie）。 */
export const executeReaderFetch: ReaderFetchExecutor = createReaderFetchExecutor(createHttpClient());
