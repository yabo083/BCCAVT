"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

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
      <div className="absolute top-8 left-1/2 -translate-x-1/2 z-30 w-[520px] max-w-[90vw]">
        <div
          className="bg-white/95 backdrop-blur-md rounded-3xl shadow-2xl px-10 py-6 text-center border border-white/60 ring-2 ring-blue-200/40 ring-offset-2 animate-fade-in drop-shadow-xl"
          style={{ boxShadow: "0 0 40px 0 #a5b4fc66" }}
        >
          <h1
            className="font-kosugi text-4xl md:text-5xl font-bold bg-gradient-to-r from-gray-900 via-blue-900 to-purple-900 bg-clip-text text-transparent tracking-wide drop-shadow-lg"
            style={{ textShadow: "0 2px 8px #a5b4fc66" }}
          >
            Bilibili评论可视化系统
          </h1>
          <p className="text-gray-600 mt-3 font-medium">
            智能分析 • 数据洞察 • 可视化呈现
          </p>
        </div>
      </div>

      {/* 左下角四个菱形按钮组 */}
      <div className="font-kosugi absolute bottom-12 left-12 z-30 flex flex-col items-center">
        <div className="relative w-64 h-64">
          {/* 数据分析按钮（可用）- 顶部 */}
          <div className="absolute left-1/2 top-0 -translate-x-1/2">
            <Link href="/visualization">
              <button
                className="flex items-center justify-center w-28 h-28 bg-gradient-to-br from-blue-500 via-purple-500 to-indigo-600 text-white font-bold text-lg shadow-2xl border-2 border-white/60 cursor-pointer transition-all select-none rounded-2xl rotate-45 ring-4 ring-blue-300/40 hover:scale-110 hover:brightness-110 hover:ring-purple-300/60 active:scale-95 animate-fade-in-slow hover:shadow-purple-200/60"
                style={{
                  position: "relative",
                  boxShadow: "0 0 32px 0 #a5b4fc66, 0 0 12px 4px #f472b666",
                }}
              >
                <span className="-rotate-45 tracking-wide drop-shadow-lg font-semibold">
                  数据分析
                </span>
              </button>
            </Link>
          </div>
          {/* 一站式爬取 - 右侧 */}
          <div className="absolute right-0 top-1/2 -translate-y-1/2">
            <Link href="/crawler">
              <button
                className="flex items-center justify-center w-28 h-28 bg-gradient-to-br from-green-500 via-teal-500 to-cyan-600 text-white font-bold text-lg shadow-2xl border-2 border-white/60 cursor-pointer rounded-2xl rotate-45 select-none hover:scale-110 hover:brightness-110 hover:ring-teal-300/60 active:scale-95 transition-all animate-fade-in-slow ring-4 ring-green-300/40"
                style={{ 
                  boxShadow: "0 0 32px 0 #10b98166, 0 0 12px 4px #06b6d466",
                }}
              >
                <span className="-rotate-45 tracking-wide drop-shadow-lg font-semibold">一站式爬取</span>
              </button>
            </Link>
          </div>
          {/* 尽请期待1 - 底部 */}
          <div className="absolute left-1/2 bottom-0 -translate-x-1/2">
            <button
              disabled
              className="flex items-center justify-center w-28 h-28 bg-gradient-to-br from-gray-300 via-gray-400 to-gray-500 text-gray-600 font-bold text-lg shadow-xl border-2 border-white/60 cursor-not-allowed rounded-2xl rotate-45 select-none opacity-70 hover:scale-105 transition-all animate-fade-in-slow"
              style={{ boxShadow: "0 0 20px 0 #6b728066" }}
            >
              <span className="-rotate-45 tracking-wide font-semibold">尽请期待</span>
            </button>
          </div>
          {/* 尽请期待2 - 左侧 */}
          <div className="absolute left-0 top-1/2 -translate-y-1/2">
            <button
              disabled
              className="flex items-center justify-center w-28 h-28 bg-gradient-to-br from-gray-300 via-gray-400 to-gray-500 text-gray-600 font-bold text-lg shadow-xl border-2 border-white/60 cursor-not-allowed rounded-2xl rotate-45 select-none opacity-70 hover:scale-105 transition-all animate-fade-in-slow"
              style={{ boxShadow: "0 0 20px 0 #6b728066" }}
            >
              <span className="-rotate-45 tracking-wide font-semibold">尽请期待</span>
            </button>
          </div>
        </div>
      </div>

      {/* 右下角图片源选择卡片 */}
      <div
        className="absolute bottom-12 right-12 z-30 flex items-center space-x-3 bg-white/95 backdrop-blur-md rounded-2xl shadow-xl px-6 py-4 border border-white/60 ring-2 ring-blue-200/30 hover:ring-purple-200/50 transition-all animate-fade-in-slow"
        style={{ boxShadow: "0 0 24px 0 #a5b4fc44" }}
      >
        <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <span className="text-sm text-gray-700 font-semibold">图片源</span>
        <select
          value={apiType}
          onChange={(e) => setApiType(e.target.value as "bing" | "acg")}
          className="text-sm px-4 py-2 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white/90 shadow-sm hover:bg-purple-50 transition-all font-medium"
        >
          {IMAGE_APIS.map((api) => (
            <option key={api.value} value={api.value}>
              {api.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => fetchDailyImage()}
          className="font-kosugi ml-2 px-4 py-2 bg-gradient-to-r from-blue-500 via-purple-500 to-indigo-500 hover:from-blue-600 hover:via-purple-600 hover:to-indigo-600 text-white rounded-xl shadow-lg font-semibold text-sm transition-all ring-2 ring-blue-200/40 hover:ring-purple-300/60 hover:scale-105"
          style={{ textShadow: "0 1px 4px #a5b4fc88" }}
        >
          换一张
        </button>
      </div>
    </div>
  );
}
