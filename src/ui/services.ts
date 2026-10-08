/**
 * UI 的单例服务装配。全部依赖在此构造一次，视图只 import 使用；
 * 引擎/适配器/AI 的内部实现都在各自模块里，UI 不越过这些门面。
 */
import { adapters } from '@/platforms';
import { createCache } from '@/core/cache';
import { createHttpClient } from '@/core/http';
import { createWorkbench } from '@/core/workbench';
import { createAiService } from '@/ai';
import { chromeSettingsStorage } from '@/extension/storage';
import { ENSURE_HEADER_RULES, type EnsureHeaderRulesMessage } from '@/extension/messages';

export const cache = createCache();
export const http = createHttpClient();
export const workbench = createWorkbench({ adapters, cache, http });
export const ai = createAiService({ cache, storage: chromeSettingsStorage });

/**
 * 首个网络请求前调用：等后台把 DNR 请求头改写规则注册好。
 * 扩展页面的请求若早于规则注册，会缺 Origin/Referer 而被平台风控（HTTP 412）。
 */
export async function ensureHeaderRules(): Promise<void> {
  const message: EnsureHeaderRulesMessage = { type: ENSURE_HEADER_RULES };
  const response: unknown = await chrome.runtime.sendMessage(message);
  if (typeof response !== 'object' || response === null || !('ok' in response) || response.ok !== true) {
    throw new Error('无法初始化平台请求规则，请重新加载扩展后重试');
  }
}
