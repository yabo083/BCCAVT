# ADR-0009: 定位未读评论 = 定点取回 + 定位块钉在流上方

## 日期
2026-10-29

## 状态
accepted

## 背景
ADR-0008 的定位协议只管「已在评论流里的行」：展开祖先折叠 → 抬渲染上限 → 滚动闪烁。目标不在已读范围内时只有一句「滚到底把它那页取回来再试」——工作台 / 图谱（全量）与阅读器（逐页）数据不对等，这个提示在真实使用中几乎等于「定位失败」。

2026-10-29 实测（Chrome 156，BV1DXaG6TETt）补上了关键的一块拼图：`wbi/main` 带 `seek_rpid=<id>` 时，平台把目标所在的**根评论**置顶在 `replies[0]`（目标是楼中楼时它出现在 `replies[0].replies` 内联预览里），其余是正常第一页、游标不变。一次请求就能定点取回目标所在的根评论块，不需要翻页。

## 决策
**阅读器内：不在已读范围的定位 = 一次定点取回 + 把取回的根评论块钉在评论流上方（定位块），与原生置顶同款位置。**

1. **引擎侧新增 `Workbench.locateComment`（`report.ts#Workbench`，实现 `workbench.ts#runLocate`）**，三段序：
   - 最新主体快照已含该评论 → 零请求返回它的根评论块（`source: 'snapshot'`）；
   - 否则经适配器可选能力 `seekRoot(subject, commentId, ctx)`（`platform.ts#PlatformAdapter`、`#SeekResult`）一次取回，走 `'page|…|seek|<commentId>'` 页缓存键——同一 id 再定位不再回源；**刻意不写成 `'roots|start'`**：定位块不是第一页，混键会把假首页喂给分页；
   - 适配器没有 `seekRoot` → `PlatformError('unavailable')`。
2. **bilibili 的 `seekRoot`（`src/platforms/bilibili/index.ts#seekRoot`）**：`fetchRootPage(locator, null, 'time', ctx, commentId)`（seek_rpid 只在此场景附带），只收 `replies[0]` 这一块——根 id 是目标本身、或其内联预览里含目标才算命中；对不上（含空 replies）抛 `not-found`，绝不把碰巧排第一的另一条评论交回去。
3. **阅读器 `EmbeddedComments.vue#locateComment`**：在流里仍走 ADR-0008 原路径（`locateInStream`）；不在流里时调用 `readerWorkbench.locateComment`——**取回的根若已经在流里**（目标只是还没加载的楼中楼），把评论块并进主流的按需回复位再按流内路径定位，不钉定位块；根也不在流里才把结果渲染成 `located` 定位块（小标题「定位到的评论」+ 关闭按钮），目标行照常 `selected` + `scrollIntoView` + `flash-highlight`。定位块用与主流同一套 `buildForest`/`flattenThread`/`collapsed` 搭小森林、同一个 `PageCommentRow` 渲染；行事件（点赞 / 回复 / 作者入口 / 图谱 / 展开）统一经 `nodeOf` 在主流森林 ∪ 定位块森林里找节点。在定位块里写出的评论与展开的回复并进定位块、**不进主流**（流里没有它的根，并进去会变孤儿行）。换目标与关闭时清空；关闭是结构性缩高（`reportHeight(true)`）。
4. **流的行序一个都不动**：定位块渲染在 `.comment-list` 之外，根在流里的合流也只追加进 `loaded` 通道（与 expandReplies 同一入口），不碰 `merged`/`rows`/`listRows`（ADR-0004 的「渲染层只追加」契约原样成立）。

## 备选方案（关键）
- **把定位块插进评论流**：破坏 ADR-0004——「取回顺序 = 渲染顺序」的只追加契约，目标行会让已读行整体位移，且它不属于任何游标页，翻页/重放时无处安放 ⇒ 放弃。
- **维持 notice-only（ADR-0008 原方案）**：用户必须自己滚到那页，等于没有定位 ⇒ 放弃。
- **定位到就打开图谱窗口**：图谱是全量分析视图，不是「看评论在评论区的上下文」的落点 ⇒ 放弃。
- **`listThread(commentId)` 取整棵树**：detail 接口能取回整棵树但拿不到「它在顶层流里的根上下文块」，且比 seek_rpid 多请求、语义也偏重（定位需要的是根块，不是全树）⇒ 放弃（seek_rpid 一次请求已含根 + 预览）。

## 依据（实测）
- `seek_rpid` 行为：`wbi/main?seek_rpid=<id>` → `replies[0]` 是目标的**根**评论；目标是楼中楼时它在 `replies[0].replies` 内联预览中（2026-10-29 探针，见 `api.ts#fetchRootPage` 的注释）。
- 单测：`tests/core/workbench.test.ts`（snapshot 命中零请求 / seek 一次取回 / 同 id 再走缓存 / not-found 与 unavailable 透传）、`tests/platforms/bilibili/adapter.test.ts`（seek_rpid 只在 seek 出现、根命中与预览命中、失配/空 → not-found）、`tests/ui/embedded-comments-reader.test.ts`（定位块出现 + 目标选中 + 流序不变 + 关闭缩高 + 在流内不走 seek）。

## 后果
- 正面：「在评论区定位」对任何评论都可用；定位块与原生置顶同位置，心智成本为零；行事件在块内全可用。
- 代价 / 负面：定位块是**第二份森林**——行事件解析必须查两片森林（`nodeOf`），在块里写评论/展开回复有专属的并入路径；seek 结果只有根 + 内联预览（平台最多给 3 条），不是整棵树，想看全仍要展开（走 `previewThread`）。
- 遗留：定位块不持久（换目标即清）；`seekRoot` 是适配器可选能力，新平台缺省即 `unavailable`。
