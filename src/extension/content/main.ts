/**
 * 内容脚本（主世界）：
 * 1. 注入「一键分析」按钮：播放器下方一个「分析评论区」，每条评论（含楼中楼）自己的操作行里一个
 *    「分析评论树」。新版评论是自定义元素，数据挂在实例上（上游读 `__data`，实机同时有 `.data`），
 *    只有主世界读得到，所以 id 解析与按钮写入都在这里；按钮不带事件监听，点击由隔离世界在真实事件里
 *    同步 sendMessage——异步桥会丢掉用户激活，sidePanel.open 会被拒。
 * 2. 右键路径：右键时解析出评论 id，postMessage 转给隔离世界按标签页暂存。
 */
import { PAGE_BRIDGE_SOURCE } from '../messages';
import { createPageActionInjector } from './injector';
import { contextCommentIdOf } from './targets';

createPageActionInjector(document).start();

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
