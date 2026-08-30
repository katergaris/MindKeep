'use strict';
// Gestore finestre in stile Windows 95: crea/sposta/ridimensiona/mette a fuoco
// le finestre, gestisce la taskbar e il comportamento desktop/mobile.
// app.js chiama solo le funzioni esposte su window.MindkeepWM; qui dentro non
// si conosce nulla delle view o dei dati di Mindkeep (nessuna dipendenza
// nell'altro verso), cosi' i due file restano disaccoppiati.
window.MindkeepWM = (() => {
  const windowLayer = document.getElementById('window-layer');
  const taskbarWindows = document.getElementById('taskbar-windows');
  const taskbarClock = document.getElementById('taskbar-clock');
  const winTpl = document.getElementById('tpl-window');

  const windows = new Map(); // id -> { id, el, titlebarEl, contentEl, taskbarBtn, state, rectBeforeMax }
  const openOrder = []; // ordine di apertura, per il fallback mobile "sostituisci"
  let zCounter = 10;
  let cascadeIndex = 0;
  let splitPending = false;

  const mobileMQ = window.matchMedia('(max-width: 760px)');
  let isMobile = mobileMQ.matches;
  mobileMQ.addEventListener('change', (e) => { isMobile = e.matches; adaptToViewport(); });

  function adaptToViewport() {
    if (isMobile) return;
    // Tornando a desktop, tolgo lo split forzato e ridò a ogni finestra la
    // sua geometria libera invece di lasciarla "impilata".
    windowLayer.classList.remove('split-mode');
    splitPending = false;
    windows.forEach((win) => {
      win.el.classList.remove('mobile-full');
      if (!win.el.style.left) cascadePosition(win);
    });
  }

  function cascadePosition(win, size) {
    cascadeIndex = (cascadeIndex + 1) % 8;
    const x = 40 + cascadeIndex * 26;
    const y = 36 + cascadeIndex * 24;
    win.el.style.left = x + 'px';
    win.el.style.top = y + 'px';
    win.el.style.width = (size && size.w ? size.w : 760) + 'px';
    win.el.style.height = (size && size.h ? size.h : 560) + 'px';
  }

  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

  // Posizione/dimensione finestre: solo desktop, solo comodita' locale
  // (localStorage, come lo sfondo) — non e' un dato da sincronizzare o da
  // proteggere, quindi niente backend. Salvata a fine trascinamento/
  // ridimensionamento, riapplicata (con i limiti dell'attuale viewport,
  // nel caso la finestra del browser sia piu' piccola di quando fu salvata)
  // quando la stessa app viene riaperta in una sessione successiva.
  const GEOMETRY_KEY = 'mindkeep-window-geometry';
  function loadGeometryStore() {
    try { return JSON.parse(localStorage.getItem(GEOMETRY_KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveGeometry(win) {
    const store = loadGeometryStore();
    store[win.id] = { left: win.el.style.left, top: win.el.style.top, width: win.el.style.width, height: win.el.style.height };
    try { localStorage.setItem(GEOMETRY_KEY, JSON.stringify(store)); } catch (e) { /* storage pieno/non disponibile: si ignora */ }
  }
  function applyGeometry(win, defaultSize) {
    const saved = loadGeometryStore()[win.id];
    if (!saved) { cascadePosition(win, defaultSize); return; }
    const w = clamp(parseInt(saved.width, 10) || defaultSize.w, 280, window.innerWidth);
    const h = clamp(parseInt(saved.height, 10) || defaultSize.h, 200, window.innerHeight - taskbarHeight());
    win.el.style.width = w + 'px';
    win.el.style.height = h + 'px';
    win.el.style.left = clamp(parseInt(saved.left, 10) || 40, -w + 80, window.innerWidth - 80) + 'px';
    win.el.style.top = clamp(parseInt(saved.top, 10) || 36, 0, window.innerHeight - taskbarHeight() - 28) + 'px';
  }

  function taskbarHeight() {
    const tb = document.getElementById('taskbar');
    return tb ? tb.offsetHeight : 42;
  }

  // ---- Drag (titlebar) e resize: stessa tecnica pointer-capture usata per
  // trascinare i nodi in Orbita — un pointerdown avvia, i movimenti si
  // accumulano finche' non arriva pointerup/pointercancel. ----
  function attachDrag(win) {
    win.titlebarEl.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.win-btn')) return;
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
        if (!win.el.classList.contains('maximized')) saveGeometry(win);
      };
      win.titlebarEl.addEventListener('pointermove', onMove);
      win.titlebarEl.addEventListener('pointerup', onUp);
      win.titlebarEl.addEventListener('pointercancel', onUp);
    });
  }

  function attachResize(win) {
    const MIN_W = 280, MIN_H = 200;
    win.el.querySelectorAll('.resize-handle').forEach((handle) => {
      const dir = handle.classList.contains('resize-se') ? 'se' : handle.classList.contains('resize-e') ? 'e' : 's';
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
    btn.className = 'taskbtn raised';
    btn.innerHTML = `<span class="taskbtn-icon">${icon || ''}</span><span class="taskbtn-label"></span>`;
    btn.querySelector('.taskbtn-label').textContent = title;
    btn.addEventListener('click', () => {
      if (win.state === 'normal' && isFocused(win.id)) minimizeWindow(win.id);
      else { restoreWindow(win.id); focusWindow(win.id); }
    });
    taskbarWindows.appendChild(btn);
    win.taskbarBtn = btn;
  }

  function isFocused(id) {
    const win = windows.get(id);
    return win && win.el.classList.contains('focused') && win.state === 'normal';
  }

  function focusWindow(id) {
    const win = windows.get(id);
    if (!win) return;
    windows.forEach((w) => { w.el.classList.remove('focused'); w.titlebarEl.classList.remove('titlebar-active'); w.titlebarEl.classList.add('titlebar-inactive'); w.taskbarBtn && w.taskbarBtn.classList.remove('pressed'); });
    win.el.style.zIndex = String(++zCounter);
    win.el.classList.add('focused');
    win.titlebarEl.classList.remove('titlebar-inactive');
    win.titlebarEl.classList.add('titlebar-active');
    win.taskbarBtn && win.taskbarBtn.classList.add('pressed');
  }

  function minimizeWindow(id) {
    const win = windows.get(id);
    if (!win) return;
    win.state = 'minimized';
    win.el.classList.add('minimized');
    win.taskbarBtn && win.taskbarBtn.classList.remove('pressed');
  }

  function restoreWindow(id) {
    const win = windows.get(id);
    if (!win) return;
    win.state = 'normal';
    win.el.classList.remove('minimized');
  }

  function updateSplitButtons() {
    const showSplit = isMobile && openOrder.length === 1 && !windowLayer.classList.contains('split-mode');
    windows.forEach((win) => {
      const btn = win.el.querySelector('.win-btn-split');
      if (btn) btn.classList.toggle('hidden', !showSplit);
    });
  }

  function closeWindow(id) {
    const win = windows.get(id);
    if (!win) return;
    win.el.remove();
    win.taskbarBtn && win.taskbarBtn.remove();
    windows.delete(id);
    const idx = openOrder.indexOf(id);
    if (idx !== -1) openOrder.splice(idx, 1);
    if (isMobile && openOrder.length <= 1) windowLayer.classList.remove('split-mode');
    updateSplitButtons();
    // Rimasta una finestra sola: rimetto a fuoco quella con lo z-index più alto.
    let top = null;
    windows.forEach((w) => { if (!top || Number(w.el.style.zIndex || 0) > Number(top.el.style.zIndex || 0)) top = w; });
    if (top) focusWindow(top.id);
  }

  function toggleMaximize(win) {
    if (isMobile) return;
    if (win.el.classList.contains('maximized')) {
      win.el.classList.remove('maximized');
      if (win.rectBeforeMax) {
        win.el.style.left = win.rectBeforeMax.left;
        win.el.style.top = win.rectBeforeMax.top;
        win.el.style.width = win.rectBeforeMax.width;
        win.el.style.height = win.rectBeforeMax.height;
      }
    } else {
      win.rectBeforeMax = { left: win.el.style.left, top: win.el.style.top, width: win.el.style.width, height: win.el.style.height };
      win.el.classList.add('maximized');
    }
  }

  function openWindow({ id, title, icon = '', resizable = true, defaultSize = { w: 760, h: 560 } }) {
    if (windows.has(id)) {
      restoreWindow(id);
      focusWindow(id);
      return windows.get(id);
    }

    const frag = winTpl.content.cloneNode(true);
    const el = frag.querySelector('.win-frame');
    const titlebarEl = el.querySelector('.titlebar');
    const contentEl = el.querySelector('.win-content');
    el.id = id;
    el.querySelector('.titlebar-icon').innerHTML = icon || '';
    el.querySelector('.titlebar-label').textContent = title;
    if (!resizable) el.querySelectorAll('.resize-handle').forEach((h) => h.remove());

    const win = { id, el, titlebarEl, contentEl, state: 'normal' };
    windows.set(id, win);
    openOrder.push(id);

    el.addEventListener('pointerdown', () => focusWindow(id), { capture: true });
    el.querySelector('.titlebar-btns').addEventListener('click', (e) => {
      const btn = e.target.closest('.win-btn');
      if (!btn) return;
      // Senza questo, il click su "Affianca" risale fino a document e il
      // listener "chiudi il menu Avvio se il click e' fuori" lo richiude
      // nello stesso istante in cui l'ha aperto (stesso ciclo di eventi).
      e.stopPropagation();
      const action = btn.dataset.action;
      if (action === 'close') closeWindow(id);
      else if (action === 'minimize') minimizeWindow(id);
      else if (action === 'maximize') toggleMaximize(win);
      else if (action === 'split') {
        splitPending = true;
        btn.classList.add('hidden');
        window.dispatchEvent(new CustomEvent('mindkeep:request-start-menu'));
      }
    });

    if (isMobile) {
      const otherIds = openOrder.slice(0, -1);
      if (splitPending && otherIds.length === 1) {
        windowLayer.classList.add('split-mode');
        splitPending = false;
      } else if (windowLayer.classList.contains('split-mode') && otherIds.length >= 2) {
        // Terza app mentre siamo in split: si torna a una sola finestra a schermo intero.
        otherIds.forEach((oid) => closeWindow(oid));
        windowLayer.classList.remove('split-mode');
      } else if (!windowLayer.classList.contains('split-mode')) {
        otherIds.forEach((oid) => closeWindow(oid));
      }
      el.classList.add('mobile-full');
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

  function tickClock() {
    if (!taskbarClock) return;
    const now = new Date();
    const time = now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    const date = now.toLocaleDateString('it-IT');
    taskbarClock.innerHTML = `<span class="taskbar-clock-time">${time}</span><span class="taskbar-clock-date">${date}</span>`;
  }
  tickClock();
  setInterval(tickClock, 30000);

  return { openWindow, closeWindow, focusWindow, minimizeWindow, restoreWindow, getWindow };
})();
