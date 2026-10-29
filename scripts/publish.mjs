/**
 * Chrome Web Store 发布脚本（零依赖，用 Node 24 全局 fetch + 官方 REST API）。
 *
 * 凭据只从环境变量 / 本地 .env 读取，绝不写回磁盘、绝不打印：
 *   CWS_CLIENT_ID / CWS_CLIENT_SECRET / CWS_REFRESH_TOKEN  —— OAuth（一次性配置，见 docs/publishing.md）
 *   CWS_EXTENSION_ID    —— 已存在的扩展 id；缺省则「新建条目」（insert）
 *   CWS_PUBLISH_TARGET  —— default（公开/按商店审核）| trustedTesters（内测）；默认 default
 *
 * 用法：
 *   node scripts/publish.mjs            # 上传 release/loupe-<version>.zip 并发布
 *   node scripts/publish.mjs --draft    # 只上传成草稿，不发布（先在后台补素材/隐私政策）
 *
 * 流程：refresh_token → access_token →（有 id 则 PUT 更新，否则 POST 新建）→ 查 uploadState →（非 --draft 时）publish。
 */
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 读 .env（KEY=VALUE，忽略注释与空行）叠加到 process.env，不覆盖已有的真实环境变量。 */
function loadDotEnv() {
  const file = resolve(root, '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`[publish] 缺少环境变量 ${name}；见 docs/publishing.md 配置 .env。`);
    process.exit(1);
  }
  return value;
}

/**
 * 走本机代理的 HTTP 调用。Node 24 的 fetch 不读 HTTP_PROXY/HTTPS_PROXY，
 * 而本项目在本机必须走代理（http://127.0.0.1:7890）才能访问 Google，因此统一用 curl。
 * 返回 { status, body }；凭据类响应只在调用方按需取字段，绝不整体打印。
 */
async function http(url, { method = 'GET', headers = {}, form } = {}) {
  const args = ['-s', '-X', method];
  const proxy = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;
  if (proxy) args.push('-x', proxy);
  for (const [key, value] of Object.entries(headers)) args.push('-H', `${key}: ${value}`);
  if (form !== undefined) {
    args.push('-H', 'Content-Type: application/x-www-form-urlencoded');
    args.push('--data-binary', String(form));
  }
  args.push('-w', '\n%{http_code}', url);
  let out = '';
  try {
    out = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr) : '';
    throw new Error(`网络请求失败（curl ${error.status ?? '?'}）：${stderr.trim().slice(0, 200)}`);
  }
  const split = out.lastIndexOf('\n');
  const body = out.slice(0, split).trim();
  const status = Number(out.slice(split + 1).trim());
  let json = {};
  try {
    json = body === '' ? {} : JSON.parse(body);
  } catch {
    throw new Error(`响应不是 JSON（HTTP ${status}）：${body.slice(0, 200)}`);
  }
  return { status, body: json };
}

async function accessToken(clientId, clientSecret, refreshToken) {
  const res = await http('https://oauth2.googleapis.com/token', {
    method: 'POST',
    form: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  // OAuth 的 HTTP 状态是 4xx；这里只判断字段
  if (!res.body.access_token) {
    throw new Error(`OAuth 换取 access_token 失败：${JSON.stringify(Object.keys(res.body))} ${res.body.error ?? ''}`.trim());
  }
  return res.body.access_token;
}

async function uploadZip(token, zip, extensionId) {
  const isNew = !extensionId;
  const url = isNew
    ? 'https://www.googleapis.com/upload/chromewebstore/v1.1/items'
    : `https://www.googleapis.com/upload/chromewebstore/v1.1/items/${extensionId}`;
  // 包体走临时文件：命令行传 380KB 二进制不安全，curl -T 直接读文件最稳
  const tmp = resolve(root, 'release', '.upload.tmp.zip');
  writeFileSync(tmp, zip);
  try {
    const args = ['-s', '-X', isNew ? 'POST' : 'PUT'];
    const proxy = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;
    if (proxy) args.push('-x', proxy);
    args.push('-H', `Authorization: Bearer ${token}`, '-H', 'x-goog-api-version: 2', '-T', tmp, '-w', '\n%{http_code}', url);
    const out = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    const split = out.lastIndexOf('\n');
    const body = out.slice(0, split).trim();
    return JSON.parse(body || '{}'); // { id, uploadState, itemError? }
  } catch (error) {
    throw new Error(`上传失败（HTTP ${error.status ?? '?'}）：${String(error.stderr ?? '').slice(0, 200)}`);
  } finally {
    rmSync(tmp, { force: true });
  }
}

async function publish(token, extensionId, target) {
  const url = `https://www.googleapis.com/chromewebstore/v1.1/items/${extensionId}/publish?publishTarget=${encodeURIComponent(target)}`;
  const res = await http(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'x-goog-api-version': '2' },
    // 必须带一个空 body：没有 Content-Length 的 POST 会被 Google 前端直接回 411 Length Required
    // （curl 只有加了 --data-binary '' 才会补上 Content-Length: 0）。
    form: '',
  });
  return res.body; // { status: [...], statusDetail: [...] }
}

async function main() {
  loadDotEnv();
  const draftOnly = process.argv.includes('--draft');
  const clientId = required('CWS_CLIENT_ID');
  const clientSecret = required('CWS_CLIENT_SECRET');
  const refreshToken = required('CWS_REFRESH_TOKEN');
  const extensionId = process.env.CWS_EXTENSION_ID?.trim() || '';
  const target = process.env.CWS_PUBLISH_TARGET?.trim() || 'default';

  const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
  const zipPath = resolve(root, 'release', `loupe-${version}.zip`);
  if (!existsSync(zipPath)) {
    console.error(`[publish] 找不到 ${zipPath}；先运行 npm run package。`);
    process.exit(1);
  }
  const zip = readFileSync(zipPath);

  console.log(`[publish] 包 release/loupe-${version}.zip (${zip.length} bytes)`);
  const token = await accessToken(clientId, clientSecret, refreshToken);

  const uploaded = await uploadZip(token, zip, extensionId);
  const id = uploaded.id ?? extensionId;
  console.log(`[publish] 上传完成 id=${id} uploadState=${uploaded.uploadState}`);
  if (uploaded.itemError?.length) console.log('[publish] itemError:', JSON.stringify(uploaded.itemError));
  if (!extensionId) {
    console.log(`[publish] 这是新建条目。请把 id 写进 .env 的 CWS_EXTENSION_ID 以便后续更新：${id}`);
  }
  if (uploaded.uploadState === 'FAILURE') process.exit(1);

  if (draftOnly) {
    console.log('[publish] --draft：仅上传为草稿，未发布。到开发者后台补齐素材/隐私政策后再发布。');
    return;
  }
  const result = await publish(token, id, target);
  console.log(`[publish] 发布请求已提交 target=${target} status=${JSON.stringify(result.status)}`);
  if (result.statusDetail?.length) console.log('[publish] 说明:', JSON.stringify(result.statusDetail));
}

main().catch((error) => {
  console.error('[publish]', error.message);
  process.exit(1);
});
