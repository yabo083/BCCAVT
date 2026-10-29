# ADR-0007: 可插拔配色 —— 配色与明暗正交的 accent 系令牌

## 日期
2026-10-14

## 状态
accepted

## 背景
`tokens.css` 原本只有**一条**主题轴：明暗（浅色默认 + 两个深色入口）。主色「青墨」写死在 `:root` 与两个深色入口里。需求是让主色可换（品牌色 / 个人口味 / 服务端下发），且**不能**动中性色阶与语义色——它们是「可读性」的部分，不属于口味。

视觉基准原型 `tmp/mock-redesign.html` 给了 5 套预设（青墨 / 哔哩粉 / 极光蓝 / 暗夜紫 / 琥珀金）+ 一个 `<input type=color>` 的动态 HEX 注入，并明确「后端可配置的主题令牌接口契约」只涉及 `--theme-accent*` 四个值。

## 决策
1. **两条轴正交**：明暗仍走 `data-theme`（浅色 / 系统深色 / 显式深色三个入口），配色走 `data-palette`。配色只覆盖 **accent 系五个令牌**：`--accent`、`--accent-strong`、`--accent-bg`、`--accent-border`、`--selection-bg`；中性色阶、语义色、立场色一律不动。
2. **预设走属性选择器**：`:root[data-palette='x']`（浅色）+ 两个深色入口各一份（`@media (prefers-color-scheme: dark)` 里的 `:root:not([data-theme='light'])[data-palette='x']` 与 `:root[data-theme='dark'][data-palette='x']`）。取值逐字取自原型，符合 WCAG AA。**不用 `light-dark()`**：`manifest.minimum_chrome_version = 116`，该函数需 Chrome 123。
3. **自定义走内联变量**：`theme.ts#applyPalette` 在 `documentElement.style` 上写 `--accent` / `--accent-strong`（同一个 hex）与 `color-mix` 派生的 `--accent-bg`（18%）/ `--accent-border`（40%），并置 `data-palette='custom'`（CSS 侧只给 custom 补一条 `--selection-bg` 派生，因为内联没写它）。切回预设时**逐个清掉内联键**——残留的内联值会赢过属性选择器，把整套色带偏。
4. **持久化与生效**：键 `loupe.palette` 存 `chrome.storage.local`，读回来一律过 `normalizePalette`（非对象 / 未知 id / 非 `#rrggbb` 全部回落青墨）——存储是不可信输入。三个入口在 `app.mount` **之前** `applyStoredPalette()`（失败也照样 mount，界面绝不能因配色挂不上）；阅读器是**另一个文档**，挂载时应用一次并用 `watchPalette`（`chrome.storage.onChanged`）跟随，工作台里改色即时生效、不用刷新。
5. **切换入口是一个共用组件，挂两处**：`components/PalettePicker.vue`（5 个色点 `role=radiogroup` + `role=radio`，选中态用**非颜色**标记——描边加粗 + 内点缩小；外加一个取色器）。它自己读写 `loupe.palette`，于是挂在哪两处天然同步：**工具栏设置弹窗**（`ConfigPopup.vue`，用户找设置的第一落点）与工作台顶栏（`TopBar.vue`，干活时的即时反馈）。阅读器不提供切换入口：它的头部空间要留给评论本身，而配色是全局偏好。

## 依据（实测）
- 原型逐字取值与 `applyCustomPalette` 的确切公式（`color-mix(in srgb, hex 18%, transparent)` / `40%`）。
- `tests/ui/theme.test.ts` 11 条：非法输入回落、预设不写内联、自定义写 4 个内联变量、从 custom 切回预设清空内联、无 `chrome` 环境下 `loadPalette`/`savePalette`/`watchPalette` 不抛错。
- 真机（`tmp/rows.html` 脚手架 + 真实 `PageCommentRow`）：浅色青墨 / 深色哔哩粉 / 自定义紫三套配色下，连接线几何与布局完全一致（配色只影响颜色）。

## 后果
- 正面：换主色不动一行组件样式；自定义 hex 也能落到所有 accent 系用法上（含划词高亮）；明暗与配色可任意组合。
- 代价 / 负面：`tokens.css` 每个预设写 3 块（CSS 没有变量混合，深色取值必须两处同步——与既有约定一致）；自定义 hex **不做对比度计算**（浅黄这类主色在浅色底上对比度会不足，这是用户的选择，不由我们替其"纠正"）；`--fg-on-accent` 不参与配色（accent 上的文字色仍由明暗决定）。
- 遗留：配色没有「跟随站点主色」这种自动模式（站点品牌色变化需要用户手动选）。

## 备选方案（关键）
- **`light-dark()` 一次写完明暗**：Chrome 123+，与 116 的运行下限冲突 ⇒ 放弃（保持三块显式写法）。
- **只给一个 hue，深浅由 `color-mix` 推导**：省 15 个块，但深色下的对比度不可控（青墨在深色下要提亮到 `#45c2c0` 才够），预设必须人工定值 ⇒ 放弃。
- **复用 `--accent` 的计算值做取色器初值**：深色主题下那是另一套取值 ⇒ 放弃，另设 `PRESET_LIGHT_ACCENT` 常量（浅色基准）。
- **存 `chrome.storage.sync`**：跨设备同步意味着另一台机器上开着的窗口会突然换色，且配额更小 ⇒ 放弃。
- **在阅读器头部也放一个切换器**：与「头部只留评论区自身信息」冲突，且偏好是全局的 ⇒ 放弃。
