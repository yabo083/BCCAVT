# FastAPI + Celery B站评论爬虫后端 v2.0

这是一个基于 FastAPI 和 Celery 的 B站评论爬虫后端服务，支持异步任务处理和实时状态查询。

## 🚀 主要特性

- **异步处理**: 基于 Celery 的任务队列，支持高并发爬取
- **实时状态**: 支持任务进度实时查询
- **Cookie支持**: 前端可传入自定义Cookie，无需预先配置
- **文件下载**: 完成后提供直接下载链接
- **现代API**: 基于 FastAPI，自动生成API文档
- **树形数据**: 直接构建评论树形结构，无需中间文件

## 📦 技术栈

- **FastAPI**: 现代、快速的Web框架
- **Celery**: 分布式任务队列
- **Redis**: 消息队列和结果后端
- **Pydantic**: 数据验证和序列化
- **bilibili-api**: B站API库

## 🛠️ 安装部署

### 1. 环境要求

- Python 3.8+
- Redis Server

### 2. 安装依赖

```bash
pip install -r requirements.txt
```

### 3. 启动服务

**Windows (推荐使用PowerShell脚本):**

```powershell
.\start.ps1
```

**手动启动:**

```bash
# 启动 Redis
redis-server

# 启动 Celery Worker
celery -A celery_app worker -l info -P gevent -E

# 启动 FastAPI 服务
uvicorn fastapi_app:app --host 0.0.0.0 --port 8000 --reload
```

## 📚 API 接口

### 1. 提交爬取任务

- **URL**: `POST /api/crawl`
- **功能**: 提交 B站视频爬取任务
- **请求体**:
  ```json
  {
    "bv_id": "BV1AYKgzAE68",
    "cookie": {
      "sessdata": "your_sessdata_here",
      "bili_jct": "your_bili_jct_here",
      "buvid3": "your_buvid3_here",
      "dedeuserid": "your_dedeuserid_here",
      "ac_time_value": "your_ac_time_value_here"
    }
  }
  ```
- **响应**:
  ```json
  {
    "task_id": "uuid-string",
    "message": "任务已提交，正在处理中...",
    "status_url": "/api/status/uuid-string"
  }
  ```

### 2. 查询任务状态

- **URL**: `GET /api/status/{task_id}`
- **功能**: 查询指定任务的状态和结果
- **响应**:
  ```json
  {
    "task_id": "uuid-string",
    "status": "SUCCESS|PENDING|STARTED|FAILURE",
    "result": {
      "file_path": "文件路径",
      "file_url": "下载链接",
      "total_comments": 156,
      "independent_comments": 45
    },
    "progress": "进度信息",
    "download_url": "/api/download/uuid-string"
  }
  ```

### 3. 下载结果文件

- **URL**: `GET /api/download/{task_id}`
- **功能**: 下载爬取结果JSON文件

### 4. 健康检查

- **URL**: `GET /api/health`
- **功能**: 检查服务运行状态

## 💡 使用示例

详细的使用示例请参考 [API_USAGE.md](API_USAGE.md) 文件。

## 🏗️ 项目结构

```
v2/
├── main.py              # FastAPI 应用主文件
├── celery_app.py        # Celery 配置和任务定义
├── crawler.py           # 爬虫核心逻辑（支持Cookie传入）
├── models.py            # Pydantic 数据模型
├── requirements.txt     # 依赖包列表
├── start.ps1           # Windows PowerShell 启动脚本
├── start.sh            # Linux/Mac Bash 启动脚本
├── README.md           # 项目说明
├── API_USAGE.md        # 详细使用指南
└── output/             # 输出文件目录
```

## 🔧 配置说明

### Redis 配置

默认连接 `redis://localhost:6379/0`，可通过环境变量 `REDIS_URL` 修改。

### 输出目录

默认保存到 `./output/` 目录，文件名格式：`{视频标题}_comments.json`

## 📈 性能优化

1. **并发控制**: Celery worker 可配置并发数
2. **队列分离**: 可配置不同类型任务使用不同队列
3. **结果缓存**: Redis 作为结果缓存，支持持久化
4. **文件管理**: 建议定期清理output目录

## 🔍 监控管理

### 查看活跃任务

```bash
curl "http://localhost:8000/api/tasks"
```

### 取消任务

```bash
curl -X DELETE "http://localhost:8000/api/tasks/{task_id}"
```

### Celery 监控

```bash
celery -A celery_app flower  # 启动 Flower 监控界面
```

## 🚨 注意事项

1. **Cookie有效性**: B站Cookie有时效性，需要前端负责Cookie的获取和更新
2. **请求限制**: 避免过于频繁的请求，建议添加适当延时
3. **存储空间**: 确保有足够的磁盘空间存储结果文件
4. **网络稳定**: 爬取过程依赖网络，建议在稳定环境下运行

## 🔒 安全建议

1. 在生产环境中修改 CORS 配置，限制允许的域名
2. 为 Redis 设置密码保护
3. 考虑添加 API 访问限制和认证
4. 定期更新依赖包版本

## 📄 许可证

本项目采用 MIT 许可证。
