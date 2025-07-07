"use client";

import React from "react";

interface ControlPanelProps {
  isExpanded: boolean;
  onToggle: () => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onSearch: () => void;
  minDegree: number;
  maxDegree: number;
  onMinDegreeChange: (value: number) => void;
  onMaxDegreeChange: (value: number) => void;
  onDegreeFilter: () => void;
  onReset: () => void;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({
  isExpanded,
  onToggle,
  searchQuery,
  onSearchChange,
  onSearch,
  minDegree,
  maxDegree,
  onMinDegreeChange,
  onMaxDegreeChange,
  onDegreeFilter,
  onReset,
}) => {
  return (
    <div
      className={`
        fixed top-24 left-0 z-30
        transition-all duration-700 ease-out
        ${isExpanded ? "translate-x-0" : "-translate-x-full"}
      `}
    >
      <div
        className="relative w-80 h-auto bg-white/95 backdrop-blur-xl rounded-r-3xl shadow-2xl border border-white/30 ring-1 ring-black/5"
        style={{
          minHeight: "280px",
          maxHeight: "calc(100vh - 8rem)",
          overflow: "visible",
        }}
      >
        {/* 面板头部 */}
        <div
          className="bg-gradient-to-r from-indigo-50/80 via-purple-50/60 to-pink-50/80 border-b border-white/20 backdrop-blur-sm"
          style={{
            borderTopRightRadius: "1.5rem",
          }}
        >
          <div className="flex justify-between items-center px-4 py-3">
            <div className="flex items-center space-x-2">
              <div className="w-2.5 h-2.5 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full animate-pulse shadow-sm"></div>
              <span className="font-medium text-gray-800 tracking-wide text-sm">智能控制面板</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="flex items-center space-x-1 text-xs text-gray-500 bg-white/60 rounded-full px-2 py-0.5">
                <div className="w-1 h-1 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-xs">在线</span>
              </div>
            </div>
          </div>
        </div>

        {/* 面板内容 */}
        <div className="p-4 space-y-4 animate-in slide-in-from-left-2 duration-500 bg-gradient-to-b from-white via-gray-50/20 to-white max-h-[calc(100vh-10rem)] overflow-y-auto">
          {/* 搜索区域 */}
          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <div className="w-6 h-6 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-lg flex items-center justify-center shadow-md">
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <h3 className="font-medium text-gray-800 text-sm">智能搜索</h3>
            </div>
            <div className="flex items-center space-x-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder="输入用户名进行精确搜索..."
                  className="w-full pl-9 pr-3 py-2 border border-gray-200/80 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all duration-300 bg-white/80 backdrop-blur-sm shadow-sm"
                  onKeyPress={(e) => e.key === "Enter" && onSearch()}
                />
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
              </div>
              <button
                onClick={onSearch}
                className="px-3 py-2 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white transition-all duration-300 border border-transparent shadow-md hover:shadow-lg active:scale-95 font-medium text-sm"
                title="开始搜索"
              >
                搜索
              </button>
            </div>
          </div>

          {/* 筛选区域 */}
          <div className="space-y-3 border-t border-gray-100 pt-4">
            <div className="flex items-center space-x-2">
              <div className="w-6 h-6 bg-gradient-to-br from-orange-500 to-red-500 rounded-lg flex items-center justify-center shadow-md">
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.414A1 1 0 013 6.707V4z" />
                </svg>
              </div>
              <h3 className="font-medium text-gray-800 text-sm">度数筛选</h3>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-gray-600 font-medium uppercase tracking-wide">
                  最小值
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={minDegree}
                    onChange={(e) => onMinDegreeChange(parseInt(e.target.value) || 0)}
                    min={0}
                    className="w-full px-3 py-2 border border-gray-200/80 rounded-lg text-sm focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400 transition-all duration-300 bg-white/80 backdrop-blur-sm shadow-sm"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-gray-600 font-medium uppercase tracking-wide">
                  最大值
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={maxDegree}
                    onChange={(e) => onMaxDegreeChange(parseInt(e.target.value) || 0)}
                    min={0}
                    className="w-full px-3 py-2 border border-gray-200/80 rounded-lg text-sm focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400 transition-all duration-300 bg-white/80 backdrop-blur-sm shadow-sm"
                  />
                </div>
              </div>
            </div>
            <div className="flex space-x-2 pt-1">
              <button
                onClick={onDegreeFilter}
                className="flex-1 py-2 px-3 rounded-lg bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white text-sm font-medium transition-all duration-300 border border-transparent shadow-md hover:shadow-lg active:scale-95"
              >
                应用筛选
              </button>
              <button
                onClick={onReset}
                className="px-3 py-2 rounded-lg bg-white hover:bg-red-50 text-red-500 transition-all duration-300 border border-red-200/50 hover:border-red-300 shadow-sm hover:shadow-md active:scale-95"
                title="清除筛选"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* 切换按钮 */}
        <button
          onClick={onToggle}
          className="
            absolute top-1/2 right-0 translate-x-1/2 -translate-y-1/2
            bg-gradient-to-br from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600
            text-white shadow-lg hover:shadow-xl
            rounded-full w-10 h-10 flex items-center justify-center
            transition-all duration-500 hover:scale-110 active:scale-95
            ring-4 ring-white/50 backdrop-blur-sm
            z-50
          "
          title={isExpanded ? "收起面板" : "展开面板"}
        >
          <svg
            className={`w-4 h-4 transition-transform duration-500 ${
              isExpanded ? "rotate-180" : ""
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
};
