# ADR-0002: 以极简 PlatformAdapter 接缝支撑多平台，而非插件框架

## 日期
2026-10-09

## 状态
accepted

## 背景
目标是"足以支撑主流社交平台的评论解析"，当前只落地 B 站。主流平台的评论结构都能归约为"主体 → 顶层评论（游标分页）→ 每条顶层评论下的回复（游标分页，回复带 parent 指针）"：B 站、YouTube（commentThreads/comments）、微博、抖音、Reddit（深树，同样有 parent）都符合。

## 决策
我们选择：**一个 6 成员的 `PlatformAdapter` 接口 + 平台无关的领域模型**（`src/core/model.ts`、`src/core/platform.ts`）。
- 适配器只做三件事：解析输入（`parseTarget`）、身份（`getSession`）、三类分页读取（`getSubject` / `listRoots` / `listThread`），以及声明礼貌参数、主机权限、请求头改写。
- 签名、错误码映射、字段归一化都关在适配器里；对外只抛 `PlatformError(kind)`。
- 引擎（缓存、限速、重试、增量、快照）、分析、可视化、AI 只认领域模型。
- 平台登记是一个静态数组 `adapters`，`PlatformId` 是字面量联合类型：新增平台时编译器会指出所有需要处理的地方。

## 后果
- 正面：新增平台 = 一个目录 + 一行登记；引擎的退避、缓存、增量策略一次实现，所有平台受益；领域模型可直接做测试夹具。
- 负面 / 代价：平台独有的信息（B 站表情包、投票、笔记）不进入模型，需要时再按需扩展字段；`locator` 是适配器私有的弱类型口袋。

## 备选方案（关键）
- **动态加载的插件框架（运行时注册、独立打包）**：MV3 禁止远程代码，且只有一个平台时这是纯成本 → 放弃（原则：架构收敛，反过度设计）。
- **每个平台各写一套抓取 + 报告**：缓存、退避、增量逻辑会被复制 N 份 → 放弃。

## 修订 2026-10-10：写能力（点赞 / 回复）
评论区从只读变成可写：接缝补了一个**可选**成员 `writes?: PlatformWrites`（`likeComment` / `replyComment`），只读平台不实现即可，读取路径与只读平台零改动。
- 写请求与读请求共用同一个 `HttpClient`：`postForm(url, params)` 走同一份 Host/Origin/Referer 改写、同一份风控退避与 HTTP 级错误映射。
- 凭据（B 站 `bili_jct`）由调用方（内容脚本）在**写执行时**从 `document.cookie` 现读，经 `WriteAuth` 参数进入适配器，只在本层拼进请求体即时使用：适配器自身绝不读 cookie，凭据绝不跨桥、不进日志 / 快照 / 缓存键 / storage / 错误文本（有单测兜底）。
- `replyComment` 返回归一化的 `Comment`，写路径与读路径共用 `normalize.ts`；B 站端点与参数以 bilibili-API-collect `docs/comment/action.md` 为准（`/x/v2/reply/action`、`/x/v2/reply/add`）。
