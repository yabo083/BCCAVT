/**
 * 构建脚本（由 package.json 的 build/dev 调用），依次把产物写进 dist/：
 *   app              页面（src/ui/app.html，侧边栏 + 整页）与后台 Service Worker（background.js，ESM）
 *   content:main     内容脚本主世界（content/main.js，自包含 IIFE）
 *   content:isolated 内容脚本隔离世界（content/isolated.js，自包含 IIFE）
 *   manifest         打包 src/extension/manifest.ts 并求值出 createManifest()，写出 dist/manifest.json
 * 清单里的 host_permissions 直接来自平台适配器，version 直接来自 package.json，两处都不手工同步。
 * 环境变量：LOUPE_APP_HTML（默认 src/ui/app.html）、LOUPE_OUT_DIR（默认 dist）。
 * 用法：node scripts/build.mjs [--watch]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const configFile = fileURLToPath(new URL('../vite.config.ts', import.meta.url));
const outDir = resolve(projectRoot, process.env.LOUPE_OUT_DIR ?? 'dist');
const watch = process.argv.includes('--watch');
const mode = watch ? 'development' : 'production';

async function runPass({ target, entry, useWatch = watch }) {
  process.env.LOUPE_BUILD_TARGET = target;
  if (entry === undefined) delete process.env.LOUPE_CONTENT_ENTRY;
  else process.env.LOUPE_CONTENT_ENTRY = entry;
  return build({
    configFile,
    mode: useWatch ? mode : 'production',
    build: { watch: useWatch ? {} : null },
  });
}

await runPass({ target: 'app' });
await runPass({ target: 'content', entry: 'content/main' });
await runPass({ target: 'content', entry: 'content/isolated' });

// 清单固定用一次性构建求值：watch 模式下也只在启动时生成一次（改 manifest.ts 需重跑构建）。
const manifestOutput = await runPass({ target: 'manifest', useWatch: false });
const chunks = (Array.isArray(manifestOutput) ? manifestOutput[0] : manifestOutput).output.filter(
  (item) => item.type === 'chunk',
);
if (chunks.length !== 1) {
  throw new Error(`manifest 趟应只产出 1 个 chunk，实际 ${chunks.length} 个`);
}
const { createManifest } = await import(`data:text/javascript;base64,${Buffer.from(chunks[0].code).toString('base64')}`);
const version = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8')).version;

mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'manifest.json'), `${JSON.stringify(createManifest(version), null, 2)}\n`);
