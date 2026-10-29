/**
 * 打包 dist/ 为 release/loupe-<version>.zip（manifest.json 等在 zip 根）。
 * 先构建再打包；Windows 下用 PowerShell 7 的 Compress-Archive（本项目为 Windows 工程）。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
const dist = resolve(root, 'dist');
const releaseDir = resolve(root, 'release');
const out = resolve(releaseDir, `loupe-${version}.zip`);

if (!existsSync(resolve(dist, 'manifest.json'))) {
  console.error('[package] dist/manifest.json 不存在；先运行 npm run build。');
  process.exit(1);
}
if (!existsSync(releaseDir)) mkdirSync(releaseDir, { recursive: true });
if (existsSync(out)) rmSync(out);

const pwsh = process.env.PWSH ?? 'pwsh';
// 打包 dist/* 的内容（不含 dist 这层目录名），保证 manifest.json 落在 zip 根。
execFileSync(pwsh, ['-NoProfile', '-Command', `Compress-Archive -Path '${dist}/*' -DestinationPath '${out}' -Force`], {
  stdio: 'inherit',
});
console.log(`[package] 生成 ${out}`);
