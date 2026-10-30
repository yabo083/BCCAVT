# 测试用例库（L4 行为规格 · 只收「代码测不了」的部分）

> **本表不是测试清单的镜像。** 697 个代码测试（`npm test`）才是绝大多数行为的实现与验收；本表只留三类东西：
> ① **跨文档 / 跨世界的时序与协议**——单测只能桩掉，桩掉就等于没测（桥消息的真实 origin/source、iframe 生命周期、宿主滚动）；
> ② **真实时序竞态**——站点 SSR 水合、站点改版、扩展重载，桩出来的时序不代表真实；
> ③ **只能真机判定的观感与副作用**——滚动条、抓取量、风控退避、写的真实后果。
>
> **新增一条前先问：这条能不能用代码测试表达？能，就写代码测试，不要写进本表。**（历史上一度把 155 条行为都镜像进来，与代码测试重复且必然腐烂，已收敛。）

## 怎么用这份表

- **表说什么**：只写**可观察行为**（界面上看到什么、请求发几次、DOM 被写成什么样），不写实现断言。
- **`判据` 列**：指向真实实现（`文件:行`）或契约文档（`docs/adr/*`）——它就是「这条行为为什么必须这样」的依据。
- **AI 据表生成/更新脚本**：真机项优先写成可重复的自动化探针（见 `.context/STATE.md` 的「真机验收方法」），否则按列逐条人工执行并记录证据。
- **失败时先判因，顺序不可颠倒**：① 读 `判据` 指向的代码与 ADR，确认**规格本身**是否已变；② 规格变了 → 改这份表；③ 规格没变 → 是**代码错**，改代码。
- **禁止**：把「预期结果」改写成代码当前行为；把真机项降级成桩测试冒充已验。
- **跑法**：代码测试 `npm test`（`vitest run`，`include: tests/**/*.test.ts`）；本表不复制测试文件内容，只给契约。

## 1. 真实时序与竞态（RDR）

| ID | 场景 | 前置条件 | 操作步骤 | 预期结果 | 判据 |
|---|---|---|---|---|---|
| RDR-01 | SSR 水合真实时序下页头不消失 | 冷缓存或慢网络；扩展已装；开着替换评论区 | 打开视频页并等首屏稳定 | 顶部 header 正常；控制台**没有** `[Vue warn] There is already an app instance mounted`；`document.querySelectorAll('script[header-type="mini"]').length === 1`（`BiliHeader.init` 只跑一次） | `src/extension/content/injector.ts`（`siteMountFinished`）、`src/extension/content/page-reader.ts`（`headerSettled`）、`docs/adr/0003` |
| RDR-02 | 就绪前不投递，就绪后主题与视口各收到一次 | 阅读器已挂载 | 打开视频页，观察控制台与 iframe 收到的消息 | 就绪前没有 about:blank 源的 origin 警告；就绪后 iframe 各收到一次主题与视口消息 | `page-reader.ts`（`postToFrame` 的闸、就绪时重发） |
| RDR-03 | 单滚动条 + 长评论完整 | 已就绪；页面含长正文评论 | 滚到长评论处并观察 | 宿主页面只有一根滚动条；iframe 内部不出现滚动条；长正文不被裁切 | `page-reader.ts`（`READER_HEIGHT` → 槽位高度）、`src/ui/EmbeddedComments.vue`（`reportHeight`） |
| RDR-04 | 扩展重载/更新后的熔断 | 页面已就绪 | 在 `chrome://extensions` 重载扩展，再滚动页面 | 评论区被还原为原生；控制台只留一条可理解的警告；不再重复抛错 | `page-reader.ts`（`isExtensionContextInvalidated` → `stop`） |
| RDR-06 | 作者入口复刻原生（点击开主页 / 悬停出站点卡片） | 扩展已装、开着替换评论区；站点未改版 | ① 点阅读器里的头像或昵称 ② 悬停头像，等卡片出现 ③ 把指针移到卡片上，再移开 ④ 移开作者但仍在阅读器内 | ① 新标签打开 `https://space.bilibili.com/<mid>`；② 宿主页面出现站点自己的 `bili-user-profile`，`uid` 与悬停行一致、名字一致；③ 指针在卡片上时**保持打开**（关注/发消息可点），移开后收起；④ 卡片收起（`h=0`） | [ADR-0005](../docs/adr/0005-native-author-entries-via-site-component.md)、`src/extension/content/user-card.ts`、`src/ui/components/PageCommentRow.vue#hoverUser` |
| RDR-05 | 嵌入页首帧加载失败 | 人为让 `embedded.html` 加载失败 | 等 20s | 槽位被撤掉、原生评论区可用，并暂停自动重试直到下一次导航/开关变化 | `page-reader.ts`（`READY_TIMEOUT_MS`） |
| RDR-07 | 图谱/工作台 → 评论区定位（跨三个上下文） | 已装扩展、开着替换评论区、工作台里已有该视频的结果并选中一条评论 | 点详情卡「在评论区定位」 | ① 宿主页面滚到该行（`scrollY` 改变，行居中）；② 目标行出现 `selected` 与 `flash-highlight`；③ 目标被祖先折叠时先展开、落在渲染上限之外时先抬上限；④ 目标不在已读范围内时经 `seek_rpid` 取回它的根评论块钉在流上方（定位块：目标行 `selected` + `flash-highlight`，流序不动；评论已删除时给「不存在或已被删除」提示） | [ADR-0008](../docs/adr/0008-locate-in-reader.md)、[ADR-0009](../docs/adr/0009-located-comment-pinned-block.md)、`EmbeddedComments.vue#locateComment`、`page-reader.ts#flushLocate` |
| RDR-10 | 行内操作：点踩 / ⋯ 菜单 / 正文链接 | 已登录、阅读器已出若干行 | ① 点踩 → 按钮实心、赞过的评论赞态被撤（计数回落），失败回滚+notice；② ⋯ → 「复制评论链接」写剪贴板 `${url}#reply<id>`，「加入黑名单」两段确认（不透明菜单面），「举报」开对话框选理由（其他须填备注，不提交则不发请求），「删除」只对自己的评论出现且需二次确认、成功后该行连同子树消失；③ 正文 @提及 / jump 关键词 / 裸 http(s) URL 渲染为可点链接（新标签打开） | `EmbeddedComments.vue#toggleDislike/#deleteComment/#copyCommentLink/#blockUser/#reportComment`、`PageCommentRow.vue`、`reader-comments.ts#blockIntent/#reportIntent`、`page-comments.ts#isReaderWriteRequest`、`src/platforms/bilibili/api.ts#blockUser/#reportComment`、`comment-text.ts#tokenizeComment` |
| RDR-11 | 评论区默认排序设置 | 弹窗可见 | 弹窗「评论区排序」分段控件（最热|最新）写 `loupe.reader.defaultOrder`；默认开（hot）；只对下一次打开的阅读器生效 | `ConfigPopup.vue`、`page-comments.ts#READER_DEFAULT_ORDER_KEY` |
| RDR-09 | 排序切换「最热 \| 最新」换数据集 | 阅读器已加载 ≥2 页 | ① 点「最新」→ `mode=2` 请求，行整批替换、第一行是最新评论；② 点回「最热」→ **0** 新请求（热度序按「会话 + 块号」成链，整链命中缓存）；③ 再点「最新」→ 0 请求；④ 在「最新」滚 2 页 → 只有 `mode=2` 请求且行只追加 | [ADR-0004](../docs/adr/0004-reader-row-order-append-only.md) 补充、`EmbeddedComments.vue#switchOrder`、`crawl.ts#loadHotRootsPage` |
| RDR-12 | 最热读到底的完整度与数字口径 | 已登录、阅读器默认「最热」 | 一路滚到「没有更多评论了」 | ① 徽章是**完整**，不是「不完整」；② 顶栏与列表头都显示平台声明总数（如 191），不显示「条目数 108」；③ 气泡说明「平台声明 N 条（含楼中楼的全部回复）；顶层 M 条根评论已全部取回，楼中楼按需展开」 | `EmbeddedComments.vue#completeness`、`EmbeddedComments.vue#commentCount` |
| RDR-14 | 距底一屏预取 | 已登录、阅读器加载 ≥2 页、列表还有下一页 | 慢慢往下滚，在离底部还有约一屏时停下观察网络 | 下一页请求在**进入到底区之前**就发出（`READER_VIEWPORT` 带 `viewportHeight`）；视口高度未知时退回 480px 提前量；仍然每页只取一次、同段到底区不重复触发 | `EmbeddedComments.vue#prefetchMargin`、`page-reader.ts#postViewport` |
| RDR-16 | 首屏不等评论树 | 清空缓存后第一次进视频 | 打开视频页、滚到评论区，掐首行出现时间 | 首行 ≈ 2–3 秒出现，期间只有 `nav` / `view` / `wbi/main` 各一次，**没有 `detail`**；展开某条评论的回复时才发 `detail` | `report.ts#CrawlOptions`（`includeThreads`）、`crawl.ts#crawlRootsPage`、`EmbeddedComments.vue#fetchPage` |
| RDR-15 | 分层 TTL：旧区间不该跟首屏同寿命 | 同一视频滚完「最新」多页 | 在 DevTools → Application → IndexedDB `loupe` → `entries` 里看 `expiresAt` | 首屏键（`…|roots|time|start`、`…|thread|<id>|start`）约 30 分钟；更深页（`…|roots|time|<cursor>`、`…|thread|<id>|<cursor>`）与热度序块/走完的链记录约 12 小时 | `src/core/cache/types.ts#FRESHNESS_TTL_MS`、`crawl.ts#loadRootsPage` |
| RDR-13 | 平台 412 限流：冷却可视化 + 自动重试 | 人为让 `wbi/main` 返回 412（或连续快速滚动触发） | 停在列表底部等 | ① 页脚/顶部显示「平台限流 · N 秒后自动重试（不是登录失效…）」而不是干巴巴的「加载失败」；② 到点自动重试并继续加载，无需手动点；③ 连续 4 次仍被限流则只留「重试」按钮，不再自动打 | `EmbeddedComments.vue#noteRateLimited`、[ADR-0010](../docs/adr/0010-shared-rate-limit.md) 2026-10-30 修订 |
| RDR-08 | 定位的反例：同一视频开着多枚标签页 | 同一视频 URL 开着 ≥2 枚标签页 | 从工作台点「在评论区定位」 | 消息投给后台挑中的那一枚（按视频身份，不认「当前可见」），另一枚不动——这是已知语义，不是 bug | `.context/LESSONS.md` L-13、ADR-0008 |

## 2. 注入时序与站点改版（INJ）

| ID | 场景 | 前置条件 | 操作步骤 | 预期结果 | 判据 |
|---|---|---|---|---|---|
| INJ-01 | 负对照：水合前写页面 DOM 会毁掉页头 | 可控地把一个 `.loupe-host` 在水合前插进 `.video-toolbar-right` | 打开视频页并等首屏 | `BiliHeader.init` 跑 **2** 次、`#biliMainHeader` 变空 —— 这正是修复要避免的状态（用它证明门确实在起作用） | `.context/LESSONS.md` L-01、`injector.ts`（两道门） |
| INJ-02 | 站点改版时静默不注入 | 把工具栏/评论组件的类名改掉（DevTools 模拟改版） | 打开视频页 | 不注入、不抛错、不写任何页面节点；原生评论区照常可用 | `src/extension/content/targets.ts`（结构探测，不认易变 id） |
| INJ-03 | 真实分批渲染下的稳定观察 | 打开视频页，`DIAGNOSTICS = true` 构建 | 观察 `[loupe]` 日志 | 视频按钮只在操作行连续多轮不变后出现；导航后重新观察，不抢在水合中写 DOM | `injector.ts`（`VIDEO_STABLE_SCANS` / `resetVideoStability`） |

## 3. 滚动、高度与抓取量（SCROLL）

| ID | 场景 | 前置条件 | 操作步骤 | 预期结果 | 判据 |
|---|---|---|---|---|---|
| SCROLL-01 | 视口通道为主、哨兵只是兜底 | 登录态；一个评论较多的视频 | 慢慢滚到接近列表底部 | 取下一页；**无论哨兵 IO 是否交付**都必须取到（跨源 iframe 的 IO 交付不可靠） | `EmbeddedComments.vue`（`evaluateTrigger`）、`docs/adr/0003`「遗留」 |
| SCROLL-02 | 到底之后零请求 | 已翻到最后一页（页脚显示「没有更多评论了」） | 再反复滚到底 4 次 | 桥请求数**不再增加**；高度上报次数不再增加 | `src/ui/infinite-scroll.ts`（`hasNext = next !== null`） |
| SCROLL-03 | 高度只增不减（端到端） | 同上，记录 `slot.style.height` 与 `scrollY` 时间序列 | 整个滚动会话 | 槽位高度单调不减；`scrollY` 不出现「因槽位变矮被打回」的回跳（站点自身的平滑回顶需单独排除） | `EmbeddedComments.vue`（`reportHeight(allowShrink)`）、`.context/LESSONS.md` L-02/L-04 |
| SCROLL-04 | 抓取量对照：阅读器 vs 完整分析 | 登录态；同一视频 | ① 阅读器滚到底记录顶层评论条数 ② 用放大镜开工作台跑完整分析 | 两者条数应当一致；若阅读器明显更少，即「抓取不完整」待办的复现判据 | `roadmap.md`「待办 1」、`src/core/README.md`（游标分页契约） |
| SCROLL-05 | 取下一页不打回已读位置（行序 = 取回顺序） | 一个评论较多的视频；分页请求可用（登录态，或按 `.context/LESSONS.md` L-10 用探针喂真实响应） | 滚到底触发取下一页，重复 3–5 页 | ① 已渲染行的顺序与几何全程不变，新行只出现在列表**末尾**；② 阅读器文档的 `layout-shift` 条目里**不出现**行元素（`article.comment-row`/`.thread-lines`）；③ `scrollY` 单调不减 | `EmbeddedComments.vue#roots`、`.context/LESSONS.md` L-10、[ADR-0004](../docs/adr/0004-reader-row-order-append-only.md) |
| SCROLL-06 | URL 抖动不重置已读的页 | 阅读器已加载 ≥2 页 | 让站点自己写 URL（带 `?spm_id_from` 打开、站内切推荐、改锚点） | 桥请求**不再**从游标起点重取；列表不被清空；高度不上报更小的值 | `EmbeddedComments.vue#onNavigation`、ADR-0003 的 2026-10-14 补充 |
| SCROLL-07 | 到底之后不再分批（不留手动「继续显示」） | 已翻到最后一页（页脚显示「没有更多评论了」），且已取回行数超过一批 | 滚到列表底部；再折叠/展开一条大评论树 | 剩下的行**自动**铺开；全程不出现「继续显示 N 条」；加载态切换（图标出现/消失、状态文案改字）**不改变顶栏与页脚高度** | `EmbeddedComments.vue#revealAllRows`、`thread.ts#nextRowCap`、`roadmap.md`「无限滚动 UX 收尾」 |

## 4. 抓取与网络（CORE）

| ID | 场景 | 前置条件 | 操作步骤 | 预期结果 | 判据 |
|---|---|---|---|---|---|
| CORE-01 | 登录态能翻过匿名上限 | ① 匿名 ② 登录态，同一视频 | 各滚到底 | 匿名时 `completeness.reasons` 出现 `ANONYMOUS_LIMITATION` 且抓取量停在约 315 条；登录态能继续翻页 | `src/platforms/bilibili/api.ts`（`ANONYMOUS_LIMITATION`）、`page-reader.ts` 桥注释 |
| CORE-02 | 真实风控退避 | 连续快速滚动触发限流 | 观察进度与耗时 | 出现「平台限流，退避等待中…」；等待时长与平台 `Retry-After` 一致；恢复后不放大抖动 | `src/core/crawl.ts`（`withRetry` / `PoliteQueue`） |
| CORE-03 | DNR 请求头改写真的生效 | 已装扩展 | 打开 Network 面板看扩展自身发出的 api 请求 | 带扩展形态的 `Origin`/`Referer`；缺规则时平台返回 `-403` 类错误 | `src/extension/background.ts`（`initiatorDomains: [chrome.runtime.id]`） |
| CORE-04 | 缓存跨会话生效 | 已抓过一次同一视频 | 关闭再打开该视频页 | 首屏不再重复请求已有分页（命中缓存）；登录态变化时**不得**复用匿名的页缓存 | `src/core/crawl.ts`（页缓存键 + 账号隔离） |
| CORE-05 | 工作台与阅读器共用一份存储（身份分键） | 登录态；同一视频先在放大镜窗口跑过完整分析 | 打开该视频页的阅读器滚前两页 | 已抓过的页不再回源（IDB 里同一组 `u:<mid>` 页键被两边共用）；`session` 与 `nav` 键按身份姿态分开（`*|page` / `*|direct`）互不覆盖 | `src/ui/services.ts#readerWorkbench`、`workbench.ts#loadSession`、`api.ts#loadNavData` |
| CORE-06 | 跨文档同键单飞（Web Locks） | 同一视频同时开着阅读器与工作台 | 两边几乎同时触发同一页取数 | 平台只收到一次该页请求；另一边按磁盘命中返回 | `src/core/cache/index.ts#getOrLoad`（`locks.request`）、ADR-0009 |

| CORE-08 | 共享令牌桶限速 | 工作台全量分析进行中 | ① 同时开阅读器翻页 → 总请求率 ≤ burst + rate·t；② bulk 只在水位 ≥1+reserve 时取令牌，interactive 总能拿到；③ 注入一次 rate-limited → 全文档共享 30s 冷却，重试不早于冷却结束；④ 中断全量后 10min 内重跑 → 已抓页命中，只补缺页 | src/core/rate-limit.ts、crawl.ts worker 池与 crawl-run 检查点、ADR-0010 |
| CORE-07 | 定位未读评论端到端 | 工作台选中一条不在已读范围内的评论 | 点「在评论区定位」 | 评论流上方出现定位块（标题「定位到的评论」+ 根评论块）；目标行居中闪烁；主流行序不变；点 × 关闭块并允许缩高 | `workbench.ts#runLocate`、`src/platforms/bilibili/index.ts#seekRoot`、`EmbeddedComments.vue#locateComment`、ADR-0009 |

## 5. 写操作的真实后果（WRITE）

| ID | 场景 | 前置条件 | 操作步骤 | 预期结果 | 判据 |
|---|---|---|---|---|---|
| WRITE-01 | 真实点赞生效且与原生一致 | 登录态 | 在自绘评论区点赞，切回原生评论区看计数 | 平台侧计数变化；失败时自绘区回滚并提示 | `src/extension/content/reader-writes.ts`、`src/platforms/bilibili/api.ts`（`likeComment`） |
| WRITE-02 | 真实回复/发表出现在原生评论区 | 登录态 | 回复一条评论、发一条顶层评论 | 刷新后原生评论区能看到这两条；自绘区不重复显示 | `api.ts`（`replyComment`）、`EmbeddedComments.vue`（`mergeComments` 去重） |
| WRITE-03 | 凭据不跨桥（真机可查） | 登录态 | 打开 Network 面板与 iframe 的消息流 | 写请求体里有 csrf，但桥消息、扩展页存储、日志里都**没有** csrf | `reader-writes.ts`（写的那一刻现读）、`.context/LESSONS.md` |

## 6. 主题与配色（THEME）

| ID | 场景 | 前置条件 | 操作步骤 | 预期结果 | 判据 |
|---|---|---|---|---|---|
| THEME-01 | 配色跨文档即时生效 | 已装扩展、开着替换评论区；工作台（或 `app.html`）已打开 | 在**设置弹窗**里换一个配色（顶栏已无色点）/ 改取色器 | 工作台与**已打开的** B 站页阅读器同时换色（两个文档的 `html[data-palette]` 与 `getComputedStyle(html).getPropertyValue('--accent')` 一致），**无需刷新**；重开页面仍是该配色 | [ADR-0007](../docs/adr/0007-theme-palette-tokens.md)、`theme.ts#watchPalette`、`tokens.css` 的 `data-palette` 段 |
| THEME-02 | 明暗与配色正交 | 同上 | 先选一套配色，再切明暗；或先切明暗再选配色 | 两种顺序结果相同（`data-theme` 与 `data-palette` 互不覆盖）；中性色阶只随明暗变，accent 系只随配色变 | [ADR-0007](../docs/adr/0007-theme-palette-tokens.md)、`tokens.css` |

## 7. 图谱窗口（GRAPH）

| ID | 场景 | 前置条件 | 操作步骤 | 预期结果 | 判据 |
|---|---|---|---|---|---|
| GRAPH-01 | 弹窗居中 + 首帧就量尺寸、收敛后校准 | 已装扩展、开着替换评论区 | 从阅读器点某行的「图谱」 | 弹窗开在当前窗口中心、初始 ~960×660；挂载后首帧（120/420/900ms 三拍）就按内容包围盒调过一次，图收敛后再校准一次（小图收到下限 ~707×524），之后不再变；与上次尺寸相差 ≤8px 不动窗口；手动拖过/改过大小后不再被改；工作台标签页尺寸不受影响 | `src/extension/open-panel.ts#openGraphPopupWindow`、`src/ui/views/GraphPopupView.vue#fitNow` |
| GRAPH-02 | 雷达波闪两下即停、适配视图时重播 | 弹窗已收敛 | ① 观察选中节点 ② 点工具栏「适配」/按 `0` 或 `f` | ① 选中后波纹**恰好播两下**（≈2.8s）就静止，静止后仍能看出选中（静态描边）；② 每次适配视图重播两下 | `src/ui/force-graph.ts#radarPing`、`src/ui/components/ForceGraph.vue#replayPulse`、[ADR-0006](../docs/adr/0006-reader-spine-geometry.md) |

## 8. 工作台布局与阅读器观感（LOOK）

| ID | 场景 | 前置条件 | 操作步骤 | 预期结果 | 判据 |
|---|---|---|---|---|---|
| LOOK-01 | 阅读器底色随宿主主题（不自绘） | 已装扩展、开着替换评论区 | 分别在浅色与深色的 B 站页面打开阅读器 | 阅读器文档与根元素的计算背景都是 `rgba(0, 0, 0, 0)`（浅色会话与深色会话各测一次），宿主评论区自己的底色直接透上来、没有浅色块残留；深色宿主下阅读器 `data-theme=dark`、正文用深色系 `--fg`（实测 `#e7edeb`） | `src/ui/embedded.html`、`src/ui/EmbeddedComments.vue#reader`、`src/extension/content/page-reader.ts#detectHostTheme` |
| LOOK-02 | 自绘行的「图谱」入口默认隐藏、悬停或选中才显现 | 已装扩展、开着替换评论区、列表已铺开 | ① 不碰鼠标看某一行；② 鼠标悬停该行；③ 用工作台/图谱定位选中该行 | ① 入口计算 `opacity` 为 `0`（不可见、不占版面）；② 悬停后为 `1`，位置在**行右端**；③ 被选中行同样显现；实现在 `.analyze` 与其 `:hover`/`.selected` 规则上 | `src/ui/components/PageCommentRow.vue#analyze` |
| LOOK-03 | 顶栏运行/提示条不推动中段 | 已装扩展、打开工作台并开始一次抓取 | 让状态文案变长变短（或用一条很高的假状态条做压力测试） | 中段那一排（左 rail / 画布 / 右侧详情）全程不动：`.topstack` 顶边恒为 68px、`.dock` 顶边恒为 92px；状态条自身计算 `position: absolute`，只它自己变高变矮 | `src/ui/App.vue#topstack` |
| LOOK-04 | 两侧浮岛按内容自适应高度 | 已装扩展、打开工作台 | ① 收起/展开左侧 rail 与输入面板；② 收起/展开右侧详情 | 浮岛高度就是内容高度、不贯通整段中段：`.dock` 实测 rail 收起态 ~371px、输入面板 ~422px（展开抓取选项后 ~563px）、AI 面板收起 ~384px，超出中段上限才由内部滚动；详情收起态 32×104、展开后按内容（实测 ~154px） | `src/ui/App.vue#dock`、`src/ui/App.vue#detail-panel` |
| LOOK-05 | 图谱弹窗首帧就量尺寸 | 已装扩展、开着替换评论区 | 从阅读器点某行的「图谱」，从开窗起连续观察窗口尺寸 | 开窗 ~150ms 内即按内容调过一次（实测 ≈947×624，即 960×660 去掉边框），仿真收敛后再校准一次并稳定（小图收到 clamp 下限 ~707×524），之后不再变 | `src/ui/views/GraphPopupView.vue#fitNow`、`src/extension/open-panel.ts#openGraphPopupWindow` |
| LOOK-06 | 「输入」面板瘦身与折叠摘要 | 已装扩展、打开工作台 | ① 看「输入」tab 默认形态；② 展开「抓取选项」并改刷新方式/上限 | ① 只有输入行 + 一句隐私提示 + 一行「抓取选项」摘要 + 最近快照，没有「快速开始」卡片、没有「自绘评论区」开关；② 展开后是两列紧凑网格，摘要行右侧实时跟着变（实测 `全量回源 · 顶层/单树 不限`，单行不截断） | `src/ui/views/TargetView.vue#optionsSummary`、`src/ui/components/CrawlOptionsPanel.vue`、`src/ui/prefs.ts#limitsSummary` |
| LOOK-07 | 收起详情的胶囊书签 | 已装扩展、打开工作台（无选中评论） | 看右缘的收起把手，并悬停 | 是一枚 32×104、仅左侧圆角、半透明玻璃 + 18px 模糊的竖向书签，**顶边与展开态对齐**（实测都是 top 92）、贴右缘，文案「详情」二字竖排；悬停左移 4px 且转主色 | `src/ui/App.vue#detail-handle` |
| LOOK-08 | 设置面板的布尔项是开关 | 已装扩展、点扩展图标 | 看「自绘评论区」并点击 | 控件是 `appearance: none` 的 34×20 胶囊开关（不是系统复选框）：关 = `--surface-3` 轨道，开 = `--accent` 轨道 + `--fg-on-accent` 滑块；点击即写存储且回显 | `src/ui/styles/base.css#switch`、`src/ui/ConfigPopup.vue` |
| LOOK-09 | 面板内部不再「卡片套卡片」（AI 与历史 tab） | 已装扩展、打开工作台 | 依次看「AI」「历史」两个 tab 的默认形态与展开形态 | `.dock-scroll` 里 `.card` 数为 **0**；AI 设置默认收成一行摘要（`AI 设置 [未授权] 模型名`，展开后才是表单，`启用 AI 解读` 是开关）；「评论区解读」「评论树诊断」「历史快照」「缓存」用 13px 分区标题 + 一条细线分节；空状态是一行左对齐说明；快照列表是细分隔线列表行（不是一行一个盒子）；AI 面板收起态实测 ~384px | `src/ui/views/AiPanel.vue#settingsSummary`、`src/ui/views/HistoryView.vue` |
| LOOK-10 | 浮岛元素位置在状态切换时不动 | 已装扩展、打开工作台 | ① 展开/收起左侧内容面板；② 展开/收起右侧详情 | 左侧六个 tab 的顶边在任何状态下都不变（实测 101/161/220/280/340/399，四种状态逐一对齐）；右侧详情与收起把手的**顶边恒为 92px**、右边缘也恒定——切换只换形态与宽度，不产生位移 | `src/ui/App.vue#rail`、`src/ui/App.vue#detail-panel` |

## 相关

- 工程约定与路由：`AGENTS.md`
- 决策：`docs/adr/0003-reader-infinite-scroll.md`、`0002-platform-adapter-seam.md`、`0001-single-extension-no-backend.md`
- 记忆：`.context/LESSONS.md`（根因与判据）、`.context/STATE.md`（真机验收方法）
- 模块上下文：`src/core/README.md`、`src/extension/README.md`、`src/ui/README.md`
- 术语：`docs/domain-glossary.md`
