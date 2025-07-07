/**
 * 通用的 API 客户端
 * 
 * 这个模块提供了一个统一的、类型安全的 API 请求客户端，具有以下特性：
 * 1. 自动注入全局标头（包括 ngrok-skip-browser-warning）
 * 2. 统一的错误处理
 * 3. 请求/响应拦截器
 * 4. 智能的响应处理（JSON/文本/文件流）
 * 5. 可配置的超时机制
 * 6. TypeScript 类型安全
 */

// ==================== 类型定义 ====================

/**
 * API 配置接口
 */
export interface ApiClientConfig {
  baseURL?: string;
  timeout?: number;
  downloadTimeout?: number;
  defaultHeaders?: Record<string, string>;
}

/**
 * 请求选项接口
 */
export interface RequestOptions extends Omit<RequestInit, 'body' | 'headers'> {
  timeout?: number;
  headers?: Record<string, string>;
  responseType?: 'json' | 'text' | 'blob' | 'arrayBuffer';
}

/**
 * 标准化的 API 错误接口
 */
export interface ApiError extends Error {
  status?: number;
  response?: unknown;
  code?: string;
}

/**
 * API 响应包装器
 */
export interface ApiResponse<T = unknown> {
  data: T;
  status: number;
  statusText: string;
  headers: Headers;
}

// ==================== 默认配置 ====================

const DEFAULT_CONFIG: Required<ApiClientConfig> = {
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000",
  timeout: 60000, // 60秒
  downloadTimeout: 300000, // 5分钟
  defaultHeaders: {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true', // 🔑 核心：自动绕过 ngrok 警告
  },
};

// ==================== 核心 API 客户端类 ====================

/**
 * API 客户端核心类
 */
class ApiClient {
  private config: Required<ApiClientConfig>;

  constructor(config: ApiClientConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // 合并默认标头和用户自定义标头
    this.config.defaultHeaders = {
      ...DEFAULT_CONFIG.defaultHeaders,
      ...config.defaultHeaders,
    };
  }

  /**
   * 更新客户端配置
   * @param config 新的配置选项
   */
  public updateConfig(config: Partial<ApiClientConfig>): void {
    this.config = { 
      ...this.config, 
      ...config,
      defaultHeaders: {
        ...this.config.defaultHeaders,
        ...config.defaultHeaders,
      }
    };
  }

  /**
   * 获取当前配置
   * @returns 当前配置的副本
   */
  public getConfig(): Required<ApiClientConfig> {
    return { ...this.config };
  }

  /**
   * 构建完整的 URL
   * @param endpoint API 端点
   * @returns 完整的 URL
   */
  private buildUrl(endpoint: string): string {
    const baseURL = this.config.baseURL.replace(/\/$/, "");
    const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    return `${baseURL}${cleanEndpoint}`;
  }

  /**
   * 创建标准化的 API 错误
   * @param message 错误消息
   * @param status HTTP 状态码
   * @param response 响应内容
   * @returns 标准化的 API 错误
   */
  private createApiError(message: string, status?: number, response?: unknown): ApiError {
    const error = new Error(message) as ApiError;
    error.name = 'ApiError';
    error.status = status;
    error.response = response;
    error.code = status ? `HTTP_${status}` : 'NETWORK_ERROR';
    return error;
  }

  /**
   * 智能响应处理器
   * @param response 原始响应对象
   * @param responseType 期望的响应类型
   * @returns 解析后的数据
   */
  private async parseResponse<T = unknown>(
    response: Response,
    responseType: RequestOptions['responseType'] = 'json'
  ): Promise<T> {
    try {
      switch (responseType) {
        case 'json':
          return await response.json();
        case 'text':
          return await response.text() as T;
        case 'blob':
          return await response.blob() as T;
        case 'arrayBuffer':
          return await response.arrayBuffer() as T;
        default:
          // 自动检测响应类型
          const contentType = response.headers.get('content-type');
          if (contentType?.includes('application/json')) {
            return await response.json();
          } else if (contentType?.includes('text/')) {
            return await response.text() as T;
          } else {
            return await response.blob() as T;
          }
      }
    } catch (error) {
      throw this.createApiError(
        `响应解析失败: ${error instanceof Error ? error.message : '未知错误'}`,
        response.status
      );
    }
  }

  /**
   * 核心请求方法
   * @param endpoint API 端点
   * @param options 请求选项
   * @returns API 响应
   */
  private async request<T = unknown>(
    endpoint: string,
    options: RequestOptions & { body?: unknown } = {}
  ): Promise<ApiResponse<T>> {
    const {
      timeout = this.config.timeout,
      headers: customHeaders = {},
      responseType = 'json',
      body,
      ...fetchOptions
    } = options;

    // 构建完整 URL
    const url = this.buildUrl(endpoint);

    // 合并标头
    const headers = {
      ...this.config.defaultHeaders,
      ...customHeaders,
    };

    // 处理请求体
    let processedBody: string | FormData | undefined;
    if (body !== undefined) {
      if (body instanceof FormData) {
        // FormData 类型，移除 Content-Type 让浏览器自动设置
        delete headers['Content-Type'];
        processedBody = body;
      } else if (typeof body === 'object') {
        // 对象类型，序列化为 JSON
        processedBody = JSON.stringify(body);
      } else {
        // 其他类型，转换为字符串
        processedBody = String(body);
      }
    }

    // 创建超时控制器
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      // 发送请求
      const response = await fetch(url, {
        ...fetchOptions,
        headers,
        body: processedBody,
        signal: controller.signal,
      });

      // 清理超时定时器
      clearTimeout(timeoutId);

      // 检查响应状态
      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        let errorResponse: unknown = null;

        try {
          // 尝试解析错误响应体
          const contentType = response.headers.get('content-type');
          if (contentType?.includes('application/json')) {
            errorResponse = await response.json();
            
            // 特殊处理 FastAPI 验证错误
            if (response.status === 422 && errorResponse && typeof errorResponse === 'object' && 'detail' in errorResponse) {
              const detail = (errorResponse as { detail: unknown }).detail;
              const errorDetail = Array.isArray(detail)
                ? detail.map((e: { loc?: string[]; msg: string }) => `${e.loc?.join('.')}: ${e.msg}`).join(', ')
                : String(detail);
              errorMessage = `数据验证失败: ${errorDetail}`;
            } else if (errorResponse && typeof errorResponse === 'object' && 'message' in errorResponse) {
              errorMessage = String((errorResponse as { message: unknown }).message);
            } else if (errorResponse && typeof errorResponse === 'object' && 'detail' in errorResponse) {
              errorMessage = String((errorResponse as { detail: unknown }).detail);
            }
          } else {
            errorResponse = await response.text();
            if (errorResponse) {
              errorMessage = `${errorMessage} - ${errorResponse}`;
            }
          }
        } catch {
          // 忽略错误响应解析失败
        }

        throw this.createApiError(errorMessage, response.status, errorResponse);
      }

      // 解析响应数据
      const data = await this.parseResponse<T>(response, responseType);

      return {
        data,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        throw this.createApiError(`请求超时 (${timeout}ms)`);
      }

      if (error instanceof Error && 'status' in error) {
        // 已经是 ApiError，直接抛出
        throw error;
      }

      // 网络错误或其他未知错误
      throw this.createApiError(
        `网络请求失败: ${error instanceof Error ? error.message : '未知错误'}`
      );
    }
  }

  // ==================== 公共 HTTP 方法 ====================

  /**
   * GET 请求
   * @param endpoint API 端点
   * @param options 请求选项
   * @returns API 响应
   */
  public async get<T = unknown>(
    endpoint: string,
    options: Omit<RequestOptions, 'method'> = {}
  ): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  /**
   * POST 请求
   * @param endpoint API 端点
   * @param data 请求数据
   * @param options 请求选项
   * @returns API 响应
   */
  public async post<T = unknown>(
    endpoint: string,
    data?: unknown,
    options: Omit<RequestOptions, 'method'> = {}
  ): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'POST', body: data });
  }

  /**
   * PUT 请求
   * @param endpoint API 端点
   * @param data 请求数据
   * @param options 请求选项
   * @returns API 响应
   */
  public async put<T = unknown>(
    endpoint: string,
    data?: unknown,
    options: Omit<RequestOptions, 'method'> = {}
  ): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'PUT', body: data });
  }

  /**
   * PATCH 请求
   * @param endpoint API 端点
   * @param data 请求数据
   * @param options 请求选项
   * @returns API 响应
   */
  public async patch<T = unknown>(
    endpoint: string,
    data?: unknown,
    options: Omit<RequestOptions, 'method'> = {}
  ): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'PATCH', body: data });
  }

  /**
   * DELETE 请求
   * @param endpoint API 端点
   * @param options 请求选项
   * @returns API 响应
   */
  public async delete<T = unknown>(
    endpoint: string,
    options: Omit<RequestOptions, 'method'> = {}
  ): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }

  // ==================== 特殊用途方法 ====================

  /**
   * 下载文件
   * @param endpoint API 端点
   * @param options 请求选项
   * @returns 文件 Blob 和相关信息
   */
  public async download(
    endpoint: string,
    options: Omit<RequestOptions, 'responseType'> = {}
  ): Promise<{
    blob: Blob;
    filename?: string;
    size: number;
    contentType: string;
  }> {
    const response = await this.request<Blob>(endpoint, {
      ...options,
      responseType: 'blob',
      timeout: options.timeout || this.config.downloadTimeout,
    });

    // 解析文件名
    let filename: string | undefined;
    const contentDisposition = response.headers.get('Content-Disposition');
    
    if (contentDisposition) {
      // 尝试解析多种文件名格式
      const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;,\n]*)/i);
      if (utf8Match && utf8Match[1]) {
        try {
          filename = decodeURIComponent(utf8Match[1]);
        } catch {
          // 解码失败，尝试其他方法
        }
      }
      
      if (!filename) {
        const normalMatch = contentDisposition.match(/filename="([^"]+)"/i);
        if (normalMatch && normalMatch[1]) {
          filename = normalMatch[1];
        }
      }
      
      if (!filename) {
        const simpleMatch = contentDisposition.match(/filename=([^;,\n]+)/i);
        if (simpleMatch && simpleMatch[1]) {
          filename = simpleMatch[1].trim();
        }
      }
    }

    return {
      blob: response.data,
      filename,
      size: response.data.size,
      contentType: response.data.type,
    };
  }

  /**
   * 触发浏览器下载
   * @param endpoint API 端点
   * @param defaultFilename 默认文件名
   * @param options 请求选项
   * @returns 下载结果
   */
  public async triggerDownload(
    endpoint: string,
    defaultFilename: string = 'download',
    options: Omit<RequestOptions, 'responseType'> = {}
  ): Promise<{
    success: boolean;
    filename: string;
    size: number;
    error?: string;
  }> {
    try {
      const { blob, filename, size } = await this.download(endpoint, options);
      
      // 创建下载链接
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = filename || defaultFilename;
      link.style.display = 'none';
      
      // 触发下载
      document.body.appendChild(link);
      link.click();
      
      // 清理资源
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
      
      return {
        success: true,
        filename: filename || defaultFilename,
        size,
      };
    } catch (error) {
      return {
        success: false,
        filename: defaultFilename,
        size: 0,
        error: error instanceof Error ? error.message : '下载失败',
      };
    }
  }
}

// ==================== 单例导出 ====================

/**
 * 默认的 API 客户端实例
 * 
 * 这个实例会自动注入 ngrok-skip-browser-warning 标头，
 * 并提供统一的错误处理和超时机制。
 */
export const apiClient = new ApiClient();

// ==================== 便利函数导出 ====================

/**
 * 更新全局 API 客户端配置
 * @param config 新的配置
 */
export function configureApiClient(config: ApiClientConfig): void {
  apiClient.updateConfig(config);
  
  // 可选：持久化保存配置
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem("api_client_config", JSON.stringify(config));
    } catch (error) {
      console.warn("无法保存 API 客户端配置到本地存储:", error);
    }
  }
}

/**
 * 从本地存储初始化 API 客户端配置
 */
export function initializeApiClient(): void {
  if (typeof window !== "undefined") {
    try {
      const savedConfig = localStorage.getItem("api_client_config");
      if (savedConfig) {
        const config = JSON.parse(savedConfig);
        apiClient.updateConfig(config);
        console.log("API 客户端配置已从本地存储加载:", config);
      }
    } catch (error) {
      console.warn("无法从本地存储加载 API 客户端配置:", error);
    }
  }
}

// ==================== 类型导出 ====================

// 类型已在上面通过 export interface 导出，无需重复导出

// ==================== 导出 ApiClient 类以供高级用户使用 ====================

export { ApiClient };
