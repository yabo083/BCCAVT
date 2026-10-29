# Loupe · 评鉴

一个浏览器扩展完成平台鉴权、评论抓取、分析与可视化，无需 Python、Redis 或网站后端。当前接入 Bilibili，其他平台通过 `PlatformAdapter` 扩展。

## 构建与安装

需要 Node.js 24、Chrome / Edge 116+。

```sh
npm ci
npm test
npm run build
```

打开 `chrome://extensions` 或 `edge://extensions`，启用开发者模式，加载本项目 `dist/`。本机项目路径：`E:\Codes\AI\projects\loupe`。

## 使用

- 登录 B 站后打开视频。点击扩展图标打开紧凑设置面板（自绘评论区开关、主题配色），面板里的「打开完整工作台」进入分析界面；输入 BV 号、av 号或视频链接，选择“分析评论区”。默认遍历全部可访问分页；高级选项的上限 `0` 表示不限。
- 选择报告中的评论，或输入带 `#reply<评论ID>` 的视频链接，分析该评论及其后代。平台可能要求抓取所在楼层后才能筛出子树，最终统计不包含无关兄弟分支。
- 视频页会在播放器下方工具栏的原生操作行里注入一个只有放大镜图标的「Loupe 分析评论区」按钮（Phosphor `ph:magnifying-glass`，点击开完整标签页工作台），并在原生评论行里注入一个同样的放大镜按钮（可访问名「Loupe 分析评论树」）：点击它开一个 `type: popup` 的独立窗口，窗口只画一张铺满窗口的力导向图（`?view=graph&input=&comment=`），初始 960×660、以当前窗口中心摆位，挂载后按内容量一次尺寸。按钮的注入不按评论量判定：只要能从评论行解析出评论 id 就注入（评论数、回复数都不参与），组件结构不匹配时静默不注入，改版失效时可改用评论链接入口。自绘评论区里也有等价的「图谱」入口，它总是渲染、默认隐在行的右端，鼠标悬停该行或选中该行才显现。右键菜单同样可用：右键视频开完整工作台，右键评论开图谱窗口（取不到评论 id 时退到工作台）。
- “在新标签页打开”使用同一套界面。抓取在扩展页运行，关闭页面会中止；已有分页缓存可以复用，不保证跨关闭继续原任务。
- 历史快照可离线重开；增量刷新重新遍历顶层、复用回复数未变的完整评论树。需要检查同数量编辑或点赞变化时用完整刷新。
- 图谱视图使用真实力导向模拟：节点代表评论、连线代表回复，用户名是主要标签；点击节点查看正文，拖动节点整理布局，工具栏可暂停布局与重置视图。
- 页面开关「自绘评论区（替换原生）」默认关闭，开启后 B 站视频页的原生评论区被换成 Loupe 自绘评论区：内容脚本隐藏原生评论根（只写它的 `display` 并保存原值以便精确还原，绝不触碰 `#biliMainHeader` 与评论区的任何祖先），并在原位挂载扩展内嵌阅读器；关闭、离开视频页或原生评论根消失即撤掉槽位并还原。原生根只在阅读器 UI 就绪（`reader-ready`）后才隐藏——抓取期间先看到进度，失败时原生评论仍在。原先的“Reddit 风格原生样式增强”（`content/native-comments-style.ts` / `content/native-thread.ts`：样式表注入 open shadow root、按 `parent` 做 CSS `order` 视觉重排与折叠）保留代码但已与开关解耦，内容脚本不再启动它，只有 `tmp/preview.ts` 那套可复现预览还在用。
- 评论区自维护阅读器（`content/page-reader.ts` 在原评论根相邻槽位挂扩展内嵌页）是页面开关开启后的呈现：评论的多级关系由扩展按 `rootId`/`parentId` 自己抓取搭树（顶层评论按页继续，展开某条时按需抓它的回复树，滚到底自动继续），不依赖 B 站原生分页按钮，预览抓取不落历史快照。点赞、回复与发表评论都在自绘区里完成：界面只把意图交给内容脚本，由页面上下文带着写执行时现读的 CSRF 令牌发请求（凭据不跨桥、不进日志/快照/缓存），结果按 `requestId` 回来——点赞乐观切换、失败回滚并提示，回复与发表成功把返回的评论插进树（新顶层评论钉在列表最上面）。长正文按自然高度完整呈现、宿主只有一根滚动条；大树分批渲染（折叠 + 「继续显示」限流），主题跟随宿主。全量分析请在评论行的放大镜里打开独立窗口完成：那个窗口只画一张铺满窗口的力导向图（没有顶栏、输入框与视图切换），评论正文在图上悬停查看。
- B 站 `[doge_金箍]` 等表情根据评论 API 的 `content.emote` 映射显示为图片；Unicode emoji 原样保留。未知表情或加载失败保留原文字，不隐藏内容。
- 打开分析界面失败时，在按钮旁就地显示后台给出的原因（如「分析来源无效」「分析页面已切换」「评论 ID 无效」）；扩展被重载后提示刷新页面。其它错误直接提示，不静默吞掉。

### 完整度与身份

“全量”指平台当前身份可读取的全部分页，不代表能读到删除、折叠或不可见评论。匿名访问可能被平台截断；报告显示获取量、平台声明量、抓取时间和不完整原因。风控会退避重试，仍失败则明确报错，不把部分数据冒充完整。

Cookie 由浏览器随请求携带，不导出、不保存在项目中。需换账号时重新读取登录状态并刷新数据。

### AI（可选）

在 AI 面板配置 OpenAI 兼容端点、模型及 API Key。AI 默认关闭，只有明确点击解读/诊断才会向所选端点发送评论摘录；开启前应确认平台和端点的数据处理条款。密钥保存在本机扩展 `chrome.storage.local`，不是系统加密保险箱，不进入快照。

解读基于有预算限制的摘录，不等于逐条审阅全部评论。模型判断是辅助意见，引用可跳转到原评论，不能作为事实或逻辑谬误的确定性裁决。

## 开发

- `npm run dev`：监听构建；修改后在扩展管理页重新加载。
- `npm run typecheck`：类型检查。
- `npm run icons`：从 `assets/icon.svg` 生成扩展图标。
- [架构与决策](docs/README.md)。

### 上游参考

页面内联按钮（`src/extension/content/`）的评论区锚点、组件选择器与 shadow-root 观察模型参考了上游
[Bilibili-Evolved](https://github.com/the1812/Bilibili-Evolved)（MIT，`LICENCE.md` 另加「再分发须保留 README 安装入口」的限制，本项目只借鉴思路与选择器、未复制其代码）：

- [comment-apis.ts](https://github.com/the1812/Bilibili-Evolved/blob/master/src/components/utils/comment-apis.ts) 与 [areas/v3.ts](https://github.com/the1812/Bilibili-Evolved/blob/master/src/components/utils/comment/areas/v3.ts)：`bili-comments` 评论区、`bili-comment-action-buttons-renderer` 操作行、`rpid_str` 取自组件数据（上游读 `__data`）、按 shadow root 逐个观察并沿新增节点登记嵌套 shadow root。
- [comments/copy-link/index.ts](https://github.com/the1812/Bilibili-Evolved/blob/master/registry/lib/components/utils/comments/copy-link/index.ts)：按评论挂操作的用法（上游挂在 `bili-comment-menu` 菜单里，本项目改为操作行上的放大镜图标按钮，`title`/`aria-label` 给可访问名）。

本项目自己的部分：`runtime.sendMessage` 点击协议与后台按 kind 分流（视频级 → 完整标签页工作台，评论行 → 独立图谱窗口）、`data-loupe-*` 按钮属性、承载面判定（整页 / 图谱窗口）。
- 扩展 API 参考 GoogleChrome/modern-web-guidance 的官方 `chrome-extensions` 技能（含 Web Store 发布指导），以及 Chrome 官方 popup 与窗口（`chrome.windows.create`）示例。已安装到本机共享技能目录；没有另建同名伪技能。


旧工程名 BCCAVT，Git 历史保留；旧代次本机留档于 `E:\Codes\AI\archive\legacy-projects\bccavt-gen1`，不参与构建。历史曾提交 Cookie 文件，本次只删除现行树中的文件，未改写远端历史；旧凭据应在平台撤销，不能把移除文件视为撤销凭据。

## 本次验收（2026-10-09）

- `npm test`：23 个测试文件、285 项通过；`npm run build` 类型检查与生产构建通过。
- Chrome 154 真实加载扩展：视频 `BV1UbpP6EEGu` 的页面按钮触发评论区分析；评论 `316401376609` 得到 **5/5 条**，其楼中楼 `316408586945` 得到 **1 条**，兄弟评论未混入。
- 注入实测：视频按钮 1 个、已渲染评论各 1 个，点击操作行按钮后侧栏目标与评论 ID 正确；页面原生 `bili-comments` 正常挂载。（该轮记录的是当时的侧栏入口；入口已改为评论行放大镜开独立图谱窗口 + 视频级按钮开完整工作台，见上文「使用」，需按新入口重跑这条实测。）
- 评论树修复实测：原实现线程容器从 1102px 持续涨到 5011px；修复后 1280px/DPR1 和 400px/DPR2 连续 12 秒稳定，滚动范围不再增长；Canvas CSS 高度与位图高度分离。
- 历史快照重开未新增 B 站 API 请求；1280px 整页与 400px 窄屏已实际查看。
- r4 `deepseek-v4.1-flash` 真实完成流式视频评论解读、单树结构化诊断，以及二次解读缓存命中；测试密钥未写入项目或扩展。
- **未验证**：用户现有 Chrome 登录态复用（relay 超时、Cookie 为 v20 加密）；旧版非 Shadow DOM 评论组件；万级数据性能指标。匿名端到端成功不替代这些验证。
