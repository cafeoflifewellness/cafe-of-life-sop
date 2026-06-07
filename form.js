/* =====================================================================
   Café of Life SOP — Form + Pencil Layer
   - Real checkbox inputs (auto-injected into .checklist li)
   - Text + textarea + contenteditable persistence
   - Apple Pencil drawing layer (pointerType === 'pen')
   - Toolbar: color, eraser, undo, clear
   - Auto-save to localStorage per page
   ===================================================================== */

(function () {
  'use strict';

  const PAGE_FILE = location.pathname.split('/').pop() || 'index.html';
  const PAGE_ID = PAGE_FILE + (location.search || '');
  const STORAGE_KEY = 'cofl_sop_' + PAGE_ID;

  // ---------- NOTES REGISTRY ----------
  const NOTES_PAGE = '14-notes.html';
  const NOTES_INDEX_KEY = 'cofl_sop_notes_index_v1';

  function getNotesIndex() {
    try {
      const v = JSON.parse(localStorage.getItem(NOTES_INDEX_KEY));
      return Array.isArray(v) ? v : [];
    } catch { return []; }
  }
  function saveNotesIndex(idx) {
    try { localStorage.setItem(NOTES_INDEX_KEY, JSON.stringify(idx)); } catch {}
  }
  function newNoteId() {
    return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
  function addNote() {
    const idx = getNotesIndex();
    const id = newNoteId();
    idx.push({ id: id, created: Date.now() });
    saveNotesIndex(idx);
    return id;
  }
  function deleteNote(id) {
    saveNotesIndex(getNotesIndex().filter(n => n.id !== id));
    try { localStorage.removeItem('cofl_sop_' + NOTES_PAGE + '?id=' + id); } catch {}
  }
  function getNoteTitle(id, fallback) {
    try {
      const data = JSON.parse(localStorage.getItem('cofl_sop_' + NOTES_PAGE + '?id=' + id));
      const t = data && typeof data.in_note_title === 'string' ? data.in_note_title.trim() : '';
      if (t) return t;
    } catch {}
    return fallback;
  }
  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

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
      '<span class="sb-status"><span class="dot"></span>Auto-saved</span>' +
      '<button class="sb-reset" data-scope="page">Reset page</button>' +
      '<button class="sb-reset sb-reset-all" data-scope="all">Reset all</button>';
    document.body.appendChild(bar);

    bar.querySelectorAll('.sb-reset').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.scope === 'page') {
          if (confirm('Clear all form fields AND pencil notes on this page?')) {
            localStorage.removeItem(STORAGE_KEY);
            location.reload();
          }
          return;
        }
        if (confirm('Clear EVERYTHING across the entire binder — every page\'s checkboxes, text, and pencil notes? This cannot be undone.')) {
          Object.keys(localStorage)
            .filter(k => k.startsWith('cofl_sop_') && k !== 'cofl_sop_hint_v1')
            .forEach(k => localStorage.removeItem(k));
          location.reload();
        }
      });
    });
  }

  // ---------- HAMBURGER DRAWER ----------
  const SECTIONS = [
    { num: '',   title: 'Cover',                  sub: 'Contents · welcome',          href: 'index.html' },
    { num: '01', title: 'Office Information',     sub: 'Contact · schedule · systems',href: '01-office-info.html' },
    { num: '02', title: 'Opening Procedures',     sub: 'Before the first patient',    href: '02-opening.html' },
    { num: '03', title: 'New Patient Phone Call', sub: 'Smile before you answer',     href: '03-new-patient-call.html' },
    { num: '04', title: 'Day 1 — First Visit',    sub: 'New patient · green block',   href: '04-day-1.html' },
    { num: '05', title: 'Day 2 — ROF',            sub: 'Report of Findings · $55',    href: '05-day-2-rof.html' },
    { num: '06', title: 'Day 3 — Onboarding',     sub: 'Auto debit · app · schedule', href: '06-day-3.html' },
    { num: '07', title: 'Adjustment Visit',       sub: '$65 · fee schedule',          href: '07-adjustment.html' },
    { num: '08', title: 'SoftWave',               sub: 'Call to confirm · deposit',   href: '08-softwave.html' },
    { num: '09', title: 'Checkout — Every Visit', sub: 'Check · Collect · Schedule',  href: '09-checkout.html' },
    { num: '10', title: 'Closing Procedures',     sub: 'After the last patient',      href: '10-closing.html' },
    { num: '11', title: 'Systems & Forms',        sub: 'Quick lookup',                href: '11-systems-forms.html' },
    { num: '12', title: 'Rules & Color Guide',    sub: 'Appt colors · alerts',        href: '12-rules-colors.html' },
    { num: '13', title: 'Daily Huddle Sheet',     sub: 'The day at a glance',         href: '13-huddle-sheet.html' }
  ];

  function initDrawer() {
    // Remove old "Contents" link in topnav since the hamburger replaces it
    document.querySelectorAll('.topnav .nav-links a').forEach(a => {
      if (a.getAttribute('href') === 'index.html' && a.textContent.trim() === 'Contents') {
        a.remove();
      }
    });

    // Hamburger button
    const btn = document.createElement('button');
    btn.className = 'sop-hamburger';
    btn.setAttribute('aria-label', 'Open contents menu');
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
      '<line x1="4" y1="7" x2="20" y2="7"/>' +
      '<line x1="4" y1="12" x2="20" y2="12"/>' +
      '<line x1="4" y1="17" x2="20" y2="17"/>' +
      '</svg>';
    document.body.appendChild(btn);

    // Backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'sop-backdrop';
    document.body.appendChild(backdrop);

    // Drawer
    const drawer = document.createElement('aside');
    drawer.className = 'sop-drawer';
    drawer.setAttribute('aria-label', 'Contents');
    const items = SECTIONS.map(s => {
      const isCurrent = s.href === PAGE_ID || (PAGE_ID === '' && s.href === 'index.html');
      return (
        '<a href="' + s.href + '" class="sop-drawer-item' + (isCurrent ? ' current' : '') + '">' +
          '<span class="drawer-num">' + (s.num || '✿') + '</span>' +
          '<span class="drawer-text">' +
            '<span class="drawer-title">' + s.title + '</span>' +
            '<span class="drawer-sub">' + s.sub + '</span>' +
          '</span>' +
        '</a>'
      );
    }).join('');
    const notesIdx = getNotesIndex();
    const notesItems = notesIdx.map((n, i) => {
      const fallback = 'Note ' + (i + 1);
      const title = getNoteTitle(n.id, fallback);
      const href = NOTES_PAGE + '?id=' + n.id;
      const isCurrent = href === PAGE_ID;
      return (
        '<a href="' + href + '" class="sop-drawer-item notes-item' + (isCurrent ? ' current' : '') + '">' +
          '<span class="drawer-num">✎</span>' +
          '<span class="drawer-text">' +
            '<span class="drawer-title">' + escapeHTML(title) + '</span>' +
            '<span class="drawer-sub">Blank notes</span>' +
          '</span>' +
        '</a>'
      );
    }).join('');
    const notesSection =
      '<div class="sop-drawer-section-label">Notes</div>' +
      notesItems +
      '<button class="sop-drawer-add" type="button" aria-label="Add a new note">' +
        '<span class="add-plus">+</span><span>Add a note</span>' +
      '</button>';

    drawer.innerHTML =
      '<header class="sop-drawer-head">' +
        '<div class="drawer-brand">' +
          '<span class="drawer-bloom">✿</span>' +
          '<span class="drawer-name">Café of Life<em>Chiropractic &amp; Wellness</em></span>' +
        '</div>' +
        '<button class="sop-drawer-close" aria-label="Close menu">' +
          '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>' +
        '</button>' +
      '</header>' +
      '<nav class="sop-drawer-nav">' + items + notesSection + '</nav>';
    document.body.appendChild(drawer);

    drawer.querySelector('.sop-drawer-add').addEventListener('click', (e) => {
      e.preventDefault();
      const id = addNote();
      location.href = NOTES_PAGE + '?id=' + id;
    });

    function outsideHandler(e) {
      if (drawer.contains(e.target)) return;
      if (btn.contains(e.target)) return;
      close();
    }

    function open() {
      drawer.classList.add('open');
      backdrop.classList.add('open');
      btn.classList.add('hidden');
      document.body.classList.add('sop-drawer-open');
      // Defer so the opening tap itself doesn't trigger the outside handler
      setTimeout(() => {
        document.addEventListener('pointerdown', outsideHandler, true);
      }, 0);
    }
    function close() {
      drawer.classList.remove('open');
      backdrop.classList.remove('open');
      btn.classList.remove('hidden');
      document.body.classList.remove('sop-drawer-open');
      document.removeEventListener('pointerdown', outsideHandler, true);
    }

    btn.addEventListener('click', open);
    backdrop.addEventListener('click', close);
    drawer.querySelector('.sop-drawer-close').addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
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

  // ---------- STYLUS SCROLL BLOCK ----------
  // On iPad Safari, the pencil produces touch events that start scrolling
  // BEFORE the pointerdown handler runs. preventDefault on touchstart/move
  // when touchType === 'stylus' stops the scroll without affecting finger scroll.
  function blockStylusScroll() {
    const handler = (e) => {
      const touches = e.touches || [];
      for (let i = 0; i < touches.length; i++) {
        if (touches[i].touchType === 'stylus') {
          e.preventDefault();
          return;
        }
      }
    };
    document.addEventListener('touchstart', handler, { passive: false });
    document.addEventListener('touchmove', handler, { passive: false });
  }

  // ---------- HUDDLE SHEET ----------
  const HUDDLE_PAGE = '13-huddle-sheet.html';

  // Appt types pulled from §12 Rules & Colors + §07 fee schedule.
  // `charge` is the default that auto-fills; null = no fixed default.
  const APPT_TYPES = [
    { key: 'newpt',     name: 'New Patient',         short: 'New Pt',  chip: 'chip-green',     charge: null },
    { key: 'adj',       name: 'Adjustment',          short: 'Adj',     chip: 'chip-blue',      charge: 65   },
    { key: 'adjwell',   name: 'Adj / Wellness',      short: 'Adj/Wel', chip: 'chip-lightblue', charge: null },
    { key: 'reexam',    name: 'Re-Exam',             short: 'Re-Exam', chip: 'chip-yellow',    charge: 45   },
    { key: 'react',     name: 'New Injury / React.', short: 'React.',  chip: 'chip-brown',     charge: null },
    { key: 'rof',       name: 'ROF',                 short: 'ROF',     chip: 'chip-red',       charge: 55   },
    { key: 'maint',     name: 'Maintenance',         short: 'Maint',   chip: 'chip-pink',      charge: null },
    { key: 'exercise',  name: 'Exercise Consult',    short: 'Exerc.',  chip: 'chip-grey',      charge: 95   },
    { key: 'softwave',  name: 'SoftWave',            short: 'SW',      chip: 'chip-purple',    charge: null },
    { key: 'xray',      name: 'X-Ray',               short: 'X-Ray',   chip: 'chip-black',     charge: 25   },
    { key: 'day3',      name: 'Day 3',               short: 'Day 3',   chip: 'chip-burgundy',  charge: null }
  ];
  const APPT_BY_KEY = Object.fromEntries(APPT_TYPES.map(t => [t.key, t]));

  // Pay cycle: blank → card → cash → PIF → owes → blank
  const PAY_STATES = [
    { key: 0, icon: '',   short: '',     full: 'Not set' },
    { key: 1, icon: '💳', short: 'Card', full: 'Card auto-debited' },
    { key: 2, icon: '💵', short: 'Cash', full: 'Cash / check' },
    { key: 3, icon: '⊘',  short: 'PIF',  full: 'PIF — paid in full today' },
    { key: 4, icon: '⚠',  short: 'Owes', full: 'Owes balance' }
  ];

  function buildTimeSlots() {
    const slots = [];
    for (let h = 6; h <= 20; h++) {
      for (let m = 0; m < 60; m += 15) {
        if (h === 20 && m > 0) break;
        const hh = h % 12 || 12;
        const ampm = h < 12 ? 'AM' : 'PM';
        const mm = m === 0 ? '00' : String(m);
        slots.push(hh + ':' + mm + ' ' + ampm);
      }
    }
    return slots;
  }
  const TIME_SLOTS = buildTimeSlots();
  const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function formatDateShort(dateStr) {
    if (!dateStr) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!m) return dateStr;
    const y = +m[1], mo = +m[2], d = +m[3];
    const thisYear = new Date().getFullYear();
    return MONTHS_SHORT[mo - 1] + ' ' + d + (y === thisYear ? '' : ', ' + y);
  }
  function formatNextAppt(obj) {
    if (!obj) return '';
    const parts = [];
    if (obj.date) parts.push(formatDateShort(obj.date));
    if (obj.time) parts.push(obj.time);
    return parts.join(' · ');
  }

  function applyApptToButton(btn, apptKey) {
    btn.innerHTML = '';
    btn.classList.remove('is-empty');
    if (!apptKey) {
      btn.classList.add('is-empty');
      return;
    }
    const type = APPT_BY_KEY[apptKey];
    if (!type) {
      btn.classList.add('is-empty');
      return;
    }
    const chipClass = type.chip === 'chip-black'
      ? 'appt-chip'
      : 'appt-chip ' + type.chip;
    const chip = document.createElement('span');
    chip.className = chipClass;
    if (type.chip === 'chip-black') chip.style.background = '#1d1d1d';
    const label = document.createElement('span');
    label.className = 'appt-label';
    label.textContent = type.short;
    btn.appendChild(chip);
    btn.appendChild(label);
  }

  function applyChargeGhost(cell, apptKey) {
    cell.innerHTML = '';
    if (!apptKey) return;
    const type = APPT_BY_KEY[apptKey];
    if (!type || type.charge == null) return;
    const ghost = document.createElement('span');
    ghost.className = 'charge-ghost';
    ghost.textContent = '$' + type.charge;
    cell.appendChild(ghost);
  }

  function applyPayState(btn, stateIdx) {
    const s = PAY_STATES[stateIdx] || PAY_STATES[0];
    if (s.icon) {
      btn.innerHTML =
        '<span class="pay-icon">' + s.icon + '</span>' +
        '<span class="pay-label">' + s.short + '</span>';
    } else {
      btn.innerHTML = '';
    }
    btn.title = s.full;
    btn.classList.remove('state-1', 'state-2', 'state-3', 'state-4');
    if (stateIdx > 0) btn.classList.add('state-' + stateIdx);
  }

  function applyTimeToButton(btn, timeStr) {
    btn.textContent = timeStr || '';
    btn.classList.toggle('is-empty', !timeStr);
  }
  function applyNextApptToButton(btn, obj) {
    const text = formatNextAppt(obj);
    btn.textContent = text;
    btn.classList.toggle('is-empty', !text);
  }

  let pickerEls = null;
  function buildPicker() {
    if (pickerEls) return pickerEls;
    const backdrop = document.createElement('div');
    backdrop.className = 'appt-picker-backdrop';
    const modal = document.createElement('div');
    modal.className = 'appt-picker';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', 'Pick appointment type');

    let gridHtml = '';
    APPT_TYPES.forEach(t => {
      const chipStyle = t.chip === 'chip-black' ? ' style="background:#1d1d1d;"' : '';
      const chipClass = t.chip === 'chip-black' ? 'appt-chip' : 'appt-chip ' + t.chip;
      const price = t.charge != null ? '$' + t.charge : '—';
      gridHtml +=
        '<button type="button" class="appt-pick" data-key="' + t.key + '">' +
          '<span class="' + chipClass + '"' + chipStyle + '></span>' +
          '<span class="appt-pick-text">' +
            '<span class="appt-pick-name">' + t.name + '</span>' +
            '<span class="appt-pick-price">' + price + '</span>' +
          '</span>' +
        '</button>';
    });
    gridHtml += '<button type="button" class="appt-pick-clear">Clear this row</button>';

    modal.innerHTML =
      '<header class="appt-picker-head">' +
        '<h3>Pick appointment type</h3>' +
        '<button type="button" class="appt-picker-close" aria-label="Close">✕</button>' +
      '</header>' +
      '<div class="appt-picker-grid">' + gridHtml + '</div>';

    document.body.appendChild(backdrop);
    document.body.appendChild(modal);

    pickerEls = { backdrop, modal, currentRow: null };

    function close() {
      modal.classList.remove('open');
      backdrop.classList.remove('open');
      pickerEls.currentRow = null;
    }

    backdrop.addEventListener('click', close);
    modal.querySelector('.appt-picker-close').addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('open')) close();
    });

    modal.querySelectorAll('.appt-pick').forEach(b => {
      b.addEventListener('click', () => {
        if (pickerEls.currentRow == null) return close();
        setRowAppt(pickerEls.currentRow, b.dataset.key);
        close();
      });
    });
    modal.querySelector('.appt-pick-clear').addEventListener('click', () => {
      if (pickerEls.currentRow == null) return close();
      setRowAppt(pickerEls.currentRow, null);
      close();
    });

    pickerEls.close = close;
    pickerEls.open = (rowIdx) => {
      pickerEls.currentRow = rowIdx;
      backdrop.classList.add('open');
      modal.classList.add('open');
    };
    return pickerEls;
  }

  function setRowAppt(rowIdx, apptKey) {
    state['huddle_appt_' + rowIdx] = apptKey || '';
    scheduleSave();
    const btn = document.querySelector('.appt-type-btn[data-row="' + rowIdx + '"]');
    const charge = document.querySelector('.charge-cell[data-row="' + rowIdx + '"]');
    if (btn) applyApptToButton(btn, apptKey);
    if (charge) applyChargeGhost(charge, apptKey);
  }

  function setRowPay(rowIdx, stateIdx) {
    state['huddle_pay_' + rowIdx] = stateIdx;
    scheduleSave();
    const btn = document.querySelector('.pay-btn[data-row="' + rowIdx + '"]');
    if (btn) applyPayState(btn, stateIdx);
  }

  function setRowTime(rowIdx, timeStr) {
    state['huddle_time_' + rowIdx] = timeStr || '';
    scheduleSave();
    const btn = document.querySelector('.time-btn[data-row="' + rowIdx + '"]');
    if (btn) applyTimeToButton(btn, timeStr);
  }

  function setRowNextAppt(rowIdx, obj) {
    state['huddle_nextappt_' + rowIdx] = obj || null;
    scheduleSave();
    const btn = document.querySelector('.nextappt-btn[data-row="' + rowIdx + '"]');
    if (btn) applyNextApptToButton(btn, obj);
  }

  // ---- Time picker modal ----
  let timePickerEls = null;
  function buildTimePicker() {
    if (timePickerEls) return timePickerEls;
    const backdrop = document.createElement('div');
    backdrop.className = 'cell-picker-backdrop time-picker-backdrop';
    const modal = document.createElement('div');
    modal.className = 'cell-picker time-picker';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', 'Pick time');

    let gridHtml = '';
    TIME_SLOTS.forEach(t => {
      gridHtml += '<button type="button" class="time-pick" data-time="' + t + '">' + t + '</button>';
    });

    modal.innerHTML =
      '<header class="cell-picker-head">' +
        '<h3>Pick time</h3>' +
        '<button type="button" class="cell-picker-close" aria-label="Close">✕</button>' +
      '</header>' +
      '<div class="time-picker-grid">' + gridHtml + '</div>' +
      '<button type="button" class="cell-picker-clear">Clear time</button>';

    document.body.appendChild(backdrop);
    document.body.appendChild(modal);

    timePickerEls = { backdrop, modal, currentRow: null };
    function close() {
      modal.classList.remove('open');
      backdrop.classList.remove('open');
      timePickerEls.currentRow = null;
    }
    backdrop.addEventListener('click', close);
    modal.querySelector('.cell-picker-close').addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('open')) close();
    });
    modal.querySelectorAll('.time-pick').forEach(b => {
      b.addEventListener('click', () => {
        if (timePickerEls.currentRow == null) return close();
        setRowTime(timePickerEls.currentRow, b.dataset.time);
        close();
      });
    });
    modal.querySelector('.cell-picker-clear').addEventListener('click', () => {
      if (timePickerEls.currentRow == null) return close();
      setRowTime(timePickerEls.currentRow, '');
      close();
    });

    timePickerEls.open = (rowIdx) => {
      timePickerEls.currentRow = rowIdx;
      backdrop.classList.add('open');
      modal.classList.add('open');
      const saved = state['huddle_time_' + rowIdx] || '';
      modal.querySelectorAll('.time-pick').forEach(b => {
        b.classList.toggle('selected', b.dataset.time === saved);
      });
      const sel = modal.querySelector('.time-pick.selected');
      if (sel) {
        setTimeout(() => sel.scrollIntoView({ block: 'center', behavior: 'instant' }), 0);
      }
    };
    return timePickerEls;
  }

  // ---- Next-appt picker (native date + time grid) ----
  let nextApptPickerEls = null;
  function buildNextApptPicker() {
    if (nextApptPickerEls) return nextApptPickerEls;
    const backdrop = document.createElement('div');
    backdrop.className = 'cell-picker-backdrop nextappt-picker-backdrop';
    const modal = document.createElement('div');
    modal.className = 'cell-picker nextappt-picker';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', 'Pick next appointment');

    let gridHtml = '';
    TIME_SLOTS.forEach(t => {
      gridHtml += '<button type="button" class="time-pick" data-time="' + t + '">' + t + '</button>';
    });

    modal.innerHTML =
      '<header class="cell-picker-head">' +
        '<h3>Pick next appt</h3>' +
        '<button type="button" class="cell-picker-close" aria-label="Close">✕</button>' +
      '</header>' +
      '<div class="nextappt-date-row">' +
        '<label for="nextappt-date-input">Date</label>' +
        '<input id="nextappt-date-input" type="date" class="nextappt-date-input">' +
      '</div>' +
      '<div class="nextappt-time-label">Time <span>(tap to confirm)</span></div>' +
      '<div class="time-picker-grid">' + gridHtml + '</div>' +
      '<button type="button" class="cell-picker-clear">Clear next appt</button>';

    document.body.appendChild(backdrop);
    document.body.appendChild(modal);
    const dateInput = modal.querySelector('.nextappt-date-input');

    nextApptPickerEls = { backdrop, modal, dateInput, currentRow: null };

    function close() {
      modal.classList.remove('open');
      backdrop.classList.remove('open');
      nextApptPickerEls.currentRow = null;
    }
    backdrop.addEventListener('click', close);
    modal.querySelector('.cell-picker-close').addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('open')) close();
    });
    dateInput.addEventListener('input', () => {
      if (nextApptPickerEls.currentRow == null) return;
      const current = state['huddle_nextappt_' + nextApptPickerEls.currentRow] || {};
      setRowNextAppt(nextApptPickerEls.currentRow, {
        date: dateInput.value,
        time: current.time || ''
      });
    });
    modal.querySelectorAll('.time-pick').forEach(b => {
      b.addEventListener('click', () => {
        if (nextApptPickerEls.currentRow == null) return close();
        setRowNextAppt(nextApptPickerEls.currentRow, {
          date: dateInput.value || '',
          time: b.dataset.time
        });
        close();
      });
    });
    modal.querySelector('.cell-picker-clear').addEventListener('click', () => {
      if (nextApptPickerEls.currentRow == null) return close();
      setRowNextAppt(nextApptPickerEls.currentRow, null);
      dateInput.value = '';
      close();
    });

    nextApptPickerEls.open = (rowIdx) => {
      nextApptPickerEls.currentRow = rowIdx;
      const saved = state['huddle_nextappt_' + rowIdx] || {};
      dateInput.value = saved.date || '';
      backdrop.classList.add('open');
      modal.classList.add('open');
      modal.querySelectorAll('.time-pick').forEach(b => {
        b.classList.toggle('selected', b.dataset.time === (saved.time || ''));
      });
      const sel = modal.querySelector('.time-pick.selected');
      if (sel) {
        setTimeout(() => sel.scrollIntoView({ block: 'center', behavior: 'instant' }), 0);
      }
    };
    return nextApptPickerEls;
  }

  function huddleRowHTML(i) {
    return (
      '<tr>' +
        '<td class="input-cell"><input class="sop-text cell-input" name="huddle_patient_' + i + '" type="text" autocomplete="off" enterkeyhint="next" aria-label="Patient name row ' + (i + 1) + '"></td>' +
        '<td class="time-cell"><button class="time-btn cell-btn is-empty" type="button" data-row="' + i + '" aria-label="Pick time"></button></td>' +
        '<td class="appt-cell"><button class="appt-type-btn is-empty" type="button" data-row="' + i + '" aria-label="Pick appointment type"></button></td>' +
        '<td class="charge-cell" data-row="' + i + '"></td>' +
        '<td class="input-cell"><input class="sop-text cell-input cell-input-num" name="huddle_card_' + i + '" type="text" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="" aria-label="Card last 4 row ' + (i + 1) + '"></td>' +
        '<td class="pay-cell"><button class="pay-btn cell-btn" type="button" data-row="' + i + '" aria-label="Cycle payment state"></button></td>' +
        '<td class="nextappt-cell"><button class="nextappt-btn cell-btn is-empty" type="button" data-row="' + i + '" aria-label="Pick next appointment"></button></td>' +
        '<td class="input-cell"><input class="sop-text cell-input" name="huddle_notes_' + i + '" type="text" autocomplete="off" aria-label="Notes row ' + (i + 1) + '"></td>' +
      '</tr>'
    );
  }

  function prepareHuddleRows() {
    if (PAGE_FILE !== HUDDLE_PAGE) return;
    const tbody = document.querySelector('tbody[data-huddle-rows]');
    if (!tbody || tbody.children.length) return;
    const n = +tbody.dataset.huddleRows || 15;
    let html = '';
    for (let i = 0; i < n; i++) html += huddleRowHTML(i);
    tbody.innerHTML = html;
  }

  function initHuddle() {
    if (PAGE_FILE !== HUDDLE_PAGE) return;
    const table = document.querySelector('table[data-huddle="true"]');
    if (!table) return;
    buildPicker();
    buildTimePicker();
    buildNextApptPicker();

    table.querySelectorAll('.appt-type-btn').forEach(btn => {
      const row = +btn.dataset.row;
      const saved = state['huddle_appt_' + row] || null;
      applyApptToButton(btn, saved);
      const chargeCell = table.querySelector('.charge-cell[data-row="' + row + '"]');
      if (chargeCell) applyChargeGhost(chargeCell, saved);
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        pickerEls.open(row);
      });
    });

    table.querySelectorAll('.time-btn').forEach(btn => {
      const row = +btn.dataset.row;
      const saved = state['huddle_time_' + row] || '';
      applyTimeToButton(btn, saved);
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        timePickerEls.open(row);
      });
    });

    table.querySelectorAll('.nextappt-btn').forEach(btn => {
      const row = +btn.dataset.row;
      const saved = state['huddle_nextappt_' + row] || null;
      applyNextApptToButton(btn, saved);
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        nextApptPickerEls.open(row);
      });
    });

    table.querySelectorAll('.pay-btn').forEach(btn => {
      const row = +btn.dataset.row;
      const saved = state['huddle_pay_' + row] || 0;
      applyPayState(btn, saved);
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const current = state['huddle_pay_' + row] || 0;
        const next = (current + 1) % PAY_STATES.length;
        setRowPay(row, next);
      });
    });
  }

  // ---------- NOTES PAGE ----------
  function getCurrentNoteId() {
    const p = new URLSearchParams(location.search);
    return p.get('id');
  }

  // Returns true if the page is being redirected and init should bail out.
  function ensureNoteRouted() {
    if (PAGE_FILE !== NOTES_PAGE) return false;
    const id = getCurrentNoteId();
    if (id) return false;
    const idx = getNotesIndex();
    const targetId = idx.length ? idx[0].id : addNote();
    location.replace(NOTES_PAGE + '?id=' + targetId);
    return true;
  }

  function initNotesPage() {
    if (PAGE_FILE !== NOTES_PAGE) return;
    const id = getCurrentNoteId();
    if (!id) return;
    const idx = getNotesIndex();
    const pos = idx.findIndex(n => n.id === id);
    const num = pos >= 0 ? pos + 1 : idx.length + 1;
    const meta = document.querySelector('.notes-meta');
    if (meta) meta.textContent = 'Note ' + num + ' of ' + Math.max(idx.length, 1);
    const delBtn = document.querySelector('.notes-delete-btn');
    if (delBtn) {
      delBtn.addEventListener('click', () => {
        if (!confirm('Delete this note? Pencil strokes and title will be cleared.')) return;
        deleteNote(id);
        const remaining = getNotesIndex();
        if (remaining.length) {
          location.href = NOTES_PAGE + '?id=' + remaining[0].id;
        } else {
          location.href = NOTES_PAGE;
        }
      });
    }
  }

  // ---------- INIT ----------
  function init() {
    if (ensureNoteRouted()) return;
    blockStylusScroll();
    // Huddle rows must exist before initInputs binds their text fields
    prepareHuddleRows();
    // Order matters: restore contenteditable text first, THEN inject checkboxes
    initEditables();
    initCheckboxes();
    initInputs();
    initPencil();
    initToolbar();
    initSaveBar();
    initDrawer();
    initHuddle();
    initNotesPage();
    initHint();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
