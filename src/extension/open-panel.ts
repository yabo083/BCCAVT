/**
 * 分析入口的落地：把「要分析什么」变成真正打开的界面。
 *   - 视频级入口（工具栏按钮、右键视频）→ 完整标签页工作台（`?view=tab&input=&comment=`）；
 *   - 评论行放大镜（页面按钮、右键评论）→ 独立图谱窗口（`?view=graph&input=&comment=`，只有一张力导向图）。
 * 两条路线都不需要用户激活：侧栏（`sidePanel.open` 的手势链路）已经彻底移除。
 * 地址契约只有 `src/ui/surface.ts` 一份：`view=graph` 的 input/comment 由 graphPopupUrl 拼，
 * 后台与页面阅读器共用它，不各写一份字符串；开窗的初始尺寸与摆位同理，收口在 openGraphPopupWindow。
 */
import { graphPopupUrl } from '@/ui/surface';

/** 分析落地到了哪个界面；内容脚本只关心 ok，这个值供后台日志与测试断言。 */
export type AnalysisSurface = 'tab' | 'popup';

/**
 * 图谱窗口初始尺寸：与页面阅读器里的放大镜用同一扇窗、同一份尺寸。
 * 取紧凑的一档而不是「大到不会不够」：窗口开着的那几百毫秒里用户看到的就是这个尺寸，
 * 而图本身的规模通常只值 720×560 上下——开大了再缩回去，那一下收缩比开门见山更难忽略。
 * 开窗后由窗口自己按图的实际规模调（首帧就量一次，见 ui/views/GraphPopupView.vue#fitNow）。
 */
const GRAPH_POPUP_WIDTH = 960;
const GRAPH_POPUP_HEIGHT = 660;

/** 一扇窗口的位置与大小：`chrome.windows` 里这些字段都是可选的，取全了才算数。 */
interface WindowBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 取全了的 bounds；缺字段、宽高非正都算拿不到。 */
function boundsOf(win: chrome.windows.Window | undefined): WindowBounds | null {
  if (!win) return null;
  const { left, top, width, height } = win;
  if (left === undefined || top === undefined || width === undefined || height === undefined) return null;
  if (!(width > 0) || !(height > 0)) return null;
  return { left, top, width, height };
}

/** 读一次窗口 bounds：接口不存在、调用失败、字段不全都返回 null（位置只是锦上添花，绝不往调用方抛）。 */
async function readBounds(read: (() => Promise<chrome.windows.Window>) | undefined): Promise<WindowBounds | null> {
  if (typeof read !== 'function') return null;
  try {
    return boundsOf(await read());
  } catch {
    return null;
  }
}

/**
 * 当前窗口的 bounds：页面里就是自己所在那扇，后台（service worker）里是最后聚焦的那扇。
 * 拿不到（无 `chrome.windows`、环境不支持、字段不全）返回 null —— 调用方据此退回「不传位置」，绝不因此报错。
 */
async function currentWindowBounds(): Promise<WindowBounds | null> {
  const api = typeof chrome === 'undefined' ? null : chrome.windows;
  if (!api) return null;
  const readCurrent = typeof api.getCurrent === 'function' ? () => api.getCurrent() : undefined;
  const readLastFocused = typeof api.getLastFocused === 'function' ? () => api.getLastFocused() : undefined;
  return (await readBounds(readCurrent)) ?? (await readBounds(readLastFocused));
}

/** 一维居中：先取理想位置，再夹回 `[origin, origin + span - size]`；host 比弹窗还小时夹到 origin。 */
function centerOn(origin: number, span: number, size: number): number {
  const ideal = origin + Math.round((span - size) / 2);
  return Math.min(Math.max(ideal, origin), Math.max(origin, origin + span - size));
}

export interface AnalysisDestination {
  input: string;
  /** 评论 id：存在时直接打开那条评论树，缺省是视频级评论区分析。 */
  commentId?: string;
  /** 源标签页所在窗口：分析开在用户正看着的那个窗口里，而不是「当前」窗口。 */
  windowId: number;
}

/** 评论行放大镜的落地目标：评论 id 必须已经在后台校验过（纯数字）。 */
export interface GraphDestination {
  input: string;
  commentId: string;
}

/**
 * 视频级入口：开一个完整标签页工作台。工作台自带输入栏、报告、评论树与图谱视图，
 * 是视频级分析与「右键评论但取不到评论 id」时的落地面。
 * 地址直接带上 input/comment，所以不写任何存储意图——工作台自己从 URL 起跑。
 */
export async function openAnalysisTab(target: AnalysisDestination): Promise<'tab'> {
  const url = new URL(chrome.runtime.getURL('src/ui/app.html'));
  url.searchParams.set('view', 'tab');
  url.searchParams.set('input', target.input);
  if (target.commentId) url.searchParams.set('comment', target.commentId);
  await chrome.tabs.create({ url: url.href, windowId: target.windowId });
  return 'tab';
}

/**
 * 评论行放大镜：开一个 `type: 'popup'` 的独立窗口，地址是 `?view=graph&input=&comment=`，
 * 那个窗口只画一张铺满窗口的力导向图。
 *
 * 这里不需要用户激活（`chrome.windows.create` 不要求手势），也**不做任何降级**：
 * 完整工作台装不下这张图，点击的语义就是「在这条评论树上看图」，
 * 打开一个用户没要的界面比失败更糟——失败原样抛给调用方，由内容脚本就地提示。
 */
export async function openGraphPopup(target: GraphDestination): Promise<'popup'> {
  const url = graphPopupUrl(chrome.runtime.getURL('src/ui/app.html'), target.input, target.commentId);
  await openGraphPopupWindow(url);
  return 'popup';
}

/**
 * 开一扇图谱弹窗：开窗这件事的唯一实现，后台放大镜与页面阅读器共用（不各写一份 `windows.create`）。
 *
 * 位置取**当前窗口中心**：不传 left/top 时由 Chrome 自己摆，结果常常压住用户正在看的页面或甩到屏幕角落；
 * 拿不到当前窗口 bounds 时退回不传 left/top（也就是原来的行为），绝不因此报错。
 * 初始尺寸取紧凑一档（960×660）——打开后由窗口自己按图的实际规模调（见 ui/views/GraphPopupView.vue#fitNow）。
 */
export async function openGraphPopupWindow(
  url: string,
  width: number = GRAPH_POPUP_WIDTH,
  height: number = GRAPH_POPUP_HEIGHT,
): Promise<chrome.windows.Window | undefined> {
  const host = await currentWindowBounds();
  // 摆位：弹窗居中于当前窗口，再夹回窗口范围内——窗口一定在它所在屏幕内，夹在这里就不会摆到屏幕外。
  // 屏幕信息在后台拿不到（`chrome.system.display` 要权限，本项目不引入），当前窗口的 bounds 就是最合适的代理。
  const placement = host
    ? { left: centerOn(host.left, host.width, width), top: centerOn(host.top, host.height, height) }
    : {};
  return chrome.windows.create({
    url,
    type: 'popup',
    width,
    height,
    focused: true,
    ...placement,
  });
}
