# ADR-0006: 阅读器视觉体系 —— 头像中心对齐的脊线几何、视觉列封顶与克制动效

## 日期
2026-10-14

## 状态
accepted

## 背景
页面替换阅读器的评论行用「讨论串连接线」表达回复关系。旧实现（`PageCommentRow.vue` 的 `spineCols`/`endsColumn` + `--run` 近似）有三个实地可见的毛病：

1. **线不落在头像几何中心**：竖脊画在「父头像左缘再往右 `--step - --run`」处，离父头像中心差 3–4px（顶层 4px、楼中楼 3px）；elbow 的横段也只接到子头像**左缘**。放大看就是线没插进圆里。
2. **悬停把主干切成碎段**：`.comment-row:hover { --line: … }` 让**当前行**的那一小截线变色。树是连续的，逐段高亮 → 观感像断了。
3. **多级嵌套断线/缺线**：竖脊在哪一行收口由「按绝对深度逐列推断」决定（`endsColumn` 沿父链判末位）。折叠会跳过整棵子树，于是「深度」与「列」不再对应，推断随之失准，出现悬空半截线或整段缺失。

同期（同一轮前端改版）需要一个可插拔的配色轴（见 [ADR-0007](0007-theme-palette-tokens.md)）与一套克制的动效语言。视觉基准是已通过真实数据验证的原型 `tmp/mock-redesign.html`（312 条真实评论、180 根 + 132 楼中楼）。

## 决策
1. **列中心方程**：以头像槽为原点定义
   $$X_c(k) = \texttt{--indent-base} + k \times \texttt{--step} + \texttt{--slot-center}$$
   （`--slot-center` = 头像槽半宽，19px）。行内边距左侧 = `--indent-base + col × --step`，缩进后**第一个子元素就是头像槽**（`.avatar-slot`，38px 固定，圆形头像在槽内居中）。竖脊 / stem / elbow 的每一条 `left` 都由 `X_c` 推导，不引入第二套近似（旧的 `--run` 与 `.fold-spacer` 一并删除）。
2. **脊线由纯逻辑算好，渲染层只照着画**：`thread.ts#flattenThread` 每行输出 `col`（视觉列）、`parentCol`（父列）、`rowSpines`（本行要穿过去的祖先列，升序）。规则：同辈中**非末位**的节点，其 `parentCol` 必须穿透本行**以及它的全部后代**（`nextSpines` 里加的是父列）；末位节点不再向下传。这正是「断线/缺线」的根因位置——收口是树结构问题，不该在渲染层按深度猜。
3. **视觉列封顶 `MAX_VISUAL_DEPTH = 3`**：更深的回复并到第 3 列（原来的 6 列在窄屏把正文挤没），真实深度只用于「第 N 层」提示。**封顶行（`col === parentCol`）不画 elbow**——原型的 `Math.max(1, col - parentCol)` 会画出一段 32px 的横向悬空尾巴；改为画一根竖直连接段（`.line.capped`，从本行上沿接到自己头像中心），把上方来线接住即可。
4. **取消行级悬停对线色的劫持**：线色恒为 `color-mix(in srgb, var(--border-strong) 70%, var(--fg-subtle))` 的中性色；选中只给极浅的 accent 底（8%）+ 该行自己的 elbow/stem 转 accent 色。
5. **动效走既有令牌，不新造一套**：`--ease-spring`（M3 弹簧曲线）、`--dur-micro/fast/dock` 已有；点赞图标 `like-spring`、计数 `num-bounce`（首帧不播）、定位 `row-flash`、回复抽屉用纯 CSS `grid-template-rows: 0fr → 1fr`（**不测高**、不做 JS 高度计算）。`base.css` 的 `prefers-reduced-motion` 统一收口，不另写降级。
6. **不做「楼中楼分支的 grid 折叠抽屉」**：原型用 `.branch-collapse-accordion`（1fr→0fr）包住整棵子树做折叠动画，但阅读器是**扁平分批列表**（`listRows = rows.slice(0, rowCap)`），折叠 = 从行集里移除（ADR-0003/0004 的「只追加 + 已提交高度不缩」契约）。把折叠中的子树留在 DOM 里，就会与高度上报、渲染上限和行序契约同时打架，收益只是一个 260ms 的动画 ⇒ 只保留「折叠时本行 stem 淡出」（元素常驻、靠 `.branch-collapsed` 调 `opacity`）。

## 依据（实测）
- 原型逐字取值：`--step: 32px`、`--indent-base: 16px`、`--avatar-slot: 38px`、`--slot-center: 19px`、`--line-w: 2px`、`--pad-top: 14px`（楼中楼 10px）、`border-bottom-left-radius: 10px`；640px 断点收敛为 `20px/8px/30px/15px`。
- **真机几何探针**（本机 Chrome 140 + `tmp/rows.html` 临时脚手架：真实 `PageCommentRow` + 真实 `flattenThread`，13 行人工树，含 7 层深链、多兄弟、光杆根）：逐行断言全过——
  - 头像中心 == `X_c(col)`（误差 ≤ 1px，含封顶行）；
  - elbow 左缘 == `X_c(parentCol)`、右端 == 子头像中心（误差 ≤ 1.5px）、高度 == `--pad-top + --slot-center + 1`；
  - 封顶行无 elbow、有 `.capped` 段（高度 == 同式，上沿贴本行上沿、下沿落在自己头像中心）；
  - `--col` 竖脊**贯穿整行**（上下各溢出 1px 盖住行间接缝）；
  - 同一列上「through spine / stem / capped」首尾相接：第 3 列（封顶列）**零断口**。
- 视觉复核（同页截图）：浅色青墨 / 深色哔哩粉 / 自定义紫三套配色下几何一致；折叠 a1 后子树消失、本行 stem 淡出；a2 打开回复抽屉后 `grid-template-rows` 落到实高。

## 后果
- 正面：连接线与头像几何严格对齐；主干连续、不再被悬停切段；折叠/封顶/多级嵌套下不再断线；几何参数集中在行内变量上，窄屏只改四个变量。
- 代价 / 负面：`rowSpines` 是渲染层必须照单执行的数据（改算法要同步改模板）；封顶后深度 > 3 的回复在视觉上同列，层级语义只剩「第 N 层」提示；`data-comment-id` 被写进行元素（原为「避免为观测改生产 DOM」而刻意不写），现在它同时服务定位协议（[ADR-0008](0008-locate-in-reader.md)）。
- 遗留：动效只在真机截图上复核，未做帧率/长列表（1000+ 行）的滚动流畅度实测（`roadmap.md` 待办）。

## 备选方案（关键）
- **继续用 `--run` 近似 + 接到头像左缘**：错位是像素级的但肉眼可见（原型明确要 center-to-center）⇒ 放弃。
- **保留「行级 hover 高亮线色」**：与「主干连续」的观感直接冲突 ⇒ 放弃。
- **渲染层按深度推断裂线收口（旧 `endsColumn`）**：折叠会让深度 ≠ 列号，推断必然失准 ⇒ 放弃，改由展平算法输出 `rowSpines`。
- **保留 6 列封顶**：窄屏（390px）下正文可用宽度不足 ⇒ 放弃，改 3 列 + 「第 N 层」提示。
- **楼中楼分支 grid 抽屉**：见决策 6 ⇒ 放弃（与 ADR-0003/0004 的高度与行序契约冲突）。
