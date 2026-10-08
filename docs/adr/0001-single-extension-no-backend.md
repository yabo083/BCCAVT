# ADR-0001: 单一浏览器扩展承载鉴权、抓取、分析与可视化

## 日期
2026-10-09

## 状态
accepted

## 背景
第一代 BCCAVT 由四个独立部件拼成：Cookie 导出扩展（BiliCookiesHelper）→ Python 爬虫后端（FastAPI + Celery + Redis）→ JSON 文件 → Next.js 可视化站点；另有一个只嗅探页面请求的侧边栏原型（logic-scalpel）。用户要手动导 Cookie、起后端、搬文件，任何一环过期整条链就断；嗅探方案只能拿到用户滚动到的那几页。

## 决策
我们选择：**一个 MV3 扩展，主动调用平台 API，所有计算在扩展页内完成**。
- 鉴权 = 浏览器现有登录态：扩展页 `fetch(..., { credentials: 'include' })` 自动带 Cookie；平台要求的 Origin/Referer 由 declarativeNetRequest 会话规则改写，规则限定 `initiatorDomains = [扩展 id]`，不影响用户正常浏览。
- 抓取、建树、统计、可视化、AI 调用都运行在侧边栏 / 整页（同一个 `app.html`）里；后台 Service Worker 只做右键菜单、意图转发、规则下发。

## 后果
- 正面：安装即用；Cookie 从不离开浏览器；没有服务器要部署和维护；数据就近缓存在 IndexedDB。
- 负面 / 代价：抓取生命周期绑定在页面上——关闭侧边栏会中止抓取（已抓分页在缓存里，下次续上）；大视频受单机速率限制；必须持续跟进平台风控变化（集中在适配器里）。

## 备选方案（关键）
- **保留 Python 后端 + 扩展只导 Cookie**：Cookie 外传有泄露面，部署成本高，正是旧版"复活不了"的原因 → 放弃。
- **内容脚本嗅探页面自己的评论请求**（logic-scalpel）：只能拿到用户滚到的页面，无法全量，也无法做单树分析 → 放弃。
- **抓取放在 Service Worker**：MV3 SW 空闲 30 s 即被回收，长抓取需要保活技巧，调试也更难；页面上下文足够且直观 → 放弃。
- **抓 DOM**：受懒加载、热度排序、Shadow DOM 影响，数据有偏且易碎（见 llmwiki [[Bilibili Authenticated Comment Extraction]]）→ 放弃。
