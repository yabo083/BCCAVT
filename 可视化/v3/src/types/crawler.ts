import { Cookie } from './cookie';
import { CommentData } from './comment';

export interface CrawlerState {
  // Cookie 相关状态
  cookies: Cookie[];
  cookiesLoading: boolean;
  
  // API 配置相关状态
  baseUrl: string;
  showApiConfig: boolean;
  
  // 爬取任务相关状态
  bv: string;
  currentTaskId: string;
  crawlStatus: string;
  progress: number | null;
  isDownloading: boolean;
  showDownloadButton: boolean;
  
  // 数据文件相关状态
  downloadedFiles: DownloadedFile[];
  
  // 通用状态
  isLoading: boolean;
  currentUrl: string;
}

export interface DownloadedFile {
  id: string;
  name: string;
  taskId: string;
  downloadUrl?: string;
  createdAt: Date;
  size?: number;
  data?: CommentData[]; // 缓存的评论数据
  hasCache?: boolean; // 标记是否有缓存数据（用于序列化）
}

export interface CrawlerActions {
  // Cookie 操作
  getCookiesFromExtension: (
    onSuccess?: (count: number) => void,
    onError?: (error: string) => void
  ) => void;
  loadCookiesFromStorage: () => void;
  clearCookies: () => void;
  clearExpiredCookies: () => void;
  
  // API 配置操作
  saveApiConfig: () => void;
  resetApiConfig: () => void;
  toggleApiConfig: () => void;
  setBaseUrl: (url: string) => void;
  
  // 爬取操作
  setBv: (bv: string) => void;
  startCrawl: () => Promise<void>;
  downloadFile: (taskId: string) => Promise<void>;
  stopPolling: () => void;
  
  // 文件操作
  deleteFile: (fileId: string) => void;
  visualizeFile: (fileId: string) => void;
  
  // 状态操作
  setMessage: (message: string) => void;
  clearMessage: () => void;
}

// 组合类型
export type CrawlerStore = CrawlerState & CrawlerActions;
