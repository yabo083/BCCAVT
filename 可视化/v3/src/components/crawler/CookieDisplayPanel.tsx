import React, { useState } from 'react';
import { Cookie } from '@/types/cookie';

interface CookieDisplayPanelProps {
  cookies: Cookie[];
}

export const CookieDisplayPanel: React.FC<CookieDisplayPanelProps> = ({ cookies }) => {
  const [expandedCookie, setExpandedCookie] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const toggleCookieExpansion = (cookieName: string) => {
    setExpandedCookie(expandedCookie === cookieName ? null : cookieName);
  };

  const formatExpirationDate = (timestamp?: number) => {
    if (!timestamp) return '会话Cookie';
    return new Date(timestamp * 1000).toLocaleString('zh-CN');
  };

  const isExpired = (timestamp?: number) => {
    if (!timestamp) return false;
    return timestamp * 1000 < Date.now();
  };

  // 限制显示的Cookie数量
  const displayedCookies = showAll ? cookies : cookies.slice(0, 3);
  const hasMore = cookies.length > 3;

  return (
    <div className="bg-white rounded-lg shadow-md h-full flex flex-col">
      {/* 固定标题区域 */}
      <div className="p-6 border-b border-gray-100 flex-shrink-0">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center justify-between">
          <div className="flex items-center">
            <svg className="w-5 h-5 mr-2 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Cookie列表展示
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-normal text-gray-500 bg-gray-100 px-2 py-1 rounded">
              {showAll ? cookies.length : Math.min(3, cookies.length)} / {cookies.length} 个
            </span>
            {hasMore && (
              <button
                onClick={() => setShowAll(!showAll)}
                className="text-xs text-blue-600 hover:text-blue-800 px-2 py-1 rounded hover:bg-blue-50"
              >
                {showAll ? '收起' : '展开'}
              </button>
            )}
          </div>
        </h2>
      </div>
      
      {cookies.length > 0 ? (
        <div className="flex-1 flex flex-col min-h-0 p-6">
          {/* 可滚动的Cookie列表区域 */}
          <div className="flex-1 overflow-y-auto">
            <div className="space-y-3">
              {displayedCookies.map((cookie, index) => (
                <div 
                  key={index}
                  className={`border rounded-lg transition-all ${
                    isExpired(cookie.expirationDate) 
                      ? 'border-red-200 bg-red-50' 
                      : 'border-gray-200 bg-gray-50'
                  }`}
                >
                  <div 
                    className="p-3 cursor-pointer hover:bg-opacity-80"
                    onClick={() => toggleCookieExpansion(`${cookie.name}-${index}`)}
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">{cookie.name}</span>
                          {isExpired(cookie.expirationDate) && (
                            <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">
                              已过期
                            </span>
                          )}
                          {cookie.httpOnly && (
                            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                              HttpOnly
                            </span>
                          )}
                          {cookie.secure && (
                            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">
                              Secure
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {cookie.domain} • {cookie.path}
                        </div>
                      </div>
                      <svg 
                        className={`w-4 h-4 text-gray-400 transition-transform ${
                          expandedCookie === `${cookie.name}-${index}` ? 'rotate-180' : ''
                        }`} 
                        fill="none" 
                        stroke="currentColor" 
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>

                  {expandedCookie === `${cookie.name}-${index}` && (
                    <div className="border-t border-gray-200 p-3 bg-white">
                      <div className="space-y-2 text-sm">
                        <div>
                          <span className="font-medium text-gray-700">值：</span>
                          <div className="mt-1 p-2 bg-gray-100 rounded text-gray-600 break-all font-mono text-xs">
                            {cookie.value}
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4 pt-2">
                          <div>
                            <span className="font-medium text-gray-700">域名：</span>
                            <span className="text-gray-600 ml-1">{cookie.domain}</span>
                          </div>
                          <div>
                            <span className="font-medium text-gray-700">路径：</span>
                            <span className="text-gray-600 ml-1">{cookie.path}</span>
                          </div>
                          <div>
                            <span className="font-medium text-gray-700">过期时间：</span>
                            <span className="text-gray-600 ml-1">{formatExpirationDate(cookie.expirationDate)}</span>
                          </div>
                          <div>
                            <span className="font-medium text-gray-700">SameSite：</span>
                            <span className="text-gray-600 ml-1">{cookie.sameSite || '未设置'}</span>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2 pt-2">
                          <span className={`text-xs px-2 py-1 rounded ${
                            cookie.secure ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                          }`}>
                            Secure: {cookie.secure ? '是' : '否'}
                          </span>
                          <span className={`text-xs px-2 py-1 rounded ${
                            cookie.httpOnly ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                          }`}>
                            HttpOnly: {cookie.httpOnly ? '是' : '否'}
                          </span>
                          <span className={`text-xs px-2 py-1 rounded ${
                            cookie.hostOnly ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'
                          }`}>
                            HostOnly: {cookie.hostOnly ? '是' : '否'}
                          </span>
                          <span className={`text-xs px-2 py-1 rounded ${
                            cookie.session ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-600'
                          }`}>
                            Session: {cookie.session ? '是' : '否'}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* 显示更多提示 */}
            {hasMore && !showAll && (
              <div className="text-center py-3 border-t border-gray-200 mt-3">
                <button
                  onClick={() => setShowAll(true)}
                  className="text-sm text-blue-600 hover:text-blue-800 flex items-center justify-center gap-1 mx-auto"
                >
                  <span>还有 {cookies.length - 3} 个Cookie</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
            )}
          </div>
          
          {/* Cookie 小贴士 - 固定在底部 */}
          {cookies.length > 0 && (
            <div className="mt-4 p-3 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg flex-shrink-0">
              <div className="flex items-start gap-3">
                <svg className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                <div>
                  <h4 className="font-medium text-blue-900 mb-1 text-sm">Cookie 小贴士</h4>
                  <p className="text-xs text-blue-700">
                    Cookie会自动保存到本地存储中，下次使用时可以直接从本地读取，无需重新获取。
                    建议定期清理过期的Cookie以确保最佳使用体验。
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-gray-500">
            <svg className="w-12 h-12 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p>暂无Cookie数据</p>
            <p className="text-sm mt-2">请先通过扩展获取Cookie</p>
          </div>
        </div>
      )}
    </div>
  );
};
