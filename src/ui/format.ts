/** 展示用格式化。数字统一走 tabular-nums（见 styles/base.css 的 .tnum）。 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 / YYYY-MM-DD。 */
export function formatRelative(timestamp: number, now = Date.now()): string {
  const delta = now - timestamp;
  if (!Number.isFinite(timestamp)) return '未知';
  if (delta < MINUTE) return '刚刚';
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)} 分钟前`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)} 小时前`;
  if (delta < 30 * DAY) return `${Math.floor(delta / DAY)} 天前`;
  return formatDate(timestamp);
}

export function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatDateTime(timestamp: number): string {
  const d = new Date(timestamp);
  return `${formatDate(timestamp)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 紧凑计数：1234 → 1234，123456 → 12.3万，1.2e9 → 12亿。 */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const scaled =
    abs >= 100_000_000 ? { v: value / 100_000_000, unit: '亿' } : abs >= 10_000 ? { v: value / 10_000, unit: '万' } : null;
  if (!scaled) return String(value);
  return `${scaled.v.toFixed(1).replace(/\.0$/, '')}${scaled.unit}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} 毫秒`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} 秒`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} 分 ${Math.round(seconds - minutes * 60)} 秒`;
}

/** 时间轴桶宽的坐标标签。 */
export function formatBucketWidth(bucketMs: number): string {
  if (bucketMs % DAY === 0) return `${bucketMs / DAY} 天/格`;
  if (bucketMs % HOUR === 0) return `${bucketMs / HOUR} 小时/格`;
  return `${Math.round(bucketMs / MINUTE)} 分钟/格`;
}
