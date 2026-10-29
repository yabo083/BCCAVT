/**
 * Chrome MV3 清单。作为唯一真相在构建时求值并写成 dist/manifest.json：
 * host_permissions 派生自平台适配器，version 派生自 package.json（见 scripts/build.mjs）。
 */
import { adapters } from '../platforms';

/** 内容脚本注入的页面：评论 UI 只存在于视频页。适配器契约暂无该字段，新增平台时一并登记。 */
const CONTENT_SCRIPT_MATCHES = ['https://www.bilibili.com/*'];

export function createManifest(version: string): chrome.runtime.ManifestV3 {
  return {
    manifest_version: 3,
    name: 'Loupe · 评鉴',
    description: '评论区解析：抓取、评论树分析、可视化与 AI 解读（当前平台：Bilibili）。',
    version,
    minimum_chrome_version: '116',
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    action: {
      default_title: 'Loupe · 评鉴',
      default_icon: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png' },
      // 左键单击工具栏图标打开紧凑设置面板；不再有侧栏，也没有 default_popup 之外的入口。
      default_popup: 'src/ui/config.html',
    },
    background: { service_worker: 'background.js', type: 'module' },
    permissions: ['storage', 'contextMenus', 'declarativeNetRequest'],
    host_permissions: [...new Set(adapters.flatMap((adapter) => adapter.hostPermissions))],
    // AI 接口地址由用户自行填写，首次使用某个来源时申请权限
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    web_accessible_resources: [{
      resources: ['src/ui/embedded.html', 'assets/*'],
      matches: ['https://www.bilibili.com/*'],
    }],
    content_scripts: [
      { matches: CONTENT_SCRIPT_MATCHES, js: ['content/main.js'], world: 'MAIN', run_at: 'document_idle' },
      { matches: CONTENT_SCRIPT_MATCHES, js: ['content/isolated.js'], run_at: 'document_idle' },
    ],
  };
}
