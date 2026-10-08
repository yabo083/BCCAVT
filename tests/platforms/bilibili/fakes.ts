/**
 * 测试替身：内存版 Cache、可控 HttpClient、fixture 读取。
 */
import { readFileSync } from 'node:fs';
import { PlatformError } from '@/core/errors';
import { FRESHNESS_TTL_MS } from '@/core/cache/types';
import type { Cache, CacheEntry, CacheStats, Freshness, LoadOptions, LoadResult } from '@/core/cache/types';
import type { HttpClient, HttpRequest } from '@/core/platform';

const FIXTURE_DIR = new URL('../../fixtures/bilibili/', import.meta.url);

/** 原始 API JSON 的宽松视图，仅供测试断言使用。 */
export type RawJson = Record<string, any>;

/** 读取 tests/fixtures/bilibili/<name> 的原始 API 响应。 */
export function fixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(new URL(name, FIXTURE_DIR), 'utf8')) as T;
}

interface Entry {
  value: unknown;
  storedAt: number;
  expiresAt: number | null;
}

/** 只实现适配器真正用到的那部分契约：get / set / getOrLoad（含单飞）/ keys / stats。 */
export function createMemoryCache(options: { now?: () => number } = {}): Cache {
  const now = options.now ?? ((): number => Date.now());
  const entries = new Map<string, Entry>();
  const inflight = new Map<string, Promise<unknown>>();
  const stats: CacheStats = {
    memory: { hits: 0, misses: 0 },
    disk: { hits: 0, misses: 0 },
    loads: 0,
    coalesced: 0,
    degraded: 0,
  };

  const isFresh = (entry: Entry): boolean => entry.expiresAt === null || entry.expiresAt > now();

  const cache: Cache = {
    async get<T>(key: string): Promise<CacheEntry<T> | undefined> {
      const entry = entries.get(key);
      if (entry === undefined || !isFresh(entry)) {
        stats.memory.misses += 1;
        return undefined;
      }
      stats.memory.hits += 1;
      return { key, value: entry.value as T, storedAt: entry.storedAt, expiresAt: entry.expiresAt };
    },
    async set<T>(key: string, value: T, freshness: Freshness): Promise<void> {
      const ttl = FRESHNESS_TTL_MS[freshness];
      const storedAt = now();
      entries.set(key, { value, storedAt, expiresAt: ttl === null ? null : storedAt + ttl });
    },
    async getOrLoad<T>(
      key: string,
      freshness: Freshness,
      loader: () => Promise<T>,
      loadOptions?: LoadOptions,
    ): Promise<LoadResult<T>> {
      if (loadOptions?.force !== true) {
        const cached = await cache.get<T>(key);
        if (cached !== undefined) return { value: cached.value, source: 'memory', storedAt: cached.storedAt };
      }
      const pending = inflight.get(key);
      if (pending !== undefined) {
        stats.coalesced += 1;
        return { value: (await pending) as T, source: 'network', storedAt: now() };
      }
      const task = loader().then(async (value) => {
        await cache.set(key, value, freshness);
        return value;
      });
      inflight.set(key, task);
      try {
        stats.loads += 1;
        return { value: await task, source: 'network', storedAt: now() };
      } finally {
        inflight.delete(key);
      }
    },
    async delete(key: string): Promise<void> {
      entries.delete(key);
    },
    async deletePrefix(prefix: string): Promise<void> {
      for (const key of [...entries.keys()]) if (key.startsWith(prefix)) entries.delete(key);
    },
    async keys(prefix: string): Promise<string[]> {
      return [...entries.keys()].filter((key) => key.startsWith(prefix)).sort();
    },
    stats: (): CacheStats => stats,
    async usage(): Promise<{ entries: number; bytes: number }> {
      return { entries: entries.size, bytes: 0 };
    },
  };
  return cache;
}

export interface StubHttp {
  http: HttpClient;
  /** 依次记录收到的请求 URL。 */
  urls: string[];
}

/** handler 返回响应 JSON；返回 Error 则抛出（模拟传输层失败）。 */
export function createStubHttp(handler: (url: string) => unknown): StubHttp {
  const urls: string[] = [];
  const http: HttpClient = {
    async getJson<T>(request: HttpRequest, signal: AbortSignal): Promise<T> {
      urls.push(request.url);
      if (signal.aborted) throw new PlatformError('aborted', '请求已取消', { platform: 'bilibili' });
      const result = handler(request.url);
      if (result instanceof Error) throw result;
      return result as T;
    },
  };
  return { http, urls };
}

/** nav 响应：给定图片文件名生成 wbi_img（图片名即 WBI 密钥来源）。 */
export function navResponse(imgFile: string, subFile: string, data: Record<string, unknown> = {}): unknown {
  return {
    code: -101,
    message: '账号未登录',
    data: {
      isLogin: false,
      wbi_img: {
        img_url: `https://i0.hdslb.com/bfs/wbi/${imgFile}.png`,
        sub_url: `https://i0.hdslb.com/bfs/wbi/${subFile}.png`,
      },
      ...data,
    },
  };
}
