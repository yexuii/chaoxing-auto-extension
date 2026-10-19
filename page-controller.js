/**
 * 超星学习通自动倍速与任务点助手 (Main-World Controller)
 * 功能：
 * 1. [1, 16] 可调倍速（滑块 + 数字框 + 1x/2x/3x/4x/8x/16x 预设按钮）
 * 2. MAX 动态倍速档位：基于超星服务端实际判定阈值 (rt=0.9, ds_1 允许倍速下真实观看时长阈值 22.5%，取 25% 安全值)
 *    动态计算 R = (D - 当前进度) / (0.25 * D - 真实已看时长)，达标后 16x 冲刺
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
      '    <button type="button" id="cx-preset-max" data-mode="max" title="基于超星实际判定阈值(rt=0.9且允许倍速ds=1下，真实时长阈值为22.5%，取25%安全值)动态计算：R=(D-当前进度)/(0.25*D-真实已播)，满25%后16x冲刺" style="flex:1.45;padding:3px 2px;font-size:11px;font-weight:700;border-radius:4px;border:1px solid #f59e0b;background:rgba(245,158,11,0.18);color:#fbbf24;cursor:pointer;">MAX</button>',
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

    function broadcastStateToBridge() {
      try {
        const chTitle =
          (document.querySelector('#coursetree .posCatalog_active') &&
            document.querySelector('#coursetree .posCatalog_active').innerText.trim().replace(/\s+/g, ' ')) ||
          '';
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
      const activeChEl = document.querySelector('#coursetree .posCatalog_active');
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
      if (!jobIcon && !(attachCt && attachCt.classList.contains('ans-job-finished'))) {
        if (win && typeof win.checkJobFinish === 'function') {
          try {
            return !!win.checkJobFinish();
          } catch (e) {}
        }
        return true;
      }
      if (attachCt && attachCt.classList.contains('ans-job-finished')) return true;
      if (jobIcon && jobIcon.classList.contains('ans-job-finished')) return true;
      if (win && typeof win.checkJobFinish === 'function') {
        try {
          if (win.checkJobFinish()) return true;
        } catch (e) {}
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

    function completeDocsFromAttachmentSetting(cardWin, cardDoc) {
      let anyDocJob = false;
      let allDocJobDone = true;
      try {
        const setting = cardWin && (cardWin.AttachmentSetting || cardWin.mArg);
        if (!setting || !setting.defaults || !Array.isArray(setting.attachments)) {
          return { anyDocJob: false, allDocJobDone: true };
        }
        const def = setting.defaults;
        const containers = cardDoc ? Array.from(cardDoc.querySelectorAll('.ans-attach-ct')) : [];
        setting.attachments.forEach(function (att, idx) {
          const isDoc =
            att && (att.type === 'document' || (att.property && att.property.module === 'insertdoc'));
          if (!isDoc) return;
          anyDocJob = true;
          const ct = containers[idx];
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

    // Dynamically calculate MAX rate based on actual Chaoxing server judgment:
    // - 90% (rt=0.9) is the video timeline progress ratio (playingTime / D >= 0.9), NOT wall-clock time.
    // - With ds_1 (speed-up enabled), the server allows up to 4x per 60s heartbeat, so the actual
    //   minimum real-world watch time threshold is rt / 4 = 0.9 / 4 = 22.5% (empirical pass at 23.67%).
    // - Using 25% (0.25 * D) as the safe real-time target:
    //   R = (D - currentTime) / (0.25 * D - realPlayed), clamped to [1, 16], and 16x once realPlayed >= 0.25 * D.
    function computeDynamicMaxRate(vf, cardWin, v, jobFinished) {
      const D = Number(v && v.duration) || 0;
      if (!D || !Number.isFinite(D) || D <= 0) {
        return { rate: 4, info: 'MAX: 等待获取视频总时长...' };
      }

      const curPos = Math.max(0, Math.min(D, Number(v.currentTime) || 0));
      const now = Date.now();
      let serverPlayTimeSec = 0;
      let isAlreadyPassed = !!jobFinished;
      let rtVal = 0.9;
      try {
        const setting = cardWin && (cardWin.AttachmentSetting || cardWin.mArg);
        const atts = (setting && setting.attachments) || [];
        const videoAtt = atts.find(function (a) {
          return a && a.type === 'video';
        });
        if (videoAtt) {
          if (videoAtt.playTime) {
            serverPlayTimeSec = Math.floor(Number(videoAtt.playTime) / 1000);
          }
          if (videoAtt.isPassed) {
            isAlreadyPassed = true;
          }
        }
        const vw = vf && vf.contentWindow;
        const p = vw && vw.videojs && vw.videojs.getPlayers && vw.videojs.getPlayers().video;
        if (p && p.options_ && Number(p.options_.rt) > 0) {
          rtVal = Number(p.options_.rt);
        }
      } catch (e) {}

      const actualJudgeRatio = rtVal / 4;
      const safeTargetRatio = Math.min(
        0.9,
        Math.max(0.25, Math.round((actualJudgeRatio + 0.025) * 1000) / 1000)
      );
      const targetRealSec = Math.ceil(D * safeTargetRatio);

      const expectedPosJump =
        ((now - (v.__cxLastTickAt || now)) / 1000) * Math.max(1, state.rate || 4) + 8;
      const seekedByUser =
        typeof v.__cxLastVideoPos === 'number' && Math.abs(curPos - v.__cxLastVideoPos) > expectedPosJump;

      if (
        typeof v.__cxWallPlayedSec !== 'number' ||
        typeof v.__cxInitRealSec !== 'number' ||
        seekedByUser
      ) {
        let initReal = 0;
        if (!isAlreadyPassed && serverPlayTimeSec > 0 && !seekedByUser) {
          initReal = serverPlayTimeSec;
        } else if (curPos > 0) {
          initReal = Math.floor(curPos / 3);
        }
        v.__cxInitRealSec = initReal;
        v.__cxWallPlayedSec = 0;
        v.__cxLastTickAt = now;
        v.__cxLastVideoPos = curPos;
      } else {
        const dt = Math.max(0, Math.min(2, (now - (v.__cxLastTickAt || now)) / 1000));
        if (!v.paused && !v.ended) {
          v.__cxWallPlayedSec += dt;
        }
        v.__cxLastTickAt = now;
        v.__cxLastVideoPos = curPos;
      }

      const realPlayed = Math.min(D, (v.__cxInitRealSec || 0) + (v.__cxWallPlayedSec || 0));
      const remVideo = Math.max(0, D - curPos);

      if (realPlayed >= targetRealSec) {
        const infoDone =
          'MAX(阈值25%=' + targetRealSec + 's): 实看' + Math.floor(realPlayed) + 's已达标 -> 16x冲刺';
        return { rate: 16, info: infoDone };
      }

      const remRealNeeded = targetRealSec - realPlayed;
      const rawRate = remRealNeeded > 0 ? remVideo / remRealNeeded : 16;
      let calcRate = Math.floor(rawRate * 100) / 100;
      calcRate = Math.min(16, Math.max(1, calcRate));

      const infoText =
        'MAX(阈值25%=' +
        targetRealSec +
        's): 实看' +
        Math.floor(realPlayed) +
        's | 剩' +
        Math.round(remVideo) +
        's -> ' +
        calcRate +
        'x';
      return { rate: calcRate, info: infoText };
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
        if (!p || !v) return { ready: false };

        const hasJob = hasAttachmentJob(vf);
        const jobFinished = isAttachmentJobFinished(vf, vw) || !!(p && p.finished);

        if (state.mode === 'max') {
          const maxObj = computeDynamicMaxRate(vf, cardWin, v, jobFinished);
          applyCalculatedMaxRate(maxObj.rate, maxObj.info);
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
          } else if (Date.now() - v.__cxEndedAt > 3000) {
            v.__cxEndedAt = 0;
            v.__cxInitRealSec = (v.__cxInitRealSec || 0) + (v.__cxWallPlayedSec || 0);
            v.__cxWallPlayedSec = 0;
            try {
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
            const playPromise = p.play ? p.play() : v.play();
            if (playPromise && playPromise.catch) {
              playPromise.catch(function () {
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
          jobFinished: jobFinished
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

      const curCh = document.querySelector('#coursetree .posCatalog_active');
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
      const curIdx = allChapters.findIndex(function (el) {
        return el.classList.contains('posCatalog_active') || (chapterId && el.id === 'cur' + chapterId);
      });

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
              if (!info.jobFinished) allVideosDone = false;
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
