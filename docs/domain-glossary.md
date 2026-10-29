# 领域术语表（防幻觉）

> 只收「同一概念在代码/文档/对话里出现多种叫法」或「容易想当然」的词。术语与代码符号不一致时，以本表为准。
> 加词规则：一行一个，给「含义」与**代码位置**；没有代码位置的概念不进表。

| 术语 | 含义 | 代码位置 |
|---|---|---|
| 主体 / Subject | 评论区的归属物（B 站：视频、动态、番剧等）；分析、快照、缓存都以它为单位 | `src/core/model.ts`（`SubjectRef` / `Subject`） |
| 顶层评论 / root | 不属于任何回复的评论（`rootId === null`）；分页单位就是它 | `src/core/model.ts` |
| 楼中楼 / reply | 回复（`rootId` 指向所属顶层评论，`parentId` 指向被回复者；平台恒声明 0 条回复） | `src/core/model.ts` |
| 评论树 / thread | 一条顶层评论 + 它下面的所有回复；按需抓取，单树有上限 | `src/core/crawl.ts`（`crawlThreadPages`） |
| 游标 / cursor | 平台给的「下一页」凭证；`null` = 第一页；**平台返回 `next === null` 才是「到底」** | `src/core/model.ts`（`Page.next`）、`src/core/crawl.ts` |
| 快照 / snapshot | 一次完整抓取的可复用结果，带 `schema` 与完整性声明；复用要过身份/范围/上限/刷新四道闸 | `src/core/report.ts`、`src/core/workbench.ts`（`canReuseSnapshot`） |
| 预览 / preview | 阅读器/图谱窗口的有限抓取：**不落快照、不写历史** | `src/core/workbench.ts`（`previewSubject` / `previewRootsPage` / `previewThread`） |
| 承载面 / surface | UI 的四种落地：`panel`（工具栏弹窗）、`tab`（完整工作台）、`graph`（独立图谱窗口）、嵌入式阅读器（iframe） | `src/ui/surface.ts`、`src/ui/{main,config,embedded}.ts` |
| 槽位 / slot | 宿主页面里承载阅读器 iframe 的容器；高度完全由嵌入页上报 | `src/extension/content/page-reader.ts`（`SLOT_*`） |
| 已提交高度 / committed height | 已上报给宿主的槽位高度**下界**：只在变大或结构性缩高事件时才下调，用于根治回弹 | `src/ui/EmbeddedComments.vue`（`reportHeight`） |
| 到底区 / load zone | 「快滚到列表末尾」的判定区；由**边沿**触发（`armed`），不是每条视口消息都触发 | `src/ui/EmbeddedComments.vue`（`evaluateTrigger`） |
| 水合门 / site mount gate | 「window load + 文档里再无 `data-server-rendered`」两道门：过门之前不写页面 DOM | `src/extension/content/injector.ts`（`siteMountFinished`） |
| 意图 / intent | 写操作跨桥的请求（点赞/回复/发表）；结果按 `requestId` 回投 | `src/ui/reader-comments.ts`、`src/extension/content/reader-writes.ts` |
| 礼貌队列 / PoliteQueue | 每平台一个的请求队列：并发上限 + 相邻请求最小间隔（名额先占后用、可转让） | `src/core/crawl.ts` |
| 渲染批次 / rowCap | 一次最多铺开多少行（只增不减）；与取数状态机**解耦** | `src/ui/thread.ts`（`ROW_PAGE_SIZE` / `nextRowCap`） |
| 隔离世界 / isolated world | 内容脚本的默认世界（能访问 `chrome.*`，读不到页面 JS 对象）；主世界反之 | `src/extension/manifest.ts`（`content_scripts.world`） |
