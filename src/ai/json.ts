/** 边界校验辅助：外部 JSON / 存储读回来的都是 unknown，shape 必须先收窄再使用。 */

/** 只接受纯对象（非 null、非数组）。 */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** 非空字符串（去空白），否则 undefined。 */
export function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
