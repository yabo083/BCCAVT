import { describe, expect, it } from 'vitest';
import { chatUrl, completeChatText, mapHttpError, sseDeltas, streamChatText } from '../../src/ai/client';
import type { ChatRequest } from '../../src/ai/client';
import { completeResponse, createFetchStub, jsonResponse, sseDelta, sseResponse, testSettings } from './fakes';

const KEY = 'sk-secret-key';

function request(fetchImpl: typeof fetch, overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    settings: testSettings(),
    messages: [{ role: 'user', content: '你好' }],
    stream: false,
    signal: new AbortController().signal,
    fetchImpl,
    ...overrides,
  };
}

async function collect(iterable: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

async function captured(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error('预期抛出错误，但没有');
}

describe('chatUrl / mapHttpError', () => {
  it('拼接端点并去掉多余斜杠', () => {
    expect(chatUrl('https://api.x/v1/')).toBe('https://api.x/v1/chat/completions');
    expect(chatUrl('https://api.x/v1')).toBe('https://api.x/v1/chat/completions');
  });

  it('状态码映射为中文提示', () => {
    expect(mapHttpError(401)).toContain('密钥无效');
    expect(mapHttpError(404)).toContain('模型或地址错误');
    expect(mapHttpError(429)).toContain('限流');
    expect(mapHttpError(503)).toContain('服务异常');
  });
});

describe('SSE 解析', () => {
  it('跨 chunk 截断的行、空行、[DONE] 与 reasoning_content 都能正确处理', async () => {
    const chunks = [
      ': keep-alive\n\n',
      'data: {"choices":[{"delta":{"reasoning_content":"思考"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"你"}}]}\n',
      '\ndata: {"cho',
      'ices":[{"delta":{"content":"好"}}]}\n\ndata: [DONE]\n\ndata: {"choices":[{"delta":{"content":"不该出现"}}]}\n\n',
    ];
    const deltas = await collect(sseDeltas(sseResponse(chunks).body as ReadableStream<Uint8Array>));
    expect(deltas).toEqual(['你', '好']);
  });

  it('缺少 [DONE] 的截断流抛错，不当作成功', async () => {
    const chunks = ['data: {"choices":[{"delta":{"content":"半"}}]}\n\n'];
    await expect(collect(sseDeltas(sseResponse(chunks).body as ReadableStream<Uint8Array>))).rejects.toThrow('不完整');
  });

  it('非流式请求体带 Authorization 与温度，流式请求体内 stream=true', async () => {
    const stub = createFetchStub(() => completeResponse('ok'));
    await completeChatText(request(stub.fetch, { stream: true, temperature: 0.5, maxTokens: undefined }));
    expect(stub.calls[0]?.url).toBe('https://api.test/v1/chat/completions');
    expect(stub.headersOf(0).Authorization).toBe(`Bearer ${KEY}`);
    const body = stub.bodyOf(0);
    expect(body.stream).toBe(true);
    expect(body.temperature).toBe(0.5);
    expect(body.model).toBe('test-model');
  });

  it('extraBody 合并进请求体', async () => {
    const stub = createFetchStub(() => completeResponse('ok'));
    await completeChatText(
      request(stub.fetch, { settings: testSettings({ extraBody: { thinking: { type: 'disabled' } } }) }),
    );
    expect(stub.bodyOf(0).thinking).toEqual({ type: 'disabled' });
    expect(stub.bodyOf(0).temperature).toBe(0.3);
  });
});

describe('错误处理', () => {
  it.each([
    [401, '密钥无效'],
    [404, '模型或地址错误'],
    [429, '限流'],
    [500, '服务异常'],
  ])('HTTP %i → %s，且不回显密钥', async (status, expected) => {
    const stub = createFetchStub(() => new Response(`bad key ${KEY}`, { status }));
    const error = await captured(completeChatText(request(stub.fetch)));
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain(expected);
    expect(error.message).not.toContain(KEY);
    expect(String(error.stack ?? '')).not.toContain(KEY);
  });

  it('网络错误给出可读提示且不回显密钥', async () => {
    const stub = createFetchStub(() => {
      throw new TypeError('fetch failed');
    });
    const error = await captured(completeChatText(request(stub.fetch)));
    expect(error.message).toContain('网络');
    expect(error.message).not.toContain(KEY);
  });

  it('网络错误文本里出现密钥时被脱敏', async () => {
    const stub = createFetchStub(() => {
      throw new TypeError(`failed to send Authorization: Bearer ${KEY}`);
    });
    const error = await captured(completeChatText(request(stub.fetch)));
    expect(error.message).toContain('网络');
    expect(error.message).not.toContain(KEY);
  });

  it('响应结构异常时明确报错', async () => {
    const stub = createFetchStub(() => jsonResponse({ choices: [] }));
    await expect(completeChatText(request(stub.fetch))).rejects.toThrow('AI 响应结构异常');
  });
});

describe('response_format 兼容回退', () => {
  it('400 且响应体提及 response_format 时去掉该字段重试一次', async () => {
    const stub = createFetchStub((_url, _init, index) =>
      index === 0
        ? new Response('response_format is not supported', { status: 400 })
        : completeResponse('{"summary":"ok"}'),
    );
    const text = await completeChatText(request(stub.fetch, { jsonMode: true }));
    expect(text).toBe('{"summary":"ok"}');
    expect(stub.calls).toHaveLength(2);
    expect(stub.bodyOf(0).response_format).toEqual({ type: 'json_object' });
    expect('response_format' in stub.bodyOf(1)).toBe(false);
  });

  it('400 未提及 response_format 时不重试，直接抛错', async () => {
    const stub = createFetchStub(() => new Response('bad request', { status: 400 }));
    await expect(completeChatText(request(stub.fetch, { jsonMode: true }))).rejects.toThrow('AI 请求失败');
    expect(stub.calls).toHaveLength(1);
  });
});

describe('流式输出', () => {
  it('streamChatText 产出增量文本', async () => {
    const stub = createFetchStub(() => sseResponse([sseDelta('甲'), sseDelta('乙'), 'data: [DONE]\n\n']));
    const deltas = await collect(streamChatText(request(stub.fetch, { stream: true })));
    expect(deltas).toEqual(['甲', '乙']);
  });
});
