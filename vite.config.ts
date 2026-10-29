/**
 * 构建配置。`npm run build` 实际调用 scripts/build.mjs，它按顺序跑四趟 Vite 构建：
 *   app            页面（src/ui/app.html，整页工作台）、工具栏设置弹窗（src/ui/config.html）
 *                  与后台 Service Worker（ESM）
 *   content:main   内容脚本主世界（自包含 IIFE）
 *   content:isolated 内容脚本隔离世界（自包含 IIFE）
 *   manifest       只打包求值（write: false），导出 createManifest(version)，由 build.mjs 写出 dist/manifest.json
 * 内容脚本必须是无 import 的经典脚本，因此与页面分开构建，且每条单独构建（IIFE 不支持多入口）。
 * 直接执行 `vite build` 只会得到 app 一趟的产物。
 */
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import Icons from 'unplugin-icons/vite';
import { defineConfig, type UserConfig } from 'vite';

const projectRootUrl = new URL('.', import.meta.url);

/** 构建目标，由 scripts/build.mjs 通过环境变量选择。 */
type BuildTarget = 'app' | 'content' | 'manifest';

/** 内容脚本入口：输出路径 → 源文件。 */
const CONTENT_ENTRIES: Record<string, string> = {
  'content/main': 'src/extension/content/main.ts',
  'content/isolated': 'src/extension/content/isolated.ts',
};

const DEFAULT_APP_HTML = 'src/ui/app.html';

/** 文件在 dist/ 里的名字是 manifest 直接引用的，必须确定且不含哈希。 */
const BACKGROUND_ENTRY_FILE_NAME = 'background.js';

const alias = { '@': fileURLToPath(new URL('./src', import.meta.url)) };

function fromProjectRoot(pathOrRelative: string): string {
  return isAbsolute(pathOrRelative) ? pathOrRelative : fileURLToPath(new URL(pathOrRelative, projectRootUrl));
}

function readTarget(): BuildTarget {
  const target = process.env.LOUPE_BUILD_TARGET;
  if (target === 'content' || target === 'manifest') return target;
  return 'app';
}

function shared() {
  return {
    base: '',
    root: fileURLToPath(projectRootUrl),
    resolve: { alias },
    build: { target: 'chrome116', cssCodeSplit: true, sourcemap: false },
  } satisfies UserConfig;
}

function appConfig(outDir: string, appHtml: string): UserConfig {
  const base = shared();
  return {
    ...base,
    publicDir: 'public',
    plugins: [vue(), Icons({ compiler: 'vue3' })],
    build: {
      ...base.build,
      outDir,
      emptyOutDir: true,
      // 扩展页面不走 CDN/预加载，关掉注入的 modulepreload polyfill
      modulePreload: false,
      rollupOptions: {
        input: {
          app: fromProjectRoot(appHtml),
          config: fromProjectRoot('src/ui/config.html'),
          embedded: fromProjectRoot('src/ui/embedded.html'),
          background: fromProjectRoot('src/extension/background.ts'),
        },
        output: {
          entryFileNames: (chunk) =>
            chunk.name === 'background' ? BACKGROUND_ENTRY_FILE_NAME : 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
  };
}

function contentConfig(outDir: string, entry: string, sourcePath: string): UserConfig {
  const base = shared();
  return {
    ...base,
    publicDir: false,
    build: {
      ...base.build,
      outDir,
      // 追加到 app 趟的产物之后，不能清空
      emptyOutDir: false,
      rollupOptions: {
        input: { [entry]: fromProjectRoot(sourcePath) },
        output: { format: 'iife', entryFileNames: '[name].js' },
      },
    },
  };
}

function manifestConfig(outDir: string): UserConfig {
  const base = shared();
  return {
    ...base,
    publicDir: false,
    build: {
      ...base.build,
      outDir,
      emptyOutDir: false,
      minify: false,
      // 不落盘：只是把 src/extension/manifest.ts 打包成可求值的 ESM，交给 build.mjs 生成 dist/manifest.json
      write: false,
      rollupOptions: {
        input: { manifest: fromProjectRoot('src/extension/manifest.ts') },
        output: { format: 'es' },
        // 默认会剔除入口的导出，这里要的是把 createManifest() 取回来求值
        preserveEntrySignatures: 'strict',
      },
    },
  };
}

export default defineConfig((): UserConfig => {
  const outDir = process.env.LOUPE_OUT_DIR ?? 'dist';
  const target = readTarget();

  if (target === 'content') {
    const entry = process.env.LOUPE_CONTENT_ENTRY ?? '';
    const sourcePath = CONTENT_ENTRIES[entry];
    if (!sourcePath) {
      throw new Error(`未知的内容脚本入口 LOUPE_CONTENT_ENTRY=${entry}；可选：${Object.keys(CONTENT_ENTRIES).join(', ')}`);
    }
    return contentConfig(outDir, entry, sourcePath);
  }
  if (target === 'manifest') return manifestConfig(outDir);
  return appConfig(outDir, process.env.LOUPE_APP_HTML ?? DEFAULT_APP_HTML);
});
