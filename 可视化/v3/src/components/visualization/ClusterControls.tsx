"use client";

import React from "react";

interface ClusterControlsProps {
  clusterMode: "radial" | "linear" | "isolated" | null;
  onClusterModeChange: (mode: "radial" | "linear" | "isolated") => void;
  onRankingOpen: () => void;
}

export const ClusterControls: React.FC<ClusterControlsProps> = ({
  clusterMode,
  onClusterModeChange,
  onRankingOpen,
}) => {
  const handleClusterModeClick = (mode: "radial" | "linear" | "isolated") => {
    console.log(`${mode}按钮被点击`);
    onClusterModeChange(mode);
    onRankingOpen();
  };

  return (
    <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/20 p-4 flex space-x-3 ring-1 ring-black/5 z-50">
      <div className="flex items-center space-x-2 mr-2">
        <div className="w-2 h-2 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full animate-pulse"></div>
        <span className="text-sm font-semibold text-gray-700">聚类分析</span>
      </div>
      <div className="w-px h-8 bg-gray-200"></div>
      
      {/* 中心放射按钮 */}
      <button
        onClick={() => handleClusterModeClick("radial")}
        className={`group px-5 py-2.5 rounded-xl transition-all duration-300 font-medium text-sm shadow-md hover:shadow-lg active:scale-95 ${
          clusterMode === "radial"
            ? "bg-gradient-to-r from-red-500 to-pink-500 text-white shadow-red-200"
            : "bg-white hover:bg-red-50 text-red-600 border border-red-200/50 hover:border-red-300"
        }`}
      >
        <div className="flex items-center space-x-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v18m9-9H3" />
          </svg>
          <span>中心放射</span>
        </div>
      </button>
      
      {/* 长链线状按钮 */}
      <button
        onClick={() => handleClusterModeClick("linear")}
        className={`group px-5 py-2.5 rounded-xl transition-all duration-300 font-medium text-sm shadow-md hover:shadow-lg active:scale-95 ${
          clusterMode === "linear"
            ? "bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-emerald-200"
            : "bg-white hover:bg-emerald-50 text-emerald-600 border border-emerald-200/50 hover:border-emerald-300"
        }`}
      >
        <div className="flex items-center space-x-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          <span>长链线状</span>
        </div>
      </button>
      
      {/* 孤立点集按钮 */}
      <button
        onClick={() => handleClusterModeClick("isolated")}
        className={`group px-5 py-2.5 rounded-xl transition-all duration-300 font-medium text-sm shadow-md hover:shadow-lg active:scale-95 ${
          clusterMode === "isolated"
            ? "bg-gradient-to-r from-amber-500 to-yellow-500 text-white shadow-amber-200"
            : "bg-white hover:bg-amber-50 text-amber-600 border border-amber-200/50 hover:border-amber-300"
        }`}
      >
        <div className="flex items-center space-x-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
          <span>孤立点集</span>
        </div>
      </button>
    </div>
  );
};
