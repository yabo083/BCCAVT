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
 * 它和工作台**共用同一份 IndexedDB 存储**（各自一个 createCache 实例，底层同一个 'loupe' 库）。
 * 此前给阅读器单开内存缓存，是因为 session 键没有身份维度会互喂错身份；现在共享是安全的：
 * session/nav 键带身份姿态维度（readerHttp.identity：'page' vs 'direct'），页键带账号维度
 * （u:<mid> / anon）——两边同账号读同一组页，不同身份各读各的登录态。
 * 实测依据（2026-10-29，Chrome 156）：扩展源 iframe 与顶层扩展页共享同一份 IndexedDB
 * **和**同一份 Web Locks 空间（跨文档单飞因此可行，见 cache/index.ts）；
 * 已登录时页面上下文、扩展页直连、扩展 iframe 直连对 x/web-interface/nav 读到同一个
 * 登录用户（旧注释「工作台按匿名读取」是错的）。
 */
export const readerHttp = createReaderHttp({ fallback: http });
export const readerWorkbench = createWorkbench({ adapters, cache, http: readerHttp });

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
