
// ============================================
// Background Service Worker 入口
// ============================================

import { handleMessage } from './message-router.js';

// 监听来自 Content Script 和 Popup 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 异步处理消息
  handleMessage(message, sender)
    .then(result => sendResponse(result))
    .catch(error => {
      console.error('[FormHelper BG] 处理消息出错:', error);
      sendResponse({ success: false, error: error.message });
    });

  // 返回 true 表示异步响应
  return true;
});

// 安装时初始化
chrome.runtime.onInstalled.addListener(() => {
  console.log('[FormHelper] 插件已安装/更新');
});
