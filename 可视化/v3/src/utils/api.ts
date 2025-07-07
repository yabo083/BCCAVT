import type { Cookie } from "@/types/cookie";
import { apiClient, configureApiClient, initializeApiClient, type ApiError } from "@/lib/apiClient";

// ==================== 配置管理 ====================

// 默认配置
const DEFAULT_CONFIG = {
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000",
  timeout: 60000, // 60秒超时 - 增加基础超时时间
  downloadTimeout: 300000, // 5分钟下载超时
  pollInterval: 3000, // 3秒轮询间隔
  pollTimeout: 1800000, // 30分钟轮询超时
};

// API配置接口（向后兼容）
interface ApiConfig {
  baseURL?: string;
  timeout?: number;
  downloadTimeout?: number;
  pollInterval?: number;
  pollTimeout?: number;
}

// 全局API配置（向后兼容）
let apiConfig: Required<ApiConfig> = { ...DEFAULT_CONFIG };

/**
 * 设置API配置（向后兼容）
 * @param config API配置选项
 */
export function setApiConfig(config: ApiConfig) {
  apiConfig = { ...apiConfig, ...config };
  
  // 同时更新新的 apiClient 配置
  configureApiClient({
    baseURL: config.baseURL,
    timeout: config.timeout,
    downloadTimeout: config.downloadTimeout,
  });
  
  // 持久化保存到localStorage
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem("api_config", JSON.stringify(apiConfig));
      console.log("API配置已保存:", apiConfig);
    } catch (error) {
      console.error("保存API配置失败:", error);
    }
  }
}

/**
 * 获取当前API配置（向后兼容）
 * @returns 当前API配置
 */
export function getApiConfig(): Required<ApiConfig> {
  return { ...apiConfig };
}

/**
 * 初始化API配置（从localStorage加载）
 */
export function initApiConfig() {
  if (typeof window !== "undefined") {
    try {
      const savedConfig = localStorage.getItem("api_config");
      if (savedConfig) {
        const parsedConfig = JSON.parse(savedConfig);
        apiConfig = { ...DEFAULT_CONFIG, ...parsedConfig };
        
        // 同时初始化新的 apiClient
        configureApiClient({
          baseURL: parsedConfig.baseURL,
          timeout: parsedConfig.timeout,
          downloadTimeout: parsedConfig.downloadTimeout,
        });
        
        console.log("已从本地存储加载API配置:", apiConfig);
      } else {
        // 如果没有旧配置，尝试初始化新的 apiClient
        initializeApiClient();
      }
    } catch (error) {
      console.error("加载API配置失败:", error);
      // 使用默认配置
      apiConfig = { ...DEFAULT_CONFIG };
    }
  }
}

// ==================== 业务逻辑函数 ====================

/**
 * 验证关键Cookie是否存在
 * @param cookies Cookie数组
 * @returns 验证结果
 */
function validateRequiredCookies(cookies: Cookie[]): { isValid: boolean; missing: string[] } {
  const requiredCookies = ['SESSDATA', 'bili_jct', 'buvid3', 'DedeUserID'];
  const missing: string[] = [];
  
  for (const cookieName of requiredCookies) {
    const cookie = cookies.find(c => c.name === cookieName);
    if (!cookie || !cookie.value) {
      missing.push(cookieName);
    }
  }
  
  return {
    isValid: missing.length === 0,
    missing
  };
}

/**
 * 开始爬取任务
 * @param bv BV号
 * @param cookies Cookie数组
 * @returns 爬取任务结果
 */
export async function startCrawlTask(bv: string, cookies: Cookie[]) {
  try {
    console.log("发送爬取请求到:", "/api/crawl");
    
    // 验证BV号格式
    const bvId = bv.trim();
    if (!bvId.startsWith('BV') || bvId.length !== 12) {
      return { error: "无效的BV号格式，应该是类似 'BV1AYKgzAE68' 的12位格式" };
    }
    
    // 验证关键Cookie是否存在
    const cookieValidation = validateRequiredCookies(cookies);
    if (!cookieValidation.isValid) {
      return { 
        error: `缺少必要的Cookie: ${cookieValidation.missing.join(', ')}。请确保已登录Bilibili并获取完整的Cookie。` 
      };
    }
    
    // 转换 cookies 数组为后端期望的单个 cookie 对象
    const cookieObj = {
      sessdata: cookies.find(c => c.name === 'SESSDATA')?.value || '',
      bili_jct: cookies.find(c => c.name === 'bili_jct')?.value || '',
      buvid3: cookies.find(c => c.name === 'buvid3')?.value || '',
      dedeuserid: cookies.find(c => c.name === 'DedeUserID')?.value || '',
      ac_time_value: cookies.find(c => c.name === 'ac_time_value')?.value || '',
    };
    
    // 构建请求数据，匹配后端 CrawlRequest 模型
    const requestData = {
      bv_id: bvId,      // 后端期望 bv_id 字段
      cookie: cookieObj // 后端期望 cookie 对象
    };
    
    console.log("发送的数据:", JSON.stringify(requestData, null, 2));
    console.log("提取的关键Cookie:", {
      sessdata: cookieObj.sessdata ? `已提取 (${cookieObj.sessdata.substring(0, 20)}...)` : '未找到',
      bili_jct: cookieObj.bili_jct ? '已提取' : '未找到',
      buvid3: cookieObj.buvid3 ? '已提取' : '未找到',
      dedeuserid: cookieObj.dedeuserid ? '已提取' : '未找到',
    });
    
    // 使用新的 apiClient
    const response = await apiClient.post("/api/crawl", requestData);
    return response.data;
    
  } catch (error) {
    console.error("API调用失败:", error);
    
    if (error && typeof error === 'object' && 'status' in error) {
      const apiError = error as ApiError;
      return { error: apiError.message };
    }
    
    if (error instanceof Error) {
      return { error: `网络请求失败: ${error.message}` };
    }
    return { error: "网络请求失败，请检查后端服务是否启动" };
  }
}

/**
 * 获取爬取状态
 * @param taskId 任务ID
 * @returns 任务状态
 */
export async function getCrawlStatus(taskId: string) {
  try {
    console.log("查询任务状态:", `/api/status/${taskId}`);
    
    // 使用新的 apiClient
    const response = await apiClient.get(`/api/status/${taskId}`);
    const data = response.data as Record<string, unknown>;
    
    // 确保返回的数据包含必要的字段
    return {
      task_id: data.task_id || taskId,
      status: data.status || "UNKNOWN",
      progress: data.progress || "状态未知",
      result: data.result || null,
      error: data.error || null,
      download_url: data.download_url || null
    };
    
  } catch (error) {
    console.error("状态查询API调用失败:", error);
    
    let errorMessage = "网络请求失败，请检查后端服务是否启动";
    let httpStatus = "ERROR";
    
    if (error && typeof error === 'object' && 'status' in error) {
      const apiError = error as ApiError;
      errorMessage = apiError.message;
      httpStatus = apiError.status ? String(apiError.status) : "ERROR";
    } else if (error instanceof Error) {
      errorMessage = `网络请求失败: ${error.message}`;
    }
    
    return {
      error: errorMessage,
      status: httpStatus, 
      progress: "网络连接失败",
      task_id: taskId,
      result: null,
      download_url: null
    };
  }
}

/**
 * 下载爬取完成的评论数据
 * @param taskId 任务ID
 * @returns 下载结果
 */
export async function downloadCommentData(taskId: string) {
  try {
    console.log("=== 开始下载评论数据 ===");
    console.log("下载URL:", `/api/download/${taskId}`);
    console.log("任务ID:", taskId);
    
    // 使用新的 apiClient 的下载方法
    const downloadResult = await apiClient.download(`/api/download/${taskId}`, {
      timeout: apiConfig.downloadTimeout
    });
    
    console.log("下载响应:", {
      size: downloadResult.size,
      filename: downloadResult.filename,
      contentType: downloadResult.contentType,
    });
    
    if (downloadResult.size === 0) {
      console.error("❌ 文件大小为0，可能下载失败");
      return { error: "下载的文件为空" };
    }
    
    // 创建下载链接并触发下载
    console.log("=== 创建下载链接 ===");
    const downloadUrl = window.URL.createObjectURL(downloadResult.blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = downloadResult.filename || 'comments.json';
    link.style.display = 'none'; // 隐藏链接
    
    // 添加到DOM并触发下载
    document.body.appendChild(link);
    console.log("触发下载，文件名:", downloadResult.filename);
    link.click();
    
    // 清理资源
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
    
    console.log("✅ 文件下载完成:", downloadResult.filename);
    
    // 解析JSON数据
    const text = await downloadResult.blob.text();
    let jsonData = null;
    try {
      jsonData = JSON.parse(text);
      console.log("✅ JSON数据解析成功");
    } catch (parseError) {
      console.warn("❌ JSON解析失败:", parseError);
    }
    
    return { 
      success: true, 
      filename: downloadResult.filename || 'comments.json', 
      fileSize: downloadResult.size,
      contentType: downloadResult.contentType,
      data: jsonData, // 返回解析后的数据
      blob: downloadResult.blob // 保留原始blob用于下载
    };
    
  } catch (error) {
    console.error("❌ 下载过程中发生错误:", error);
    
    let errorMessage = "下载失败，请检查后端服务是否启动";
    
    if (error && typeof error === 'object' && 'status' in error) {
      const apiError = error as ApiError;
      errorMessage = `下载失败: ${apiError.message}`;
    } else if (error instanceof Error) {
      errorMessage = `下载失败: ${error.message}`;
    }
    
    return { error: errorMessage };
  }
}

