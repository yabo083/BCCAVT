import { describe, expect, it } from 'vitest';
import { DEFAULT_AI_SETTINGS } from '../../src/ai/types';
import { AI_SETTINGS_KEY, normalizeSettings } from '../../src/ai/settings';
import { createAiService } from '../../src/ai/index';
import { createFakeCache, createMemoryStorage } from './fakes';

describe('normalizeSettings', () => {
  it('无输入时回落到默认值', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_AI_SETTINGS);
    expect(normalizeSettings('nope')).toEqual(DEFAULT_AI_SETTINGS);
    expect(normalizeSettings([1, 2])).toEqual(DEFAULT_AI_SETTINGS);
  });

  it('逐字段校验：坏形状只回落到该字段的默认值', () => {
    const settings = normalizeSettings({
      enabled: 'yes',
      baseUrl: '  https://api.example.com/v1///  ',
      apiKey: 12345,
      model: '   ',
      extraBody: [1],
      maxInputChars: 0,
    });
    expect(settings.enabled).toBe(DEFAULT_AI_SETTINGS.enabled);
    expect(settings.baseUrl).toBe('https://api.example.com/v1');
    expect(settings.apiKey).toBe(DEFAULT_AI_SETTINGS.apiKey);
    expect(settings.model).toBe(DEFAULT_AI_SETTINGS.model);
    expect(settings.extraBody).toEqual({});
    expect(settings.maxInputChars).toBe(DEFAULT_AI_SETTINGS.maxInputChars);
  });

  it('空 baseUrl 回落默认端点，整数字符数向下取整，extraBody 原样保留', () => {
    const settings = normalizeSettings({
      baseUrl: '///',
      apiKey: '  sk-abc  ',
      model: ' deepseek-chat ',
      extraBody: { thinking: { type: 'disabled' } },
      maxInputChars: 1234.9,
    });
    expect(settings.baseUrl).toBe(DEFAULT_AI_SETTINGS.baseUrl);
    expect(settings.apiKey).toBe('sk-abc');
    expect(settings.model).toBe('deepseek-chat');
    expect(settings.extraBody).toEqual({ thinking: { type: 'disabled' } });
    expect(settings.maxInputChars).toBe(1234);
  });
});

describe('AiService 设置读写', () => {
  it('存到 loupe.ai.settings 并规范化读回', async () => {
    const storage = createMemoryStorage();
    const service = createAiService({ cache: createFakeCache(), storage });

    await service.saveSettings({ ...DEFAULT_AI_SETTINGS, baseUrl: 'https://api.example.com/v1/', apiKey: 'sk-x' });
    expect(storage.data.has(AI_SETTINGS_KEY)).toBe(true);

    const loaded = await service.loadSettings();
    expect(loaded).toEqual({ ...DEFAULT_AI_SETTINGS, baseUrl: 'https://api.example.com/v1', apiKey: 'sk-x' });
  });

  it('存储里是脏数据时读取不抛错，回落默认', async () => {
    const storage = createMemoryStorage();
    storage.data.set(AI_SETTINGS_KEY, { enabled: true, maxInputChars: -3 });
    const service = createAiService({ cache: createFakeCache(), storage });
    const loaded = await service.loadSettings();
    expect(loaded.enabled).toBe(true);
    expect(loaded.maxInputChars).toBe(DEFAULT_AI_SETTINGS.maxInputChars);
    expect(loaded.model).toBe(DEFAULT_AI_SETTINGS.model);
  });
});
