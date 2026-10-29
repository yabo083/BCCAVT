/**
 * 阅读器的读取传输层（跑在扩展页 iframe 里）：读 GET 经桥交给内容脚本在 B 站页面上下文执行。
 *
 * 为什么：iframe 是 chrome-extension 源，对 api.bilibili.com 属于跨站请求，带不上站点 Cookie——
 * 平台于是按匿名身份给小票，顶层评论翻到 `is_end` 就停（约 315 条），与原生评论区能读到的全量差得很远；
 * 页面上下文是同站，Cookie 由浏览器自动带上，读到的就是原生那份。WBI 签名仍在这里算好（密钥由同一份
 * 传输层取回），桥上只走最终 URL。
 *
 * 红线：请求只有 URL 与可选请求头，结果只有解析后的 JSON 或错误的类别与文案；Cookie 由浏览器在页面
 * 上下文带上，两个方向都不跨桥，本模块也绝不把 URL、请求头、响应体写进日志。
 *
 * 匿名回退：桥不可用（不在嵌入页里 / 内容脚本没回话 / 投递失败）时退回直连传输层——语义与改造前一致
 * （扩展源、匿名、可能被截断），绝不硬失败。只把「投递不出去 / 没有回话」算作桥不可用：内容脚本照实回投的
 * 网络错误仍交给上游按退避重试（那是真网络问题，回退只会把一次抖动放大成整段匿名读取）。
 * 只读走桥；写仍然只发意图（见 reader-comments.ts 的 createWriteClient），本文档里没有直接写请求的用途。
 */
import { PlatformError } from '@/core/errors';
import type { HttpClient, HttpRequest } from '@/core/platform';
import {
  READER_BRIDGE_SOURCE,
  READER_FETCH_REQUEST,
  type ReaderFetchRequest,
  type ReaderFetchResult,
} from '@/extension/page-comments';

/** iframe 的父文档源（B 站页面）：出站 postMessage 的 targetOrigin 与入站校验共用同一个值。 */
export const PARENT_ORIGIN = location.ancestorOrigins?.[0] ?? '*';

/** 读请求超时：内容脚本没回话（槽位已撤 / 扩展上下文失效）时兜底，绝不悬挂。 */
export const READER_FETCH_TIMEOUT_MS = 15_000;

/** 桥上一次读的结局：拿到 JSON、拿到一个可重建的错误，或桥本身不可用（该降级回直连了）。 */
type BridgeOutcome =
  | { status: 'json'; json: unknown }
  | { status: 'failed'; error: PlatformError }
  | { status: 'unavailable'; error: Error };

/** 未决读请求：结局只交付一次，交付时摘掉自己（摘掉之后定时器与取消监听都已清理）。 */
interface PendingRead {
  settle: (outcome: BridgeOutcome) => void;
}

export interface ReaderHttp extends HttpClient {
  /** 收到内容脚本的读结果：按 requestId 配对；不是自己发的请求一律丢弃（页面脚本可以伪造消息）。 */
  settle(result: ReaderFetchResult): void;
  /** 撤销全部未决请求（换目标 / 卸载）：以取消收场，绝不因此回退成直连再发一次。 */
  dropAll(reason: string): void;
}

export function createReaderHttp(options: {
  /** 桥不可用时的直连传输层（扩展源、匿名）。 */
  fallback: HttpClient;
  timeoutMs?: number;
  newId?: () => string;
  /** 投递方式（默认投给父文档）；测试可换成直接抓请求。 */
  post?: (request: ReaderFetchRequest) => void;
}): ReaderHttp {
  const { fallback } = options;
  const timeoutMs = options.timeoutMs ?? READER_FETCH_TIMEOUT_MS;
  const post = options.post ?? ((request: ReaderFetchRequest): void => window.parent.postMessage(request, PARENT_ORIGIN));
  let seq = 0;
  const newId = options.newId ?? ((): string => `r${(seq += 1).toString(36)}${Date.now().toString(36)}`);
  const pending = new Map<string, PendingRead>();
  /** 桥被判定不可用之后就不再尝试：继续投递只会让每次读都白白等一个超时。 */
  let bridgeDown = false;

  /** 把桥的结果变成结局：成功给 JSON，失败重建成同种 PlatformError（类别决定上游能否退避重试）。 */
  function outcomeOf(result: ReaderFetchResult): BridgeOutcome {
    if (result.ok) return { status: 'json', json: result.json };
    const error = new PlatformError(result.kind, result.error, result.code === undefined ? {} : { code: result.code });
    return { status: 'failed', error };
  }

  /**
   * 桥上一次读：投递 → 等结果（带超时与取消）。绝不拒绝：超时 / 投递失败 / 取消都是结局的一种，
   * 调用方按结局决定抛错还是降级。
   */
  function readOverBridge(request: HttpRequest, signal: AbortSignal): Promise<BridgeOutcome> {
    const message: ReaderFetchRequest = {
      source: READER_BRIDGE_SOURCE,
      type: READER_FETCH_REQUEST,
      requestId: newId(),
      url: request.url,
    };
    if (request.headers !== undefined) message.headers = request.headers;

    return new Promise<BridgeOutcome>((resolve) => {
      let timer: number | undefined;
      function settle(outcome: BridgeOutcome): void {
        // 结局只交付一次：交付即摘除，后续（结果 / 超时 / 取消先到者之外）的调用都成了空操作
        if (pending.get(message.requestId)?.settle !== settle) return;
        pending.delete(message.requestId);
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        resolve(outcome);
      }
      function onAbort(): void {
        settle({ status: 'failed', error: new PlatformError('aborted', '请求已取消') });
      }

      pending.set(message.requestId, { settle });
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      timer = window.setTimeout(() => settle({ status: 'unavailable', error: new Error('读桥没有回话') }), timeoutMs);
      try {
        post(message);
      } catch (error) {
        settle({ status: 'unavailable', error: error instanceof Error ? error : new Error('读请求投递失败') });
      }
    });
  }

  return {
    async getJson<T>(request: HttpRequest, signal: AbortSignal): Promise<T> {
      // 不在嵌入页里（本文档没有内容脚本当桥）或桥已判定不可用：直接走直连，连投递都不必
      if (bridgeDown || window.parent === window) return fallback.getJson<T>(request, signal);
      const outcome = await readOverBridge(request, signal);
      if (outcome.status === 'json') return outcome.json as T;
      if (outcome.status === 'failed') throw outcome.error;
      bridgeDown = true;
      console.warn('[Loupe] 读取评论的页面桥不可用，已退回扩展源直连（匿名，顶层评论可能被平台截断）', outcome.error);
      return fallback.getJson<T>(request, signal);
    },

    /** 写不在本文档里发生：写意图经 createWriteClient 交给内容脚本，由它在页面上下文带 csrf 发。 */
    postForm(): Promise<unknown> {
      return Promise.reject(new PlatformError('protocol', '阅读器不直接发写请求：写意图必须经桥交给内容脚本'));
    },

    settle(result) {
      const entry = pending.get(result.requestId);
      if (entry === undefined) return;
      entry.settle(outcomeOf(result));
    },

    dropAll(reason) {
      for (const entry of [...pending.values()]) {
        entry.settle({ status: 'failed', error: new PlatformError('aborted', reason) });
      }
    },
  };
}
