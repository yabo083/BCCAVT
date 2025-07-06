// 等待HTML加载完成后执行
document.addEventListener('DOMContentLoaded', () => {
    const getCookieBtn = document.getElementById('getCookieBtn');
    const getBilibiliCookieBtn = document.getElementById('getBilibiliCookieBtn');
    const loadCookieBtn = document.getElementById('loadCookieBtn');
    const clearCookieBtn = document.getElementById('clearCookieBtn');
    const cookieResultEl = document.getElementById('cookieResult');
    const statusEl = document.getElementById('status');

    // 更新状态显示
    function updateStatus(message) {
        if (statusEl) {
            statusEl.textContent = message;
        }
    }

    // 更新Cookie结果显示
    function updateCookieResult(cookies) {
        if (cookieResultEl) {
            if (cookies && cookies.length > 0) {
                cookieResultEl.textContent = JSON.stringify(cookies, null, 2);
            } else {
                cookieResultEl.textContent = '暂无Cookie数据';
            }
        }
    }

    // 给获取当前网站Cookie按钮添加点击事件监听
    getCookieBtn.addEventListener('click', () => {
        updateStatus('正在获取当前网站Cookie...');
        cookieResultEl.textContent = '获取中...';

        // 向后台脚本(background.js)发送一个消息，请求获取当前网站的Cookie
        chrome.runtime.sendMessage({ action: "getCookies" }, (response) => {
            if (response && response.success) {
                const cookies = response.data;
                
                // 将cookie保存到localStorage
                try {
                    localStorage.setItem('current_cookies', JSON.stringify(cookies));
                    updateStatus(`成功获取并保存 ${cookies.length} 个当前网站Cookie`);
                    updateCookieResult(cookies);
                } catch (error) {
                    updateStatus('保存Cookie到本地存储失败: ' + error.message);
                    console.error('保存Cookie失败:', error);
                }
            } else {
                // 如果失败，显示错误信息
                const errorMsg = response ? response.error : '未知错误';
                updateStatus('获取失败: ' + errorMsg);
                cookieResultEl.textContent = '获取失败: ' + errorMsg;
            }
        });
    });

    // 给获取B站Cookie按钮添加点击事件监听
    if (getBilibiliCookieBtn) {
        getBilibiliCookieBtn.addEventListener('click', () => {
            updateStatus('正在获取B站Cookie...');
            cookieResultEl.textContent = '获取中...';

            // 向后台脚本(background.js)发送一个消息，请求获取B站Cookie
            chrome.runtime.sendMessage({ action: "getCookies", domain: ".bilibili.com" }, (response) => {
                if (response && response.success) {
                    const cookies = response.data;
                    
                    // 将cookie保存到localStorage
                    try {
                        localStorage.setItem('bilibili_cookies', JSON.stringify(cookies));
                        updateStatus(`成功获取并保存 ${cookies.length} 个B站Cookie`);
                        updateCookieResult(cookies);
                    } catch (error) {
                        updateStatus('保存Cookie到本地存储失败: ' + error.message);
                        console.error('保存Cookie失败:', error);
                    }
                } else {
                    // 如果失败，显示错误信息
                    const errorMsg = response ? response.error : '未知错误';
                    updateStatus('获取失败: ' + errorMsg);
                    cookieResultEl.textContent = '获取失败: ' + errorMsg;
                }
            });
        });
    }

    // 给读取Cookie按钮添加点击事件监听
    if (loadCookieBtn) {
        loadCookieBtn.addEventListener('click', () => {
            try {
                // 优先读取B站Cookie，如果没有则读取当前网站Cookie
                let savedCookies = localStorage.getItem('bilibili_cookies');
                let source = 'B站';
                if (!savedCookies) {
                    savedCookies = localStorage.getItem('current_cookies');
                    source = '当前网站';
                }
                
                if (savedCookies) {
                    const cookies = JSON.parse(savedCookies);
                    updateStatus(`从本地存储加载了 ${cookies.length} 个${source}Cookie`);
                    updateCookieResult(cookies);
                } else {
                    updateStatus('本地存储中没有找到Cookie');
                    cookieResultEl.textContent = '本地存储中没有Cookie数据';
                }
            } catch (error) {
                updateStatus('读取本地存储失败: ' + error.message);
                console.error('读取Cookie失败:', error);
            }
        });
    }

    // 给清除Cookie按钮添加点击事件监听
    if (clearCookieBtn) {
        clearCookieBtn.addEventListener('click', () => {
            try {
                localStorage.removeItem('bilibili_cookies');
                localStorage.removeItem('current_cookies');
                updateStatus('已清除所有Cookie');
                cookieResultEl.textContent = '已清除所有Cookie';
            } catch (error) {
                updateStatus('清除Cookie失败: ' + error.message);
                console.error('清除Cookie失败:', error);
            }
        });
    }

    // 页面加载时自动尝试从localStorage读取cookie
    try {
        let savedCookies = localStorage.getItem('bilibili_cookies');
        let source = 'B站';
        if (!savedCookies) {
            savedCookies = localStorage.getItem('current_cookies');
            source = '当前网站';
        }
        
        if (savedCookies) {
            const cookies = JSON.parse(savedCookies);
            updateStatus(`已加载 ${cookies.length} 个${source}Cookie`);
            updateCookieResult(cookies);
        } else {
            updateStatus('点击"获取Cookie"按钮开始使用');
        }
    } catch (error) {
        updateStatus('初始化失败: ' + error.message);
        console.error('初始化失败:', error);
    }
});