/**
 * IndexedDB 数据存储工具
 * 用于存储大容量的评论数据
 */

import { CommentData } from '@/types/comment';

export interface StoredData {
  id: string;
  data: CommentData[];
  timestamp: number;
}

class DataStorage {
  private dbName = 'BCCAVT_DataCache';
  private version = 1;
  private storeName = 'commentData';
  private db: IDBDatabase | null = null;
  private isSupported = true;

  constructor() {
    // 检查 IndexedDB 支持情况
    this.isSupported = typeof window !== 'undefined' && 'indexedDB' in window;
    if (!this.isSupported) {
      console.warn('IndexedDB 不支持，数据缓存功能将被禁用');
    }
  }

  /**
   * 初始化数据库
   */
  async init(): Promise<void> {
    if (!this.isSupported) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => {
        reject(new Error('Failed to open IndexedDB'));
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // 如果对象存储不存在，创建它
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });
  }

  /**
   * 保存数据
   */
  async saveData(id: string, data: CommentData[]): Promise<void> {
    if (!this.isSupported) {
      console.warn('IndexedDB 不支持，无法保存缓存数据');
      return Promise.resolve();
    }

    if (!this.db) {
      await this.init();
    }

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      
      const storedData: StoredData = {
        id,
        data,
        timestamp: Date.now()
      };

      const request = store.put(storedData);

      request.onsuccess = () => {
        console.log(`数据已保存到 IndexedDB: ${id}`);
        resolve();
      };

      request.onerror = () => {
        reject(new Error(`Failed to save data: ${id}`));
      };
    });
  }

  /**
   * 获取数据
   */
  async getData(id: string): Promise<CommentData[] | null> {
    if (!this.isSupported) {
      return Promise.resolve(null);
    }

    if (!this.db) {
      await this.init();
    }

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(id);

      request.onsuccess = () => {
        const result = request.result;
        if (result) {
          console.log(`从 IndexedDB 加载数据: ${id}`);
          resolve(result.data);
        } else {
          resolve(null);
        }
      };

      request.onerror = () => {
        reject(new Error(`Failed to get data: ${id}`));
      };
    });
  }

  /**
   * 删除数据
   */
  async deleteData(id: string): Promise<void> {
    if (!this.isSupported) {
      return Promise.resolve();
    }

    if (!this.db) {
      await this.init();
    }

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(id);

      request.onsuccess = () => {
        console.log(`已从 IndexedDB 删除数据: ${id}`);
        resolve();
      };

      request.onerror = () => {
        reject(new Error(`Failed to delete data: ${id}`));
      };
    });
  }

  /**
   * 清理过期数据（超过30天的数据）
   */
  async cleanExpiredData(): Promise<void> {
    if (!this.isSupported) {
      return Promise.resolve();
    }

    if (!this.db) {
      await this.init();
    }

    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const index = store.index('timestamp');
      
      const range = IDBKeyRange.upperBound(thirtyDaysAgo);
      const request = index.openCursor(range);

      const toDelete: string[] = [];

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          toDelete.push(cursor.value.id);
          cursor.continue();
        } else {
          // 删除所有过期数据
          Promise.all(toDelete.map(id => this.deleteData(id)))
            .then(() => {
              console.log(`清理了 ${toDelete.length} 条过期数据`);
              resolve();
            })
            .catch(reject);
        }
      };

      request.onerror = () => {
        reject(new Error('Failed to clean expired data'));
      };
    });
  }

  /**
   * 获取所有已存储的数据ID
   */
  async getAllDataIds(): Promise<string[]> {
    if (!this.isSupported) {
      return Promise.resolve([]);
    }

    if (!this.db) {
      await this.init();
    }

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAllKeys();

      request.onsuccess = () => {
        resolve(request.result as string[]);
      };

      request.onerror = () => {
        reject(new Error('Failed to get all data IDs'));
      };
    });
  }
}

// 导出单例实例
export const dataStorage = new DataStorage();
