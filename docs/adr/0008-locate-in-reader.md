# ADR-0008: 工作台 / 图谱 → 评论区的「定位到这条评论」

## 日期
2026-10-14

## 状态
accepted

## 背景
同一条评论在界面上有两个落点：**工作台 / 图谱窗口**（全量分析，独立标签页或 popup）与**页面评论区的自绘阅读器**（B 站视频页里的 iframe，见 ADR-0003/0004）。用户在图谱里挑中一条评论后，自然动作是「回到那条评论在评论区的位置看看上下文」。

两个落点之间有三重隔离：①阅读器跑在扩展源 iframe 里，**另一个文档**；②工作台/图谱是另一个标签页（甚至另一个窗口）；③两侧数据**不是同一份**——阅读器只按用户滚动逐页取顶层评论（可能只有前几页），工作台是全量。

同时阅读器自己的行可能是**不可见**的：目标可能被某个祖先的折叠藏起来，也可能落在渲染上限（`rowCap`，一批 `ROW_PAGE_SIZE` 行）之外。

## 决策
**三层转发 + 一个待办存储键，定位语义由阅读器自己承担。**

1. **协议三层**（每一层各守一个信任边界）：
   - 工作台 → 后台：`runtime.sendMessage({ type: LOCATE_COMMENT, input, commentId })`（`messages.ts`）。
   - 后台 → 视频页内容脚本：按 `input` 里的 BV 号在已打开的 B 站视频标签页里挑一枚（`tabs.query` + `videoIdOf` 比对，host 权限已覆盖，不需要 `tabs` 权限），`tabs.update({active:true})` 激活它（跨窗口才 `windows.update({focused:true})`），再 `tabs.sendMessage(tabId, { type: LOCATE_COMMENT, … })`。**没有已打开的标签页**就把这次定位写进 `chrome.storage.local[LOCATE_PENDING_KEY]`（带 `nonce`）再 `tabs.create` 打开该视频页。
   - 内容脚本 → 嵌入页：`postToFrame({ source: READER_BRIDGE_SOURCE, type: READER_LOCATE, commentId })`（`page-comments.ts`）。
2. **待办定位用 `storage.local` 而不是 `storage.session`**：`storage.session` 默认不对内容脚本开放，而消费方正是内容脚本；键值带视频身份（`input`），内容脚本挂载时只在身份一致时消费（读后即删），避免换视频后误定位。
3. **内容脚本不丢消息**：iframe 还没挂载 / 还没 `READER_READY` 时先把定位存起来，就绪后补发一次；`tabs.sendMessage` 的接收方必须回执（MV3 下不回执会让发送端以「message port closed」拒绝，把成功误报成失败）。
4. **定位语义在阅读器**（`EmbeddedComments.vue#locateComment`）：①展开从根到目标的整条祖先链（折叠不再挡路）；②把渲染上限抬到目标那一行；③`scrollIntoView({behavior:'smooth', block:'center'})` 滚到视野中央并挂 `flash-highlight` 闪一下（同一个类连加两次不重放动画，先摘再加强制重排）。**不在已读范围内就照实提示**（「这条评论不在已读范围内——滚到底把它所在的那一页取回来后再试」），不凭空造行、也不悄悄滚到别的行。
5. **行元素写 `data-comment-id`**：定位与探针都需要一个稳定的行锚点（原先刻意不写，避免为观测改生产 DOM；现在它有了产品用途）。
6. **闪烁类由脚本挂、但要在 Vue 的 patch 之后挂**：行上的 `class` 是绑定，Vue 下一次 patch 会**重写整个 class 属性**——先改选中态、`await nextTick()`，再挂 `flash-highlight`，否则刚加的类会被同一次 patch 抹掉（实测踩到过）。

## 依据（实测）
- 单测：`tests/ui/embedded-comments-reader.test.ts`（展开折叠 + 抬上限 + 滚动/闪烁 + 不在已读范围的提示 + 首屏前挂起后补执行）、`tests/extension/{page-comments,messages,background,page-reader}.test.ts`（守卫正反例、标签页挑选与 create 分支、身份不一致不投递、就绪前挂起/就绪后补发）、`tests/ui/thread-detail-card.test.ts`（按钮显隐与 emit）。
- **真机端到端**（本机 Chrome 140 + `Extensions.loadUnpacked(dist)`，一个已打开的视频标签页）：从工作台页面的主世界 `chrome.runtime.sendMessage({type:'loupe:locate-comment', input, commentId})` ⇒ `{ok:true}`；**宿主页面 `scrollY` 0 → 1521**；目标行拿到 `comment-row selected root flash-highlight`；阅读器无错误提示。
  - 反例（同一套代码）：浏览器里同时开着**多枚**同一个视频的标签页时，后台按 URL 挑中的是**另一枚**，于是「目标那一页」没有任何反应——定位是按「视频身份」而不是「你正看着的那个标签页」投递的（真机踩到，见 `.context/LESSONS.md` L-13）。
  - 跨源 `scrollIntoView` 在 Chrome 里**会**把宿主文档一起滚到位（这一点此前不确定，已实测）。
- 接收侧单独验证：从宿主主世界直接向 iframe 投 `READER_LOCATE`（绕过内容脚本那一跳）也能让目标行闪烁 ⇒ 三个 hop 各自可独立观察。

## 后果
- 正面：图谱/工作台与评论区之间有了可预期的往返；定位失败有明确文案，不会静默。
- 代价 / 负面：多了一条跨三个上下文的消息链（后台 → 内容脚本 → 嵌入页），每层都要各自校验身份；阅读器只认「已读到的评论」，深在后面的页里时要求用户先滚到那里（阅读器不做全量抓取，见 ADR-0003）。
- 遗留：工作台侧的按钮只在「当前结果属于 bilibili 视频」且不在图谱窗口时出现（图谱窗口没有评论区语义）；真机上按钮点击这条 UI 路径由单测覆盖，未做「点按钮 ⇒ 看滚动」的整链真机脚本（协议层已实测）。

## 备选方案（关键）
- **让阅读器自己去找那条评论**（按 id 全量抓取直到命中）：等于把「滚到底才取下一页」的契约打破，代价是一次定位拉起整个视频的抓取 ⇒ 放弃。
- **直接改宿主 `scrollTop`**：阅读器不该碰宿主 DOM；`scrollIntoView` 实测已能跨源滚到位 ⇒ 放弃。
- **只做「评论区 → 图谱」单向**（现状）：用户从图谱挑完就回不去 ⇒ 放弃（本轮补齐反向）。
- **`storage.session` 传待办**：内容脚本默认读不到 ⇒ 放弃。
- **让工作台直接 `tabs.sendMessage` 到视频页**（跳过后台）：工作台不知道哪枚标签页对应该视频，且需要自行处理激活与新建 ⇒ 放弃，交给后台一处判定。

## 补充（2026-10-29，见 ADR-0009）
「不在已读范围内就照实提示」已被取代：阅读器现在先查最新主体快照（`workbench.locateComment`，命中则零请求），否则经 `seek_rpid` 一次定点取回目标所在的根评论块，钉在评论流上方成「定位块」（流序不动，仍守 ADR-0004）。本 ADR 的三层转发协议与「展开折叠/抬上限/滚动闪烁」的流内路径不变；「不存在」的提示语义保留给平台确认的评论已删除。
