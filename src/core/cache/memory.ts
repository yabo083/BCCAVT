import type { CacheEntry } from './types';

/**
 * 内存层：单个 Map 的插入序即 LRU 顺序。
 * 读取命中先删后插（提升热度），写入超出容量时从表头淘汰；容量 <= 0 表示不缓存。
 */
export class MemoryLru {
  private readonly entries = new Map<string, CacheEntry<unknown>>();

  constructor(private readonly capacity: number) {}

  get(key: string, now: number): CacheEntry<unknown> | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  set(entry: CacheEntry<unknown>): void {
    if (this.capacity <= 0) return;
    this.entries.delete(entry.key);
    this.entries.set(entry.key, entry);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  deletePrefix(prefix: string): void {
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }

  keys(prefix: string): string[] {
    return [...this.entries.keys()].filter((key) => key.startsWith(prefix));
  }
}
