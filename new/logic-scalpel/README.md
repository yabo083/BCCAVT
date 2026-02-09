# 逻辑手术刀（Occam）Chrome 扩展

这是一套基于 Manifest V3 的浏览器插件骨架，用于嗅探 B 站评论接口并在侧边栏中渲染逻辑树状图。所有逻辑均在本地运行，无需后端。

## 功能概览

- 侧边栏 UI（暗色科技风）展示评论图谱
- 嗅探 B 站评论接口 `api.bilibili.com/x/v2/reply`
- 将扁平评论转换为树状结构并渲染力导向图
- 预留“逻辑诊断”按钮，用于后续接入 AI 分析

## 安装与使用

1. 打开 Chrome 扩展管理页面：`chrome://extensions/`
2. 打开右上角「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择目录：
   - `/workspace/BCCAVT/new/logic-scalpel`
4. 打开任意 B 站视频页或评论页。
5. 点击浏览器工具栏中的“逻辑手术刀”图标，即可打开侧边栏。
6. 当页面加载评论时，插件会嗅探接口并在侧边栏绘制评论逻辑图。
7. 点击任意节点后可查看右侧详情；点击「逻辑诊断」会在控制台输出该分支的对话流（占位）。

## 注意事项

- 侧边栏 UI 依赖 D3 CDN；如需离线运行，请替换为本地 D3 文件。
- 当前逻辑仅处理 B 站评论接口（`api.bilibili.com/x/v2/reply`）。
- 响应抓取采用请求完成后再行 `fetch` 的方式读取 JSON，不会影响页面正常请求。

## 开发提示

- 入口文件：
  - `manifest.json`
  - `service_worker.js`
  - `sidepanel.html`
  - `sidepanel.js`
  - `styles.css`
- 调试：
  - `chrome://extensions/` 中点“服务工作线程”查看日志
  - 侧边栏 DevTools 可在侧边栏中右键检查
