'use strict';
/* mindkeep-ui skeleton — window manager.
   Implements the behavior contract from ../SKILL.md: window state machine,
   focus/z-index, pointer-capture drag/resize, geometry persistence,
   cascade placement, the taskbar toggle rule, the launcher, and the
   mobile Deliberate Split View. Knows nothing about what's inside a
   window — callers pass HTML content. Exposed as window.MkWM. */
window.MkWM = (() => {
  const desktop = document.getElementById('mk-desktop');
  const windowLayer = document.getElementById('mk-window-layer');
  const taskbarApps = document.getElementById('mk-taskbar-apps');
  const clockEl = document.getElementById('mk-clock');
  const launcherEl = document.getElementById('mk-launcher');
  const launcherItemsEl = document.getElementById('mk-launcher-items');
  const btnLauncher = document.getElementById('mk-btn-launcher');
  const winTpl = document.getElementById('mk-tpl-window');

  const windows = new Map();
  let zCounter = 10;
  let cascadeIndex = 0;
  let splitPending = false;

  const mobileMQ = window.matchMedia('(max-width: 760px)');
  let isMobile = mobileMQ.matches;
  mobileMQ.addEventListener('change', (e) => { isMobile = e.matches; adaptToViewport(); });

  function adaptToViewport() {
    if (isMobile) return;
    windowLayer.classList.remove('mk-split-mode');
    splitPending = false;
    windows.forEach((win) => {
      win.el.classList.remove('mk-mobile-full');
      if (!win.el.style.left) cascadePosition(win);
    });
  }

  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

  function taskbarHeight() {
    const tb = document.getElementById('mk-taskbar');
    return tb ? tb.offsetHeight : 44;
  }

  function cascadePosition(win, size) {
    cascadeIndex = (cascadeIndex + 1) % 8;
    const x = 40 + cascadeIndex * 26;
    const y = 32 + cascadeIndex * 24;
    win.el.style.left = x + 'px';
    win.el.style.top = y + 'px';
    win.el.style.width = (size && size.w ? size.w : 640) + 'px';
    win.el.style.height = (size && size.h ? size.h : 460) + 'px';
  }

  const GEOMETRY_KEY = 'mkwm-window-geometry';
  function loadGeometryStore() {
    try { return JSON.parse(localStorage.getItem(GEOMETRY_KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveGeometry(win) {
    const store = loadGeometryStore();
    store[win.id] = { left: win.el.style.left, top: win.el.style.top, width: win.el.style.width, height: win.el.style.height };
    try { localStorage.setItem(GEOMETRY_KEY, JSON.stringify(store)); } catch (e) { /* storage full/unavailable: ignore */ }
  }
  function applyGeometry(win, defaultSize) {
    const saved = loadGeometryStore()[win.id];
    if (!saved) { cascadePosition(win, defaultSize); return; }
    const w = clamp(parseInt(saved.width, 10) || defaultSize.w, 280, window.innerWidth);
    const h = clamp(parseInt(saved.height, 10) || defaultSize.h, 200, window.innerHeight - taskbarHeight());
    win.el.style.width = w + 'px';
    win.el.style.height = h + 'px';
    win.el.style.left = clamp(parseInt(saved.left, 10) || 40, -w + 80, window.innerWidth - 80) + 'px';
    win.el.style.top = clamp(parseInt(saved.top, 10) || 32, 0, window.innerHeight - taskbarHeight() - 28) + 'px';
  }

  function attachDrag(win) {
    win.titlebarEl.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.mk-wctl')) return;
      if (isMobile) return;
      focusWindow(win.id);
      win.titlebarEl.setPointerCapture(e.pointerId);
      const startX = e.clientX, startY = e.clientY;
      const startLeft = win.el.offsetLeft, startTop = win.el.offsetTop;
      const onMove = (e2) => {
        const left = clamp(startLeft + (e2.clientX - startX), -win.el.offsetWidth + 80, window.innerWidth - 80);
        const top = clamp(startTop + (e2.clientY - startY), 0, window.innerHeight - taskbarHeight() - 28);
        win.el.style.left = left + 'px';
        win.el.style.top = top + 'px';
      };
      const onUp = () => {
        win.titlebarEl.removeEventListener('pointermove', onMove);
        win.titlebarEl.removeEventListener('pointerup', onUp);
        win.titlebarEl.removeEventListener('pointercancel', onUp);
        if (!win.el.classList.contains('mk-maximized')) saveGeometry(win);
      };
      win.titlebarEl.addEventListener('pointermove', onMove);
      win.titlebarEl.addEventListener('pointerup', onUp);
      win.titlebarEl.addEventListener('pointercancel', onUp);
    });
  }

  function attachResize(win) {
    const MIN_W = 280, MIN_H = 200;
    win.el.querySelectorAll('.mk-resize-handle').forEach((handle) => {
      const dir = handle.classList.contains('mk-resize-se') ? 'se' : handle.classList.contains('mk-resize-e') ? 'e' : 's';
      handle.addEventListener('pointerdown', (e) => {
        if (isMobile) return;
        e.stopPropagation();
        focusWindow(win.id);
        handle.setPointerCapture(e.pointerId);
        const startX = e.clientX, startY = e.clientY;
        const startW = win.el.offsetWidth, startH = win.el.offsetHeight;
        const maxW = window.innerWidth - win.el.offsetLeft;
        const maxH = window.innerHeight - taskbarHeight() - win.el.offsetTop;
        const onMove = (e2) => {
          if (dir === 'e' || dir === 'se') win.el.style.width = clamp(startW + (e2.clientX - startX), MIN_W, maxW) + 'px';
          if (dir === 's' || dir === 'se') win.el.style.height = clamp(startH + (e2.clientY - startY), MIN_H, maxH) + 'px';
        };
        const onUp = () => {
          handle.removeEventListener('pointermove', onMove);
          handle.removeEventListener('pointerup', onUp);
          handle.removeEventListener('pointercancel', onUp);
          saveGeometry(win);
        };
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
        handle.addEventListener('pointercancel', onUp);
      });
    });
  }

  function buildTaskbarButton(win, title, icon) {
    const btn = document.createElement('button');
    btn.className = 'mk-app-btn';
    btn.innerHTML = `${icon || ''}<span class="mk-app-btn-label"></span>`;
    btn.querySelector('.mk-app-btn-label').textContent = title;
    btn.addEventListener('click', () => {
      if (win.state === 'normal' && isFocused(win.id)) minimizeWindow(win.id);
      else {
        if (isMobile && !windowLayer.classList.contains('mk-split-mode')) {
          windows.forEach((w) => { if (w.id !== win.id && w.state === 'normal') minimizeWindow(w.id); });
        }
        restoreWindow(win.id);
        focusWindow(win.id);
      }
    });
    taskbarApps.appendChild(btn);
    win.taskbarBtn = btn;
  }

  function isFocused(id) {
    const win = windows.get(id);
    return win && win.el.classList.contains('mk-focused') && win.state === 'normal';
  }

  function focusWindow(id) {
    const win = windows.get(id);
    if (!win) return;
    windows.forEach((w) => {
      w.el.classList.remove('mk-focused');
      w.titlebarEl.classList.remove('mk-titlebar-active');
      w.titlebarEl.classList.add('mk-titlebar-inactive');
      w.taskbarBtn && w.taskbarBtn.classList.remove('mk-active');
    });
    win.el.style.zIndex = String(++zCounter);
    win.el.classList.add('mk-focused');
    win.titlebarEl.classList.remove('mk-titlebar-inactive');
    win.titlebarEl.classList.add('mk-titlebar-active');
    win.taskbarBtn && win.taskbarBtn.classList.add('mk-active');
  }

  function minimizeWindow(id) {
    const win = windows.get(id);
    if (!win) return;
    win.state = 'minimized';
    win.el.classList.add('mk-minimized');
    win.taskbarBtn && win.taskbarBtn.classList.remove('mk-active');
  }

  function restoreWindow(id) {
    const win = windows.get(id);
    if (!win) return;
    win.state = 'normal';
    win.el.classList.remove('mk-minimized');
  }

  function normalWindowCount() {
    let n = 0;
    windows.forEach((w) => { if (w.state === 'normal') n += 1; });
    return n;
  }

  function updateSplitButtons() {
    const showSplit = isMobile && normalWindowCount() === 1 && !windowLayer.classList.contains('mk-split-mode');
    windows.forEach((win) => {
      const btn = win.el.querySelector('.mk-wctl-split');
      if (btn) btn.classList.toggle('mk-hidden', !showSplit);
    });
  }

  function closeWindow(id) {
    const win = windows.get(id);
    if (!win) return;
    win.el.remove();
    win.taskbarBtn && win.taskbarBtn.remove();
    windows.delete(id);
    if (isMobile && normalWindowCount() <= 1) windowLayer.classList.remove('mk-split-mode');
    updateSplitButtons();
    let top = null;
    windows.forEach((w) => {
      if (w.state !== 'normal') return;
      if (!top || Number(w.el.style.zIndex || 0) > Number(top.el.style.zIndex || 0)) top = w;
    });
    if (top) focusWindow(top.id);
  }

  function toggleMaximize(win) {
    if (isMobile) return;
    if (win.el.classList.contains('mk-maximized')) {
      win.el.classList.remove('mk-maximized');
      if (win.rectBeforeMax) Object.assign(win.el.style, win.rectBeforeMax);
    } else {
      win.rectBeforeMax = { left: win.el.style.left, top: win.el.style.top, width: win.el.style.width, height: win.el.style.height };
      win.el.classList.add('mk-maximized');
    }
  }

  // Decides single-app-vs-split placement for a window becoming visible on
  // mobile — a NEW window and a previously-minimized one being reopened
  // both need this, otherwise picking an already-opened app as the second
  // half of a split silently fails (it just swaps back to single-app).
  function applyMobilePlacement(id) {
    const otherNormalIds = [...windows.keys()].filter((k) => k !== id && windows.get(k).state === 'normal');
    if (splitPending && otherNormalIds.length === 1) {
      windowLayer.classList.add('mk-split-mode');
      splitPending = false;
    } else if (windowLayer.classList.contains('mk-split-mode') && otherNormalIds.length >= 2) {
      otherNormalIds.forEach((oid) => minimizeWindow(oid));
      windowLayer.classList.remove('mk-split-mode');
    } else if (!windowLayer.classList.contains('mk-split-mode')) {
      otherNormalIds.forEach((oid) => minimizeWindow(oid));
    }
  }

  function openWindow({ id, title, icon = '', html = '', resizable = true, defaultSize = { w: 640, h: 460 } }) {
    if (windows.has(id)) {
      if (isMobile) applyMobilePlacement(id);
      restoreWindow(id);
      focusWindow(id);
      updateSplitButtons();
      return windows.get(id);
    }

    const frag = winTpl.content.cloneNode(true);
    const el = frag.querySelector('.mk-win');
    const titlebarEl = el.querySelector('.mk-titlebar');
    const contentEl = el.querySelector('.mk-wincontent');
    el.id = 'mkwin-' + id;
    el.querySelector('.mk-tb-icon').innerHTML = icon || '';
    el.querySelector('.mk-tb-title').textContent = title;
    contentEl.innerHTML = html;
    if (!resizable) el.querySelectorAll('.mk-resize-handle').forEach((h) => h.remove());

    const win = { id, el, titlebarEl, contentEl, state: 'normal' };
    windows.set(id, win);

    el.addEventListener('pointerdown', () => focusWindow(id), { capture: true });
    el.querySelector('.mk-tb-controls').addEventListener('click', (e) => {
      const btn = e.target.closest('.mk-wctl');
      if (!btn) return;
      e.stopPropagation();
      const action = btn.dataset.action;
      if (action === 'close') closeWindow(id);
      else if (action === 'minimize') minimizeWindow(id);
      else if (action === 'maximize') toggleMaximize(win);
      else if (action === 'split') {
        splitPending = true;
        btn.classList.add('mk-hidden');
        openLauncher();
      }
    });

    if (isMobile) {
      applyMobilePlacement(id);
      el.classList.add('mk-mobile-full');
      windowLayer.appendChild(el);
    } else {
      applyGeometry(win, defaultSize);
      windowLayer.appendChild(el);
      attachDrag(win);
      if (resizable) attachResize(win);
    }

    buildTaskbarButton(win, title, icon);
    updateSplitButtons();
    focusWindow(id);
    return win;
  }

  function getWindow(id) { return windows.get(id); }

  // ---------------- Launcher ----------------
  function openLauncher() {
    launcherEl.classList.remove('mk-hidden');
    btnLauncher.classList.add('mk-active');
  }
  function closeLauncher() {
    launcherEl.classList.add('mk-hidden');
    btnLauncher.classList.remove('mk-active');
  }
  btnLauncher.addEventListener('click', () => {
    if (launcherEl.classList.contains('mk-hidden')) openLauncher(); else closeLauncher();
  });
  document.addEventListener('click', (e) => {
    if (launcherEl.classList.contains('mk-hidden')) return;
    if (launcherEl.contains(e.target) || btnLauncher.contains(e.target)) return;
    closeLauncher();
  });

  function setLauncherItems(items) {
    launcherItemsEl.innerHTML = '';
    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'mk-launcher-row';
      row.innerHTML = `${item.icon || ''}<span></span>`;
      row.querySelector('span').textContent = item.label;
      row.addEventListener('click', () => { closeLauncher(); item.onSelect(); });
      launcherItemsEl.appendChild(row);
    });
  }

  // Swipe-up-to-open-launcher, additive to the always-present button.
  const TRIGGER_ZONE_PX = 70, MIN_SWIPE_DISTANCE = 45, MAX_SWIPE_DURATION = 600, MAX_DRIFT = 60;
  let swipeStartY = null, swipeStartX = 0, swipeStartTime = 0;
  document.addEventListener('touchstart', (e) => {
    if (!isMobile) { swipeStartY = null; return; }
    if (!launcherEl.classList.contains('mk-hidden')) { swipeStartY = null; return; }
    const touch = e.touches[0];
    if (window.innerHeight - touch.clientY > TRIGGER_ZONE_PX) { swipeStartY = null; return; }
    swipeStartY = touch.clientY; swipeStartX = touch.clientX; swipeStartTime = Date.now();
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (swipeStartY == null) return;
    const touch = e.changedTouches[0];
    const dy = swipeStartY - touch.clientY;
    const dx = Math.abs(touch.clientX - swipeStartX);
    const dt = Date.now() - swipeStartTime;
    swipeStartY = null;
    if (dy > MIN_SWIPE_DISTANCE && dx < MAX_DRIFT && dt < MAX_SWIPE_DURATION) openLauncher();
  }, { passive: true });

  // ---------------- Theme switching ----------------
  const THEME_KEY = 'mkwm-theme';
  function setTheme(name) {
    document.documentElement.setAttribute('data-theme', name);
    try { localStorage.setItem(THEME_KEY, name); } catch (e) { /* ignore */ }
  }
  function getTheme() {
    try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; }
  }

  // ---------------- Clock ----------------
  function tickClock() {
    if (!clockEl) return;
    const now = new Date();
    const time = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const date = now.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    clockEl.innerHTML = `<span>${time}</span><span class="mk-clock-date">${date}</span>`;
  }
  tickClock();
  setInterval(tickClock, 30000);

  return { openWindow, closeWindow, focusWindow, minimizeWindow, restoreWindow, getWindow, setLauncherItems, openLauncher, closeLauncher, setTheme, getTheme };
})();
