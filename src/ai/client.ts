/**
 * OpenAI 兼容 /chat/completions 客户端。只依赖 fetch，便于测试注入。
 * 所有错误信息已脱敏：绝不回显 apiKey 或请求头。
 */
import { isAbort } from '../core/errors';
import { asRecord } from './json';
import type { AiSettings } from './types';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  settings: AiSettings;
  messages: readonly ChatMessage[];
  stream: boolean;
  signal: AbortSignal;
  fetchImpl: typeof fetch;
  /** 默认 0.3。 */
  temperature?: number;
  maxTokens?: number;
  /** 附加 response_format:{type:'json_object'}；端点拒绝该字段时自动去掉重试一次。 */
  jsonMode?: boolean;
}

/** HTTP 错误，携带状态码；响应体只用于判断 response_format 兼容性，不保留原文。 */
export class AiHttpError extends Error {
  override readonly name = 'AiHttpError';
  readonly status: number;
  readonly mentionsResponseFormat: boolean;

  constructor(status: number, message: string, mentionsResponseFormat: boolean) {
    super(message);
    this.status = status;
    this.mentionsResponseFormat = mentionsResponseFormat;
  }
}

/** 把 HTTP 状态映射为简洁中文提示（不含密钥）。 */
export function mapHttpError(status: number): string {
  if (status === 401 || status === 403) return `AI 密钥无效（HTTP ${status}）`;
  if (status === 404) return `模型或地址错误（HTTP ${status}）`;
  if (status === 429) return `AI 额度不足或触发限流（HTTP ${status}）`;
  if (status >= 500) return `AI 服务异常（HTTP ${status}）`;
  return `AI 请求失败（HTTP ${status}）`;
}

export function chatUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
}

type SseEvent = { type: 'delta'; text: string } | { type: 'done' } | { type: 'skip' };

/** 解析一行 SSE；非 data 行、空行、无内容增量都跳过。 */
function parseSseLine(line: string): SseEvent {
  const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line;
  if (!trimmed.startsWith('data:')) return { type: 'skip' };
  const payload = trimmed.slice(5).trim();
  if (payload.length === 0) return { type: 'skip' };
  if (payload === '[DONE]') return { type: 'done' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error('AI 流式响应解析失败');
  }
  const text = extractDelta(parsed);
  return text === undefined ? { type: 'skip' } : { type: 'delta', text };
}

/** 只取 choices[0].delta.content，忽略 reasoning_content 等其余字段。 */
function extractDelta(payload: unknown): string | undefined {
  const choices = asRecord(payload)?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const delta = asRecord(asRecord(choices[0])?.delta);
  const content = delta?.content;
  return typeof content === 'string' && content.length > 0 ? content : undefined;
}

/** 非流式响应里取 choices[0].message.content。 */
function extractMessageContent(payload: unknown): string | undefined {
  const choices = asRecord(payload)?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const content = asRecord(asRecord(choices[0])?.message)?.content;
  return typeof content === 'string' ? content : undefined;
}

/** 逐块读取流式响应，容忍跨 chunk 被截断的行；未收到 [DONE] 视为流被截断，抛错而非当作成功。 */
export async function* sseDeltas(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf('\n');
      while (nl >= 0) {
        const event = parseSseLine(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
        if (event.type === 'done') return;
        if (event.type === 'delta') yield event.text;
        nl = buffer.indexOf('\n');
      }
    }
    buffer += decoder.decode();
    if (buffer.length > 0) {
      const event = parseSseLine(buffer);
      if (event.type === 'done') return;
      if (event.type === 'delta') yield event.text;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  if (signal?.aborted) throw new DOMException('AI 请求已取消', 'AbortError');
  throw new Error('AI 流式响应不完整（未收到结束标记）');
}

/** 抹掉错误文本里可能出现的凭据；任何错误信息都不得回显密钥。 */
function redactSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length > 0) out = out.split(secret).join('[已脱敏]');
  }
  return out;
}

function buildBody(request: ChatRequest, jsonMode: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.settings.model,
    messages: request.messages,
    stream: request.stream,
    temperature: request.temperature ?? 0.3,
    ...request.settings.extraBody,
  };
  if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
  if (jsonMode) body.response_format = { type: 'json_object' };
  return body;
}

async function postChat(request: ChatRequest, body: Record<string, unknown>): Promise<Response> {
  let response: Response;
  try {
    response = await request.fetchImpl(chatUrl(request.settings.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${request.settings.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: request.signal,
    });
  } catch (error) {
    if (isAbort(error)) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(redactSecrets(`AI 网络请求失败：${detail}`, [request.settings.apiKey]));
  }
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new AiHttpError(response.status, mapHttpError(response.status), bodyText.includes('response_format'));
  }
  return response;
}

/** 流式对话：产出增量文本。 */
export async function* streamChatText(request: ChatRequest): AsyncGenerator<string> {
  const response = await postChat(request, buildBody(request, false));
  if (!response.body) throw new Error('AI 流式响应为空');
  yield* sseDeltas(response.body, request.signal);
}

/** 非流式对话：返回完整文本。jsonMode 被端点拒绝（400 + 提及 response_format）时去掉该字段重试一次。 */
export async function completeChatText(request: ChatRequest): Promise<string> {
  const jsonMode = request.jsonMode === true;
  try {
    const response = await postChat(request, buildBody(request, jsonMode));
    return await readContent(response);
  } catch (error) {
    if (!jsonMode || !isResponseFormatRejection(error)) throw error;
    const response = await postChat(request, buildBody(request, false));
    return await readContent(response);
  }
}

function isResponseFormatRejection(error: unknown): boolean {
  return error instanceof AiHttpError && error.status === 400 && error.mentionsResponseFormat;
}

async function readContent(response: Response): Promise<string> {
  const payload: unknown = await response.json().catch(() => undefined);
  const content = extractMessageContent(payload);
  if (content === undefined) throw new Error('AI 响应结构异常');
  return content;
}
