import type { Cookie } from "@/types/cookie";

// 默认配置
const DEFAULT_CONFIG = {
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000",
  timeout: 60000, // 60秒超时 - 增加基础超时时间
  downloadTimeout: 300000, // 5分钟下载超时
  pollInterval: 3000, // 3秒轮询间隔
  pollTimeout: 1800000, // 30分钟轮询超时
};

// API配置接口
interface ApiConfig {
  baseURL?: string;
  timeout?: number;
  downloadTimeout?: number;
  pollInterval?: number;
  pollTimeout?: number;
}

// 全局API配置
let apiConfig: Required<ApiConfig> = { ...DEFAULT_CONFIG };

/**
 * 设置API配置
 * @param config API配置选项
 */
export function setApiConfig(config: ApiConfig) {
  apiConfig = { ...apiConfig, ...config };
}

/**
 * 获取当前API配置
 * @returns 当前API配置
 */
export function getApiConfig(): Required<ApiConfig> {
  return { ...apiConfig };
}

/**
 * 构建完整的API URL
 * @param endpoint API端点
 * @returns 完整的URL
 */
function buildUrl(endpoint: string): string {
  const baseURL = apiConfig.baseURL.replace(/\/$/, ""); // 移除末尾斜杠
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  return `${baseURL}${cleanEndpoint}`;
}

/**
 * 带超时的fetch请求
 * @param url 请求URL
 * @param options fetch选项
 * @param customTimeout 自定义超时时间
 * @returns Promise<Response>
 */
async function fetchWithTimeout(url: string, options: RequestInit = {}, customTimeout?: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = customTimeout || apiConfig.timeout;
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`请求超时 (${timeout}ms)`);
    }
    throw error;
  }
}

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

export async function startCrawlTask(bv: string, cookies: Cookie[]) {
  try {
    const url = buildUrl("/api/crawl");
    console.log("发送爬取请求到:", url);
    
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
    
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestData),
    });
    
    if (!res.ok) {
      // 获取详细错误信息，特别是422错误
      const errorText = await res.text();
      console.error("API 错误响应:", errorText);
      
      if (res.status === 422) {
        let errorDetail = "数据验证失败";
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.detail) {
            // 格式化 FastAPI 的验证错误信息
            errorDetail = Array.isArray(errorData.detail) 
              ? errorData.detail.map((e: { loc?: string[]; msg: string }) => `${e.loc?.join('.')}: ${e.msg}`).join(', ')
              : errorData.detail;
          }
        } catch {
          errorDetail = errorText;
        }
        return { error: `数据格式错误: ${errorDetail}` };
      }
      
      return { error: `HTTP ${res.status}: ${res.statusText}` };
    }
    
    return await res.json();
  } catch (error) {
    console.error("API调用失败:", error);
    if (error instanceof Error) {
      return { error: `网络请求失败: ${error.message}` };
    }
    return { error: "网络请求失败，请检查后端服务是否启动" };
  }
}

export async function getCrawlStatus(taskId: string) {
  try {
    const url = buildUrl(`/api/status/${taskId}`);
    console.log("查询任务状态:", url);
    
    const res = await fetchWithTimeout(url);
    
    if (!res.ok) {
      // 详细的错误处理
      const errorText = await res.text();
      console.error("状态查询失败:", errorText);
      
      return { 
        error: `HTTP ${res.status}: ${res.statusText}`,
        status: "ERROR",
        progress: `状态查询失败: ${res.status}`,
        task_id: taskId
      };
    }
    
    const data = await res.json();
    
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
    
    return {
      error: error instanceof Error ? `网络请求失败: ${error.message}` : "网络请求失败，请检查后端服务是否启动",
      status: "ERROR", 
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
    const url = buildUrl(`/api/download/${taskId}`);
    console.log("=== 开始下载评论数据 ===");
    console.log("下载URL:", url);
    console.log("任务ID:", taskId);
    
    // 使用更长的下载超时时间
    const res = await fetchWithTimeout(url, {}, apiConfig.downloadTimeout);
    
    console.log("响应状态:", res.status);
    console.log("响应状态文本:", res.statusText);
    console.log("所有响应头:", Array.from(res.headers.entries()));
    
    if (!res.ok) {
      const errorText = await res.text();
      console.error("下载失败:", errorText);
      console.error("响应状态:", res.status);
      return { error: `HTTP ${res.status}: ${res.statusText}` };
    }

    // ...existing code...

    // 获取并解析 Content-Disposition 头
    const contentDisposition = res.headers.get('Content-Disposition');
    let filename = 'comments.json'; // 默认文件名
    
    console.log("=== 文件名解析 ===");
    console.log("Content-Disposition 原始值:", contentDisposition);
    
    if (contentDisposition) {
      // 尝试多种解析方式
      console.log("开始解析文件名...");
      
      // 方法1: 解析 filename*=UTF-8'' 格式（RFC 6266）
      const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;,\n]*)/i);
      if (utf8Match && utf8Match[1]) {
        try {
          filename = decodeURIComponent(utf8Match[1]);
          console.log("✅ 使用 UTF-8 编码解析:", filename);
        } catch (e) {
          console.warn("❌ UTF-8 文件名解码失败:", e);
        }
      } else {
        // 方法2: 解析普通 filename="" 格式
        const normalMatch = contentDisposition.match(/filename="([^"]+)"/i);
        if (normalMatch && normalMatch[1]) {
          filename = normalMatch[1];
          console.log("✅ 使用普通格式解析:", filename);
        } else {
          // 方法3: 解析无引号的 filename=xxx 格式
          const simpleMatch = contentDisposition.match(/filename=([^;,\n]+)/i);
          if (simpleMatch && simpleMatch[1]) {
            filename = simpleMatch[1].trim();
            console.log("✅ 使用简单格式解析:", filename);
          } else {
            console.warn("❌ 无法解析文件名，使用默认名称");
          }
        }
      }
    } else {
      console.warn("❌ 响应中没有 Content-Disposition 头");
    }
    
    console.log("最终使用的文件名:", filename);
    
    // 获取文件内容
    console.log("=== 获取文件内容 ===");
    const blob = await res.blob();
    console.log("文件大小:", blob.size, "bytes");
    console.log("文件类型:", blob.type);
    
    if (blob.size === 0) {
      console.error("❌ 文件大小为0，可能下载失败");
      return { error: "下载的文件为空" };
    }
    
    // 创建下载链接
    console.log("=== 创建下载链接 ===");
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    link.style.display = 'none'; // 隐藏链接
    
    // 添加到DOM并触发下载
    document.body.appendChild(link);
    console.log("触发下载，文件名:", filename);
    link.click();
    
    // 清理资源
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
    
    console.log("✅ 文件下载完成:", filename);
    
    // 解析JSON数据
    const text = await blob.text();
    let jsonData = null;
    try {
      jsonData = JSON.parse(text);
      console.log("✅ JSON数据解析成功");
    } catch (parseError) {
      console.warn("❌ JSON解析失败:", parseError);
    }
    
    return { 
      success: true, 
      filename, 
      fileSize: blob.size,
      contentType: blob.type,
      data: jsonData, // 返回解析后的数据
      blob: blob // 保留原始blob用于下载
    };
    
  } catch (error) {
    console.error("❌ 下载过程中发生错误:", error);
    if (error instanceof Error) {
      return { error: `下载失败: ${error.message}` };
    }
    return { error: "下载失败，请检查后端服务是否启动" };
  }
}

