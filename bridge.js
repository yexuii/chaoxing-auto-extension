/**
 * 超星学习通自动倍速与任务点助手 - Isolated World Bridge
 * 作用：
 * 1. 兼容回退注入：若浏览器不支持 content_scripts 的 world: "MAIN"，自动通过 <script src="..."> 注入 page-controller.js
 * 2. 桥接扩展工具栏弹窗 (popup.js) 与页面主环境 (page-controller.js) 的双向状态通信
 */
(function () {
  'use strict';

  if (window !== window.top) return;

  let latestPageState = null;

  window.addEventListener('cx-ext-state', function (ev) {
    if (ev && ev.detail) {
      latestPageState = ev.detail;
    }
  });

  function ensureMainWorldController() {
    if (document.getElementById('cx-auto-3x-badge') || document.getElementById('cx-ext-main-loader')) {
      return;
    }
    try {
      const s = document.createElement('script');
      s.id = 'cx-ext-main-loader';
      s.src = chrome.runtime.getURL('page-controller.js');
      s.onload = function () {
        s.remove();
      };
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {}
  }

  // Wait briefly for native world: "MAIN" script; if absent, inject via <script src>
  setTimeout(ensureMainWorldController, 200);

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
      if (!message || !message.type) return false;

      ensureMainWorldController();

      window.dispatchEvent(
        new CustomEvent('cx-ext-command', {
          detail: message
        })
      );

      // Request fresh state from main world and return to popup
      window.dispatchEvent(
        new CustomEvent('cx-ext-command', {
          detail: { type: 'GET_STATE' }
        })
      );

      setTimeout(function () {
        sendResponse({
          ok: true,
          state: latestPageState
        });
      }, 40);

      return true;
    });
  }
})();
