/** 图表共用的比例换算：非零值保留最小可见高度，全零时全平。 */
export function scaleBars(values: readonly number[]): number[] {
  const max = values.reduce((acc, value) => (value > acc ? value : acc), 0);
  if (max <= 0) return values.map(() => 0);
  return values.map((value) => (value <= 0 ? 0 : Math.max(0.04, value / max)));
}
