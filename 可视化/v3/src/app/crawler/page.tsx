"use client";

import Link from "next/link";
import { useCrawlerStore } from "@/hooks/useCrawlerStore";
import { useToast } from "@/hooks/useToast";
import { getApiConfig } from "@/utils/api";

// 导入组件化的面板
import { ExtensionPanel } from "@/components/crawler/ExtensionPanel";
import { BackendApiPanel } from "@/components/crawler/BackendApiPanel";
import { DataFilePanel } from "@/components/crawler/DataFilePanel";
import { CookieDisplayPanel } from "@/components/crawler/CookieDisplayPanel";
import { CrawlStatusPanel } from "@/components/crawler/CrawlStatusPanel";
import { GuideAnnouncementPanel } from "@/components/crawler/GuideAnnouncementPanel";
import { Toast } from "@/components/Toast";
import { useEffect } from "react";

export default function CrawlerPage() {
  const store = useCrawlerStore();
  const { toast, hideToast, showInfo, showSuccess, showError } = useToast();

  // 监听store状态变化，在适当时机显示Toast消息
  useEffect(() => {
    if (store.cookies.length > 0) {
      const savedCookies = localStorage.getItem("bilibili_cookies");
      if (savedCookies) {
        const parsedCookies = JSON.parse(savedCookies);
        if (parsedCookies.length === store.cookies.length) {
          showInfo(`从本地存储加载了 ${store.cookies.length} 个Cookie`);
        }
      }
    }
  }, [store.cookies.length, showInfo]);

  // 处理获取Cookie的回调
  const handleGetCookies = () => {
    store.getCookiesFromExtension(
      (count) => showSuccess(`成功获取并保存 ${count} 个Cookie`),
      (error) => showError("扩展返回错误: " + error)
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      {/* 顶部导航栏 */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <Link 
                href="/"
                className="text-gray-600 hover:text-gray-900 transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                返回主页
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
          
          {/* 左侧：控制面板 */}
          <div className="space-y-6">
            
            {/* 扩展相关面板 - 调整高度匹配右侧Cookie面板 */}
            <div className="lg:h-80">
              <ExtensionPanel
                onGetCookies={handleGetCookies}
                onClearExpiredCookies={store.clearExpiredCookies}
                isLoading={store.cookiesLoading}
              />
            </div>

            {/* 后端API相关面板 */}
            <BackendApiPanel
              baseUrl={store.baseUrl}
              onBaseUrlChange={store.setBaseUrl}
              showApiConfig={store.showApiConfig}
              onToggleApiConfig={store.toggleApiConfig}
              onSaveApiConfig={store.saveApiConfig}
              onResetApiConfig={store.resetApiConfig}
              bv={store.bv}
              onBvChange={store.setBv}
              onStartCrawl={store.startCrawl}
              onStopPolling={store.stopPolling}
              isLoading={store.isLoading}
              currentApiUrl={getApiConfig().baseURL}
              currentTaskId={store.currentTaskId}
              crawlStatus={store.crawlStatus}
            />

            {/* 数据文件相关面板 */}
            <DataFilePanel
              files={store.downloadedFiles}
              onDownload={store.downloadFile}
              onDelete={store.deleteFile}
              onVisualize={store.visualizeFile}
              isDownloading={store.isDownloading}
              showDownloadButton={store.showDownloadButton}
              currentTaskId={store.currentTaskId}
            />

          </div>

          {/* 右侧：显示面板 */}
          <div className="space-y-6">
            
            {/* Cookie列表展示 - 固定高度匹配左侧扩展面板 */}
            <div className="lg:h-80">
              <CookieDisplayPanel cookies={store.cookies} />
            </div>

            {/* 爬取状态展示 */}
            <CrawlStatusPanel 
              crawlStatus={store.crawlStatus}
              progress={store.progress}
              currentUrl={store.currentUrl}
            />

            {/* 使用指引和公告 */}
            <GuideAnnouncementPanel />

          </div>
        </div>

        {/* 全局Toast组件 */}
        <Toast
          message={toast.message}
          type={toast.type}
          duration={toast.duration}
          isVisible={toast.isVisible}
          onClose={hideToast}
        />

        {/* 数据流连接线（仅在大屏幕上显示） */}
        <div className="hidden lg:block absolute inset-0 pointer-events-none">
          {/* 扩展面板到Cookie显示的连接线 */}
          <svg className="absolute w-full h-full" style={{ zIndex: -1 }}>
            <defs>
              <marker id="arrowhead1" markerWidth="10" markerHeight="7" 
               refX="10" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="#3B82F6" />
              </marker>
            </defs>
            <path
              d="M 400 200 Q 500 250 600 200"
              stroke="#3B82F6"
              strokeWidth="2"
              fill="none"
              strokeDasharray="5,5"
              markerEnd="url(#arrowhead1)"
              opacity="0.6"
            />
          </svg>

          {/* 后端API面板到爬取状态的连接线 */}
          <svg className="absolute w-full h-full" style={{ zIndex: -1 }}>
            <defs>
              <marker id="arrowhead2" markerWidth="10" markerHeight="7" 
               refX="10" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="#10B981" />
              </marker>
            </defs>
            <path
              d="M 400 400 Q 500 450 600 400"
              stroke="#10B981"
              strokeWidth="2"
              fill="none"
              strokeDasharray="5,5"
              markerEnd="url(#arrowhead2)"
              opacity="0.6"
            />
          </svg>

          {/* 数据文件面板到使用指引的连接线 */}
          <svg className="absolute w-full h-full" style={{ zIndex: -1 }}>
            <defs>
              <marker id="arrowhead3" markerWidth="10" markerHeight="7" 
               refX="10" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="#8B5CF6" />
              </marker>
            </defs>
            <path
              d="M 400 600 Q 500 650 600 600"
              stroke="#8B5CF6"
              strokeWidth="2"
              fill="none"
              strokeDasharray="5,5"
              markerEnd="url(#arrowhead3)"
              opacity="0.6"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}
