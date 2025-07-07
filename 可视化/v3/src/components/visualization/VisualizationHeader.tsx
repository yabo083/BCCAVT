"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";

interface VisualizationHeaderProps {
  nodeCount: number;
  linkCount: number;
  onReset: () => void;
  onFullscreen: () => void;
  onFocusModeToggle: () => void;
  isFocusMode: boolean;
  onNewAnalysis: () => void;
}

export const VisualizationHeader: React.FC<VisualizationHeaderProps> = ({
  nodeCount,
  linkCount,
  onReset,
  onFullscreen,
  onFocusModeToggle,
  isFocusMode,
  onNewAnalysis,
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // 点击外部关闭菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isMenuOpen) {
        const target = event.target as Element;
        if (!target.closest('[data-menu]')) {
          setIsMenuOpen(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMenuOpen]);

  return (
    <div className="bg-white/95 backdrop-blur-xl shadow-sm border-b border-white/20 sticky top-0 z-30">
      <div className="flex items-center justify-between px-6 py-4">
        {/* 左侧标题和菜单 */}
        <div className="flex items-center space-x-4">
          {/* 菜单图标 */}
          <div className="relative" data-menu>
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="flex items-center justify-center w-10 h-10 bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 hover:from-indigo-600 hover:via-purple-600 hover:to-pink-600 rounded-xl shadow-lg transition-all hover:shadow-xl hover:scale-105"
            >
              <svg
                className="w-6 h-6 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            </button>

            {/* 下拉菜单 */}
            {isMenuOpen && (
              <div className="absolute top-12 left-0 bg-white/98 backdrop-blur-md rounded-xl shadow-2xl border border-gray-200/50 py-2 min-w-48 z-[110] animate-in slide-in-from-top-2 duration-200">
                <Link
                  href="/"
                  className="flex items-center px-4 py-3 text-gray-700 hover:bg-gray-50/80 transition-colors group"
                >
                  <svg className="w-4 h-4 mr-3 text-gray-500 group-hover:text-blue-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                  </svg>
                  <span className="font-medium">返回主页</span>
                </Link>
                <button
                  onClick={() => {
                    onNewAnalysis();
                    setIsMenuOpen(false);
                  }}
                  className="flex items-center w-full px-4 py-3 text-gray-700 hover:bg-gray-50/80 transition-colors group"
                >
                  <svg className="w-4 h-4 mr-3 text-gray-500 group-hover:text-green-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  <span className="font-medium">新建分析</span>
                </button>
                <button
                  onClick={() => {
                    onReset();
                    setIsMenuOpen(false);
                  }}
                  className="flex items-center w-full px-4 py-3 text-gray-700 hover:bg-gray-50/80 transition-colors group"
                >
                  <svg className="w-4 h-4 mr-3 text-gray-500 group-hover:text-orange-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span className="font-medium">重置视图</span>
                </button>
                <hr className="my-2 border-gray-200/50" />
                <Link
                  href="/crawler"
                  className="flex items-center px-4 py-3 text-gray-700 hover:bg-gray-50/80 transition-colors group"
                >
                  <svg className="w-4 h-4 mr-3 text-gray-500 group-hover:text-purple-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9v-9m0-9v9" />
                  </svg>
                  <span className="font-medium">一站式爬取</span>
                </Link>
              </div>
            )}
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
