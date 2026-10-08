/**
 * 原始 JSON 取值与校验。适配器边界：平台返回的一切字段先在这里验明，
 * 缺字段立即抛 PlatformError('protocol') 并指明字段路径，之后的代码可以信任类型。
 */
import { PlatformError } from '../../core/errors';

export type RawObject = Record<string, unknown>;

export function missingField(path: string): PlatformError {
  return new PlatformError('protocol', `Bilibili 响应缺少字段：${path}`, { platform: 'bilibili' });
}

export function asRecord(value: unknown, path: string): RawObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw missingField(path);
  return value as RawObject;
}

export function optionalRecord(value: unknown): RawObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as RawObject) : undefined;
}

/** 字符串字段；平台偶尔把数字 id 序列化成数字，一并接受。 */
export function strField(source: RawObject, name: string, path: string): string {
  const value = source[name];
  if (typeof value === 'string' && value !== '') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  throw missingField(`${path}.${name}`);
}

export function optStr(source: RawObject, name: string): string | undefined {
  const value = source[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export function numField(source: RawObject, name: string, path: string): number {
  const value = source[name];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value !== '' && Number.isFinite(Number(value))) return Number(value);
  throw missingField(`${path}.${name}`);
}

export function optNum(source: RawObject, name: string): number | undefined {
  const value = source[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** 数组字段；平台在“没有内容”时会省略或给 null，都按空数组处理，其余类型视为改版。 */
export function arrField(source: RawObject, name: string, path: string): unknown[] {
  const value = source[name];
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  throw missingField(`${path}.${name}`);
}

/** 可选的 id 字段（`*_str` 优先），缺失返回 undefined。 */
export function optId(source: RawObject, name: string): string | undefined {
  const asString = source[`${name}_str`];
  if (typeof asString === 'string' && asString !== '') return asString;
  const value = source[name];
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value !== '') return value;
  return undefined;
}

/**
 * 评论 / 用户 id：优先 `*_str`（可超 2^53 精度），回退数字字段。
 * 空串与缺失同等对待。
 */
export function idField(source: RawObject, name: string, path: string): string {
  const asString = source[`${name}_str`];
  if (typeof asString === 'string' && asString !== '') return asString;
  const value = source[name];
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value !== '') return value;
  throw missingField(`${path}.${name}`);
}
