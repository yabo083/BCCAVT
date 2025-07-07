// 监听从popup.js或其他地方发来的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[background] 收到消息', request);
  if (request.action === "ping") {
    sendResponse({ pong: true });
    return;
  }
  // 检查是不是我们需要的那个指令
  if (request.action === "getCookies") {
    // 支持传递domain参数
    let url = request.url;
    let domain = request.domain;
    
    if (domain) {
      // 如果有domain参数，直接获取该域名的cookie
      const cleanDomain = domain.replace(/^\./, "");
      chrome.cookies.getAll({ domain: cleanDomain }, (cookies) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ success: true, data: cookies });
        }
      });
    } else {
      // 如果没有domain参数，获取当前标签页的cookie
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length === 0) {
          sendResponse({ success: false, error: "没有找到激活的标签页。" });
          return;
        }
        
        const tab = tabs[0];
        if (!tab.url) {
          sendResponse({ success: false, error: "当前标签页没有URL。" });
          return;
        }

        chrome.cookies.getAll({ url: tab.url }, (cookies) => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
          } else {
            sendResponse({ success: true, data: cookies });
          }
        });
      });
    }

    return true; 
  }
});