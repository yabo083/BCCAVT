# Loupe 开发约定与上下文路由（L0）

> 本文件是进项目的唯一入口：**高密度规则 + 导航**。按下面的路由表**增量加载**，不要通读 `src/`。
> 上下文分层：L0 本文件 → L1 `roadmap.md` / `.context/` → L2 模块 `README.md` → L3 模块 README 内嵌 mermaid → L4 `tests/test-suite.md`。

## 工程与命令

- 工程：`E:/Codes/AI/projects/loupe`；旧代次只读归档，不参与构建。
- 安装 `npm ci`；检查 `npm test`、`npm run typecheck`；构建 `npm run build`，在 Chrome/Edge 加载 `dist/`。
- **上下文触发**：`npm run context:trigger`（按当前 Git Diff 自动输出必读声明、测试规格与陷阱；规则数据在 `.context/rules.json`，工具本体在 `assets/agents/cdc/`）。
- **防腐自检**：`npm run docs:check`（校验符号锚点 `#symbol` 与引用存在性，失效硬失败）。
- TypeScript 6 + Vue 3；升级 TS 7 前确认 vue-tsc 的 JavaScript API 兼容性。
- 架构地图见 `docs/README.md`；决策记录在 `docs/adr/`（索引见 `.context/DECISIONS.md`）。
## 上下文路由表（按任务先读什么）

| 任务 | 先读 | 再按需读 |
|---|---|---|
| 改抓取 / 缓存 / 分页 / 快照 | `src/core/README.md` | `docs/adr/0002`、`docs/adr/0003`、`tests/test-suite.md` 的 `CORE-*` |
| 改页面注入 / 内容脚本 / 桥消息 | `src/extension/README.md` | `docs/architecture/01-context.md`、`tests/test-suite.md` 的 `INJ-*` / `RDR-*` |
| 改阅读器 / 滚动 / UI 承载面 | `src/ui/README.md` | `docs/adr/0003`、`tests/test-suite.md` 的 `SCROLL-*` |
| 改平台适配器 / 新增平台 | `src/core/README.md`（接缝那节） | `docs/adr/0002`、`src/platforms/bilibili/*` |
| 发版 / 上架 | `docs/publishing.md` | `roadmap.md` 最近一节、`.context/STATE.md` |
| 定位历史 bug / 想知道「为什么这样写」 | `.context/LESSONS.md` | `docs/adr/*`、`roadmap.md` 对应小节 |
| 真机排障 / 复现 | `.context/STATE.md` | `roadmap.md` 最近一节 |

## 硬约束（红线）

- 平台适配器只处理输入、鉴权、原始协议与归一化。新增平台同步 `PlatformId`、注册数组、主机权限及平台行为测试。
- “全量”默认上限 0；正数上限必须显式标记不完整。单评论分析只包含选中节点及其后代。
- 公共数据与模型输出都在边界校验；Cookie 不导出，密钥不进入日志、测试夹具、快照或缓存键。写操作的 CSRF 只在写执行点从 cookie 现读现用，不跨桥、不留存。
- 修改缓存格式递增 schema；缓存故障不能阻断回源。快照复用必须满足身份、范围、上限与刷新策略。
- **写页面 DOM 前必须先过「window load + 文档里再无 `data-server-rendered`」两道门**（水合前插节点会让站点 SSR hydration 失配、页头二次 init、顶部 header 变空）。判据与证据见 `src/extension/README.md` 与 `.context/LESSONS.md`。
- UI 验收使用实际扩展页，覆盖侧栏窄宽、整页、首次网络与历史重开；**单测不代替运行证明**。
- 临时文件只进 `tmp/`，验收后删除；不留 TODO / 占位 / 死代码。团队成员默认使用用户指定的 `r4/deepseek-v4.1-flash`；网络访问按本机代理配置（`http://127.0.0.1:7890`）。

## 工作循环（CDC：触发 → 增量加载 → 改码 → 同步 → 回写）

1. **触发与路由**：执行 `npm run context:trigger`（或查阅路由表）精确定位必读模块 README + ADR + 规格，绝不全量读源码。
2. **改码与同步**：改动同时同步对应模块 README 的接口/决策段与 `tests/test-suite.md` 受影响规格。**防腐铁律：引用一律采用符号锚点 `文件#符号名`（指名不指位），严禁使用易漂移的物理行号**。
3. **验证**：`npm test` + `npm run typecheck` + `npm run build` + **`npm run docs:check`**（符号失效硬失败、文档过期告警）；注入/UI/滚动类改动必须真机验收（见 `.context/STATE.md` 的「真机验收方法」）。
4. **回写记忆**：新的根因/修复追加 `.context/LESSONS.md`；状态变更更新 `.context/STATE.md`；架构级取舍写 `docs/adr/NNNN-*.md` 并登记进 `.context/DECISIONS.md`；阶段目标写 `roadmap.md`。
5. **收尾**：清 `tmp/`、删临时脚本、把结论落到上面四处之一，而不是留在对话里。

## 提示词收敛基准（勿写冗余提示词）

向本文件或文档层追加任何段落前，先做五问（Where should this live?）：
1. **Scope？** 能否下沉到子模块 README 或目录级子指令，只在进入时读取？
2. **Pointer？** 代码或现有文档已有的东西，能否只给执行流地图或符号指针？
3. **Tool？** 能否做成自动化脚本、测试断言或类型约束（机制优于祈求）？
4. **Skill？** 是否属于低频长流程，能否剥离为冷存技能并声明严格调用签名？
5. **Trigger？** 能否通过 Git Diff 规则表由 `context:trigger` 自动挂载？
> **唯一正当性（The Traps）**：本文件只保留代码与类型系统无法表达的非直觉工程陷阱与绝对红线。
