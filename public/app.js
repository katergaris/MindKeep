(() => {
  'use strict';

  // ---------------- PWA: cache del guscio per installabilita' e avvio offline ----------------
  // Se la registrazione fallisce (es. accesso in http semplice, senza
  // certificato: i service worker richiedono https) l'app funziona comunque,
  // solo senza installabilita' ne' cache offline.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

  // ---------------- API helper ----------------
  async function api(path, opts = {}) {
    let res;
    try {
      res = await fetch('/api' + path, {
        credentials: 'same-origin',
        headers: opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
        ...opts,
      });
    } catch (e) {
      // fetch() lancia (invece di rispondere con un errore HTTP) quando non
      // c'e' proprio connessione: senza questo l'utente vedeva "Failed to
      // fetch" invece di un messaggio comprensibile.
      throw new Error('Sei offline: serve una connessione al server per questa operazione.');
    }
    // Un 401 sulle rotte di accesso e' una credenziale sbagliata, non una
    // sessione scaduta: va lasciato passare alla schermata di login, che sa
    // spiegare cosa manca (password errata, codice a due fattori, ...).
    if (res.status === 401 && !path.startsWith('/auth/')) {
      showAuthScreen();
      throw new Error('Sessione scaduta');
    }
    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch (e) { /* corpo vuoto */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'Errore imprevisto');
      err.status = res.status;
      err.data = data || {};
      throw err;
    }
    return data;
  }

  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // Il testo va accorciato PRIMA di essere convertito in HTML: tagliando dopo
  // l'escape si poteva spezzare un'entita' (&amp; -> &am) e sporcare la pagina.
  function escTrim(str, max) {
    const s = String(str ?? '');
    return esc(s.length > max ? s.slice(0, max) + '…' : s);
  }

  function fmtDate(d) {
    if (!d) return '—';
    try { return new Date(d).toLocaleDateString('it-IT'); } catch (e) { return d; }
  }

  function parseTags(form) {
    return form.tags.value.split(',').map((t) => t.trim()).filter(Boolean);
  }

  function checklistProgress(list) {
    const total = (list || []).length;
    const done = (list || []).filter((c) => c.done).length;
    return { done, total };
  }

  // Formato di input rapido per il budget: una riga per voce, "etichetta, importo".
  function parseBudgetLines(text) {
    return text.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
      const idx = line.indexOf(',');
      if (idx === -1) return { label: line, amount: 0 };
      const label = line.slice(0, idx).trim();
      const amount = parseFloat(line.slice(idx + 1).replace(',', '.').trim()) || 0;
      return { label, amount };
    });
  }

  function budgetTotal(list) {
    return (list || []).reduce((sum, b) => sum + (Number(b.amount) || 0), 0);
  }

  function fmtMoney(n) {
    return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n || 0);
  }

  // Riusata sia dalla vista Progetti sia dalla Vista Bacheca del Flusso.
  function collectChecklist(form, previous) {
    const lines = form.checklist.value.split('\n').map((l) => l.trim()).filter(Boolean);
    const prevMap = new Map((previous || []).map((c) => [c.text, c.done]));
    return lines.map((text) => ({ text, done: prevMap.get(text) || false }));
  }

  function fmtSize(bytes) {
    if (!bytes) return '0 B';
    // Sotto il KB mostriamo i byte: prima qualsiasi file piccolo risultava "0 KB".
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(0)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
  }

  // ---------------- Modal ----------------
  const modalTpl = document.getElementById('tpl-modal');
  let activeModal = null;

  function openModal(title, bodyNode) {
    closeModal();
    const frag = modalTpl.content.cloneNode(true);
    const backdrop = frag.querySelector('.modal-backdrop');
    frag.querySelector('.modal-title').textContent = title;
    frag.querySelector('.modal-body').appendChild(bodyNode);
    frag.querySelector('.modal-close').addEventListener('click', closeModal);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
    // Con una connessione lenta, piu' click sul pulsante "Salva" prima che la
    // prima richiesta finisca creavano piu' voci identiche. Il bottone si
    // riabilita da solo dopo un po' nel caso la richiesta fallisca e la
    // finestra resti aperta (altrimenti non si potrebbe piu' riprovare).
    const form = bodyNode.tagName === 'FORM' ? bodyNode : bodyNode.querySelector('form');
    const submitBtn = form && form.querySelector('button[type="submit"]');
    if (form && submitBtn) {
      form.addEventListener('submit', () => {
        submitBtn.disabled = true;
        setTimeout(() => { submitBtn.disabled = false; }, 8000);
      });
    }
    document.body.appendChild(frag);
    activeModal = document.body.lastElementChild;
  }

  function closeModal() {
    if (activeModal) { activeModal.remove(); activeModal = null; }
  }

  // ---------------- Anteprima documento a schermo intero ----------------
  const PREVIEWABLE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']);
  let activePreview = null;

  function closePreview() {
    if (activePreview) { activePreview.remove(); activePreview = null; }
  }

  function openDocumentPreview(doc) {
    if (!PREVIEWABLE_MIME.has(doc.mime)) return;
    closePreview();
    const label = doc.display_name || doc.original_name;
    const url = `/api/drive/${doc.id}/view`;
    const backdrop = el('<div class="preview-backdrop"></div>');
    const box = el(`
      <div class="preview-box">
        <div class="preview-head">
          <span class="preview-title"></span>
          <div style="display:flex;gap:8px;align-items:center">
            <a class="btn btn-sm" href="/api/drive/${doc.id}/download">Scarica</a>
            <button type="button" class="preview-close" aria-label="Chiudi">✕</button>
          </div>
        </div>
      </div>
    `);
    box.querySelector('.preview-title').textContent = label;
    box.querySelector('.preview-close').addEventListener('click', closePreview);
    if (doc.mime.startsWith('image/')) {
      box.appendChild(el(`<img class="preview-media" src="${url}" alt="${esc(label)}" />`));
    } else {
      box.appendChild(el(`<iframe class="preview-media preview-frame" src="${url}" title="${esc(label)}"></iframe>`));
    }
    backdrop.appendChild(box);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closePreview(); });
    document.body.appendChild(backdrop);
    activePreview = backdrop;
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    closePreview();
    closeModal();
    if (typeof closeStartMenu === 'function') closeStartMenu();
    if (typeof closeQuickCapture === 'function') closeQuickCapture();
  });

  function el(html) {
    const div = document.createElement('div');
    div.innerHTML = html.trim();
    // Con piu' elementi al primo livello restituiamo un frammento: prima ne
    // usciva solo il primo e il resto spariva senza avvisare (era il caso dei
    // testi di aiuto di Vault e Fascicoli).
    if (div.children.length > 1) {
      const frag = document.createDocumentFragment();
      while (div.firstChild) frag.appendChild(div.firstChild);
      return frag;
    }
    return div.firstElementChild;
  }

  // ---------------- Effetto "decodifica" per il nome (una tantum) ----------------
  // Ogni carattere scorre tra simboli casuali prima di fermarsi su quello vero,
  // con un piccolo ritardo crescente da sinistra a destra. Gioca una sola volta
  // (non e' un loop): sul nome dell'app, ripeterlo ad ogni click sarebbe fastidioso.
  function decodeReveal(el, text) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.textContent = text;
      return;
    }
    const CHARS = '!<>-_/[]{}=+*^?#$%&';
    const randChar = () => CHARS[(Math.random() * CHARS.length) | 0];
    el.textContent = '';
    el.classList.add('decode-name');
    const chars = text.split('');
    const spans = chars.map(() => el.appendChild(document.createElement('span')));
    const caret = el.appendChild(document.createElement('span'));
    caret.className = 'decode-caret';

    const churnStart = chars.map((_, i) => i * 28 + Math.random() * 35);
    const lockTime = churnStart.map((t) => t + 150 + Math.random() * 160);
    const locked = chars.map(() => false);
    const start = performance.now();
    const timer = setInterval(() => {
      const elapsed = performance.now() - start;
      let allLocked = true;
      chars.forEach((ch, i) => {
        if (locked[i]) return;
        if (elapsed >= lockTime[i]) {
          spans[i].textContent = ch;
          spans[i].className = 'decode-cell--locked';
          locked[i] = true;
        } else {
          allLocked = false;
          if (elapsed >= churnStart[i]) {
            spans[i].textContent = ch === ' ' ? ' ' : randChar();
            spans[i].className = 'decode-cell--churn';
          }
        }
      });
      if (allLocked) { clearInterval(timer); caret.remove(); }
    }, 45);
  }

  // ---------------- Auth ----------------
  const authScreen = document.getElementById('auth-screen');
  const appRoot = document.getElementById('app');
  const authForm = document.getElementById('auth-form');
  const authSub = document.getElementById('auth-sub');
  const authError = document.getElementById('auth-error');
  const authSubmit = document.getElementById('auth-submit');
  const authTitle = document.getElementById('auth-title');
  let setupMode = false;
  let authTitleDecoded = false;

  function showAuthScreen() {
    appRoot.classList.add('hidden');
    authScreen.classList.remove('hidden');
    if (!authTitleDecoded) { authTitleDecoded = true; decodeReveal(authTitle, 'Mindkeep'); }
  }

  async function checkAuth() {
    const status = await api('/auth/status');
    if (status.authenticated) {
      startApp();
      return;
    }
    setupMode = status.setupNeeded;
    authSub.textContent = setupMode
      ? 'Primo avvio: crea il tuo accesso personale.'
      : 'Il tuo spazio personale, al sicuro.';
    authSubmit.textContent = setupMode ? 'Crea accesso' : 'Entra';
    showAuthScreen();
  }

  const authCodeRow = document.getElementById('auth-code-row');
  const authCodeInput = document.getElementById('auth-code');

  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    authError.classList.add('hidden');
    const username = document.getElementById('auth-username').value.trim();
    const password = document.getElementById('auth-password').value;
    const code = authCodeInput.value.trim();
    try {
      if (setupMode) {
        await api('/auth/setup', { method: 'POST', body: JSON.stringify({ username, password }) });
      } else {
        await api('/auth/login', {
          method: 'POST',
          body: JSON.stringify(code ? { username, password, code } : { username, password }),
        });
      }
      startApp();
    } catch (err) {
      // La password e' giusta ma manca il secondo fattore: mostriamo il campo
      // del codice invece di far ricominciare da capo.
      if (err.data && err.data.totpRequired) {
        authCodeRow.classList.remove('hidden');
        authCodeInput.value = '';
        authCodeInput.focus();
        authSubmit.textContent = 'Verifica ed entra';
      }
      authError.textContent = err.message;
      authError.classList.remove('hidden');
    }
  });

  // Dichiarazione (non costante) perche' viene usata anche dal foglio del
  // telefono, costruito prima di questo punto del file.
  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch (err) {
      // Anche se la chiamata fallisce ricarichiamo: la sessione va comunque chiusa lato client.
    }
    location.reload();
  }

  function startApp() {
    authScreen.classList.add('hidden');
    appRoot.classList.remove('hidden');
    buildDesktop();
  }

  // ---------------- Navigation ----------------
  // Icone Windows 95: piene e colorate (stile Program Manager), non il
  // vecchio tratto monocromo a 8 bit — segnalato poco calzante per questo tema.
  const APP_ICON_PATHS = {
    projects: '<rect x="3" y="2.5" width="14" height="16" rx="1" fill="#e9dfc4" stroke="#5c4a1e" stroke-width="0.8"/><rect x="7" y="1" width="6" height="3" rx="1" fill="#9a9aa2" stroke="#4a4a4a" stroke-width="0.6"/><rect x="6" y="7.2" width="8" height="1.6" fill="#4a7fc9"/><rect x="6" y="10.6" width="8" height="1.6" fill="#4a7fc9"/><rect x="6" y="14" width="5" height="1.6" fill="#e0743c"/>',
    ideas: '<rect x="4" y="2" width="12" height="16" fill="#fff6d8" stroke="#8a7a3a" stroke-width="0.8"/><path d="M12 2 L16 6 L12 6 Z" fill="#e8d48c" stroke="#8a7a3a" stroke-width="0.6"/><rect x="6" y="9" width="8" height="1.4" fill="#a89860"/><rect x="6" y="12" width="8" height="1.4" fill="#a89860"/><rect x="6" y="15" width="5" height="1.4" fill="#a89860"/>',
    vault: '<path d="M6 9V6.5a4 4 0 0 1 8 0V9" fill="none" stroke="#b8860b" stroke-width="2"/><rect x="4.5" y="9" width="11" height="9" rx="1.2" fill="#b0b0b8" stroke="#4a4a52" stroke-width="0.8"/><circle cx="10" cy="13" r="1.3" fill="#4a4a52"/><rect x="9.3" y="13" width="1.4" height="2.6" fill="#4a4a52"/>',
    accounts: '<rect x="2" y="4.5" width="16" height="11" rx="1.2" fill="#3a6ea5" stroke="#1f3a5c" stroke-width="0.8"/><rect x="2" y="7.5" width="16" height="2.6" fill="#1f3a5c"/><rect x="4" y="12" width="6" height="1.6" fill="#e8c96b"/>',
    drive: '<rect x="3" y="2.5" width="14" height="15" rx="0.6" fill="#3a4a8a" stroke="#1a2450" stroke-width="0.8"/><rect x="6" y="3" width="8" height="5" fill="#c8ccd8" stroke="#4a4a52" stroke-width="0.5"/><rect x="7" y="3.6" width="2.4" height="3.8" fill="#8890a0"/><rect x="5" y="12" width="10" height="4" fill="#e8eaf0" stroke="#4a4a52" stroke-width="0.5"/>',
    dossiers: '<path d="M2 5h7l2 2.5h9v9.5H2z" fill="#e3b23c" stroke="#8a6414" stroke-width="0.8"/><path d="M2 5h7l2 2.5H2z" fill="#f3cf72" stroke="#8a6414" stroke-width="0.8"/>',
    reminders: '<circle cx="10" cy="10.5" r="7.5" fill="#f5f5f5" stroke="#4a4a52" stroke-width="1"/><path d="M10 6v5l3.2 2" fill="none" stroke="#000080" stroke-width="1.4" stroke-linecap="round"/><rect x="7.5" y="1" width="5" height="1.6" fill="#8a8a92"/>',
    trash: '<path d="M4 6h12l-1 11H5z" fill="#c8c8ce" stroke="#4a4a52" stroke-width="0.8"/><rect x="3" y="4.2" width="14" height="2" fill="#a8a8b0" stroke="#4a4a52" stroke-width="0.6"/><rect x="8" y="2" width="4" height="2.2" fill="#a8a8b0" stroke="#4a4a52" stroke-width="0.6"/><line x1="7.5" y1="8.5" x2="8" y2="14.5" stroke="#8a8a92" stroke-width="1"/><line x1="10" y1="8.5" x2="10" y2="14.5" stroke="#8a8a92" stroke-width="1"/><line x1="12.5" y1="8.5" x2="12" y2="14.5" stroke="#8a8a92" stroke-width="1"/>',
    security: '<path d="M10 1.5 16 3.8v5.3c0 4.4-2.6 7.5-6 8.9-3.4-1.4-6-4.5-6-8.9V3.8z" fill="#4a7fc9" stroke="#1f3a5c" stroke-width="0.8"/><path d="M7 10l2 2.2 4-4.5" fill="none" stroke="#fff" stroke-width="1.3"/>',
    esci: '<rect x="3" y="2" width="8" height="16" fill="#a5713a" stroke="#5c3a1a" stroke-width="0.8"/><circle cx="8.6" cy="10" r="0.8" fill="#3a2410"/><path d="M12 6l4 4-4 4" fill="none" stroke="#c0392b" stroke-width="1.6"/><line x1="9" y1="10" x2="16" y2="10" stroke="#c0392b" stroke-width="1.6"/>',
  };

  function appIcon(nome, size = 18) {
    const inner = APP_ICON_PATHS[nome];
    if (!inner) return '';
    return `<svg width="${size}" height="${size}" viewBox="0 0 20 20" aria-hidden="true">${inner}</svg>`;
  }

  // Icone vettoriali "pulite" (tratto, non pixel-art): usate solo per il
  // tasto di ricerca del telefono, l'unico punto in cui il blocco a 8 bit era
  // stato segnalato illeggibile a quella dimensione (22px). Il resto della
  // navigazione resta nello stile retro a blocchi.
  const VECTOR_ICONS = {
    cerca: '<circle cx="11" cy="11" r="6.5"/><path d="M15.8 15.8L20.5 20.5"/>',
    chiudi: '<path d="M6 6l12 12M18 6L6 18"/>',
  };
  function iconaLinea(nome) {
    return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${VECTOR_ICONS[nome] || ''}</svg>`;
  }

  // Elenco unico delle app: alimenta il menu Avvio (computer e telefono).
  const SECTIONS = [
    { view: 'projects', label: 'Progetti' },
    { view: 'ideas', label: 'Note' },
    { view: 'vault', label: 'Vault' },
    { view: 'accounts', label: 'Abbonamenti' },
    { view: 'drive', label: 'Drive' },
    { view: 'dossiers', label: 'Cartelle' },
    { view: 'reminders', label: 'Scadenze' },
    { view: 'trash', label: 'Cestino' },
    { view: 'security', label: 'Sicurezza' },
  ];
  // Voci di configurazione separate da quelle d'uso quotidiano con un
  // divisore nel menu Avvio, per ridurre le scelte a parita' di sguardo.
  const SETTINGS_VIEWS = new Set(['trash', 'security']);

  // Sezione in cui vive ciascun tipo di elemento collegato a una cartella o
  // trovato dalla ricerca globale: usata per aprire l'elemento cliccandolo.
  const TYPE_TO_VIEW = { document: 'drive', idea: 'ideas', project: 'projects', account: 'accounts', vault: 'vault', reminder: 'reminders', dossier: 'dossiers' };
  // Conteggi per tipo mostrati nel riepilogo di una cartella (Cartelle > Apri).
  const TREE_TYPE_LABELS = { document: 'documenti', idea: 'note', project: 'progetti', account: 'account', vault: 'vault', reminder: 'scadenze' };

  const VIEW_LABELS = Object.fromEntries(SECTIONS.map((s) => [s.view, s.label]));

  // ---------------- Menu Avvio ----------------
  const startMenu = document.getElementById('start-menu');
  const btnStart = document.getElementById('btn-start');

  function buildStartMenu() {
    startMenu.innerHTML = '';
    const sidebar = el('<div class="start-menu-sidebar">MINDKEEP</div>');
    const items = el('<div class="start-menu-items"></div>');
    SECTIONS.forEach((s, i) => {
      const prev = SECTIONS[i - 1];
      if (SETTINGS_VIEWS.has(s.view) && (!prev || !SETTINGS_VIEWS.has(prev.view))) {
        items.appendChild(el('<div class="menu-divider"></div>'));
      }
      const row = el(`<div class="menu-row" data-view="${s.view}">${appIcon(s.view)}<span>${esc(s.label)}</span></div>`);
      row.addEventListener('click', () => { closeStartMenu(); render(s.view); });
      items.appendChild(row);
    });
    items.appendChild(el('<div class="menu-divider"></div>'));
    const esci = el(`<div class="menu-row">${appIcon('esci')}<span>Esci</span></div>`);
    esci.addEventListener('click', () => { closeStartMenu(); logout(); });
    items.appendChild(esci);
    startMenu.appendChild(sidebar);
    startMenu.appendChild(items);
  }
  buildStartMenu();

  function openStartMenu() {
    startMenu.classList.remove('hidden');
    btnStart.classList.add('pressed');
  }
  function closeStartMenu() {
    startMenu.classList.add('hidden');
    btnStart.classList.remove('pressed');
  }
  btnStart.addEventListener('click', () => {
    if (startMenu.classList.contains('hidden')) openStartMenu(); else closeStartMenu();
  });
  document.addEventListener('click', (e) => {
    if (startMenu.classList.contains('hidden')) return;
    if (startMenu.contains(e.target) || btnStart.contains(e.target)) return;
    closeStartMenu();
  });
  // wm.js chiede di aprire il menu Avvio quando l'utente tocca "Affianca" su
  // mobile, per scegliere la seconda app da mettere in split.
  window.addEventListener('mindkeep:request-start-menu', openStartMenu);

  // ---------------- Desktop: sfondo, cartelle e note recenti come icone ----------------
  // Lo sfondo e' una preferenza solo del dispositivo (localStorage), non un
  // dato di Mindkeep: niente migrazione, niente sincronizzazione fra dispositivi.
  const WALLPAPERS = {
    classico: { label: 'Classico' },
    'vaporwave-tramonto': { label: 'Vaporwave — Tramonto', url: '/wallpapers/wp-tramonto.jpg' },
    'vaporwave-palma': { label: 'Vaporwave — Palma', url: '/wallpapers/wp-palma.jpg' },
    grigio: { label: 'Grigio', color: '#6b6b76' },
  };
  const desktopWallpaperEl = document.getElementById('desktop-wallpaper');
  const desktopIconsEl = document.getElementById('desktop-icons');

  function currentWallpaper() {
    return localStorage.getItem('mindkeep-wallpaper') || 'classico';
  }

  function applyWallpaper(name) {
    const wp = WALLPAPERS[name] || WALLPAPERS.classico;
    desktopWallpaperEl.innerHTML = '';
    if (wp.url) {
      desktopWallpaperEl.style.background = `url(${wp.url}) center/cover`;
    } else if (wp.color) {
      desktopWallpaperEl.style.background = wp.color;
    } else {
      desktopWallpaperEl.style.background = '';
      desktopWallpaperEl.appendChild(el('<img class="wallpaper-logo" src="/icon.svg" alt="" />'));
    }
    localStorage.setItem('mindkeep-wallpaper', name);
  }

  const POSTIT_CLASSES = ['postit-y', 'postit-p', 'postit-b'];

  async function buildDesktop() {
    applyWallpaper(currentWallpaper());
    desktopIconsEl.innerHTML = '';
    try {
      const [dossiers, ideas] = await Promise.all([api('/dossiers'), api('/ideas')]);
      dossiers.slice(0, 8).forEach((d) => {
        const icon = el(`<button type="button" class="desktop-icon">${appIcon('dossiers', 40)}<span class="label"></span></button>`);
        icon.querySelector('.label').textContent = d.title;
        icon.addEventListener('click', () => render('dossiers', { highlight: d.id }));
        desktopIconsEl.appendChild(icon);
      });
      ideas.slice(0, 4).forEach((idea, i) => {
        const note = el(`<button type="button" class="postit ${POSTIT_CLASSES[i % POSTIT_CLASSES.length]}"></button>`);
        const text = idea.title || idea.body || '';
        note.textContent = text.length > 90 ? text.slice(0, 90) + '…' : text;
        note.addEventListener('click', () => render('ideas', { highlight: idea.id }));
        desktopIconsEl.appendChild(note);
      });
    } catch (err) {
      // desktop non critico: se le API falliscono restano solo lo sfondo e le finestre gia' aperte
    }
  }

  // ---------------- Cattura veloce ("Nuovo" in barra) ----------------
  // Prende il posto del vecchio composer di Flusso: sempre a un tocco,
  // qualunque finestra sia aperta. Stessa logica /comandi e @cartella,
  // in un riquadro invece che in una pagina intera.
  const quickCaptureEl = document.getElementById('quick-capture');
  const btnNuovo = document.getElementById('btn-nuovo');
  let qcMenuEl = null, qcMenuItems = [], qcMenuActive = 0, qcMenuTrigger = null, qcSelectedDossier = null;

  const QC_COMMANDS = [
    { token: '/nota', desc: 'nota veloce' },
    { token: '/doc', desc: 'carica documento' },
    { token: '/scadenza', desc: 'nuovo promemoria' },
    { token: '/progetto', desc: 'nuovo progetto' },
  ];

  function closeQuickCapture() {
    quickCaptureEl.classList.add('hidden');
    quickCaptureEl.innerHTML = '';
    btnNuovo.classList.remove('pressed');
    qcMenuEl = null; qcMenuItems = []; qcMenuTrigger = null; qcSelectedDossier = null;
  }

  async function openQuickCapture() {
    closeStartMenu();
    quickCaptureEl.innerHTML = '';
    const dossiers = await api('/dossiers').catch(() => []);
    const composer = el(`
      <div class="composer">
        <textarea id="qc-text" placeholder="Scrivi una nota — o / per un altro tipo, @ per una cartella, # per un tag" rows="2"></textarea>
        <div id="qc-link-badge"></div>
        <div class="composer-row">
          <button type="button" class="btn btn-primary" id="qc-save">Salva</button>
        </div>
        <div class="composer-hint">
          <span>/ per il tipo · @ per collegare una cartella · # per un tag</span>
        </div>
      </div>
    `);
    quickCaptureEl.appendChild(composer);
    quickCaptureEl.classList.remove('hidden');
    btnNuovo.classList.add('pressed');

    const textarea = composer.querySelector('#qc-text');
    const linkBadgeWrap = composer.querySelector('#qc-link-badge');
    const ideasForTags = await api('/ideas').catch(() => []);
    const knownTags = [...new Set(ideasForTags.flatMap((x) => x.tags || []))].sort();

    function renderLinkBadge() {
      linkBadgeWrap.innerHTML = '';
      if (!qcSelectedDossier) return;
      const badge = el(`<span class="composer-link-badge">→ ${esc(qcSelectedDossier.title)} <button type="button" title="Rimuovi">✕</button></span>`);
      badge.querySelector('button').addEventListener('click', () => { qcSelectedDossier = null; renderLinkBadge(); });
      linkBadgeWrap.appendChild(badge);
    }

    function closeQcMenu() {
      if (qcMenuEl) { qcMenuEl.remove(); qcMenuEl = null; }
      qcMenuItems = []; qcMenuTrigger = null;
    }
    function highlightQcMenu() {
      if (!qcMenuEl) return;
      qcMenuEl.querySelectorAll('.composer-menu-item').forEach((n, i) => n.classList.toggle('active', i === qcMenuActive));
    }
    function openQcMenu(items) {
      if (qcMenuEl) { qcMenuEl.remove(); qcMenuEl = null; }
      if (!items.length) { qcMenuItems = []; return; }
      qcMenuItems = items; qcMenuActive = 0;
      qcMenuEl = el('<div class="composer-menu"></div>');
      items.forEach((it, i) => {
        const row = el(`<div class="composer-menu-item ${i === 0 ? 'active' : ''}"><span class="cmi-token">${esc(it.token)}</span><span class="cmi-desc">${esc(it.desc)}</span></div>`);
        row.addEventListener('mousedown', (e) => { e.preventDefault(); selectQcMenuItem(i); });
        qcMenuEl.appendChild(row);
      });
      composer.appendChild(qcMenuEl);
    }
    function qcCurrentTrigger() {
      const pos = textarea.selectionStart;
      const upToCaret = textarea.value.slice(0, pos);
      const match = upToCaret.match(/(^|\s)([/@#][^\s]*)$/);
      if (!match) return null;
      const tokenStart = pos - match[2].length;
      return { type: match[2][0], query: match[2].slice(1).toLowerCase(), start: tokenStart, end: pos };
    }
    function updateQcMenu() {
      const trigger = qcCurrentTrigger();
      qcMenuTrigger = trigger;
      if (!trigger) { closeQcMenu(); return; }
      if (trigger.type === '/') {
        openQcMenu(QC_COMMANDS.filter((c) => c.token.slice(1).startsWith(trigger.query)));
      } else if (trigger.type === '@') {
        openQcMenu(dossiers.filter((d) => d.title.toLowerCase().includes(trigger.query)).map((d) => ({ token: '@' + d.title, desc: 'cartella', dossier: d })));
      } else {
        openQcMenu(knownTags.filter((t) => t.toLowerCase().startsWith(trigger.query)).map((t) => ({ token: '#' + t, desc: 'tag' })));
      }
    }
    async function selectQcMenuItem(i) {
      const item = qcMenuItems[i];
      const trigger = qcMenuTrigger;
      closeQcMenu();
      if (!item || !trigger) return;
      if (trigger.type === '#') {
        const before = textarea.value.slice(0, trigger.start);
        const after = textarea.value.slice(trigger.end);
        const needsSpace = !/^\s/.test(after);
        textarea.value = before + item.token + (needsSpace ? ' ' : '') + after;
        const caret = before.length + item.token.length + (needsSpace ? 1 : 0);
        textarea.focus(); textarea.setSelectionRange(caret, caret);
        return;
      }
      const before = textarea.value.slice(0, trigger.start);
      const after = textarea.value.slice(trigger.end);
      textarea.value = before + after;
      const caret = before.length;
      textarea.focus(); textarea.setSelectionRange(caret, caret);
      if (trigger.type === '@') { qcSelectedDossier = item.dossier; renderLinkBadge(); return; }
      if (item.token === '/nota') return;
      if (item.token === '/scadenza') {
        const form = reminderModal();
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          await api('/reminders', { method: 'POST', body: JSON.stringify({ label: form.label.value, date: form.date.value, notes: form.notes.value }) });
          closeModal(); toast('Scadenza salvata'); closeQuickCapture(); render('reminders');
        });
        form.querySelector('[data-cancel]').addEventListener('click', closeModal);
        openModal('Nuova scadenza', form);
        return;
      }
      if (item.token === '/doc') {
        closeQuickCapture();
        await render('drive');
        const btn = document.getElementById('new-doc');
        if (btn) btn.click();
        return;
      }
      if (item.token === '/progetto') {
        closeQuickCapture();
        await render('projects');
        const btn = document.getElementById('new-project');
        if (btn) btn.click();
      }
    }

    textarea.addEventListener('input', updateQcMenu);
    textarea.addEventListener('click', updateQcMenu);
    textarea.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); saveQc(); return; }
      if (!qcMenuEl) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); qcMenuActive = (qcMenuActive + 1) % qcMenuItems.length; highlightQcMenu(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); qcMenuActive = (qcMenuActive - 1 + qcMenuItems.length) % qcMenuItems.length; highlightQcMenu(); }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); selectQcMenuItem(qcMenuActive); }
      else if (e.key === 'Escape') { closeQcMenu(); }
    });

    let qcSaving = false;
    async function saveQc() {
      const text = textarea.value.trim();
      if (!text || qcSaving) return;
      qcSaving = true;
      composer.querySelector('#qc-save').disabled = true;
      try {
        const title = text.length > 80 ? text.slice(0, 80) + '…' : text;
        const tags = [...new Set((text.match(/#([a-zA-Z0-9_-]+)/g) || []).map((t) => t.slice(1)))];
        const idea = await api('/ideas', { method: 'POST', body: JSON.stringify({ title, body: text, tags }) });
        if (qcSelectedDossier) {
          await api(`/dossiers/${qcSelectedDossier.id}/links`, { method: 'POST', body: JSON.stringify({ item_type: 'idea', item_id: idea.id }) });
        }
        toast('Nota salvata');
        closeQuickCapture();
        buildDesktop();
      } finally {
        qcSaving = false;
      }
    }
    composer.querySelector('#qc-save').addEventListener('click', saveQc);
    textarea.focus();
  }

  btnNuovo.addEventListener('click', () => {
    if (quickCaptureEl.classList.contains('hidden')) openQuickCapture(); else closeQuickCapture();
  });
  document.addEventListener('click', (e) => {
    if (quickCaptureEl.classList.contains('hidden')) return;
    if (quickCaptureEl.contains(e.target) || btnNuovo.contains(e.target)) return;
    closeQuickCapture();
  });

  const views = {}; // popolate piu' sotto

  const WINDOW_SIZES = { vault: { w: 1040, h: 640 }, dossiers: { w: 760, h: 560 } };

  function windowId(view) { return 'win-' + view; }

  async function render(view, opts = {}) {
    const win = MindkeepWM.openWindow({
      id: windowId(view),
      title: VIEW_LABELS[view] || view,
      icon: appIcon(view, 14),
      defaultSize: WINDOW_SIZES[view] || { w: 760, h: 560 },
    });
    const contentEl = win.contentEl;
    contentEl.innerHTML = '';
    contentEl.appendChild(el('<div class="empty-state">Carico…</div>'));
    try {
      await views[view](contentEl, opts);
    } catch (err) {
      contentEl.innerHTML = '';
      contentEl.appendChild(el(`<div class="empty-state">Errore: ${esc(err.message)}</div>`));
    }
  }

  // ---------------- Collegamento a fascicolo (riutilizzabile) ----------------
  async function openLinkToDossierModal(itemType, itemId, itemLabel) {
    const dossiers = await api('/dossiers');
    const wrap = el('<div></div>');
    if (!dossiers.length) {
      wrap.appendChild(el('<p class="card-sub">Non hai ancora nessuna cartella. Creane una dalla sezione Cartelle.</p>'));
    } else {
      dossiers.forEach((d) => {
        const row = el(`
          <div class="trash-row row-card">
            <span>${esc(d.title)}</span>
            <button class="btn btn-sm btn-primary">Collega</button>
          </div>
        `);
        row.querySelector('button').addEventListener('click', async () => {
          await api(`/dossiers/${d.id}/links`, {
            method: 'POST',
            body: JSON.stringify({ item_type: itemType, item_id: itemId }),
          });
          toast(`"${itemLabel}" collegato a "${d.title}"`);
          closeModal();
        });
        wrap.appendChild(row);
      });
    }
    openModal('Collega a una cartella', wrap);
  }

  // ==================================================================
  // SCADENZE (promemoria — elenco minimo; il calendario vero e' lavoro futuro)
  // ==================================================================
  function reminderModal(existing) {
    const form = el(`
      <form class="modal-body" style="padding:0">
        <div class="form-row"><label>Cosa</label><input type="text" name="label" required /></div>
        <div class="form-row"><label>Quando</label><input type="date" name="date" required /></div>
        <div class="form-row"><label>Note</label><textarea name="notes" rows="3"></textarea></div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-cancel>Annulla</button>
          <button type="submit" class="btn btn-primary">Salva</button>
        </div>
      </form>
    `);
    if (existing) {
      form.label.value = existing.label;
      form.date.value = existing.date ? existing.date.slice(0, 10) : '';
      form.notes.value = existing.notes;
    }
    return form;
  }

  views.reminders = async (root, opts = {}) => {
    const highlightId = opts.highlight ? String(opts.highlight) : null;
    const reminders = await api('/reminders');
    root.innerHTML = '';
    root.appendChild(el(`
      <div class="view-header">
        <h2>Scadenze</h2>
        <div class="view-header-actions"><button class="btn btn-primary" id="new-reminder">+ Nuova scadenza</button></div>
      </div>
    `));

    root.querySelector('#new-reminder').addEventListener('click', () => {
      const form = reminderModal();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await api('/reminders', { method: 'POST', body: JSON.stringify({ label: form.label.value, date: form.date.value, notes: form.notes.value }) });
        closeModal(); toast('Scadenza salvata'); render('reminders');
      });
      form.querySelector('[data-cancel]').addEventListener('click', closeModal);
      openModal('Nuova scadenza', form);
    });

    if (!reminders.length) {
      root.appendChild(el('<div class="empty-state">Nessuna scadenza ancora.</div>'));
      return;
    }

    reminders
      .slice()
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .forEach((r) => {
        const days = Math.round((new Date(r.date) - new Date()) / 86400000);
        const dayLabel = days === 0 ? 'oggi' : days > 0 ? `tra ${days} giorn${days === 1 ? 'o' : 'i'}` : `passata da ${-days} giorn${days === -1 ? 'o' : 'i'}`;
        const row = el(`
          <div class="trash-row row-card">
            <span>
              <strong>${esc(r.label)}</strong>
              <span class="card-sub" style="display:block">${fmtDate(r.date)} · ${esc(dayLabel)}${r.notes ? ' · ' + escTrim(r.notes, 80) : ''}</span>
            </span>
            <span class="card-actions" style="padding:0">
              <button class="btn btn-sm" data-edit>Modifica</button>
              <button class="btn btn-sm" data-link>Cartella</button>
              <button class="btn btn-sm btn-danger" data-del>Elimina</button>
            </span>
          </div>
        `);
        row.querySelector('[data-edit]').addEventListener('click', () => {
          const form = reminderModal(r);
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await api(`/reminders/${r.id}`, { method: 'PUT', body: JSON.stringify({ label: form.label.value, date: form.date.value, notes: form.notes.value }) });
            closeModal(); toast('Scadenza aggiornata'); render('reminders');
          });
          form.querySelector('[data-cancel]').addEventListener('click', closeModal);
          openModal('Modifica scadenza', form);
        });
        row.querySelector('[data-link]').addEventListener('click', () => openLinkToDossierModal('reminder', r.id, r.label));
        row.querySelector('[data-del]').addEventListener('click', async () => {
          if (!confirm('Spostare questa scadenza nel cestino?')) return;
          await api(`/reminders/${r.id}`, { method: 'DELETE' });
          toast('Scadenza eliminata'); render('reminders');
        });
        if (highlightId && String(r.id) === highlightId) row.classList.add('card-highlight');
        root.appendChild(row);
      });
  };

  // ==================================================================
  // NOTE
  // ==================================================================
  function ideaModal(existing) {
    const form = el(`
      <form class="modal-body" style="padding:0">
        <div class="form-row"><label>Titolo</label><input type="text" name="title" required /></div>
        <div class="form-row"><label>Descrizione</label><textarea name="body" rows="5"></textarea></div>
        <div class="form-row"><label>Tag (separati da virgola)</label><input type="text" name="tags" /></div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-cancel>Annulla</button>
          <button type="submit" class="btn btn-primary">Salva</button>
        </div>
      </form>
    `);
    if (existing) {
      form.title.value = existing.title;
      form.body.value = existing.body;
      form.tags.value = (existing.tags || []).join(', ');
    }
    return form;
  }

  views.ideas = async (root, opts = {}) => {
    const highlightId = opts.highlight ? String(opts.highlight) : null;
    const ideas = await api('/ideas');
    root.innerHTML = '';
    root.appendChild(el(`
      <div class="view-header">
        <h2>Note</h2>
        <div class="view-header-actions"><button class="btn btn-primary" id="new-idea">+ Nuova nota</button></div>
      </div>
    `));

    root.querySelector('#new-idea').addEventListener('click', () => {
      const form = ideaModal();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const tags = parseTags(form);
        await api('/ideas', { method: 'POST', body: JSON.stringify({ title: form.title.value, body: form.body.value, tags }) });
        closeModal(); toast('Nota salvata'); render('ideas');
      });
      form.querySelector('[data-cancel]').addEventListener('click', closeModal);
      openModal('Nuova nota', form);
    });

    if (!ideas.length) {
      root.appendChild(el('<div class="empty-state">Nessuna nota ancora. Butta giu\' la prima.</div>'));
      return;
    }

    const grid = el('<div class="grid"></div>');
    ideas.forEach((idea) => {
      const card = el(`
        <div class="card">
          <p class="card-title">${esc(idea.title)}</p>
          <p class="card-body">${escTrim(idea.body, 220)}</p>
          <div class="tag-row">${(idea.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
          <div class="card-actions">
            <button class="btn btn-sm" data-edit>Modifica</button>
            <button class="btn btn-sm" data-link>Cartella</button>
            <button class="btn btn-sm btn-danger" data-del>Elimina</button>
          </div>
        </div>
      `);
      card.querySelector('[data-edit]').addEventListener('click', () => {
        const form = ideaModal(idea);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const tags = parseTags(form);
          await api(`/ideas/${idea.id}`, { method: 'PUT', body: JSON.stringify({ title: form.title.value, body: form.body.value, tags }) });
          closeModal(); toast('Nota aggiornata'); render('ideas');
        });
        form.querySelector('[data-cancel]').addEventListener('click', closeModal);
        openModal('Modifica nota', form);
      });
      card.querySelector('[data-link]').addEventListener('click', () => openLinkToDossierModal('idea', idea.id, idea.title));
      card.querySelector('[data-del]').addEventListener('click', async () => {
        if (!confirm('Spostare questa nota nel cestino?')) return;
        await api(`/ideas/${idea.id}`, { method: 'DELETE' });
        toast('Nota eliminata'); render('ideas');
      });
      if (highlightId && String(idea.id) === highlightId) card.classList.add('card-highlight');
      grid.appendChild(card);
    });
    root.appendChild(grid);
    if (highlightId) {
      const target = grid.querySelector('.card-highlight');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  // ==================================================================
  // PROGETTI
  // ==================================================================
  function projectModal(existing) {
    const form = el(`
      <form class="modal-body" style="padding:0">
        <div class="form-row"><label>Titolo</label><input type="text" name="title" required /></div>
        <div class="form-row"><label>Descrizione</label><textarea name="description" rows="4"></textarea></div>
        <div class="form-row"><label>Stato</label>
          <select name="status">
            <option value="da_fare">Da fare</option>
            <option value="in_corso">In corso</option>
            <option value="fatto">Fatto</option>
          </select>
        </div>
        <div class="form-row"><label>Scadenza (opzionale)</label><input type="date" name="deadline" /></div>
        <div class="form-row"><label>Checklist (una voce per riga)</label><textarea name="checklist" rows="4" placeholder="es. Comprare i materiali"></textarea></div>
        <div class="form-row"><label>Persone/contatti (separati da virgola)</label><input type="text" name="contacts" placeholder="es. Mario Rossi, elettricista" /></div>
        <div class="form-row"><label>Budget (una voce per riga: etichetta, importo)</label><textarea name="budget" rows="3" placeholder="es. Materiali, 50"></textarea></div>
        <div class="form-row"><label>Tag (separati da virgola)</label><input type="text" name="tags" /></div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-cancel>Annulla</button>
          <button type="submit" class="btn btn-primary">Salva</button>
        </div>
      </form>
    `);
    if (existing) {
      form.title.value = existing.title;
      form.description.value = existing.description;
      form.status.value = existing.status;
      form.deadline.value = existing.deadline ? existing.deadline.slice(0, 10) : '';
      form.checklist.value = (existing.checklist || []).map((c) => c.text).join('\n');
      form.contacts.value = (existing.contacts || []).join(', ');
      form.budget.value = (existing.budget || []).map((b) => `${b.label}, ${b.amount}`).join('\n');
      form.tags.value = (existing.tags || []).join(', ');
    }
    return form;
  }

  function parseContacts(form) {
    return form.contacts.value.split(',').map((c) => c.trim()).filter(Boolean);
  }

  // Bacheca: i progetti in kanban, spostabili tra gli stati con le frecce
  // (nessun trascinamento reale ancora — arriva in un secondo momento).
  views.projects = async (root, opts = {}) => {
    const highlightId = opts.highlight ? String(opts.highlight) : null;
    const projects = await api('/projects');
    root.innerHTML = '';
    root.appendChild(el(`
      <div class="view-header">
        <h2>Progetti</h2>
        <div class="view-header-actions"><button class="btn btn-primary" id="new-project">+ Nuovo progetto</button></div>
      </div>
    `));

    root.querySelector('#new-project').addEventListener('click', () => {
      const form = projectModal();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const tags = parseTags(form);
        const contacts = parseContacts(form);
        const budget = parseBudgetLines(form.budget.value);
        const checklist = collectChecklist(form, []);
        await api('/projects', { method: 'POST', body: JSON.stringify({ title: form.title.value, description: form.description.value, status: form.status.value, deadline: form.deadline.value || null, checklist, contacts, budget, tags }) });
        closeModal(); toast('Progetto creato'); render('projects');
      });
      form.querySelector('[data-cancel]').addEventListener('click', closeModal);
      openModal('Nuovo progetto', form);
    });

    if (!projects.length) {
      root.appendChild(el('<div class="empty-state">Nessun progetto ancora.</div>'));
      return;
    }

    const STATUSES = [
      { key: 'da_fare', label: 'Da fare' },
      { key: 'in_corso', label: 'In corso' },
      { key: 'fatto', label: 'Fatto' },
    ];
    const board = el('<div class="board"></div>');
    STATUSES.forEach((s, i) => {
      const col = el(`
        <div class="board-col">
          <div class="board-col-head"><span>${esc(s.label)}</span><span class="board-col-count">${projects.filter((p) => p.status === s.key).length}</span></div>
          <div class="board-col-body"></div>
        </div>
      `);
      const body = col.querySelector('.board-col-body');
      projects.filter((p) => p.status === s.key).forEach((p) => {
        const { done, total } = checklistProgress(p.checklist);
        const totalBudget = budgetTotal(p.budget);
        const card = el(`
          <div class="board-card">
            <p class="board-card-title">${esc(p.title)}</p>
            ${total ? `<p class="card-sub">${done}/${total} completati</p>` : ''}
            ${p.deadline ? `<p class="card-sub">Scadenza: ${fmtDate(p.deadline)}</p>` : ''}
            ${totalBudget ? `<p class="card-sub">Budget: ${fmtMoney(totalBudget)}</p>` : ''}
            <div class="board-card-actions">
              <button type="button" data-prev ${i === 0 ? 'disabled' : ''} title="Sposta indietro">←</button>
              <button type="button" data-next ${i === STATUSES.length - 1 ? 'disabled' : ''} title="Sposta avanti">→</button>
              <button type="button" data-edit>Modifica</button>
              <button type="button" data-link>Cartella</button>
              <button type="button" data-del>Elimina</button>
            </div>
          </div>
        `);
        async function moveTo(newStatus) {
          await api(`/projects/${p.id}`, { method: 'PUT', body: JSON.stringify({ status: newStatus }) });
          render('projects');
        }
        card.querySelector('[data-prev]').addEventListener('click', () => moveTo(STATUSES[i - 1].key));
        card.querySelector('[data-next]').addEventListener('click', () => moveTo(STATUSES[i + 1].key));
        card.querySelector('[data-edit]').addEventListener('click', () => {
          const form = projectModal(p);
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const tags = parseTags(form);
            const contacts = parseContacts(form);
            const budget = parseBudgetLines(form.budget.value);
            const checklist = collectChecklist(form, p.checklist);
            await api(`/projects/${p.id}`, { method: 'PUT', body: JSON.stringify({ title: form.title.value, description: form.description.value, status: form.status.value, deadline: form.deadline.value || null, checklist, contacts, budget, tags }) });
            closeModal(); toast('Progetto aggiornato'); render('projects');
          });
          form.querySelector('[data-cancel]').addEventListener('click', closeModal);
          openModal('Modifica progetto', form);
        });
        card.querySelector('[data-link]').addEventListener('click', () => openLinkToDossierModal('project', p.id, p.title));
        card.querySelector('[data-del]').addEventListener('click', async () => {
          if (!confirm('Spostare questo progetto nel cestino?')) return;
          await api(`/projects/${p.id}`, { method: 'DELETE' });
          toast('Progetto eliminato'); render('projects');
        });
        if (highlightId && String(p.id) === highlightId) card.classList.add('card-highlight');
        body.appendChild(card);
      });
      board.appendChild(col);
    });
    root.appendChild(board);
    if (highlightId) {
      const target = board.querySelector('.card-highlight');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  // ==================================================================
  // VAULT
  // ==================================================================
  // Generatore locale: niente ambiguita' visiva (niente I/l/1/O/0), 20
  // caratteri da un alfabeto di 70 simboli sono gia' ~123 bit di entropia.
  function generatePassword(length = 20) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+';
    const bytes = new Uint32Array(length);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (n) => chars[n % chars.length]).join('');
  }

  function vaultModal(existing) {
    const form = el(`
      <form class="modal-body" style="padding:0">
        <div class="form-row"><label>Titolo</label><input type="text" name="site" required /></div>
        <div class="form-row"><label>Tipo</label>
          <select name="type">
            <option value="password">Password</option>
            <option value="note">Nota sicura</option>
            <option value="card">Carta di credito</option>
          </select>
        </div>

        <div data-type-fields="password">
          <div class="form-row"><label>Username</label><input type="text" name="username" /></div>
          <div class="form-row">
            <label>Password${existing ? ' (lascia vuoto per non cambiarla)' : ''}</label>
            <div style="display:flex;gap:6px">
              <input type="text" name="password" style="flex:1" />
              <button type="button" class="btn btn-sm" id="gen-password">Genera</button>
            </div>
          </div>
          <div class="form-row"><label>URL</label><input type="text" name="url" /></div>
          <div class="form-row">
            <label>Codice TOTP${existing ? ' (lascia vuoto per non cambiarlo)' : ' (opzionale)'}</label>
            <input type="text" name="totp_secret" placeholder="es. JBSWY3DPEHPK3PXP" />
            <span class="field-hint">Segreto dell'app di autenticazione per questo sito: mostra un codice a 6 cifre insieme alla password.</span>
          </div>
          <div class="form-row" id="remove-totp-row" style="display:none">
            <label style="flex-direction:row;align-items:center;gap:6px">
              <input type="checkbox" name="remove_totp" style="width:auto" /> Rimuovi il codice TOTP salvato
            </label>
          </div>
        </div>

        <div data-type-fields="note">
          <div class="form-row"><label>Contenuto${existing ? ' (lascia vuoto per non cambiarlo)' : ''}</label><textarea name="secure_note" rows="6"></textarea></div>
        </div>

        <div data-type-fields="card">
          <div class="form-row"><label>Titolare carta</label><input type="text" name="card_holder" /></div>
          <div class="form-row"><label>Numero carta${existing ? ' (lascia vuoto per non cambiarlo)' : ''}</label><input type="text" name="card_number" inputmode="numeric" /></div>
          <div style="display:flex;gap:10px">
            <div class="form-row" style="flex:1"><label>Scadenza (MM/AA)</label><input type="text" name="card_expiry" placeholder="12/28" /></div>
            <div class="form-row" style="flex:1"><label>CVV${existing ? ' (lascia vuoto per non cambiarlo)' : ''}</label><input type="text" name="card_cvv" inputmode="numeric" /></div>
          </div>
        </div>

        <div class="form-row"><label>Note</label><textarea name="notes" rows="3"></textarea></div>
        <div class="form-row"><label>Tag (separati da virgola)</label><input type="text" name="tags" /></div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-cancel>Annulla</button>
          <button type="submit" class="btn btn-primary">Salva</button>
        </div>
      </form>
    `);

    function syncTypeFields() {
      form.querySelectorAll('[data-type-fields]').forEach((group) => {
        group.classList.toggle('hidden', group.dataset.typeFields !== form.type.value);
      });
    }
    form.type.addEventListener('change', syncTypeFields);
    form.querySelector('#gen-password').addEventListener('click', () => {
      form.password.value = generatePassword();
    });

    if (existing) {
      form.site.value = existing.site;
      form.type.value = existing.type || 'password';
      // "username" (password) e "card_holder" (carta) sono la stessa colonna
      // lato server: precompiliamo entrambi, solo uno e' visibile alla volta.
      form.username.value = existing.username;
      form.card_holder.value = existing.username;
      form.url.value = existing.url;
      form.notes.value = existing.notes;
      form.tags.value = (existing.tags || []).join(', ');
      form.card_expiry.value = existing.card_expiry || '';
      if (existing.hasTotp) form.querySelector('#remove-totp-row').style.display = '';
      // Il tipo non si cambia dopo la creazione: in modifica i campi del
      // segreto principale restano vuoti ("lascia vuoto per non cambiarlo"),
      // e cambiare tipo a quel punto scambierebbe il significato del segreto
      // gia' salvato (es. una password che diventa "numero di carta").
      form.type.disabled = true;
    }
    syncTypeFields();
    return form;
  }

  // Costruisce il corpo della richiesta in base al tipo scelto: il campo
  // "password" del form alimenta sempre l'unico segreto principale della
  // voce (password / numero carta / contenuto nota), qualunque sia il tipo.
  function collectVaultPayload(form, existing) {
    const type = form.type.value;
    const tags = parseTags(form);
    const payload = { site: form.site.value, type, notes: form.notes.value, tags };
    const primary = type === 'password' ? form.password.value : type === 'note' ? form.secure_note.value : form.card_number.value;
    if (primary || !existing) payload.password = primary;

    if (type === 'password') {
      payload.username = form.username.value;
      payload.url = form.url.value;
      if (form.remove_totp && form.remove_totp.checked) payload.totp_secret = '-';
      else if (form.totp_secret.value.trim()) payload.totp_secret = form.totp_secret.value.trim();
    } else if (type === 'card') {
      payload.username = form.card_holder.value;
      payload.card_expiry = form.card_expiry.value;
      if (form.card_cvv.value.trim()) payload.card_cvv = form.card_cvv.value.trim();
    }
    return payload;
  }

  function vaultPrimaryFieldError(form, existing) {
    if (existing) return null; // in modifica, vuoto = "non cambiare": mai un errore
    const type = form.type.value;
    if (type === 'password' && !form.password.value) return 'La password e\' obbligatoria';
    if (type === 'note' && !form.secure_note.value) return 'Il contenuto della nota e\' obbligatorio';
    if (type === 'card' && !form.card_number.value) return 'Il numero della carta e\' obbligatorio';
    return null;
  }

  views.vault = async (root, opts = {}) => {
    const highlightId = opts.highlight ? String(opts.highlight) : null;
    const entries = await api('/vault');
    root.innerHTML = '';
    root.appendChild(el(`
      <div class="view-header">
        <h2>Vault</h2>
      </div>
      <p class="card-sub">L'import CSV riconosce colonne come site/name/title, username/login/email, password, url, notes.</p>
      <div class="vault-toolbar">
        <label class="btn btn-ghost" style="cursor:pointer">
          Importa CSV
          <input type="file" id="csv-input" accept=".csv" class="hidden" />
        </label>
        <button class="btn btn-primary" id="new-vault">+ Nuova voce</button>
      </div>
    `));

    root.querySelector('#csv-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const fd = new FormData();
      fd.append('file', file);
      try {
        const result = await api('/vault/import', { method: 'POST', body: fd });
        toast(`Importate ${result.imported} voci (${result.skipped} saltate)`);
        render('vault');
      } catch (err) {
        toast('Import fallito: ' + err.message);
      }
    });

    root.querySelector('#new-vault').addEventListener('click', () => {
      const form = vaultModal();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const error = vaultPrimaryFieldError(form, null);
        if (error) { toast(error); return; }
        await api('/vault', { method: 'POST', body: JSON.stringify(collectVaultPayload(form, null)) });
        closeModal(); toast('Voce salvata'); render('vault');
      });
      form.querySelector('[data-cancel]').addEventListener('click', closeModal);
      openModal('Nuova voce vault', form);
    });

    if (!entries.length) {
      root.appendChild(el('<div class="empty-state">Il vault e\' vuoto.</div>'));
      return;
    }

    const TYPE_LABEL = { password: 'Password', note: 'Nota', card: 'Carta' };
    const sheet = el(`
      <div class="vault-sheet">
        <div class="vault-sheet-head">
          <span class="vsh-cell">#</span>
          <span class="vsh-cell">Tipo</span>
          <span class="vsh-cell">Sito</span>
          <span class="vsh-cell">Utente</span>
          <span class="vsh-cell">Password</span>
          <span class="vsh-cell"></span>
        </div>
        <div class="vault-sheet-body"></div>
      </div>
    `);
    const body = sheet.querySelector('.vault-sheet-body');
    root.appendChild(sheet);

    entries.forEach((entry, idx) => {
      const row = el(`
        <div class="vault-sheet-row">
          <span class="vs-cell vs-num">${idx + 1}</span>
          <span class="vs-cell vs-type" data-label="Tipo"><span class="vs-type-dot vs-type-${esc(entry.type)}"></span>${esc(TYPE_LABEL[entry.type] || entry.type)}</span>
          <span class="vs-cell" data-label="Sito">${esc(entry.site)}</span>
          <span class="vs-cell" data-label="Utente">${esc(entry.username) || '—'}</span>
          <span class="vs-cell vs-pwd" data-label="Password" data-pwd>${entry.type === 'note' ? '(nota sicura)' : '••••••••'}</span>
          <span class="vs-cell vs-actions">
            ${entry.hasTotp ? '<button class="btn btn-sm" data-totp>Codice</button>' : ''}
            <button class="btn btn-sm" data-reveal>Mostra</button>
            <button class="btn btn-sm" data-edit>Modifica</button>
            <button class="btn btn-sm" data-link>Cartella</button>
            <button class="btn btn-sm btn-danger" data-del>Elimina</button>
          </span>
        </div>
      `);
      let revealed = false;
      row.querySelector('[data-reveal]').addEventListener('click', async () => {
        const pwdEl = row.querySelector('[data-pwd]');
        if (!revealed) {
          const full = await api(`/vault/${entry.id}/reveal`);
          pwdEl.textContent = entry.type === 'card'
            ? `${full.password || '(vuoto)'} · CVV ${full.cvv || '—'}`
            : (full.password || '(vuoto)');
          revealed = true;
          row.querySelector('[data-reveal]').textContent = 'Nascondi';
        } else {
          pwdEl.textContent = entry.type === 'note' ? '(nota sicura)' : '••••••••';
          revealed = false;
          row.querySelector('[data-reveal]').textContent = 'Mostra';
        }
      });
      if (entry.hasTotp) {
        let totpTimer = null;
        const totpBtn = row.querySelector('[data-totp]');
        totpBtn.addEventListener('click', async () => {
          if (totpTimer) {
            clearInterval(totpTimer);
            totpTimer = null;
            row.querySelector('[data-pwd]').textContent = entry.type === 'note' ? '(nota sicura)' : (revealed ? row.querySelector('[data-pwd]').textContent : '••••••••');
            totpBtn.textContent = 'Codice';
            return;
          }
          const pwdEl = row.querySelector('[data-pwd]');
          const showCode = async () => {
            // La riga potrebbe non esistere piu' (navigazione altrove): si ferma da sola.
            if (!document.body.contains(row)) { clearInterval(totpTimer); return; }
            try {
              const { code, secondsRemaining } = await api(`/vault/${entry.id}/totp`);
              pwdEl.textContent = `${code} (${secondsRemaining}s)`;
            } catch (e) {
              pwdEl.textContent = 'Codice non disponibile';
            }
          };
          await showCode();
          totpTimer = setInterval(showCode, 1000);
          totpBtn.textContent = 'Nascondi codice';
        });
      }
      row.querySelector('[data-edit]').addEventListener('click', () => {
        const form = vaultModal(entry);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          await api(`/vault/${entry.id}`, { method: 'PUT', body: JSON.stringify(collectVaultPayload(form, entry)) });
          closeModal(); toast('Voce aggiornata'); render('vault');
        });
        form.querySelector('[data-cancel]').addEventListener('click', closeModal);
        openModal('Modifica voce vault', form);
      });
      row.querySelector('[data-link]').addEventListener('click', () => openLinkToDossierModal('vault', entry.id, entry.site));
      row.querySelector('[data-del]').addEventListener('click', async () => {
        if (!confirm('Spostare questa voce nel cestino?')) return;
        await api(`/vault/${entry.id}`, { method: 'DELETE' });
        toast('Voce eliminata'); render('vault');
      });
      if (highlightId && String(entry.id) === highlightId) row.classList.add('card-highlight');
      body.appendChild(row);
    });
    if (highlightId) {
      const target = root.querySelector('.card-highlight');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  // ==================================================================
  // ACCOUNT
  // ==================================================================
  const BILLING_LABELS = {
    '': 'Non specificata',
    settimanale: 'Settimanale',
    mensile: 'Mensile',
    trimestrale: 'Trimestrale',
    semestrale: 'Semestrale',
    annuale: 'Annuale',
    una_tantum: 'Una tantum',
  };

  function accountModal(existing) {
    const form = el(`
      <form class="modal-body" style="padding:0">
        <div class="form-row"><label>Servizio / abbonamento</label><input type="text" name="service" required /></div>
        <div class="form-row"><label>Tipo</label>
          <select name="type">
            <option value="digitale">Digitale</option>
            <option value="cartaceo">Cartaceo / fisico</option>
          </select>
        </div>
        <div data-type-fields="digitale">
          <div class="form-row"><label>Email</label><input type="text" name="email" /></div>
          <div class="form-row"><label>Piano</label><input type="text" name="plan" /></div>
        </div>
        <div data-type-fields="cartaceo">
          <div class="form-row"><label>Luogo / negozio</label><input type="text" name="location" placeholder="es. edicola, negozio" /></div>
          <div class="form-row"><label>Modalita' di pagamento</label><input type="text" name="payment_method" placeholder="es. contanti, bonifico" /></div>
        </div>
        <div class="form-row"><label>Frequenza di addebito</label>
          <select name="billing_frequency">
            ${Object.entries(BILLING_LABELS).map(([v, label]) => `<option value="${v}">${esc(label)}</option>`).join('')}
          </select>
        </div>
        <div class="form-row"><label>Importo</label><input type="number" name="amount" step="0.01" min="0" placeholder="es. 9.99" /></div>
        <div class="form-row"><label>Data di rinnovo/scadenza</label><input type="date" name="renewal_date" /></div>
        <div class="form-row"><label>Note</label><textarea name="notes" rows="3"></textarea></div>
        <div class="form-row"><label>Tag (separati da virgola)</label><input type="text" name="tags" /></div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-cancel>Annulla</button>
          <button type="submit" class="btn btn-primary">Salva</button>
        </div>
      </form>
    `);
    function syncTypeFields() {
      form.querySelectorAll('[data-type-fields]').forEach((group) => {
        group.classList.toggle('hidden', group.dataset.typeFields !== form.type.value);
      });
    }
    form.type.addEventListener('change', syncTypeFields);
    if (existing) {
      form.service.value = existing.service;
      form.type.value = existing.type || 'digitale';
      form.email.value = existing.email;
      form.plan.value = existing.plan;
      form.location.value = existing.location || '';
      form.payment_method.value = existing.payment_method || '';
      form.billing_frequency.value = existing.billing_frequency || '';
      form.amount.value = existing.amount != null ? existing.amount : '';
      form.renewal_date.value = existing.renewal_date ? existing.renewal_date.slice(0, 10) : '';
      form.notes.value = existing.notes;
      form.tags.value = (existing.tags || []).join(', ');
    }
    syncTypeFields();
    return form;
  }

  // Scelta di una voce Vault gia' salvata da collegare a un abbonamento
  // (credenziali riusate, senza doverle riscrivere). Stesso schema del
  // selettore fascicolo esistente (openLinkToDossierModal).
  async function openLinkVaultModal(account) {
    const entries = await api('/vault');
    const wrap = el('<div></div>');
    if (account.vaultEntry) {
      const current = el(`
        <div class="trash-row row-card">
          <span>Collegata: ${esc(account.vaultEntry.site)}${account.vaultEntry.username ? ' · ' + esc(account.vaultEntry.username) : ''}</span>
          <button class="btn btn-sm btn-danger">Scollega</button>
        </div>
      `);
      current.querySelector('button').addEventListener('click', async () => {
        await api(`/accounts/${account.id}`, { method: 'PUT', body: JSON.stringify({ vault_entry_id: null }) });
        toast('Credenziali scollegate');
        closeModal(); render('accounts');
      });
      wrap.appendChild(current);
    }
    if (!entries.length) {
      wrap.appendChild(el('<p class="card-sub">Non hai ancora nessuna voce nel Vault. Creane una dalla sezione Vault.</p>'));
    } else {
      entries.forEach((v) => {
        const row = el(`
          <div class="trash-row row-card">
            <span>${esc(v.site)}${v.username ? ' · ' + esc(v.username) : ''}</span>
            <button class="btn btn-sm btn-primary">Collega</button>
          </div>
        `);
        row.querySelector('button').addEventListener('click', async () => {
          await api(`/accounts/${account.id}`, { method: 'PUT', body: JSON.stringify({ vault_entry_id: v.id }) });
          toast(`Credenziali "${v.site}" collegate`);
          closeModal(); render('accounts');
        });
        wrap.appendChild(row);
      });
    }
    openModal('Collega credenziali dal Vault', wrap);
  }

  views.accounts = async (root, opts = {}) => {
    const highlightId = opts.highlight ? String(opts.highlight) : null;
    const accounts = await api('/accounts');
    root.innerHTML = '';
    root.appendChild(el(`
      <div class="view-header">
        <h2>Abbonamenti</h2>
        <div class="view-header-actions"><button class="btn btn-primary" id="new-account">+ Nuovo abbonamento</button></div>
      </div>
    `));

    function accountPayload(form) {
      return {
        service: form.service.value,
        type: form.type.value,
        email: form.email.value,
        plan: form.plan.value,
        location: form.location.value,
        payment_method: form.payment_method.value,
        billing_frequency: form.billing_frequency.value,
        amount: form.amount.value === '' ? null : form.amount.value,
        renewal_date: form.renewal_date.value || null,
        notes: form.notes.value,
        tags: parseTags(form),
      };
    }

    root.querySelector('#new-account').addEventListener('click', () => {
      const form = accountModal();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await api('/accounts', { method: 'POST', body: JSON.stringify(accountPayload(form)) });
        closeModal(); toast('Abbonamento salvato'); render('accounts');
      });
      form.querySelector('[data-cancel]').addEventListener('click', closeModal);
      openModal('Nuovo abbonamento', form);
    });

    if (!accounts.length) {
      root.appendChild(el('<div class="empty-state">Nessun abbonamento ancora.</div>'));
      return;
    }

    const grid = el('<div class="grid"></div>');
    accounts.forEach((a) => {
      const isCartaceo = a.type === 'cartaceo';
      const card = el(`
        <div class="card">
          <span class="tag tag-neutral" style="width:fit-content">${isCartaceo ? 'Cartaceo' : 'Digitale'}</span>
          <p class="card-title">${esc(a.service)}</p>
          ${isCartaceo
            ? `<p class="card-sub">${esc(a.location) || '—'}${a.payment_method ? ' · ' + esc(a.payment_method) : ''}</p>`
            : `<p class="card-sub">${esc(a.email) || '—'} ${a.plan ? '· ' + esc(a.plan) : ''}</p>`}
          ${a.billing_frequency || a.amount != null
            ? `<p class="card-sub">${a.billing_frequency ? esc(BILLING_LABELS[a.billing_frequency] || a.billing_frequency) : ''}${a.billing_frequency && a.amount != null ? ' · ' : ''}${a.amount != null ? fmtMoney(a.amount) : ''}</p>`
            : ''}
          ${a.renewal_date ? `<p class="card-sub">Rinnovo: ${fmtDate(a.renewal_date)}</p>` : ''}
          ${a.vaultEntry ? `<p class="card-sub">Credenziali: ${esc(a.vaultEntry.site)}${a.vaultEntry.username ? ' · ' + esc(a.vaultEntry.username) : ''}</p>` : ''}
          <div class="tag-row">${(a.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
          <div class="card-actions">
            <button class="btn btn-sm" data-edit>Modifica</button>
            <button class="btn btn-sm" data-link>Cartella</button>
            <button class="btn btn-sm" data-vault>${a.vaultEntry ? 'Cambia credenziali' : 'Collega credenziali'}</button>
            <button class="btn btn-sm btn-danger" data-del>Elimina</button>
          </div>
        </div>
      `);
      card.querySelector('[data-edit]').addEventListener('click', () => {
        const form = accountModal(a);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          await api(`/accounts/${a.id}`, { method: 'PUT', body: JSON.stringify(accountPayload(form)) });
          closeModal(); toast('Abbonamento aggiornato'); render('accounts');
        });
        form.querySelector('[data-cancel]').addEventListener('click', closeModal);
        openModal('Modifica abbonamento', form);
      });
      card.querySelector('[data-link]').addEventListener('click', () => openLinkToDossierModal('account', a.id, a.service));
      card.querySelector('[data-vault]').addEventListener('click', () => openLinkVaultModal(a));
      card.querySelector('[data-del]').addEventListener('click', async () => {
        if (!confirm('Spostare questo abbonamento nel cestino?')) return;
        await api(`/accounts/${a.id}`, { method: 'DELETE' });
        toast('Abbonamento eliminato'); render('accounts');
      });
      if (highlightId && String(a.id) === highlightId) card.classList.add('card-highlight');
      grid.appendChild(card);
    });
    root.appendChild(grid);
    if (highlightId) {
      const target = grid.querySelector('.card-highlight');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  // ==================================================================
  // DRIVE
  // ==================================================================
  function documentModal(existing) {
    const form = el(`
      <form class="modal-body" style="padding:0">
        <div class="form-row"><label>Nome (opzionale)</label><input type="text" name="display_name" placeholder="Lascia vuoto per usare il nome del file" /></div>
        <p class="card-sub" style="margin:-6px 0 0">File originale: ${esc(existing.original_name)}</p>
        <div class="form-row"><label>Cartella</label><input type="text" name="folder" placeholder="es. Casa, Auto, Fiscale" /></div>
        <div class="form-row"><label>Scadenza (opzionale)</label><input type="date" name="expiry_date" /></div>
        <div class="form-row"><label>Tag (separati da virgola)</label><input type="text" name="tags" /></div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-cancel>Annulla</button>
          <button type="submit" class="btn btn-primary">Salva</button>
        </div>
      </form>
    `);
    form.display_name.value = existing.display_name || '';
    form.folder.value = existing.folder || '';
    form.expiry_date.value = existing.expiry_date ? existing.expiry_date.slice(0, 10) : '';
    form.tags.value = (existing.tags || []).join(', ');
    return form;
  }

  views.drive = async (root, opts = {}) => {
    const highlightId = opts.highlight ? String(opts.highlight) : null;
    const docs = await api('/drive');
    root.innerHTML = '';
    root.appendChild(el(`
      <div class="view-header">
        <h2>Drive</h2>
        <div class="view-header-actions"><button class="btn btn-primary" id="new-doc">+ Carica documento</button></div>
      </div>
    `));

    root.querySelector('#new-doc').addEventListener('click', () => {
      const form = el(`
        <form class="modal-body" style="padding:0">
          <div class="form-row"><label>File</label><input type="file" name="file" required /></div>
          <div class="form-row"><label>Nome (opzionale)</label><input type="text" name="display_name" placeholder="Lascia vuoto per usare il nome del file" /></div>
          <div class="form-row"><label>Cartella</label><input type="text" name="folder" placeholder="es. Casa, Auto, Fiscale" /></div>
          <div class="form-row"><label>Scadenza (opzionale)</label><input type="date" name="expiry_date" /></div>
          <div class="form-row"><label>Tag (separati da virgola)</label><input type="text" name="tags" /></div>
          <div class="form-actions">
            <button type="button" class="btn btn-ghost" data-cancel>Annulla</button>
            <button type="submit" class="btn btn-primary">Carica</button>
          </div>
        </form>
      `);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const tags = parseTags(form);
        const fd = new FormData();
        fd.append('file', form.file.files[0]);
        fd.append('display_name', form.display_name.value);
        fd.append('folder', form.folder.value);
        fd.append('expiry_date', form.expiry_date.value || '');
        fd.append('tags', JSON.stringify(tags));
        await api('/drive', { method: 'POST', body: fd });
        closeModal(); toast('Documento caricato'); render('drive');
      });
      form.querySelector('[data-cancel]').addEventListener('click', closeModal);
      openModal('Carica documento', form);
    });

    if (!docs.length) {
      root.appendChild(el('<div class="empty-state">Nessun documento ancora.</div>'));
      return;
    }

    docs.forEach((d) => {
      const ext = (d.original_name.includes('.') ? d.original_name.split('.').pop() : '').toUpperCase().slice(0, 4);
      const previewable = PREVIEWABLE_MIME.has(d.mime);
      const isImage = (d.mime || '').startsWith('image/');
      const row = el(`
        <div class="doc-row row-card">
          <div style="display:flex;gap:10px;align-items:center;min-width:0">
            <div class="entry-doc${previewable ? ' entry-doc-clickable' : ''}" style="margin-top:0;flex:none">
              ${isImage
                ? `<img class="entry-doc-thumb" src="/api/drive/${d.id}/view" alt="" />`
                : `<span class="entry-doc-ext">${esc(ext || 'FILE')}</span>`}
            </div>
            <div style="min-width:0">
              <div class="doc-name">${esc(d.display_name || d.original_name)}</div>
              ${d.display_name ? `<div class="doc-original">${esc(d.original_name)}</div>` : ''}
              <div class="doc-meta">${d.folder ? esc(d.folder) + ' · ' : ''}${fmtSize(d.size)}${d.expiry_date ? ' · scade ' + fmtDate(d.expiry_date) : ''}</div>
            </div>
          </div>
          <span class="card-actions" style="padding:0">
            <a class="btn btn-sm" href="/api/drive/${d.id}/download">Scarica</a>
            <button class="btn btn-sm" data-edit>Modifica</button>
            <button class="btn btn-sm" data-link>Cartella</button>
            <button class="btn btn-sm btn-danger" data-del>Elimina</button>
          </span>
        </div>
      `);
      if (previewable) row.querySelector('.entry-doc').addEventListener('click', () => openDocumentPreview(d));
      row.querySelector('[data-edit]').addEventListener('click', () => {
        const form = documentModal(d);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const tags = parseTags(form);
          await api(`/drive/${d.id}`, { method: 'PUT', body: JSON.stringify({ display_name: form.display_name.value, folder: form.folder.value, expiry_date: form.expiry_date.value || null, tags }) });
          closeModal(); toast('Documento aggiornato'); render('drive');
        });
        form.querySelector('[data-cancel]').addEventListener('click', closeModal);
        openModal('Modifica documento', form);
      });
      row.querySelector('[data-link]').addEventListener('click', () => openLinkToDossierModal('document', d.id, d.display_name || d.original_name));
      row.querySelector('[data-del]').addEventListener('click', async () => {
        if (!confirm('Spostare questo documento nel cestino?')) return;
        await api(`/drive/${d.id}`, { method: 'DELETE' });
        toast('Documento eliminato'); render('drive');
      });
      if (highlightId && String(d.id) === highlightId) row.classList.add('card-highlight');
      root.appendChild(row);
    });
    if (highlightId) {
      const target = root.querySelector('.card-highlight');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  // ==================================================================
  // FASCICOLI
  // ==================================================================
  views.dossiers = async (root, opts = {}) => {
    const dossiers = await api('/dossiers');
    const highlightId = opts.highlight ? String(opts.highlight) : null;
    root.innerHTML = '';
    root.appendChild(el(`
      <div class="view-header">
        <h2>Cartelle</h2>
        <div class="view-header-actions"><button class="btn btn-primary" id="new-dossier">+ Nuova cartella</button></div>
      </div>
      <p class="card-sub">Una cartella raccoglie insieme documenti, password, abbonamenti e note legati allo stesso tema. Collega gli elementi dai loro pulsanti "Cartella".</p>
    `));

    root.querySelector('#new-dossier').addEventListener('click', () => {
      const form = el(`
        <form class="modal-body" style="padding:0">
          <div class="form-row"><label>Titolo</label><input type="text" name="title" required /></div>
          <div class="form-row"><label>Descrizione</label><textarea name="description" rows="3"></textarea></div>
          <div class="form-actions">
            <button type="button" class="btn btn-ghost" data-cancel>Annulla</button>
            <button type="submit" class="btn btn-primary">Crea</button>
          </div>
        </form>
      `);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await api('/dossiers', { method: 'POST', body: JSON.stringify({ title: form.title.value, description: form.description.value }) });
        closeModal(); toast('Cartella creata'); render('dossiers');
      });
      form.querySelector('[data-cancel]').addEventListener('click', closeModal);
      openModal('Nuova cartella', form);
    });

    if (!dossiers.length) {
      root.appendChild(el('<div class="empty-state">Nessuna cartella ancora.</div>'));
      return;
    }

    // Elenco completo con dettaglio: si apre cliccando la card (o "Apri").
    function openDossierDetail(d) {
      const wrap = el('<div></div>');
      if (!d.items.length) {
        wrap.appendChild(el('<p class="card-sub">Nessun elemento collegato.</p>'));
      } else {
        d.items.forEach((item) => {
          const row = el(`
            <div class="trash-row row-card" style="cursor:pointer">
              <span><span class="chip-type">${esc(item.type)}</span>&nbsp;${esc(item.label)}</span>
              <button type="button" class="btn btn-sm btn-danger" title="Scollega">✕</button>
            </div>
          `);
          row.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            const view = TYPE_TO_VIEW[item.type];
            closeModal();
            if (view) render(view, { highlight: item.id });
          });
          row.querySelector('button').addEventListener('click', async (e) => {
            e.stopPropagation();
            await api(`/dossiers/${d.id}/links/${item.type}/${item.id}`, { method: 'DELETE' });
            toast('Elemento scollegato'); closeModal(); render('dossiers');
          });
          wrap.appendChild(row);
        });
      }
      openModal(d.title, wrap);
    }

    const grid = el('<div class="grid"></div>');
    dossiers.forEach((d) => {
      const counts = {};
      d.items.forEach((item) => { counts[item.type] = (counts[item.type] || 0) + 1; });
      const summary = Object.entries(counts).map(([type, count]) => `${count} ${TREE_TYPE_LABELS[type] || type}`).join(' · ');
      const card = el(`
        <div class="card dossier-card" style="cursor:pointer">
          <p class="card-title">${esc(d.title)}</p>
          <p class="card-body">${esc(d.description)}</p>
          <p class="card-sub">${summary ? esc(summary) : 'Nessun elemento collegato.'}</p>
          <div class="card-actions">
            <button class="btn btn-sm" data-open>Apri</button>
            <button class="btn btn-sm btn-danger" data-del>Elimina cartella</button>
          </div>
        </div>
      `);
      card.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        openDossierDetail(d);
      });
      card.querySelector('[data-open]').addEventListener('click', () => openDossierDetail(d));
      card.querySelector('[data-del]').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Spostare questa cartella nel cestino? Gli elementi collegati non verranno eliminati.')) return;
        await api(`/dossiers/${d.id}`, { method: 'DELETE' });
        toast('Cartella eliminata'); render('dossiers');
      });
      if (highlightId && String(d.id) === highlightId) card.classList.add('card-highlight');
      grid.appendChild(card);
    });
    root.appendChild(grid);
    if (highlightId) {
      const target = grid.querySelector('.card-highlight');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const match = dossiers.find((d) => String(d.id) === highlightId);
      if (match) openDossierDetail(match);
    }
  };

  // ==================================================================
  // CESTINO
  // ==================================================================
  const TYPE_LABELS = { idea: 'Nota', project: 'Progetto', vault: 'Vault', account: 'Abbonamento', document: 'Documento', dossier: 'Cartella', reminder: 'Scadenza' };

  views.trash = async (root) => {
    const items = await api('/trash');
    root.innerHTML = '';
    root.appendChild(el('<div class="view-header"><h2>Cestino</h2></div>'));

    if (!items.length) {
      root.appendChild(el('<div class="empty-state">Il cestino e\' vuoto.</div>'));
      return;
    }

    items.forEach((item) => {
      const row = el(`
        <div class="trash-row row-card">
          <span><span class="chip-type">${esc(TYPE_LABELS[item.type] || item.type)}</span> &nbsp;${esc(item.label)}</span>
          <span class="card-actions" style="padding:0">
            <button class="btn btn-sm" data-restore>Ripristina</button>
            <button class="btn btn-sm btn-danger" data-purge>Elimina definitivamente</button>
          </span>
        </div>
      `);
      row.querySelector('[data-restore]').addEventListener('click', async () => {
        await api(`/trash/${item.type}/${item.id}/restore`, { method: 'POST' });
        toast('Ripristinato'); render('trash');
      });
      row.querySelector('[data-purge]').addEventListener('click', async () => {
        if (!confirm('Eliminare definitivamente? L\'operazione non e\' reversibile.')) return;
        await api(`/trash/${item.type}/${item.id}`, { method: 'DELETE' });
        toast('Eliminato definitivamente'); render('trash');
      });
      root.appendChild(row);
    });
  };

  // ==================================================================
  // SICUREZZA (verifica in due passaggi)
  // ==================================================================
  function showRecoveryCodes(codes) {
    const wrap = el('<div></div>');
    wrap.appendChild(el(`
      <p class="card-sub">Conservali <strong>ora</strong>: stampali o mettili in un posto sicuro,
      lontano dal telefono. Ognuno funziona una volta sola e servono per entrare se perdi
      il telefono. Non potrai piu' rivederli.</p>
    `));
    const list = el('<div class="recovery-codes"></div>');
    codes.forEach((c) => list.appendChild(el(`<code>${esc(c)}</code>`)));
    wrap.appendChild(list);

    const actions = el('<div class="form-actions"></div>');
    const copy = el('<button type="button" class="btn btn-ghost">Copia tutti</button>');
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(codes.join('\n'));
        toast('Codici copiati');
      } catch (e) {
        toast('Copia non riuscita: selezionali a mano');
      }
    });
    const done = el('<button type="button" class="btn btn-primary">Li ho salvati</button>');
    done.addEventListener('click', () => { closeModal(); render('security'); });
    actions.appendChild(copy);
    actions.appendChild(done);
    wrap.appendChild(actions);
    openModal('Codici di recupero', wrap);
  }

  function askPassword(title, testo, onConfirm) {
    const form = el(`
      <form class="modal-body" style="padding:0">
        <p class="card-sub">${esc(testo)}</p>
        <div class="form-row"><label>Password</label><input type="password" name="password" required /></div>
        <p class="form-error hidden" data-err></p>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-cancel>Annulla</button>
          <button type="submit" class="btn btn-primary">Conferma</button>
        </div>
      </form>
    `);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = form.querySelector('[data-err]');
      errEl.classList.add('hidden');
      try {
        await onConfirm(form.password.value);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      }
    });
    form.querySelector('[data-cancel]').addEventListener('click', closeModal);
    openModal(title, form);
  }

  function startTotpSetup() {
    api('/security/totp/setup', { method: 'POST' }).then((data) => {
      const wrap = el('<div class="totp-setup"></div>');
      wrap.appendChild(el(`
        <ol class="totp-steps">
          <li>Apri <strong>Google Authenticator</strong> (o Aegis, 1Password, Authy: vanno tutte bene) e tocca "+".</li>
          <li>Scegli "Scansiona un codice QR" e inquadra questo:</li>
        </ol>
      `));
      const qr = el(`<div class="qr-box">${data.qr}</div>`);
      wrap.appendChild(qr);
      wrap.appendChild(el(`
        <p class="card-sub">Se non riesci a inquadrarlo, nell'app scegli "Inserisci chiave di configurazione"
        e digita:<br /><code class="totp-secret">${esc(data.secret)}</code></p>
      `));

      const form = el(`
        <form class="modal-body" style="padding:0">
          <div class="form-row">
            <label>Scrivi il codice a 6 cifre che vedi nell'app</label>
            <input type="text" name="code" inputmode="numeric" maxlength="7" placeholder="123456" required />
          </div>
          <p class="form-error hidden" data-err></p>
          <div class="form-actions">
            <button type="button" class="btn btn-ghost" data-cancel>Annulla</button>
            <button type="submit" class="btn btn-primary">Attiva</button>
          </div>
        </form>
      `);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errEl = form.querySelector('[data-err]');
        errEl.classList.add('hidden');
        try {
          const res = await api('/security/totp/enable', {
            method: 'POST',
            body: JSON.stringify({ code: form.code.value }),
          });
          closeModal();
          toast('Verifica in due passaggi attiva');
          showRecoveryCodes(res.recoveryCodes);
        } catch (err) {
          errEl.textContent = err.message;
          errEl.classList.remove('hidden');
        }
      });
      form.querySelector('[data-cancel]').addEventListener('click', closeModal);
      wrap.appendChild(form);
      openModal('Attiva la verifica in due passaggi', wrap);
    });
  }

  views.security = async (root) => {
    const info = await api('/security');
    root.innerHTML = '';
    root.appendChild(el('<div class="view-header"><h2>Sicurezza</h2></div>'));

    const block = el('<div class="section-block"><h3>Verifica in due passaggi</h3></div>');

    if (!info.totpEnabled) {
      block.appendChild(el(`
        <p class="card-sub">Non attiva: per entrare basta la password. Attivandola servira' anche
        un codice a 6 cifre generato dal telefono, che cambia ogni 30 secondi.
        Funziona senza connessione a internet e senza inviare nulla a nessuno.</p>
      `));
      const btn = el('<button class="btn btn-primary">Attiva con QR</button>');
      btn.addEventListener('click', startTotpSetup);
      block.appendChild(btn);
    } else {
      block.appendChild(el(`
        <p class="card-sub">Attiva. All'accesso viene chiesto il codice dell'app di autenticazione.</p>
        <p class="card-sub">Codici di recupero ancora utilizzabili: <strong>${info.recoveryCodesLeft}</strong> su 8.</p>
      `));
      const actions = el('<div class="card-actions" style="padding:12px 0 0"></div>');

      const nuovi = el('<button class="btn btn-sm">Genera nuovi codici di recupero</button>');
      nuovi.addEventListener('click', () => {
        askPassword(
          'Nuovi codici di recupero',
          'I codici precedenti smetteranno di funzionare. Conferma con la tua password.',
          async (password) => {
            const res = await api('/security/totp/recovery-codes', {
              method: 'POST',
              body: JSON.stringify({ password }),
            });
            closeModal();
            showRecoveryCodes(res.recoveryCodes);
          }
        );
      });

      const off = el('<button class="btn btn-sm btn-danger">Disattiva</button>');
      off.addEventListener('click', () => {
        askPassword(
          'Disattiva la verifica in due passaggi',
          'Dopo la disattivazione per entrare bastera\' di nuovo la sola password. Conferma con la tua password.',
          async (password) => {
            await api('/security/totp/disable', { method: 'POST', body: JSON.stringify({ password }) });
            closeModal();
            toast('Verifica in due passaggi disattivata');
            render('security');
          }
        );
      });

      actions.appendChild(nuovi);
      actions.appendChild(off);
      block.appendChild(actions);

      if (info.recoveryCodesLeft === 0) {
        block.appendChild(el(`
          <p class="form-error">Hai finito i codici di recupero: se perdi il telefono non potrai
          piu' entrare dall'app. Generane di nuovi.</p>
        `));
      }
    }

    root.appendChild(block);

    const wallpaperBlock = el('<div class="section-block"><h3>Sfondo desktop</h3><p class="card-sub">Solo su questo dispositivo — non viene sincronizzato.</p></div>');
    const wallpaperRow = el('<div class="card-actions" style="padding-top:10px"></div>');
    Object.entries(WALLPAPERS).forEach(([key, wp]) => {
      const btn = el(`<button class="btn btn-sm${key === currentWallpaper() ? ' btn-primary' : ''}" data-wp="${key}"></button>`);
      btn.textContent = wp.label;
      btn.addEventListener('click', () => { applyWallpaper(key); render('security'); });
      wallpaperRow.appendChild(btn);
    });
    wallpaperBlock.appendChild(wallpaperRow);
    root.appendChild(wallpaperBlock);

    const help = el('<div class="section-block"><h3>Se perdi il telefono</h3></div>');
    help.appendChild(el(`
      <p class="card-sub">Usa uno dei codici di recupero al posto delle 6 cifre nella schermata di accesso.
      Se non hai nemmeno quelli, dal computer dove gira Mindkeep puoi disattivare la verifica con:</p>
      <p><code class="cmd-line">docker compose exec mindkeep node server/disable-2fa.js</code></p>
    `));
    root.appendChild(help);
  };

  // ---------------- Global search ----------------
  const searchInput = document.getElementById('global-search');
  const searchResults = document.getElementById('search-results');
  const topbar = document.getElementById('topbar');
  const searchToggle = document.getElementById('search-toggle');
  let searchTimer = null;

  // Su telefono la ricerca sta dietro un'icona: apre a tutta larghezza al tocco
  // e libera lo spazio che occupava fissa in cima. Su schermo largo l'icona e'
  // nascosta dal CSS e il campo resta sempre visibile.
  searchToggle.innerHTML = iconaLinea('cerca');
  searchToggle.addEventListener('click', () => {
    const aperta = topbar.classList.toggle('search-open');
    searchToggle.setAttribute('aria-expanded', String(aperta));
    searchToggle.innerHTML = iconaLinea(aperta ? 'chiudi' : 'cerca');
    if (aperta) {
      searchInput.focus();
    } else {
      searchInput.value = '';
      searchResults.classList.add('hidden');
    }
  });

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (!q) { searchResults.classList.add('hidden'); return; }
    searchTimer = setTimeout(async () => {
      let results;
      try {
        results = await api('/search?q=' + encodeURIComponent(q));
      } catch (err) {
        searchResults.innerHTML = '';
        searchResults.appendChild(el(`<div class="search-result-item">${esc(err.message)}</div>`));
        searchResults.classList.remove('hidden');
        return;
      }
      // La ricerca puo' rispondere fuori ordine: ignoriamo i risultati vecchi.
      if (searchInput.value.trim() !== q) return;
      searchResults.innerHTML = '';
      if (!results.length) {
        searchResults.appendChild(el('<div class="search-result-item">Nessun risultato</div>'));
      } else {
        results.slice(0, 20).forEach((r) => {
          const item = el(`<div class="search-result-item"><span>${esc(r.label)}</span><span class="search-result-tag">${esc(TYPE_LABELS[r.type] || r.type)}</span></div>`);
          item.addEventListener('click', () => {
            searchResults.classList.add('hidden');
            searchInput.value = '';
            render(TYPE_TO_VIEW[r.type] || 'ideas', { highlight: r.id });
          });
          searchResults.appendChild(item);
        });
      }
      searchResults.classList.remove('hidden');
    }, 250);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrap')) searchResults.classList.add('hidden');
  });

  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k') return;
    if (appRoot.classList.contains('hidden')) return; // non ancora autenticati
    e.preventDefault();
    if (!topbar.classList.contains('search-open') && searchToggle.offsetParent) searchToggle.click();
    else searchInput.focus();
  });

  // Molti handler fanno "await api(...)" senza try/catch: senza questa rete di
  // sicurezza un errore restava solo in console e per l'utente non succedeva nulla.
  window.addEventListener('unhandledrejection', (e) => {
    const msg = e.reason && e.reason.message ? e.reason.message : 'Errore imprevisto';
    if (msg !== 'Sessione scaduta') toast(msg);
    e.preventDefault();
  });

  // Commit da cui gira questa build: si vede sia prima sia dopo l'accesso,
  // cosi' si controlla a colpo d'occhio se il container e' stato davvero
  // aggiornato invece di continuare a girare su un'immagine vecchia in cache.
  api('/health').then((health) => {
    const label = `build ${health.version}`;
    const authEl = document.getElementById('auth-version');
    const sidebarEl = document.getElementById('sidebar-version');
    if (authEl) authEl.textContent = label;
    if (sidebarEl) sidebarEl.textContent = label;
  }).catch(() => {});

  // ---------------- Avvio ----------------
  checkAuth().catch((err) => {
    authError.textContent = err.message;
    authError.classList.remove('hidden');
    showAuthScreen();
  });
})();
