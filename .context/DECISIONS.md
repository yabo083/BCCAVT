# 决策索引（L1）

> 详细论证在 `docs/adr/*`（那里有背景/决策/后果/备选方案）；本文件只做索引与「还没写成 ADR 的取舍」。
> 新增架构级取舍：写 `docs/adr/NNNN-<slug>.md`，然后在这里登记一行，并在 `docs/README.md` 的架构地图里挂上。

## 已归档

| 编号 | 决策 | 一句话 | 状态 |
|---|---|---|---|
| [0001](../docs/adr/0001-single-extension-no-backend.md) | 单扩展、无后端 | 放弃后端与请求嗅探：抓取/分析/写操作全在扩展内完成 | accepted |
| [0002](../docs/adr/0002-platform-adapter-seam.md) | 平台适配器接缝 | 6 成员 `PlatformAdapter` + 平台无关领域模型；放弃动态插件框架 | accepted |
| [0003](../docs/adr/0003-reader-infinite-scroll.md) | 阅读器无限滚动契约 | 游标状态机 + 哨兵/视口边沿触发 + 已提交高度不缩；放弃「重跑全量抓取」与「客户端推断到底」 | accepted |
| [0005](../docs/adr/0005-native-author-entries-via-site-component.md) | 作者入口 | 点击开主页用标准 `<a href=space.bilibili.com/<mid>>`；悬停卡片复用站点自己的 `bili-user-profile`（主世界驱动，不自绘） | accepted |
| [0004](../docs/adr/0004-reader-row-order-append-only.md) | 阅读器行序 | 顶层顺序 = 取回顺序（渲染层只追加），放弃按 `createdAt` 二次排序；同批把 `READER_NAVIGATION` 的重置条件收敛到**目标身份**（ADR-0003 的 2026-10-14 补充） | accepted |
| [0006](../docs/adr/0006-reader-spine-geometry.md) | 阅读器视觉体系 | 连接线锚在头像几何中心（`Xc(col) = --indent-base + col × --step + --slot-center`），脊线由 `flattenThread` 输出、视觉列封顶 3；放弃行级悬停高亮线色与分支 grid 折叠抽屉 | accepted |
| [0007](../docs/adr/0007-theme-palette-tokens.md) | 可插拔配色 | 配色与明暗正交，只覆盖 accent 系五个令牌；5 套预设走 `data-palette` 属性选择器，自定义走内联变量，存 `loupe.palette`；放弃 `light-dark()`（Chrome 116 下限） | accepted |
| [0008](../docs/adr/0008-locate-in-reader.md) | 评论区定位协议 | 工作台/图谱 → 后台按视频身份挑标签页 → 内容脚本转发 → 阅读器展开折叠/抬渲染上限/滚动闪烁；不在已读范围就照实提示 | accepted |

## 尚未写成 ADR 的取舍（触发条件出现再补）

- **2026-10-12 采纳 CDC（共置声明式上下文工程）作为本项目的上下文组织方式**：L0 `AGENTS.md`（规则+路由表）、L1 `.context/` 与 `roadmap.md`、L2 模块 `README.md`、L3 模块 README 内嵌 mermaid、L4 `tests/test-suite.md`。与「团队为先」正交：CDC 管上下文怎么组织，团队元原则管谁去干。实测口径（llmwiki `[[CDC vs Swarm 模式实测对比]]`）：小库上 CDC 净成本更高，收益是可持续文档资产；随代码库增大天平向 CDC 倾斜（未实测）。
- **页面按钮 icon-only**：按钮只画图标，可访问名走 `aria-label`/`title`，命中区固定 24×24 —— 行内布局不随文字宽度跳动。
- **按钮不挂事件监听**：点击由隔离世界在真实事件里同步 `sendMessage`；异步桥会让 `sidePanel.open` 被拒（用户激活必须留在点击事件里）。
- **原生 CSS 增强保留但未接线**：`native-comments-style.ts` / `native-thread.ts` 被「替换评论区」取代，暂不删（待 UI 落定后清理并迁移测试）。
- **预览路径不落快照**：阅读器只做有限预览；全量分析与历史快照只在放大镜打开的独立窗口里产生。
- **评论行放大镜不按评论量判定**：能解析出 rpid 的原生评论操作行一律注入放大镜，「分析评论区」（视频级）与「分析评论树」（评论行）两个按钮都不受数量控制；自绘阅读器里的「图谱」入口总是渲染、默认隐于行右端，悬停该行或该行被选中才显现（不占版面、不与操作行抢宽度）。
- **视频页按钮的宿主容器一次性追加**：按钮先装进自有 `.loupe-host` 再整体插入原生操作行 —— 站点那侧只此一次写入，此后容器内部怎么变都与站点无关。
