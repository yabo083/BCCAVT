/**
 * 应用状态与动作。视图只读写这里的 state 和这几个动作；
 * 抓取一律走 workbench 门面，重活（快照/森林/报告）用 markRaw 挂上，避免深层响应式代理。
 */
import { markRaw, reactive } from 'vue';
import { PlatformError, isAbort } from '@/core/errors';
import type { PlatformErrorKind } from '@/core/errors';
import type { PlatformId, Session, SubjectRef } from '@/core/model';
import { DEFAULT_CRAWL_OPTIONS } from '@/core/report';
import type {
  AnalysisResult,
  CrawlOptions,
  CrawlProgress,
  RefreshMode,
  SnapshotSummary,
  SubjectReport,
  ThreadReport,
} from '@/core/report';
import type { SubjectInsight, ThreadDiagnosis } from '@/ai/types';
import { INTENT_KEY, LOCATE_COMMENT, isLocateCommentResponse } from '@/extension/messages';
import type { IntentSurface, LocateCommentRequest, OpenTargetIntent, UiIntent } from '@/extension/messages';
import { ai, ensureHeaderRules, workbench } from './services';
import { loadCrawlOptions, saveCrawlOptions } from './prefs';
import { surfaceOf } from './surface';

export type View = 'target' | 'subject' | 'explorer' | 'thread' | 'ai' | 'history';

export interface RunState {
  kind: 'subject' | 'thread';
  label: string;
  startedAt: number;
  progress: CrawlProgress;
}

export type NoticeTone = 'info' | 'error';

const ERROR_HINTS: Record<PlatformErrorKind, string> = {
  'auth-required': '在顶部点击「登录」后重试',
  'rate-limited': '被平台限流，稍后重试即可',
  'not-found': '确认链接有效，或该内容已被删除',
  unavailable: '评论可能已关闭或仅粉丝可见',
  'invalid-input': '请粘贴 Bilibili 视频链接、BV 号或评论链接',
  network: '检查网络或代理后重试',
  protocol: '平台返回结构异常，可能已改版，请反馈',
  aborted: '已取消',
};

export function describeError(error: unknown): string {
  if (error instanceof PlatformError) return `${error.message}；${ERROR_HINTS[error.kind]}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * 承载面（侧栏面板 / 整页工作台 / 图谱窗口）在模块加载时就定下来：文档的 `?view=` 不会中途变，
 * 而 init() 是异步的——晚一拍就已经把顶栏和视图切换渲染进图谱窗口了。
 */
const surface = surfaceOf(new URLSearchParams(location.search));

export const state = reactive({
  view: 'target' as View,
  /** 整页模式：CSS 走两栏布局。 */
  wide: surface === 'tab',
  /** 图谱窗口（页面评论行放大镜打开）：整窗只有力导向图，不渲染顶栏/输入/视图切换/详情栏。 */
  graphOnly: surface === 'graph',
  input: '',
  inputError: null as string | null,
  /** 当前活动标签页里的 Bilibili 链接。 */
  suggestion: null as string | null,
  session: null as Session | null,
  sessionError: null as string | null,
  run: null as RunState | null,
  runError: null as string | null,
  notice: null as { text: string; tone: NoticeTone } | null,
  subject: null as AnalysisResult<SubjectReport> | null,
  thread: null as AnalysisResult<ThreadReport> | null,
  selectedCommentId: null as string | null,
  history: [] as SnapshotSummary[],
  options: { ...DEFAULT_CRAWL_OPTIONS } as CrawlOptions,
  insight: null as SubjectInsight | null,
  diagnosis: null as ThreadDiagnosis | null,
  ai: { busy: null as 'insight' | 'diagnosis' | null, error: null as string | null },
});

let runController: AbortController | null = null;
let aiController: AbortController | null = null;

interface RunSpec<R> {
  kind: 'subject' | 'thread';
  label: string;
  run: (signal: AbortSignal, onProgress: (progress: CrawlProgress) => void) => Promise<R>;
  apply: (result: R) => void;
}

async function execute<R>(spec: RunSpec<R>): Promise<void> {
  if (runController) {
    state.notice = { text: '已有抓取在进行，先取消它再开始新的', tone: 'info' };
    return;
  }
  const controller = new AbortController();
  runController = controller;
  state.runError = null;
  state.notice = null;
  state.run = {
    kind: spec.kind,
    label: spec.label,
    startedAt: Date.now(),
    progress: { phase: 'session', fetched: 0, requests: 0, cacheHits: 0 },
  };
  try {
    const result = await spec.run(controller.signal, (progress) => {
      if (state.run) state.run.progress = progress;
    });
    spec.apply(result);
    void refreshHistory();
  } catch (error) {
    if (isAbort(error)) state.notice = { text: '已取消本次抓取', tone: 'info' };
    else state.runError = describeError(error);
  } finally {
    runController = null;
    state.run = null;
  }
}

export function cancelRun(): void {
  runController?.abort();
}

/** 解析输入框/链接；无法识别时事内联报错并返回 null。 */
export function resolveInput(raw: string) {
  const text = raw.trim();
  const resolved = text ? workbench.resolve(text) : null;
  if (!resolved) {
    state.inputError = text
      ? '无法识别：请粘贴 Bilibili 视频链接、BV 号或评论链接'
      : '先粘贴 Bilibili 视频链接、BV 号或评论链接';
    return null;
  }
  state.inputError = null;
  return resolved;
}

function crawlSubject(ref: SubjectRef, refresh: RefreshMode, apply: (result: AnalysisResult<SubjectReport>) => void) {
  return execute({
    kind: 'subject',
    label: `${ref.id} 评论区`,
    run: (signal, onProgress) => workbench.analyzeSubject(ref, { ...state.options, refresh }, onProgress, signal),
    apply,
  });
}

export function startSubject(raw?: string): Promise<void> {
  const text = (raw ?? state.input).trim();
  const resolved = resolveInput(text);
  if (!resolved) return Promise.resolve();
  state.input = text;
  return crawlSubject(resolved.target.subject, state.options.refresh, (result) => {
    state.subject = markRaw(result);
    state.thread = null;
    state.selectedCommentId = null;
    state.insight = null;
    state.diagnosis = null;
    state.view = 'subject';
  });
}

/** 刷新当前主体快照（子树级增量）。 */
export function refreshSubject(): Promise<void> {
  const ref = state.subject?.snapshot.subject.ref;
  if (!ref) return Promise.resolve();
  return crawlSubject(ref, 'incremental', (result) => {
    state.subject = markRaw(result);
    state.view = 'subject';
  });
}

export function startThread(commentId: string, ref?: SubjectRef): Promise<void> {
  const subjectRef =
    ref ??
    state.thread?.snapshot.subject.ref ??
    state.subject?.snapshot.subject.ref ??
    workbench.resolve(state.input.trim())?.target.subject ??
    null;
  if (!subjectRef) {
    state.inputError = '先输入视频链接，或从历史快照进入评论树';
    return Promise.resolve();
  }
  return execute({
    kind: 'thread',
    label: `评论树 ${commentId}`,
    run: (signal, onProgress) => workbench.analyzeThread(subjectRef, commentId, state.options, onProgress, signal),
    apply: (result) => {
      state.thread = markRaw(result);
      state.selectedCommentId = commentId;
      state.diagnosis = null;
      state.view = 'thread';
    },
  });
}

/** 打开一条评论：已在当前树里就直接定位，否则抓它所在的评论树。 */
export function openComment(commentId: string): void {
  if (state.thread?.forest.byId.has(commentId)) {
    state.selectedCommentId = commentId;
    state.view = 'thread';
    return;
  }
  void startThread(commentId);
}

/**
 * 把某条评论定位到它的 B 站视频页评论区（详情卡的「在评论区定位」）：请求交后台——
 * 由它按视频身份找到已打开的标签页并转发给内容脚本，没找到就记下待办再新开一个。
 *
 * 定位是尽力而为的跳转：成功不打扰用户，失败只写一条提示，工作台里已有的分析一概不动。
 */
export async function locateInReader(input: string, commentId: string): Promise<void> {
  const request: LocateCommentRequest = { type: LOCATE_COMMENT, input, commentId };
  let response: unknown;
  try {
    response = await chrome.runtime.sendMessage(request);
  } catch (error) {
    state.notice = { text: describeError(error), tone: 'error' };
    return;
  }
  if (!isLocateCommentResponse(response)) {
    state.notice = { text: '无法在评论区定位这条评论', tone: 'error' };
    return;
  }
  if (!response.ok) state.notice = { text: response.error, tone: 'error' };
}

export function updateOptions(patch: Partial<CrawlOptions>): void {
  state.options = { ...state.options, ...patch };
  void saveCrawlOptions(state.options);
}

export async function refreshHistory(): Promise<void> {
  state.history = await workbench.history();
}

export async function openSnapshot(id: string): Promise<void> {
  const { snapshot, forest, report, fromSnapshot } = await workbench.openSnapshot(id);
  if ('root' in report) {
    state.thread = markRaw({ snapshot, forest, report, fromSnapshot });
    state.selectedCommentId = report.focusId;
    state.view = 'thread';
  } else {
    state.subject = markRaw({ snapshot, forest, report, fromSnapshot });
    state.view = 'subject';
  }
}

export async function deleteSnapshot(id: string): Promise<void> {
  await workbench.deleteSnapshot(id);
  await refreshHistory();
}

export async function clearCache(): Promise<void> {
  await workbench.clearCache();
  await refreshHistory();
}

export async function loadSession(platform: PlatformId = 'bilibili'): Promise<void> {
  state.sessionError = null;
  try {
    state.session = markRaw(await workbench.session(platform));
  } catch (error) {
    state.sessionError = describeError(error);
  }
}

export function openLoginPage(): void {
  void chrome.tabs.create({ url: 'https://passport.bilibili.com/login' });
}


// ───────────────────────── AI ─────────────────────────

export async function generateInsight(): Promise<void> {
  const target = state.subject;
  if (!target || state.ai.busy) return;
  const controller = new AbortController();
  aiController = controller;
  state.ai.busy = 'insight';
  state.ai.error = null;
  state.insight = { markdown: '', model: '', cached: false };
  try {
    const insight = await ai.summarizeSubject(
      target,
      (chunk) => {
        if (state.insight) state.insight.markdown += chunk;
      },
      controller.signal,
    );
    state.insight = markRaw(insight);
  } catch (error) {
    state.insight = null;
    state.ai.error = isAbort(error) ? null : describeError(error);
  } finally {
    aiController = null;
    state.ai.busy = null;
  }
}

export async function diagnoseThread(): Promise<void> {
  const target = state.thread;
  if (!target || state.ai.busy) return;
  const controller = new AbortController();
  aiController = controller;
  state.ai.busy = 'diagnosis';
  state.ai.error = null;
  try {
    state.diagnosis = markRaw(await ai.diagnoseThread(target, controller.signal));
  } catch (error) {
    state.ai.error = isAbort(error) ? null : describeError(error);
  } finally {
    aiController = null;
    state.ai.busy = null;
  }
}

export function cancelAi(): void {
  aiController?.abort();
}

// ───────────────────────── 启动 ─────────────────────────

export function applyIntent(intent: UiIntent): void {
  state.input = intent.input;
  state.inputError = null;
  const resolved = resolveInput(intent.input);
  if (!resolved) return;
  if (intent.commentId) void startThread(intent.commentId, resolved.target.subject);
  else void startSubject(intent.input);
}

/** 已消费的意图 nonce：启动时读一次与 storage.onChanged 可能拿到同一条。 */
const consumedNonces = new Set<string>();

/** 本 UI 实例的投递面：侧栏与整页各只消费投给自己的意图，同一条意图不会被两边各跑一次。 */
let intentSurface: IntentSurface = 'full-tab';
/** 侧栏宿主窗口；拿不到时不做窗口过滤（宁可能多不能少）。 */
let intentWindowId: number | null = null;
/** 初始化期间到达的意图先排队，init() 结束后统一应用，不能静默丢掉。 */
const queuedIntents: OpenTargetIntent[] = [];
let intentsReady = false;

function isOpenTargetIntent(value: unknown): value is OpenTargetIntent {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.type === 'open-target' &&
    typeof candidate.input === 'string' &&
    candidate.input.trim().length > 0 &&
    typeof candidate.nonce === 'string' &&
    (candidate.surface === 'side-panel' || candidate.surface === 'full-tab') &&
    (candidate.commentId === undefined || typeof candidate.commentId === 'string') &&
    (candidate.windowId === undefined || typeof candidate.windowId === 'number')
  );
}

/** 意图是否投给本 UI 实例；不匹配时保留 storage 里的键，等目标表面启动后再消费。 */
function targetsThisSurface(intent: OpenTargetIntent): boolean {
  if (intent.surface !== intentSurface) return false;
  if (intentSurface !== 'side-panel' || intentWindowId === null || intent.windowId === undefined) return true;
  return intent.windowId === intentWindowId;
}

/** 消费一条意图（读自 storage.session，先删后应用，避免重放）。 */
export async function consumeIntent(value: unknown): Promise<void> {
  if (!isOpenTargetIntent(value) || consumedNonces.has(value.nonce) || !targetsThisSurface(value)) return;
  consumedNonces.add(value.nonce);
  if (!intentsReady) {
    // 初始化还没完成：先排队，storage 里的键也先留着，等 init 结束后统一应用（失败也不至于丢）
    queuedIntents.push(value);
    return;
  }
  await chrome.storage.session.remove(INTENT_KEY);
  applyIntent(value);
}

/** 初始化完成后统一应用排队中的意图，此刻才删除 storage 里的键。 */
async function flushQueuedIntents(): Promise<void> {
  const queued = queuedIntents.splice(0);
  if (queued.length === 0) return;
  await chrome.storage.session.remove(INTENT_KEY);
  for (const intent of queued) applyIntent(intent);
}

/** 启动时读取一次意图。 */
export async function readStoredIntent(): Promise<void> {
  const bag = await chrome.storage.session.get(INTENT_KEY);
  await consumeIntent(bag[INTENT_KEY]);
}

/** 后台写入意图的同一刻 UI 可能正在初始化，监听必须尽早挂上，避免事件先于 init 完成而丢失。 */
function watchIntentStorage(): void {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'session') return;
    const change = changes[INTENT_KEY];
    if (change !== undefined) void consumeIntent(change.newValue);
  });
}

/** 侧栏按窗口区分；拿不到窗口 id 时退化为「不做窗口过滤」。 */
async function resolveIntentWindowId(): Promise<void> {
  if (intentSurface !== 'side-panel') return;
  try {
    intentWindowId = (await chrome.windows.getCurrent()).id ?? null;
  } catch {
    intentWindowId = null;
  }
}

/** 整页工作台与图谱窗口共用的 ?input=…&comment=…：直接开跑，结果通常直接命中缓存。 */
async function applyInitialQuery(): Promise<boolean> {
  const params = new URLSearchParams(location.search);
  const input = params.get('input')?.trim();
  if (!input) return false;
  state.input = input;
  const comment = params.get('comment')?.trim();
  if (comment) await startThread(comment);
  else await startSubject(input);
  return true;
}

export async function init(): Promise<void> {
  const params = new URLSearchParams(location.search);
  // 图谱窗口由 URL 上的 input/comment 驱动，不参与意图分发：它不该抢走本该在侧栏/整页打开的分析。
  if (!state.graphOnly) {
    intentSurface = state.wide ? 'full-tab' : 'side-panel';
    watchIntentStorage();
    await resolveIntentWindowId();
  }
  // 先确保后台已装好 DNR 请求头改写规则，再发起任何网络请求
  await ensureHeaderRules();
  state.options = await loadCrawlOptions();
  void loadSession();
  void refreshHistory();
  void suggestFromActiveTab();
  if (!(await applyInitialQuery()) && !state.graphOnly) await readStoredIntent();
  intentsReady = true;
  await flushQueuedIntents();
  if (params.get('entry') === 'panel-gesture') {
    state.notice = { tone: 'info', text: '浏览器未授权这次侧栏打开操作，已在此标签页继续同一分析。侧栏仍可通过工具栏的 Loupe 图标打开。' };
  }
}

/** 活动标签页若是 Bilibili 目标就作为输入建议。 */
async function suggestFromActiveTab(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url;
    if (url && workbench.resolve(url)) state.suggestion = url;
  } catch {
    // 拿不到活动标签页（无 tabs 权限 / 后台上下文）时不提供建议。
  }
}
