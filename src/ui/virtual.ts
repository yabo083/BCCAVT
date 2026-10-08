/** 定高虚拟列表的窗口计算。纯函数，便于单测覆盖边界。 */

export interface WindowInput {
  scrollTop: number;
  viewportHeight: number;
  itemHeight: number;
  count: number;
  /** 视口外额外渲染的行数，默认 4。 */
  overscan?: number;
}

export interface WindowRange {
  /** 首个渲染行下标。 */
  start: number;
  /** 结束行下标（不含）。 */
  end: number;
  /** 首行相对滚动容器的位移。 */
  offsetY: number;
  /** 滚动容器总高度。 */
  totalHeight: number;
}

export function computeWindow(input: WindowInput): WindowRange {
  const { itemHeight, count } = input;
  if (itemHeight <= 0 || count <= 0) return { start: 0, end: 0, offsetY: 0, totalHeight: 0 };

  const overscan = Math.max(0, input.overscan ?? 4);
  const totalHeight = count * itemHeight;
  const viewport = Math.max(0, input.viewportHeight);
  const scrollTop = Math.min(Math.max(0, input.scrollTop), Math.max(0, totalHeight - viewport));

  const first = Math.floor(scrollTop / itemHeight);
  const visible = viewport > 0 ? Math.ceil(viewport / itemHeight) : 1;
  const last = first + visible;

  const start = Math.max(0, first - overscan);
  const end = Math.min(count, Math.max(start + 1, last + overscan));
  return { start, end, offsetY: start * itemHeight, totalHeight };
}

/** 把列表滚动到指定下标（尽量居中）；用于「跳到某条评论」。 */
export function scrollTopForIndex(index: number, itemHeight: number, viewportHeight: number): number {
  const centered = index * itemHeight - Math.max(0, viewportHeight - itemHeight) / 2;
  return Math.max(0, centered);
}
