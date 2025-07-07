import React from 'react';

interface BackendApiPanelProps {
  baseUrl: string;
  onBaseUrlChange: (url: string) => void;
  showApiConfig: boolean;
  onToggleApiConfig: () => void;
  onSaveApiConfig: () => void;
  onResetApiConfig: () => void;
  bv: string;
  onBvChange: (bv: string) => void;
  onStartCrawl: () => void;
  isLoading: boolean;
  currentApiUrl: string;
}

export const BackendApiPanel: React.FC<BackendApiPanelProps> = ({
  baseUrl,
  onBaseUrlChange,
  showApiConfig,
  onToggleApiConfig,
  onSaveApiConfig,
  onResetApiConfig,
  bv,
  onBvChange,
  onStartCrawl,
  isLoading,
  currentApiUrl
}) => {
  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
        <svg className="w-5 h-5 mr-2 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
        </svg>
        后端API相关
      </h2>
      
      <div className="space-y-4">
        {/* API配置区域 */}
        <div className="border-b border-gray-200 pb-4">
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-700">
              配置后端基础API
            </label>
            <button
              onClick={onToggleApiConfig}
              className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              <svg className={`w-4 h-4 transition-transform ${showApiConfig ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
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
                  onChange={(e) => onBaseUrlChange(e.target.value)}
                  placeholder="http://localhost:8000"
                  className="w-full border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={onSaveApiConfig}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm py-1 px-2 rounded transition-colors"
                >
                  保存
                </button>
                <button
                  onClick={onResetApiConfig}
                  className="flex-1 bg-gray-600 hover:bg-gray-700 text-white text-sm py-1 px-2 rounded transition-colors"
                >
                  重置
                </button>
              </div>
              <div className="text-xs text-gray-500">
                当前API地址: {currentApiUrl}
              </div>
            </div>
          )}
        </div>

        {/* BV号输入和爬取 */}
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              输入BV号
            </label>
            <input
              type="text"
              value={bv}
              onChange={(e) => onBvChange(e.target.value)}
              placeholder="请输入BV号，如BV1xx411c7mD"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
            />
          </div>
          
          {/* 操作按钮 */}
          <div className="flex gap-2">
            <button
              onClick={onStartCrawl}
              className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-medium py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
              disabled={isLoading || !bv.trim()}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h8m2-10v18a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2h8a2 2 0 012 2z" />
              </svg>
              开始爬取
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
