# Bug修复测试用例

## 问题描述
当利用浏览器左右回退按钮回退到自动爬取的页面后，会再次触发自动爬取。应该只在扩展中点击"自动获取BV号并跳转页面"后才能自动爬取。

## 修复方案
1. **SessionStorage标记机制**: 使用sessionStorage记录是否已经触发过自动启动
2. **时间戳参数**: 每次从扩展跳转都添加唯一时间戳
3. **页面卸载清理**: 当用户离开页面时清理标记
4. **双重检查**: 在content-script和page组件中都进行检查

## 测试用例

### 测试1: 正常自动启动（应该成功）
1. 打开B站视频页面：`https://www.bilibili.com/video/BV1234567890`
2. 点击扩展图标
3. 点击"自动获取BV号并跳转页面"
4. **期望结果**: 自动跳转并开始爬取

### 测试2: 浏览器回退（不应该自动启动）
1. 完成测试1
2. 在爬取页面点击浏览器"后退"按钮
3. 再点击浏览器"前进"按钮回到爬取页面
4. **期望结果**: 不应该再次触发自动爬取

### 测试3: 页面刷新（不应该自动启动）
1. 完成测试1
2. 在爬取页面按F5刷新页面
3. **期望结果**: 不应该触发自动爬取

### 测试4: 直接访问URL（不应该自动启动）
1. 直接在浏览器地址栏输入：`http://localhost:3000/crawler?autoStart=true&bv=BV1234567890`
2. **期望结果**: 不应该触发自动爬取（因为不是从扩展跳转）

### 测试5: 多次点击扩展按钮（每次都应该成功）
1. 打开B站视频页面
2. 点击扩展的"自动获取BV号并跳转页面"
3. 关闭爬取页面标签
4. 再次点击扩展的"自动获取BV号并跳转页面"
5. **期望结果**: 每次都应该正常自动启动

## 技术实现细节

### 1. SessionStorage标记
```javascript
// 设置标记
sessionStorage.setItem('autoStartTriggered', 'true');

// 检查标记
const autoStartTriggered = sessionStorage.getItem('autoStartTriggered');
```

### 2. 时间戳参数
```javascript
const timestamp = Date.now();
let crawlerUrl = `http://localhost:3000/crawler?autoStart=true&t=${timestamp}`;
```

### 3. 页面卸载清理
```javascript
window.addEventListener('beforeunload', () => {
  sessionStorage.removeItem('autoStartTriggered');
  sessionStorage.removeItem('autoStartProcessed');
});
```

## 预期行为

| 场景 | 是否自动启动 | 原因 |
|------|-------------|------|
| 扩展跳转 | ✅ 是 | 正常流程 |
| 浏览器回退 | ❌ 否 | sessionStorage已标记 |
| 页面刷新 | ❌ 否 | sessionStorage已标记 |
| 直接访问URL | ❌ 否 | 无扩展设置的时间戳 |
| 新标签页扩展跳转 | ✅ 是 | 新的session，正常流程 |

## 验证方法
1. 打开浏览器开发者工具
2. 查看Console输出
3. 观察自动启动日志：
   - `[content-script] 检测到自动启动参数，首次触发`
   - `[content-script] 检测到自动启动参数，但已经触发过，跳过自动启动`
   - `[crawler-page] 收到自动启动消息`
   - `[crawler-page] 自动启动已处理过，跳过`
