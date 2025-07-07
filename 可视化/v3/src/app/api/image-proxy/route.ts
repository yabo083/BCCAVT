// 文件路径: src/app/api/image-proxy/route.ts

import { NextResponse } from 'next/server';

// const PROXY_URL = 'i.yuki.sh' 
const PROXY_URL = 'pvjfjdj.sz7372797.workers.dev'; // 代理服务器地址

// 支持的图片API配置
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
    {
        label: "p站",
        value: "pixiv",
        url: `https://api.lolicon.app/setu/v2?r18=0&size=regular&size=thumb&aspectRatio=gt1&excludeAI=true&proxy=${PROXY_URL}`,
    },
];

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'bing';
    
    const api = IMAGE_APIS.find((a) => a.value === type) || IMAGE_APIS[0];
    
    console.log("[image-proxy] 请求API:", api.url);
    
    const response = await fetch(api.url, {
      headers: {
        'ngrok-skip-browser-warning': 'true'
      }
    });
    
    if (!response.ok) {
      return NextResponse.json(
        { error: `External API Error: ${response.statusText}` },
        { status: response.status }
      );
    }
    
    const data = await response.json();
    console.log("[image-proxy] API响应:", data);
    
    let regularUrl = "";
    let thumbUrl = "";
    
    // 根据不同的API类型解析响应数据
    switch (type) {
      case "pixiv":
        // pixiv API 支持多尺寸返回
        if (data.data && data.data[0] && data.data[0].urls) {
          regularUrl = data.data[0].urls.regular || "";
          thumbUrl = data.data[0].urls.thumb || "";
        }
        break;
        
      case "bing":
      case "acg":
      case "pcGirl":
      default:
        // 对于其他API，只有一个尺寸，我们创建缩略图版本
        let originalUrl = "";
        
        // 提取原始URL
        if (data.url) {
          originalUrl = data.url;
        } else if (data.imgurl) {
          originalUrl = data.imgurl;
        } else if (data.data && data.data.url) {
          originalUrl = data.data.url;
        }
        
        if (originalUrl) {
          regularUrl = originalUrl;
          // 为非pixiv API创建缩略图URL（通过添加缩放参数）
          // 这里使用第三方图片缩放服务或者保持原图作为缩略图
          thumbUrl = originalUrl.includes('?') 
            ? `${originalUrl}&w=100&h=100&fit=crop` 
            : `${originalUrl}?w=100&h=100&fit=crop`;
        }
        break;
    }
    
    // 返回统一格式的响应
    const result = {
      regularUrl,
      thumbUrl: thumbUrl || regularUrl, // 如果没有缩略图，使用原图
      type,
      apiLabel: api.label
    };
    
    console.log("[image-proxy] 返回结果:", result);
    
    return NextResponse.json(result);
    
  } catch (error) {
    console.error("[image-proxy] API proxy error:", error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
