import { describe, expect, it } from 'vitest';
import { createAiService } from '../../src/ai/index';
import { AI_SETTINGS_KEY } from '../../src/ai/settings';
import { isAbort } from '../../src/core/errors';
import type { AiService, AiSettings } from '../../src/ai/types';
import { comment, completeResponse, createFakeCache, createFetchStub, createMemoryStorage, sseDelta, sseResponse, subjectResult, testSettings, threadResult } from './fakes';

const KEY = 'sk-secret-key';
const signal = new AbortController().signal;
const tree = threadResult(comment({ id: 'c0', text: '根评论' }), [comment({ id: 'c1', rootId: 'c0', parentId: 'c0', text: '回复' })]);
const subject = subjectResult([comment({ id: 'c0', likes: 3, text: '内容' })], { topComments: [comment({ id: 'c0' })] });

function serviceWith(fetchImpl: typeof fetch, overrides: Partial<AiSettings> = {}): AiService {
  const storage = createMemoryStorage();
  storage.data.set(AI_SETTINGS_KEY, testSettings(overrides));
  return createAiService({ cache: createFakeCache(), storage, fetch: fetchImpl });
}

describe('前置校验', () => {
  it('未启用时两个入口都抛出明确错误', async () => {
    const service = serviceWith(createFetchStub(() => completeResponse('x')).fetch, { enabled: false });
    await expect(service.summarizeSubject(subject, () => {}, signal)).rejects.toThrow('AI 未启用');
    await expect(service.diagnoseThread(tree, signal)).rejects.toThrow('AI 未启用');
  });

  it('缺少密钥时抛出明确错误', async () => {
    const service = serviceWith(createFetchStub(() => completeResponse('x')).fetch, { apiKey: '' });
    await expect(service.summarizeSubject(subject, () => {}, signal)).rejects.toThrow('未配置 API Key');
    await expect(service.diagnoseThread(tree, signal)).rejects.toThrow('未配置 API Key');
  });
});

describe('summarizeSubject', () => {
  const chunks = ['## 整体情绪\n整体正面，例如参考 #', '0 的说法。\n## 主要话题\n价格'];

  it('流式回调增量文本，并把 #序号 改写成 [[c:id]]', async () => {
    const stub = createFetchStub(() => sseResponse([...chunks.map((chunk) => `data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`), 'data: [DONE]\n\n']));
    const service = serviceWith(stub.fetch);
    const deltas: string[] = [];
    const insight = await service.summarizeSubject(subject, (chunk) => deltas.push(chunk), signal);

    expect(insight.cached).toBe(false);
    expect(insight.model).toBe('test-model');
    expect(insight.markdown).toContain('[[c:c0]]');
    expect(insight.markdown).not.toContain('#0 的说法');
    expect(deltas.join('')).toBe(insight.markdown);
    expect(stub.bodyOf(0).stream).toBe(true);
    expect(stub.headersOf(0).Authorization).toBe(`Bearer ${KEY}`);
  });

  it('同一输入命中缓存：零请求、一次性回调完整文本', async () => {
    const cache = createFakeCache();
    const storage = createMemoryStorage();
    storage.data.set(AI_SETTINGS_KEY, testSettings());
    const warm = createAiService({ cache, storage, fetch: createFetchStub(() => sseResponse([sseDelta('结论 #0'), 'data: [DONE]\n\n'])).fetch });
    const first = await warm.summarizeSubject(subject, () => {}, signal);

    const cold = createFetchStub(() => {
      throw new Error('不应发请求');
    });
    const cached = createAiService({ cache, storage, fetch: cold.fetch });
    const deltas: string[] = [];
    const second = await cached.summarizeSubject(subject, (chunk) => deltas.push(chunk), signal);

    expect(cold.calls).toHaveLength(0);
    expect(second.cached).toBe(true);
    expect(second.markdown).toBe(first.markdown);
    expect(deltas).toEqual([first.markdown]);
  });

  it('缓存键不含密钥：换密钥仍命中', async () => {
    const cache = createFakeCache();
    const storageA = createMemoryStorage();
    storageA.data.set(AI_SETTINGS_KEY, testSettings({ apiKey: 'sk-first' }));
    await createAiService({ cache, storage: storageA, fetch: createFetchStub(() => sseResponse([sseDelta('ok'), 'data: [DONE]\n\n'])).fetch }).summarizeSubject(subject, () => {}, signal);

    const storageB = createMemoryStorage();
    storageB.data.set(AI_SETTINGS_KEY, testSettings({ apiKey: 'sk-second' }));
    const throwing = createFetchStub(() => {
      throw new Error('不应发请求');
    });
    const insight = await createAiService({ cache, storage: storageB, fetch: throwing.fetch }).summarizeSubject(subject, () => {}, signal);
    expect(throwing.calls).toHaveLength(0);
    expect(insight.cached).toBe(true);
  });

  it('模型没返回任何内容时抛错', async () => {
    const stub = createFetchStub(() => sseResponse(['data: [DONE]\n\n']));
    await expect(serviceWith(stub.fetch).summarizeSubject(subject, () => {}, signal)).rejects.toThrow('AI 未返回内容');
  });

  it('流被截断（无 [DONE]）时抛错且不写缓存', async () => {
    const cache = createFakeCache();
    const storage = createMemoryStorage();
    storage.data.set(AI_SETTINGS_KEY, testSettings());
    const stub = createFetchStub(() => sseResponse([sseDelta('半截结论')]));
    const service = createAiService({ cache, storage, fetch: stub.fetch });
    await expect(service.summarizeSubject(subject, () => {}, signal)).rejects.toThrow('不完整');
    expect(cache.entries.size).toBe(0);
  });

  it('取消时不落缓存，也不把半截结果当成功', async () => {
    const cache = createFakeCache();
    const storage = createMemoryStorage();
    storage.data.set(AI_SETTINGS_KEY, testSettings());
    const controller = new AbortController();
    const stub = createFetchStub((_url, init) => {
      const abortSignal = init.signal as AbortSignal;
      const body = new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(new TextEncoder().encode(sseDelta('半截结论')));
          abortSignal.addEventListener('abort', () => stream.error(new DOMException('aborted', 'AbortError')));
        },
      });
      return new Response(body, { status: 200 });
    });
    const service = createAiService({ cache, storage, fetch: stub.fetch });
    const seen: string[] = [];
    const pending = service.summarizeSubject(
      subject,
      (chunk) => {
        seen.push(chunk);
        controller.abort();
      },
      controller.signal,
    );
    let caught: unknown;
    try {
      await pending;
    } catch (error) {
      caught = error;
    }
    expect(isAbort(caught)).toBe(true);
    expect(seen.join('')).toContain('半截结论');
    expect(cache.entries.size).toBe(0);
  });

  it('端点 / 模型 / extraBody 变化时不复用旧结果', async () => {
    const cache = createFakeCache();
    const storage = createMemoryStorage();
    storage.data.set(AI_SETTINGS_KEY, testSettings());
    await createAiService({ cache, storage, fetch: createFetchStub(() => sseResponse([sseDelta('旧'), 'data: [DONE]\n\n'])).fetch }).summarizeSubject(subject, () => {}, signal);

    for (const override of [{ baseUrl: 'https://other.example/v1' }, { model: 'other-model' }, { extraBody: { thinking: { type: 'disabled' } } }]) {
      storage.data.set(AI_SETTINGS_KEY, testSettings(override));
      const stub = createFetchStub(() => sseResponse([sseDelta('新'), 'data: [DONE]\n\n']));
      const insight = await createAiService({ cache, storage, fetch: stub.fetch }).summarizeSubject(subject, () => {}, signal);
      expect(stub.calls).toHaveLength(1);
      expect(insight.cached).toBe(false);
      expect(insight.markdown).toContain('新');
    }
  });

  it('extraBody 字段顺序不同仍命中（键稳定）', async () => {
    const cache = createFakeCache();
    const storage = createMemoryStorage();
    storage.data.set(AI_SETTINGS_KEY, testSettings({ extraBody: { a: 1, b: 2 } }));
    await createAiService({ cache, storage, fetch: createFetchStub(() => sseResponse([sseDelta('结论'), 'data: [DONE]\n\n'])).fetch }).summarizeSubject(subject, () => {}, signal);

    storage.data.set(AI_SETTINGS_KEY, testSettings({ extraBody: { b: 2, a: 1 } }));
    const throwing = createFetchStub(() => {
      throw new Error('不应发请求');
    });
    const insight = await createAiService({ cache, storage, fetch: throwing.fetch }).summarizeSubject(subject, () => {}, signal);
    expect(throwing.calls).toHaveLength(0);
    expect(insight.cached).toBe(true);
  });
});

describe('diagnoseThread', () => {
  const payload = {
    summary: '两派争论',
    stances: [
      { label: '支持', summary: '值得做' },
      { label: '反对', summary: '成本高' },
    ],
    stanceOf: { 0: 0, 1: 5, 9: 1 },
    fallacies: [{ idx: 1, type: '稻草人', note: '曲解' }],
    turningPoints: [1, 9],
    consensus: null,
  };

  it('非流式 JSON 请求，校验并映射为真实评论 id', async () => {
    const stub = createFetchStub(() => completeResponse(JSON.stringify(payload)));
    const diagnosis = await serviceWith(stub.fetch).diagnoseThread(tree, signal);
    expect(diagnosis.cached).toBe(false);
    expect(diagnosis.summary).toBe('两派争论');
    // 5 越界、9 未知序号：丢弃，不夹紧。
    expect(diagnosis.stanceOf).toEqual({ c0: 0 });
    expect(diagnosis.fallacies).toEqual([{ commentId: 'c1', type: '稻草人', note: '曲解' }]);
    expect(diagnosis.turningPoints).toEqual(['c1']);
    expect(stub.bodyOf(0).stream).toBe(false);
    expect(stub.bodyOf(0).response_format).toEqual({ type: 'json_object' });
  });

  it('命中缓存后不再请求', async () => {
    const cache = createFakeCache();
    const storage = createMemoryStorage();
    storage.data.set(AI_SETTINGS_KEY, testSettings());
    await createAiService({ cache, storage, fetch: createFetchStub(() => completeResponse(JSON.stringify(payload))).fetch }).diagnoseThread(tree, signal);

    const throwing = createFetchStub(() => {
      throw new Error('不应发请求');
    });
    const cached = await createAiService({ cache, storage, fetch: throwing.fetch }).diagnoseThread(tree, signal);
    expect(throwing.calls).toHaveLength(0);
    expect(cached.cached).toBe(true);
    expect(cached.stanceOf).toEqual({ c0: 0 });
  });

  it('诊断 JSON 结构损坏时抛出可读错误且不写缓存', async () => {
    const cache = createFakeCache();
    const storage = createMemoryStorage();
    storage.data.set(AI_SETTINGS_KEY, testSettings());
    const stub = createFetchStub(() => completeResponse('{"stances":[]}'));
    const service = createAiService({ cache, storage, fetch: stub.fetch });
    await expect(service.diagnoseThread(tree, signal)).rejects.toThrow('summary');
    expect(cache.entries.size).toBe(0);
  });
});

describe('checkConnection', () => {
  it('成功时返回延迟，请求是最小的 ping', async () => {
    const stub = createFetchStub(() => completeResponse('p'));
    const check = await serviceWith(stub.fetch).checkConnection(testSettings(), signal);
    expect(check.ok).toBe(true);
    expect(check.latencyMs).toBeGreaterThanOrEqual(0);
    expect(stub.bodyOf(0).max_tokens).toBe(1);
    expect(stub.bodyOf(0).stream).toBe(false);
    expect(stub.bodyOf(0).messages).toEqual([{ role: 'user', content: 'ping' }]);
  });

  it('失败时返回脱敏原因', async () => {
    const stub = createFetchStub(() => new Response(`unauthorized ${KEY}`, { status: 401 }));
    const check = await serviceWith(stub.fetch).checkConnection(testSettings(), signal);
    expect(check.ok).toBe(false);
    expect(check.error).toContain('密钥无效');
    expect(check.error).not.toContain(KEY);
  });

  it('未配置密钥时不发请求', async () => {
    const stub = createFetchStub(() => completeResponse('p'));
    const check = await serviceWith(stub.fetch).checkConnection(testSettings({ apiKey: '' }), signal);
    expect(check).toEqual({ ok: false, latencyMs: 0, error: '未配置 API Key' });
    expect(stub.calls).toHaveLength(0);
  });
});
