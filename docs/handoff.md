# Loupe 前端样式与交互现代化交接手册 (Handoff Guide)

> **文档性质**：生产落地指南（Handoff Document）  
> **面向对象**：前端与浏览器扩展开发人员、UI/UX 工程师  
> **基准原型**：`tmp/mock-redesign.html`（已通过真实 312 条数据全链路测试验证）  
> **遵循契约**：[`AGENTS.md`](../AGENTS.md)、[`src/ui/README.md`](../src/ui/README.md#关键决策)、[`docs/adr/0003-reader-infinite-scroll.md`](adr/0003-reader-infinite-scroll.md#决策)、[`docs/adr/0004-reader-row-order-append-only.md`](adr/0004-reader-row-order-append-only.md#决策)、[`docs/adr/0005-native-author-entries-via-site-component.md`](adr/0005-native-author-entries-via-site-component.md#决策)

---

## 0. 落地状态（2026-10-14，本手册已执行）

六阶段均已实施。**本手册从此是「设计意图的存档」，不是待办清单**——当前规格以代码与 ADR 为准：

| 阶段 | 状态 | 最终落点 |
|---|---|---|
| 1 设计令牌与主题 | 已落地 | [ADR-0007](adr/0007-theme-palette-tokens.md)（`theme.ts` + `tokens.css` + `TopBar.vue`） |
| 2 树形数据与脊线算法 | 已落地 | [ADR-0006](adr/0006-reader-spine-geometry.md)（`thread.ts` 输出 `col/parentCol/rowSpines`，`MAX_VISUAL_DEPTH = 3`） |
| 3 评论行组件 | 已落地 | ADR-0006（几何 + 动效） |
| 4 阅读器容器 | **部分**：回复抽屉用 grid 展开已落地；「分支 grid 折叠抽屉」**有意未做**（与 ADR-0003/0004 的高度只增不减、行序只追加契约冲突，见 ADR-0006 决策 6） |
| 5 图谱与双向定位 | 已落地 | [ADR-0008](adr/0008-locate-in-reader.md)（三层转发 + `LOCATE_PENDING_KEY`） |
| 6 测试与防腐 | 已落地 | `tests/ui/{theme,thread,page-comment-row,embedded-comments-reader,thread-detail-card}.test.ts`、`tests/extension/{page-comments,messages,background,page-reader}.test.ts`、`tests/test-suite.md` 的 `RDR-07/08`、`THEME-01/02` |

实施中的两处偏离（手册与契约冲突时以契约为准）：

1. **`ThreadRow` 未加 `hasStem` / `isLast`**：`hasStem` 是 `hasChildren && !folded` 的派生值（且折叠淡出要求元素常驻，模板直接用 `hasChildren`），`isLast` 只在遍历内部用于算 `rowSpines`——加进输出就是死字段。
2. **封顶列不照抄 `Math.max(1, col - parentCol)`**：原型那段会画出 32px 横向悬空尾巴；实现改为「`col === parentCol` 时不画 elbow、改画竖直连接段」（`.line.capped`）。

基准原型 `tmp/mock-redesign.html` 属临时区（`tmp/` 是随手可删的脚手架目录），**不是**工程文档的一部分；本手册引用的取值已全部固化进 `tokens.css` / `PageCommentRow.vue` / ADR。

**第二、三批（2026-10-14，同一轮）**：原型里其余用户可见细节也已对齐——UP 头像着色、正文 @提及 pill（正文去前缀）、首屏骨架屏 shimmer、工作台四岛错峰入场 + 视图切换 + 详情卡换选重放、图谱雷达波（**只闪两下**、每次适配视图重播）；设置弹窗按反馈改成 320px/217px 的紧凑面板（解释全进 `title`，自定义主色改成可辨识的彩虹 `+` 环，面板里只有自绘评论区开关与主题配色）；「全部折叠」改为**粘滞**（新取回的页也折叠）；自绘行的「图谱」入口改为默认隐藏、悬停该行或选中该行才在**行右端**显现；图谱弹窗初始 **960×660** 且居中，**挂载首帧就按内容包围盒量一次**尺寸、仿真收敛后再校准一次；工作台顶栏的运行/提示条改成浮层（不再把中段整排顶下去）、左右两侧浮岛按内容自适应高度；阅读器不再自绘底色，宿主评论区自己的底色透上来。仍**有意不做**两项：阅读器内的筛选/排序条（与 ADR-0004 行序契约冲突；能力在工作台）、楼中楼分支 grid 折叠抽屉（ADR-0006 决策 6）。逐项清单见 `src/ui/README.md` 决策 22/23/25 与 `.context/STATE.md`。

**第四批（2026-10-14，实机反馈 + 一轮外部设计评审）**：收起详情重塑为右缘的**竖向胶囊书签**（32×104、仅左侧圆角、玻璃材质 + 18px 模糊、顶边与展开态对齐、hover 左移 4px，降级动态时取消位移）；工作台「输入」面板瘦身——删掉整块「快速开始」、删掉工作台里的「自绘评论区」开关（该设置的唯一入口是设置弹窗，`PageReadingSwitch.vue` 已删除）、抓取选项改为默认收起的 `<details>`（摘要行实时显示「刷新方式 · 上限」，展开后是两列紧凑网格、解释进 `title`）；`base.css` 新增 `.switch` 原语（贴在 `<input type="checkbox">` 上、`appearance: none`），设置弹窗的布尔项改用它；顶栏参数行居中（`.params { justify-content: center }`）。清单见 `src/ui/README.md` 决策 25 与 `tests/test-suite.md` 的 `LOOK-06/07/08/09/10`。

**第五批（2026-10-14，实机反馈）**：左侧六个 tab 与右侧详情把手全部**锚顶**（位置稳定优先于居中）——展开/收起只换形态与宽度，顶边一个像素都不动（此前 tab 会跳 35px、详情会跳 368px）；AI 与历史两个 tab 去嵌套：面板里 `.card` 归零，分节用 13px 分区标题 + 一条细线，空状态改一行左对齐，快照列表改细分隔线的列表行，AI 设置（含「启用 AI 解读」开关）收进默认折叠的 `<details>` 摘要（AI 面板收起态 788 → 384px）。

---

## 1. 改版成果与核心问题溯源 (Executive Summary)

本指南旨在指导开发人员将原型验证页 `tmp/mock-redesign.html` 中的现代设计系统、严密树形连接线几何、流畅动效体系以及多主题可插拔架构，系统性、批量化地移植到 Loupe 正式生产组件中。

### 1.1 树形连接线三大痛点彻底解决

在旧版实现中，树形连接线存在明显的几何与视觉瑕疵，改版后已实现数学级闭环对齐：

1. **绝对居中对齐（Center-to-Center）**：
   - *旧病症*：连接线起点和终点未落在头像几何中点，存在 3~4px 的肉眼可见错位。
   - *新解法*：建立以头像槽位为原点的严密列中心方程 $X_c(k) = \text{--indent-base} + k \times \text{--step} + \text{--slot-center}$。竖脊线与弯头（Elbow）严格以此中心为锚点绘制，首尾无缝对接。
2. **消除逐段高亮割裂（Unbroken Visual Trunk）**：
   - *旧病症*：鼠标悬停单行时，该行局部的线段被单独高亮（`comment-row:hover { --line: ... }`），导致主干被切割为碎线段。
   - *新解法*：移除行级悬停对线色的劫持，连接线统一使用低对比度、浑然一体的中性色阶，保持整条树干的视觉连续性。
3. **消除断线与缺线（Continuous Spine Propagation）**：
   - *旧病症*：多级嵌套时，父级竖脊经常在孙代或者折叠行前截断，出现“悬空半截线”或“缺一条线”。
   - *新解法*：在树展开算法中引入 `rowSpines` 集合传递机制。同辈中只要当前节点**不是最后一条**，其父级所在的竖直列就必须持续贯穿本行并下传到所有后代中，确保主干不中断。

### 1.2 经典「青墨」品牌色还原与解耦主题令牌

- **青墨基准还原**：严格还原 Loupe 经典的深青中性阶色系（浅色主色 `--accent: #0e6d74`，深色主色 `--accent: #45c2c0`），符合 WCAG AA 级对比度。
- **5 套预设 + 动态 HEX 注入**：
  提供经典青墨 (`teal`)、哔哩粉 (`pink`)、极光蓝 (`blue`)、暗夜紫 (`violet`)、琥珀金 (`amber`) 5 种预设。同时支持用户或服务端动态传入任意 Hex 颜色，通过 CSS `color-mix()` 自动推导 `--accent-bg`（透明度 18%）与 `--accent-border`（透明度 40%）。

### 1.3 现代微交互与动画系统 (Motion System)

- **纯 CSS Grid 抽屉展开**：使用 `grid-template-rows: 0fr -> 1fr` 机制替换脆弱易卡顿的 JavaScript 高度计算或 `max-height` Hack，性能高且天然自适应内容增删。
- **M3 Spring Physics 微交互**：点赞按钮引入 Material 3 弹簧动效（`--ease-spring: cubic-bezier(0.34, 1.4, 0.64, 1)`），结合数字阶梯式回弹（Pop Odometer）。
- **图谱雷达波与双向定位**：节点选中触发雷达波扩散动画，支持从评论区一键聚焦图谱节点，从图谱详情一键回跳并高亮闪烁评论行（`flash-highlight`）。

---

## 2. 第一阶段：设计令牌与主题系统改造

### 2.1 令牌层升级 (`src/ui/styles/tokens.css#accent`)

在 [`tokens.css`](../src/ui/styles/tokens.css#root) 中定义统一的主题色彩与动效曲线变量：

```css
/* src/ui/styles/tokens.css */
:root {
  /* 动效物理曲线：Material 3 弹簧曲线与平滑减速曲线 */
  --ease-spring: cubic-bezier(0.34, 1.4, 0.64, 1);
  --ease-dock: cubic-bezier(0.05, 0.7, 0.1, 1);
  --dur-dock: 260ms;

  /* 经典「青墨」默认浅色 (Teal & Ink) */
  --accent: #0e6d74;
  --accent-strong: #0a5259;
  --accent-bg: #dfeef0;
  --accent-border: #add6da;
  --selection-bg: #a0d0d6;
}

/* 系统深色与显式深色 */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    --accent: #45c2c0;
    --accent-strong: #6fd8d4;
    --accent-bg: #10312f;
    --accent-border: #1e5450;
    --selection-bg: #2b6d6a;
  }
}

:root[data-theme='dark'] {
  --accent: #45c2c0;
  --accent-strong: #6fd8d4;
  --accent-bg: #10312f;
  --accent-border: #1e5450;
  --selection-bg: #2b6d6a;
}
```

### 2.2 扩展可插拔预设主题 (`tokens.css#root`)

增加属性选择器 `:root[data-palette="..."]`，以完全非侵入方式扩展主题：

```css
/* 1. 经典青墨 (Teal) */
:root[data-palette="teal"] {
  --accent: #0e6d74; --accent-strong: #0a5259;
  --accent-bg: #dfeef0; --accent-border: #add6da;
}
:root[data-theme="dark"][data-palette="teal"] {
  --accent: #45c2c0; --accent-strong: #6fd8d4;
  --accent-bg: #10312f; --accent-border: #1e5450;
}

/* 2. 哔哩粉 (Pink - 贴近 B 站原生品牌感) */
:root[data-palette="pink"] {
  --accent: #fb7299; --accent-strong: #e0567e;
  --accent-bg: #fff0f4; --accent-border: #ffccd9;
}
:root[data-theme="dark"][data-palette="pink"] {
  --accent: #ff85ad; --accent-strong: #ffa3c2;
  --accent-bg: #3c1421; --accent-border: #642337;
}

/* 3. 极光蓝 (Blue) */
:root[data-palette="blue"] {
  --accent: #1d4ed8; --accent-strong: #1e40af;
  --accent-bg: #eff6ff; --accent-border: #bfdbfe;
}
:root[data-theme="dark"][data-palette="blue"] {
  --accent: #60a5fa; --accent-strong: #93c5fd;
  --accent-bg: #172554; --accent-border: #1e3a8a;
}

/* 4. 暗夜紫 (Violet) */
:root[data-palette="violet"] {
  --accent: #7c3aed; --accent-strong: #6d28d9;
  --accent-bg: #f5f3ff; --accent-border: #ddd6fe;
}
:root[data-theme="dark"][data-palette="violet"] {
  --accent: #a78bfa; --accent-strong: #c4b5fd;
  --accent-bg: #2e1065; --accent-border: #4c1d95;
}

/* 5. 琥珀金 (Amber) */
:root[data-palette="amber"] {
  --accent: #b45309; --accent-strong: #92400e;
  --accent-bg: #fffbeb; --accent-border: #fde68a;
}
:root[data-theme="dark"][data-palette="amber"] {
  --accent: #fbbf24; --accent-strong: #fcd34d;
  --accent-bg: #451a03; --accent-border: #78350f;
}
```

### 2.3 运行时自定义色彩注入函数

在 UI 服务层或状态管理中封装动态颜色注入函数，满足用户自定义 Hex 配色：

```typescript
/**
 * 动态应用自定义主色调（自动生成符合设计规范的浅浅底色与边框色）
 */
export function applyCustomPalette(hexColor: string): void {
  const root = document.documentElement;
  root.setAttribute('data-palette', 'custom');
  
  // 注入动态计算阶梯
  root.style.setProperty('--accent', hexColor);
  root.style.setProperty('--accent-strong', hexColor);
  root.style.setProperty('--accent-bg', `color-mix(in srgb, ${hexColor} 18%, transparent)`);
  root.style.setProperty('--accent-border', `color-mix(in srgb, ${hexColor} 40%, transparent)`);
}
```

---

## 3. 第二阶段：树形数据结构与脊线算法改造

### 3.1 `ThreadRow` 数据结构扩展 (`src/ui/thread.ts#ThreadRow`)

在 [`thread.ts`](../src/ui/thread.ts#ThreadRow) 中扩展行展示模型：

```typescript
// src/ui/thread.ts
export interface ThreadRow {
  node: CommentNode;
  id: string;
  depth: number;
  index: number;
  hasChildren: boolean;
  folded: boolean;
  hidden: number;
  preview: string;

  /** 新增：视觉所在列（考虑窄屏深度封顶，0 起） */
  col: number;
  /** 新增：父节点所在列（用于绘制 Elbow） */
  parentCol: number;
  /** 新增：穿透本行需绘制的所有竖脊列索引数组（按升序排列） */
  rowSpines: number[];
  /** 新增：是否有展开的子树需从头像底垂出脊线 */
  hasStem: boolean;
  /** 新增：是否为同辈中的最后一个节点 */
  isLast: boolean;
}
```

### 3.2 连续树干穿透算法 (`src/ui/thread.ts#flattenThread`)

改造 [`flattenThread`](../src/ui/thread.ts#flattenThread)，彻底修复连线断裂：

```typescript
// src/ui/thread.ts
export const MAX_VISUAL_DEPTH = 3; // 深度超过 3 级后收敛列宽，保障移动端可读性

export function flattenThread(
  root: CommentNode,
  collapsed: ReadonlySet<string>
): ThreadRow[] {
  const rows: ThreadRow[] = [];

  function walk(
    nodes: CommentNode[],
    parentCol: number,
    activeSpines: ReadonlySet<number>,
    currentDepth: number
  ): void {
    nodes.forEach((node, idx) => {
      const isLastChildOfParent = idx === nodes.length - 1;
      const isFolded = collapsed.has(node.comment.id);
      const col = Math.min(currentDepth, MAX_VISUAL_DEPTH);

      // 计算穿透本行绘制的脊线
      const rowSpines = new Set(Array.from(activeSpines).filter((s) => s < col));

      // 核心连贯性规则：当前节点若非末尾兄弟，其父级列在当前行必须向下穿透贯通！
      if (!isLastChildOfParent && parentCol < col) {
        rowSpines.add(parentCol);
      }

      const hasVisibleChildren = node.children.length > 0 && !isFolded;

      rows.push({
        node,
        id: node.comment.id,
        depth: currentDepth,
        index: rows.length,
        hasChildren: node.children.length > 0,
        folded: isFolded,
        hidden: isFolded ? node.size - 1 : 0,
        preview: node.comment.text.replace(/\s+/g, ' ').trim(),
        col,
        parentCol,
        rowSpines: Array.from(rowSpines).sort((a, b) => a - b),
        hasStem: hasVisibleChildren,
        isLast: isLastChildOfParent,
      });

      if (!isFolded && node.children.length > 0) {
        const nextSpines = new Set(activeSpines);
        // 若当前节点不是同级末尾，父级列在更深层后代中继续保持穿透
        if (!isLastChildOfParent) {
          nextSpines.add(parentCol);
        }
        walk(node.children, col, nextSpines, currentDepth + 1);
      }
    });
  }

  // 根节点入队
  const rootFolded = collapsed.has(root.comment.id);
  const rootHasChildren = root.children.length > 0 && !rootFolded;
  rows.push({
    node: root,
    id: root.comment.id,
    depth: 0,
    index: 0,
    hasChildren: root.children.length > 0,
    folded: rootFolded,
    hidden: rootFolded ? root.size - 1 : 0,
    preview: root.comment.text.replace(/\s+/g, ' ').trim(),
    col: 0,
    parentCol: 0,
    rowSpines: [],
    hasStem: rootHasChildren,
    isLast: true,
  });

  if (!rootFolded && root.children.length > 0) {
    walk(root.children, 0, new Set(), 1);
  }

  return rows;
}
```

---

## 4. 第三阶段：评论行组件深度重构 (`PageCommentRow.vue`)

### 4.1 几何方程与 CSS 实现 (`src/ui/components/PageCommentRow.vue#comment-row`)

在 [`PageCommentRow.vue`](../src/ui/components/PageCommentRow.vue#comment-row) 中建立绝对居中对齐几何体系：

```css
/* src/ui/components/PageCommentRow.vue */
.comment-row {
  --step: 32px;
  --indent-base: 16px;
  --avatar-slot: 38px;
  --slot-center: 19px; /* 38px / 2 严格居中 */
  --line-w: 2px;
  --line-color: color-mix(in srgb, var(--border-strong) 70%, var(--fg-subtle));
  --pad-top: 14px;

  position: relative;
  display: flex;
  align-items: flex-start;
  width: 100%;
  min-width: 0;
  padding: var(--pad-top) var(--sp-3) var(--pad-top)
    calc(var(--indent-base) + var(--depth, 0) * var(--step));
  background: transparent;
  cursor: pointer;
  transition: background var(--dur-fast) ease;
}

.comment-row:not(.root) {
  --pad-top: 10px;
}

/* 消除旧版的悬停逐段变色破坏整体性的问题 */
/* 严禁再写 .comment-row:hover { --line: ... } */

/* 选中高亮 */
.comment-row.selected {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}

/* 闪烁定位高亮（图谱双向联动） */
.comment-row.flash-highlight {
  animation: row-flash 1.4s ease-out;
}
@keyframes row-flash {
  0% { background: color-mix(in srgb, var(--accent) 32%, transparent); }
  100% { background: color-mix(in srgb, var(--accent) 8%, transparent); }
}
```

### 4.2 连接线元素精确定位 (`PageCommentRow.vue#thread-lines`)

```css
.thread-lines {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
}

.line {
  position: absolute;
  border-color: var(--line-color);
  pointer-events: none;
}

/* 1. 穿透竖脊线：严格穿过 Xc(col) 从头到尾贯穿整行 */
.line.spine {
  left: calc(var(--indent-base) + var(--col) * var(--step) + var(--slot-center) - var(--line-w) / 2);
  width: var(--line-w);
  top: -1px;
  bottom: -1px;
  border-left: var(--line-w) solid var(--line-color);
}

/* 2. 自身下垂脊 (Stem)：从自身头像中心垂直垂出 */
.line.spine.stem {
  left: calc(var(--indent-base) + var(--col) * var(--step) + var(--slot-center) - var(--line-w) / 2);
  width: var(--line-w);
  top: calc(var(--pad-top) + var(--slot-center));
  bottom: -1px;
  border-left: var(--line-w) solid var(--line-color);
}

/* 3. 弯头 (Elbow)：从父级中线弯入自身头像左缘中点 */
.line.elbow {
  left: calc(var(--indent-base) + var(--parent-col) * var(--step) + var(--slot-center) - var(--line-w) / 2);
  width: calc(var(--step) * var(--col-span, 1) + var(--line-w) / 2);
  top: -1px;
  height: calc(var(--pad-top) + var(--slot-center) + 1px);
  border-left: var(--line-w) solid var(--line-color);
  border-bottom: var(--line-w) solid var(--line-color);
  border-bottom-left-radius: 10px;
}
```

### 4.3 模板连线渲染逻辑

```vue
<!-- PageCommentRow.vue 模板结构 -->
<div class="thread-lines" aria-hidden="true">
  <!-- 贯穿当前行的祖先脊线 -->
  <span
    v-for="sCol in props.row.rowSpines"
    :key="`spine-${sCol}`"
    class="line spine"
    :style="{ '--col': sCol }"
  />
  <!-- 从父级拐入本级的弯头弧线 -->
  <span
    v-if="props.row.depth > 0"
    class="line elbow"
    :style="{
      '--parent-col': props.row.parentCol,
      '--col-span': Math.max(1, props.row.col - props.row.parentCol),
    }"
  />
  <!-- 当前节点向子代延伸的下垂脊线 -->
  <span
    v-if="props.row.hasStem && !props.row.folded"
    class="line spine stem"
    :style="{ '--col': props.row.col }"
  />
</div>
```

### 4.4 原生作者卡片契约硬保留 (ADR-0005)

> [!IMPORTANT]
> **绝对不可遗漏**：[`PageCommentRow.vue#userEntryTag`](../src/ui/components/PageCommentRow.vue#userEntryTag) 与 [`PageCommentRow.vue#hoverUser`](../src/ui/components/PageCommentRow.vue#hoverUser) 负责将坐标跨界抛给宿主，驱动 B 站原生 `bili-user-profile` 弹出卡片。必须完整保留 `:is="userEntryTag"` 与 `@mouseenter="hoverUser($event, true)"` 逻辑，严禁改为自绘卡片！

### 4.5 M3 Spring 点赞动效与抽屉展开

```css
/* 点赞微交互 */
.comment-action-pill.liked {
  background: var(--accent-bg);
  color: var(--accent-strong);
  font-weight: 700;
}
.comment-action-pill.liked svg {
  animation: like-spring 360ms var(--ease-spring);
}
@keyframes like-spring {
  0% { transform: scale(1); }
  40% { transform: scale(1.32) rotate(-8deg); }
  75% { transform: scale(0.92) rotate(3deg); }
  100% { transform: scale(1) rotate(0); }
}

.like-num-pop {
  display: inline-block;
  animation: num-bounce 320ms var(--ease-spring);
}
@keyframes num-bounce {
  0% { transform: translateY(0) scale(1); }
  35% { transform: translateY(-4px) scale(1.18); color: var(--accent); }
  100% { transform: translateY(0) scale(1); }
}

/* 优雅回复抽屉 (CSS Grid 0fr -> 1fr) */
.reply-drawer-accordion {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows var(--dur-dock) var(--ease-dock);
}
.reply-drawer-accordion.is-open {
  grid-template-rows: 1fr;
}
.reply-drawer-content {
  overflow: hidden;
  min-height: 0;
}
```

---

## 5. 第四阶段：页面内嵌阅读器容器改造 (`EmbeddedComments.vue`)

### 5.1 楼中楼折叠抽屉容器化

在 [`EmbeddedComments.vue`](../src/ui/EmbeddedComments.vue#roots) 中，使用 `.branch-collapse-accordion` 包裹子评论群组，实现无抖动纯 CSS Grid 树枝折叠：

```css
/* 楼中楼分支折叠容器 */
.branch-collapse-accordion {
  display: grid;
  grid-template-rows: 1fr;
  opacity: 1;
  transition: grid-template-rows var(--dur-dock) var(--ease-dock),
              opacity var(--dur-fast) ease;
}
.branch-collapse-accordion.is-collapsed {
  grid-template-rows: 0fr;
  opacity: 0;
  pointer-events: none;
}
.branch-collapse-inner {
  overflow: hidden;
  min-height: 0;
}
```

### 5.2 高度上报与回弹硬防范 (ADR-0003 & ADR-0004)

> [!CAUTION]
> **绝对红线**：必须严格遵守 [`EmbeddedComments.vue#reportHeight`](../src/ui/EmbeddedComments.vue#reportHeight) 的高度只增不减原则：
> 1. 普通分页渲染追加，`reportHeight(false)`，高度只允许变大，严禁提交更小的高（否则触发浏览器 CSSOM 视口钳回回跳）。
> 2. 只有在**用户主动点击折叠子树**或**切换视频目标**（[`EmbeddedComments.vue#identityOf`](../src/ui/EmbeddedComments.vue#identityOf) 变更）时，才显式调用 `reportHeight(true)` 允许槽位变矮。
> 3. 顶层评论的渲染顺序保持取回追加顺序（[`EmbeddedComments.vue#roots`](../src/ui/EmbeddedComments.vue#roots)），严禁按时间二次排序。

---

## 6. 第五阶段：工作台与图谱改造 (`ForceGraph.vue` & `ThreadDetailCard.vue`)

### 6.1 节点聚焦雷达光环 (`src/ui/components/ForceGraph.vue#buildGraph`)

在 [`ForceGraph.vue`](../src/ui/components/ForceGraph.vue#buildGraph) 的节点绘制层或 SVG/DOM 叠加层中，对当前选中节点（`selectedId`）应用波纹雷达环：

```css
.graph-node-circle.pulse-focus::after {
  content: '';
  position: absolute;
  inset: -6px;
  border-radius: 50%;
  border: 2px solid var(--accent);
  animation: pulse-ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;
  pointer-events: none;
}
@keyframes pulse-ping {
  0% { transform: scale(0.95); opacity: 0.9; }
  70% { transform: scale(1.6); opacity: 0; }
  100% { transform: scale(1.6); opacity: 0; }
}
```

### 6.2 双向深度链接与滚动定位

1. **从评论行跳图谱**：
   在 `PageCommentRow.vue` 增加「分析图谱」按钮，点击时触发 `emit('analyze', commentId)`，在主视图中调用 `switchView('workbench')` 并选中对应节点。
2. **从详情卡片回跳评论区**：
   在 [`ThreadDetailCard.vue`](../src/ui/components/ThreadDetailCard.vue#CommentNode) 中增加「在评论区定位」按钮：
   ```typescript
   function locateInReader(commentId: string): void {
     // 切回阅读器视图并滚动
     switchView('reader');
     nextTick(() => {
       const row = document.getElementById(`row-${commentId}`);
       if (row) {
         row.scrollIntoView({ behavior: 'smooth', block: 'center' });
         row.classList.remove('flash-highlight');
         void (row as HTMLElement).offsetWidth; // 触发 reflow 重置动画
         row.classList.add('flash-highlight');
       }
     });
   }
   ```

---

## 7. 第六阶段：自动化测试与防腐验收清单

### 7.1 单测套件回归 (`npm test`)

批量改造完成后，必须全部通过现有 UI 与算法测试：

```powershell
npm test tests/ui/page-comment-row.test.ts
npm test tests/ui/thread.test.ts
npm test tests/ui/embedded-comments-reader.test.ts
```

需要补充/更新的单测断言点：
- [`tests/ui/thread.test.ts#flattenThread`](../tests/ui/thread.test.ts#flattenThread)：断言 `ThreadRow` 中输出的 `rowSpines` 在非末位节点与其子代中正确包含 `parentCol`。
- [`tests/ui/page-comment-row.test.ts#makeRow`](../tests/ui/page-comment-row.test.ts#makeRow)：断言各列计算样式匹配新的 `--step: 32px`、`--slot-center: 19px`。

### 7.2 真机与行为规格验收对照表 (L4 `tests/test-suite.md`)

开发人员在真实 Chrome/Edge 浏览器载入 `dist/`，逐项对照 [`tests/test-suite.md`](../tests/test-suite.md) 验收：

| 规格 ID | 验收场景 | 关键判据与预期结果 | 锚点指引 |
|---|---|---|---|
| [`SCROLL-03`](../tests/test-suite.md#SCROLL-03) | 滚动槽位高度只增不减 | 连续向下滚动加载多页，槽位高度单调递增，无任何视口回弹或打回现象 | `EmbeddedComments.vue#reportHeight` |
| [`SCROLL-05`](../tests/test-suite.md#SCROLL-05) | 行序 = 取回顺序 | 加载下一页新评论时，新行只追加在末尾，已读行坐标不漂移 | `docs/adr/0004-reader-row-order-append-only.md#决策` |
| [`SCROLL-07`](../tests/test-suite.md#SCROLL-07) | 到底后自动铺开剩余行 | 翻到最后一页时，剩余行自动铺开，不残留手动“继续显示”按钮 | `EmbeddedComments.vue#revealAllRows` |
| [`RDR-03`](../tests/test-suite.md#RDR-03) | 单滚动条与长评论完整 | 宿主只有一根滚动条，iframe 内部无独立滚动条，长评论正文完整展开 | `tests/test-suite.md#RDR-03` |
| [`RDR-06`](../tests/test-suite.md#RDR-06) | 作者入口复刻原生 | 悬停作者出原生 `bili-user-profile` 卡片；点击头像正常新标签打开主页 | `docs/adr/0005-native-author-entries-via-site-component.md#决策` |
| [`WRITE-01`](../tests/test-suite.md#WRITE-01) | 点赞交互与乐观更新 | 点赞触发 Spring 弹跳微动效，数字 Pop 回弹，意图正常投递至宿主 | `tests/test-suite.md#WRITE-01` |

### 7.3 防腐自检 (`npm run docs:check`)

修改代码或文档后，必须执行防腐检查命令：
```powershell
npm run docs:check
```
确保所有符号引用与链接均有效解析，退出码为 0。
