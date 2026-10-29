/**
 * 游标分页状态机：页面替换阅读器的无限滚动只靠它维持「取到哪了」。
 *
 * 为什么是游标而不是「上限递增」：旧写法每次加载更多就把抓取上限加一页、从游标起点重跑整条链并整体替换结果，
 * 于是同一页被反复读（重复加载）、已渲染内容被整体替换（内容变矮 → 宿主文档变矮 → 浏览器把 scrollTop 钳回 = 回弹）。
 * 这里把「取下一页」做成只追加的状态推进：持有平台给的游标、单一在途、失败保留游标可重试。
 *
 * 「到底」只认平台给的下一个游标：`next === null`。不按「请求 N 条拿到更少」推断——那个判据分不清
 * 「平台说到头」与「被上限 / 登录态截断」，而且一旦成立会被永久记住。
 *
 * 本模块不碰 DOM、不碰网络，状态变化通过订阅通知；UI 侧自行映射成响应式。
 */

/** 一页数据：items 与平台给出的下一页游标（null = 平台说没有下一页）。 */
export interface CursorPage<T> {
  items: readonly T[];
  next: string | null;
}

/** 取一页；cursor 为 null 表示第一页。失败时抛错（游标由状态机保留，重试从同一页继续）。 */
export type FetchPage<T> = (cursor: string | null) => Promise<CursorPage<T>>;

/** 状态机对外可见的全部状态。 */
export interface CursorPagerState<T> {
  /** 已取回的条目：只增不减（同 id 后到者覆盖原位），取数永远不会让列表变短。 */
  items: readonly T[];
  /** 下一页游标；null = 还没取过任何一页（首屏也从 null 开始）。 */
  cursor: string | null;
  /** 平台是否还说有下一页；首次取数之前为 true（还不知道，先当有）。 */
  hasNext: boolean;
  /** 有且只有一次取数在途。 */
  loading: boolean;
  /** 上一次取数失败的文案，重试之前一直保留。 */
  error: string | null;
  /** 非正常到底的原因（游标环 / 连续无新根），自然到底或仍在分页时为 null。 */
  endReason: string | null;
}

export interface CursorPagerOptions<T> {
  fetchPage: FetchPage<T>;
  /**
   * 中断（用户取消 / 阅读器卸载）不是失败：判定为真时既不记 error，也不动游标。
   * 与「取下一页真的失败」分开，界面才不会在用户主动取消后弹一条错误。
   */
  isCanceled?: (error: unknown) => boolean;
  /**
   * 游标成环判终：平台重复返回同一个 next 时把这次翻页当到底（hasNext=false），
   * 并给出这条 reason 让上层并入「不完整」文案。只防「同一页永远重取」的环，
   * 不防「每页都换一批新根」的正常分页。
   */
  cycleEndReason?: string;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error !== '') return error;
  return '取下一页失败';
}

export class CursorPager<T extends { id: string }> {
  private readonly fetchPage: FetchPage<T>;
  private readonly isCanceled: (error: unknown) => boolean;
  private readonly cycleEndReason: string | undefined;
  private readonly listeners = new Set<() => void>();
  /** id → 在 items 里的下标。只有 reset 会清空（restart 保留 items，下标依然有效）。 */
  private readonly indexById = new Map<string, number>();

  private items: T[] = [];
  private cursor: string | null = null;
  private hasNext = true;
  private loading = false;
  private error: string | null = null;
  private pages = 0;
  private inFlight: Promise<void> | null = null;
  /** 换目标 / 重放会让在途请求作废：结果回来时代号对不上就丢弃，绝不写进新状态。 */
  private generation = 0;
  /** 本游标会话见过的所有 next：平台回同一个游标两次 = 翻页成环，按到底处理。 */
  private readonly seenCursors = new Set<string>();
  /** 连续拿到「零新增条目」的页数：连着两页一个都没加 → 平台口头上还有但实已到顶。 */
  private zeroAdds = 0;
  private endReason: string | null = null;

  constructor(options: CursorPagerOptions<T>) {
    this.fetchPage = options.fetchPage;
    this.isCanceled = options.isCanceled ?? (() => false);
    this.cycleEndReason = options.cycleEndReason;
  }

  state(): CursorPagerState<T> {
    return {
      items: [...this.items],
      cursor: this.cursor,
      hasNext: this.hasNext,
      loading: this.loading,
      error: this.error,
      endReason: this.endReason,
    };
  }

  /** 已成功取回的页数（reset / restart 后重新计数）；「刷新已加载的这部分」用它决定重放多少页。 */
  get pagesLoaded(): number {
    return this.pages;
  }

  /** 订阅状态变化；返回退订函数。 */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 取下一页。以下情况不发请求：没有下一页、已经在取（返回在途的那一次，同一次取数只跑一个）、
   * 取数之前已经有一个在同步阶段被接受了。返回的 promise 在这一次取数落定后 resolve。
   */
  next(): Promise<void> {
    if (this.inFlight !== null) return this.inFlight;
    if (!this.hasNext || this.loading) return Promise.resolve();
    const inFlight = this.run();
    this.inFlight = inFlight;
    return inFlight;
  }

  /** 清空：条目、游标链、错误全部回到初始态；在途请求的结果作废（换目标用）。 */
  reset(): void {
    this.generation++;
    this.items = [];
    this.indexById.clear();
    this.pages = 0;
    this.cursor = null;
    this.hasNext = true;
    this.loading = false;
    this.error = null;
    this.seenCursors.clear();
    this.zeroAdds = 0;
    this.endReason = null;
    this.inFlight = null;
    this.notify();
  }

  /**
   * 重放：游标链回到起点，但已取回的条目先留着——刷新时逐页覆盖（同 id 后到者优先），
   * 列表不会先塌成一条再长回来。条目只增不减的保证由调用方继续持有。
   */
  restart(): void {
    this.generation++;
    this.pages = 0;
    this.cursor = null;
    this.hasNext = true;
    this.loading = false;
    this.error = null;
    this.seenCursors.clear();
    this.zeroAdds = 0;
    this.endReason = null;
    this.inFlight = null;
    this.notify();
  }

  private async run(): Promise<void> {
    const generation = this.generation;
    this.loading = true;
    this.error = null;
    this.notify();
    try {
      const page = await this.fetchPage(this.cursor);
      if (generation !== this.generation) return;
      const before = this.items.length;
      this.commit(page.items);
      const added = this.items.length - before;
      // 游标环：平台又给了同一个 next —— 再取下去是同一页的无限重放。
      if (page.next !== null && this.seenCursors.has(page.next)) {
        this.cursor = page.next;
        this.hasNext = false;
        this.endReason = this.cycleEndReason ?? '平台返回了重复的翻页游标，分页到此为止';
      } else {
        this.cursor = page.next;
        if (page.next !== null) this.seenCursors.add(page.next);
        this.zeroAdds = added === 0 && page.next !== null ? this.zeroAdds + 1 : 0;
        if (page.next === null) {
          this.hasNext = false;
        } else if (this.zeroAdds >= 2) {
          // 连续两页一个新增条目都没有：平台嘴上说还有，实际已经到顶。
          this.hasNext = false;
          this.endReason = this.endReason ?? '翻页不再返回新评论，可能已到列表末尾';
        }
      }
      this.pages++;
    } catch (error) {
      if (generation !== this.generation) return;
      if (this.isCanceled(error)) return;
      // 失败只记账：游标与 hasNext 一律不动，重试就从这一页继续，绝不退回起点重放。
      this.error = errorMessage(error);
    } finally {
      if (generation === this.generation) {
        this.loading = false;
        this.inFlight = null;
        this.notify();
      }
    }
  }

  /** 收下一整页：新的 id 追加到末尾，已见过的 id 覆盖原位——列表长度单调不减，位置也不跳。 */
  private commit(incoming: readonly T[]): void {
    if (incoming.length === 0) return;
    const next = [...this.items];
    for (const item of incoming) {
      const index = this.indexById.get(item.id);
      if (index === undefined) {
        this.indexById.set(item.id, next.length);
        next.push(item);
        continue;
      }
      next[index] = item;
    }
    this.items = next;
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
