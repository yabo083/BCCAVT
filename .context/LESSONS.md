# 踩坑与根因记录（L1）

> 只记**已验证**的根因与判据（能复现、有证据）；未复现的推测标 `[INFERENCE]` 并写清「怎么验证」。
> 新增一条：写「现象 / 根因 / 修复 / 判据 / 相关位置」。

## L-01 顶部全局 header 变空消失：水合前写站点容器 → 页头二次 init

- **现象**：B 站视频页顶部 header 变空；控制台 `bili-header.umd.js` 报 `[Vue warn] There is already an app instance mounted on the host container` + `TypeError: Cannot read properties of null (reading 'nextSibling')`。
- **根因**：视频页是 SSR 预渲染（`#app` 带 Vue 2 的 `data-server-rendered`），整棵 SSR DOM 必须在**同一个同步任务**里被 hydration 认领。水合前只要 `.video-toolbar-right` 里已经多出一个不属于站点 vnode 树的节点，hydration 遍历就失配 → 整棵 SSR DOM 被丢弃重建 → 页头组件 `MainHeaderV3.mounted()` 第二次执行 → `getScript("…/laputa-header/bili-header.umd.js")` 再 append 一个 script（无去重）→ `new BiliHeader({config}).init(document.getElementById("biliMainHeader"))` 第二次作用在**同一容器**：bili-header 的 `Object.mount` 先 `container.innerHTML=""`、再 patch 上一个 app 的 `_vnode` 树 → `removeFragment(null)` 抛 TypeError ⇒ 容器保持空。
- **修复**：注入器加第二道门 `siteMountFinished()`——文档里再也找不到 `data-server-rendered` 才算站点首次挂载结束；文档观察者盯住该属性的移除作为开门信号；`scan()` 在两道门都过之前**一个页面节点都不写**。位置：`src/extension/content/injector.ts`（`SSR_MOUNT_MARKER_ATTRIBUTE` / `DOCUMENT_OBSERVER_OPTIONS` / `siteMountFinished` / `scan`）；阅读器的兜底超时同样受该门约束（`src/extension/content/page-reader.ts` 的 `headerSettled`）。
- **判据**（可复现）：同一构建同一 Chrome —— 水合前把 `.loupe-host` 插进工具栏 ⇒ `BiliHeader.init` 跑 2 次、`#biliMainHeader` 变空；等到水合后再插 ⇒ 只跑一次、header 完好。人为保持水合标记时，窗口 load 已过仍 `hosts:0 / actions:0`。
- **教训**：旧版只有 window load 一道门，而窗口 load 早于站点水合时（冷缓存/慢网络/页面更重）就拦不住 —— **偶发**的根因就是这条竞态。

## L-02 无限滚动：三个结构性缺口（已重写）

- **缺口 1｜重跑全量抓取**：旧 `loadMore()` = 把上限加一页后从游标起点重跑整条链并整体替换结果 ⇒ 同一页被反复读、内容被整体替换（限流下中段失败会反复撞同一堵墙）。
- **缺口 2｜客户端推断到底**：旧 `exhausted = forest.roots.length < visibleRoots` 分不清「平台说到头」与「被上限/登录态截断」，一旦成立永久早退；权威信号 `page.next === null` 没被用上。
- **缺口 3｜高度闭环**：槽位高度由 `ResizeObserver` 即时量即时写，高度一回落 ⇒ 宿主文档变矮 ⇒ `scrollTop` 被钳回 = 回弹；「行数没减少就只增不减」只是遮盖。
- **修复**：`src/ui/infinite-scroll.ts`（游标状态机：只追加/单飞/失败保留游标/到底=`next===null`）+ `previewRootsPage`/`crawlRootsPage`（按游标取一页，与整链共用页缓存键与账号隔离）+ 触发收敛成 `evaluateTrigger` 边沿闸门（宿主视口消息 + 哨兵 IO 汇入）+ `reportHeight(allowShrink)` 只在结构性缩高时下调。契约见 `docs/adr/0003`。
- **判据**：真机实测 —— 高度上报 17 次**单调不减**；桥请求 20 次**全部唯一**（9 个顶层页游标严格前进）；到底后再滚 4 次 ⇒ **零新增请求**。

## L-03 跨源 iframe 里 IO / RO 回调交付不可靠

- **实测**：本机环境里，扩展源 iframe 内的 `IntersectionObserver` 与 `ResizeObserver` 回调**不总交付**（同一文档里自建 observer 也不触发），后台/被节流标签页尤其明显。
- **结论**：触发与高度上报的正确性**不能押在 IO/RO 上**；视口消息（`READER_VIEWPORT`）才是主通道，IO 只作兜底。这也是「边沿触发必须写在嵌入页侧」的原因。
- **依据**：`docs/adr/0003` 的「遗留」一节。

## L-04 宿主 scroll anchoring 在本场景双重失效

- 宿主侧 anchor node 只能是 iframe 那个盒子，而高度从底边变化不移动它的 block-start 边 ⇒ 补偿量为 0；且写 `slot.style.height` 正好命中 SANACLAP 抑制表。
- **结论**：回弹只能靠「**已提交高度不缩**」根治，不要指望浏览器补偿。依据与规范链接见 `docs/adr/0003`。

## L-05 CWS `/publish` 空 body POST 会被拒 411

- **现象**：`npm run publish` 上传成功但发布请求回 HTTP **411 Length Required**（HTML 错误页，导致脚本报「响应不是 JSON」）。
- **根因**：`scripts/publish.mjs` 的 `publish()` 用 curl 发无 body 的 POST，curl 不补 `Content-Length`。
- **修复**：传空表单体（`form: ''` ⇒ `--data-binary ''`）带出 `Content-Length: 0`。

## L-06 本机真机测试的四个坑（别重复踩）

1. **Chrome 137+ 起 `--load-extension` 命令行开关失效**：必须用 CDP `Extensions.loadUnpacked`（需要 `--enable-unsafe-extension-debugging`）装 `dist/`。
2. **后台标签页不渲染**：不 `bringToFront()` 时 `ResizeObserver`/`IntersectionObserver` 不交付、`window.scrollTo` 也不生效 —— 一切滚动/高度观测都会得出假结论。
3. **工具里有两个 JS world**：`tab.run` 的 `page.mainFrame().evaluate` 与 `t.evaluate` 互不可见（各自的 `window` 属性看不到对方），而 reader 的 postMessage 只在**前者**里被收到 ⇒ 探针装错 world 会得出「什么都没发生」。
4. **匿名评论 API 只回 3 条**（`x/v2/reply/main` 对未登录返回 `is_end: true`、3 条）：要验真实抓取量必须注入登录态 cookie；用完**删除该临时 profile**（里面有凭据）。另外 B 站视频页在视频结束后会**自己平滑回顶**，测滚动时要先暂停 video 并把站点行为与我们的行为分开。

### L-06 补充（2026-10-14）：「匿名只回 3 条」的条件被找出来了 —— 是**站点 Cookie**，不是「未登录」

同一视频、同一条已签名 URL、同一时刻，只改 `credentials` 做 A/B（页面上下文里 `fetch`）：

| 请求 | `replies` | `is_end` | `pagination_reply` |
|---|---|---|---|
| `credentials: 'omit'` | **19** | false | `next_offset` 可继续翻 |
| `credentials: 'include'`（页面里的匿名会话 cookie：`buvid3/buvid4/_uuid/bili_ticket/…`） | **3** | true | `{}` |

- 结论：**带（未登录的）站点 cookie 才被截断**。桥路径（在页面上下文发请求）必然带 cookie ⇒ 阅读器在未登录时看到「4 条评论 / 没有更多评论了」是**平台按身份截断**，不是抓取 bug；扩展源直连（`credentials: 'omit'`，桥不可用时的降级路径）反而能拿到完整分页与游标。
- 对复现的价值：**用探针验无限滚动不必找登录态**——把真实分页响应喂给阅读器即可（制度见 L-10）。

## L-07 根因未复现前不要写成结论（方法论）

- 2.1.2 曾把 header 崩溃归因于「`history.pushState/replaceState` 猴补丁触发 B 站篡改嗅探」，标注为 `[INFERENCE]`、未本机复现；补丁删除后问题照旧 ⇒ 那条因果链不成立。
- **判据**：区分「现象相关」与「因果」；能给出**负对照**（去掉变量后现象消失 / 保留变量时现象出现）才算根因。本轮 header 修复就是靠负对照钉死的（见 L-01 判据）。

## L-08 biliMirror 的篡改嗅探在视频页处于休眠（别再当嫌疑）

- 取证：视频页 `window.__MIRROR_CONFIG__.config` 里**没有** `isMonitorMethod`，其「方法篡改嗅探」类从未 init/startCheck；它只上报（且会把含 `extension` 的错误静默掉），不重载、不 re-init 任何组件。
- 含义：**「B 站遥测里没有痕迹」不能当作「扩展没被检测」的反证**；反过来，也别再把 header 崩溃归因到它头上。

## L-09 CDC 治理范式升级：防腐符号化与 Diff 触发器

- **问题**：早期使用 `文件:行` 做文档引用校验。行号在代码每次提交/格式化时剧烈漂移，虽然仍小于文件总行数（`docs:check` 未报错），但已发生静默语义错位（本指函数 A 却偏移到了函数 B），制造误导性伪事实。
- **改进**：
  1. **指名不指位（Names > Positions）**：`assets/agents/cdc/docs-check.mjs`（跨项目通用资产，规则数据在 `.context/rules.json`）全面支持「路径 + `#` + 符号名」的符号锚点语法（写法样例见该脚本顶部注释），并对目标文件进行标识符/符号存在性闭环校验；引用失效硬失败（退出码 1）。
  2. **Diff 驱动上下文（Triggers > Memory）**：引入 `assets/agents/cdc/context-trigger.mjs`（`npm run context:trigger`），根据 Git 变动路径自动挂载对应的声明层文档、文字测试规格及非直觉工程陷阱（The Traps），消除人工与 Agent 的记忆遗漏。
  3. **提示词收敛基准**：严格落实五问（Scope / Pointer / Tool / Skill / Trigger），L0 提示词只写代码无法自解释的工程陷阱。

## L-10 加载新评论的「回弹」：平台倒序分页 × 渲染层按时间升序 = 每页插到已读内容之上

- **现象**（用户实机反馈）：无限滚动「加载新评论时莫名回弹」，感觉被打回刚看过的位置；有时表现为「随机跳动、没有固定锚点」。
- **定性（先分 A/B，别急着改）**：物理视口回弹（`scrollY` 变小）与数据层鬼打墙（游标污染、刷出旧内容）是两条不同的病因，先让探针说话。真机三帧四点：取数前/响应帧/DOM 落定帧各取 `scrollY`、槽位与内容高度、视口中心那条评论的身份、本次新增 id 与已有 id 的交集。
- **实测结论（本机真机，探针装在宿主帧 + 嵌入帧两个 world）**：
  - `scrollY` **不动**（宿主文档只变高），槽位高度**单调不减**（2858→6136→9973→13223）⇒ **不是** A 类「宿主文档变矮 → `scrollTop` 被钳回」；
  - 数据层也没有重复：`CursorPager` 只追加、页请求逐页唯一（5 页 5 个不同游标）⇒ **不是** B 类「刷出旧东西」；
  - 真正的原因是**渲染顺序**：每取一页，新行被整块插到已读内容**之上**（实测 `insertedAbove` = 21/33/30/30，`movedOld` = 21/52/85，内容整体下移 ≈3300px），阅读器文档的 layout-shift 源就是那些行元素（累计 **1.92**）。
- **根因**：平台 `mode=2` 顶层分页按时间**倒序**返回（每页都比上一页更旧），而展示层用 `tree.ts#buildForest` 的 `roots` —— 它按 `createdAt` **升序**排序。两条拼起来：每一页都被排到最前面。于是「视口不动、内容下移一页高」= 用户说的「被打回刚看过的位置」。
- **修复**：渲染顺序改用**取回顺序**（`mergeComments` 的插入顺序 = 平台游标顺序），森林只负责层级；孤儿按森林顺序补末尾。见 ADR-0004。同批把 `READER_NAVIGATION` 的重置条件收敛到**目标身份**（URL 抖动不是换目标，见 ADR-0003 补充）。
- **判据（同一构建/同一视频/同一批真实响应/同一滚动脚本的 A/B）**：`insertedAbove`/`movedOld` 全 0；列表前 3 行身份全程不变；阅读器 CLS **1.92 → 0.06**（残余 = 页脚下移 ≤0.023 + 挂载首帧 0.026）；内容高度单调。负对照：把渲染顺序改回 `forest.roots` ⇒ 单测立刻失败（页 2 的行排到页 1 之前）。
- **探针制度（可复用，无需登录态）**：① 起专用 profile 的 Chrome（`--enable-unsafe-extension-debugging`）+ CDP `Extensions.loadUnpacked` 装 `dist/`；② 设置弹窗里打开「自绘评论区」，打开视频页、`Page.bringToFront` + `Emulation.setFocusEmulationEnabled(true)`（后台标签页不渲染，一切滚动/尺寸观测都会变成假结论）、暂停 video；③ Cookie-less 预取几页**真实**分页响应（带站点 cookie 会被截断成 3 条，见 L-06 补充），用 CDP `Fetch.enable` 按 `pagination_str.offset` 逐页喂回去；④ 两个 world 各装一套探针（宿主帧看 `scrollY`/`docHeight`/槽位高度与 `READER_*` 消息；嵌入帧看行顺序、行几何与 `layout-shift`）；⑤ 用真实滚轮事件驱动（`page.mouse.wheel`），取数发生前后各留 2.5s 观察窗口。
- **坑**：`article.comment-row` 没有 DOM id，外部只能用「行文本哈希」认行——行内文本一变（迟到的楼中楼结果改写行内计数）会被误判成「出现新行」，实测出现过一次假 `insertedAbove=1`；要更硬的观测就给行加 `data-comment-id`（尚未做，避免为观测改生产 DOM）。
- **相关位置**：`src/ui/EmbeddedComments.vue`（`merged`/`roots`/`onNavigation`/`identityOf`）、`src/core/tree.ts#buildForest`、`docs/adr/0004-reader-row-order-append-only.md`、`tests/ui/embedded-comments-reader.test.ts`（顺序 + 目标身份用例）。

## L-11 加载态的三个冷坑：渲染别听取数的、指示器要量尺寸、两条路径先对齐装配

- **A｜「加载到最后一组时突然要手动点『继续显示 N 条』」**：渲染分批（`ROW_PAGE_SIZE`）本身没问题，问题是**推进权被写进了取数状态**——`evaluateTrigger()` 先判「还有下一页 / 在途 / 失败」，再才轮到「铺开已取回的行」。于是中途滚到底会自动铺开，**到底之后**（`hasNext === false`）同一个动作却早退了。判据：让末页真的到底（把响应改写成平台真到底的形状），看页脚是否停在手动按钮上；修法是把「铺开」提到游标判断**之前**，并在到底时一次铺开（`EmbeddedComments.vue#revealAllRows`）。同类第二处：`nextRowCap()` 会在「总数临时变小」（折叠）时把上限收回去，`listRows = rows.slice(0, cap)` 随即把已铺开的尾部行移出 DOM —— 「上限只增不减」必须在函数里硬保证，不能靠调用点自觉。
- **B｜「加载中」指示其实什么都看不见**：三处占位是零尺寸的空 `<span class="spinner">` —— `base.css` 的 `.spinner` 只有 `animation: spin`，**没有几何**，转的是个空盒子。判据：量 `getBoundingClientRect().width/height`，**不要**用 `querySelector` 命中与否当验收（命中不代表可见）。正解是复用已有的图标组件（`~icons/ph/circle-notch`）并让 `.spinner` 继续管动效策略（含 `prefers-reduced-motion` 减速），别手搓第二套 SVG + 降级逻辑。
- **C｜「阅读器抓到的评论明显比完整分析少」**：先把**最终请求**对齐（两条路径其实都落到 `src/platforms/bilibili/api.ts#fetchRootPage`，参数逐项相同），再对齐**装配层**：阅读器走桥（页面上下文、同站必带站点 Cookie），完整分析走扩展源跨站直连（不带站点 Cookie），而未登录时**带 cookie 反而被平台截断成 3 条 + `is_end`**（见 L-06 补充）。所以「谁多谁少」是身份姿态的函数，不是代码 bug；另有计数口径差异（顶层+内联预览 vs roots+已抓回复）。能落地的改进是把平台的 `ANONYMOUS_LIMITATION` 送进阅读器的完整度说明（`RootsPage.limitations` → `completeness.reasons`），让用户看到「为什么只有这几条」。
- **相关位置**：`src/ui/EmbeddedComments.vue`（`evaluateTrigger`/`revealAllRows`/`identityLimitations`）、`src/ui/thread.ts#nextRowCap`、`src/core/crawl.ts#crawlRootsPage`、`tests/ui/embedded-comments-reader.test.ts`、`tests/ui/thread.test.ts`。

## L-12 复用站点自己的组件：只有主世界能驱动，且「收起」也必须带身份

需求是「复刻原版作者入口」（点头像/昵称开主页 + 悬停出小卡片），且明确「无需自己实现」。做法与踩到的坑：

- **站点自定义元素只在主世界可驱动**：`bili-user-profile`（站点自己的用户卡片，Lit 组件）定义在**页面那份**注册表里。实测：嵌入 iframe 里 `createElement('bili-user-profile')` 是空壳；**内容脚本的隔离世界**里 `customElements.get('bili-user-profile')` 也是 `undefined`、实例没有 `setup`（隔离世界有自己的注册表）。⇒ 这类「复用站点组件」的适配层必须写在**主世界**内容脚本里，隔离世界只做校验与坐标换算。
- **卡片是可驱动且免登录的**：主世界拿到元素后 `card.setup(参考元素)`（参考元素带 `data-user-profile-id`）+ 派发 `mouseenter` ⇒ 站点自己发 `GET /x/web-interface/card?mid=…`、自己渲染（昵称/关注/粉丝/获赞/签名 + 关注/发消息），实测 366×254；换人只需改属性再派发；`mouseleave` 收起；**匿名态也能出卡片**（所以真机探针不需要登录态）。「指针移到卡片上保持打开」是站点自己的 hover 延迟逻辑，我们不用管。
- **「收起」消息必须带身份**：契约里 `{type:'hide'}` 最初不带 mid，守卫按「mid 必须匹配」把嵌入页发来的收起**整条丢掉** ⇒ 真机上卡片永远关不掉，而单测全绿（因为单测自己构造的消息带了 mid）。教训：**契约的形状要由两端各自真实产出并各测一遍**；跨世界协议里「可省字段」是坑，能带就带。
- **探针环境的两个坑**：① omp `tab.run` 里的 `page.evaluate` 跑在**隔离世界**（`customElements === null`、页面全局全看不见），要读页面全局/驱动站点组件必须用原始 CDP `Runtime.evaluate`；② 站点自己的迷你播放器遮罩 `div.bili-mini-mask`（`position:fixed`、`z-index:10010`、铺满视口）会**吞掉整页指针事件**——那时阅读器（和原生评论区一样）不可交互，探针必须先把播放器还原/滚回视频处，否则会得出「悬停没反应」的假结论；③ 此环境里 `window.scrollTo` 不生效，滚页面要用真实滚轮。
- **相关位置**：`src/extension/content/user-card.ts`、`src/extension/content/page-reader.ts#forwardUserCard`、`src/ui/components/PageCommentRow.vue#hoverUser`、`src/extension/page-comments.ts`（`READER_USER_CARD` / `USER_CARD_BRIDGE_SOURCE`）、[ADR-0005](../docs/adr/0005-native-author-entries-via-site-component.md)。

## L-13 跨三个上下文的定位：三个坑与探针环境的三条事实

需求是「工作台/图谱里选中的评论，回评论区定位并闪一下」（协议见 [ADR-0008](../docs/adr/0008-locate-in-reader.md)）。真机端到端跑通之前撞了三个坑，每个都能让「代码看起来对、现象完全没有」：

- **同一个视频开着多枚标签页 ⇒ 消息投给了另一枚**：后台按**视频身份**（BV 号）在 `tabs.query` 结果里挑标签页，它不认「你正看着的那一枚」。症状是目标页毫无反应、另一枚同 URL 的标签页里安静地弹了提示。**判据**：先关掉多余的同视频标签页再测（实测：3 枚 → 1 枚后 `scrollY` 0→1521、目标行拿到 `selected`+`flash-highlight`）。这也是产品语义，不是 bug：同一视频的多个入口（页面按钮/右键/工作台）本来就该落到同一个评论位置。
- **Vue 的 `class` 绑定会重写整个 `class` 属性**：命令式 `row.classList.add('flash-highlight')` 若与「设置选中态」在同一次 patch 里，Vue 随后重写 class 属性会把刚挂的类抹掉。症状极具迷惑性——**选中态有了、闪烁没有**。**修法**：先改状态、`await nextTick()`，再摘类→强制重排→挂类（同一个类连加两次不重放动画）。
- **跨源 iframe 的 `scrollIntoView` 在 Chrome 里会把宿主文档一起滚到位**：此前不确定（阅读器在扩展源 iframe 里、宿主是 B 站页面），实测可用 ⇒ 不必自己算「嵌入文档坐标 → 宿主坐标」再改宿主 `scrollTop`（那是用户卡片那条链路的做法，因为它要摆一个绝对定位的元素，不是为了滚动）。

**探针环境的三条事实**（同一环境下多页对照会反复用到）：

1. omp `tab.run` 里 `page.evaluate` 跑在**隔离世界**：`chrome.storage` / `chrome.runtime.sendMessage` 都没有（`chrome` 是个残缺 stub）。要读/写扩展 API 得用 CDP `Runtime.evaluate`（不传 `contextId` 即主世界）；`tab.evaluate`（直接助手）也在主世界。
2. omp 的 managed tab 句柄**同时只稳一枚**：第二次 `browser.open({app})` 会让旧句柄一起指向新页。要多页对照就用 `browser.newPage()` + `page.frames()`，或者只留一枚 managed 页当「扩展页」。
3. 目标标签页必须在前台/可见：后台标签页里 CSS 过渡不推进、`requestAnimationFrame` 不触发（量到的 `grid-template-rows` 会停在起始值 0px，看着像「动画坏了」）。真机量动画前先 `Page.bringToFront`。

**相关位置**：`src/extension/page-comments.ts`（`READER_LOCATE` / `LOCATE_PENDING_KEY` / `videoIdOf`）、`src/extension/background.ts`（挑标签页 + 激活 + 转发 / 无标签页则写待办并新建）、`src/extension/content/page-reader.ts#queueLocate`、`src/ui/EmbeddedComments.vue#locateComment`、`src/ui/theme.ts#watchPalette`、[ADR-0007](../docs/adr/0007-theme-palette-tokens.md)、[ADR-0008](../docs/adr/0008-locate-in-reader.md)。

## L-14 配置项「看起来生效了」与实际生效面的距离

**现象**（该功能已按用户实机反馈整体移除）**：设置弹窗里曾有一个「放大镜门限」——文案写「评论及其回复总量超过它才出现分析入口」，实现只落在页面原生操作行那一侧；自绘评论区是另一个文档，从没接过这个值，于是自绘区的「图谱」按钮一直显示。用户读文案、看自绘区，直接判定「这属于 tooltip 和实际功能不对应」。结论是功能与设置项一并删除：原生评论行与自绘行的入口都不再按评论量判定。

- **判据**：同一个设置项有几条消费路径？动手前把「写入点」和「读取点」列全。当前存在的设置项都可以照这条核一遍——例如自绘评论区开关：写入只有一处（`ConfigPopup` → `chrome.storage.local[PAGE_COMMENTS_ENABLED_KEY]`），读取有两处（`ConfigPopup` 自己的 `storage.onChanged` 回显、隔离世界按它起停 `page-reader`），两边必须对得上。
- **修法（本轮的实际收场）**：先问「这个设置项还要不要存在」，答案往往比「把它接到第二个界面」更省事——门限功能与那条 tooltip 一起删掉，两侧入口改为不按评论量判定：原生行只要 `commentRpid` 能解析出纯数字 id 就注入放大镜，自绘行的「图谱」入口总是渲染、默认 `opacity: 0`，悬停该行或该行被选中才在行右端显现。要让一个设置项在多个界面上生效，它的口径必须能写成一句话对得上，否则先砍掉它。
- **附带教训**：tooltip 写「总量」这种含混词，用户会理解成「评论 + 全部回复」；实现里如果算的是别的量，两边永远对不上——文案要把「算不算评论自己」写死。

**同批的两个坑**：
1. **卸载钩子里访问 `chrome.*` 会抛 `ReferenceError`**：单测的 `afterEach` 先 `vi.unstubAllGlobals()` 再自动卸载组件，真实环境里是扩展重载 / 页面卸载——两处都会让 `chrome.storage.onChanged.removeListener(...)` 炸在 `onBeforeUnmount` 里，表现为一堆 `[Vue warn] Unhandled error during execution of beforeUnmount hook` + 该文件全部用例失败。修法是 `try/catch` 包住并写清理由（`theme.ts#watchPalette`、`EmbeddedComments` 的卸载钩子里那几处 `chrome.*`）。
2. **量颜色要等过渡走完**：`getComputedStyle` 读的是**过渡中间值**。切换 `data-theme` 后立刻读带 `transition: color` 的元素，拿到的是旧主题的颜色（实测 rail 激活色在深色下读成浅色值，等 450ms 后才是 `#6fd8d4`）——差点把「主题没生效」写成 bug。

**相关位置**：`src/ui/ConfigPopup.vue`（设置项的写入与回显）、`src/ui/theme.ts#watchPalette`（跨文档跟随 + 卸载钩子）、`src/ui/EmbeddedComments.vue`、`src/ui/components/PageCommentRow.vue`、`src/extension/content/injector.ts`、`tests/ui/embedded-comments-reader.test.ts`、`tests/ui/embedded-comments-write.test.ts`（chrome 桩要带 `storage.local.get` 与 `onChanged`）。
