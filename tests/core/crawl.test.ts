import { describe, expect, it } from 'vitest';
import { PoliteQueue, abortError, withRetry, type SleepFn } from '@/core/crawl';
import { PlatformError } from '@/core/errors';

const signal = new AbortController().signal;
/** 只让出微任务，不依赖真实计时器。 */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function recordingSleep(waits: number[]): SleepFn {
  return async (ms) => {
    waits.push(ms);
  };
}

describe('PoliteQueue', () => {
  it('并发不超过 politeness.concurrency', async () => {
    const queue = new PoliteQueue({ concurrency: 2, minIntervalMs: 0 }, async () => {}, () => 0);
    let running = 0;
    let peak = 0;
    const gates: Array<() => void> = [];
    const task = async (): Promise<void> => {
      running++;
      peak = Math.max(peak, running);
      await new Promise<void>((resolve) => gates.push(resolve));
      running--;
    };

    const pending = [1, 2, 3, 4].map(() => queue.run(task, signal));
    await flush();
    expect(peak).toBe(2);
    expect(gates).toHaveLength(2);

    gates.splice(0).forEach((release) => release());
    await flush();
    expect(peak).toBe(2);
    expect(gates).toHaveLength(2);

    gates.splice(0).forEach((release) => release());
    await Promise.all(pending);
    expect(peak).toBe(2);
  });

  it('相邻请求预留最小间隔时隙，不依赖真实时间', async () => {
    const waits: number[] = [];
    const reported: number[] = [];
    let clock = 1_000;
    const queue = new PoliteQueue({ concurrency: 1, minIntervalMs: 100 }, recordingSleep(waits), () => clock);

    await queue.run(async () => {}, signal); // 首次直接放行
    await queue.run(async () => {}, signal, (ms) => reported.push(ms)); // 间隔未到 → 等待
    clock += 1_000; // 时间前进后不再等待
    await queue.run(async () => {}, signal, (ms) => reported.push(ms));

    expect(waits).toEqual([100]);
    expect(reported).toEqual([100]);
  });

  it('已取消的信号不再放行', async () => {
    const controller = new AbortController();
    controller.abort();
    const queue = new PoliteQueue({ concurrency: 1, minIntervalMs: 0 }, async () => {}, () => 0);
    await expect(queue.run(async () => 'never', controller.signal)).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('最小间隔等待期间不超发并发（名额先占后用）', async () => {
    const waits: number[] = [];
    const queue = new PoliteQueue({ concurrency: 2, minIntervalMs: 100 }, async (ms) => {
      waits.push(ms);
    }, () => 0);
    let running = 0;
    let peak = 0;
    const gates: Array<() => void> = [];
    const task = async (): Promise<void> => {
      running++;
      peak = Math.max(peak, running);
      await new Promise<void>((resolve) => gates.push(resolve));
      running--;
    };

    const pending = [1, 2, 3, 4].map(() => queue.run(task, signal));
    await flush();
    // 旧实现会在 sleep 期间保持 active 不变，四个请求全部越过闸门 → peak 4。
    expect(peak).toBe(2);
    expect(gates).toHaveLength(2);
    expect(waits).toEqual([100]);

    gates.splice(0).forEach((release) => release());
    await flush();
    expect(peak).toBe(2);
    expect(gates).toHaveLength(2);

    gates.splice(0).forEach((release) => release());
    await Promise.all(pending);
    expect(peak).toBe(2);
  });

  it('排队等待时被取消会立即摘除并以 aborted 拒绝', async () => {
    const queue = new PoliteQueue({ concurrency: 1, minIntervalMs: 0 }, async () => {}, () => 0);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = queue.run(async () => gate, signal);
    await flush();

    const controller = new AbortController();
    const queued = queue.run(async () => 'never', controller.signal);
    controller.abort();
    await expect(queued).rejects.toMatchObject({ kind: 'aborted' });

    release();
    await expect(running).resolves.toBeUndefined();
  });
});

describe('withRetry', () => {
  it('可重试错误按指数退避重试，成功即返回', async () => {
    const waits: number[] = [];
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts === 1) throw new PlatformError('rate-limited', '风控', { code: 412 });
        if (attempts === 2) throw new PlatformError('network', '断网');
        return 'ok';
      },
      { signal, sleep: recordingSleep(waits) },
      { baseMs: 100, random: () => 1 },
    );

    expect(result).toBe('ok');
    expect(attempts).toBe(3);
    expect(waits).toEqual([100, 200]);
  });

  it('retryAfterMs 优先于指数退避', async () => {
    const waits: number[] = [];
    let attempts = 0;
    await withRetry(
      async () => {
        attempts++;
        if (attempts === 1) throw new PlatformError('rate-limited', '风控', { code: 429, retryAfterMs: 5_000 });
        return attempts;
      },
      { signal, sleep: recordingSleep(waits) },
      { baseMs: 100 },
    );
    expect(waits).toEqual([5_000]);
  });

  it('不可重试错误立刻抛出', async () => {
    const error = new PlatformError('protocol', '响应结构不对');
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw error;
        },
        { signal, sleep: async () => {} },
      ),
    ).rejects.toBe(error);
    expect(attempts).toBe(1);
  });

  it('超过 maxRetries 后抛出最后一次错误', async () => {
    const error = new PlatformError('network', '断网');
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw error;
        },
        { signal, sleep: async () => {} },
        { maxRetries: 2, baseMs: 1, random: () => 0 },
      ),
    ).rejects.toBe(error);
    expect(attempts).toBe(3);
  });

  it('退避等待期间取消立刻以 aborted 结束', async () => {
    const controller = new AbortController();
    const error = await withRetry(
      async () => {
        throw new PlatformError('rate-limited', '风控');
      },
      {
        signal: controller.signal,
        sleep: async () => {
          controller.abort();
          throw abortError();
        },
      },
    ).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(PlatformError);
    expect((error as PlatformError).kind).toBe('aborted');
  });
});
