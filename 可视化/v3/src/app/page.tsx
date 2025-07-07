"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

export default function Home() {
  // 支持的图片API选项
  const IMAGE_API_OPTIONS = [
    { label: "Bing每日", value: "bing" },
    { label: "二次元", value: "acg" },
    { label: "PC壁纸", value: "pcGirl" },
    { label: "p站", value: "pixiv" },
  ];
  // 背景图片状态管理 - 支持LQIP
  const [bgUrl, setBgUrl] = useState<string>("");
  const [placeholderUrl, setPlaceholderUrl] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [isPlaceholderLoaded, setIsPlaceholderLoaded] = useState(false);

  const [apiType, setApiType] = useState<"bing" | "acg" | "pcGirl" | "pixiv">(
    "bing"
  );
  const [isInitialized, setIsInitialized] = useState(false);

  // 图片缓存key
  const getCacheKey = (type: string, size: "regular" | "thumb") =>
    `bg_image_cache_${type}_${size}`;

  // 保存用户选择的API类型
  const saveApiType = (type: string) => {
    try {
      localStorage.setItem("selected_api_type", type);
      console.log("[saveApiType] 已保存API类型:", type);
    } catch (e) {
      console.error("[saveApiType] 保存API类型失败:", e);
    }
  };

  // 加载用户选择的API类型
  const loadApiType = () => {
    try {
      const savedType = localStorage.getItem("selected_api_type");
      if (savedType && ["bing", "acg", "pcGirl", "pixiv"].includes(savedType)) {
        setApiType(savedType as "bing" | "acg" | "pcGirl" | "pixiv");
        console.log("[loadApiType] 已加载API类型:", savedType);
        return savedType;
      }
    } catch (e) {
      console.error("[loadApiType] 加载API类型失败:", e);
    }
    return "bing"; // 默认返回bing
  };

  // 从缓存加载图片
  const loadFromCache = (type: string) => {
    try {
      const regularCacheKey = getCacheKey(type, "regular");
      const thumbCacheKey = getCacheKey(type, "thumb");

      const regularCached = localStorage.getItem(regularCacheKey);
      const thumbCached = localStorage.getItem(thumbCacheKey);

      if (regularCached && thumbCached) {
        const { url: regularUrl, timestamp: regularTimestamp } =
          JSON.parse(regularCached);
        const { url: thumbUrl, timestamp: thumbTimestamp } =
          JSON.parse(thumbCached);
        const now = Date.now();
        const cacheExpiry = 24 * 60 * 60 * 1000; // 24小时过期

        if (
          now - regularTimestamp < cacheExpiry &&
          now - thumbTimestamp < cacheExpiry
        ) {
          console.log("[loadFromCache] 从缓存加载图片:", {
            regularUrl,
            thumbUrl,
          });
          setPlaceholderUrl(thumbUrl);
          setBgUrl(regularUrl);
          setIsLoading(false);
          setIsPlaceholderLoaded(true);
          return true;
        } else {
          // 缓存过期，删除
          localStorage.removeItem(regularCacheKey);
          localStorage.removeItem(thumbCacheKey);
          console.log("[loadFromCache] 缓存已过期，已删除");
        }
      }
    } catch (e) {
      console.error("[loadFromCache] 读取缓存失败:", e);
    }
    return false;
  };

  // 保存到缓存
  const saveToCache = (type: string, regularUrl: string, thumbUrl: string) => {
    try {
      const regularCacheKey = getCacheKey(type, "regular");
      const thumbCacheKey = getCacheKey(type, "thumb");
      const timestamp = Date.now();

      const regularCacheData = { url: regularUrl, timestamp };
      const thumbCacheData = { url: thumbUrl, timestamp };

      localStorage.setItem(regularCacheKey, JSON.stringify(regularCacheData));
      localStorage.setItem(thumbCacheKey, JSON.stringify(thumbCacheData));
      console.log("[saveToCache] 图片已缓存:", { regularUrl, thumbUrl });
    } catch (e) {
      console.error("[saveToCache] 保存缓存失败:", e);
    }
  };

  // 清理所有过期缓存
  const cleanExpiredCache = () => {
    try {
      const now = Date.now();
      const cacheExpiry = 24 * 60 * 60 * 1000; // 24小时

      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith("bg_image_cache_")) {
          try {
            const cached = localStorage.getItem(key);
            if (cached) {
              const { timestamp } = JSON.parse(cached);
              if (now - timestamp >= cacheExpiry) {
                localStorage.removeItem(key);
                console.log("[cleanExpiredCache] 已删除过期缓存:", key);
              }
            }
          } catch {
            // 缓存数据格式错误，直接删除
            localStorage.removeItem(key);
          }
        }
      });
    } catch (e) {
      console.error("[cleanExpiredCache] 清理缓存失败:", e);
    }
  };

  // 获取每日图片（支持LQIP和缓存）
  const fetchDailyImage = async (type = apiType, forceRefresh = false) => {
    setIsLoading(true);
    setIsPlaceholderLoaded(false);
    setBgUrl("");
    setPlaceholderUrl("");

    // 如果不是强制刷新，先尝试从缓存加载
    if (!forceRefresh && loadFromCache(type)) {
      return;
    }

    try {
      console.log(
        "[fetchDailyImage] 请求API代理:",
        `/api/image-proxy?type=${type}`
      );
      const res = await fetch(`/api/image-proxy?type=${type}`);
      const data = await res.json();
      console.log("[fetchDailyImage] API代理响应:", data);

      if (data.error) {
        console.error("[fetchDailyImage] API代理返回错误:", data.error);
        setBgUrl("");
        setPlaceholderUrl("");
        return;
      }

      const { regularUrl, thumbUrl } = data;

      if (regularUrl && thumbUrl) {
        // 先加载缩略图作为占位符
        setPlaceholderUrl(thumbUrl);
        setBgUrl(regularUrl);
        saveToCache(type, regularUrl, thumbUrl); // 保存到缓存
        console.log("[fetchDailyImage] 设置图片URLs:", {
          regularUrl,
          thumbUrl,
        });
      } else {
        console.warn("[fetchDailyImage] 无法从API代理响应中提取图片URL:", data);
        setBgUrl("");
        setPlaceholderUrl("");
      }
    } catch (e) {
      console.error("[fetchDailyImage] 加载图片失败:", e);
      setBgUrl("");
      setPlaceholderUrl("");
    } finally {
      // 注意：这里不设置 setIsLoading(false)，因为我们需要等待高清图片加载完成
    }
  };

  useEffect(() => {
    // 初始化时清理过期缓存
    cleanExpiredCache();
    // 首次加载时，先恢复用户选择的API类型
    const savedApiType = loadApiType() as "bing" | "acg";
    setApiType(savedApiType); // 设置状态
    // 加载对应类型的图片（优先从缓存）
    fetchDailyImage(savedApiType);
    setIsInitialized(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 只在组件挂载时执行一次

  // 监听apiType变化，保存用户选择并加载新图片（跳过初始化阶段）
  useEffect(() => {
    if (isInitialized && apiType) {
      saveApiType(apiType);
      fetchDailyImage(apiType);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiType, isInitialized]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden">
      {/* 背景图片系统 - LQIP实现 */}
      {placeholderUrl && (
        // 占位符图片 (模糊缩略图)
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={placeholderUrl}
          alt="背景占位符"
          className={`absolute inset-0 object-cover w-full h-full scale-105 transition-opacity duration-500 ${
            isLoading && isPlaceholderLoaded ? "opacity-100" : "opacity-0"
          }`}
          style={{
            filter: "blur(20px)",
            zIndex: -21,
          }}
          onLoad={() => {
            setIsPlaceholderLoaded(true);
            console.log("占位符图片加载完成");
          }}
          onError={() => {
            console.error("占位符图片加载失败:", placeholderUrl);
            setIsPlaceholderLoaded(false);
          }}
        />
      )}

      {bgUrl && (
        // 高清背景图片
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={bgUrl}
          alt="背景图片"
          className={`absolute inset-0 object-cover w-full h-full scale-105 transition-opacity duration-700 ${
            isLoading ? "opacity-0" : "opacity-100"
          }`}
          onLoad={() => {
            setIsLoading(false);
            console.log("高清图片加载完成");
          }}
          onError={() => {
            console.error("高清图片加载失败:", bgUrl);
            setIsLoading(false);
            // 可以在这里设置一个默认图片或清空
            setBgUrl("");
          }}
          style={{
            zIndex: -20,
          }}
        />
      )}

      {/* 渐变遮罩 */}
      {/* <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/20 to-white/80 pointer-events-none" /> */}

      {/* 顶部中央标题卡片 */}
      <div className="absolute top-8 left-1/2 -translate-x-1/2 z-30 w-[400px] sm:w-[520px] lg:w-[640px] xl:w-[720px] max-w-[90vw]">
        <div
          className="bg-white/95 backdrop-blur-md rounded-3xl shadow-2xl px-6 sm:px-10 py-6 text-center border border-white/60 ring-2 ring-blue-200/40 ring-offset-2 animate-fade-in drop-shadow-xl"
          style={{ boxShadow: "0 0 40px 0 #a5b4fc66" }}
        >
          <h1
            className="font-kosugi text-2xl sm:text-3xl md:text-4xl lg:text-5xl  font-bold bg-gradient-to-r from-gray-900 via-blue-900 to-purple-900 bg-clip-text text-transparent tracking-wide drop-shadow-lg leading-tight lg:whitespace-nowrap break-words lg:break-normal"
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
                <span className="-rotate-45 tracking-wide drop-shadow-lg font-semibold">
                  一站式爬取
                </span>
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
              <span className="-rotate-45 tracking-wide font-semibold">
                尽请期待
              </span>
            </button>
          </div>
          {/* 尽请期待2 - 左侧 */}
          <div className="absolute left-0 top-1/2 -translate-y-1/2">
            <button
              disabled
              className="flex items-center justify-center w-28 h-28 bg-gradient-to-br from-gray-300 via-gray-400 to-gray-500 text-gray-600 font-bold text-lg shadow-xl border-2 border-white/60 cursor-not-allowed rounded-2xl rotate-45 select-none opacity-70 hover:scale-105 transition-all animate-fade-in-slow"
              style={{ boxShadow: "0 0 20px 0 #6b728066" }}
            >
              <span className="-rotate-45 tracking-wide font-semibold">
                尽请期待
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* 右下角图片源选择卡片 */}
      <div
        className="absolute bottom-12 right-12 z-30 flex items-center space-x-3 bg-white/95 backdrop-blur-md rounded-2xl shadow-xl px-6 py-4 border border-white/60 ring-2 ring-blue-200/30 hover:ring-purple-200/50 transition-all animate-fade-in-slow"
        style={{ boxShadow: "0 0 24px 0 #a5b4fc44" }}
      >
        <svg
          className="w-5 h-5 text-gray-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
        <span className="text-sm text-gray-700 font-semibold">图片源</span>
        <select
          value={apiType}
          onChange={(e) => setApiType(e.target.value as "bing" | "acg")}
          className="text-sm px-4 py-2 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white/90 shadow-sm hover:bg-purple-50 transition-all font-medium"
        >
          {IMAGE_API_OPTIONS.map((api) => (
            <option key={api.value} value={api.value}>
              {api.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => fetchDailyImage(apiType, true)} // 强制刷新，不使用缓存
          className="font-kosugi ml-2 px-4 py-2 bg-gradient-to-r from-blue-500 via-purple-500 to-indigo-500 hover:from-blue-600 hover:via-purple-600 hover:to-indigo-600 text-white rounded-xl shadow-lg font-semibold text-sm transition-all ring-2 ring-blue-200/40 hover:ring-purple-300/60 hover:scale-105"
          style={{ textShadow: "0 1px 4px #a5b4fc88" }}
        >
          换一张
        </button>
      </div>
    </div>
  );
}
