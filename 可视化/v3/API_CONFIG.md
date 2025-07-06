# API配置说明

## 概述
一站式爬取工具现在支持可配置的后端API基础URL，使您能够灵活地连接到不同的后端服务。

## 配置方式

### 1. 环境变量配置（推荐）
在项目根目录创建 `.env.local` 文件，设置API基础URL：

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

### 2. 页面动态配置
在爬取页面的"API配置"部分：
1. 点击"展开"按钮显示配置区域
2. 输入后端API的基础URL
3. 点击"保存"按钮应用配置

## 默认配置
- 默认API基础URL: `http://localhost:8000`
- 请求超时时间: 30秒

## API端点
配置的基础URL将用于以下API端点：
- `POST {baseURL}/api/crawl` - 启动爬取任务
- `GET {baseURL}/api/status/{taskId}` - 查询任务状态

## 示例配置

### 本地开发
```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

### 生产环境
```bash
NEXT_PUBLIC_API_BASE_URL=https://api.your-domain.com
```

### Docker环境
```bash
NEXT_PUBLIC_API_BASE_URL=http://backend:8000
```

## 功能特性
- ✅ 可配置的基础URL
- ✅ 自动URL构建和清理
- ✅ 请求超时控制
- ✅ 错误处理和重试机制
- ✅ 实时配置更新
- ✅ 环境变量支持

## 使用步骤
1. 配置API基础URL（通过环境变量或页面配置）
2. 确保后端服务在指定地址运行
3. 获取B站Cookie
4. 输入BV号开始爬取

## 故障排除
1. **连接失败**: 检查API基础URL是否正确，后端服务是否运行
2. **超时错误**: 检查网络连接，考虑增加超时时间
3. **404错误**: 确认后端API端点已正确实现

## 技术实现
- 使用环境变量 `NEXT_PUBLIC_API_BASE_URL` 设置默认配置
- 支持运行时动态配置更新
- 自动处理URL格式化（移除重复斜杠等）
- 集成请求超时和错误处理机制
