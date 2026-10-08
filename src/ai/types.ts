/**
 * AI 解读契约。只对接 OpenAI 兼容的 /chat/completions；凭据只存 chrome.storage.local，
 * 不进日志、不进缓存键、不进快照。结果按「提示词版本 + 模型 + 输入内容哈希」内容寻址缓存（不可变）。
 */
import type { AnalysisResult, SubjectReport, ThreadReport } from '../core/report';

export interface AiSettings {
  enabled: boolean;
  /** 例如 https://api.deepseek.com/v1（不含 /chat/completions）。 */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 合并进请求体的额外字段，例如 DeepSeek 关闭思考：{"thinking":{"type":"disabled"}}。 */
  extraBody: Record<string, unknown>;
  /** 喂给模型的评论摘录字符上限（控制成本）。 */
  maxInputChars: number;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: false,
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  extraBody: {},
  maxInputChars: 24_000,
};

/** 设置持久化接缝；扩展里由 chrome.storage.local 实现，测试里用内存实现。 */
export interface SettingsStorage {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
}

export interface ConnectionCheck {
  ok: boolean;
  latencyMs: number;
  /** 失败原因（已脱敏，不含密钥）。 */
  error?: string;
}

/** 评论区解读（流式 Markdown）。 */
export interface SubjectInsight {
  markdown: string;
  model: string;
  cached: boolean;
}

/** 立场：模型从评论树中归纳出的一个观点阵营。 */
export interface Stance {
  label: string;
  summary: string;
}

export interface FallacyNote {
  commentId: string;
  /** 例如「稻草人」「诉诸人身」「偷换概念」。 */
  type: string;
  note: string;
}

/** 评论树诊断（结构化 JSON，驱动树视图着色）。 */
export interface ThreadDiagnosis {
  summary: string;
  stances: Stance[];
  /** commentId → stances 下标；未归类的评论不出现。 */
  stanceOf: Record<string, number>;
  fallacies: FallacyNote[];
  /** 讨论走向发生转折的评论。 */
  turningPoints: string[];
  consensus: string | null;
  model: string;
  cached: boolean;
}

export interface AiService {
  loadSettings(): Promise<AiSettings>;
  saveSettings(settings: AiSettings): Promise<void>;
  checkConnection(settings: AiSettings, signal: AbortSignal): Promise<ConnectionCheck>;
  /** onDelta 收到增量文本；命中缓存时一次性回调完整文本。 */
  summarizeSubject(
    result: AnalysisResult<SubjectReport>,
    onDelta: (chunk: string) => void,
    signal: AbortSignal,
  ): Promise<SubjectInsight>;
  diagnoseThread(result: AnalysisResult<ThreadReport>, signal: AbortSignal): Promise<ThreadDiagnosis>;
}
