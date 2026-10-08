/**
 * Bilibili WBI 签名。密钥由 nav 接口的 wbi_img 图片文件名派生，30 分钟有效（见缓存 session 级 TTL）。
 */
import { md5Hex } from './md5';

/** 官方打乱表：mixinKey = reorder(imgKey + subKey).slice(0, 32)。 */
const MIXIN_KEY_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38,
  41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
];

export interface WbiKeys {
  imgKey: string;
  subKey: string;
}

/** 从 wbi_img 的图片 URL 取文件名（不含扩展名）作为密钥。 */
export function keyFromWbiUrl(url: string): string {
  const file = url.split('/').pop() ?? '';
  const dot = file.indexOf('.');
  return dot > 0 ? file.slice(0, dot) : file;
}

export function mixinKey(keys: WbiKeys): string {
  const source = keys.imgKey + keys.subKey;
  let mixed = '';
  for (const index of MIXIN_KEY_TAB) mixed += source[index] ?? '';
  return mixed.slice(0, 32);
}

/**
 * 生成带签名的查询串（含 wts 与 w_rid）。
 * 注意：wts 由调用方给定，便于测试与复用。
 */
export function signQuery(params: Record<string, string | number>, keys: WbiKeys, wts: number): string {
  const merged: Record<string, string> = {};
  for (const [name, value] of Object.entries(params)) merged[name] = String(value);
  merged['wts'] = String(wts);
  const query = Object.keys(merged)
    .sort()
    // 官方要求：值里去掉 !'()* 后再编码。
    .map((name) => `${encodeURIComponent(name)}=${encodeURIComponent(merged[name]!.replace(/[!'()*]/g, ''))}`)
    .join('&');
  return `${query}&w_rid=${md5Hex(query + mixinKey(keys))}`;
}
