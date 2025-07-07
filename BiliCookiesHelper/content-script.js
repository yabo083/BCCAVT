// content-script.js
// 监听网页消息，转发给扩展后台获取cookie，再把结果返回给网页
console.log('[content-script] 注入成功');

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

window.addEventListener('message', function(event) {
  if (event.source !== window) return;
  if (event.data && event.data.type === 'GET_BILIBILI_COOKIES') {
    console.log('[content-script] 收到页面请求，转发给扩展');
    const domain = event.data.domain || ".bilibili.com";
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ action: "getCookies", domain }, (response) => {
        console.log('[content-script] 扩展返回：', response);
        window.postMessage({
          type: 'BILIBILI_COOKIES_RESULT',
          success: response && response.success,
          cookies: response && response.success ? response.data : [],
          error: response && !response.success ? response.error : null
        }, '*');
      });
    } else {
      console.error('[content-script] chrome.runtime.sendMessage 不可用');
      window.postMessage({
        type: 'BILIBILI_COOKIES_RESULT',
        success: false,
        cookies: [],
        error: 'chrome.runtime.sendMessage 不可用，content-script未被正确注入或扩展未启用'
      }, '*');
    }
  }
}); 