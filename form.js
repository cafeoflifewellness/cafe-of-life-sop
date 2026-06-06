/* =====================================================================
   Cafe of Life SOP — Form + Pencil Layer
   - Real checkbox inputs (auto-injected into .checklist li)
   - Text + textarea + contenteditable persistence
   - Apple Pencil drawing layer (pointerType === 'pen')
   - Toolbar: color, eraser, undo, clear
   - Auto-save to localStorage per page
   ===================================================================== */

(function () {
  'use strict';

  const PAGE_ID = location.pathname.split('/').pop() || 'index.html';
  const STORAGE_KEY = 'cofl_sop_' + PAGE_ID;

  // ---------- STATE ----------
  let state = loadState();
  let saveTimeout = null;
  let lastSaveTooBigWarned = false;

  function loadState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch { return {}; }
  }

  function scheduleSave() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        flashSavedIndicator();
      } catch (e) {
        if (!lastSaveTooBigWarned) {
          lastSaveTooBigWarned = true;
          alert('Storage is full. Some new annotations may not save. Try clearing a page.');
        }
      }
    }, 200);
  }

  function flashSavedIndicator() {
    const el = document.querySelector('.sb-status');
    if (!el) return;
    el.classList.add('saved');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('saved'), 600);
  }

  function slugify(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  }

  // ---------- CHECKBOXES ----------
  function initCheckboxes() {
    document.querySelectorAll('ul.checklist').forEach((ul, listIdx) => {
      ul.querySelectorAll(':scope > li').forEach((li, itemIdx) => {
        const text = li.textContent.trim();
        if (!text) return;
        const key = 'cb_' + listIdx + '_' + itemIdx + '_' + slugify(text);
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'sop-check';
        input.dataset.key = key;
        input.contentEditable = 'false';
        input.checked = !!state[key];
        if (input.checked) li.classList.add('checked');
        input.addEventListener('change', () => {
          state[key] = input.checked;
          li.classList.toggle('checked', input.checked);
          scheduleSave();
        });
        li.insertBefore(input, li.firstChild);
        li.classList.add('with-checkbox');
      });
    });
  }

  // ---------- TEXT INPUTS + TEXTAREAS ----------
  function initInputs() {
    document.querySelectorAll('input.sop-text, textarea.sop-text').forEach((el) => {
      const key = 'in_' + (el.name || slugify(el.placeholder || el.id || 'field'));
      el.dataset.key = key;
      if (state[key] != null) el.value = state[key];
      el.addEventListener('input', () => {
        state[key] = el.value;
        scheduleSave();
      });
    });
  }

  // ---------- CONTENTEDITABLE ----------
  function initEditables() {
    document.querySelectorAll('[contenteditable="true"]').forEach((el, idx) => {
      const key = 'ed_' + idx + '_' + slugify(el.getAttribute('data-name') || el.id || '');
      el.dataset.key = key;
      if (state[key]) el.innerHTML = state[key];
      el.addEventListener('input', () => {
        // Strip any injected, non-editable widgets (like .sop-check) before saving
        const clone = el.cloneNode(true);
        clone.querySelectorAll('input.sop-check').forEach(n => n.remove());
        state[key] = clone.innerHTML;
        scheduleSave();
      });
    });
  }

  // ---------- PENCIL CANVAS ----------
  const CURRENT = {
    color: '#330C15',
    eraser: false,
    width: 1.6
  };

  function initPencil() {
    document.querySelectorAll('.page').forEach((page, idx) => setupPageCanvas(page, idx));
  }

  function setupPageCanvas(page, idx) {
    const canvas = document.createElement('canvas');
    canvas.className = 'pencil-layer';
    page.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const STROKES_KEY = 'strokes_' + idx;
    let strokes = Array.isArray(state[STROKES_KEY]) ? state[STROKES_KEY] : [];
    let currentStroke = null;
    let drawing = false;

    function resize() {
      const rect = page.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';
      redraw();
    }

    function redraw() {
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      strokes.forEach(drawStroke);
    }

    function drawStroke(s) {
      if (!s || !s.points || s.points.length < 1) return;
      ctx.save();
      ctx.globalCompositeOperation = s.eraser ? 'destination-out' : 'source-over';
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      if (s.points.length === 1) {
        const [x, y] = s.points[0];
        ctx.beginPath();
        ctx.arc(x, y, s.width / 2, 0, Math.PI * 2);
        ctx.fillStyle = s.color;
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(s.points[0][0], s.points[0][1]);
        for (let i = 1; i < s.points.length; i++) {
          const p = s.points[i];
          ctx.lineWidth = (s.width) * (0.45 + (p[2] || 0.5) * 1.4);
          ctx.lineTo(p[0], p[1]);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(p[0], p[1]);
        }
      }
      ctx.restore();
    }

    function getPoint(e) {
      const rect = canvas.getBoundingClientRect();
      return [
        +(e.clientX - rect.left).toFixed(1),
        +(e.clientY - rect.top).toFixed(1),
        +(e.pressure || 0.5).toFixed(2)
      ];
    }

    page.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'pen') return;
      e.preventDefault();
      drawing = true;
      currentStroke = {
        color: CURRENT.eraser ? '#000' : CURRENT.color,
        width: CURRENT.eraser ? 18 : CURRENT.width,
        eraser: CURRENT.eraser,
        points: [getPoint(e)]
      };
      try { page.setPointerCapture(e.pointerId); } catch {}
    }, { passive: false });

    page.addEventListener('pointermove', (e) => {
      if (!drawing || e.pointerType !== 'pen') return;
      e.preventDefault();
      currentStroke.points.push(getPoint(e));
      // incremental render
      const s = currentStroke;
      const n = s.points.length;
      if (n >= 2) {
        ctx.save();
        ctx.globalCompositeOperation = s.eraser ? 'destination-out' : 'source-over';
        ctx.strokeStyle = s.color;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = s.width * (0.45 + (s.points[n - 1][2] || 0.5) * 1.4);
        ctx.beginPath();
        ctx.moveTo(s.points[n - 2][0], s.points[n - 2][1]);
        ctx.lineTo(s.points[n - 1][0], s.points[n - 1][1]);
        ctx.stroke();
        ctx.restore();
      }
    }, { passive: false });

    function finishStroke(e) {
      if (!drawing) return;
      drawing = false;
      if (currentStroke && currentStroke.points.length >= 1) {
        strokes.push(currentStroke);
        state[STROKES_KEY] = strokes;
        scheduleSave();
      }
      currentStroke = null;
    }

    page.addEventListener('pointerup', finishStroke);
    page.addEventListener('pointercancel', finishStroke);
    page.addEventListener('pointerleave', finishStroke);

    page._sopCanvas = {
      undo() {
        if (!strokes.length) return;
        strokes.pop();
        state[STROKES_KEY] = strokes;
        scheduleSave();
        redraw();
      },
      clear() {
        strokes = [];
        state[STROKES_KEY] = strokes;
        scheduleSave();
        redraw();
      }
    };

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 120);
    });
    // Initial sizing — delay so layout is settled
    requestAnimationFrame(() => requestAnimationFrame(resize));
  }

  // ---------- TOOLBAR ----------
  function initToolbar() {
    if (document.querySelector('.sop-toolbar')) return;
    const bar = document.createElement('div');
    bar.className = 'sop-toolbar';
    bar.innerHTML =
      '<button class="tb-color active" data-color="#330C15" style="--c:#330C15" aria-label="Plum"></button>' +
      '<button class="tb-color" data-color="#662C39" style="--c:#662C39" aria-label="Burgundy"></button>' +
      '<button class="tb-color" data-color="#1d4d8f" style="--c:#1d4d8f" aria-label="Blue"></button>' +
      '<button class="tb-color" data-color="#1a1a1a" style="--c:#1a1a1a" aria-label="Black"></button>' +
      '<div class="tb-sep"></div>' +
      '<button class="tb-eraser" aria-label="Eraser" title="Eraser">' +
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3 3 16l5 5h13M8 21l8-8M11 6l7 7"/></svg>' +
      '</button>' +
      '<button class="tb-undo" aria-label="Undo" title="Undo">' +
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6M3 13a9 9 0 1 0 3-7"/></svg>' +
      '</button>' +
      '<button class="tb-clear" aria-label="Clear page" title="Clear pencil notes">' +
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>' +
      '</button>';
    document.body.appendChild(bar);

    bar.querySelectorAll('.tb-color').forEach(btn => {
      btn.addEventListener('click', () => {
        CURRENT.color = btn.dataset.color;
        CURRENT.eraser = false;
        bar.querySelectorAll('.tb-color').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        bar.querySelector('.tb-eraser').classList.remove('active');
      });
    });

    bar.querySelector('.tb-eraser').addEventListener('click', (e) => {
      CURRENT.eraser = !CURRENT.eraser;
      bar.querySelector('.tb-eraser').classList.toggle('active', CURRENT.eraser);
    });

    bar.querySelector('.tb-undo').addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p._sopCanvas && p._sopCanvas.undo());
    });

    bar.querySelector('.tb-clear').addEventListener('click', () => {
      if (confirm('Clear all pencil notes on this page?')) {
        document.querySelectorAll('.page').forEach(p => p._sopCanvas && p._sopCanvas.clear());
      }
    });
  }

  // ---------- SAVE BAR ----------
  function initSaveBar() {
    if (document.querySelector('.sop-savebar')) return;
    const bar = document.createElement('div');
    bar.className = 'sop-savebar';
    bar.innerHTML =
      '<span class="sb-status"><span class="dot"></span>Auto-saved on this iPad</span>' +
      '<button class="sb-reset">Reset page</button>';
    document.body.appendChild(bar);
    bar.querySelector('.sb-reset').addEventListener('click', () => {
      if (confirm('Clear all form fields AND pencil notes on this page?')) {
        localStorage.removeItem(STORAGE_KEY);
        location.reload();
      }
    });
  }

  // ---------- FIRST-RUN HINT ----------
  function initHint() {
    const HINT_KEY = 'cofl_sop_hint_v1';
    if (localStorage.getItem(HINT_KEY)) return;
    const hint = document.createElement('div');
    hint.className = 'sop-hint';
    hint.innerHTML =
      '<strong>Tap</strong> checkboxes to fill them in.<br>' +
      '<strong>Write</strong> anywhere with your Apple Pencil. ✿<br>' +
      '<button class="hint-dismiss">Got it</button>';
    document.body.appendChild(hint);
    hint.querySelector('.hint-dismiss').addEventListener('click', () => {
      localStorage.setItem(HINT_KEY, '1');
      hint.remove();
    });
  }

  // ---------- INIT ----------
  function init() {
    // Order matters: restore contenteditable text first, THEN inject checkboxes
    initEditables();
    initCheckboxes();
    initInputs();
    initPencil();
    initToolbar();
    initSaveBar();
    initHint();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
