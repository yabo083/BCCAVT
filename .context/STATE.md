# 当前状态（L1）

> 更新时间：2026-10-29。2026-10-29 已把此前在途的全部改动提交为基线 `2dd7544`（2.3.0 基线）；其上的 2.4.0 第一刀在工作树里待提交。

## 2.4.0 第一刀（2026-10-29 落地，未发版）

共享缓存 + 定向定位 + 排序维度预埋，范围与探针结论见 `roadmap.md` 2.4.0 的「进度」。验证：`npm test` 49 文件 / 716 项、`npm run typecheck`、`npm run build`、`npm run docs:check` 通过。真机（调试 Chrome、已登录、BV1DXaG6TETt）：
- 判据 ①：工作台全量分析（`wbi/main` 30、`detail` 90）后，阅读器滚 5+ 页渲染 217 行，阅读器自身的 `wbi/main` / `detail` / `nav` 请求 **0**。IndexedDB 里 `session|bilibili|page` 与 `|direct` 成对、页键 `…|u:<mid>|roots|time|…`。
- 判据 ②：最深根评论定位——有快照时 **0 请求**，出定位块、行选中闪烁、宿主滚到位；删缓存后 **1 次 `seek_rpid`**，关块再定位 **0**；根已在流里的楼中楼走流内路径（无定位块）。「根在流里、回复未加载 → 并入 `loaded`」分支只有单测覆盖（真实视频里难构造）。
- 判据 ③：高度采样单调不减，前 3 行身份不变，`#biliMainHeader` 非空。
- 排序控件（提交 `e6422da`）：自绘评论区列表头「最热 | 最新」，默认最热；真机切换请求数 1 → 0 → 0，续滚只追加。
- 观测注意：替换模式下站点原生评论模块仍会自己发 `mode=3` 的 `wbi/main`（不是阅读器的），按请求数验收时要按 `mode`/`offset` 区分。

## 2.4.0（用户 2026-10-14 提出）：统一取数层

统一取数层：**定位与全量抓取共享缓存**（✅ 2026-10-29 第一刀，见上节）、**更智能高效的缓存**（配额/分层 TTL/区间完整性索引/跨界面预热/去重，对用户隐藏）、**更高吞吐且对源站友好的爬取**（树级并行 + 令牌桶 + 可续抓，对用户隐藏）、**还原原生「按最热｜最新」排序**（服务端排序 / 数据集完整时本地排序；缓存键要加排序维度，禁止对已取回页做客户端重排）。范围、判据与落地顺序见 `roadmap.md` 的「2.4.0（用户 2026-10-14 提出，未开工）：统一取数层——共享缓存 / 定位 / 排序 / 对源站友好的抓取」。

## 2.5.0 规划（用户 2026-10-16 提出，未开工）

评论区观感与原生能力补齐，六项（用户原话五项 + 代理并进来的收尾项）：**链接优化**（口径已由代理定：正文 URL/`@某人` 链接化 + 时间戳→评论链接；BV 号/话题待探针）、**B 站评论原生操作复刻继承**（现状只有点赞/回复/折叠/图谱；本轮做 `#dislike` 点踩与 `#more` 菜单里的举报/删除自己评论/复制评论链接、`#view-more` 语义对齐；`@` 联想、表情面板、关注 UP 不做）、**间距与边宽调整**、**传统分页模式的新评论区样式**（与无限滚动二选一的独立视图，可按时间检索特定评论）、**基础的按热度｜按时间排序**、**收尾**（清理被取代的 `native-comments-style.ts`/`native-thread.ts` 与长列表帧率实测）。排序与分页两项依赖 **2.4.0** 的共享缓存与缓存键加排序维度（其余项不依赖）。范围、判据、探针清单见 `roadmap.md` 的「2.5.0（用户 2026-10-16 提出，未开工）：评论区观感与原生能力补齐」。

## 已发布

- **2.3.0 已上传并提交 Chrome Web Store 审核（2026-10-14）**：item `afhenfapijikioaiopcjfagabbhphkpj`（与 2.2.0 同一条目），`release/loupe-2.3.0.zip`（398,959 字节），`uploadState=SUCCESS`，`publish status=["OK"]`、`statusDetail=["OK."]`，`target=default`。审核通过前线上仍是 2.2.0（每个新版本都要过审，见 `docs/publishing.md`）。
- **2.2.0**：已于 2026-10-14 早前提交同一审核流程（`uploadState=SUCCESS`、`publish status=["OK"]`）。含两项：① **顶部 header 变空消失的修复**（注入器水合门）；② **无限滚动重写**（游标状态机 + 边沿触发 + 已提交高度不缩）。产物 `release/loupe-2.2.0.zip`。
- 发版注意：`scripts/publish.mjs` 的 `/publish` 必须带空 body（`form: ''`），否则 Google 回 411；每次发布 `package.json` 的 version 必须高于线上（2.3.0 > 2.2.0 ✓）。

## 进行中 / 待办

- **2.3.0 已上传并提交商店审核（2026-10-14）**：`release/loupe-2.3.0.zip`（398,959 字节；含本轮前端改造 + 第二~五批实机反馈 + 设置弹窗重排 + 门限移除）。重新上传 = `npm run package` + `npm run publish`（凭据只在本地 `.env`，`docs/publishing.md`）；线上仍是 2.2.0，每个新版本都要过审。
- **2.3.0 第五批（实机反馈，2026-10-14）**：① **位置稳定优先**：左侧 rail 的六个 tab 与右侧详情把手改为**锚顶**（`.rail` 与 `.detail-panel.collapsed` 都 `align-self: flex-start/start`）——此前它们随面板高度上下平移，展开/收起一次就跳 35px（tab）与 368px（详情），现在四种状态下 tab 顶边恒为 101/161/220/280/340/399、详情/把手顶边恒为 92；② **AI 与历史两个 tab 去嵌套**：面板里 `.card` 数归零，分节改用 13px 分区标题 + 一条细线（`section-head`），空状态改一行左对齐；AI 设置（含「启用 AI 解读」开关）收进默认折叠的 `<details>`，摘要显示「模型名 / 未启用 / 未配置」+ 授权 chip；历史与最近快照改成细分隔线的列表行（不再一行一个盒子）。AI 面板收起态 **788 → 384px**。
- **2.3.0 第四批（实机反馈 + 外部设计评审，2026-10-14）**：① 收起详情由「方板 + 内层把手」改成右缘**竖向胶囊书签**（32×104、仅左侧圆角、玻璃材质、顶边与展开态对齐，hover 左移 4px）；② 工作台「输入」面板瘦身：删「快速开始」卡片、**删掉工作台里的「自绘评论区」开关**（`PageReadingSwitch.vue` 已删，该设置的唯一入口是设置弹窗）、抓取选项改成默认收起的 `<details>`（摘要行实时显示「刷新方式 · 上限」，文案与面板共用 `prefs.ts`）；③ `base.css` 新增 `.switch` 原语（`appearance: none` 的 checkbox），设置弹窗的布尔项改用它；④ 顶栏参数行 `justify-content: center`。
  - 真机复核：把手 32×104、右边缘 1428 = 视口 − 12px 内边距；hover `translate(-4px)` + 主色；面板高度 rail 收起 371 / 输入面板 422（展开抓取选项 563）；摘要行单行不截断（`全量回源 · 顶层/单树 不限`）；开关 34×20、关 `rgb(37,46,44)` / 开 `rgb(69,194,192)`、点击即回显。
- **2.3.0 第三批（实机反馈，2026-10-14）**：① 「全部折叠」粘滞（新取回的页也折叠，直到「全部展开」）；② 评论行放大镜**不按评论量判定**：原生评论行与自绘行的「图谱」入口都不受评论数量控制；自绘行的入口总是渲染、默认 `opacity: 0`，鼠标悬停该行或该行被选中才在**行右端**显形（`src/ui/components/PageCommentRow.vue` 的 `.analyze` 段）；③ 图谱弹窗初始尺寸收到 **960×660**、仍以当前窗口中心摆位，**挂载后首帧就量一次**尺寸（`src/ui/views/GraphPopupView.vue` 的 `EARLY_FIT_AT_MS` = 120/420/900ms），仿真收敛后再校准一次（`fitNow`/`fitAfterSettle`）；④ 雷达波**只闪两下**（实测帧差时间线 `XXXXXXX................`：0→2.86s 在变、之后完全静止），每次适配视图重播；⑤ 工作台顶部运行/提示条（`.topstack > .status`）改成顶栏下方的**绝对定位浮层**——抓取进度文案变长变短不再把中段那一排顶下去；`.dock` 与 `.detail-panel` 改成按**内容自适应高度**（长内容由 `.dock-scroll`/`.detail-scroll` 内部滚动，不再贯通中段）；⑥ 嵌入阅读器不自绘底色（`src/ui/embedded.html` 与 `.reader` 都透明，B 站评论区自己的底色透上来，浅色/深色与站点同色），头部工具组加 `margin-left: auto` 让换行时仍贴右；⑦ 浮岛 90% 底/18px 模糊/75% 边框/12px 圆角、rail 600 字重 + 激活 inset 描边、分隔点用 `--border-strong`、次要行降到 `--fg-subtle`+`--fs-xs`、深色投影改用 `var(--glass-shadow)`。
  - 真机复核：阅读器 `body`/`.reader` 计算背景 `rgba(0, 0, 0, 0)`（浅色会话与深色会话各测一次）；宿主底色 `#18191c` 的深色模拟下阅读器 `data-theme=dark`、`--fg #e7edeb`，无浅色块残留；`.analyze` 默认 `opacity 0`、悬停后 `1`（仅选中行默认可见）；`.bar-tools` 右边缘 939px = 头部右边缘。图谱弹窗开窗 ~150ms 内 947×624（960×660 的窗口去掉边框），**~1.07s 收敛到 707×524**（即 720×560 的 clamp 下限），之后不再变。工作台抓取中 `.topstack` 高恒为 68px、`.dock` 顶边恒为 92px（其间状态条实高 115px）；用一条 320px 高的假状态条做压力测试，`.dock` 顶边仍是 92px（状态条计算 `position: absolute`）；`.dock` 高度实测 rail 收起态 371px / 历史上限 508px / 输入面板 840px，详情收起态 71px、展开 158px。全部折叠 7 行 → 4 行、展开全部回 7 行；工作台 rail 激活色浅色 `rgb(10,82,89)` / 深色 `rgb(111,216,212)`、inset 描边跟随 `--accent-border`。
- **2.3.0 第二批（原型功能逐项对齐，2026-10-14）**：UP 头像着色、正文 @提及 pill（`comment-text.ts#splitMention`，正文去前缀）、首屏骨架屏（`SkeletonRows.vue` + `.skeleton-shimmer-box`）、工作台四岛错峰 + 视图切换 + 详情卡换选动效、图谱雷达波（`force-graph.ts#radarPing`）。设置弹窗按用户反馈重排：320px 下高度 **217px**（原 ~450px）、正文可见文字仅 5 个标签（全部解释进 `title`）、「自定义主色」改成彩虹 `+` 环（`label` 包住透明 `input[type=color]`，可辨识、可点击、Tab 可达）。
  - 真机复核：工作台四块浮岛 `getAnimations()` 分别为 island-drop/slide-left/slide-right/rise；rail 切换的 dock-body 带 `view-pane*` + 对应 keyframes；阅读器里 1 行命中 @提及（pill=「先说说我美丽的羽毛」、正文已去前缀）、UP 行头像 `background-color: var(--accent-bg)` + `up-avatar` 类；图谱 canvas 两次采样 600ms 间隔**帧内容不同**（聚焦节点上有雷达环在动）。

- ✅ **2026-10-14 关闭两条（同一根因）**：② 「回弹」与 ③ 「加载新评论时随机跳动、无固定锚点」——平台按时间**倒序**分页 × 展示层按 `createdAt` **升序**排根 = 每取一页把新行整块插到已读内容之上（真机 A/B：`insertedAbove` 21/33/30/30、阅读器 CLS 1.92）。修复见 [ADR-0004](../docs/adr/0004-reader-row-order-append-only.md)（顶层顺序 = 取回顺序）与 ADR-0003 的 2026-10-14 补充（重置按目标身份）；判据与探针制度见 `LESSONS.md` L-10。
- ✅ **2026-10-14 关闭另两条**：① 「阅读器抓取量比完整分析少」= 身份姿态 + 计数口径，不是代码差异（已把未登录截断原因送进完整度说明）；④ 「抓取提示换 SVG 动效图标」= 原来三处占位是零尺寸空 span（不可见），现统一用图标组件。两条的判据与实测数字见 `roadmap.md` 的「待办 1 / 待办 4」与「无限滚动 UX 收尾」、`LESSONS.md` L-11。
- ✅ **2026-10-14 新增：作者入口复刻原生**（点头像/昵称开主页 + 悬停出用户卡片，卡片复用站点自己的 `bili-user-profile`，不自绘）。实机已验：新标签打开 `space.bilibili.com/<mid>`、悬停出站点卡片（`uid`/名字与行一致）、移开收起、移到卡片上保持打开。见 [ADR-0005](../docs/adr/0005-native-author-entries-via-site-component.md) 与 `LESSONS.md` L-12。
- ✅ **2026-10-14 前端改造落地（按 `docs/handoff.md` 六阶段）**：① 可插拔配色（5 预设 + 自定义 HEX，`loupe.palette`，与明暗正交，见 [ADR-0007](../docs/adr/0007-theme-palette-tokens.md)）；② 连接线改成「头像几何中心对齐」并封顶 3 列（封顶列画竖直连接段，不再有 32px 悬空尾巴），脊线由 `thread.ts#flattenThread` 输出 `col/parentCol/rowSpines`，取消行级悬停改线色（见 [ADR-0006](../docs/adr/0006-reader-spine-geometry.md)）；③ 评论行动效（点赞弹簧、计数回弹、回复抽屉 grid 展开、定位闪烁）；④ 图谱/工作台 → 评论区定位协议（见 [ADR-0008](../docs/adr/0008-locate-in-reader.md)）。
  - 验证：`npm test` **49 文件 / 687 项通过**、`npx vue-tsc --noEmit` 干净、`npm run build` 通过。
  - 真机（本机 Chrome + `Extensions.loadUnpacked(dist)`，专用 profile）：**几何**用真实组件 + 真实展平算法在 `tmp/rows.html` 脚手架里逐行断言（头像中心 == `Xc(col)`、elbow 左缘 == `Xc(parentCol)`、右端 == 子头像中心、封顶行无 elbow 且有 `.capped` 段、竖脊贯穿行高、封顶列零断口）；**配色**工作台点色点 → 已打开的 B 站页阅读器即时换色（pink→amber→blue，无需刷新）；**定位**从工作台主世界 `chrome.runtime.sendMessage` → `{ok:true}`、宿主 `scrollY` 0→1521、目标行 `selected`+`flash-highlight`；**高度**滚动会话内槽位高度单调（1142 恒定）。
- 仍待办（`roadmap.md`「下一回合：UI 优化」）：写操作交互反馈；1000+ 行滚动流畅度实测（本轮只做了动效与几何，未做长列表帧率）；清理被取代的原生 CSS 增强路径（`native-comments-style.ts`/`native-thread.ts`）；定位按钮点击这条 UI 路径的整链真机脚本（协议层已实测，按钮由单测覆盖）。

## 真机验收方法（本机可复现；细节与坑见 `LESSONS.md`）

1. 起一个**专用 profile** 的 Chrome（`--user-data-dir=tmp/...`，不要用用户日常 profile），扩展用 CDP `Extensions.loadUnpacked` 装 `dist/`（Chrome 137+ 起 `--load-extension` 命令行开关已失效）。
2. 在设置弹窗里打开「自绘评论区（替换原生）」开关；打开一个视频页，**先 `bringToFront()` 并暂停 video**（后台标签页不渲染：`ResizeObserver`/`IntersectionObserver`/滚动都不生效；视频播完会触发站点自己的平滑回顶，污染滚动观测）。
3. 探针要装在 `tab.run`（`page.mainFrame().evaluate`）那个 JS world：实测 `t.evaluate` 与它互不可见，且 reader 的 postMessage 只在前者里被收到。
4. 要验真实抓取量必须带登录态：匿名评论 API 只回 3 条。用测试 profile 前先注入 cookie，用完**删除该 profile**。
5. 断言看三样：桥请求 URL 是否**逐页唯一**、到底之后是否**零新增请求**、高度上报是否**单调不减**。

## 文档自检

`npm run docs:check`（`assets/agents/cdc/docs-check.mjs`，规则数据见 `.context/rules.json`）：扫 `AGENTS.md`/`roadmap.md`/`docs/**`/`.context/**`/三个模块 README/`tests/test-suite.md` 里的引用——文件不存在、行号越界或**符号锚点解析不到** = **硬失败**（退出码 1）；被引用文件比文档新 = **告警**（不阻塞）。改完文档跑一次；引用一律写成「路径/文件名#符号名」（指名不指位，符号以目标文件里的标识符为准，中文标题锚点按子串匹配），物理行号已弃用（见 `LESSONS.md` L-09）；裸 `:行` 会按同文档内最近一次提到的文件解析，容易指错。
