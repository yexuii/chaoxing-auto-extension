/**
 * 超星学习通自动倍速与任务点助手 (Main-World Controller)
 * 功能：
 * 1. [1, 16] 可调倍速（滑块 + 数字框 + 1x/2x/3x/4x/8x/16x 预设按钮）
 * 2. MAX 档位：服务端要求真实观看时长 >= 视频时长 * rt / 2（约 45%），按此动态控速（约 2.2x），
 *    服务端确认 isPassed 后 16x 冲刺；非任务点视频直接 16x
 * 3. 开关键位（悬浮窗按钮 + Alt+S 快捷键）
 * 4. 悬浮窗自由拖动并持久化坐标
 * 5. 视频 / PPT / PDF 任务点自动完成并自动切换下一标签页 / 下一章节
 */
(function () {
  'use strict';

  if (window !== window.top) return;
  if (!location.pathname.includes('/mycourse/studentstudy')) return;

  function bootController() {
    if (!document.body || !document.head) {
      setTimeout(bootController, 150);
      return;
    }

    // Prevent double initialization if both MAIN world content_script and fallback loader run
    if (window.__cxAuto3xInstalled && document.getElementById('cx-auto-3x-badge')) {
      return;
    }
    window.__cxAuto3xInstalled = true;

    try {
      window.history.pushState = function () {};
      window.history.replaceState = function () {};
    } catch (e) {}

    if (window.__cxAuto3xTimer) {
      clearInterval(window.__cxAuto3xTimer);
    }

    function clampRate(val) {
      const n = Number(val);
      if (!Number.isFinite(n)) return 3;
      return Math.min(16, Math.max(1, Math.round(n * 100) / 100));
    }

    let savedRate = 3;
    let savedMode = 'max';
    let savedEnabled = true;
    let savedPos = null;
    try {
      const r = localStorage.getItem('cx_auto_rate');
      if (r !== null) savedRate = clampRate(parseFloat(r));
      const m = localStorage.getItem('cx_auto_mode');
      if (m === 'max' || m === 'manual') savedMode = m;
      const en = localStorage.getItem('cx_auto_enabled');
      if (en !== null) savedEnabled = en !== '0' && en !== 'false';
      const p = localStorage.getItem('cx_auto_badge_pos');
      if (p) savedPos = JSON.parse(p);
    } catch (e) {}

    const prevState = window.__cxAuto3xState || {};
    const state = (window.__cxAuto3xState = {
      enabled: typeof prevState.enabled === 'boolean' ? prevState.enabled : savedEnabled,
      mode: prevState.mode || savedMode || 'max',
      rate: clampRate(prevState.rate || savedRate || 3),
      maxCalcRate: clampRate(prevState.maxCalcRate || 4),
      maxInfoText: prevState.maxInfoText || 'MAX动态计算中...',
      lastSwitchAt: 0,
      tabEnteredAt: Date.now(),
      lastKey: '',
      statusText: '初始化中...'
    });

    const oldBadge = document.getElementById('cx-auto-3x-badge');
    if (oldBadge) oldBadge.remove();

    const badge = document.createElement('div');
    badge.id = 'cx-auto-3x-badge';
    badge.style.cssText = [
      'position:fixed',
      'z-index:999999',
      'background:rgba(15, 23, 42, 0.94)',
      'color:#f8fafc',
      'padding:12px 14px',
      'border-radius:12px',
      'font-size:12px',
      'font-family:"Microsoft YaHei",system-ui,sans-serif',
      'box-shadow:0 8px 24px rgba(0,0,0,0.4)',
      'border:1px solid rgba(148,163,184,0.28)',
      'width:305px',
      'line-height:1.5',
      'user-select:none',
      'backdrop-filter:blur(8px)'
    ].join(';');

    if (savedPos && typeof savedPos.left === 'number' && typeof savedPos.top === 'number') {
      const maxLeft = Math.max(0, window.innerWidth - 315);
      const maxTop = Math.max(0, window.innerHeight - 190);
      badge.style.left = Math.min(maxLeft, Math.max(0, savedPos.left)) + 'px';
      badge.style.top = Math.min(maxTop, Math.max(0, savedPos.top)) + 'px';
    } else {
      badge.style.right = '20px';
      badge.style.bottom = '20px';
    }

    badge.innerHTML = [
      '<div id="cx-auto-drag-handle" style="display:flex;align-items:center;justify-content:space-between;cursor:move;padding-bottom:7px;margin-bottom:8px;border-bottom:1px solid rgba(148,163,184,0.2);" title="按住此处拖动窗口">',
      '  <div id="cx-title-wrap" style="font-weight:700;color:#4ade80;font-size:13px;display:flex;align-items:center;gap:5px;">',
      '    <span id="cx-status-dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#4ade80;"></span>',
      '    <span>倍速 (<span id="cx-auto-rate-title">' + state.rate + '</span>x) + 自动下一节</span>',
      '  </div>',
      '  <div style="display:flex;align-items:center;gap:6px;">',
      '    <button type="button" id="cx-auto-toggle-btn" title="开关键位：点击切换开启/关闭（快捷键 Alt+S）" style="padding:2px 8px;border-radius:999px;border:1px solid #22c55e;background:rgba(34,197,94,0.22);color:#4ade80;font-size:11px;font-weight:700;cursor:pointer;line-height:1.4;">开启 [Alt+S]</button>',
      '    <span style="font-size:11px;color:#94a3b8;letter-spacing:1px;">⋮⋮</span>',
      '  </div>',
      '</div>',
      '<div id="cx-controls-body">',
      '  <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">',
      '    <span style="color:#cbd5e1;white-space:nowrap;">倍速 [1-16]:</span>',
      '    <input id="cx-auto-rate-range" type="range" min="1" max="16" step="0.05" value="' + state.rate + '" style="flex:1;cursor:pointer;accent-color:#4ade80;margin:0;" />',
      '    <input id="cx-auto-rate-input" type="number" min="1" max="16" step="0.1" value="' + state.rate + '" style="width:52px;background:#1e293b;color:#f8fafc;border:1px solid #475569;border-radius:5px;padding:2px 4px;font-size:12px;text-align:center;" />',
      '  </div>',
      '  <div id="cx-auto-presets" style="display:flex;gap:4px;margin-bottom:8px;">',
      [1, 2, 3, 4, 8, 16]
        .map(function (r) {
          return (
            '<button type="button" data-rate="' +
            r +
            '" style="flex:1;padding:3px 0;font-size:11px;border-radius:4px;border:1px solid #475569;background:#1e293b;color:#e2e8f0;cursor:pointer;">' +
            r +
            'x</button>'
          );
        })
        .join(''),
      '    <button type="button" id="cx-preset-max" data-mode="max" title="服务端要求真实观看时长≥视频时长×90%÷2（约45%），MAX据此动态控速（约2.2x），服务端确认任务点通过后16x冲刺；非任务点视频直接16x" style="flex:1.45;padding:3px 2px;font-size:11px;font-weight:700;border-radius:4px;border:1px solid #f59e0b;background:rgba(245,158,11,0.18);color:#fbbf24;cursor:pointer;">MAX</button>',
      '  </div>',
      '</div>',
      '<div id="cx-auto-chapter-text" style="color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px;">当前：检测中...</div>',
      '<div id="cx-auto-max-info" style="color:#fcd34d;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px;display:none;">MAX动态计算中...</div>',
      '<div id="cx-auto-status-text" style="color:#93c5fd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">状态：初始化中...</div>'
    ].join('');

    document.body.appendChild(badge);

    const rangeEl = document.getElementById('cx-auto-rate-range');
    const inputEl = document.getElementById('cx-auto-rate-input');
    const rateTitleEl = document.getElementById('cx-auto-rate-title');
    const titleWrapEl = document.getElementById('cx-title-wrap');
    const statusDotEl = document.getElementById('cx-status-dot');
    const toggleBtnEl = document.getElementById('cx-auto-toggle-btn');
    const controlsBodyEl = document.getElementById('cx-controls-body');
    const chapterTextEl = document.getElementById('cx-auto-chapter-text');
    const maxInfoEl = document.getElementById('cx-auto-max-info');
    const statusTextEl = document.getElementById('cx-auto-status-text');
    const presetBtns = Array.from(badge.querySelectorAll('#cx-auto-presets button[data-rate]'));
    const maxBtnEl = document.getElementById('cx-preset-max');
    const dragHandle = document.getElementById('cx-auto-drag-handle');

    function highlightPresetButtons() {
      presetBtns.forEach(function (btn) {
        const r = Number(btn.getAttribute('data-rate'));
        const active = state.mode === 'manual' && Math.abs(r - state.rate) < 0.01;
        btn.style.background = active ? '#16a34a' : '#1e293b';
        btn.style.borderColor = active ? '#4ade80' : '#475569';
        btn.style.color = active ? '#ffffff' : '#e2e8f0';
        btn.style.fontWeight = active ? '700' : '400';
      });
      if (maxBtnEl) {
        const isMax = state.mode === 'max';
        maxBtnEl.style.background = isMax ? '#d97706' : 'rgba(245,158,11,0.15)';
        maxBtnEl.style.borderColor = isMax ? '#fde68a' : '#f59e0b';
        maxBtnEl.style.color = isMax ? '#ffffff' : '#fbbf24';
        maxBtnEl.textContent = isMax ? 'MAX(' + state.rate + 'x)' : 'MAX';
      }
      if (maxInfoEl) {
        maxInfoEl.style.display = state.mode === 'max' ? 'block' : 'none';
      }
    }

    function applyEnabledUI() {
      if (!toggleBtnEl) return;
      if (state.enabled) {
        toggleBtnEl.textContent = '开启 [Alt+S]';
        toggleBtnEl.style.borderColor = '#22c55e';
        toggleBtnEl.style.background = 'rgba(34,197,94,0.22)';
        toggleBtnEl.style.color = '#4ade80';
        if (titleWrapEl) titleWrapEl.style.color = '#4ade80';
        if (statusDotEl) statusDotEl.style.background = '#4ade80';
        if (controlsBodyEl) controlsBodyEl.style.opacity = '1';
      } else {
        toggleBtnEl.textContent = '已关 [Alt+S]';
        toggleBtnEl.style.borderColor = '#ef4444';
        toggleBtnEl.style.background = 'rgba(239,68,68,0.22)';
        toggleBtnEl.style.color = '#fca5a5';
        if (titleWrapEl) titleWrapEl.style.color = '#94a3b8';
        if (statusDotEl) statusDotEl.style.background = '#ef4444';
        if (controlsBodyEl) controlsBodyEl.style.opacity = '0.55';
      }
    }

    function restoreNormalPlaybackOnDisable() {
      try {
        const cardFrame = document.getElementById('iframe');
        const cardDoc = cardFrame && cardFrame.contentDocument;
        if (!cardDoc) return;
        const videoFrames = Array.from(
          cardDoc.querySelectorAll('iframe.ans-insertvideo-online, iframe[src*="/modules/video/"]')
        );
        videoFrames.forEach(function (vf) {
          const vd = vf.contentDocument;
          const v = vd && vd.querySelector('video');
          if (v) {
            try {
              v.defaultPlaybackRate = 1;
              v.playbackRate = 1;
            } catch (e) {}
            const lbl = vd.querySelector('.vjs-playback-rate-value');
            if (lbl) lbl.textContent = '1x';
          }
        });
      } catch (e) {}
    }

    function setEnabled(nextEnabled) {
      state.enabled = !!nextEnabled;
      try {
        localStorage.setItem('cx_auto_enabled', state.enabled ? '1' : '0');
      } catch (e) {}
      applyEnabledUI();
      if (!state.enabled) {
        restoreNormalPlaybackOnDisable();
        state.statusText = '已关闭自动倍速与跳转（按 Alt+S 或点开关恢复）';
        updateBadge();
      } else {
        tick();
      }
      broadcastStateToBridge();
    }

    function setRateManual(newRate) {
      const r = clampRate(newRate);
      state.mode = 'manual';
      state.rate = r;
      try {
        localStorage.setItem('cx_auto_mode', 'manual');
        localStorage.setItem('cx_auto_rate', String(r));
      } catch (e) {}
      if (rangeEl && Number(rangeEl.value) !== r) rangeEl.value = String(r);
      if (inputEl && document.activeElement !== inputEl) inputEl.value = String(r);
      if (rateTitleEl) rateTitleEl.textContent = String(r);
      highlightPresetButtons();
      if (state.enabled) tick();
      broadcastStateToBridge();
    }

    function setModeMax() {
      state.mode = 'max';
      try {
        localStorage.setItem('cx_auto_mode', 'max');
      } catch (e) {}
      highlightPresetButtons();
      if (state.enabled) tick();
      broadcastStateToBridge();
    }

    function applyCalculatedMaxRate(r, infoText) {
      const clamped = clampRate(r);
      state.maxCalcRate = clamped;
      if (infoText) state.maxInfoText = infoText;
      if (state.mode === 'max') {
        state.rate = clamped;
        if (rangeEl && Number(rangeEl.value) !== clamped) rangeEl.value = String(clamped);
        if (inputEl && document.activeElement !== inputEl) inputEl.value = String(clamped);
        if (rateTitleEl) rateTitleEl.textContent = 'MAX:' + clamped;
        if (maxInfoEl && infoText && maxInfoEl.textContent !== infoText) {
          maxInfoEl.textContent = infoText;
          maxInfoEl.title = infoText;
        }
        highlightPresetButtons();
      }
    }

    toggleBtnEl.addEventListener('click', function (e) {
      e.stopPropagation();
      setEnabled(!state.enabled);
    });

    if (window.__cxHotkeyHandler) {
      window.removeEventListener('keydown', window.__cxHotkeyHandler, true);
    }
    window.__cxHotkeyHandler = function (e) {
      if (e.altKey && (e.key === 's' || e.key === 'S' || e.code === 'KeyS')) {
        e.preventDefault();
        setEnabled(!state.enabled);
      }
    };
    window.addEventListener('keydown', window.__cxHotkeyHandler, true);

    rangeEl.addEventListener('input', function (e) {
      setRateManual(e.target.value);
    });

    inputEl.addEventListener('change', function (e) {
      setRateManual(e.target.value);
      inputEl.value = String(state.rate);
    });

    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        setRateManual(inputEl.value);
        inputEl.value = String(state.rate);
        inputEl.blur();
      }
    });

    presetBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        setRateManual(btn.getAttribute('data-rate'));
      });
    });

    if (maxBtnEl) {
      maxBtnEl.addEventListener('click', function () {
        setModeMax();
      });
    }

    // Listen for commands from extension popup via bridge.js CustomEvent
    window.addEventListener('cx-ext-command', function (ev) {
      const detail = (ev && ev.detail) || {};
      if (detail.type === 'SET_ENABLED') {
        setEnabled(!!detail.enabled);
      } else if (detail.type === 'TOGGLE_ENABLED') {
        setEnabled(!state.enabled);
      } else if (detail.type === 'SET_MODE_MAX') {
        setModeMax();
      } else if (detail.type === 'SET_RATE_MANUAL') {
        setRateManual(detail.rate);
      } else if (detail.type === 'GET_STATE') {
        broadcastStateToBridge();
      }
    });

    function getCurrentChapterElement() {
      const chEl = document.getElementById('chapterIdid') || document.getElementById('curChapterId');
      const chId = (chEl && chEl.value) || '';
      if (chId) {
        const byId = document.getElementById('cur' + chId);
        if (byId) return byId;
      }
      return document.querySelector('#coursetree .posCatalog_active');
    }

    function broadcastStateToBridge() {
      try {
        const curEl = getCurrentChapterElement();
        const chTitle = (curEl && curEl.innerText.trim().replace(/\s+/g, ' ')) || '';
        window.dispatchEvent(
          new CustomEvent('cx-ext-state', {
            detail: {
              enabled: state.enabled,
              mode: state.mode,
              rate: state.rate,
              maxCalcRate: state.maxCalcRate,
              maxInfoText: state.maxInfoText,
              chapter: chTitle,
              statusText: state.statusText
            }
          })
        );
      } catch (e) {}
    }

    applyEnabledUI();
    highlightPresetButtons();

    // Drag support via Pointer Events
    (function () {
      let dragging = false;
      let startX = 0;
      let startY = 0;
      let origLeft = 0;
      let origTop = 0;

      dragHandle.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        if (e.target && e.target.closest && e.target.closest('#cx-auto-toggle-btn')) return;
        dragging = true;
        const rect = badge.getBoundingClientRect();
        origLeft = rect.left;
        origTop = rect.top;
        startX = e.clientX;
        startY = e.clientY;
        badge.style.right = 'auto';
        badge.style.bottom = 'auto';
        badge.style.left = origLeft + 'px';
        badge.style.top = origTop + 'px';
        try {
          dragHandle.setPointerCapture(e.pointerId);
        } catch (err) {}
        e.preventDefault();
      });

      dragHandle.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const maxLeft = Math.max(0, window.innerWidth - badge.offsetWidth);
        const maxTop = Math.max(0, window.innerHeight - badge.offsetHeight);
        const newLeft = Math.min(maxLeft, Math.max(0, origLeft + dx));
        const newTop = Math.min(maxTop, Math.max(0, origTop + dy));
        badge.style.left = newLeft + 'px';
        badge.style.top = newTop + 'px';
      });

      function endDrag(e) {
        if (!dragging) return;
        dragging = false;
        try {
          dragHandle.releasePointerCapture(e.pointerId);
        } catch (err) {}
        const rect = badge.getBoundingClientRect();
        try {
          localStorage.setItem(
            'cx_auto_badge_pos',
            JSON.stringify({
              left: Math.round(rect.left),
              top: Math.round(rect.top)
            })
          );
        } catch (err) {}
      }

      dragHandle.addEventListener('pointerup', endDrag);
      dragHandle.addEventListener('pointercancel', endDrag);
    })();

    function updateBadge(extra) {
      if (!badge) return;
      const activeChEl = getCurrentChapterElement();
      const activeTabEl = document.querySelector('#prev_tab .prev_ul li.active');
      const chTitle = activeChEl ? activeChEl.innerText.trim().replace(/\s+/g, ' ') : '';
      const tabTitle = activeTabEl ? activeTabEl.innerText.trim().replace(/\s+/g, ' ') : '';
      const nextChText = '当前：' + (chTitle || '加载中') + (tabTitle ? ' [' + tabTitle + ']' : '');
      const nextStatusText = '状态：' + (extra || state.statusText);
      const titleRateStr = state.mode === 'max' ? 'MAX:' + state.rate : String(state.rate);
      if (rateTitleEl && rateTitleEl.textContent !== titleRateStr) {
        rateTitleEl.textContent = titleRateStr;
      }
      if (chapterTextEl && chapterTextEl.textContent !== nextChText) {
        chapterTextEl.textContent = nextChText;
        chapterTextEl.title = nextChText;
      }
      if (statusTextEl && statusTextEl.textContent !== nextStatusText) {
        statusTextEl.textContent = nextStatusText;
      }
      broadcastStateToBridge();
    }

    function hasAttachmentJob(iframeEl) {
      const attachCt = iframeEl.closest('.ans-attach-ct') || iframeEl.parentElement;
      if (!attachCt) return false;
      return !!(attachCt.querySelector('.ans-job-icon') || attachCt.classList.contains('ans-job-finished'));
    }

    function isAttachmentJobFinished(iframeEl, win) {
      const attachCt = iframeEl.closest('.ans-attach-ct') || iframeEl.parentElement;
      const jobIcon = attachCt ? attachCt.querySelector('.ans-job-icon') : null;
      if (attachCt && attachCt.classList.contains('ans-job-finished')) return true;
      if (jobIcon && jobIcon.classList.contains('ans-job-finished')) return true;
      if (win && typeof win.checkJobFinish === 'function') {
        try {
          if (win.checkJobFinish()) return true;
        } catch (e) {}
      }
      if (!jobIcon) return true;
      return false;
    }

    function getVideoJobState(vf, vw, cardWin, v) {
      const attachCt = vf.closest('.ans-attach-ct') || vf.parentElement;
      const jobIcon = attachCt ? attachCt.querySelector('.ans-job-icon') : null;
      const domFinished = !!(
        (attachCt && attachCt.classList.contains('ans-job-finished')) ||
        (jobIcon && jobIcon.classList.contains('ans-job-finished'))
      );

      let mArgHasJob = false;
      let mArgPassedOnLoad = false;
      try {
        const setting = cardWin && (cardWin.AttachmentSetting || cardWin.mArg);
        const atts = (setting && setting.attachments) || [];
        let objId = '';
        try {
          const dataAttr = vf.getAttribute('data') || '';
          if (dataAttr) {
            const parsedData = JSON.parse(dataAttr);
            objId = (parsedData && parsedData.objectid) || '';
          }
        } catch (e) {}
        const videoAtt =
          atts.find(function (a) {
            return (
              a &&
              a.type === 'video' &&
              objId &&
              (a.objectId === objId || (a.property && a.property.objectid === objId))
            );
          }) ||
          atts.find(function (a) {
            return a && a.type === 'video';
          });
        if (videoAtt) {
          if (videoAtt.job || videoAtt.isPassed === false) {
            mArgHasJob = true;
          }
          if (videoAtt.isPassed === true && !videoAtt.job) {
            mArgPassedOnLoad = true;
          }
        }
      } catch (e) {}

      const hasJob = !!(jobIcon || domFinished || mArgHasJob || mArgPassedOnLoad);
      const jobFinished = !!(domFinished || (v && v.__cxServerPassed) || mArgPassedOnLoad);
      return { hasJob: hasJob, jobFinished: jobFinished };
    }

    function cardHasVideoInSetting(cardWin, cardDoc) {
      try {
        const setting = cardWin && (cardWin.AttachmentSetting || cardWin.mArg);
        const atts = (setting && setting.attachments) || [];
        if (
          atts.some(function (a) {
            return a && (a.type === 'video' || (a.property && a.property.module === 'insertvideo'));
          })
        ) {
          return true;
        }
      } catch (e) {}
      if (cardDoc && cardDoc.querySelector('.videoContainer, iframe[module="insertvideo"]')) {
        return true;
      }
      return false;
    }

    const submittedDocJobs = new Set();
    const scannedChapters = new Set();

    function triggerSidebarRefresh() {
      try {
        if (typeof window.onReadComplete1 === 'function') {
          window.onReadComplete1();
        }
      } catch (e) {}
    }

    function getCourseContextParams() {
      const qs = new URLSearchParams(location.search || '');
      const clazzId =
        (document.getElementById('clazzIdid') && document.getElementById('clazzIdid').value) ||
        qs.get('clazzid') ||
        qs.get('clazzId') ||
        '';
      const courseId =
        (document.getElementById('courseIdid') && document.getElementById('courseIdid').value) ||
        qs.get('courseid') ||
        qs.get('courseId') ||
        '';
      const cpi =
        (document.getElementById('cpi') && document.getElementById('cpi').value) ||
        qs.get('cpi') ||
        '';
      return { clazzId: clazzId, courseId: courseId, cpi: cpi };
    }

    // The order of mArg.attachments does not match the order of .ans-attach-ct in the card (e.g. a PPT listed
    // first can render after the video), so containers must be matched by objectid, never by index.
    function findAttachmentContainer(cardDoc, att) {
      if (!cardDoc || !att) return null;
      const objId = att.objectId || (att.property && att.property.objectid) || '';
      if (!objId) return null;
      const frames = Array.from(cardDoc.querySelectorAll('.ans-attach-ct iframe'));
      for (let i = 0; i < frames.length; i++) {
        const f = frames[i];
        let fid = f.getAttribute('objectid') || '';
        if (!fid) {
          try {
            const data = JSON.parse(f.getAttribute('data') || 'null');
            fid = (data && data.objectid) || '';
          } catch (e) {}
        }
        if (fid === objId) return f.closest('.ans-attach-ct');
      }
      return null;
    }

    function completeDocsFromAttachmentSetting(cardWin, cardDoc) {
      let anyDocJob = false;
      let allDocJobDone = true;
      try {
        const setting = cardWin && (cardWin.AttachmentSetting || cardWin.mArg);
        if (!setting || !setting.defaults || !Array.isArray(setting.attachments)) {
          return { anyDocJob: false, allDocJobDone: true };
        }
        const def = setting.defaults;
        setting.attachments.forEach(function (att, idx) {
          const isDoc =
            att && (att.type === 'document' || (att.property && att.property.module === 'insertdoc'));
          if (!isDoc) return;
          anyDocJob = true;
          const ct = findAttachmentContainer(cardDoc, att);
          const domFinished = !!(ct && ct.classList.contains('ans-job-finished'));
          if (!att.job || domFinished || submittedDocJobs.has(String(att.jobid) + ':done')) {
            if (ct && !ct.classList.contains('ans-job-finished')) {
              ct.classList.add('ans-job-finished');
            }
            return;
          }
          allDocJobDone = false;
          if (!att.jobid || !att.jtoken) return;
          const jobKey = String(att.jobid);
          if (submittedDocJobs.has(jobKey)) return;
          submittedDocJobs.add(jobKey);

          const url =
            '/mooc-ans/job/document?jobid=' +
            encodeURIComponent(att.jobid) +
            '&knowledgeid=' +
            encodeURIComponent(def.knowledgeid) +
            '&courseid=' +
            encodeURIComponent(def.courseid) +
            '&clazzid=' +
            encodeURIComponent(def.clazzId) +
            '&jtoken=' +
            encodeURIComponent(att.jtoken) +
            '&_dc=' +
            Date.now() +
            '&checkMicroTopic=true&microTopicId=0&courseEngineInfo=false';

          fetch(url, { credentials: 'include' })
            .then(function (r) {
              return r.json();
            })
            .then(function (data) {
              if (data && data.status) {
                submittedDocJobs.add(jobKey + ':done');
                att.job = false;
                try {
                  if (cardWin.JC && typeof cardWin.JC.completed === 'function') {
                    cardWin.JC.completed(idx);
                  }
                } catch (e) {}
                if (ct) ct.classList.add('ans-job-finished');
                triggerSidebarRefresh();
              } else {
                submittedDocJobs.delete(jobKey);
              }
            })
            .catch(function () {
              submittedDocJobs.delete(jobKey);
            });
        });
      } catch (e) {}
      return { anyDocJob: anyDocJob, allDocJobDone: allDocJobDone };
    }

    function scanChapterDocsInBackground(chId) {
      if (!chId || scannedChapters.has(chId)) return;
      const ctx = getCourseContextParams();
      if (!ctx.clazzId || !ctx.courseId) return;
      scannedChapters.add(chId);
      [0, 1, 2].forEach(function (num) {
        const cardUrl =
          '/mooc-ans/knowledge/cards?clazzid=' +
          encodeURIComponent(ctx.clazzId) +
          '&courseid=' +
          encodeURIComponent(ctx.courseId) +
          '&knowledgeid=' +
          encodeURIComponent(chId) +
          '&num=' +
          num +
          '&ut=s&cpi=' +
          encodeURIComponent(ctx.cpi) +
          '&v=2025-0424-1938-3&mooc2=1&isMicroCourse=false';
        fetch(cardUrl, { credentials: 'include' })
          .then(function (r) {
            return r.text();
          })
          .then(function (html) {
            const m = html.match(/mArg\s*=\s*(\{[\s\S]*?\});/);
            if (!m) return;
            const parsed = JSON.parse(m[1]);
            const def = parsed && parsed.defaults;
            const atts = (parsed && parsed.attachments) || [];
            atts.forEach(function (att) {
              const isDoc =
                att && (att.type === 'document' || (att.property && att.property.module === 'insertdoc'));
              if (isDoc && att.job && att.jobid && att.jtoken) {
                const jobKey = String(att.jobid);
                if (submittedDocJobs.has(jobKey + ':done')) return;
                const docUrl =
                  '/mooc-ans/job/document?jobid=' +
                  encodeURIComponent(att.jobid) +
                  '&knowledgeid=' +
                  encodeURIComponent(def.knowledgeid) +
                  '&courseid=' +
                  encodeURIComponent(def.courseid) +
                  '&clazzid=' +
                  encodeURIComponent(def.clazzId) +
                  '&jtoken=' +
                  encodeURIComponent(att.jtoken) +
                  '&_dc=' +
                  Date.now() +
                  '&checkMicroTopic=true&microTopicId=0&courseEngineInfo=false';
                fetch(docUrl, { credentials: 'include' })
                  .then(function (r2) {
                    return r2.json();
                  })
                  .then(function (d2) {
                    if (d2 && d2.status) {
                      submittedDocJobs.add(jobKey + ':done');
                      triggerSidebarRefresh();
                    }
                  })
                  .catch(function () {});
              }
            });
          })
          .catch(function () {});
      });
    }

    function scanAllOpenChapterDocs() {
      try {
        const allCh = Array.from(document.querySelectorAll('#coursetree .posCatalog_select')).filter(
          function (el) {
            return !!el.querySelector('[onclick*="getTeacherAjax"]');
          }
        );
        allCh.forEach(function (el) {
          const cid = (el.id || '').replace(/^cur/, '');
          if (cid) scanChapterDocsInBackground(cid);
        });
      } catch (e) {}
    }

    // MAX rate, derived from what the Chaoxing server actually accepts (measured live, rt=0.9, ds_1):
    // the server credits the real time elapsed between this job's heartbeat logs (accumulated across
    // sessions and replays) and returns isPassed once that time reaches about D * rt / 2, i.e. it allows an
    // average of 2x. Measured on a 3148s and a 3106s video: still false at 37% / 43.2% of D, passed at the
    // next heartbeat at ~45%, regardless of whether the heartbeats were sent at 2.5x, 3x or 3.6x.
    // Playing faster than D / (D * rt / 2) only makes the video end early and replay, so MAX paces the
    // video to finish right when the required time is reached, then sprints at 16x once the server confirms.
    const MAX_PRE_PASS_RATE_CAP = 3;
    const MAX_TIME_MARGIN_SEC = 75;

    function trackPlayback(v) {
      const now = Date.now();
      const curPos = Number(v.currentTime) || 0;
      if (typeof v.__cxLastTickAt !== 'number') {
        v.__cxActivePlayedSec = 0;
        v.__cxLastTickAt = now;
        v.__cxLastVideoPos = curPos;
        v.__cxLastProgressAt = now;
        return;
      }
      const dt = Math.max(0, Math.min(2, (now - v.__cxLastTickAt) / 1000));
      const posDelta = Math.abs(curPos - (v.__cxLastVideoPos || 0));
      if (posDelta > 0.02 || v.paused || v.ended) {
        v.__cxLastProgressAt = now;
      }
      // Only time with the timeline actually advancing counts; stalls send no heartbeats.
      if (!v.paused && !v.ended && posDelta > 0.001) {
        v.__cxActivePlayedSec = (v.__cxActivePlayedSec || 0) + dt;
      }
      v.__cxLastTickAt = now;
      v.__cxLastVideoPos = curPos;
    }

    function computeDynamicMaxRate(vf, cardWin, v, jobFinished, hasJob) {
      const D = Number(v && v.duration) || 0;
      if (!D || !Number.isFinite(D) || D <= 0) {
        return { rate: 2, info: 'MAX: 等待获取视频总时长...' };
      }
      const curPos = Math.max(0, Math.min(D, Number(v.currentTime) || 0));

      if (jobFinished || v.__cxServerPassed) {
        return { rate: 16, info: 'MAX(任务点已通过) -> 16x冲刺' };
      }
      if (!hasJob) {
        return { rate: 16, info: 'MAX(非任务点视频) -> 16x' };
      }

      let rtVal = 0.9;
      try {
        const vw = vf && vf.contentWindow;
        const p = vw && vw.videojs && vw.videojs.getPlayers && vw.videojs.getPlayers().video;
        if (p && p.options_ && Number(p.options_.rt) > 0) rtVal = Number(p.options_.rt);
      } catch (e) {}

      const requiredSec = Math.ceil((D * rtVal) / 2) + MAX_TIME_MARGIN_SEC;
      const watchedSec = Math.floor(v.__cxActivePlayedSec || 0);
      const remWall = requiredSec - watchedSec;
      const remVideo = Math.max(0, D - curPos);

      let rate;
      if (remWall <= 0) {
        // Locally the requirement is met; keep a steady pace so heartbeats keep flowing until the server
        // confirms (if the video ends first, the ended handler replays it).
        rate = 2;
      } else {
        rate = Math.floor((remVideo / remWall) * 100) / 100;
        rate = Math.min(MAX_PRE_PASS_RATE_CAP, Math.max(1, rate));
      }

      return {
        rate: rate,
        info:
          'MAX(需实看' +
          requiredSec +
          's): 已看' +
          watchedSec +
          's | 剩' +
          Math.round(remVideo) +
          's -> ' +
          rate +
          'x'
      };
    }

    function patchVideoIframe(vf, cardWin) {
      try {
        const vw = vf.contentWindow;
        const vd = vf.contentDocument;
        if (!vw || !vd) return null;

        try {
          vd.hasFocus = function () {
            return true;
          };
          window.document.hasFocus = function () {
            return true;
          };
          Object.defineProperty(vd, 'hidden', { get: function () { return false; }, configurable: true });
          Object.defineProperty(vd, 'visibilityState', { get: function () { return 'visible'; }, configurable: true });
          Object.defineProperty(window.document, 'hidden', { get: function () { return false; }, configurable: true });
          Object.defineProperty(window.document, 'visibilityState', { get: function () { return 'visible'; }, configurable: true });
        } catch (e) {}

        try {
          if (vw.Ext && vw.Ext.setCookie) {
            vw.Ext.setCookie('rate', 2);
          }
        } catch (e) {}

        if (!vd.__cxHotkeyBound) {
          vd.__cxHotkeyBound = true;
          vd.addEventListener(
            'keydown',
            function (e) {
              if (e.altKey && (e.key === 's' || e.key === 'S' || e.code === 'KeyS')) {
                e.preventDefault();
                setEnabled(!state.enabled);
              }
            },
            true
          );
        }

        const p = vw.videojs && vw.videojs.getPlayers && vw.videojs.getPlayers().video;
        const v = vd.querySelector('video');
        if (!p || !v || !Number.isFinite(Number(v.duration)) || Number(v.duration) <= 0) {
          // The player uses preload="none", so metadata (and duration) only loads after play() is called.
          if (
            state.enabled &&
            p &&
            v &&
            v.paused &&
            Date.now() - (v.__cxLoadKickAt || 0) > 4000
          ) {
            v.__cxLoadKickAt = Date.now();
            try {
              if (!v.__cxMustMuteForAutoplay) {
                v.muted = false;
                v.volume = 0.01;
              }
              const kp = p.play ? p.play() : v.play();
              if (kp && kp.catch) {
                kp.catch(function () {
                  v.__cxMustMuteForAutoplay = true;
                  v.muted = true;
                  try {
                    const kp2 = p.play ? p.play() : v.play();
                    if (kp2 && kp2.catch) kp2.catch(function () {});
                  } catch (e2) {}
                });
              }
            } catch (e) {}
          }
          return { ready: false };
        }

        // Hook XMLHttpRequest inside the video iframe to detect server {"isPassed": true} immediately
        try {
          if (vw.performance && typeof vw.performance.setResourceTimingBufferSize === 'function' && !vw.__cxRtBuf) {
            vw.__cxRtBuf = true;
            vw.performance.setResourceTimingBufferSize(5000);
          }
          if (vw.XMLHttpRequest && vw.XMLHttpRequest.prototype && !vw.XMLHttpRequest.prototype.__cxHookedV2) {
            const origOpen = vw.XMLHttpRequest.prototype.open;
            const origSend = vw.XMLHttpRequest.prototype.send;
            vw.XMLHttpRequest.prototype.open = function (method, url) {
              this.__cxUrl = String(url || '');
              return origOpen.apply(this, arguments);
            };
            vw.XMLHttpRequest.prototype.send = function () {
              if (this.__cxUrl && this.__cxUrl.includes('/multimedia/log/')) {
                // selectCDN() reloads the source, so currentTime briefly reads 0 and Chaoxing's periodic
                // heartbeat reports playingTime=0. The server treats that as a rewind and discards the
                // progress accumulated so far, so drop that single bogus report.
                try {
                  const vid = vd.querySelector('video');
                  const qs = new URL(this.__cxUrl, vw.location.href).searchParams;
                  const pt = Number(qs.get('playingTime'));
                  if (
                    vid &&
                    qs.get('isdrag') === '0' &&
                    vid.__cxCdnSwitchUntil &&
                    Date.now() < vid.__cxCdnSwitchUntil &&
                    Number.isFinite(pt) &&
                    pt < (vid.__cxCdnSwitchFrom || 0) - 5
                  ) {
                    return undefined;
                  }
                } catch (e) {}
                this.addEventListener('load', function () {
                  try {
                    const txt = this.responseText || '';
                    if (txt.includes('isPassed')) {
                      const parsed = JSON.parse(txt);
                      if (parsed && parsed.isPassed) {
                        const vid = vd.querySelector('video');
                        if (vid) vid.__cxServerPassed = true;
                        try {
                          if (typeof vw.proxy_completed === 'function') vw.proxy_completed();
                        } catch (e) {}
                        triggerSidebarRefresh();
                      }
                    }
                  } catch (e) {}
                });
              }
              return origSend.apply(this, arguments);
            };
            vw.XMLHttpRequest.prototype.__cxHookedV2 = true;
          }
        } catch (e) {}

        const jobState = getVideoJobState(vf, vw, cardWin, v);
        const hasJob = jobState.hasJob;
        // Never use client-side p.finished when hasJob is true, because Video.js sets p.finished = true
        // on the 'ended' event even when the server returns {"isPassed": false}!
        const jobFinished = jobState.jobFinished || (!hasJob && !!(p && p.finished));

        if (typeof v.__cxPassedOnInit !== 'boolean') {
          v.__cxPassedOnInit = !!jobFinished;
        }
        if (jobFinished && !v.__cxPassedAt) {
          v.__cxPassedAt = Date.now();
        }
        const readyToAdvance =
          jobFinished &&
          (v.__cxPassedOnInit ||
            v.ended ||
            (v.__cxPassedAt && Date.now() - v.__cxPassedAt > 15000));

        // A task video resumed near its end can finish before the next 60s heartbeat fires, and the pass is
        // only granted on a heartbeat, so restart it from 0 to guarantee at least one in-cap heartbeat.
        if (
          hasJob &&
          !jobFinished &&
          !v.__cxInitialSeekChecked &&
          Number(v.duration) > 60 &&
          Number(v.currentTime) > 0
        ) {
          v.__cxInitialSeekChecked = true;
          const dur = Number(v.duration);
          const rem = dur - Number(v.currentTime);
          if ((v.__cxActivePlayedSec || 0) < 5 && rem < dur * 0.28) {
            try {
              p.finished = false;
              p.ignoreSeek = false;
              p.switchStatus = true;
              v.currentTime = 0;
              if (p.currentTime) p.currentTime(0);
            } catch (e) {}
          }
        }

        trackPlayback(v);

        if (state.mode === 'max') {
          const maxObj = computeDynamicMaxRate(vf, cardWin, v, jobFinished, hasJob);
          applyCalculatedMaxRate(maxObj.rate, maxObj.info);
        }

        // Auto-recover from CDN line stall (e.g., s2.cldisk.com hanging in readyState <= 2):
        // If video is playing (!paused && !ended) but currentTime hasn't advanced for >8s, switch CDN playline.
        if (
          !v.paused &&
          !v.ended &&
          Number(v.duration) - Number(v.currentTime) > 3 &&
          v.__cxLastProgressAt &&
          Date.now() - v.__cxLastProgressAt > 8000 &&
          Date.now() - (v.__cxLastCdnSwitchAt || 0) > 15000
        ) {
          v.__cxLastCdnSwitchAt = Date.now();
          v.__cxLastProgressAt = Date.now();
          try {
            if (
              p &&
              typeof p.selectCDN === 'function' &&
              p.options_ &&
              Array.isArray(p.options_.playlines) &&
              p.options_.playlines.length > 1
            ) {
              const curLine = typeof p.currentPlayline === 'function' ? p.currentPlayline() : null;
              const curIdx = curLine && typeof curLine.indexorder === 'number' ? curLine.indexorder : 0;
              const nextIdx = (curIdx + 1) % p.options_.playlines.length;
              v.__cxCdnSwitchFrom = Number(v.currentTime) || 0;
              v.__cxCdnSwitchUntil = Date.now() + 30000;
              p.ignoreSeek = true;
              p.selectCDN(nextIdx);
            } else {
              v.play().catch(function () {});
            }
          } catch (e) {}
        }

        if (!v.__cxPatched3x) {
          v.__cxPatched3x = true;

          try {
            p.off('ratechange');
          } catch (e) {}

          v.addEventListener(
            'ratechange',
            function () {
              if (!state.enabled) return;
              const targetRate = (window.__cxAuto3xState && window.__cxAuto3xState.rate) || state.rate;
              if (Math.abs(v.playbackRate - targetRate) > 0.005) {
                try {
                  v.defaultPlaybackRate = targetRate;
                  v.playbackRate = targetRate;
                } catch (e) {}
              }
              const lbl = vd.querySelector('.vjs-playback-rate-value');
              if (lbl) lbl.textContent = targetRate + 'x';
            },
            true
          );

          v.addEventListener(
            'play',
            function () {
              if (!state.enabled) return;
              const targetRate = (window.__cxAuto3xState && window.__cxAuto3xState.rate) || state.rate;
              if (Math.abs(v.playbackRate - targetRate) > 0.005) {
                try {
                  v.defaultPlaybackRate = targetRate;
                  v.playbackRate = targetRate;
                } catch (e) {}
              }
              const lbl = vd.querySelector('.vjs-playback-rate-value');
              if (lbl) lbl.textContent = targetRate + 'x';
            },
            true
          );

          v.addEventListener(
            'timeupdate',
            function () {
              if (!state.enabled) return;
              const sec = Math.floor(v.currentTime || 0);
              if (typeof p.dragCutOffTime === 'number' && sec > p.dragCutOffTime) {
                p.dragCutOffTime = sec;
              }
            },
            true
          );
        }

        try {
          p.off('ratechange');
          p.playbackRate = function () {
            if (!state.enabled) return v ? v.playbackRate : 1;
            const targetRate = (window.__cxAuto3xState && window.__cxAuto3xState.rate) || state.rate;
            if (v && Math.abs(v.playbackRate - targetRate) > 0.005) {
              try {
                v.defaultPlaybackRate = targetRate;
                v.playbackRate = targetRate;
              } catch (e) {}
            }
            const lbl = vd.querySelector('.vjs-playback-rate-value');
            if (lbl) lbl.textContent = targetRate + 'x';
            return targetRate;
          };
        } catch (e) {}

        if (Math.abs(v.playbackRate - state.rate) > 0.005) {
          try {
            v.defaultPlaybackRate = state.rate;
            v.playbackRate = state.rate;
          } catch (e) {}
        }
        const lbl = vd.querySelector('.vjs-playback-rate-value');
        if (lbl && lbl.textContent !== state.rate + 'x') {
          lbl.textContent = state.rate + 'x';
        }

        // Prevent Chromium background-tab media suspend:
        // Chromium automatically pauses muted <video> elements when the tab/window is hidden.
        // Keeping v.muted = false at 1% volume prevents background pause while staying nearly silent.
        if (!v.__cxMustMuteForAutoplay) {
          try {
            if (v.muted) {
              v.muted = false;
              if (p.muted) p.muted(false);
            }
            if (v.volume > 0.02) {
              v.volume = 0.01;
              if (p.volume) p.volume(0.01);
            }
          } catch (e) {}
        }

        const curSec = Math.floor(v.currentTime || 0);
        if (typeof p.dragCutOffTime === 'number' && curSec > p.dragCutOffTime) {
          p.dragCutOffTime = curSec;
        }

        if (jobFinished && !v.__cxSidebarRefreshed) {
          v.__cxSidebarRefreshed = true;
          triggerSidebarRefresh();
        }

        if (v.ended && hasJob && !jobFinished) {
          if (!v.__cxEndedAt) {
            v.__cxEndedAt = Date.now();
          } else if (Date.now() - v.__cxEndedAt > 2500) {
            v.__cxEndedAt = 0;
            try {
              p.finished = false;
              p.ignoreSeek = false;
              p.switchStatus = true;
              v.currentTime = 0;
              if (p.currentTime) p.currentTime(0);
              const rp = p.play ? p.play() : v.play();
              if (rp && rp.catch) rp.catch(function () {});
            } catch (e) {}
          }
        } else {
          v.__cxEndedAt = 0;
        }

        if (v.paused && !v.ended && (!v.__cxAutoPlayedOnce || !jobFinished)) {
          v.__cxAutoPlayedOnce = true;
          try {
            if (!v.__cxMustMuteForAutoplay) {
              v.muted = false;
              v.volume = 0.01;
            }
            const playPromise = p.play ? p.play() : v.play();
            if (playPromise && playPromise.catch) {
              playPromise.catch(function () {
                v.__cxMustMuteForAutoplay = true;
                v.muted = true;
                try {
                  p.muted(true);
                } catch (e) {}
                try {
                  const p2 = p.play ? p.play() : v.play();
                  if (p2 && p2.catch) p2.catch(function () {});
                } catch (e2) {}
              });
            }
          } catch (e) {}
        }

        return {
          ready: true,
          paused: v.paused,
          ended: v.ended,
          rate: v.playbackRate,
          currentTime: v.currentTime,
          duration: v.duration,
          dragCutOffTime: p.dragCutOffTime,
          hasJob: hasJob,
          jobFinished: jobFinished,
          readyToAdvance: readyToAdvance
        };
      } catch (e) {
        return { ready: false, error: String(e) };
      }
    }

    function handleDocIframes(cardDoc, cardWin) {
      const settingRes = completeDocsFromAttachmentSetting(cardWin, cardDoc);
      const docFrames = cardDoc.querySelectorAll(
        'iframe[src*="/modules/pdf/"], iframe[src*="/modules/ppt/"], iframe[src*="/modules/doc/"], iframe[src*="/modules/xls/"], iframe[src*="/modules/innerbook/"], iframe.ans-insertdoc-online, iframe.insertdoc-online-ppt, iframe.insertdoc-online-pdf, iframe.insertdoc-online-doc'
      );
      let anyDoc = settingRes.anyDocJob;
      let allDocDone = settingRes.allDocJobDone;
      docFrames.forEach(function (df) {
        anyDoc = true;
        try {
          const dw = df.contentWindow;
          let done = isAttachmentJobFinished(df, dw);
          if (!done && dw) {
            if (typeof dw.unMaskAndFinishJob === 'function') {
              try {
                dw.unMaskAndFinishJob();
              } catch (e) {}
            }
            if (typeof dw.finishJob === 'function') {
              try {
                dw.finishJob();
              } catch (e) {}
            }
            done = isAttachmentJobFinished(df, dw);
          }
          if (done && !df.__cxDocRefreshed) {
            df.__cxDocRefreshed = true;
            triggerSidebarRefresh();
          }
          if (!done) allDocDone = false;
        } catch (e) {
          allDocDone = false;
        }
      });
      return { anyDoc: anyDoc, allDocDone: allDocDone };
    }

    function isChapterCompletedInTree(chEl) {
      if (!chEl) return false;
      if (chEl.querySelector('.icon_Completed')) return true;
      const unfinishInput = chEl.querySelector('input.jobUnfinishCount');
      if (unfinishInput && Number(unfinishInput.value) > 0) return false;
      const orange = chEl.querySelector('.orangeNew');
      if (orange && Number(orange.textContent.trim()) > 0) return false;
      return false;
    }

    function advanceToNext() {
      const now = Date.now();
      if (now - state.lastSwitchAt < 2500) return;
      state.lastSwitchAt = now;

      triggerSidebarRefresh();

      const curCh = getCurrentChapterElement();
      const curChCompleted = curCh ? isChapterCompletedInTree(curCh) : false;

      const tabs = Array.from(document.querySelectorAll('#prev_tab .prev_ul li'));
      const activeIdx = tabs.findIndex(function (li) {
        return li.classList.contains('active');
      });
      if (!curChCompleted && activeIdx >= 0 && activeIdx + 1 < tabs.length) {
        const nextTab = tabs[activeIdx + 1];
        state.statusText = '正在切换到下一标签：' + nextTab.innerText.trim();
        updateBadge();
        nextTab.click();
        return;
      }

      const chapterEl =
        document.getElementById('chapterIdid') || document.getElementById('curChapterId');
      const chapterId = chapterEl ? chapterEl.value : '';
      const allChapters = Array.from(
        document.querySelectorAll('#coursetree .posCatalog_select')
      ).filter(function (el) {
        return !!el.querySelector('[onclick*="getTeacherAjax"]');
      });
      let curIdx = -1;
      if (chapterId) {
        curIdx = allChapters.findIndex(function (el) {
          return el.id === 'cur' + chapterId;
        });
      }
      if (curIdx < 0) {
        curIdx = allChapters.findIndex(function (el) {
          return el.classList.contains('posCatalog_active');
        });
      }

      let targetCh = null;
      for (let i = curIdx + 1; i < allChapters.length; i++) {
        if (!isChapterCompletedInTree(allChapters[i])) {
          targetCh = allChapters[i];
          break;
        }
      }
      if (!targetCh) {
        for (let i = 0; i < allChapters.length; i++) {
          if (i !== curIdx && !isChapterCompletedInTree(allChapters[i])) {
            targetCh = allChapters[i];
            break;
          }
        }
      }

      if (targetCh) {
        const clickTarget = targetCh.querySelector('[onclick*="getTeacherAjax"]');
        if (clickTarget) {
          try {
            document.querySelectorAll('#coursetree .posCatalog_active').forEach(function (el) {
              el.classList.remove('posCatalog_active');
            });
            targetCh.classList.add('posCatalog_active');
          } catch (e) {}
          state.statusText =
            '本节已完成，正在进入：' + targetCh.innerText.trim().replace(/\s+/g, ' ');
          updateBadge();
          clickTarget.click();
          return;
        }
      }

      if (!state.statusText || !state.statusText.includes('播放中')) {
        state.statusText = '当前已开放章节已全部完成';
        updateBadge();
      }
    }

    function tick() {
      if (!state.enabled) {
        updateBadge('已关闭自动倍速与跳转（按 Alt+S 或点开关恢复）');
        return;
      }
      try {
        const chEl =
          document.getElementById('chapterIdid') || document.getElementById('curChapterId');
        const chId = (chEl && chEl.value) || '';
        if (chId) {
          scanChapterDocsInBackground(chId);
        }
        const tabs = Array.from(document.querySelectorAll('#prev_tab .prev_ul li'));
        const activeIdx = tabs.findIndex(function (li) {
          return li.classList.contains('active');
        });
        const activeTab = activeIdx >= 0 ? tabs[activeIdx] : null;
        const tabId = (activeTab && activeTab.id) || '';
        const key = chId + ':' + tabId;
        if (key !== state.lastKey) {
          state.lastKey = key;
          state.tabEnteredAt = Date.now();
        }
        const elapsedOnTab = Date.now() - state.tabEnteredAt;

        const cardFrame = document.getElementById('iframe');
        const cardWin = cardFrame && cardFrame.contentWindow;
        const cardDoc = cardFrame && cardFrame.contentDocument;
        const cardHref = (cardWin && cardWin.location && cardWin.location.href) || '';
        if (!cardDoc || cardDoc.readyState !== 'complete' || !cardHref.includes('/knowledge/cards')) {
          state.statusText = '等待章节卡片加载...';
          updateBadge();
          return;
        }

        const urlParams = new URLSearchParams((cardWin.location && cardWin.location.search) || '');
        const expectedNum = activeIdx >= 0 ? String(activeIdx) : '0';
        if (
          (chId && urlParams.get('knowledgeid') && urlParams.get('knowledgeid') !== chId) ||
          (urlParams.get('num') !== null && urlParams.get('num') !== expectedNum)
        ) {
          state.statusText = '正在切换章节卡片...';
          updateBadge();
          return;
        }

        const docStatus = handleDocIframes(cardDoc, cardWin);

        const videoFrames = Array.from(
          cardDoc.querySelectorAll('iframe.ans-insertvideo-online, iframe[src*="/modules/video/"]')
        );
        if (videoFrames.length === 0 && cardHasVideoInSetting(cardWin, cardDoc) && elapsedOnTab < 12000) {
          state.statusText = '等待视频组件初始化...';
          updateBadge();
          return;
        }
        if (videoFrames.length > 0) {
          let allVideosDone = true;
          const statusParts = [];
          videoFrames.forEach(function (vf) {
            const info = patchVideoIframe(vf, cardWin);
            if (!info || !info.ready) {
              allVideosDone = false;
              statusParts.push('视频加载中...');
              return;
            }
            const curMin = Math.floor((info.currentTime || 0) / 60);
            const curSec = Math.floor((info.currentTime || 0) % 60)
              .toString()
              .padStart(2, '0');
            const durMin = Math.floor((info.duration || 0) / 60);
            const durSec = Math.floor((info.duration || 0) % 60)
              .toString()
              .padStart(2, '0');
            const modePrefix = state.mode === 'max' ? 'MAX(' + info.rate + 'x)' : info.rate + 'x';
            statusParts.push(
              modePrefix +
                ' 播放中 (' +
                curMin +
                ':' +
                curSec +
                ' / ' +
                durMin +
                ':' +
                durSec +
                ')' +
                (info.jobFinished ? ' [视频已完成]' : '')
            );
            if (info.hasJob) {
              if (!info.readyToAdvance) allVideosDone = false;
            } else {
              if (!info.ended && !info.jobFinished) allVideosDone = false;
            }
          });
          if (docStatus.anyDoc) {
            statusParts.push(docStatus.allDocDone ? '[PPT/文档已完成]' : '[正在完成PPT/文档...]');
          }
          state.statusText = statusParts.join(' ');
          updateBadge();

          const allTabJobsDone = allVideosDone && (!docStatus.anyDoc || docStatus.allDocDone);
          if (allTabJobsDone && elapsedOnTab > 2000) {
            advanceToNext();
          }
          return;
        }

        if (state.mode === 'max' && maxInfoEl) {
          maxInfoEl.textContent = 'MAX动态: 当前标签页无视频，等待切换视频页...';
        }

        if (docStatus.anyDoc) {
          state.statusText = docStatus.allDocDone
            ? 'PPT/文档任务点已完成，即将进入下一节...'
            : '正在完成PPT/文档任务点...';
          updateBadge();
          if ((docStatus.allDocDone && elapsedOnTab > 1500) || elapsedOnTab > 6000) {
            advanceToNext();
          }
          return;
        }

        const unfinishedJobs = cardDoc.querySelectorAll(
          '.ans-attach-ct:not(.ans-job-finished) .ans-job-icon'
        );
        if (unfinishedJobs.length === 0 && elapsedOnTab > 3000) {
          state.statusText = '当前标签页已完成';
          updateBadge();
          advanceToNext();
        }
      } catch (e) {}
    }

    scanAllOpenChapterDocs();
    window.__cxAuto3xTimer = setInterval(tick, 500);
    tick();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootController);
  } else {
    bootController();
  }
})();
