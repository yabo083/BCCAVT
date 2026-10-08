import { describe, expect, it } from 'vitest';
import { PlatformError } from '@/core/errors';
import { createHttpClient } from '@/core/http';

function fakeFetch(handler: (url: string, init: RequestInit) => Promise<Response>): {
  fetch: typeof fetch;
  calls: Array<{ url: string; init: RequestInit }>;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fetch: impl as unknown as typeof fetch, calls };
}

const jsonResponse = (body: string, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(body, { status, headers });

async function capture(promise: Promise<unknown>): Promise<PlatformError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PlatformError) return error;
    throw error;
  }
  throw new Error('期望抛出 PlatformError');
}

describe('createHttpClient', () => {
  it('带 Cookie、no-store、signal 地取 JSON', async () => {
    const { fetch, calls } = fakeFetch(async () => jsonResponse('{"code":0,"data":{"n":1}}'));
    const client = createHttpClient({ fetch });
    const controller = new AbortController();
    const data = await client.getJson<{ code: number }>({ url: 'https://api.example.com/x', headers: { accept: 'application/json' } }, controller.signal);

    expect(data).toEqual({ code: 0, data: { n: 1 } });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.example.com/x');
    expect(calls[0]!.init.credentials).toBe('include');
    expect(calls[0]!.init.cache).toBe('no-store');
    expect(calls[0]!.init.signal).toBe(controller.signal);
    expect(calls[0]!.init.headers).toEqual({ accept: 'application/json' });
  });

  it('412 映射为 rate-limited，并解析 Retry-After', async () => {
    const { fetch } = fakeFetch(async () => jsonResponse('<html>风控</html>', 412, { 'retry-after': '2' }));
    const error = await capture(createHttpClient({ fetch }).getJson({ url: 'https://api.example.com/x' }, new AbortController().signal));
    expect(error.kind).toBe('rate-limited');
    expect(error.code).toBe(412);
    expect(error.retryAfterMs).toBe(2000);
    expect(error.retryable).toBe(true);
  });

  it('429 映射为 rate-limited', async () => {
    const { fetch } = fakeFetch(async () => jsonResponse('', 429));
    const error = await capture(createHttpClient({ fetch }).getJson({ url: 'https://api.example.com/x' }, new AbortController().signal));
    expect(error.kind).toBe('rate-limited');
    expect(error.code).toBe(429);
    expect(error.retryAfterMs).toBeUndefined();
  });

  it('其他非 2xx 映射为 protocol', async () => {
    const { fetch } = fakeFetch(async () => jsonResponse('nope', 500));
    const error = await capture(createHttpClient({ fetch }).getJson({ url: 'https://api.example.com/x' }, new AbortController().signal));
    expect(error.kind).toBe('protocol');
    expect(error.code).toBe(500);
    expect(error.retryable).toBe(false);
  });

  it('非 JSON 响应体映射为 protocol', async () => {
    const { fetch } = fakeFetch(async () => jsonResponse('<html>慢一点</html>', 200));
    const error = await capture(createHttpClient({ fetch }).getJson({ url: 'https://api.example.com/x' }, new AbortController().signal));
    expect(error.kind).toBe('protocol');
    expect(error.message).toContain('JSON');
  });

  it('网络异常映射为 network', async () => {
    const { fetch } = fakeFetch(async () => {
      throw new TypeError('fetch failed');
    });
    const error = await capture(createHttpClient({ fetch }).getJson({ url: 'https://api.example.com/x' }, new AbortController().signal));
    expect(error.kind).toBe('network');
  });

  it('AbortError 映射为 aborted', async () => {
    const { fetch } = fakeFetch(async () => {
      throw new DOMException('The operation was aborted.', 'AbortError');
    });
    const error = await capture(createHttpClient({ fetch }).getJson({ url: 'https://api.example.com/x' }, new AbortController().signal));
    expect(error.kind).toBe('aborted');
  });

  it('信号已取消时任何失败都算 aborted', async () => {
    const { fetch } = fakeFetch(async () => {
      throw new TypeError('fetch failed');
    });
    const controller = new AbortController();
    controller.abort();
    const error = await capture(createHttpClient({ fetch }).getJson({ url: 'https://api.example.com/x' }, controller.signal));
    expect(error.kind).toBe('aborted');
  });
});
