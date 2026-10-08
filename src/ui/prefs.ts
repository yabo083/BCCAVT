/** 抓取选项等 UI 偏好的持久化（chrome.storage.local）。存储内容是不可信输入，读时逐项校验。 */
import { DEFAULT_CRAWL_OPTIONS, type CrawlOptions, type RefreshMode } from '@/core/report';

const CRAWL_OPTIONS_KEY = 'loupe.crawlOptions';

const REFRESH_MODES: readonly RefreshMode[] = ['cache-first', 'incremental', 'full'];

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
