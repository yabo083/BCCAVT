import type { Cookie } from "@/types/cookie";

// 默认配置
const DEFAULT_CONFIG = {
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000",
  timeout: 30000, // 30秒超时
};

// API配置接口
interface ApiConfig {
  baseURL?: string;
  timeout?: number;
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
 * @returns Promise<Response>
 */
async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), apiConfig.timeout);

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
      throw new Error(`请求超时 (${apiConfig.timeout}ms)`);
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

/**
 * 下载爬取完成的评论数据
 * @param taskId 任务ID
 * @returns 下载结果
 */
export async function downloadCommentData(taskId: string) {
  try {
    const url = buildUrl(`/api/download/${taskId}`);
    console.log("下载评论数据:", url);
    
    const res = await fetchWithTimeout(url);
    
    if (!res.ok) {
      const errorText = await res.text();
      console.error("下载失败:", errorText);
      return { error: `HTTP ${res.status}: ${res.statusText}` };
    }
    
    // 获取文件名
    const contentDisposition = res.headers.get('Content-Disposition');
    let filename = 'comments.json';
    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
      if (filenameMatch && filenameMatch[1]) {
        filename = filenameMatch[1].replace(/['"]/g, '');
      }
    }
    
    // 获取文件内容
    const blob = await res.blob();
    
    // 创建下载链接
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
    
    return { success: true, filename };
  } catch (error) {
    console.error("下载失败:", error);
    if (error instanceof Error) {
      return { error: `下载失败: ${error.message}` };
    }
    return { error: "下载失败，请检查后端服务是否启动" };
  }
}