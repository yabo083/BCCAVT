import { PlatformError } from './errors';
import type { HttpClient, HttpRequest } from './platform';

/** 解析 Retry-After（秒数或 HTTP 日期）。无法解析返回 undefined。 */
function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

/** signal 可省略（表单 POST 的请求体不参与取消）；没有 signal 时只认 AbortError 本身。 */
function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted === true) return true;
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * 唯一的传输层：带 Cookie、可取消、只做 HTTP 级错误映射。不重试、不缓存。
 * 说明见 platform.ts 的 HttpClient 文档。请求体（可能含 csrf）只进网络，绝不进错误文本与日志。
 */
export function createHttpClient(options: { fetch?: typeof fetch } = {}): HttpClient {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  /** GET / POST 共用的发送与错误映射：HTTP 级失败先映射成 PlatformError，成功再解码 JSON。 */
  async function send(url: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
    let response: Response;
    try {
      response = await doFetch(url, init);
    } catch (error) {
      if (isAbortError(error, signal)) {
        throw new PlatformError('aborted', '请求已取消', { cause: error });
      }
      throw new PlatformError('network', '网络请求失败', { cause: error });
    }

    if (response.status === 412 || response.status === 429) {
      throw new PlatformError('rate-limited', `平台限流：HTTP ${response.status}`, {
        code: response.status,
        retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after')),
      });
    }
    if (!response.ok) {
      throw new PlatformError('protocol', `HTTP ${response.status}`, { code: response.status });
    }

    try {
      return await response.json();
    } catch (error) {
      if (isAbortError(error, signal)) {
        throw new PlatformError('aborted', '请求已取消', { cause: error });
      }
      throw new PlatformError('protocol', '响应不是合法 JSON', { code: response.status, cause: error });
    }
  }

  return {
    async getJson<T>(request: HttpRequest, signal: AbortSignal): Promise<T> {
      return (await send(
        request.url,
        {
          method: 'GET',
          headers: request.headers,
          credentials: 'include',
          cache: 'no-store',
          signal,
        },
        signal,
      )) as T;
    },

    async postForm(url: string, params: Record<string, string>): Promise<unknown> {
      return send(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString(),
        credentials: 'include',
      });
    },
  };
}
