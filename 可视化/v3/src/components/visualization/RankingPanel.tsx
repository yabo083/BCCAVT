"use client";

import React from "react";
import { GraphNode } from "@/types/comment";

interface RankingPanelProps {
  isOpen: boolean;
  clusterMode: "radial" | "linear" | "isolated" | null;
  rankingData: {
    radial: { node: GraphNode; childCount: number }[];
    linear: { nodes: GraphNode[]; length: number }[];
    isolated: GraphNode[];
  };
  onClose: () => void;
  onNodeLocate: (nodeId: string) => void;
  isModalOpen: boolean;
  isModalCollapsed: boolean;
}

export const RankingPanel: React.FC<RankingPanelProps> = ({
  isOpen,
  clusterMode,
  rankingData,
  onClose,
  onNodeLocate,
  isModalOpen,
  isModalCollapsed,
}) => {
  if (!isOpen || !clusterMode) return null;

  // 根据节点详情模态框的状态计算位置和高度
  const getPositionStyle = () => {
    if (!isModalOpen) {
      // 节点详情未打开时，排行榜占据更大空间
      return {
        top: '6rem',
        height: 'calc(100vh - 9rem)'
      };
    } else if (isModalCollapsed) {
      // 节点详情收起时，从收起框的下方开始
      return {
        top: 'calc(6rem + 3.5rem + 1rem)', // 顶部栏 + 收起的模态框高度 + 间距
        height: 'calc(100vh - 12.5rem)'
      };
    } else {
      // 节点详情展开时，从屏幕中间开始
      return {
        top: 'calc(50vh + 1.5rem)',
        height: 'calc((100vh - 7rem) / 2 - 1rem)'
      };
    }
  };

  const renderRankingContent = () => {
    switch (clusterMode) {
      case "radial":
        return (
          <div className="space-y-2">
            <div className="flex items-center space-x-2 mb-3">
              <div className="w-6 h-6 bg-gradient-to-br from-red-500 to-pink-500 rounded-lg flex items-center justify-center shadow-md">
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v18m9-9H3" />
                </svg>
              </div>
              <div>
                <h3 className="font-medium text-base text-gray-800">放射状聚类</h3>
                <p className="text-xs text-gray-500">按影响力排序的中心节点</p>
              </div>
            </div>
            {rankingData.radial.map((item, index) => (
              <div
                key={item.node.id}
                className="group p-3 bg-gradient-to-r from-white to-red-50/30 rounded-lg shadow-sm hover:shadow-md transition-all duration-300 cursor-pointer border border-red-100/50 hover:border-red-200 hover:scale-[1.01]"
                onClick={() => onNodeLocate(item.node.id)}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="w-6 h-6 bg-gradient-to-br from-red-500 to-pink-500 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-md">
                      {index + 1}
                    </div>
                    <span className="font-medium text-gray-900 group-hover:text-red-600 transition-colors text-sm">
                      {item.node.name}
                    </span>
                  </div>
                  <div className="flex items-center space-x-1 text-xs text-red-600 bg-red-50 rounded-full px-2 py-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    <span className="font-medium">{item.childCount}</span>
                  </div>
                </div>
                <p className="text-xs text-gray-600 line-clamp-1 leading-relaxed">
                  {item.node.content}
                </p>
              </div>
            ))}
          </div>
        );

      case "linear":
        return (
          <div className="space-y-2">
            <div className="flex items-center space-x-2 mb-3">
              <div className="w-6 h-6 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-lg flex items-center justify-center shadow-md">
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
              </div>
              <div>
                <h3 className="font-medium text-base text-gray-800">线性聚类</h3>
                <p className="text-xs text-gray-500">按长度排序的连接链</p>
              </div>
            </div>
            {rankingData.linear.map((chain, index) => (
              <div
                key={index}
                className="group p-3 bg-gradient-to-r from-white to-emerald-50/30 rounded-lg shadow-sm hover:shadow-md transition-all duration-300 cursor-pointer border border-emerald-100/50 hover:border-emerald-200 hover:scale-[1.01]"
                onClick={() => onNodeLocate(chain.nodes[0].id)}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="w-6 h-6 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-md">
                      {index + 1}
                    </div>
                    <span className="font-medium text-gray-900 group-hover:text-emerald-600 transition-colors text-sm truncate">
                      {chain.nodes[0].name} → {chain.nodes[chain.nodes.length - 1].name}
                    </span>
                  </div>
                  <div className="flex items-center space-x-1 text-xs text-emerald-600 bg-emerald-50 rounded-full px-2 py-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                    <span className="font-medium">{chain.length}</span>
                  </div>
                </div>
                <p className="text-xs text-gray-600 truncate">
                  {chain.nodes.map((n) => n.name).join(" → ")}
                </p>
              </div>
            ))}
          </div>
        );

      case "isolated":
        return (
          <div className="space-y-2">
            <div className="flex items-center space-x-2 mb-3">
              <div className="w-6 h-6 bg-gradient-to-br from-amber-500 to-yellow-500 rounded-lg flex items-center justify-center shadow-md">
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </div>
              <div>
                <h3 className="font-medium text-base text-gray-800">孤立节点</h3>
                <p className="text-xs text-gray-500">按点赞数排序的独立节点</p>
              </div>
            </div>
            {rankingData.isolated.map((node, index) => (
              <div
                key={node.id}
                className="group p-3 bg-gradient-to-r from-white to-amber-50/30 rounded-lg shadow-sm hover:shadow-md transition-all duration-300 cursor-pointer border border-amber-100/50 hover:border-amber-200 hover:scale-[1.01]"
                onClick={() => onNodeLocate(node.id)}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="w-6 h-6 bg-gradient-to-br from-amber-500 to-yellow-500 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-md">
                      {index + 1}
                    </div>
                    <span className="font-medium text-gray-900 group-hover:text-amber-600 transition-colors text-sm">
                      {node.name}
                    </span>
                  </div>
                  <div className="flex items-center space-x-1 text-xs text-amber-600 bg-amber-50 rounded-full px-2 py-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                    </svg>
                    <span className="font-medium">{node.likes}</span>
                  </div>
                </div>
                <p className="text-xs text-gray-600 line-clamp-1 leading-relaxed">
                  {node.content}
                </p>
              </div>
            ))}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div
      className="fixed right-6 w-80 bg-white/98 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/20 z-50 ring-1 ring-black/5 flex flex-col overflow-hidden"
      style={getPositionStyle()}
    >
      {/* 头部 */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100/60 bg-gradient-to-r from-indigo-50/80 via-purple-50/60 to-pink-50/80 backdrop-blur-sm">
        <div className="flex items-center space-x-3">
          <div className="w-2 h-2 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full animate-pulse shadow-sm"></div>
          <h3 className="font-semibold text-gray-800 tracking-wide text-sm">聚类排行榜</h3>
        </div>
        <button
          onClick={onClose}
          className="group p-2 hover:bg-red-50 rounded-xl text-gray-500 hover:text-red-500 transition-all duration-300 transform hover:scale-110 active:scale-95"
          title="关闭排行榜"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 p-5 overflow-y-auto bg-gradient-to-b from-white via-gray-50/20 to-white">
        {renderRankingContent()}
      </div>
    </div>
  );
};
