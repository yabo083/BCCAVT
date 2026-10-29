import { describe, expect, it, vi } from 'vitest';
import { CursorPager } from '@/ui/infinite-scroll';
import type { CursorPage } from '@/ui/infinite-scroll';

interface Item {
  id: string;
  text?: string;
}

/** 按游标依次吐页的假取数：记录每次请求的游标，页用光就抛错（用例写错时会立刻暴露）。 */
function pagedFetch(pages: Array<CursorPage<Item>>): { fetchPage: (cursor: string | null) => Promise<CursorPage<Item>>; cursors: Array<string | null> } {
  const cursors: Array<string | null> = [];
  const fetchPage = async (cursor: string | null): Promise<CursorPage<Item>> => {
    cursors.push(cursor);
    const page = pages.shift();
    if (page === undefined) throw new Error('用例没有准备这一页');
    return page;
  };
  return { fetchPage, cursors };
}

describe('CursorPager', () => {
  it('首屏用 null 游标取一页，游标与 hasNext 跟着平台走', async () => {
    const { fetchPage, cursors } = pagedFetch([{ items: [{ id: 'a' }], next: 'p1' }]);
    const pager = new CursorPager<Item>({ fetchPage });

    expect(pager.state()).toMatchObject({ items: [], cursor: null, hasNext: true, loading: false, error: null });
    await pager.next();

    expect(cursors).toEqual([null]);
    expect(pager.state()).toMatchObject({ items: [{ id: 'a' }], cursor: 'p1', hasNext: true, loading: false, error: null });
    expect(pager.pagesLoaded).toBe(1);
  });

  it('同一时刻只跑一次取数：并发调用共享同一次在途', async () => {
    let release!: (page: CursorPage<Item>) => void;
    const fetchPage = vi.fn(() => new Promise<CursorPage<Item>>((resolve) => {
      release = resolve;
    }));
    const pager = new CursorPager<Item>({ fetchPage });

    const first = pager.next();
    const second = pager.next();
    expect(second).toBe(first);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(pager.state().loading).toBe(true);

    release({ items: [{ id: 'a' }], next: null });
    await Promise.all([first, second]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(pager.state().items).toEqual([{ id: 'a' }]);
  });

  it('next === null 之后不再发请求（到底只认平台给的游标）', async () => {
    const { fetchPage, cursors } = pagedFetch([{ items: [{ id: 'a' }], next: null }]);
    const pager = new CursorPager<Item>({ fetchPage });

    await pager.next();
    await pager.next();
    await pager.next();

    expect(cursors).toEqual([null]);
    expect(pager.state()).toMatchObject({ hasNext: false, cursor: null, items: [{ id: 'a' }] });
  });

  it('失败保留游标：重试从同一页继续，不跳页也不退回起点', async () => {
    const calls: Array<string | null> = [];
    const pager = new CursorPager<Item>({
      fetchPage: async (cursor) => {
        calls.push(cursor);
        if (calls.length === 2) throw new Error('平台限流');
        return cursor === null ? { items: [{ id: 'a' }], next: 'p1' } : { items: [{ id: 'b' }], next: null };
      },
    });

    await pager.next();
    await pager.next();
    expect(pager.state()).toMatchObject({ error: '平台限流', cursor: 'p1', hasNext: true });
    expect(pager.state().items).toEqual([{ id: 'a' }]);

    await pager.next();
    expect(calls).toEqual([null, 'p1', 'p1']);
    expect(pager.state()).toMatchObject({ error: null, cursor: null, hasNext: false });
    expect(pager.state().items).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('同 id 只留一条：后到的覆盖原位，列表长度单调不减', async () => {
    const { fetchPage } = pagedFetch([
      { items: [{ id: 'a' }, { id: 'b', text: '旧' }], next: 'p1' },
      { items: [{ id: 'b', text: '新' }, { id: 'c' }], next: null },
    ]);
    const pager = new CursorPager<Item>({ fetchPage });

    await pager.next();
    await pager.next();

    expect(pager.state().items).toEqual([{ id: 'a' }, { id: 'b', text: '新' }, { id: 'c' }]);
  });

  it('reset 清空条目与游标链，在途结果作废', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pager = new CursorPager<Item>({
      fetchPage: async () => {
        await gate;
        return { items: [{ id: 'late' }], next: 'p9' };
      },
    });

    const pending = pager.next();
    pager.reset();
    release();
    await pending;

    expect(pager.state()).toMatchObject({ items: [], cursor: null, hasNext: true, loading: false, error: null });
    expect(pager.pagesLoaded).toBe(0);
  });

  it('restart 回到游标起点但保留已取条目（刷新重放时列表不塌）', async () => {
    const { fetchPage, cursors } = pagedFetch([
      { items: [{ id: 'a', text: '旧' }], next: 'p1' },
      { items: [{ id: 'b' }], next: null },
      { items: [{ id: 'a', text: '新' }], next: 'p1' },
      { items: [{ id: 'b' }], next: null },
    ]);
    const pager = new CursorPager<Item>({ fetchPage });

    await pager.next();
    await pager.next();
    expect(pager.pagesLoaded).toBe(2);

    pager.restart();
    expect(pager.state().items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(pager.pagesLoaded).toBe(0);

    await pager.next();
    expect(cursors).toEqual([null, 'p1', null]);
    expect(pager.state().items).toEqual([{ id: 'a', text: '新' }, { id: 'b' }]);
  });

  it('中断不记为失败：取消后没有 error，游标与 hasNext 都不动', async () => {
    const canceled = new Error('请求已取消');
    canceled.name = 'LoupeCanceled';
    const pager = new CursorPager<Item>({
      fetchPage: async () => {
        throw canceled;
      },
      isCanceled: (error) => error instanceof Error && error.name === 'LoupeCanceled',
    });

    await pager.next();

    expect(pager.state()).toMatchObject({ error: null, cursor: null, hasNext: true, loading: false });
  });

  it('状态变化通过订阅通知，退订后不再收到', async () => {
    const { fetchPage } = pagedFetch([{ items: [{ id: 'a' }], next: null }]);
    const pager = new CursorPager<Item>({ fetchPage });
    const listener = vi.fn();

    const unsubscribe = pager.subscribe(listener);
    await pager.next();
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2);

    unsubscribe();
    const before = listener.mock.calls.length;
    pager.reset();
    expect(listener.mock.calls.length).toBe(before);
  });
  it('游标环 + 零新增才算到底：同一 next 仍在出新条目时继续（原生会话内翻页）', async () => {
    const { fetchPage } = pagedFetch([
      { items: [{ id: 'a' }], next: 'loop' },
      { items: [{ id: 'b' }], next: 'loop' },   // next 重复但有新增 —— 合法，继续
      { items: [{ id: 'a' }], next: 'loop' },   // next 重复且零新增 —— 真环，判终
    ]);
    const pager = new CursorPager<Item>({ fetchPage, cycleEndReason: '平台重复返回了同一翻页位置，已停止继续加载' });

    await pager.next();
    await pager.next();
    expect(pager.state().hasNext).toBe(true); // 重复 next + 新增 ≠ 环
    await pager.next();

    expect(pager.state()).toMatchObject({ hasNext: false, loading: false, endReason: '平台重复返回了同一翻页位置，已停止继续加载' });
    expect(pager.state().items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('连续两页零新增即到底：不再发请求并给出 reason', async () => {
    const { fetchPage, cursors } = pagedFetch([
      { items: [{ id: 'a' }], next: 'c1' },
      { items: [{ id: 'a' }], next: 'c2' },
      { items: [{ id: 'a' }], next: 'c3' },
      { items: [{ id: 'x' }], next: 'c4' },
    ]);
    const pager = new CursorPager<Item>({ fetchPage });

    await pager.next();
    await pager.next();
    await pager.next();
    await pager.next();

    const s = pager.state();
    expect(s.hasNext).toBe(false);
    expect(s.endReason).toContain('翻页不再返回新评论');
    expect(cursors.length).toBe(3);
  });
});