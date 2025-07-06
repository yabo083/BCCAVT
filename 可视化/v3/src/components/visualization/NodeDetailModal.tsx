"use client";

import React from "react";
import { GraphNode } from "@/types/comment";

interface NodeDetailModalProps {
  node: GraphNode | null;
  isOpen: boolean;
  isCollapsed: boolean;
  onClose: () => void;
  onCollapse: () => void;
}

export const NodeDetailModal: React.FC<NodeDetailModalProps> = ({
  node,
  isOpen,
  isCollapsed,
  onClose,
  onCollapse,
}) => {
  if (!isOpen || !node) return null;

  return (
    <div
      className={`fixed top-24 right-6 bg-white/98 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/20 w-80 z-50 
      ${
        isCollapsed ? "h-14" : "h-[calc((100vh-7rem)/2-1rem)]"
      } overflow-hidden transition-all duration-500 ease-out transform hover:scale-[1.02] ring-1 ring-black/5 flex flex-col`}
    >
      <div
        className="flex items-center justify-between px-5 py-3 border-b border-gray-100/60 bg-gradient-to-r from-indigo-50/80 via-purple-50/60 to-pink-50/80 backdrop-blur-sm"
      >
        <div className="flex items-center space-x-3 min-w-0">
          <div className="w-2 h-2 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full animate-pulse shadow-sm"></div>
          <h3 className="font-semibold text-gray-800 truncate text-sm tracking-wide">节点详情</h3>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={onCollapse}
            className="group p-2 hover:bg-white/70 rounded-xl text-gray-500 hover:text-gray-700 transition-all duration-300 transform hover:scale-110 active:scale-95"
            title={isCollapsed ? "展开详情" : "收起详情"}
          >
            <span className={`text-sm font-medium transition-transform duration-300 ease-out ${
              isCollapsed ? "" : ""
            }`}>
              {isCollapsed ? "▼" : "▲"}
            </span>
          </button>
          <button
            onClick={onClose}
            className="group p-2 hover:bg-red-50 rounded-xl text-gray-500 hover:text-red-500 transition-all duration-300 transform hover:scale-110 active:scale-95"
            title="关闭"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="p-5 space-y-4 bg-gradient-to-b from-white via-gray-50/30 to-white animate-in slide-in-from-top-2 duration-300 overflow-y-auto">
          <div className="bg-gradient-to-r from-gray-50 to-slate-50 rounded-xl p-4 border border-gray-100/80 shadow-sm">
            <div className="flex items-start space-x-3">
              <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-full flex items-center justify-center text-white text-sm font-medium shadow-md flex-shrink-0">
                {node.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800 mb-2">
                  {node.name}
                </p>
                <div className="max-h-32 overflow-y-auto bg-white/50 rounded-lg p-3 border border-gray-200/60">
                  <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                    {node.content}
                  </p>
                </div>
              </div>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg p-3 border border-blue-100/50">
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                <span className="text-xs font-medium text-blue-700">点赞数</span>
              </div>
              <p className="text-lg font-bold text-blue-800 mt-1">{node.likes}</p>
            </div>
            <div className="bg-gradient-to-br from-emerald-50 to-green-50 rounded-lg p-3 border border-emerald-100/50">
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
                <span className="text-xs font-medium text-emerald-700">度数</span>
              </div>
              <p className="text-lg font-bold text-emerald-800 mt-1">{node.degree}</p>
            </div>
          </div>
          
          <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-lg p-3 border border-amber-100/50">
            <div className="flex items-center space-x-2 mb-2">
              <div className="w-2 h-2 bg-amber-500 rounded-full"></div>
              <span className="text-xs font-medium text-amber-700">发布时间</span>
            </div>
            <p className="text-sm text-amber-800 font-medium">
              {(() => {
                if (!node.time || isNaN(Number(node.time))) return "无时间信息";
                let t = Number(node.time);
                if (t > 1e12) t = Math.floor(t / 1000);
                if (t > 0) return new Date(t * 1000).toLocaleString();
                return "无时间信息";
              })()}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
