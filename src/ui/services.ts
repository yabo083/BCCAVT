/**
 * UI 的单例服务装配。全部依赖在此构造一次，视图只 import 使用；
 * 引擎/适配器/AI 的内部实现都在各自模块里，UI 不越过这些门面。
 */
import { adapters } from '@/platforms';
import { createCache } from '@/core/cache';
import { createMemoryCache } from '@/core/cache/memory';
import { createHttpClient } from '@/core/http';
import { createWorkbench } from '@/core/workbench';
import { createAiService } from '@/ai';
import { chromeSettingsStorage } from '@/extension/storage';
import { ENSURE_HEADER_RULES, type EnsureHeaderRulesMessage } from '@/extension/messages';
import { createReaderHttp } from './reader-http';

export const cache = createCache();
export const http = createHttpClient();
export const workbench = createWorkbench({ adapters, cache, http });
export const ai = createAiService({ cache, storage: chromeSettingsStorage });

/**
 * 页面替换阅读器（embedded.html）专用的读取分支：读 GET 经桥交给内容脚本在 B 站页面上下文执行
 * （同站、带 Cookie，因此能读到原生那份全量，而不是扩展源直连被平台截断的那 315 条）。
 * 桥不可用时退回 http（扩展源直连、匿名），语义与改造前一致。
 *
 * 缓存只在本文档内存里，不落盘：分页是按「session 推出的账号」建键的，而 session 键本身没有账号维度
 * （谁先写谁生效）。阅读器是登录态读取，工作台 / 弹窗是匿名读取，共用一份磁盘缓存就会互相喂错身份——
 * 匿名那边会拿登录态 session 把截断结果写进登录态的键下（反向则读到截断结果），隔离在缓存实例上最省事。
 * 阅读器只做预览（不落快照、不写历史），因此少了这份磁盘缓存不丢任何已有行为。
 */
export const readerHttp = createReaderHttp({ fallback: http });
export const readerWorkbench = createWorkbench({ adapters, cache: createMemoryCache(), http: readerHttp });

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
