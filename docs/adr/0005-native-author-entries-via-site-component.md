# ADR-0005: 作者入口复刻原生 —— 主页链接走标准 `<a>`，用户卡片复用站点自己的组件

## 日期
2026-10-14

## 状态
accepted

## 背景
页面替换阅读器把原生评论区换成扩展源 iframe 里的自绘评论。原生评论区里作者有两处入口：

- **点击头像 / 昵称** → 打开该用户主页：原生是 `<a target="_blank" href="//space.bilibili.com/<mid>">`（实机读元素面板 + 站点 bundle 模板双重确认）。
- **悬停头像 / 昵称** → 弹出用户卡片：站点自己的自定义元素 `bili-user-profile`（Lit 组件），自己取数（实测 `GET /x/web-interface/card?mid=…`）、自己定位与翻转、自带关注 / 发消息按钮与粉丝数。

需求是「复刻原版就行，无需自己实现」。关键约束：

- **iframe 是独立文档**：站点把 `bili-user-profile` 定义在**页面那份**自定义元素注册表里，嵌入页拿不到；即便在嵌入页里 `document.createElement('bili-user-profile')`，那也只是个空壳（没有 `setup`）。
- **隔离世界也拿不到**：实测在内容脚本的隔离世界里 `customElements.get('bili-user-profile')` 为 `undefined`、`createElement` 出来的实例没有站点方法（隔离世界有自己的注册表）。只有**主世界**能驱动它。
- 自绘卡片意味着复刻一份会随站点改版过期的 UI（头像/等级/勋章/粉丝数/关注态/私信入口），成本与腐烂速度都不可接受。

## 决策
**两处入口各自找「复刻成本最低的宿主机制」，都不自绘。**

1. **点击 → 标准链接**：作者模型加 `Author.profileUrl?`（适配器归一化时给出 `https://space.bilibili.com/<mid>`），阅读器把它渲染成 `<a target="_blank" rel="noopener noreferrer">`。不需要跨世界消息、不需要权限（`host_permissions` 已覆盖 `*.bilibili.com`），浏览器自己开新标签，与原生一致。平台没给地址时（其它平台 / mid 不合法）同一个元素降级成 `span`：不是链接、不参与卡片交互。
2. **悬停 → 复用站点组件**：嵌入页只报「谁（mid）+ 头像/昵称在嵌入文档里的位置」，三层转发到位后由主世界驱动站点元素：
   `PageCommentRow` → `EmbeddedComments`（`READER_USER_CARD`，`rect: null` = 离开）→ 内容脚本隔离世界（校验发送方 + 把嵌入文档坐标换算成宿主视口坐标）→ `USER_CARD_BRIDGE_SOURCE` → 主世界 `content/user-card.ts`：造一个**不可见的参考元素**（`pointer-events:none; opacity:0`）、按坐标摆好、`card.setup(参考元素)`、派发 `mouseenter`/`mouseleave`。
   站点元素随后自己取数、自己渲染、自己处理「指针移到卡片上就保持打开」（实测：移到卡片上卡片不关，移开才关）。站点元素不存在（改版/未加载）时**整体放弃**，绝不半渲染自制卡片。

收起消息**带 mid**（`{type:'hide', mid}` 只关这一位；不带 mid 的 `{type:'hide'}` 是全局收起：槽位被拆、宿主滚动）。缺了身份这一条的后果真机才暴露：守卫按契约要求 `mid`，嵌入页最初在离开时不带它 ⇒ 卡片永远关不掉（见 `.context/LESSONS.md` L-12）。

## 依据（实测）
- 原生昵称/头像的 DOM：`<div id="user-name" data-user-profile-id="<mid>">` 内嵌 `<a target="_blank" href="//space.bilibili.com/<mid>">`；`#user-avatar` 同理（站点 bundle `bili-comments.js` 的模板 + 实机元素面板 dump `tmp/slice00.png`）。
- 卡片可外部驱动（页面主世界实测）：`card.setup(ref)` + `ref[data-user-profile-id]` + 派发 `mouseenter` ⇒ `card.uid` 就位、发起 `/x/web-interface/card?mid=…`、shadow DOM 渲染出「昵称 / 关注 / 粉丝 / 获赞 / 签名 / 关注 / 发消息」，`getBoundingClientRect()` = 366×254；换 mid 只需改属性再派发；`mouseleave` 收起；**未登录也可用**。
- 隔离世界不可驱动（实测）：`customElements.get('bili-user-profile') === undefined`，`typeof card.setup === 'undefined'`。
- 真机端到端（扩展 `dist` 装载、阅读器已替换评论区）：悬停阅读器头像 ⇒ 宿主页面出现 `bili-user-profile`，`uid=703148042`、名字与悬停行一致；移开作者 ⇒ `card.hide()` 且高度归零；移到卡片上 ⇒ 保持打开；点昵称 ⇒ 新标签 `https://space.bilibili.com/703148042`。

## 后果
- 正面：卡片内容、样式、关注/私信行为全是站点实现 ⇒ 不会随站点改版腐烂；「指针移到卡片上保持打开」这类细节也是站点自己的逻辑，天然一致。点击路径零桥、零权限。
- 负面 / 代价：卡片依赖站点内部实现（元素名 `bili-user-profile` + `setup()` + `data-user-profile-id` 属性）。任何一条消失 ⇒ 悬停卡片静默不出现（点击开主页不受影响）。探针无法在「站点元素不存在」的环境里验证渲染，只能验证「安静地什么都不做」。
- 遗留：卡片锚在宿主视口坐标上，宿主一滚就与头像对不上 ⇒ 宿主滚动 / 指针移出槽位 / 槽位被拆时由内容脚本做全局收起（`dismissUserCard`）。站点自己的迷你播放器遮罩（`div.bili-mini-mask`，z-index 10010）会吞掉整页指针事件，那时阅读器和原生评论区一样不可交互——站点行为，不修。

## 备选方案（关键）
- **自绘卡片**（自己取 `/x/web-interface/card` 并画 UI）：需要复刻等级/勋章/粉丝数/关注态/私信/明暗/多语言，且这些会随站点改版过期 ⇒ 放弃。
- **让站点自己弹**（对隐藏的原生作者节点派发 hover）：原生评论区被 `display:none`，锚点矩形为 0，卡片位置无从计算；且动原生 DOM 与我们「只改呈现、可精确还原」的约定冲突 ⇒ 放弃。
- **在嵌入页里放 `bili-user-profile`**：跨文档拿不到站点注册表（见背景）⇒ 不可行。
- **点击走 `chrome.tabs.create`**：多一个权限面与一次异步调用，而标准 `<a target="_blank">` 与原生完全一致 ⇒ 放弃（`chrome.tabs.create` 仍是「打开落地页」类操作的选择，见 `src/ui/store.ts#openLoginPage`）。
