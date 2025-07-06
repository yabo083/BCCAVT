"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { startCrawlTask, getCrawlStatus, setApiConfig, getApiConfig, downloadCommentData } from "@/utils/api";
import type { Cookie } from "@/types/cookie";

// Chrome扩展类型定义
declare global {
  interface Window {
    chrome?: {
      runtime: {
        sendMessage: (message: unknown, callback: (response: unknown) => void) => void;
        lastError?: {
          message: string;
        };
      };
    };
  }
}

export default function CrawlerPage() {
  const [cookies, setCookies] = useState<Cookie[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [currentUrl, setCurrentUrl] = useState("");
  const [bv, setBv] = useState("");
  const [crawlStatus, setCrawlStatus] = useState<string>("");
  const [progress, setProgress] = useState<number | null>(null);
  const [baseUrl, setBaseUrl] = useState<string>("");
  const [showApiConfig, setShowApiConfig] = useState(false);
  const [currentTaskId, setCurrentTaskId] = useState<string>("");
  const [showDownloadButton, setShowDownloadButton] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // 检查是否在浏览器环境中
  const isBrowser = typeof window !== "undefined";

  // 获取当前页面URL
  useEffect(() => {
    if (isBrowser) {
      setCurrentUrl(window.location.href);
    }
  }, [isBrowser]);

  // 新增：请求扩展获取bilibili.com的cookie
  const getCookiesFromExtension = async () => {
    setIsLoading(true);
    setMessage("正在请求扩展获取B站Cookie...");
    window.postMessage({ type: 'GET_BILIBILI_COOKIES', domain: '.bilibili.com' }, '*');
  };

  // 监听扩展返回
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data && event.data.type === 'BILIBILI_COOKIES_RESULT') {
        if (event.data.cookies) {
          setCookies(event.data.cookies);
          setMessage(`成功获取并保存 ${event.data.cookies.length} 个Cookie`);
          localStorage.setItem("bilibili_cookies", JSON.stringify(event.data.cookies));
        } else {
          setMessage("扩展返回错误: " + (event.data.error || "未知错误"));
        }
        setIsLoading(false);
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // 从localStorage读取cookie的函数
  const loadCookiesFromStorage = () => {
    try {
      const savedCookies = localStorage.getItem("bilibili_cookies");
      if (savedCookies) {
        const parsedCookies = JSON.parse(savedCookies);
        setCookies(parsedCookies);
        setMessage(`从本地存储加载了 ${parsedCookies.length} 个Cookie`);
      } else {
        setMessage("本地存储中没有找到Cookie");
      }
    } catch (error) {
      setMessage(`读取本地存储时发生错误: ${error}`);
    }
  };

  // 清除cookie的函数
  const clearCookies = () => {
    localStorage.removeItem("bilibili_cookies");
    setCookies([]);
    setMessage("已清除所有Cookie");
  };

  // 页面加载时自动尝试从localStorage读取cookie
  useEffect(() => {
    loadCookiesFromStorage();
    // 初始化API配置
    const currentConfig = getApiConfig();
    setBaseUrl(currentConfig.baseURL);
  }, []);

  // 保存API配置
  const saveApiConfig = () => {
    if (!baseUrl.trim()) {
      setMessage("请输入有效的API基础URL");
      return;
    }
    try {
      setApiConfig({ baseURL: baseUrl.trim() });
      setMessage(`API基础URL已设置为: ${baseUrl.trim()}`);
      setShowApiConfig(false);
    } catch (error) {
      setMessage(`设置API配置失败: ${error}`);
    }
  };

  // 重置API配置
  const resetApiConfig = () => {
    setBaseUrl("http://localhost:8000");
    setApiConfig({ baseURL: "http://localhost:8000" });
    setMessage("API配置已重置为默认值");
  };

  // 启动爬取任务
  const startCrawl = async () => {
    if (!bv) {
      setCrawlStatus("请输入BV号");
      return;
    }
    
    // 验证BV号格式 - 保持原始大小写
    const bvId = bv.trim();
    if (!bvId.toUpperCase().startsWith('BV') || bvId.length !== 12) {
      setCrawlStatus("无效的BV号格式，应该是类似 'BV1xxxxxxxxx' 的12位格式");
      return;
    }
    
    if (cookies.length === 0) {
      setCrawlStatus("请先获取B站Cookie");
      return;
    }
    
    // 重置状态
    setCrawlStatus("正在提交爬取任务...");
    setProgress(null);
    setShowDownloadButton(false);
    setCurrentTaskId("");
    
    console.log("准备发送的cookies:", cookies);
    console.log("BV号 (保持原始格式):", bvId);
    try {
      const data = await startCrawlTask(bvId, cookies);
      if (data && data.task_id) {
        setCrawlStatus("任务已提交，正在爬取...");
        setCurrentTaskId(data.task_id);
        // 启动轮询
        startPolling(data.task_id);
      } else {
        setCrawlStatus("任务提交失败: " + (data.error || "未知错误"));
      }
    } catch (err) {
      console.error("爬取任务错误:", err);
      setCrawlStatus("请求失败: 后端API尚未实现，请先开发后端接口");
    }
  };

  // 轮询任务进度
  const startPolling = (task_id: string) => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      try {
        const data = await getCrawlStatus(task_id);
        
        // 检查是否有错误
        if (data.error) {
          console.error("轮询获取状态时出错:", data.error);
          setCrawlStatus(`状态查询失败: ${data.error}`);
          // 如果是网络错误，继续重试；如果是其他错误，停止轮询
          if (data.error.includes("网络")) {
            return; // 继续轮询
          } else {
            clearInterval(pollingRef.current!);
            return;
          }
        }
        
        // 安全地获取状态和进度
        const status = data.status || "UNKNOWN";
        const progress = data.progress || "";
        
        // 更新状态显示
        if (progress) {
          setCrawlStatus(progress);
        }
        
        // 处理数字进度
        if (typeof data.progress === "number") {
          setProgress(data.progress);
        }
        
        // 根据后端定义的状态来决定是否停止轮询
        // 终止状态：SUCCESS(成功), FAILURE(失败), REVOKED(撤销), ERROR(错误)
        const terminalStates = ["SUCCESS", "FAILURE", "REVOKED", "ERROR"];
        
        if (terminalStates.includes(status)) {
          clearInterval(pollingRef.current!);
          
          // 根据不同状态处理
          if (status === "SUCCESS") {
            setShowDownloadButton(true);
            setCrawlStatus("爬取完成！点击下载按钮获取评论数据");
          } else if (status === "FAILURE") {
            setCrawlStatus(`任务失败: ${data.error || "未知错误"}`);
          } else if (status === "REVOKED") {
            setCrawlStatus("任务已被撤销");
          } else if (status === "ERROR") {
            setCrawlStatus(`任务错误: ${data.error || "发生未知错误"}`);
          }
        } else {
          // 继续轮询的状态：PENDING(等待), STARTED(开始), PROGRESS(进行中), RETRY(重试)
          // 如果没有进度信息，根据状态设置默认消息
          if (!progress) {
            switch (status) {
              case "PENDING":
                setCrawlStatus("任务等待中...");
                break;
              case "STARTED":
                setCrawlStatus("任务已开始...");
                break;
              case "PROGRESS":
                setCrawlStatus("任务进行中...");
                break;
              case "RETRY":
                setCrawlStatus("任务重试中...");
                break;
              default:
                setCrawlStatus(`任务状态: ${status}`);
            }
          }
        }
      } catch (err) {
        console.error("轮询过程中发生异常:", err);
        setCrawlStatus(`轮询异常: ${err instanceof Error ? err.message : '未知错误'}`);
        // 网络异常时继续重试，其他异常停止轮询
        if (!(err instanceof Error) || !err.message.includes("网络")) {
          clearInterval(pollingRef.current!);
        }
      }
    }, 2000);
  };

  // 下载评论数据
  const handleDownload = async () => {
    if (!currentTaskId) {
      setMessage("没有可下载的任务");
      return;
    }
    
    setIsDownloading(true);
    setMessage("正在下载文件...");
    
    try {
      const result = await downloadCommentData(currentTaskId);
      if (result.error) {
        setMessage(`下载失败: ${result.error}`);
      } else {
        setMessage(`文件下载成功: ${result.filename}`);
      }
    } catch (error) {
      console.error("下载错误:", error);
      setMessage(`下载过程中发生错误: ${error}`);
    } finally {
      setIsDownloading(false);
    }
  };

  // 页面卸载时清理轮询
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      {/* 顶部导航栏 */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <Link 
                href="/"
                className="text-gray-600 hover:text-gray-900 transition-colors"
              >
                ← 返回主页
              </Link>
            </div>
            <h1 className="text-xl font-semibold text-gray-900">
              Bilibili 一站式爬取工具
            </h1>
            <div className="w-20"></div> {/* 占位符保持居中 */}
          </div>
        </div>
      </div>

      {/* 主要内容区域 */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* 左侧：操作面板 */}
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                操作面板
              </h2>
              
              <div className="space-y-4">
                {/* API配置区域 */}
                <div className="border-b border-gray-200 pb-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700">
                      API配置
                    </label>
                    <button
                      onClick={() => setShowApiConfig(!showApiConfig)}
                      className="text-sm text-blue-600 hover:text-blue-800"
                    >
                      {showApiConfig ? "收起" : "展开"}
                    </button>
                  </div>
                  
                  {showApiConfig && (
                    <div className="space-y-3 bg-gray-50 p-3 rounded border">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          后端API基础URL
                        </label>
                        <input
                          type="text"
                          value={baseUrl}
                          onChange={(e) => setBaseUrl(e.target.value)}
                          placeholder="http://localhost:8000"
                          className="w-full border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={saveApiConfig}
                          className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm py-1 px-2 rounded transition-colors"
                        >
                          保存
                        </button>
                        <button
                          onClick={resetApiConfig}
                          className="flex-1 bg-gray-600 hover:bg-gray-700 text-white text-sm py-1 px-2 rounded transition-colors"
                        >
                          重置
                        </button>
                      </div>
                      <div className="text-xs text-gray-500">
                        当前API地址: {getApiConfig().baseURL}
                      </div>
                    </div>
                  )}
                </div>

                {/* 当前URL显示 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    当前页面URL
                  </label>
                  <div className="text-sm text-gray-600 bg-gray-50 p-3 rounded border">
                    {currentUrl || "无法获取URL"}
                  </div>
                </div>

                {/* 新增：BV号输入和爬取按钮 */}
                <div className="mb-4 flex gap-2 items-center">
                  <input
                    type="text"
                    value={bv}
                    onChange={e => setBv(e.target.value)}
                    placeholder="请输入BV号，如BV1xx411c7mD"
                    className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  <button
                    onClick={startCrawl}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-4 py-2 rounded-lg transition-colors"
                    disabled={isLoading || !bv}
                  >
                    开始爬取
                  </button>
                </div>

                {/* 进度与状态 */}
                {crawlStatus && (
                  <div className="mb-2 text-blue-700 text-sm">{crawlStatus}</div>
                )}
                {progress !== null && (
                  <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                    <div
                      className="bg-blue-500 h-2 rounded-full transition-all"
                      style={{ width: `${progress * 100}%` }}
                    ></div>
                  </div>
                )}

                {/* 下载按钮 */}
                {showDownloadButton && (
                  <div className="mb-4">
                    <button
                      onClick={handleDownload}
                      disabled={isDownloading}
                      className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-medium py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                      {isDownloading ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                          下载中...
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          下载评论数据
                        </>
                      )}
                    </button>
                  </div>
                )}

                {/* 操作按钮 */}
                <div className="space-y-3">
                  <button
                    onClick={getCookiesFromExtension}
                    disabled={isLoading}
                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-3 px-4 rounded-lg transition-colors"
                  >
                    {isLoading ? "获取中..." : "从扩展获取Cookie"}
                  </button>
                  
                  <button
                    onClick={loadCookiesFromStorage}
                    className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-4 rounded-lg transition-colors"
                  >
                    从本地存储读取Cookie
                  </button>
                  
                  <button
                    onClick={clearCookies}
                    className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-3 px-4 rounded-lg transition-colors"
                  >
                    清除所有Cookie
                  </button>
                </div>

                {/* 状态消息 */}
                {message && (
                  <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-sm text-blue-800">{message}</p>
                  </div>
                )}
              </div>
            </div>

            {/* 使用说明 */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                使用说明
              </h3>
              <div className="text-sm text-gray-600 space-y-2">
                <p>1. 首先配置API基础URL（默认为 http://localhost:8000）</p>
                <p>2. 在Bilibili网站上打开你想要爬取的视频页面</p>
                <p>3. 点击&ldquo;从扩展获取Cookie&rdquo;按钮获取当前网站的Cookie</p>
                <p>4. Cookie会自动保存到本地存储中</p>
                <p>5. 后续可以随时从本地存储读取已保存的Cookie</p>
                <p>6. 获取Cookie后，输入BV号并开始爬取操作</p>
              </div>
            </div>
          </div>

          {/* 右侧：Cookie显示区域 */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Cookie 数据 ({cookies.length})
            </h2>
            
            {cookies.length > 0 ? (
              <div className="space-y-3">
                {cookies.map((cookie, index) => (
                  <div 
                    key={index}
                    className="border border-gray-200 rounded-lg p-3 bg-gray-50"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <span className="font-medium text-gray-900">{cookie.name}</span>
                      <span className="text-xs text-gray-500 bg-gray-200 px-2 py-1 rounded">
                        {cookie.domain}
                      </span>
                    </div>
                    <div className="text-sm text-gray-600 break-all">
                      {cookie.value}
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2 text-xs text-gray-500">
                      <span>Path: {cookie.path}</span>
                      <span>Secure: {cookie.secure ? "是" : "否"}</span>
                      <span>HttpOnly: {cookie.httpOnly ? "是" : "否"}</span>
                      <span>HostOnly: {cookie.hostOnly ? "是" : "否"}</span>
                      <span>Session: {cookie.session ? "是" : "否"}</span>
                      <span>SameSite: {cookie.sameSite}</span>
                      {cookie.expirationDate && (
                        <span>过期: {new Date(cookie.expirationDate * 1000).toLocaleString()}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <p>暂无Cookie数据</p>
                <p className="text-sm mt-2">请先获取Cookie</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}