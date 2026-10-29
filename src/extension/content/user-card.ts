/**
 * 站点用户卡片的适配器（内容脚本·主世界）。
 *
 * 复刻原生行为，但**不重画卡片**：B 站的用户卡片就是站点自己的自定义元素 `bili-user-profile`
 * （Lit 组件，站点 bundle 里 `customElements.define('bili-user-profile', …)`）——给它一个带
 * `data-user-profile-id` 的**参考元素**并调用 `setup(参考元素)`，它就会自己取数
 * （实测 `GET /x/web-interface/card?mid=…`）、自己定位（视口坐标系 + 出屏翻转）、自己渲染
 * （头像/昵称/等级/关注/粉丝/获赞/签名 + 关注/发消息按钮），鼠标进出参考元素时自己显隐。
 *
 * 驱动链路（为什么必须绕到主世界）：
 *   嵌入阅读器 iframe --window.postMessage--> 隔离世界内容脚本（校验 sender + 换算坐标）
 *   --window.postMessage--> 这里（主世界）。
 * 站点把该元素定义在**页面那份**自定义元素注册表里，隔离世界拿到的是另一份注册表：实测在隔离世界
 * `customElements.get('bili-user-profile')` 为 undefined、`createElement` 出来的实例也没有 `setup`。
 *
 * 我们的职责只有三件：造一个不可见的参考元素当锚、按宿主坐标摆好它、派发 mouseenter/mouseleave。
 * 站点改版（元素没了 / 没有 `setup`）时**整体放弃**这次交互，绝不半渲染一个自制卡片。
 */
import { USER_CARD_BRIDGE_SOURCE, isUserCardBridgeMessage } from '../page-comments';
import type { UserCardRect } from '../page-comments';

/** 站点卡片元素：这两个成员是站点实现的，不是我们约定的（见文件头）。 */
interface SiteUserCardElement extends HTMLElement {
  setup(reference: Element): void;
  appendToParent?(selector?: string): void;
}

/** 站点元素名；站点改版换名时这里会是 undefined，于是本功能安静地不生效。 */
const SITE_CARD_TAG = 'bili-user-profile';

let card: SiteUserCardElement | null = null;
let reference: HTMLAnchorElement | null = null;
/** 当前卡片显示的是谁：同一个用户重复 mouseenter 不再触发（站点元素自己有 hover 计时）。 */
let shownMid: string | null = null;

/** 参考元素只是「锚」：不可见、不吃指针、不占布局，位置由阅读器报来的坐标决定。 */
const REFERENCE_CSS = 'position:fixed;left:0;top:0;width:1px;height:1px;display:block;pointer-events:none;opacity:0';

function ready(): boolean {
  const current = card;
  const anchor = reference;
  return current !== null && anchor !== null && current.isConnected && anchor.isConnected;
}

/**
 * 延迟造一次站点卡片 + 参考元素。站点元素只在主世界可驱动，所以这里就地建、就地 setup；
 * 元素被站点（或我们自己）摘掉后下一次悬停会重新造一份。
 */
function ensure(): boolean {
  if (ready()) return true;
  if (customElements.get(SITE_CARD_TAG) === undefined) return false;
  const element = document.createElement(SITE_CARD_TAG) as SiteUserCardElement;
  if (typeof element.setup !== 'function') return false;
  const anchor = document.createElement('a');
  anchor.setAttribute('data-user-profile-spmid-follow', 'comment.profile.click');
  anchor.setAttribute('aria-hidden', 'true');
  anchor.setAttribute('tabindex', '-1');
  anchor.style.cssText = REFERENCE_CSS;
  document.body.append(anchor);
  // 站点自己的挂载方式优先（它会把卡片插到站点惯用的容器里）；缺失就挂到 body
  if (typeof element.appendToParent === 'function') element.appendToParent();
  else document.body.append(element);
  element.setup(anchor);
  card = element;
  reference = anchor;
  shownMid = null;
  return true;
}

/** 显示某位用户的卡片：把不可见的参考元素摆到锚点位置，再派发 mouseenter（站点的监听是原生事件，够用）。 */
export function showUserCard(mid: string, rect: UserCardRect): void {
  if (!ensure()) return;
  const anchor = reference;
  if (anchor === null) return;
  anchor.setAttribute('data-user-profile-id', mid);
  anchor.style.left = `${Math.round(rect.left)}px`;
  anchor.style.top = `${Math.round(rect.top)}px`;
  anchor.style.width = `${Math.max(1, Math.round(rect.width))}px`;
  anchor.style.height = `${Math.max(1, Math.round(rect.height))}px`;
  if (shownMid === mid) return;
  shownMid = mid;
  anchor.dispatchEvent(new MouseEvent('mouseenter'));
}

/**
 * 收起卡片：让站点元素走它自己的 mouseleave 路径（内部有 200ms 级隐藏延迟，不必我们处理）。
 * 带 `mid` 时只关这位作者的卡片——迟到的 mouseleave 不能关掉已经换到别人身上的卡片。
 */
export function hideUserCard(mid?: string): void {
  if (mid !== undefined && shownMid !== null && shownMid !== mid) return;
  shownMid = null;
  reference?.dispatchEvent(new MouseEvent('mouseleave'));
}

/** 主世界入口：把隔离世界转来的「显示/收起」变成对站点元素的驱动。 */
export function handleUserCardMessage(value: unknown): boolean {
  if (!isUserCardBridgeMessage(value)) return false;
  if (value.type === 'hide') {
    hideUserCard(value.mid);
    return true;
  }
  if (value.mid !== undefined && value.rect !== undefined) showUserCard(value.mid, value.rect);
  return true;
}

export { USER_CARD_BRIDGE_SOURCE };
