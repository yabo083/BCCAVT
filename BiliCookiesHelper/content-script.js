// content-script.js
// 监听网页消息，转发给扩展后台获取cookie，再把结果返回给网页
console.log('[content-script] 注入成功');
console.log('[content-script] 当前URL:', window.location.href);
console.log('[content-script] Chrome可用:', typeof chrome !== 'undefined');
console.log('[content-script] Runtime可用:', typeof chrome !== 'undefined' && !!chrome.runtime);

// 延迟初始化以确保扩展完全加载
setTimeout(() => {
  console.log('[content-script] 延迟检查扩展状态:', isExtensionContextValid());
}, 1000);

// 检查是否从扩展跳转过来，如果是则自动加载Cookie并开始爬取
function checkAutoStart() {
  const urlParams = new URLSearchParams(window.location.search);
  const autoStart = urlParams.get('autoStart');
  const bvNumber = urlParams.get('bv');
  const urlTimestamp = urlParams.get('t'); // 获取URL中的时间戳
  
  console.log('[content-script] 检查自动启动参数:', { autoStart, bvNumber, urlTimestamp });
  
  if (autoStart !== 'true') {
    console.log('[content-script] 无自动启动参数，跳过');
    return;
  }
  
  if (!urlTimestamp) {
    console.log('[content-script] 缺少时间戳参数，跳过自动启动');
    return;
  }
  
  const currentTime = Date.now();
  const messageTimestamp = parseInt(urlTimestamp);
  
  // 检查URL时间戳是否过期（超过30秒）
  if (currentTime - messageTimestamp > 30000) {
    console.log('[content-script] URL时间戳过期，跳过自动启动');
    return;
  }
  
  // 使用URL中的时间戳作为唯一标识
  const autoStartKey = `autoStartTriggered_${bvNumber || 'no_bv'}_${messageTimestamp}`;
  
  // 检查是否已经处理过这个特定的自动启动请求
  if (sessionStorage.getItem(autoStartKey)) {
    console.log('[content-script] 此自动启动请求已处理过，跳过');
    return;
  }
  
  console.log('[content-script] 开始处理自动启动', { autoStart, bvNumber, messageTimestamp });
  
  // 标记此请求已处理
  sessionStorage.setItem(autoStartKey, 'true');
  
  // 清理超过1小时的旧标记
  const oneHour = 60 * 60 * 1000;
  Object.keys(sessionStorage)
    .filter(key => key.startsWith('autoStartTriggered_'))
    .forEach(key => {
      const keyTimestamp = parseInt(key.split('_').pop());
      if (keyTimestamp && (currentTime - keyTimestamp) > oneHour) {
        sessionStorage.removeItem(key);
      }
    });
    
  setTimeout(() => {
    // 通知页面自动开始
    window.postMessage({
      type: 'AUTO_START_CRAWLER',
      bvNumber: bvNumber || null,
      timestamp: messageTimestamp // 使用URL中的时间戳
    }, '*');
  }, 1000); // 延迟1秒确保页面已加载
}

// 页面加载完成后检查自动启动
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkAutoStart);
} else {
  checkAutoStart();
}

// 检查扩展上下文是否有效
function isExtensionContextValid() {
  try {
    // 检查chrome对象是否存在
    if (typeof chrome === 'undefined') {
      return false;
    }
    
    // 检查runtime是否存在
    if (!chrome.runtime) {
      return false;
    }
    
    // 尝试访问 chrome.runtime.id 来检查上下文是否有效
    const id = chrome.runtime.id;
    return !!id;
  } catch (error) {
    console.log('[content-script] 扩展上下文检查失败:', error.message);
    return false;
  }
}

// 安全的发送消息函数
function safeSendMessage(message, callback) {
  if (!isExtensionContextValid()) {
    console.warn('[content-script] 扩展上下文无效，无法发送消息');
    callback({
      success: false,
      error: '扩展上下文无效，请刷新页面或重新启用扩展'
    });
    return;
  }

  try {
    chrome.runtime.sendMessage(message, (response) => {
      // 检查是否有运行时错误
      if (chrome.runtime.lastError) {
        console.error('[content-script] 运行时错误:', chrome.runtime.lastError.message);
        callback({
          success: false,
          error: `扩展通信错误: ${chrome.runtime.lastError.message}`
        });
        return;
      }
      
      callback(response);
    });
  } catch (error) {
    console.error('[content-script] 发送消息时发生错误:', error);
    callback({
      success: false,
      error: `发送消息失败: ${error.message}`
    });
  }
}

window.addEventListener('message', function(event) {
  if (event.source !== window) return;
  
  // 健康检查响应
  if (event.data && event.data.type === 'EXTENSION_HEALTH_CHECK') {
    console.log('[content-script] 收到健康检查请求');
    const extensionValid = isExtensionContextValid();
    console.log('[content-script] 扩展上下文状态:', extensionValid);
    
    window.postMessage({
      type: 'EXTENSION_HEALTH_RESPONSE',
      status: 'ok',
      extensionValid: extensionValid,
      timestamp: Date.now(),
      chromeAvailable: typeof chrome !== 'undefined',
      runtimeAvailable: typeof chrome !== 'undefined' && !!chrome.runtime
    }, '*');
    return;
  }
  
  if (event.data && event.data.type === 'GET_BILIBILI_COOKIES') {
    console.log('[content-script] 收到页面请求，转发给扩展');
    const domain = event.data.domain || ".bilibili.com";
    
    // 详细检查Chrome API的可用性
    if (typeof chrome === 'undefined') {
      console.error('[content-script] Chrome 对象不存在');
      window.postMessage({
        type: 'BILIBILI_COOKIES_RESULT',
        success: false,
        cookies: [],
        error: 'Chrome 对象不存在，这可能不是扩展环境'
      }, '*');
      return;
    }
    
    if (!chrome.runtime) {
      console.error('[content-script] chrome.runtime 不可用');
      window.postMessage({
        type: 'BILIBILI_COOKIES_RESULT',
        success: false,
        cookies: [],
        error: 'chrome.runtime 不可用，扩展可能已被禁用'
      }, '*');
      return;
    }
    
    if (!chrome.runtime.sendMessage) {
      console.error('[content-script] chrome.runtime.sendMessage 不可用');
      window.postMessage({
        type: 'BILIBILI_COOKIES_RESULT',
        success: false,
        cookies: [],
        error: 'chrome.runtime.sendMessage 不可用，扩展通信功能异常'
      }, '*');
      return;
    }

    // 检查扩展上下文
    if (!isExtensionContextValid()) {
      console.error('[content-script] 扩展上下文无效');
      window.postMessage({
        type: 'BILIBILI_COOKIES_RESULT',
        success: false,
        cookies: [],
        error: '扩展上下文无效，请刷新页面或重新启用扩展'
      }, '*');
      return;
    }

    // 使用安全的消息发送函数
    safeSendMessage({ action: "getCookies", domain }, (response) => {
      console.log('[content-script] 扩展返回：', response);
      window.postMessage({
        type: 'BILIBILI_COOKIES_RESULT',
        success: response && response.success,
        cookies: response && response.success ? response.data : [],
        error: response && !response.success ? response.error : null
      }, '*');
    });
  }
}); 