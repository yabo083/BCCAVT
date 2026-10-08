/**
 * B 站视频页地址的运行时判定与归一化（后台与内容脚本共用）。
 *
 * 归一化必须丢掉 hash 与评论锚点 query：分析目标若带 `#reply<rpid>` / `comment_root_id`，
 * 平台适配器的 parseTarget 会把它解析成「评论树」目标，视频按钮就会误跑评论树。
 * 其它 query（如分集 `?p=`）保留。
 */

/** 评论锚点 query 参数；与 `src/platforms/bilibili/url.ts` 的识别保持一致。 */
const COMMENT_ANCHOR_PARAMS = ['comment_root_id', 'comment_secondary_id'];

/** 只放行 `www.bilibili.com/video/*`；清单里的 content_scripts 匹配保持同一范围。 */
export function isVideoPageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === 'https://www.bilibili.com' && url.pathname.startsWith('/video/');
  } catch {
    return false;
  }
}

/** 视频页地址 → 干净的分析输入；非视频页返回 null。 */
export function canonicalVideoUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!isVideoPageUrl(url.href)) return null;
  url.hash = '';
  for (const param of COMMENT_ANCHOR_PARAMS) url.searchParams.delete(param);
  return url.toString();
}
