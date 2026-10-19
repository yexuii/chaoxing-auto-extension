(function () {
  'use strict';

  const toggleBtn = document.getElementById('toggle-btn');
  const statusDot = document.getElementById('status-dot');
  const titleWrap = document.getElementById('title-wrap');
  const rateTitle = document.getElementById('rate-title');
  const rateRange = document.getElementById('rate-range');
  const rateInput = document.getElementById('rate-input');
  const maxBtn = document.getElementById('max-btn');
  const presetBtns = Array.from(document.querySelectorAll('#presets button[data-rate]'));
  const chText = document.getElementById('ch-text');
  const maxText = document.getElementById('max-text');
  const stText = document.getElementById('st-text');

  function sendCommandToActiveTab(cmd) {
    if (!chrome || !chrome.tabs) return;
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) {
        chText.textContent = '当前：未检测到活动标签页';
        return;
      }
      if (!tab.url || !tab.url.includes('/mycourse/studentstudy')) {
        chText.textContent = '当前：请先打开超星学习通章节学习页';
        stText.textContent = '状态：进入 /mycourse/studentstudy 后自动生效';
        return;
      }
      chrome.tabs.sendMessage(tab.id, cmd, function (resp) {
        if (chrome.runtime.lastError || !resp || !resp.state) {
          stText.textContent = '状态：请刷新一次当前学习通页面以激活插件';
          return;
        }
        renderState(resp.state);
      });
    });
  }

  function renderState(s) {
    if (!s) return;
    const enabled = !!s.enabled;
    toggleBtn.textContent = enabled ? '开启 [Alt+S]' : '已关 [Alt+S]';
    toggleBtn.classList.toggle('off', !enabled);
    statusDot.style.background = enabled ? '#4ade80' : '#ef4444';
    titleWrap.style.color = enabled ? '#4ade80' : '#94a3b8';

    const rate = Number(s.rate) || 3;
    rateTitle.textContent = s.mode === 'max' ? 'MAX:' + rate + 'x' : rate + 'x';
    if (document.activeElement !== rateRange) rateRange.value = String(rate);
    if (document.activeElement !== rateInput) rateInput.value = String(rate);

    presetBtns.forEach(function (btn) {
      const r = Number(btn.getAttribute('data-rate'));
      btn.classList.toggle('active', s.mode === 'manual' && Math.abs(r - rate) < 0.01);
    });
    maxBtn.classList.toggle('active', s.mode === 'max');
    maxBtn.textContent = s.mode === 'max' ? 'MAX(' + rate + 'x)' : 'MAX';

    chText.textContent = '当前：' + (s.chapter || '学习通章节学习页');
    if (s.maxInfoText) {
      maxText.textContent = s.maxInfoText;
    }
    stText.textContent = '状态：' + (s.statusText || '运行中');
  }

  toggleBtn.addEventListener('click', function () {
    sendCommandToActiveTab({ type: 'TOGGLE_ENABLED' });
  });

  rateRange.addEventListener('input', function () {
    sendCommandToActiveTab({ type: 'SET_RATE_MANUAL', rate: Number(rateRange.value) });
  });

  rateInput.addEventListener('change', function () {
    sendCommandToActiveTab({ type: 'SET_RATE_MANUAL', rate: Number(rateInput.value) });
  });

  presetBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      sendCommandToActiveTab({ type: 'SET_RATE_MANUAL', rate: Number(btn.getAttribute('data-rate')) });
    });
  });

  maxBtn.addEventListener('click', function () {
    sendCommandToActiveTab({ type: 'SET_MODE_MAX' });
  });

  sendCommandToActiveTab({ type: 'GET_STATE' });
  setInterval(function () {
    sendCommandToActiveTab({ type: 'GET_STATE' });
  }, 1000);
})();
