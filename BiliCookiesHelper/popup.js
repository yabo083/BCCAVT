// 等待HTML加载完成后执行
document.addEventListener('DOMContentLoaded', () => {
    const getCookieBtn = document.getElementById('getCookieBtn');
    const autoExtractBtn = document.getElementById('autoExtractBtn');
    const clearCookieBtn = document.getElementById('clearCookieBtn');
    const cookieResultEl = document.getElementById('cookieResult');
    const statusEl = document.getElementById('status');
    const githubLink = document.getElementById('githubLink');
    const helpLink = document.getElementById('helpLink');
    
    // 配置相关元素
    const configBtn = document.getElementById('configBtn');
    const configModal = document.getElementById('configModal');
    const closeConfigBtn = document.getElementById('closeConfigBtn');
    const saveConfigBtn = document.getElementById('saveConfigBtn');
    const resetConfigBtn = document.getElementById('resetConfigBtn');
    const frontendUrlInput = document.getElementById('frontendUrl');
    
    // 默认配置
    const DEFAULT_CONFIG = {
        frontendUrl: 'http://localhost:3000'
    };
    
    // 获取当前配置
    function getConfig() {
        try {
            const saved = localStorage.getItem('bccavt_config');
            return saved ? { ...DEFAULT_CONFIG, ...JSON.parse(saved) } : DEFAULT_CONFIG;
        } catch (e) {
            console.error('读取配置失败:', e);
            return DEFAULT_CONFIG;
        }
    }
    
    // 保存配置
    function saveConfig(config) {
        try {
            localStorage.setItem('bccavt_config', JSON.stringify(config));
            return true;
        } catch (e) {
            console.error('保存配置失败:', e);
            return false;
        }
    }
    
    // 验证URL格式
    function isValidUrl(string) {
        try {
            const url = new URL(string);
            return url.protocol === 'http:' || url.protocol === 'https:';
        } catch (_) {
            return false;
        }
    }
    
    // 验证前端服务是否可访问
    async function validateFrontendUrl(url) {
        try {
            // 移除末尾的斜杠
            const cleanUrl = url.replace(/\/$/, '');
            const response = await fetch(`${cleanUrl}/api/health`).catch(() => 
                fetch(`${cleanUrl}`).catch(() => ({ ok: false }))
            );
            return response.ok;
        } catch (e) {
            return false;
        }
    }
    
    // 初始化配置
    function initConfig() {
        const config = getConfig();
        frontendUrlInput.value = config.frontendUrl;
        
        // 绑定预设按钮事件
        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const url = btn.getAttribute('data-url');
                if (url) {
                    frontendUrlInput.value = url;
                }
            });
        });
    }
    
    // 配置按钮事件
    configBtn.addEventListener('click', () => {
        configModal.classList.add('show');
        initConfig();
    });
    
    // 关闭配置弹窗
    closeConfigBtn.addEventListener('click', () => {
        configModal.classList.remove('show');
    });
    
    // 点击弹窗外部关闭
    configModal.addEventListener('click', (e) => {
        if (e.target === configModal) {
            configModal.classList.remove('show');
        }
    });
    
    // 保存配置
    saveConfigBtn.addEventListener('click', async () => {
        const frontendUrl = frontendUrlInput.value.trim();
        
        if (!frontendUrl) {
            alert('请输入前端服务域名');
            return;
        }
        
        if (!isValidUrl(frontendUrl)) {
            alert('请输入有效的URL格式（包含http://或https://）');
            return;
        }
        
        // 显示保存中状态
        saveConfigBtn.innerHTML = '<span class="loading"></span>保存中...';
        saveConfigBtn.disabled = true;
        
        // 验证URL是否可访问（可选，因为可能跨域）
        const isAccessible = await validateFrontendUrl(frontendUrl);
        if (!isAccessible) {
            const confirm = window.confirm(
                '无法验证该URL是否可访问，可能是跨域限制或服务未启动。\n是否仍要保存此配置？'
            );
            if (!confirm) {
                saveConfigBtn.innerHTML = '保存配置';
                saveConfigBtn.disabled = false;
                return;
            }
        }
        
        const config = { frontendUrl: frontendUrl.replace(/\/$/, '') }; // 移除末尾斜杠
        if (saveConfig(config)) {
            updateStatus('配置保存成功', 'success');
            configModal.classList.remove('show');
        } else {
            alert('配置保存失败，请重试');
        }
        
        saveConfigBtn.innerHTML = '保存配置';
        saveConfigBtn.disabled = false;
    });
    
    // 重置配置
    resetConfigBtn.addEventListener('click', () => {
        if (confirm('确定要重置为默认配置吗？')) {
            frontendUrlInput.value = DEFAULT_CONFIG.frontendUrl;
        }
    });
    
    // 获取前端URL的函数
    function getFrontendUrl() {
        return getConfig().frontendUrl;
    }

    // 更新状态显示
    function updateStatus(message, type = 'info') {
        if (statusEl) {
            const statusClasses = {
                'info': 'status-info',
                'success': 'status-success', 
                'warning': 'status-warning',
                'error': 'status-error'
            };
            
            const indicator = statusEl.querySelector('.status-indicator');
            if (indicator) {
                indicator.className = `status-indicator ${statusClasses[type]}`;
            }
            
            const textNode = statusEl.querySelector('.notification-text') || statusEl;
            textNode.innerHTML = `<span class="status-indicator ${statusClasses[type]}"></span>${message}`;
        }
    }

    // 加密敏感Cookie值
    function encryptSensitiveValue(key, value) {
        const sensitiveKeys = ['SESSDATA', 'bili_jct', 'DedeUserID', 'sid', 'buvid3'];
        if (sensitiveKeys.some(k => key.toLowerCase().includes(k.toLowerCase()))) {
            if (value && value.length > 8) {
                return value.substring(0, 4) + '*'.repeat(value.length - 8) + value.substring(value.length - 4);
            }
        }
        return value;
    }

    // 更新Cookie结果显示
    function updateCookieResult(cookies) {
        if (cookieResultEl) {
            if (cookies && cookies.length > 0) {
                let displayText = '';
                cookies.forEach((cookie, index) => {
                    const encryptedValue = encryptSensitiveValue(cookie.name, cookie.value);
                    const isEncrypted = encryptedValue !== cookie.value;
                    
                    displayText += `<div class="cookie-item">`;
                    displayText += `<span class="cookie-key">${cookie.name}:</span> `;
                    displayText += `<span class="cookie-value ${isEncrypted ? 'encrypted' : ''}">${encryptedValue}</span>`;
                    if (cookie.domain) {
                        displayText += `<br><small style="color: #94a3b8;">域名: ${cookie.domain}</small>`;
                    }
                    displayText += `</div>`;
                });
                cookieResultEl.innerHTML = displayText;
            } else {
                cookieResultEl.innerHTML = '暂无Cookie数据，请点击上方按钮获取';
            }
        }
    }

    // 给获取当前网站Cookie按钮添加点击事件监听
    getCookieBtn.addEventListener('click', () => {
        updateStatus('正在获取当前网站Cookie...', 'info');
        getCookieBtn.innerHTML = '<span class="loading"></span>获取中...';
        getCookieBtn.disabled = true;

        // 向后台脚本发送消息，请求获取当前网站的Cookie
        chrome.runtime.sendMessage({ action: "getCookies" }, (response) => {
            getCookieBtn.innerHTML = '获取当前网站Cookie';
            getCookieBtn.disabled = false;
            
            if (response && response.success) {
                const cookies = response.data;
                
                // 检查是否为B站页面
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    const currentUrl = tabs[0].url;
                    const isBilibili = currentUrl && currentUrl.includes('bilibili.com');
                    const storageKey = isBilibili ? 'bilibili_cookies' : 'current_cookies';
                    
                    try {
                        localStorage.setItem(storageKey, JSON.stringify(cookies));
                        const siteType = isBilibili ? 'B站' : '当前网站';
                        updateStatus(`成功获取并保存 ${cookies.length} 个${siteType}Cookie`, 'success');
                        updateCookieResult(cookies);
                    } catch (error) {
                        updateStatus('保存Cookie到本地存储失败: ' + error.message, 'error');
                        console.error('保存Cookie失败:', error);
                    }
                });
            } else {
                const errorMsg = response ? response.error : '未知错误';
                updateStatus('获取失败: ' + errorMsg, 'error');
                cookieResultEl.innerHTML = '获取失败: ' + errorMsg;
            }
        });
    });

    // 自动获取BV号并跳转页面按钮
    if (autoExtractBtn) {
        autoExtractBtn.addEventListener('click', () => {
            updateStatus('正在分析当前页面...', 'info');
            autoExtractBtn.innerHTML = '<span class="loading"></span>处理中...';
            autoExtractBtn.disabled = true;
            
            // 首先获取当前页面的Cookie和URL信息
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const currentUrl = tabs[0].url;
                const isBilibili = currentUrl && currentUrl.includes('bilibili.com');
                
                // 尝试从URL中提取BV号
                const bvNumber = extractBvFromUrl(currentUrl);
                const timestamp = Date.now(); // 添加时间戳确保唯一性
                const frontendUrl = getFrontendUrl(); // 使用配置的URL
                let crawlerUrl = `${frontendUrl}/crawler?autoStart=true&t=${timestamp}`;
                
                if (bvNumber) {
                    crawlerUrl += `&bv=${bvNumber}`;
                    updateStatus(`检测到BV号: ${bvNumber}，正在跳转...`, 'success');
                } else if (isBilibili) {
                    updateStatus('B站页面但未检测到BV号，正在跳转...', 'warning');
                } else {
                    updateStatus('正在跳转到爬取页面...', 'info');
                }
                
                if (isBilibili) {
                    // 如果当前是B站页面，先获取Cookie再跳转
                    chrome.runtime.sendMessage({ action: "getCookies" }, (response) => {
                        if (response && response.success) {
                            try {
                                localStorage.setItem('bilibili_cookies', JSON.stringify(response.data));
                                updateStatus(`已保存B站Cookie${bvNumber ? '和BV号' : ''}，正在跳转...`, 'success');
                            } catch (error) {
                                console.error('保存Cookie失败:', error);
                            }
                        }
                        
                        // 跳转到本地爬取页面
                        chrome.tabs.create({ 
                            url: crawlerUrl,
                            active: true 
                        }, (tab) => {
                            // 注入content script到新打开的页面
                            if (tab && tab.id) {
                                setTimeout(() => {
                                    chrome.scripting.executeScript({
                                        target: { tabId: tab.id },
                                        files: ['content-script.js']
                                    }).catch(err => {
                                        console.log('Content script注入失败:', err);
                                    });
                                }, 1000);
                            }
                        });
                        
                        autoExtractBtn.innerHTML = '自动获取BV号并跳转页面';
                        autoExtractBtn.disabled = false;
                    });
                } else {
                    // 如果不是B站页面，直接跳转
                    chrome.tabs.create({ 
                        url: crawlerUrl,
                        active: true 
                    }, (tab) => {
                        // 注入content script到新打开的页面
                        if (tab && tab.id) {
                            setTimeout(() => {
                                chrome.scripting.executeScript({
                                    target: { tabId: tab.id },
                                    files: ['content-script.js']
                                }).catch(err => {
                                    console.log('Content script注入失败:', err);
                                });
                            }, 1000);
                        }
                    });
                    
                    autoExtractBtn.innerHTML = '自动获取BV号并跳转页面';
                    autoExtractBtn.disabled = false;
                }
            });
        });
    }

    // 从URL中提取BV号的函数
    function extractBvFromUrl(url) {
        if (!url) return null;
        
        // 匹配各种B站视频页面格式
        const patterns = [
            /\/video\/(BV\w+)/,           // 标准格式：/video/BV1xx411c7mD
            /\/video\/(BV\w+)\//,         // 带斜杠：/video/BV1xx411c7mD/
            /\/video\/(BV\w+)\?/,         // 带参数：/video/BV1xx411c7mD?p=1
            /BV(\w+)/                     // 直接匹配BV号
        ];
        
        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) {
                return match[1].startsWith('BV') ? match[1] : 'BV' + match[1];
            }
        }
        return null;
    }

    // 删除已保存的Cookie按钮
    if (clearCookieBtn) {
        clearCookieBtn.addEventListener('click', () => {
            if (confirm('确定要删除所有已保存的Cookie吗？此操作不可恢复。')) {
                try {
                    localStorage.removeItem('bilibili_cookies');
                    localStorage.removeItem('current_cookies');
                    updateStatus('已清除所有Cookie', 'success');
                    cookieResultEl.innerHTML = '已清除所有Cookie';
                } catch (error) {
                    updateStatus('清除Cookie失败: ' + error.message, 'error');
                    console.error('清除Cookie失败:', error);
                }
            }
        });
    }

    // 页脚链接事件
    if (githubLink) {
        githubLink.addEventListener('click', (e) => {
            e.preventDefault();
            chrome.tabs.create({ url: 'https://github.com' });
        });
    }

    if (helpLink) {
        helpLink.addEventListener('click', (e) => {
            e.preventDefault();
            const frontendUrl = getFrontendUrl();
            chrome.tabs.create({ url: frontendUrl });
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
            updateStatus(`已加载 ${cookies.length} 个${source}Cookie`, 'success');
            updateCookieResult(cookies);
        } else {
            updateStatus('点击按钮开始使用扩展功能', 'info');
        }
    } catch (error) {
        updateStatus('初始化失败: ' + error.message, 'error');
        console.error('初始化失败:', error);
    }
});