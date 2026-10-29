/**
 * 内容脚本（主世界）：
 * 1. 注入「一键分析」按钮：播放器下方一个「分析评论区」，每条评论（含楼中楼）自己的操作行里一个
 *    「分析评论树」放大镜。新版评论是自定义元素，数据挂在实例上（上游读 `__data`，实机同时有 `.data`），
 *    只有主世界读得到，所以 id 解析与按钮写入都在这里；按钮不带事件监听，点击由隔离世界发消息给后台转交。
 * 2. 右键路径：右键时解析出评论 id，postMessage 转给隔离世界按标签页暂存。
 * 3. 站点用户卡片：嵌入阅读器把「鼠标进/出某位评论作者」经隔离世界转到这里，由这里驱动**站点自己的**
 *    卡片元素（同样是「只有主世界读得到」的那类自定义元素），阅读器不重画卡片。见 content/user-card.ts。
 *
 * 原生样式增强（native-comments-style / native-thread）不再由页面开关驱动，也不再从这里启动：
 * 页面开关的语义是「把原生评论区换成自绘阅读器」（见 content/isolated.ts 与 page-reader.ts）。
 */
import { PAGE_BRIDGE_SOURCE } from '../messages';
import { createPageActionInjector } from './injector';
import { handleUserCardMessage } from './user-card';
import { contextCommentIdOf } from './targets';

const injector = createPageActionInjector(document);
injector.start();

// 用户卡片：隔离世界把「鼠标进/出某位评论作者」转过来（坐标已换算成宿主视口坐标系），
// 这里驱动站点自己的卡片元素——它只在主世界可见（见 content/user-card.ts 的文件头）。
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  handleUserCardMessage(event.data);
});

window.addEventListener(
  'contextmenu',
  (event) => {
    // composedPath() 由内向外，第一个命中的就是最内层评论元素（楼中楼优先于其所属根评论）
    let commentId: string | null = null;
    for (const node of event.composedPath()) {
      if (!(node instanceof Element)) continue;
      commentId = contextCommentIdOf(node);
      if (commentId !== null) break;
    }
    window.postMessage({ source: PAGE_BRIDGE_SOURCE, commentId, pageUrl: window.location.href }, window.location.origin);
  },
  true,
);
