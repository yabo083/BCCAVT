"use client";

import { useState, useRef, useEffect } from "react";
import { CommentDataProcessor } from "@/utils/commentDataProcessor";
import { CommentData } from "@/types/comment";
import { VisualizationComponent } from "@/components/VisualizationComponent";

// 支持的图片API
const IMAGE_APIS = [
  {
    label: "Bing每日",
    value: "bing",
    url: "https://api.vvhan.com/api/bing?type=json",
  },
  {
    label: "二次元",
    value: "acg",
    url: "https://api.vvhan.com/api/wallpaper/acg?type=json",
  },
  {
    label: "PC壁纸",
    value: "pcGirl",
    url: "https://api.vvhan.com/api/wallpaper/pcGirl?type=json",
  },
];

export default function Home() {
  const [data, setData] = useState<CommentData[] | null>(null);
  const [processor, setProcessor] = useState<CommentDataProcessor | null>(null);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 新增：每日图片
  const [bgUrl, setBgUrl] = useState<string>("");
  const [imgLoading, setImgLoading] = useState(true);

  const [apiType, setApiType] = useState<"bing" | "acg">("bing");

  // 获取每日图片（支持多API）
  const fetchDailyImage = async (type = apiType) => {
    setImgLoading(true);
    const api = IMAGE_APIS.find((a) => a.value === type) || IMAGE_APIS[0];
    try {
      console.log("[fetchDailyImage] 请求API:", api.url);
      const res = await fetch(api.url);
      const data = await res.json();
      console.log("[fetchDailyImage] API响应:", data);
      // 兼容两种API格式
      let url = data.url;
      if (!url && data.data && data.data.url) url = data.data.url;
      setBgUrl(url);
      console.log("[fetchDailyImage] 设置图片url:", url);
    } catch (e) {
      console.error("[fetchDailyImage] 加载图片失败:", e);
      setBgUrl("");
    } finally {
      setImgLoading(false);
    }
  };

  useEffect(() => {
    fetchDailyImage(apiType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiType]);

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
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  if (data && processor) {
    return (
      <VisualizationComponent processor={processor} onReset={handleReset} />
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden">
      {/* 背景图片虚化和渐变遮罩 */}
      <div className="absolute inset-0 -z-20">
        {bgUrl && (
          <img
            src={bgUrl}
            alt="每日图片"
            className={`object-cover w-full h-full transition-opacity duration-700 scale-105 ${
              imgLoading ? "opacity-0" : "opacity-100"
            }`}
            onLoad={() => setImgLoading(false)}
            style={{
              minHeight: "100vh",
              position: "absolute",
              inset: 0,
              zIndex: -20,
              filter: "blur(1px)",
            }}
          />
        )}
        {/* 渐变遮罩 */}
        {/* <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/20 to-white/80 pointer-events-none" /> */}
      </div>

      {/* 顶部中央标题卡片 */}
      <div className="absolute top-10 left-1/2 -translate-x-1/2 z-30 w-[480px] max-w-[90vw]">
        <div
          className="bg-white/80 rounded-2xl shadow-2xl px-8 py-4 text-center border border-white/60 backdrop-blur-md ring-2 ring-blue-200/40 ring-offset-2 animate-fade-in drop-shadow-xl"
          style={{ boxShadow: "0 0 32px 0 #a5b4fc55" }}
        >
          <h1
            className="font-kosugi text-3xl md:text-4xl font-bold text-gray-900 tracking-wide drop-shadow-lg"
            style={{ textShadow: "0 2px 8px #a5b4fc66" }}
          >
            Bilibili评论可视化系统
          </h1>
        </div>
      </div>

      {/* 左下角四个菱形按钮组 */}
      <div className="font-kosugi absolute bottom-10 left-10 z-30 flex flex-col items-center">
        <div className="relative w-60 h-60">
          {/* 文件上传按钮（可用）- 顶部 */}
          <div className="absolute left-1/2 top-0 -translate-x-1/2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileUpload}
              className="hidden"
              id="file-input"
            />
            <label
              htmlFor="file-input"
              className={`flex items-center justify-center w-24 h-24 bg-gradient-to-br from-pink-400 via-blue-400 to-purple-400 text-white font-bold text-base shadow-2xl border-2 border-white/60 cursor-pointer transition-all select-none rounded-xl rotate-45 ring-4 ring-blue-300/40 hover:scale-110 hover:brightness-110 hover:ring-pink-300/60 active:scale-95 animate-fade-in-slow ${
                isLoading
                  ? "bg-gray-300 text-gray-500 cursor-not-allowed opacity-60"
                  : "hover:shadow-pink-200/60"
              }`}
              style={{
                position: "relative",
                boxShadow: "0 0 24px 0 #a5b4fc55, 0 0 8px 2px #f472b655",
              }}
            >
              <span className="-rotate-45 tracking-wide drop-shadow">
                {isLoading ? "处理中..." : "文件上传"}
              </span>
            </label>
          </div>
          {/* 一站式爬取（开发中）- 右侧 */}
          <div className="absolute right-0 top-1/2 -translate-y-1/2">
            <button
              disabled
              className="flex items-center justify-center w-24 h-24 bg-gradient-to-br from-blue-200 via-purple-200 to-pink-200 text-blue-400 font-bold text-base shadow-xl border-2 border-white/60 cursor-not-allowed rounded-xl rotate-45 select-none opacity-80 hover:scale-105 transition-all animate-fade-in-slow"
              style={{ boxShadow: "0 0 12px 0 #a5b4fc33" }}
            >
              <span className="-rotate-45 tracking-wide">一站式爬取</span>
            </button>
          </div>
          {/* 尽请期待1 - 底部 */}
          <div className="absolute left-1/2 bottom-0 -translate-x-1/2">
            <button
              disabled
              className="flex items-center justify-center w-24 h-24 bg-gradient-to-br from-blue-200 via-pink-200 to-purple-200 text-purple-400 font-bold text-base shadow-xl border-2 border-white/60 cursor-not-allowed rounded-xl rotate-45 select-none opacity-80 hover:scale-105 transition-all animate-fade-in-slow"
              style={{ boxShadow: "0 0 12px 0 #f472b633" }}
            >
              <span className="-rotate-45 tracking-wide">尽请期待</span>
            </button>
          </div>
          {/* 尽请期待2 - 左侧 */}
          <div className="absolute left-0 top-1/2 -translate-y-1/2">
            <button
              disabled
              className="flex items-center justify-center w-24 h-24 bg-gradient-to-br from-purple-200 via-blue-200 to-pink-200 text-pink-400 font-bold text-base shadow-xl border-2 border-white/60 cursor-not-allowed rounded-xl rotate-45 select-none opacity-80 hover:scale-105 transition-all animate-fade-in-slow"
              style={{ boxShadow: "0 0 12px 0 #a5b4fc33" }}
            >
              <span className="-rotate-45 tracking-wide">尽请期待</span>
            </button>
          </div>
        </div>
      </div>

      {/* 右下角图片源选择卡片 */}
      <div
        className="absolute bottom-10 right-10 z-30 flex items-center space-x-2 bg-white/80 rounded-2xl shadow-xl px-5 py-3 backdrop-blur border border-white/60 ring-2 ring-blue-200/40 hover:ring-pink-200/60 transition-all animate-fade-in-slow"
        style={{ boxShadow: "0 0 16px 0 #a5b4fc33" }}
      >
        <span className="text-sm text-gray-700 font-medium">图片源</span>
        <select
          value={apiType}
          onChange={(e) => setApiType(e.target.value as "bing" | "acg")}
          className="text-sm px-3 py-1 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-pink-400 bg-white/90 shadow hover:bg-pink-50 transition-all"
        >
          {IMAGE_APIS.map((api) => (
            <option key={api.value} value={api.value}>
              {api.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => fetchDailyImage()}
          className="font-kosugi ml-2 px-3 py-1 bg-gradient-to-r from-pink-400 via-blue-400 to-purple-400 hover:from-pink-500 hover:to-blue-500 text-white rounded-lg shadow font-semibold text-xs transition-all ring-2 ring-blue-200/40 hover:ring-pink-300/60"
          style={{ textShadow: "0 1px 4px #a5b4fc88" }}
        >
          换一张
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="absolute top-32 left-1/2 -translate-x-1/2 z-40 w-[360px] max-w-[90vw] mb-4 p-4 bg-pink-50 border border-pink-200 rounded-lg shadow animate-fade-in">
          <p className="text-pink-700 text-sm text-center">{error}</p>
        </div>
      )}
    </div>
  );
}
