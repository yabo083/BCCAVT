/** 抓取选项等 UI 偏好的持久化（chrome.storage.local）。存储内容是不可信输入，读时逐项校验。 */
import { DEFAULT_CRAWL_OPTIONS, type CrawlOptions, type RefreshMode } from '@/core/report';

const CRAWL_OPTIONS_KEY = 'loupe.crawlOptions';

const REFRESH_MODES: readonly RefreshMode[] = ['cache-first', 'incremental', 'full'];

/** 刷新方式的界面文案：抓取面板与「输入」面板的折叠摘要共用一份，避免两处各写一遍。 */
export const REFRESH_MODE_LABELS: Readonly<Record<RefreshMode, string>> = {
  'cache-first': '缓存优先',
  incremental: '增量重抓',
  full: '全量回源',
};

/** 每种刷新方式的一句话解释：面板里收进控件 title（正文只留标签与值）。 */
export const REFRESH_MODE_HINTS: Readonly<Record<RefreshMode, string>> = {
  'cache-first': '有快照直接复用，不发请求',
  incremental: '重扫顶层，只补变化的评论树',
  full: '忽略缓存全部重新抓取',
};

/** 两处上限的一行摘要（0 读作「不限」）：抽屉收起时用它交代当前配置。
 *  两处相同时写成「顶层/单树 X」，省下的宽度留给刷新方式——面板只有 256px 宽，超了会被截断。 */
export function limitsSummary(maxRoots: number, maxRepliesPerThread: number): string {
  const value = (limit: number): string => (limit > 0 ? String(limit) : '不限');
  return maxRoots === maxRepliesPerThread
    ? `顶层/单树 ${value(maxRoots)}`
    : `顶层 ${value(maxRoots)} / 单树 ${value(maxRepliesPerThread)}`;
}

/** 0 = 不限；负值 / 非有限数回落到默认。 */
function readLimit(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

export async function loadCrawlOptions(): Promise<CrawlOptions> {
  const bag = await chrome.storage.local.get(CRAWL_OPTIONS_KEY);
  const stored = bag[CRAWL_OPTIONS_KEY] as Partial<CrawlOptions> | undefined;
  if (!stored || typeof stored !== 'object') return { ...DEFAULT_CRAWL_OPTIONS };
  const refresh = REFRESH_MODES.find((mode) => mode === stored.refresh) ?? DEFAULT_CRAWL_OPTIONS.refresh;
  return {
    refresh,
    maxRoots: readLimit(stored.maxRoots, DEFAULT_CRAWL_OPTIONS.maxRoots),
    maxRepliesPerThread: readLimit(stored.maxRepliesPerThread, DEFAULT_CRAWL_OPTIONS.maxRepliesPerThread),
  };
}

export async function saveCrawlOptions(options: CrawlOptions): Promise<void> {
  await chrome.storage.local.set({ [CRAWL_OPTIONS_KEY]: options });
}
