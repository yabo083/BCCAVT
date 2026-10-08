/**
 * 设置持久化：chrome.storage.local。AI 密钥等凭据只落在这里，不进日志、不进缓存键。
 */
import type { SettingsStorage } from '@/ai/types';

export const chromeSettingsStorage: SettingsStorage = {
  async get<T>(key: string): Promise<T | undefined> {
    const stored = await chrome.storage.local.get(key);
    return stored[key] as T | undefined;
  },
  async set<T>(key: string, value: T): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  },
};
