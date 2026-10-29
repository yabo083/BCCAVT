import type { PlatformId } from './model';

export type PlatformErrorKind =
  /** 需要登录才能继续（例如未登录时根评论列表被截断后继续翻页）。 */
  | 'auth-required'
  /** 风控 / 限流（HTTP 412/429、bilibili -352/-412 等），可退避重试。 */
  | 'rate-limited'
  /** 主体或评论不存在 / 已删除。 */
  | 'not-found'
  /** 评论区关闭、仅粉丝可见等，主体存在但评论不可读。 */
  | 'unavailable'
  /** 用户输入无法解析为任何目标。 */
  | 'invalid-input'
  /** 网络层失败（DNS、断网、超时），可重试。 */
  | 'network'
  /** 响应结构不符合预期（平台改版），不可重试，需要修适配器。 */
  | 'protocol'
  /** 调用方主动取消。 */
  | 'aborted';

/** 全部合法类别；用 Record 保证与上面的联合类型同步（少一个就编译不过）。 */
const ERROR_KINDS: Record<PlatformErrorKind, true> = {
  'auth-required': true,
  'rate-limited': true,
  'not-found': true,
  unavailable: true,
  'invalid-input': true,
  network: true,
  protocol: true,
  aborted: true,
};

/**
 * 运行期守卫：类别跨世界传输（读桥把失败类别回投给 iframe）后入站必须自证是已知类别，
 * 未知一律由调用方按自己的兜底处理，绝不拿字符串去当类别用。
 */
export function isPlatformErrorKind(value: unknown): value is PlatformErrorKind {
  return typeof value === 'string' && Object.hasOwn(ERROR_KINDS, value);
}

const RETRYABLE: Partial<Record<PlatformErrorKind, true>> = { 'rate-limited': true, network: true };

export class PlatformError extends Error {
  override readonly name = 'PlatformError';
  readonly kind: PlatformErrorKind;
  readonly platform?: PlatformId;
  /** 平台原始错误码（如 bilibili 的 code 字段或 HTTP 状态）。 */
  readonly code?: number;
  /** 平台给出的建议等待时长。 */
  readonly retryAfterMs?: number;

  constructor(
    kind: PlatformErrorKind,
    message: string,
    options: { platform?: PlatformId; code?: number; retryAfterMs?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.kind = kind;
    this.platform = options.platform;
    this.code = options.code;
    this.retryAfterMs = options.retryAfterMs;
  }

  get retryable(): boolean {
    return RETRYABLE[this.kind] === true;
  }
}

export function isAbort(error: unknown): boolean {
  return (
    (error instanceof PlatformError && error.kind === 'aborted') ||
    (error instanceof DOMException && error.name === 'AbortError')
  );
}
