# Loupe 开发约定

- 工程：`E:/Codes/AI/projects/loupe`；旧代次只读归档，不参与构建。
- 安装 `npm ci`；检查 `npm test`、`npm run typecheck`；构建 `npm run build`，在 Chrome/Edge 加载 `dist/`。
- TypeScript 6 + Vue 3；升级 TS 7 前确认 vue-tsc 的 JavaScript API 兼容性。
- 平台适配器只处理输入、鉴权、原始协议与归一化。新增平台同步 `PlatformId`、注册数组、主机权限及平台行为测试。
- “全量”默认上限 0；正数上限必须显式标记不完整。单评论分析只包含选中节点及其后代。
- 公共数据与模型输出都在边界校验；Cookie 不导出，密钥不进入日志、测试夹具、快照或缓存键。
- 修改缓存格式递增 schema；缓存故障不能阻断回源。快照复用必须满足身份、范围、上限与刷新策略。
- UI 验收使用实际扩展页，覆盖侧栏窄宽、整页、首次网络与历史重开；单测不代替运行证明。
- 临时文件只进 `tmp/`，验收后删除。团队成员默认使用用户指定的 r4/deepseek-v4.1-flash；网络访问按本机代理配置。
- 架构地图见 `docs/README.md`；修改对应契约时同步文档，不复制整份说明。
