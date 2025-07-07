// 文件路径: src/app/api/pixiv/route.ts

import { NextResponse } from 'next/server';

// 目标API地址
const EXTERNAL_API_URL = 'https://api.lolicon.app/setu/v2?r18=0&size=regular&aspectRatio=gt1&excludeAI=true';

export async function GET() {
  try {
    // 从服务器端发起请求，可以完美绕过浏览器的CORS限制。
    // lolicon API默认会返回经过代理的图片地址(i.pixiv.re)，
    // 所以我们在这里不需要手动处理图片的防盗链问题。
    const response = await fetch(EXTERNAL_API_URL);

    if (!response.ok) {
      // 如果外部API返回错误，将错误信息传递给客户端
      return NextResponse.json(
        { error: `External API Error: ${response.statusText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    
    // 成功获取数据后，将其原样返回给你的前端组件
    return NextResponse.json(data);

  } catch (error) {
    console.error("API proxy error:", error);
    // 处理网络请求等内部错误
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}