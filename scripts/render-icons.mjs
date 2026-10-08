/**
 * 用 @resvg/resvg-js 把 assets/icon.svg 光栅化成 public/icons/icon-{16,32,48,128}.png。
 * 这些 PNG 是构建输入（manifest 直接引用，Vite 从 public/ 原样拷贝进 dist/），修改 SVG 后需重新运行并提交：
 *   node scripts/render-icons.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(resolve(projectRoot, 'assets/icon.svg'), 'utf8');
const outputDir = resolve(projectRoot, 'public/icons');
mkdirSync(outputDir, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(resolve(outputDir, `icon-${size}.png`), png);
}
