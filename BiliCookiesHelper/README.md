# Bilibili Cookie 一站式管理器

一个现代化的Chrome浏览器扩展，专为Bilibili视频爬取工作流设计，提供Cookie管理、BV号自动提取和一键跳转功能。

## ✨ 主要特性

### 🎯 一键式工作流
- **智能识别**: 自动识别B站视频页面并提取BV号
- **自动跳转**: 一键跳转到爬取页面并自动开始
- **无缝集成**: 与本地爬取应用完美配合

### 🔒 安全的Cookie管理
- **智能分类**: 自动区分B站Cookie和其他网站Cookie
- **数据加密**: 敏感Cookie值自动加密显示
- **本地存储**: 所有数据只保存在本地，不上传服务器

### 🎨 现代化UI
- **渐变设计**: 美观的渐变背景和圆角元素
- **状态指示**: 彩色状态点直观显示操作状态
- **响应式**: 适配不同屏幕尺寸

## 🚀 快速开始

### 1. 安装扩展
1. 克隆或下载项目到本地
2. 打开Chrome浏览器，进入 `chrome://extensions/`
3. 开启"开发者模式"
4. 点击"加载已解压的扩展程序"
5. 选择 `BiliCookiesHelper` 文件夹

### 2. 基本使用
1. 打开任意B站视频页面（如：`https://www.bilibili.com/video/BV1234567890`）
2. 点击浏览器工具栏中的扩展图标
3. 点击"自动获取BV号并跳转页面"按钮
4. 系统将自动：
   - 提取当前页面的BV号
   - 获取并保存Cookie
   - 跳转到本地爬取页面
   - 自动开始爬取流程

## 📋 功能详解

### 获取当前网站Cookie
- 自动识别当前页面类型
- B站页面Cookie单独存储
- 支持Cookie值加密显示
- 实时状态反馈

### 自动获取BV号并跳转页面
- 支持多种B站URL格式
- 自动提取BV号并传递给爬取页面
- 智能Cookie管理
- 一键启动爬取流程

### 删除已保存的Cookie
- 一键清除所有Cookie
- 二次确认防止误操作
- 支持分类清除

## 🔧 技术规格

### 支持的URL格式
```
https://www.bilibili.com/video/BV1234567890
https://www.bilibili.com/video/BV1234567890/
https://www.bilibili.com/video/BV1234567890?p=1
https://www.bilibili.com/video/BV1234567890/?p=1&t=60
```

### 加密的Cookie字段
- `SESSDATA`
- `bili_jct`
- `DedeUserID`
- `sid`
- `buvid3`

### 权限说明
- `cookies`: 读取网站Cookie
- `activeTab`: 获取当前标签页信息
- `tabs`: 创建新标签页
- `<all_urls>`: 访问所有网站（仅用于Cookie读取）

## 🛠 开发说明

### 项目结构
```
BiliCookiesHelper/
├── manifest.json          # 扩展配置文件
├── popup.html             # 扩展弹窗界面
├── popup.js               # 弹窗逻辑代码
├── background.js          # 后台服务脚本
├── content-script.js      # 内容脚本
├── icon.png              # 扩展图标
├── test-extension.html    # 功能测试页面
└── CHANGELOG.md          # 更新日志
```

### 本地开发
1. 修改代码后，在 `chrome://extensions/` 页面点击扩展的"刷新"按钮
2. 重新加载使用扩展的页面
3. 查看Console输出调试信息

### 与爬取页面集成
扩展会向爬取页面传递以下参数：
- `autoStart=true`: 启用自动启动模式
- `bv=BV号`: 自动填入的BV号

爬取页面需要监听 `AUTO_START_CRAWLER` 消息来接收自动启动指令。

## 🐛 常见问题

### Q: 扩展图标不显示
A: 检查是否正确加载扩展，确保manifest.json格式正确

### Q: 无法获取Cookie
A: 确保在目标网站页面使用扩展，检查网站是否已登录

### Q: 自动跳转失败
A: 确保本地爬取应用正在运行（http://localhost:3000）

### Q: BV号提取失败
A: 确保当前页面是B站视频页面，URL包含有效的BV号

## 📄 许可证

此项目仅供学习和研究使用，请勿用于商业用途。

## 🤝 贡献

欢迎提交Issue和Pull Request来改进这个项目！

---

**注意**: 请确保您的使用符合Bilibili的服务条款和相关法律法规。
