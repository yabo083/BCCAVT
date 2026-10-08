import { describe, expect, it } from 'vitest';
import { formatBucketWidth, formatBytes, formatCount, formatDuration, formatRelative } from '@/ui/format';

describe('formatCount', () => {
  it('万/亿 分档并去掉多余小数', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(9999)).toBe('9999');
    expect(formatCount(10_000)).toBe('1万');
    expect(formatCount(12_345)).toBe('1.2万');
    expect(formatCount(123_456_789)).toBe('1.2亿');
  });

  it('非有限数显示占位符', () => {
    expect(formatCount(Number.NaN)).toBe('—');
  });
});

describe('formatBytes', () => {
  it('按 1024 进制并在小数值时保留一位小数', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
  });
});

describe('formatDuration', () => {
  it('毫秒/秒/分档', () => {
    expect(formatDuration(500)).toBe('500 毫秒');
    expect(formatDuration(1500)).toBe('1.5 秒');
    expect(formatDuration(90_000)).toBe('1 分 30 秒');
    expect(formatDuration(-1)).toBe('—');
  });
});

describe('formatRelative', () => {
  const now = 1_700_000_000_000;

  it('按时间差选择粒度', () => {
    expect(formatRelative(now - 30_000, now)).toBe('刚刚');
    expect(formatRelative(now - 5 * 60_000, now)).toBe('5 分钟前');
    expect(formatRelative(now - 3 * 3_600_000, now)).toBe('3 小时前');
    expect(formatRelative(now - 2 * 86_400_000, now)).toBe('2 天前');
  });

  it('超过 30 天回落到日期', () => {
    expect(formatRelative(now - 40 * 86_400_000, now)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('未来时间不产生负数描述', () => {
    expect(formatRelative(now + 60_000, now)).toBe('刚刚');
  });
});

describe('formatBucketWidth', () => {
  it('按桶宽选择单位', () => {
    expect(formatBucketWidth(86_400_000)).toBe('1 天/格');
    expect(formatBucketWidth(7_200_000)).toBe('2 小时/格');
    expect(formatBucketWidth(900_000)).toBe('15 分钟/格');
  });
});
