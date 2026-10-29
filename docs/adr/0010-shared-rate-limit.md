# ADR-0010：跨文档共享令牌桶限速

## 状态

已接受（2026-10-29）。

## 背景与问题

工作台整页、图谱弹窗、每个视频页的阅读器 iframe 是**不同扩展文档**，各自有独立的 `PoliteQueue`
（并发 3 / 间隔 250ms）。多枚标签页同开时，对 api.bilibili.com 的总请求率是「礼貌值 × 文档数」——
不符合「像一个正常浏览网页的人」的友好抓取目标，也容易触发风控（-352/-412）。

## 决策

`src/core/rate-limit.ts`：令牌桶状态 `{tokens, updatedAt, cooldownUntil, strikes}` 存
`localStorage`（键 `loupe.rate.<platform>`），每次读-补充-取-写包在
`navigator.locks.request('loupe-rate|<platform>')` 的短临界区里；需要等待时先放锁再睡再重试。
Bilibili 默认：`ratePerSec 1 / burst 3 / 并发 2 / reserve 1`。

- **优先级**：`request` 带 `'interactive' | 'bulk'`（workbench 的 analyze* 走 bulk，预览/定位/会话
  走 interactive）。bulk 只在 `tokens >= 1 + reserve` 时取——跑全量时读者永远拿得到令牌。
- **缓存命中不取令牌**：只有 `CrawlRunner.request` 进桶，与「命中即零成本」的既有契约一致。
- **冷却**：rate-limited → `strikes++`，`cooldownUntil = now + max(retryAfterMs, 30s·2^(n-1))`
  封顶 10min，全文档共享；成功后 strikes 清零。
- **线程池**：`crawlSubject`/`crawlRootsPage` 的按批切片换成 N 个 worker 循环取任务，无队头阻塞。
- **可恢复**：`LoadOptions.freshAfter`（`storedAt >= freshAfter` 才算命中）；全量/增量起跑写
  `pointer|crawl-run|<subject>|<account>|<order>` 检查点、成功即删——中断轮已抓页在下轮
  （页 TTL 10min 内）直接命中。

## 依据

- localStorage 在扩展页与扩展源 iframe 间同源共享（2026-10-29 实测）；Web Locks 同样跨文档
  （ADR-0008 配套的单飞锁已在用，同一锁空间）。IndexedDB 存根作为备选更慢且要持连接，
  localStorage 同步 API 在锁内读写零竞争。
- 1 rps/burst 3 ≈ 人类滚动翻评论的速度上限；并发 2 避免单文档打满。

## 后果

- `Politeness.minIntervalMs` 保留字段但队列不再消费（桶取代间隔职责）。
- 锁/store 失败降级为进程内存根（单文档自洽，不放大速率）。
- withRetry 保留自己的重试计数，但其 sleep 不会低于共享冷却——下一次 acquire 会睡到冷却结束。
