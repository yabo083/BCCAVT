import { useState, useEffect, useRef, useCallback } from "react";
import { CrawlerStore, DownloadedFile } from "@/types/crawler";
import { Cookie } from "@/types/cookie";
import {
  startCrawlTask,
  getCrawlStatus,
  setApiConfig,
  downloadCommentData,
  getApiConfig,
} from "@/utils/api";
import { dataStorage } from "@/utils/dataStorage";

export const useCrawlerStore = (): CrawlerStore => {
  // 状态定义
  const [cookies, setCookies] = useState<Cookie[]>([]);
  const [cookiesLoading, setCookiesLoading] = useState(false);
  const [baseUrl, setBaseUrl] = useState<string>("http://localhost:8000");
  const [showApiConfig, setShowApiConfig] = useState(false);
  const [bv, setBv] = useState("");
  const [currentTaskId, setCurrentTaskId] = useState<string>("");
  const [crawlStatus, setCrawlStatus] = useState<string>("");
  const [progress, setProgress] = useState<number | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [showDownloadButton, setShowDownloadButton] = useState(false);
  const [downloadedFiles, setDownloadedFiles] = useState<DownloadedFile[]>([]);
  const [isLoading] = useState(false);
  const [currentUrl] = useState("");

  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const pollStartTimeRef = useRef<number>(0); // 轮询开始时间

  // 检查是否在浏览器环境中
  const isBrowser = typeof window !== "undefined";

  // 辅助函数
  const saveDownloadedFiles = useCallback(async (files: DownloadedFile[]) => {
    try {
      // 保存文件元信息到 localStorage
      const filesForStorage = files.map(file => ({
        ...file,
        data: undefined, // 不保存数据到localStorage
        hasCache: !!file.data // 标记是否有缓存数据
      }));
      localStorage.setItem("downloaded_files", JSON.stringify(filesForStorage));
      
      // 保存缓存数据到 IndexedDB
      for (const file of files) {
        if (file.data) {
          await dataStorage.saveData(file.id, file.data);
        }
      }
    } catch (error) {
      console.error("保存已下载文件列表失败:", error);
    }
  }, []);

  const loadDownloadedFiles = useCallback(async () => {
    try {
      const savedFiles = localStorage.getItem("downloaded_files");
      if (savedFiles) {
        const parsedFiles = JSON.parse(savedFiles);
        
        // 恢复缓存数据
        const filesWithCache = await Promise.all(
          parsedFiles.map(async (file: DownloadedFile & { hasCache?: boolean }) => {
            if (file.hasCache) {
              try {
                const cachedData = await dataStorage.getData(file.id);
                return { ...file, data: cachedData };
              } catch (error) {
                console.warn(`加载文件 ${file.id} 的缓存数据失败:`, error);
                return file;
              }
            }
            return file;
          })
        );
        
        setDownloadedFiles(filesWithCache);
        console.log(`🔄 文件加载完成: 总共 ${filesWithCache.length} 个文件`);
        console.log(`📦 其中有缓存数据的文件: ${filesWithCache.filter(f => f.data).length} 个`);
        console.log('📋 文件详情:', filesWithCache.map(f => ({ 
          name: f.name, 
          hasData: !!f.data, 
          dataSize: f.data ? f.data.length : 0 
        })));
      }
    } catch (error) {
      console.error("读取已下载文件列表失败:", error);
    }
  }, []);

  const loadCookiesFromStorage = useCallback(() => {
    try {
      const savedCookies = localStorage.getItem("bilibili_cookies");
      if (savedCookies) {
        const parsedCookies = JSON.parse(savedCookies);
        setCookies(parsedCookies);
      }
    } catch (error) {
      console.error("读取本地存储时发生错误:", error);
    }
  }, []);

  // 轮询任务进度
  const startPolling = useCallback((task_id: string) => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    
    // 记录轮询开始时间
    pollStartTimeRef.current = Date.now();
    const config = getApiConfig();
    
    console.log(`🔄 开始轮询任务 ${task_id}，间隔: ${config.pollInterval}ms，超时: ${config.pollTimeout}ms`);
    
    pollingRef.current = setInterval(async () => {
      try {
        // 检查轮询是否超时
        const elapsedTime = Date.now() - pollStartTimeRef.current;
        if (elapsedTime > config.pollTimeout) {
          console.warn(`⏰ 轮询超时 (${elapsedTime}ms)，停止轮询`);
          clearInterval(pollingRef.current!);
          setCrawlStatus(`轮询超时 (${Math.round(elapsedTime / 1000)}秒)，任务可能仍在后台运行。请稍后手动刷新页面查看状态。`);
          return;
        }
        
        const data = await getCrawlStatus(task_id);

        if (data.error) {
          console.error("轮询获取状态时出错:", data.error);
          setCrawlStatus(`状态查询失败: ${data.error}`);
          // 对于网络错误，继续轮询而不停止
          if (!data.error.includes("网络") && !data.error.includes("超时")) {
            clearInterval(pollingRef.current!);
            return;
          }
        }

        const status = data.status || "UNKNOWN";
        const progressText = data.progress || "";

        if (progressText) {
          setCrawlStatus(progressText);
        }

        if (typeof data.progress === "number") {
          setProgress(data.progress);
        }

        const terminalStates = ["SUCCESS", "FAILURE", "REVOKED", "ERROR"];

        if (terminalStates.includes(status)) {
          clearInterval(pollingRef.current!);
          console.log(`✅ 轮询结束，最终状态: ${status}`);

          if (status === "SUCCESS") {
            setShowDownloadButton(true);
            setCrawlStatus("爬取完成！点击下载按钮获取评论数据");
          } else if (status === "FAILURE") {
            setCrawlStatus(`任务失败: ${data.error || "未知错误"}`);
          } else {
            setCrawlStatus(`任务状态: ${status}`);
          }
        } else {
          // 显示已经轮询的时间
          const minutes = Math.floor(elapsedTime / 60000);
          const seconds = Math.floor((elapsedTime % 60000) / 1000);
          const timeStr = minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`;
          console.log(`🔍 轮询中... 状态: ${status}, 已运行: ${timeStr}`);
        }
      } catch (error) {
        console.error("轮询失败:", error);
        const elapsedTime = Date.now() - pollStartTimeRef.current;
        const minutes = Math.floor(elapsedTime / 60000);
        const seconds = Math.floor((elapsedTime % 60000) / 1000);
        const timeStr = minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`;
        setCrawlStatus(`状态查询失败: 网络错误 (已运行: ${timeStr})`);
      }
    }, config.pollInterval);
  }, []);

  // 初始化
  useEffect(() => {
    if (isBrowser) {
      // 初始化数据存储
      const initStorage = async () => {
        try {
          await dataStorage.init();
          // 清理过期数据
          await dataStorage.cleanExpiredData();
          console.log("数据存储初始化完成");
        } catch (error) {
          console.error("数据存储初始化失败:", error);
        }
      };
      
      initStorage();
      loadCookiesFromStorage();
      loadDownloadedFiles();
    }
  }, [isBrowser, loadCookiesFromStorage, loadDownloadedFiles]);

  // 清理
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  // 操作函数
  const getCookiesFromExtension = useCallback(
    (
      onSuccess?: (count: number) => void,
      onError?: (error: string) => void
    ) => {
      if (!isBrowser) return;

      setCookiesLoading(true);

      // 设置超时处理
      const timeoutId = setTimeout(() => {
        setCookiesLoading(false);
        onError?.("获取Cookie超时，请确保扩展已安装并启用");
      }, 10000); // 10秒超时

      // 监听一次性消息
      const handleMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        if (event.source !== window) return;

        console.log("收到消息:", event.data);

        if (event.data.type === "BILIBILI_COOKIES_RESULT") {
          clearTimeout(timeoutId);

          window.removeEventListener("message", handleMessage);
          setCookiesLoading(false);

          if (event.data) {
            console.log("获取到Cookie:", event.data.cookies);
            setCookies(event.data.cookies);
            localStorage.setItem(
              "bilibili_cookies",
              JSON.stringify(event.data.cookies)
            );
            onSuccess?.(event.data.cookies.length);
          } else {
            console.error("获取Cookie失败:", event.data.error);
            onError?.(event.data.error || "未知错误");
          }
        }
      };

      window.addEventListener("message", handleMessage);
      window.postMessage({ type: "GET_BILIBILI_COOKIES" }, "*");
    },
    [isBrowser]
  );

  const clearCookies = useCallback(() => {
    console.log("清除所有Cookie");
    
    setCookies([]);
    if (isBrowser) {
      localStorage.removeItem("bilibili_cookies");
    }
  }, [isBrowser]);

  const clearExpiredCookies = useCallback(() => {
    console.log("清除过期Cookie");
    const now = Date.now();
    const validCookies = cookies.filter((cookie) => {
      return !cookie.expirationDate || cookie.expirationDate * 1000 > now;
    });

    if (validCookies.length < cookies.length) {
        console.log(`清除过期Cookie: ${cookies.length - validCookies.length} 个`);
      setCookies(validCookies);
      if (isBrowser) {
        localStorage.setItem("bilibili_cookies", JSON.stringify(validCookies));
      }
    }
  }, [cookies, isBrowser]);

  const saveApiConfig = useCallback(async () => {
    try {
      if (!baseUrl.trim()) {
        return;
      }

      await setApiConfig({ baseURL: baseUrl.trim() });
    } catch (error) {
      console.error("设置API配置失败:", error);
    }
  }, [baseUrl]);

  const resetApiConfig = useCallback(() => {
    const defaultUrl = "http://localhost:8000";
    setBaseUrl(defaultUrl);
  }, []);

  const toggleApiConfig = useCallback(() => {
    setShowApiConfig(!showApiConfig);
  }, [showApiConfig]);

  const startCrawl = useCallback(async () => {
    if (!bv.trim()) {
      setCrawlStatus("请输入BV号");
      return;
    }

    if (cookies.length === 0) {
      setCrawlStatus("请先获取Cookie");
      return;
    }

    setCrawlStatus("提交爬取任务中...");
    setShowDownloadButton(false);
    setProgress(null);

    const bvId = bv.trim();
    setCurrentTaskId("");

    try {
      const data = await startCrawlTask(bvId, cookies);
      if (data && data.task_id) {
        setCrawlStatus("任务已提交，正在爬取...");
        setCurrentTaskId(data.task_id);
        startPolling(data.task_id);
      } else {
        setCrawlStatus("任务提交失败: " + (data.error || "未知错误"));
      }
    } catch (err) {
      console.error("爬取任务错误:", err);
      setCrawlStatus("请求失败: 后端API尚未实现，请先开发后端接口");
    }
  }, [bv, cookies, startPolling]);

  const downloadFile = useCallback(
    async (taskId: string) => {
      setIsDownloading(true);
      setCrawlStatus("正在下载文件，请稍候...");

      try {
        const result = await downloadCommentData(taskId);
        if (result.error) {
          console.error("下载失败:", result.error);
          setCrawlStatus(`下载失败: ${result.error}`);
        } else {
          // 触发文件下载
          if (result.blob) {
            const downloadUrl = window.URL.createObjectURL(result.blob);
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.download = result.filename || `${bv}_comments.json`;
            link.style.display = 'none';
            
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(downloadUrl);
          }
          
          // 添加到已下载文件列表（包含缓存的数据）
          const newFile: DownloadedFile = {
            id: Date.now().toString(),
            name: result.filename || `${bv}_comments.json`,
            taskId: taskId,
            createdAt: new Date(),
            size: result.fileSize,
            data: result.data, // 缓存解析后的JSON数据
          };
          const updatedFiles = [newFile, ...downloadedFiles];
          setDownloadedFiles(updatedFiles);
          await saveDownloadedFiles(updatedFiles);
          
          setCrawlStatus("文件下载完成！");
        }
      } catch (error) {
        console.error("下载错误:", error);
        setCrawlStatus(`下载出错: ${error instanceof Error ? error.message : "未知错误"}`);
      } finally {
        setIsDownloading(false);
      }
    },
    [bv, downloadedFiles, saveDownloadedFiles]
  );

  // 文件操作
  const deleteFile = useCallback(
    async (fileId: string) => {
      // 删除 IndexedDB 中的缓存数据
      try {
        await dataStorage.deleteData(fileId);
      } catch (error) {
        console.warn("删除缓存数据失败:", error);
      }
      
      const updatedFiles = downloadedFiles.filter((file) => file.id !== fileId);
      setDownloadedFiles(updatedFiles);
      await saveDownloadedFiles(updatedFiles);
    },
    [downloadedFiles, saveDownloadedFiles]
  );

  const visualizeFile = useCallback(
    (fileId: string) => {
      const file = downloadedFiles.find((f) => f.id === fileId);
      if (file) {
        if (isBrowser) {
          // 如果有缓存的数据，直接传递给可视化页面
          if (file.data) {
            // 将数据存储在sessionStorage中，供可视化页面使用
            sessionStorage.setItem('visualizationData', JSON.stringify({
              filename: file.name,
              data: file.data
            }));
            window.location.href = `/visualization?cached=true`;
          } else {
            // 如果没有缓存数据，提示用户重新下载
            if (confirm('该文件的数据未缓存，需要重新下载数据才能进行可视化。是否立即重新下载？')) {
              // 重新下载文件
              downloadFile(file.taskId);
            }
          }
        }
      }
    },
    [downloadedFiles, isBrowser, downloadFile]
  );

  // 通用操作
  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
      setCrawlStatus("已停止状态轮询");
    }
  }, []);

  const setMessage = useCallback((message: string) => {
    // 这个函数保留但不做任何操作，保持接口兼容性
    console.log("消息:", message);
  }, []);

  const clearMessage = useCallback(() => {
    // 这个函数保留但不做任何操作，保持接口兼容性
  }, []);

  return {
    // 状态
    cookies,
    cookiesLoading,
    baseUrl,
    showApiConfig,
    bv,
    currentTaskId,
    crawlStatus,
    progress,
    isDownloading,
    showDownloadButton,
    downloadedFiles,
    isLoading,
    currentUrl,

    // 操作
    getCookiesFromExtension,
    loadCookiesFromStorage,
    clearCookies,
    clearExpiredCookies,
    saveApiConfig,
    resetApiConfig,
    toggleApiConfig,
    setBaseUrl,
    setBv,
    startCrawl,
    downloadFile,
    deleteFile,
    visualizeFile,
    stopPolling,
    setMessage,
    clearMessage,
  };
};
