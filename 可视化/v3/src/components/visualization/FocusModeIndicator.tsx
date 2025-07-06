"use client";

import React from "react";

interface FocusModeIndicatorProps {
  focusNodeId: string | null;
  focusInfo: string;
  onExit: () => void;
}

export const FocusModeIndicator: React.FC<FocusModeIndicatorProps> = ({
  focusNodeId,
  focusInfo,
  onExit,
}) => {
  return (
    <div className="fixed top-28 left-1/2 -translate-x-1/2 z-50 max-w-lg animate-in fade-in slide-in-from-top-2 duration-500">
      <div className="bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/20 p-5 ring-1 ring-black/5">
        <div className="flex items-start space-x-4">
          <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-indigo-500 rounded-xl flex items-center justify-center shadow-lg flex-shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-2 mb-2">
              <h3 className="font-semibold text-gray-800">专研模式已激活</h3>
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            </div>
            <p className="text-sm text-gray-600 leading-relaxed">
              {focusNodeId
                ? focusInfo
                : "点击任意节点查看其完整关联网络，深度探索节点间的复杂关系。"}
            </p>
          </div>
          <button
            className="flex-shrink-0 px-4 py-2 bg-gradient-to-r from-purple-100 to-indigo-100 hover:from-purple-200 hover:to-indigo-200 text-purple-700 rounded-xl transition-all duration-300 text-sm font-medium border border-purple-200/50 hover:border-purple-300 shadow-sm hover:shadow-md active:scale-95"
            onClick={onExit}
          >
            退出专研
          </button>
        </div>
      </div>
    </div>
  );
};
