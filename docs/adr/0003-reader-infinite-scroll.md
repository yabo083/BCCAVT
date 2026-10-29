# ADR-0003: 页面评论阅读器的无限滚动契约（游标状态机 + 哨兵触发 + 已提交高度不缩）

## 日期
2026-10-12

## 状态
accepted

## 背景
「页面评论区替换」把自绘阅读器以 iframe 挂进 B 站视频页原位：**iframe 高度 = 内容高度**（嵌入页上报 `READER_HEIGHT`，宿主把槽位 `style.height` 设成它），**滚动条只有宿主页面那一根**，嵌入页自己永不滚动、不做窗口化。实机反馈三个 bug：**回弹**（内容变矮 → 宿主文档变矮 → 浏览器把 `scrollTop` 钳回）、**重复加载**、**达到尽头时还在回弹**。

旧实现的三处结构性缺陷（已实测确认）：

1. **分页是「重跑全量抓取」而不是「追加下一页」**：`loadMore()` → `load('cache-first', true, visibleRoots + 20)` 每次都重跑一遍 `previewSubject`（游标从起点重放、`maxRoots` 递增）并整体替换 `result`。限流场景下中段失败会让整条链从头重放（与 tkdodo 记录的 infinite query 经典 bug 同形）。
2. **「到底」由客户端算术推断**：`exhausted = forest.roots.length < visibleRoots`。平台「请求 20 条只回 3 条」与「真的没有下一页」不可区分；而权威判据 `page.next === null`（`crawl.ts` 的循环退出条件）根本没被 UI 用上，一旦误判就永久早退。
3. **高度上报构成回弹闭环**：`reportHeight()` 用 ResizeObserver 即时量、即时写宿主槽位高度；高度回落（异步落定、结果替换、渲染上限变化）→ 宿主文档变矮 → `scrollTop` 被 CSSOM View 的钳位公式打回 → 观感即「回弹」。仓里那个「行数没减少时高度只增不减」的补丁是事后遮盖，不是结构性保证。

## 决策
把这条链拆成三层，每层只解决一件事：

- **取数（状态机）**：持有服务端游标，`hasNext = (next !== null)`；单一在途守卫 `hasNext && !inFlight`；失败保留游标（从失败那页继续，不重放整条链）；**只追加**（append-only），换目标才 `reset()`。到底由服务端游标判定，不由客户端算术推断。
- **触发（状态翻转）**：列表尾部放哨兵 + `IntersectionObserver`（**省略 `root`**，即 implicit root = 顶层视口）。宿主 `READER_VIEWPORT` 消息保留为兜底触发，但必须做成**边沿触发**（`armed` 状态：只在「进入到底区」那一次触发），不得回到「每条视口消息都试一次」。
- **高度（结构性下界）**：维护「已提交高度」，**只在确认变大或明确的缩高事件（折叠切换、换目标/重置）时才允许写更小的槽位高度**；上报必须发生在 DOM 更新之后（`nextTick`）且幂等。已渲染行上限只增不减。

## 依据（关键外部事实，全部有规范/官方文档出处）

- **跨源 iframe 里 IntersectionObserver 可用**：implicit root 的合法 target 包含嵌套浏览上下文里的元素，宿主窗口滚动会驱动嵌入页回调（[IO 规范](https://w3c.github.io/IntersectionObserver/)、[web.dev](https://web.dev/articles/intersectionobserver)）。交集矩形跨文档逐级裁剪，浏览器已经替我们算好「宿主视口」语义。
- **跨源目标上 `rootMargin` / `scrollMargin` 被忽略、`rootBounds` 为 `null`**（[IO 规范](https://w3c.github.io/IntersectionObserver/)）⇒ 「提前 N px 加载」不能靠 `rootMargin`，必须做进哨兵自身几何；回调里只能信 `isIntersecting` 布尔。
- **回弹的规范根源**：`scrollTop` 上限 = 滚动区高 − 视口高（[CSSOM View](https://drafts.csswg.org/cssom-view/)）⇒ 槽位变矮就会把人打回上方；且宿主侧 scroll anchoring 在本场景双重失效（anchor node 只能是 iframe 盒子、高度从底边变化不动其 block-start；写 `height` 又命中 SANACLAP 抑制表，[CSS Scroll Anchoring](https://drafts.csswg.org/css-scroll-anchoring/)）⇒ **只能靠「已提交高度不缩」根治**，不能指望浏览器补偿。
- **成熟库的状态机形状**：`hasNextPage` / `isFetchingNextPage` / `fetchNextPage` / 错误可重试，且「单飞 + 只追加」是硬约束（[TanStack Query Infinite Queries](https://tanstack.com/query/latest/docs/framework/react/guides/infinite-queries)、[tkdodo《How Infinite Queries work》](https://tkdodo.eu/blog/how-infinite-queries-work)、[Relay pagination](https://relay.dev/docs/guided-tour/list-data/pagination/)、[SWR pagination](https://swr.vercel.app/docs/pagination)）。
- **UI 契约**：加载中 / 到底 / 后台刷新三种状态分开呈现，到底用文案而不是「控件消失」（TanStack 示例、react-infinite-scroll-component 的 `endMessage`、Ant Design List 的 `loading`/`loadMore`）。

## 后果
- 正面：到底态唯一且可解释；同一次会话同一页不会被请求两次（守卫在状态机里，与触发源无关）；内容只增不减（除折叠/换目标这类显式事件），宿主 `scrollTop` 不再被无故钳回；「加载更多」不再重放整条游标链，限流下也不会反复撞同一堵墙。
- 负面 / 代价：多一个纯逻辑模块与它的单测；哨兵在跨源场景下拿不到 `rootBounds`，提前量只能靠几何近似（提前量本身不再是精确像素语义）。
- 遗留：`IntersectionObserver` 在部分环境（后台/被节流的标签页、某些嵌入式环境）回调交付不稳定，因此兜底的视口消息通道**必须**保持可用——这也是「边沿触发」必须写在嵌入页侧的原因。

## 备选方案（关键）
- **继续手算「内容高度 − 固定像素」阈值**：阈值绑在可变的内容高度上，且 `contentHeight` 是「已渲染行上限」的底部而非列表末尾；滚动位置不动时不再有第二条信号，天然会卡死 → 放弃。
- **把「不缩」做成宿主侧 `max(旧高, 新高)`**：会让所有回落（异步落定、结果替换）在宿主侧留下多余空白，观感即「到底了还在回弹」；且宿主不知道哪次缩高是合法的 → 放弃，改为嵌入页按结构事件显式声明。
- **虚拟列表（定高窗口化）**：长正文会被截断或需要测量高度，与本模块「长评论完整呈现、绝不为了定高而截断」的既有决定冲突 → 放弃。

## 补充（2026-10-14）：重置触发条件按「目标身份」判定

原实现里「换目标才 `reset()`」这条契约没有落到触发点：后台对 `chrome.tabs.onUpdated` 的**任何** `changeInfo.url`（含站点自己的 `history.replaceState`：`?spm_id_from` / `?vd_source` / 锚点）都发 `READER_NAVIGATION`，嵌入页收到就无条件 `resetTarget()`。后果是**同一类回弹里唯一真正的宿主文档缩高路径**：已读的页全丢、列表退回第一页，并且按空内容重新提交槽位高度（缩到 `MIN_CONTENT_HEIGHT`）→ 宿主文档变矮 → CSSOM 把 `scrollTop` 钳回。

补充决策：`onNavigation()` 先向后台解析一次规范地址，用**目标身份**（`平台:类型:主体 id`，见 `src/ui/EmbeddedComments.vue#identityOf`）与当前取数目标比对，相同就只更新地址、什么都不重置；解析失败（后台暂不可用）则不动。真的换视频才走结构性缩高路径（`reportHeight(true)` 允许提交更小的值）。

判据（可复现）：单测里发一条 `READER_NAVIGATION`——身份相同 ⇒ 请求序列与高度上报序列**完全不变**；改主体的规范地址 ⇒ 多出一次「从游标起点重取」并在随后上报一次更小的高度。把 `onNavigation` 退化成无条件 `resetTarget()` 时，这两条断言立刻失败（负对照）。

### 同批落实的两条渲染纪律（2026-10-14）

- **「已渲染行上限只增不减」在函数里硬保证**：`src/ui/thread.ts#nextRowCap` 原来在 `cap >= total` 时返回 `total`（收回去）。而 `listRows = rows.slice(0, cap)`，上限一缩就把已经铺开的尾部行移出 DOM（内容变矮、槽位高度又不缩 ⇒ 底下留白，用户看到行凭空消失）。折叠让总数临时低于上限、再展开时立刻咬人。
- **到底之后不再分批**：平台不再给下一页游标时，一次铺开剩余行（`src/ui/EmbeddedComments.vue#revealAllRows`），并把「铺开已取回的行」提到取数状态判断之前（`#evaluateTrigger`）。否则中途滚到底自动铺开、到底之后反而要手动点「继续显示 N 条」——同一动作两种行为。

