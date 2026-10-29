# Loupe 前端样式与交互现代化交接手册 (Handoff Guide)

> 本文档已正规归档至工程文档体系，完整规范与实施细则请查阅：
> 👉 **[`docs/handoff.md`](docs/handoff.md)**

## 快速导航

- **改版成果与痛点修复**：[docs/handoff.md#1-改版成果与核心问题溯源-executive-summary](docs/handoff.md#1-改版成果与核心问题溯源-executive-summary)
  - 彻底解决树形连接线未居中（Center-to-Center）
  - 彻底解决鼠标 Hover 逐段高亮切割主干（Unbroken Visual Trunk）
  - 彻底解决多级嵌套断线与缺线（Continuous Spine Propagation）
  - 还原经典「青墨 (Teal & Ink)」默认配色与 5 套动态主题令牌
- **第一阶段：设计令牌与主题系统改造**：[docs/handoff.md#2-第一阶段设计令牌与主题系统改造](docs/handoff.md#2-第一阶段设计令牌与主题系统改造)（`src/ui/styles/tokens.css`）
- **第二阶段：树形算法与脊线数据结构改造**：[docs/handoff.md#3-第二阶段树形数据结构与脊线算法改造](docs/handoff.md#3-第二阶段树形数据结构与脊线算法改造)（`src/ui/thread.ts`）
- **第三阶段：评论行组件深度改造**：[docs/handoff.md#4-第三阶段评论行组件深度重构-pagecommentrowvue](docs/handoff.md#4-第三阶段评论行组件深度重构-pagecommentrowvue)（`src/ui/components/PageCommentRow.vue`）
- **第四阶段：嵌入式阅读器容器改造**：[docs/handoff.md#5-第四阶段页面内嵌阅读器容器改造-embeddedcommentsvue](docs/handoff.md#5-第四阶段页面内嵌阅读器容器改造-embeddedcommentsvue)（`src/ui/EmbeddedComments.vue`）
- **第五阶段：工作台与图谱改造**：[docs/handoff.md#6-第五阶段工作台与图谱改造-forcegraphvue--threaddetailcardvue](docs/handoff.md#6-第五阶段工作台与图谱改造-forcegraphvue--threaddetailcardvue)（`src/ui/components/ForceGraph.vue`）
- **第六阶段：自动化测试与真机验收清单**：[docs/handoff.md#7-第六阶段自动化测试与防腐验收清单](docs/handoff.md#7-第六阶段自动化测试与防腐验收清单)（`tests/test-suite.md`）

---
*基准原型验证文件：`tmp/mock-redesign.html`（基于 BV1DXaG6TETt 312 条全量评论数据集）*
