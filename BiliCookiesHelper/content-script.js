// content-script.js
// 监听网页消息，转发给扩展后台获取cookie，再把结果返回给网页
console.log('[content-script] 注入成功');
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