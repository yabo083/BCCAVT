"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { CommentDataProcessor } from "@/utils/commentDataProcessor";
import { CommentData } from "@/types/comment";
import { VisualizationComponent } from "@/components/VisualizationComponent";

export default function VisualizationPage() {
  const [data, setData] = useState<CommentData[] | null>(null);
  const [processor, setProcessor] = useState<CommentDataProcessor | null>(null);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/json") {
      setError("请选择JSON格式的文件");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const text = await file.text();
      const jsonData = JSON.parse(text);
      const dataProcessor = new CommentDataProcessor(jsonData);
      setData(jsonData);
      setProcessor(dataProcessor);
      setShowUploadModal(false);
    } catch (err) {
      setError(
        "文件格式错误或数据处理失败: " +
          (err instanceof Error ? err.message : String(err))
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setData(null);
    setProcessor(null);
    setError("");
    setShowUploadModal(true);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleNewAnalysis = () => {
    setShowUploadModal(true);
    handleReset();
  };

  // 如果有数据并且不显示上传模态框，显示可视化组件
  if (data && processor && !showUploadModal) {
    return (
      <div className="relative h-screen">
        <VisualizationComponent processor={processor} onNewAnalysis={handleNewAnalysis} />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-purple-50">
      {/* 背景装饰 */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-gradient-to-br from-blue-200/30 to-purple-200/30 rounded-full blur-3xl"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-gradient-to-br from-pink-200/30 to-blue-200/30 rounded-full blur-3xl"></div>
      </div>

      {/* 左上角返回按钮 */}
      <div className="absolute top-4 left-4 z-50">
        <Link
          href="/"
          className="flex items-center justify-center w-12 h-12 bg-white/90 hover:bg-white backdrop-blur-sm rounded-xl shadow-lg border border-gray-200/50 transition-all hover:shadow-xl"
        >
          <svg
            className="w-6 h-6 text-gray-700"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            />
          </svg>
        </Link>
      </div>

      {/* 上传提示模态框 */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-gradient-to-br from-black/60 via-black/50 to-black/60 backdrop-blur-sm flex items-center justify-center z-[200]">
          <div className="bg-white/98 backdrop-blur-md rounded-3xl shadow-2xl border border-gray-200/50 p-10 max-w-lg w-full mx-4 animate-in zoom-in-95 fade-in duration-500">
            <div className="text-center">
              <div className="w-20 h-20 bg-gradient-to-br from-blue-500 via-purple-500 to-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-8 shadow-lg">
                <svg
                  className="w-10 h-10 text-white"
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
              </div>

              <h2 className="text-3xl font-bold bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 bg-clip-text text-transparent mb-3">
                开始数据分析
              </h2>
              <p className="text-gray-600 mb-8 leading-relaxed">
                上传您的 JSON 格式评论数据文件<br />
                <span className="text-sm text-gray-500">开启智能可视化分析之旅</span>
              </p>

              {/* 文件上传区域 */}
              <div className="mb-6">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleFileUpload}
                  className="hidden"
                  id="visualization-file-input"
                  disabled={isLoading}
                />
                <label
                  htmlFor="visualization-file-input"
                  className={`block w-full p-8 border-2 border-dashed rounded-2xl transition-all duration-300 ${
                    isLoading
                      ? "border-gray-300 bg-gray-50 cursor-not-allowed opacity-60"
                      : "border-blue-300 hover:border-blue-500 hover:bg-blue-50/50 cursor-pointer hover:shadow-lg"
                  }`}
                  style={{ pointerEvents: isLoading ? 'none' : 'auto' }}
                >
                  <div className="text-center">
                    {isLoading ? (
                      <div className="w-12 h-12 mx-auto mb-4">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
                      </div>
                    ) : (
                      <svg
                        className="w-12 h-12 mx-auto mb-4 text-blue-500"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                        />
                      </svg>
                    )}
                    <p className="text-base font-medium text-gray-700 mb-2">
                      {isLoading ? "正在处理文件..." : "点击选择文件或拖拽到此处"}
                    </p>
                    <p className="text-sm text-gray-500">
                      支持 JSON 格式的评论数据文件
                    </p>
                  </div>
                </label>
              </div>

              {/* 错误提示 */}
              {error && (
                <div className="mb-6 p-4 bg-red-50/80 border border-red-200/50 rounded-xl backdrop-blur-sm">
                  <div className="flex items-center">
                    <svg className="w-5 h-5 text-red-500 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-red-700 text-sm font-medium">{error}</p>
                  </div>
                </div>
              )}

              {/* 操作按钮组 */}
              <div className="flex space-x-3">
                <button
                  onClick={() => setShowUploadModal(false)}
                  disabled={isLoading}
                  className="flex-1 px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                >
                  稍后上传
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isLoading}
                  className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-500 via-purple-500 to-indigo-500 hover:from-blue-600 hover:via-purple-600 hover:to-indigo-600 text-white rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed font-medium shadow-lg hover:shadow-xl"
                >
                  {isLoading ? "处理中..." : "选择文件"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 无数据时的占位内容 */}
      {!showUploadModal && !data && (
        <div className="text-center relative z-10">
          <div className="w-32 h-32 bg-gradient-to-br from-gray-200 via-gray-300 to-gray-400 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-lg">
            <svg
              className="w-16 h-16 text-gray-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
          </div>
          <h2 className="text-3xl font-bold bg-gradient-to-r from-gray-700 via-gray-800 to-gray-700 bg-clip-text text-transparent mb-4">
            等待数据上传
          </h2>
          <p className="text-gray-500 mb-8 text-lg leading-relaxed max-w-md mx-auto">
            请上传 JSON 格式的评论数据文件<br />
            <span className="text-sm">以开始智能分析和可视化</span>
          </p>
          <button
            onClick={() => setShowUploadModal(true)}
            className="px-8 py-4 bg-gradient-to-r from-blue-500 via-purple-500 to-indigo-500 hover:from-blue-600 hover:via-purple-600 hover:to-indigo-600 text-white rounded-2xl transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105 font-medium text-lg"
          >
            选择文件
          </button>
        </div>
      )}
    </div>
  );
}