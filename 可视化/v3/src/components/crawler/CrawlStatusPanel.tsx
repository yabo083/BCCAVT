import React from "react";

interface CrawlStatusPanelProps {
  crawlStatus?: string;
  progress: number | null;
}

export const CrawlStatusPanel: React.FC<CrawlStatusPanelProps> = ({
  crawlStatus,
  progress,
}) => {
  const getStatusIcon = () => {
    if (!crawlStatus) {
      return (
        <svg
          className="w-5 h-5 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      );
    }

    if (crawlStatus.includes("完成")) {
      return (
        <svg
          className="w-5 h-5 text-green-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      );
    } else if (crawlStatus.includes("失败") || crawlStatus.includes("错误")) {
      return (
        <svg
          className="w-5 h-5 text-red-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      );
    } else if (
      crawlStatus.includes("进行中") ||
      crawlStatus.includes("爬取") ||
      crawlStatus.includes("提交")
    ) {
      return (
        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
      );
    } else {
      return (
        <svg
          className="w-5 h-5 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      );
    }
  };

  const getStatusColor = () => {
    if (!crawlStatus) return "text-gray-700 bg-gray-50 border-gray-200";

    if (crawlStatus.includes("完成"))
      return "text-green-700 bg-green-50 border-green-200";
    if (crawlStatus.includes("失败") || crawlStatus.includes("错误"))
      return "text-red-700 bg-red-50 border-red-200";
    if (
      crawlStatus.includes("进行中") ||
      crawlStatus.includes("爬取") ||
      crawlStatus.includes("提交")
    )
      return "text-blue-700 bg-blue-50 border-blue-200";
    return "text-gray-700 bg-gray-50 border-gray-200";
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
        <svg
          className="w-5 h-5 mr-2 text-orange-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
          />
        </svg>
        爬取状态展示
      </h2>

      <div className="space-y-4">
        {/* 爬取状态 - 始终显示 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            任务状态
          </label>
          <div
            className={`p-3 rounded border flex items-center gap-3 ${getStatusColor()}`}
          >
            {getStatusIcon()}
            <span className="flex-1">{crawlStatus || "等待开始爬取"}</span>
          </div>
        </div>

        {/* 进度条 - 只在有进度数据时显示 */}
        {(progress !== null && progress >= 0) && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              进度
            </label>
            <div className="w-full bg-gray-200 rounded-full h-4 relative">
              <div
                className="bg-blue-500 h-4 rounded-full transition-all duration-300 relative"
                style={{ width: `${Math.max(progress * 100, 2)}%` }}
              >
                <span className="absolute right-2 top-1/2 transform -translate-y-1/2 text-xs text-white font-medium">
                  {Math.round(progress * 100)}%
                </span>
              </div>
              {progress === 0 && (
                <span className="absolute left-2 top-1/2 transform -translate-y-1/2 text-xs text-gray-500 font-medium">
                  0%
                </span>
              )}
            </div>
          </div>
        )}

        {/* 状态说明 */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="flex items-start gap-2">
            <svg
              className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div className="text-sm text-blue-700">
              <p className="font-medium mb-1">状态说明：</p>
              <ul className="space-y-1 text-xs">
                <li>• 等待开始爬取：任务尚未开始</li>
                <li>• 等待中：任务已提交，等待处理</li>
                <li>• 进行中：正在爬取评论数据</li>
                <li>• 完成：爬取任务成功完成</li>
                <li>• 失败：任务执行失败，请检查输入</li>
                <li>• 轮询超时：状态查询超时，任务可能仍在运行</li>
              </ul>
              <div className="mt-2 pt-2 border-t border-blue-200">
                <p className="font-medium text-xs">轮询机制：</p>
                <ul className="space-y-1 text-xs">
                  <li>• 每3秒自动查询任务状态</li>
                  <li>• 长时间任务自动超时（30分钟）</li>
                  <li>• 下载文件超时时间为5分钟</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
