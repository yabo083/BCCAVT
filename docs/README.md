# 架构文档

| 文件 | arc42 对应内容 |
|---|---|
| [上下文](architecture/01-context.md) | §3 外部边界与接口 |
| [目标与约束](architecture/02-goals-constraints.md) | §1、§2、§10 |
| [构件与运行时](architecture/03-building-blocks.md) | §5、§6、§8 |
| [单扩展决策](adr/0001-single-extension-no-backend.md) | §9：放弃后端与请求嗅探 |
| [平台接缝决策](adr/0002-platform-adapter-seam.md) | §9：放弃动态插件框架 |
| [阅读器无限滚动契约](adr/0003-reader-infinite-scroll.md) | §9：放弃重跑全量抓取与客户端到底推断 |
| [阅读器行序决策](adr/0004-reader-row-order-append-only.md) | §9：放弃把顶层评论按时间二次排序 |
| [作者入口复用站点组件](adr/0005-native-author-entries-via-site-component.md) | §9：放弃自绘用户卡片与跨 document 复用站点元素 |
| [阅读器脊线几何](adr/0006-reader-spine-geometry.md) | §9：放弃按深度推断线尾、行级悬停高亮与 6 列封顶 |
| [可插拔配色令牌](adr/0007-theme-palette-tokens.md) | §9：放弃 `light-dark()` 与「单一 hue 推导深浅」 |
| [评论区定位协议](adr/0008-locate-in-reader.md) | §9：放弃「阅读器自己找评论」与工作台直连标签页 |

§7 部署并入项目 README；§11 风险并入约束与决策后果；§12 术语由 TypeScript 领域契约承载。没有独立服务器，不设置运维文档或空模板。

## 上下文层（CDC：按任务增量加载，别通读源码）

| 层 | 文件 | 什么时候读 |
|---|---|---|
| L0 | [`AGENTS.md`](../AGENTS.md) | 每次会话：规则 + **任务路由表** |
| L1 | [`roadmap.md`](../roadmap.md)、`.context/{DECISIONS,STATE,LESSONS}.md` | 规划 / 复盘 / 定位历史 bug（决策索引、当前状态、踩坑根因） |
| L2 | [`src/core/README.md`](../src/core/README.md)、[`src/extension/README.md`](../src/extension/README.md)、[`src/ui/README.md`](../src/ui/README.md) | 改对应模块前（接口契约 + 关键决策 + 已知坑） |
| L3 | 各模块 README 内嵌的 mermaid | 理解分页状态机、注入器两道门、跨世界消息链 |
| L4 | [`tests/test-suite.md`](../tests/test-suite.md) | 改行为 / 写测试前（文字版行为规格，单一事实来源） |

术语表：[`domain-glossary.md`](domain-glossary.md)。
