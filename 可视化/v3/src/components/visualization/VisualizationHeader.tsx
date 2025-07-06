"use client";

import React from "react";

interface VisualizationHeaderProps {
  nodeCount: number;
  linkCount: number;
  onReset: () => void;
  onFullscreen: () => void;
  onFocusModeToggle: () => void;
  isFocusMode: boolean;
}

export const VisualizationHeader: React.FC<VisualizationHeaderProps> = ({
  nodeCount,
  linkCount,
  onReset,
  onFullscreen,
  onFocusModeToggle,
  isFocusMode,
}) => {
  return (
    <div className="bg-white/95 backdrop-blur-xl shadow-sm border-b border-white/20 sticky top-0 z-30">
      <div className="flex items-center justify-between px-6 py-4">
        {/* 左侧标题 */}
        <div className="flex items-center space-x-4">
          <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 rounded-xl flex items-center justify-center shadow-lg">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 bg-clip-text text-transparent">
              B站评论可视化图谱
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">智能社交网络分析平台</p>
          </div>
        </div>

        {/* 中间工具栏 */}
        <div className="absolute left-1/2 transform -translate-x-1/2">
          <div className="flex items-center bg-white/80 backdrop-blur-md rounded-2xl shadow-lg border border-white/30 p-2 space-x-1">
            <span className="text-xs text-gray-500 px-3 py-1 font-medium">操作工具</span>
            <div className="w-px h-6 bg-gray-200"></div>
            
            <button
              onClick={onReset}
              className="group flex items-center space-x-2 px-4 py-2.5 bg-white hover:bg-blue-50 text-blue-600 rounded-xl transition-all duration-300 border border-transparent hover:border-blue-200/50 hover:shadow-md active:scale-95"
              title="重置视图"
            >
              <svg className="w-4 h-4 transition-transform group-hover:rotate-180 duration-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span className="text-sm font-medium">重置</span>
            </button>
            
            <button
              onClick={onFullscreen}
              className="group flex items-center space-x-2 px-4 py-2.5 bg-white hover:bg-emerald-50 text-emerald-600 rounded-xl transition-all duration-300 border border-transparent hover:border-emerald-200/50 hover:shadow-md active:scale-95"
              title="全屏模式"
            >
              <svg className="w-4 h-4 group-hover:scale-110 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
              <span className="text-sm font-medium">全屏</span>
            </button>
            
            <button
              onClick={onFocusModeToggle}
              className={`group flex items-center space-x-2 px-4 py-2.5 rounded-xl transition-all duration-300 border hover:shadow-md active:scale-95 ${
                isFocusMode
                  ? "bg-gradient-to-r from-purple-500 to-indigo-500 text-white border-transparent shadow-lg"
                  : "bg-white hover:bg-purple-50 text-purple-600 border-transparent hover:border-purple-200/50"
              }`}
              title="专业研究模式"
            >
              <svg className="w-4 h-4 group-hover:scale-110 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <span className="text-sm font-medium">
                {isFocusMode ? "专注中" : "专注"}
              </span>
            </button>
          </div>
        </div>

        {/* 右侧统计 */}
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-3 bg-gray-50/80 rounded-xl px-4 py-2 border border-gray-100">
            <div className="text-center">
              <p className="text-xs text-gray-500 font-medium">节点</p>
              <p className="text-lg font-bold text-gray-800">{nodeCount}</p>
            </div>
            <div className="w-px h-8 bg-gray-200"></div>
            <div className="text-center">
              <p className="text-xs text-gray-500 font-medium">连接</p>
              <p className="text-lg font-bold text-gray-800">{linkCount}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
