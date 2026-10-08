/**
 * AI 服务门面：设置读写、连通性探测、评论区解读（流式）与评论树诊断（JSON）。
 * 结果按「提示词版本 + 类型 + 端点 + 模型 + 影响输出的设置 + 输入摘要」内容寻址缓存，
 * 命中的确不发请求；密钥不进任何键（换密钥仍可复用同一结果）。
 */
import { cacheKey } from '../core/cache/types';
import type { Cache } from '../core/cache/types';
import { isAbort } from '../core/errors';
import type { AnalysisResult, SubjectReport, ThreadReport } from '../core/report';
import { completeChatText, streamChatText } from './client';
import { buildSubjectDigest, buildThreadDigest } from './digest';
import type { PromptDigest } from './digest';
import { createRefRewriter, parseThreadDiagnosis, PROMPT_VERSION, subjectSummaryMessages, threadDiagnosisMessages } from './prompts';
import type { DiagnosisFields } from './prompts';
import { AI_SETTINGS_KEY, normalizeSettings } from './settings';
import type { AiService, AiSettings, SettingsStorage, SubjectInsight, ThreadDiagnosis } from './types';

interface CachedInsight {
  markdown: string;
  model: string;
}

export function createAiService(deps: { cache: Cache; storage: SettingsStorage; fetch?: typeof fetch }): AiService {
  const fetchImpl: typeof fetch = deps.fetch ?? globalThis.fetch.bind(globalThis);

  const loadSettings = async (): Promise<AiSettings> => normalizeSettings(await deps.storage.get<unknown>(AI_SETTINGS_KEY));

  const requireUsable = (settings: AiSettings): void => {
    if (!settings.enabled) throw new Error('AI 未启用');
    if (settings.apiKey.length === 0) throw new Error('未配置 API Key');
  };

  return {
    loadSettings,

    async saveSettings(settings) {
      await deps.storage.set(AI_SETTINGS_KEY, normalizeSettings(settings));
    },

    async checkConnection(settings, signal) {
      const normalized = normalizeSettings(settings);
      if (normalized.apiKey.length === 0) return { ok: false, latencyMs: 0, error: '未配置 API Key' };
      const startedAt = Date.now();
      try {
        await completeChatText({
          settings: normalized,
          messages: [{ role: 'user', content: 'ping' }],
          stream: false,
          maxTokens: 1,
          signal,
          fetchImpl,
        });
        return { ok: true, latencyMs: Date.now() - startedAt };
      } catch (error) {
        if (isAbort(error)) throw error;
        return { ok: false, latencyMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) };
      }
    },

    async summarizeSubject(result: AnalysisResult<SubjectReport>, onDelta, signal): Promise<SubjectInsight> {
      const settings = await loadSettings();
      requireUsable(settings);
      const digest = buildSubjectDigest(result, settings.maxInputChars);
      const key = await cacheIdentity(settings, 'subject', digest);
      const hit = await deps.cache.get<CachedInsight>(key);
      if (hit) {
        onDelta(hit.value.markdown);
        return { markdown: hit.value.markdown, model: hit.value.model, cached: true };
      }

      const rewriter = createRefRewriter(digest.indexToId);
      let markdown = '';
      const emit = (chunk: string) => {
        if (chunk.length === 0) return;
        markdown += chunk;
        onDelta(chunk);
      };
      for await (const delta of streamChatText({
        settings,
        messages: subjectSummaryMessages(digest.text),
        stream: true,
        signal,
        fetchImpl,
      })) {
        emit(rewriter.push(delta));
      }
      emit(rewriter.flush());
      if (markdown.trim().length === 0) throw new Error('AI 未返回内容');

      const insight: CachedInsight = { markdown, model: settings.model };
      await deps.cache.set(key, insight, 'immutable');
      return { markdown, model: settings.model, cached: false };
    },

    async diagnoseThread(result: AnalysisResult<ThreadReport>, signal): Promise<ThreadDiagnosis> {
      const settings = await loadSettings();
      requireUsable(settings);
      const digest = buildThreadDigest(result, settings.maxInputChars);
      const key = await cacheIdentity(settings, 'thread', digest);
      const hit = await deps.cache.get<DiagnosisFields>(key);
      if (hit) return { ...hit.value, model: settings.model, cached: true };

      const raw = await completeChatText({
        settings,
        messages: threadDiagnosisMessages(digest.text),
        stream: false,
        jsonMode: true,
        signal,
        fetchImpl,
      });
      const fields = parseThreadDiagnosis(raw, digest.indexToId);
      await deps.cache.set(key, fields, 'immutable');
      return { ...fields, model: settings.model, cached: false };
    },
  };
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** 键稳定：对象键排序后序列化，避免字段顺序造成无谓的缓存未命中。 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

/**
 * 内容寻址键：端点 + 模型 + 影响输出的 extraBody + 提示词版本 + 输入摘要（含「序号→评论 id」映射）。
 * 不含 apiKey。摘要带上映射，确保同一段文本配不同评论 id 时不会复用旧结果里的 [[c:id]] 标记。
 */
async function cacheIdentity(settings: AiSettings, kind: 'subject' | 'thread', digest: PromptDigest): Promise<string> {
  const provider = await sha256Hex(
    stableStringify({ endpoint: settings.baseUrl, model: settings.model, extraBody: settings.extraBody }),
  );
  const mapping = [...digest.indexToId].map(([index, id]) => `${index}:${id}`).join('\n');
  const input = await sha256Hex(`${digest.text}\n\u0000\n${mapping}`);
  return cacheKey('ai', PROMPT_VERSION, kind, provider, input);
}
