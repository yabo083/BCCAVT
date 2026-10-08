import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

/** 磁盘层的存储形态：元数据与值放同一条记录，扫表时不必读值就能估算占用。 */
export interface DiskRecord {
  key: string;
  value: unknown;
  storedAt: number;
  expiresAt: number | null;
  lastAccess: number;
  bytes: number;
}

interface CacheDbSchema extends DBSchema {
  entries: { key: string; value: DiskRecord };
}

const STORE = 'entries';

/**
 * IndexedDB 层。任何失败都由调用方降级，本类只如实抛出。
 * 打开失败后置 failed，后续操作直接失败，不再反复尝试。
 */
export class DiskStore {
  private opening: Promise<IDBPDatabase<CacheDbSchema>> | null = null;
  private failed = false;

  constructor(private readonly dbName: string) {}

  get usable(): boolean {
    return !this.failed;
  }

  private open(): Promise<IDBPDatabase<CacheDbSchema>> {
    if (this.opening === null) {
      try {
        const promise = openDB<CacheDbSchema>(this.dbName, 1, {
          upgrade(db) {
            db.createObjectStore(STORE, { keyPath: 'key' });
          },
        });
        promise.catch(() => {
          this.failed = true;
        });
        this.opening = promise;
      } catch (error) {
        // indexedDB 不存在时 openDB 会同步抛出。
        this.failed = true;
        this.opening = Promise.reject(error);
      }
    }
    return this.opening;
  }

  async get(key: string): Promise<DiskRecord | undefined> {
    return (await this.open()).get(STORE, key);
  }

  async put(record: DiskRecord): Promise<void> {
    await (await this.open()).put(STORE, record);
  }

  async touch(key: string, at: number): Promise<void> {
    const db = await this.open();
    const record = await db.get(STORE, key);
    if (record === undefined) return;
    record.lastAccess = at;
    await db.put(STORE, record);
  }

  async delete(key: string): Promise<void> {
    await (await this.open()).delete(STORE, key);
  }

  async deleteMany(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    const tx = (await this.open()).transaction(STORE, 'readwrite');
    for (const key of keys) void tx.store.delete(key);
    await tx.done;
  }

  async keys(prefix: string): Promise<string[]> {
    const db = await this.open();
    const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`);
    return (await db.getAllKeys(STORE, range)) as string[];
  }

  async usage(): Promise<{ entries: number; bytes: number }> {
    const db = await this.open();
    let entries = 0;
    let bytes = 0;
    for await (const cursor of db.transaction(STORE).store) {
      entries++;
      bytes += cursor.value.bytes;
    }
    return { entries, bytes };
  }

  /** 超出预算时按 lastAccess 从旧到新淘汰，一次扫描删到预算的 90%（滞回，避免每次写入都扫表）。 */
  async evictTo(budgetBytes: number): Promise<void> {
    const db = await this.open();
    const records: Array<{ key: string; lastAccess: number; bytes: number }> = [];
    let total = 0;
    for await (const cursor of db.transaction(STORE).store) {
      records.push({ key: cursor.value.key, lastAccess: cursor.value.lastAccess, bytes: cursor.value.bytes });
      total += cursor.value.bytes;
    }
    if (total <= budgetBytes) return;

    const target = budgetBytes * 0.9;
    records.sort((a, b) => a.lastAccess - b.lastAccess || (a.key < b.key ? -1 : 1));
    const doomed: string[] = [];
    for (const record of records) {
      if (total <= target) break;
      doomed.push(record.key);
      total -= record.bytes;
    }
    await this.deleteMany(doomed);
  }
}
