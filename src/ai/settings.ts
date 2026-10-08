import { asNonEmptyString, asRecord } from './json';
import { DEFAULT_AI_SETTINGS, type AiSettings } from './types';

/** chrome.storage.local 中的设置键。 */
export const AI_SETTINGS_KEY = 'loupe.ai.settings';

/** 读取并校验设置；缺失 / 形状不对的字段回落到默认值。 */
export function normalizeSettings(raw: unknown): AiSettings {
  const record = asRecord(raw);
  if (!record) return { ...DEFAULT_AI_SETTINGS };
  return {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : DEFAULT_AI_SETTINGS.enabled,
    baseUrl: normalizeBaseUrl(record.baseUrl),
    apiKey: typeof record.apiKey === 'string' ? record.apiKey.trim() : DEFAULT_AI_SETTINGS.apiKey,
    model: asNonEmptyString(record.model) ?? DEFAULT_AI_SETTINGS.model,
    extraBody: normalizeExtraBody(record.extraBody),
    maxInputChars: normalizeMaxInputChars(record.maxInputChars),
  };
}

/** 去掉首尾空白与末尾斜杠；空串回落默认端点。 */
export function normalizeBaseUrl(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_AI_SETTINGS.baseUrl;
  const trimmed = value.trim().replace(/\/+$/, '');
  return trimmed.length > 0 ? trimmed : DEFAULT_AI_SETTINGS.baseUrl;
}

function normalizeExtraBody(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  return record ? { ...record } : {};
}

function normalizeMaxInputChars(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return DEFAULT_AI_SETTINGS.maxInputChars;
  return Math.floor(value);
}
