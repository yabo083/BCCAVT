/**
 * 可选主机权限（用户自填的 AI 接口地址）。requestOriginPermission 必须由点击手势的第一个 await 调用，
 * 因此函数体里同步发起 chrome.permissions.request。
 */
function originPattern(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`无法为 ${parsed.protocol} 申请主机权限：${url}`);
  }
  return `${parsed.protocol}//${parsed.hostname}/*`;
}

export function requestOriginPermission(url: string): Promise<boolean> {
  return chrome.permissions.request({ origins: [originPattern(url)] });
}

export function hasOriginPermission(url: string): Promise<boolean> {
  return chrome.permissions.contains({ origins: [originPattern(url)] });
}
