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
    const backdrop = document.getElementById('sheet-backdrop');
    if (backdrop && !backdrop.classList.contains('hidden')) {
      backdrop.classList.add('hidden');
      document.body.classList.remove('no-scroll');
    }
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

  document.getElementById('logout-btn').addEventListener('click', logout);

  let sidebarBrandDecoded = false;
  function startApp() {
    authScreen.classList.add('hidden');
    appRoot.classList.remove('hidden');
    if (!sidebarBrandDecoded) {
      sidebarBrandDecoded = true;
      decodeReveal(document.getElementById('sidebar-brand-name'), 'Mindkeep');
    }
    render('flusso');
  }

  // ---------------- Navigation ----------------
  // Icone pixel-art (griglia 8x8, stile retro a 8 bit): ogni stringa e' una
  // riga, '#' un pixel acceso. Niente file o servizi esterni: solo <rect>
  // generati da questa mappa, un pittogramma con un significato per voce
  // invece di un tratto astratto.
  const ICONS = {
    flusso:     ['................', '................', '...###..........', '...####.........', '...#####........', '...######.......', '...#######......', '...########.....', '...########.....', '...#######......', '...######.......', '...#####........', '...####.........', '...###..........', '................', '................'],
    ideas:      ['................', '................', '......####......', '.....######.....', '....########....', '....########....', '....########....', '....########....', '.....######.....', '......####......', '......####......', '................', '.....######.....', '................', '......####......', '................'],
    projects:   ['................', '................', '.####...........', '.####..########.', '.####..########.', '.####...........', '................', '.####...........', '.####..########.', '.####..########.', '.####...........', '................', '.####...........', '.####..########.', '.####..########.', '.####...........'],
    vault:      ['................', '.......###......', '......#####.....', '.....#######....', '....###...###...', '....###...###...', '....###...###...', '....#########...', '...###########..', '...###########..', '...###########..', '...###########..', '...###########..', '...###########..', '...###########..', '................'],
    accounts:   ['................', '................', '.......###......', '......#####.....', '.....#######....', '.....#######....', '.....#######....', '......#####.....', '.......###......', '......#####.....', '....#########...', '...###########..', '..#############.', '..#############.', '..#############.', '................'],
    drive:      ['................', '................', '..##########....', '..#.........#...', '..#..######..#..', '..#..#....#..#..', '..#..#....#..#..', '..#..######..#..', '..#..........#..', '..#..######..#..', '..#..######..#..', '..#..######..#..', '..#..######..#..', '..############..', '................', '................'],
    dossiers:   ['................', '................', '................', '................', '..#####.........', '..#####.........', '..#############.', '..#...........#.', '..#...........#.', '..#...........#.', '..#...........#.', '..#...........#.', '..#...........#.', '..#############.', '................', '................'],
    trash:      ['................', '......####......', '......####......', '...##########...', '...##########...', '....########....', '....#......#....', '....#.#.#.##....', '....#.#.#.##....', '....#.#.#.##....', '....#.#.#.##....', '....#.#.#.##....', '....#.#.#.##....', '....#......#....', '....########....', '................'],
    security:   ['................', '..#############.', '..#############.', '..#############.', '..#############.', '..#####..######.', '..###.......###.', '..###.......###.', '..#####..######.', '..#####..######.', '...###########..', '....#########...', '......#####.....', '.......###......', '........#.......', '................'],
    piu:        ['................', '................', '................', '................', '................', '................', '................', '..###..###..###.', '..###..###..###.', '..###..###..###.', '................', '................', '................', '................', '................', '................'],
    cerca:      ['................', '................', '.....###........', '....#####.......', '...#######......', '..###...###.....', '..###...###.....', '..###...###.....', '...#######......', '....#######.....', '.....###.###....', '..........###...', '...........###..', '............###.', '.............###', '..............#.'],
    chiudi:     ['................', '................', '..##.........##.', '..###.......##..', '...###.....##...', '....###...##....', '.....###.##.....', '......####......', '.......###......', '......#####.....', '.....##..###....', '....##....###...', '...##......###..', '..##........###.', '..#..........#..', '................'],
    backup:     ['................', '.......##.......', '.......##.......', '.......##.......', '.......##.......', '.......##.......', '....##.##.##....', '.....######.....', '......####......', '.......##.......', '..############..', '..#..........#..', '..#..........#..', '..#..........#..', '..############..', '................'],
    esci:       ['................', '................', '..#######.......', '..#.....#.......', '..#.....#.##....', '..#.....#..##...', '..#.....#...##..', '..#.....#.#####.', '..#.....#.#####.', '..#.....#...##..', '..#.....#..##...', '..#.....#.##....', '..#.....#.......', '..#######.......', '................', '................'],
  };

  function icona(nome) {
    const bitmap = ICONS[nome];
    if (!bitmap) return '';
    let rects = '';
    bitmap.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (row[x] === '#') rects += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
      }
    });
    return `<svg class="icon" viewBox="0 0 16 16" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
  }

  // Elenco unico delle sezioni: da qui nascono sia il menu laterale del
  // computer sia la barra in basso e il foglio del telefono, cosi' non possono
  // piu' andare fuori sincrono.
  const SECTIONS = [
    { view: 'flusso', label: 'Flusso', tab: true },
    { view: 'ideas', label: 'Idee', tab: true },
    { view: 'projects', label: 'Progetti', tab: true },
    { view: 'vault', label: 'Vault', tab: true },
    { view: 'accounts', label: 'Abbonamenti', tab: true },
    { view: 'drive', label: 'Drive', tab: true },
    { view: 'dossiers', label: 'Fascicoli', tab: true },
    { view: 'trash', label: 'Cestino', tab: true },
    { view: 'security', label: 'Sicurezza', tab: true },
  ];

  const nav = document.getElementById('nav');
  const viewRoot = document.getElementById('view-root');
  const tabbar = document.getElementById('tabbar');
  const sheet = document.getElementById('sheet');
  const sheetBackdrop = document.getElementById('sheet-backdrop');

  // Menu laterale (schermo largo): raggruppato Flusso / Fascicoli / Archivi.
  // Tabbar e foglio restano piatti (SECTIONS), invariati sotto.
  const FLUSSO_FILTERS = [
    { filter: 'oggi', label: 'oggi' },
    { filter: 'settimana', label: 'questa settimana' },
    { filter: 'senza-fascicolo', label: 'senza fascicolo' },
  ];

  const flussoSection = SECTIONS.find((s) => s.view === 'flusso');
  const flussoGroup = el('<div class="sidebar-group"></div>');
  flussoGroup.appendChild(el('<div class="sidebar-group-title">Flusso</div>'));
  flussoGroup.appendChild(el(`
    <button class="nav-item" data-view="flusso">${icona('flusso')}<span>${esc(flussoSection.label)}</span></button>
  `));
  FLUSSO_FILTERS.forEach((f) => {
    const row = el(`<button class="sub-nav-item" data-filter="${f.filter}"><span>${esc(f.label)}</span></button>`);
    row.addEventListener('click', () => { closeSheet(); render('flusso', { filter: f.filter }); });
    flussoGroup.appendChild(row);
  });
  nav.appendChild(flussoGroup);

  const fascicoliGroup = el('<div class="sidebar-group"></div>');
  fascicoliGroup.appendChild(el('<div class="sidebar-group-title">Fascicoli</div>'));
  const dossierTree = el('<div id="sidebar-dossier-tree"></div>');
  fascicoliGroup.appendChild(dossierTree);
  nav.appendChild(fascicoliGroup);

  // Conteggi per tipo mostrati sotto ogni fascicolo espanso.
  const TREE_TYPE_LABELS = { document: 'documenti', idea: 'idee', project: 'progetti', account: 'account', vault: 'vault', reminder: 'scadenze' };
  // Sezione in cui vive ciascun tipo di elemento collegato a un fascicolo:
  // usata per aprire l'elemento cliccandolo, invece di poterlo solo scollegare.
  const TYPE_TO_VIEW = { document: 'drive', idea: 'ideas', project: 'projects', account: 'accounts', vault: 'vault', reminder: 'flusso', dossier: 'dossiers' };
  const expandedDossiers = new Set();

  async function refreshSidebarDossiers() {
    let dossiers;
    try { dossiers = await api('/dossiers'); } catch (err) { return; }
    dossierTree.innerHTML = '';
    if (!dossiers.length) {
      dossierTree.appendChild(el('<div class="tree-empty">Nessun fascicolo ancora.</div>'));
      return;
    }
    dossiers.forEach((d) => {
      const wrap = el('<div></div>');
      const open = expandedDossiers.has(d.id);
      const row = el(`
        <button type="button" class="tree-dossier">
          <span class="tree-dossier-toggle ${open ? 'open' : ''}">▸</span>
          <span class="tree-dossier-dot">◆</span>
          <span class="tree-dossier-label">${esc(d.title)}</span>
          <span class="tree-dossier-count">${d.items.length}</span>
        </button>
      `);
      const subWrap = el(`<div class="${open ? '' : 'hidden'}"></div>`);
      const groups = {};
      d.items.forEach((it) => { (groups[it.type] = groups[it.type] || []).push(it); });
      const groupKeys = Object.keys(groups);
      if (!groupKeys.length) {
        subWrap.appendChild(el('<div class="tree-empty">Nessun elemento collegato.</div>'));
      } else {
        groupKeys.forEach((type) => {
          const subRow = el(`
            <button type="button" class="tree-sub">
              <span class="tree-sub-dot">·</span><span>${esc(TREE_TYPE_LABELS[type] || type)}</span>
              <span class="tree-sub-count">${groups[type].length}</span>
            </button>
          `);
          subRow.addEventListener('click', () => { closeSheet(); render('dossiers', { highlight: d.id }); });
          subWrap.appendChild(subRow);
        });
      }
      row.querySelector('.tree-dossier-toggle').addEventListener('click', (e) => {
        e.stopPropagation();
        const nowHidden = subWrap.classList.toggle('hidden');
        row.querySelector('.tree-dossier-toggle').classList.toggle('open', !nowHidden);
        if (nowHidden) expandedDossiers.delete(d.id); else expandedDossiers.add(d.id);
      });
      row.addEventListener('click', () => { closeSheet(); render('dossiers', { highlight: d.id }); });
      wrap.appendChild(row);
      wrap.appendChild(subWrap);
      dossierTree.appendChild(wrap);
    });
  }

  const archiviGroup = el('<div class="sidebar-group"></div>');
  archiviGroup.appendChild(el('<div class="sidebar-group-title">Archivi</div>'));
  SECTIONS.filter((s) => s.view !== 'flusso').forEach((s) => {
    archiviGroup.appendChild(el(`
      <button class="nav-item" data-view="${s.view}">${icona(s.view)}<span>${esc(s.label)}</span></button>
    `));
  });
  nav.appendChild(archiviGroup);

  // Barra in basso (telefono): le sezioni piu' usate piu' "Altro"
  SECTIONS.filter((s) => s.tab).forEach((s) => {
    tabbar.appendChild(el(`
      <button class="tab-item" data-view="${s.view}">${icona(s.view)}<span>${esc(s.label)}</span></button>
    `));
  });
  const tabPiu = el(`<button class="tab-item" id="tab-piu">${icona('piu')}<span>Altro</span></button>`);
  tabbar.appendChild(tabPiu);

  // Foglio con l'elenco completo, cosi' nessuna sezione resta difficile da trovare
  function buildSheet() {
    sheet.innerHTML = '';
    sheet.appendChild(el('<div class="sheet-handle" aria-hidden="true"></div>'));
    sheet.appendChild(el('<h3 class="sheet-title">Tutte le sezioni</h3>'));
    const list = el('<div class="sheet-list"></div>');
    SECTIONS.forEach((s) => {
      list.appendChild(el(`
        <button class="sheet-item" data-view="${s.view}">${icona(s.view)}<span>${esc(s.label)}</span></button>
      `));
    });
    sheet.appendChild(list);

    const azioni = el('<div class="sheet-list sheet-actions"></div>');
    azioni.appendChild(el(`
      <a class="sheet-item" href="/api/backup" target="_blank" rel="noopener">${icona('backup')}<span>Esporta backup</span></a>
    `));
    const esci = el(`<button class="sheet-item" data-logout>${icona('esci')}<span>Esci</span></button>`);
    esci.addEventListener('click', logout);
    azioni.appendChild(esci);
    sheet.appendChild(azioni);
  }
  buildSheet();

  function openSheet() {
    sheetBackdrop.classList.remove('hidden');
    document.body.classList.add('no-scroll');
  }
  function closeSheet() {
    sheetBackdrop.classList.add('hidden');
    document.body.classList.remove('no-scroll');
  }

  tabPiu.addEventListener('click', openSheet);
  sheetBackdrop.addEventListener('click', (e) => { if (e.target === sheetBackdrop) closeSheet(); });

  // Un solo gestore per menu laterale, barra in basso e foglio.
  [nav, tabbar, sheet].forEach((contenitore) => {
    contenitore.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-view]');
      if (!btn) return;
      closeSheet();
      render(btn.dataset.view);
    });
  });

  function setActiveNav(view, opts = {}) {
    document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    document.querySelectorAll('.sub-nav-item').forEach((b) => {
      b.classList.toggle('active', view === 'flusso' && !!opts.filter && b.dataset.filter === opts.filter);
    });
    // Se la sezione attiva non e' fra quelle della barra, resta evidenziato "Altro".
    tabPiu.classList.toggle('active', !SECTIONS.some((s) => s.tab && s.view === view));
  }

  // ---------------- Breadcrumb + tab di vista ----------------
  const crumbbar = document.getElementById('crumbbar');
  const VIEW_LABELS = Object.fromEntries(SECTIONS.map((s) => [s.view, s.label.toLowerCase()]));
  const FLUSSO_FILTER_LABELS = { oggi: 'oggi', settimana: 'questa settimana', 'senza-fascicolo': 'senza fascicolo' };
  const VIEW_TABS = [
    { key: 'flusso', label: 'flusso' },
    { key: 'tabella', label: 'tabella' },
    { key: 'bacheca', label: 'bacheca' },
    { key: 'orbita', label: 'orbita' },
  ];

  function updateCrumb(view, opts = {}) {
    crumbbar.innerHTML = '';
    const path = el('<div class="crumb-path"></div>');
    path.appendChild(el('<span>~</span>'));
    path.appendChild(el('<span class="crumb-sep">/</span>'));
    path.appendChild(el(`<span${opts.filter ? '' : ' class="crumb-current"'}>${esc(VIEW_LABELS[view] || view)}</span>`));
    if (view === 'flusso' && opts.filter) {
      path.appendChild(el('<span class="crumb-sep">/</span>'));
      path.appendChild(el(`<span class="crumb-current">${esc(FLUSSO_FILTER_LABELS[opts.filter] || opts.filter)}</span>`));
    }
    crumbbar.appendChild(path);

    if (view === 'flusso') {
      const activeTab = opts.tab || 'flusso';
      const tabs = el('<div class="view-tabs"></div>');
      VIEW_TABS.forEach((t) => {
        const btn = el(`<button type="button" class="view-tab ${t.key === activeTab ? 'active' : ''}">${esc(t.label)}</button>`);
        btn.addEventListener('click', () => {
          if (t.key === activeTab) return;
          render('flusso', { filter: opts.filter, tab: t.key === 'flusso' ? undefined : t.key });
        });
        tabs.appendChild(btn);
      });
      crumbbar.appendChild(tabs);
    }
  }

  const views = {}; // popolate piu' sotto

  // Chiusura del menu "/", "@", "#" del composer al click fuori: un solo
  // listener sul documento, riassegnato da views.flusso ad ogni render.
  // Prima veniva registrato un nuovo listener ad ogni visita del Flusso e
  // non veniva mai rimosso, accumulandosi per tutta la sessione.
  let composerMenuOutsideClick = null;
  document.addEventListener('click', (e) => {
    if (composerMenuOutsideClick) composerMenuOutsideClick(e);
  });

  async function render(view, opts = {}) {
    setActiveNav(view, opts);
    updateCrumb(view, opts);
    viewRoot.innerHTML = '';
    const loading = el('<div class="empty-state">Carico…</div>');
    viewRoot.appendChild(loading);
    try {
      await views[view](viewRoot, opts);
    } catch (err) {
      viewRoot.innerHTML = '';
      viewRoot.appendChild(el(`<div class="empty-state">Errore: ${esc(err.message)}</div>`));
    }
    refreshNavCounts();
  }

  // ---------------- Contatori nel menu laterale ----------------
  // Chiamata ad ogni render(): dato lo scopo personale dell'app i volumi sono
  // piccoli, quindi qualche chiamata in piu' per tenere i numeri aggiornati
  // dopo ogni creazione/eliminazione e' un compromesso ragionevole.
  async function refreshNavCounts() {
    refreshSidebarDossiers();
    let ideas, projects, vault, accounts, docs, dossiers, trash;
    try {
      [ideas, projects, vault, accounts, docs, dossiers, trash] = await Promise.all([
        api('/ideas'), api('/projects'), api('/vault'), api('/accounts'), api('/drive'),
        api('/dossiers'), api('/trash'),
      ]);
    } catch (err) {
      return; // chrome non critico: se fallisce lasciamo lo stato precedente
    }
    const counts = {
      ideas: ideas.length, projects: projects.length, vault: vault.length,
      accounts: accounts.length, drive: docs.length, dossiers: dossiers.length, trash: trash.length,
    };
    document.querySelectorAll('.nav-item[data-view]').forEach((btn) => {
      const c = counts[btn.dataset.view];
      let badge = btn.querySelector('.nav-count');
      if (c === undefined) { if (badge) badge.remove(); return; }
      if (!badge) { badge = el('<span class="nav-count"></span>'); btn.appendChild(badge); }
      badge.textContent = c;
    });
  }

  // ---------------- Collegamento a fascicolo (riutilizzabile) ----------------
  async function openLinkToDossierModal(itemType, itemId, itemLabel) {
    const dossiers = await api('/dossiers');
    const wrap = el('<div></div>');
    if (!dossiers.length) {
      wrap.appendChild(el('<p class="card-sub">Non hai ancora nessun fascicolo. Creane uno dalla sezione Fascicoli.</p>'));
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
    openModal('Collega a un fascicolo', wrap);
  }

  // ==================================================================
  // FLUSSO (composer + feed unico, con scadenze/fascicoli/statistiche a lato)
  // ==================================================================
  function dayLabel(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    const startOf = (dt) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
    const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
    const giorni = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
    if (diffDays === 0) return `OGGI · ${giorni[d.getDay()].toUpperCase()} ${d.getDate()}`;
    if (diffDays === 1) return 'IERI';
    return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' }).toUpperCase();
  }

  function fmtTime(dateStr) {
    try { return new Date(dateStr).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return ''; }
  }

  const FLUSSO_API_TYPE = { idea: 'idea', progetto: 'project', account: 'account', documento: 'document', scadenza: 'reminder' };
  // Percorso REST (e vista di destinazione) per ciascun tipo di elemento del flusso:
  // "documento" e' l'unico dove il nome del tipo non coincide col nome della sezione/rotta.
  // "scadenza" non ha una sezione propria: vive solo nel flusso.
  const FLUSSO_SECTION = { idea: 'ideas', progetto: 'projects', account: 'accounts', documento: 'drive', scadenza: 'reminders' };

  function entryLabel(item) {
    return item.title || item.service || item.display_name || item.original_name || item.label || '';
  }

  // Evidenzia i "#tag" dentro un testo gia' passato da escTrim/esc (sicuro:
  // i caratteri delle entita' HTML non fanno parte di \w, quindi non si spezzano).
  function hashtagify(escapedStr) {
    return escapedStr.replace(/#([a-zA-Z0-9_-]+)/g, '<span class="entry-hashtag">#$1</span>');
  }

  // Riusata sia dalle card del flusso sia dalla Vista Tabella: apre il modo di
  // modifica giusto per ciascun tipo di elemento (idea/scadenza inline, gli
  // altri hanno la loro sezione dedicata).
  function editFlussoEntry(item) {
    if (item.kind === 'idea') {
      const form = ideaModal(item);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const tags = parseTags(form);
        await api(`/ideas/${item.id}`, { method: 'PUT', body: JSON.stringify({ title: form.title.value, body: form.body.value, tags }) });
        closeModal(); toast('Idea aggiornata'); render('flusso');
      });
      form.querySelector('[data-cancel]').addEventListener('click', closeModal);
      openModal('Modifica idea', form);
    } else if (item.kind === 'scadenza') {
      const form = reminderModal(item);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await api(`/reminders/${item.id}`, { method: 'PUT', body: JSON.stringify({ label: form.label.value, date: form.date.value, notes: form.notes.value }) });
        closeModal(); toast('Scadenza aggiornata'); render('flusso');
      });
      form.querySelector('[data-cancel]').addEventListener('click', closeModal);
      openModal('Modifica scadenza', form);
    } else {
      // account/progetto/documento: la modifica completa vive gia' nella loro sezione.
      render(FLUSSO_SECTION[item.kind]);
    }
  }

  async function deleteFlussoEntry(item) {
    if (!confirm('Spostare questo elemento nel cestino?')) return;
    await api(`/${FLUSSO_SECTION[item.kind]}/${item.id}`, { method: 'DELETE' });
    toast('Spostato nel cestino'); render('flusso');
  }

  function renderEntryCard(item, linkIndex) {
    const apiType = FLUSSO_API_TYPE[item.kind];
    const links = linkIndex.get(`${apiType}:${item.id}`) || [];

    const card = el('<div class="entry-block"></div>');
    const body = el('<div class="entry-card-body"></div>');
    body.appendChild(el(`
      <div class="entry-meta">
        <span class="entry-type">[${esc(item.kind)}]</span>
        <span class="entry-time">${fmtTime(item.created_at)}</span>
        ${links[0] ? `<span class="entry-fascicolo">◆ ${esc(links[0].title)}</span>` : ''}
      </div>
    `));

    if (item.kind === 'idea') {
      body.appendChild(el(`<div class="entry-text">${hashtagify(escTrim(item.body || item.title, 260))}</div>`));
      if ((item.tags || []).length) {
        body.appendChild(el(`<div class="tag-row" style="margin-top:9px">${item.tags.map((t) => `<span class="tag tag-neutral">${esc(t)}</span>`).join('')}</div>`));
      }
    } else if (item.kind === 'documento') {
      body.appendChild(el(`<div class="entry-text">Caricato: ${escTrim(item.display_name || item.original_name, 160)}</div>`));
      const ext = (item.original_name.includes('.') ? item.original_name.split('.').pop() : '').toUpperCase().slice(0, 4);
      const previewable = PREVIEWABLE_MIME.has(item.mime);
      const isImage = (item.mime || '').startsWith('image/');
      const docBox = el(`
        <div class="entry-doc${previewable ? ' entry-doc-clickable' : ''}">
          ${isImage
            ? `<img class="entry-doc-thumb" src="/api/drive/${item.id}/view" alt="" />`
            : `<span class="entry-doc-ext">${esc(ext || 'FILE')}</span>`}
          <div style="flex:1;min-width:0">
            <div class="entry-doc-name">${esc(item.display_name || item.original_name)}</div>
            ${item.display_name ? `<div class="entry-doc-original">${esc(item.original_name)}</div>` : ''}
            <div class="entry-doc-meta">${fmtSize(item.size)}${item.folder ? ' · ' + esc(item.folder) : ''}</div>
          </div>
        </div>
      `);
      if (previewable) docBox.addEventListener('click', () => openDocumentPreview(item));
      body.appendChild(docBox);
    } else if (item.kind === 'progetto') {
      body.appendChild(el(`<div class="entry-text">${esc(item.title)}${item.deadline ? ' — scade ' + fmtDate(item.deadline) : ''}</div>`));
      const { done, total } = checklistProgress(item.checklist);
      if (total) {
        const pct = Math.round((done / total) * 100);
        body.appendChild(el(`
          <div class="entry-progress">
            <div class="entry-progress-track"><div class="entry-progress-fill" style="width:${pct}%"></div></div>
            <span class="entry-progress-label">${done}/${total}</span>
          </div>
        `));
      } else {
        body.appendChild(el(`<span class="status-pill status-${item.status}" style="margin-top:6px">${item.status.replace('_', ' ')}</span>`));
      }
    } else if (item.kind === 'account') {
      body.appendChild(el(`<div class="entry-text">${esc(item.service)}${item.renewal_date ? ' — rinnovo ' + fmtDate(item.renewal_date) : ''}</div>`));
    } else if (item.kind === 'scadenza') {
      body.appendChild(el(`<div class="entry-text">${esc(item.label)}${item.date ? ' — scade ' + fmtDate(item.date) : ''}</div>`));
      if (item.notes) body.appendChild(el(`<div class="card-sub" style="margin-top:6px">${escTrim(item.notes, 160)}</div>`));
    }
    card.appendChild(body);

    const actions = el('<div class="entry-actions"></div>');
    const collega = el('<button type="button">Collega</button>');
    collega.addEventListener('click', () => openLinkToDossierModal(apiType, item.id, entryLabel(item)));
    actions.appendChild(collega);

    const modifica = el('<button type="button">Modifica</button>');
    modifica.addEventListener('click', () => editFlussoEntry(item));
    actions.appendChild(modifica);

    const elimina = el('<button type="button">Elimina</button>');
    elimina.addEventListener('click', () => deleteFlussoEntry(item));
    actions.appendChild(elimina);

    if (links.length) {
      actions.appendChild(el(`<span class="entry-actions-meta">${links.length} collegament${links.length === 1 ? 'o' : 'i'}</span>`));
    } else if (item.kind === 'documento') {
      actions.appendChild(el(`<a href="/api/drive/${item.id}/download" class="entry-actions-meta" style="text-decoration:none">apri</a>`));
    }
    card.appendChild(actions);
    return card;
  }

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

  // ---- Vista Tabella: stessi elementi del flusso (stesso filtro attivo), come elenco ----
  function renderFlussoTabella(root, entries, linkIndex) {
    if (!entries.length) {
      root.appendChild(el('<div class="empty-state">Nessun elemento da mostrare.</div>'));
      return;
    }
    const wrap = el('<div class="table-scroll"></div>');
    const table = el(`
      <table class="data-table">
        <thead><tr><th>Tipo</th><th>Testo</th><th>Quando</th><th>Fascicolo</th><th></th></tr></thead>
        <tbody></tbody>
      </table>
    `);
    const tbody = table.querySelector('tbody');
    // Un <tr> costruito da solo con el() viene scartato dal parser HTML (fuori
    // da un <table> non e' un elemento valido): le righe vanno scritte tutte
    // insieme dentro il <tbody>, che e' gia' nel contesto giusto.
    tbody.innerHTML = entries.map((item) => {
      const apiType = FLUSSO_API_TYPE[item.kind];
      const links = linkIndex.get(`${apiType}:${item.id}`) || [];
      return `
        <tr>
          <td class="dt-type">[${esc(item.kind)}]</td>
          <td class="dt-label">${esc(entryLabel(item))}</td>
          <td class="dt-date">${fmtTime(item.created_at)}</td>
          <td class="dt-fascicolo">${links[0] ? esc(links[0].title) : '—'}</td>
          <td class="dt-actions"><button type="button" data-del title="Elimina">✕</button></td>
        </tr>
      `;
    }).join('');
    [...tbody.children].forEach((row, i) => {
      const item = entries[i];
      row.addEventListener('click', (e) => {
        if (e.target.closest('[data-del]')) return;
        editFlussoEntry(item);
      });
      row.querySelector('[data-del]').addEventListener('click', (e) => { e.stopPropagation(); deleteFlussoEntry(item); });
    });
    wrap.appendChild(table);
    root.appendChild(wrap);
  }

  // ---- Vista Bacheca: i progetti in kanban, spostabili tra gli stati che hanno gia' ----
  function renderFlussoBacheca(root, projects) {
    const header = el('<div class="view-header-actions" style="margin-bottom:14px;justify-content:flex-end"><button class="btn btn-primary" id="bacheca-new-project">+ Nuovo progetto</button></div>');
    header.querySelector('#bacheca-new-project').addEventListener('click', () => {
      const form = projectModal();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const tags = parseTags(form);
        const contacts = parseContacts(form);
        const budget = parseBudgetLines(form.budget.value);
        const checklist = collectChecklist(form, []);
        await api('/projects', { method: 'POST', body: JSON.stringify({ title: form.title.value, description: form.description.value, status: form.status.value, deadline: form.deadline.value || null, checklist, contacts, budget, tags }) });
        closeModal(); toast('Progetto creato'); render('flusso', { tab: 'bacheca' });
      });
      form.querySelector('[data-cancel]').addEventListener('click', closeModal);
      openModal('Nuovo progetto', form);
    });
    root.appendChild(header);

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
        const card = el(`
          <div class="board-card">
            <p class="board-card-title">${esc(p.title)}</p>
            ${total ? `<p class="card-sub">${done}/${total} completati</p>` : ''}
            <div class="board-card-actions">
              <button type="button" data-prev ${i === 0 ? 'disabled' : ''} title="Sposta indietro">←</button>
              <button type="button" data-edit title="Apri">Apri</button>
              <button type="button" data-next ${i === STATUSES.length - 1 ? 'disabled' : ''} title="Sposta avanti">→</button>
            </div>
          </div>
        `);
        async function moveTo(newStatus) {
          await api(`/projects/${p.id}`, { method: 'PUT', body: JSON.stringify({ status: newStatus }) });
          render('flusso', { tab: 'bacheca' });
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
            closeModal(); toast('Progetto aggiornato'); render('flusso', { tab: 'bacheca' });
          });
          form.querySelector('[data-cancel]').addEventListener('click', closeModal);
          openModal('Modifica progetto', form);
        });
        body.appendChild(card);
      });
      board.appendChild(col);
    });
    root.appendChild(board);
  }

  // ---- Vista Orbita: grafo dei fascicoli e di cio' che collegano, stile
  // "graph view" di Obsidian. Simulazione a molle scritta a mano (repulsione
  // fra tutti i nodi + attrazione lungo i collegamenti + gravita' verso il
  // centro): niente libreria esterna, coerente col resto del progetto. ----
  function renderFlussoOrbita(root, dossiers) {
    const wrap = el(`
      <div class="orbit-wrap">
        <svg class="orbit-svg"></svg>
        <p class="card-sub" style="margin-top:8px">Trascina un nodo per spostarlo, rotellina per zoomare, trascina lo sfondo per spostare la vista, click su un nodo per aprirlo.</p>
      </div>
    `);
    root.appendChild(wrap);
    const svg = wrap.querySelector('.orbit-svg');

    const nodes = [];
    const nodeIndex = new Map();
    const edges = [];
    const NS = 'http://www.w3.org/2000/svg';

    dossiers.forEach((d) => {
      const node = {
        key: `dossier:${d.id}`, kind: 'dossier', view: 'dossiers', id: d.id, label: d.title,
        x: 0, y: 0, vx: 0, vy: 0, r: 12 + Math.min(d.items.length, 10) * 1.4,
      };
      nodes.push(node);
      nodeIndex.set(node.key, node);
    });
    dossiers.forEach((d) => {
      d.items.forEach((item) => {
        const key = `${item.type}:${item.id}`;
        let node = nodeIndex.get(key);
        if (!node) {
          node = { key, kind: item.type, view: TYPE_TO_VIEW[item.type] || 'flusso', id: item.id, label: item.label, x: 0, y: 0, vx: 0, vy: 0, r: 8 };
          nodes.push(node);
          nodeIndex.set(key, node);
        }
        edges.push({ a: nodeIndex.get(`dossier:${d.id}`), b: node });
      });
    });

    if (!nodes.length) {
      wrap.innerHTML = '<div class="empty-state">Nessuna connessione ancora: collega qualche elemento a un fascicolo per vederla qui.</div>';
      return;
    }

    // Posizioni iniziali su un cerchio, cosi' non partono tutte sovrapposte nello stesso punto.
    const W = 800, H = 560;
    nodes.forEach((n, i) => {
      const angle = (i / nodes.length) * Math.PI * 2;
      n.x = W / 2 + Math.cos(angle) * 220;
      n.y = H / 2 + Math.sin(angle) * 220;
    });

    const view = { x: 0, y: 0, w: W, h: H };
    function applyViewBox() { svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`); }
    applyViewBox();

    const g = document.createElementNS(NS, 'g');
    svg.appendChild(g);
    const edgeEls = edges.map(() => {
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('class', 'orbit-edge');
      g.appendChild(line);
      return line;
    });
    const nodeEls = nodes.map((n) => {
      const nodeG = document.createElementNS(NS, 'g');
      nodeG.setAttribute('class', `orbit-node orbit-node-${n.kind === 'dossier' ? 'dossier' : 'item'}`);
      const circle = document.createElementNS(NS, 'circle');
      circle.setAttribute('r', n.r);
      const text = document.createElementNS(NS, 'text');
      text.setAttribute('class', 'orbit-label');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('y', n.r + 12);
      text.textContent = n.label.length > 20 ? n.label.slice(0, 19) + '…' : n.label;
      nodeG.appendChild(circle);
      nodeG.appendChild(text);
      g.appendChild(nodeG);
      return nodeG;
    });

    // ---- interazione: trascina un nodo (fermo mentre lo tieni), clicca per aprirlo ----
    let dragging = null;
    let moved = false;
    function svgPoint(evt) {
      const pt = svg.createSVGPoint();
      pt.x = evt.clientX;
      pt.y = evt.clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return { x: 0, y: 0 };
      const p = pt.matrixTransform(ctm.inverse());
      return { x: p.x, y: p.y };
    }
    nodeEls.forEach((nodeG, i) => {
      const n = nodes[i];
      nodeG.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        dragging = n;
        moved = false;
        nodeG.setPointerCapture(e.pointerId);
      });
      nodeG.addEventListener('pointermove', (e) => {
        if (dragging !== n) return;
        const p = svgPoint(e);
        n.x = p.x; n.y = p.y; n.vx = 0; n.vy = 0;
        moved = true;
      });
      nodeG.addEventListener('pointerup', () => {
        dragging = null;
        if (!moved) render(n.view, { highlight: n.id });
      });
    });

    // ---- sfondo: trascina per spostare la vista, rotellina per zoomare ----
    let panStart = null;
    svg.addEventListener('pointerdown', (e) => {
      if (e.target !== svg) return;
      panStart = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    });
    window.addEventListener('pointermove', (e) => {
      if (!panStart) return;
      const scale = view.w / svg.clientWidth;
      view.x = panStart.vx - (e.clientX - panStart.x) * scale;
      view.y = panStart.vy - (e.clientY - panStart.y) * scale;
      applyViewBox();
    });
    window.addEventListener('pointerup', () => { panStart = null; });
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.1 : 0.9;
      const newW = Math.min(Math.max(view.w * factor, 200), 3000);
      const newH = newW * (H / W);
      view.x += (view.w - newW) / 2;
      view.y += (view.h - newH) / 2;
      view.w = newW; view.h = newH;
      applyViewBox();
    }, { passive: false });

    // ---- simulazione: repulsione fra tutti i nodi + molla lungo gli archi + gravita' verso il centro ----
    const REPULSION = 12000, SPRING_LENGTH = 90, SPRING_K = 0.02, DAMPING = 0.82, CENTER_K = 0.0005;
    function tick() {
      if (!document.body.contains(svg)) return; // vista lasciata: si ferma da sola

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const distSq = Math.max(dx * dx + dy * dy, 1);
          const dist = Math.sqrt(distSq);
          const force = REPULSION / distSq;
          const fx = (dx / dist) * force, fy = (dy / dist) * force;
          if (a !== dragging) { a.vx += fx; a.vy += fy; }
          if (b !== dragging) { b.vx -= fx; b.vy -= fy; }
        }
      }
      edges.forEach(({ a, b }) => {
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const force = (dist - SPRING_LENGTH) * SPRING_K;
        const fx = (dx / dist) * force, fy = (dy / dist) * force;
        if (a !== dragging) { a.vx += fx; a.vy += fy; }
        if (b !== dragging) { b.vx -= fx; b.vy -= fy; }
      });
      nodes.forEach((n) => {
        if (n === dragging) return;
        n.vx += (W / 2 - n.x) * CENTER_K;
        n.vy += (H / 2 - n.y) * CENTER_K;
        n.vx *= DAMPING; n.vy *= DAMPING;
        n.x += n.vx; n.y += n.vy;
      });

      nodeEls.forEach((nodeG, i) => nodeG.setAttribute('transform', `translate(${nodes[i].x},${nodes[i].y})`));
      edgeEls.forEach((line, i) => {
        line.setAttribute('x1', edges[i].a.x); line.setAttribute('y1', edges[i].a.y);
        line.setAttribute('x2', edges[i].b.x); line.setAttribute('y2', edges[i].b.y);
      });
      requestAnimationFrame(tick);
    }
    tick();
  }

  views.flusso = async (root, opts = {}) => {
    // Oggi arriva qui solo per le scadenze (uniche col flusso come unica "casa"):
    // gli altri tipi hanno una sezione propria e usano il loro highlight interno.
    const highlightId = opts.highlight != null ? String(opts.highlight) : null;
    const [ideas, projects, accounts, documents, dossiers, upcoming, allReminders, vault] = await Promise.all([
      api('/ideas'), api('/projects'), api('/accounts'), api('/drive'),
      api('/dossiers'), api('/search/reminders/upcoming?days=45'), api('/reminders'), api('/vault'),
    ]);

    // Mappa elemento -> fascicoli a cui e' collegato: alimenta sia il chip
    // "◆ nome" sotto ogni voce del flusso sia le statistiche a lato.
    const linkIndex = new Map();
    dossiers.forEach((d) => {
      d.items.forEach((item) => {
        const key = `${item.type}:${item.id}`;
        if (!linkIndex.has(key)) linkIndex.set(key, []);
        linkIndex.get(key).push({ id: d.id, title: d.title });
      });
    });

    const allEntries = [
      ...ideas.map((x) => ({ kind: 'idea', ...x })),
      ...projects.map((x) => ({ kind: 'progetto', ...x })),
      ...accounts.map((x) => ({ kind: 'account', ...x })),
      ...documents.map((x) => ({ kind: 'documento', ...x })),
      ...allReminders.map((x) => ({ kind: 'scadenza', ...x })),
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Sotto-filtri della sidebar (Flusso > oggi / questa settimana / senza fascicolo).
    let entries = allEntries;
    if (opts.filter === 'oggi') {
      entries = entries.filter((x) => dayLabel(x.created_at).startsWith('OGGI'));
    } else if (opts.filter === 'settimana') {
      const weekAgo = Date.now() - 7 * 86400000;
      entries = entries.filter((x) => new Date(x.created_at).getTime() >= weekAgo);
    } else if (opts.filter === 'senza-fascicolo') {
      entries = entries.filter((x) => !linkIndex.has(`${FLUSSO_API_TYPE[x.kind]}:${x.id}`));
    }
    entries = entries.slice(0, 60);

    root.innerHTML = '';
    root.appendChild(el('<div class="view-header"><h2>Flusso</h2></div>'));

    if (opts.tab === 'tabella') { renderFlussoTabella(root, entries, linkIndex); return; }
    if (opts.tab === 'bacheca') { renderFlussoBacheca(root, projects); return; }
    if (opts.tab === 'orbita') { renderFlussoOrbita(root, dossiers); return; }

    const layout = el('<div class="flusso-layout"></div>');
    const main = el('<div></div>');
    const rail = el('<aside class="right-rail"></aside>');

    // ---- composer a blocco: "/" per il tipo, "@" per collegare un fascicolo ----
    let selectedDossier = null;
    const composer = el(`
      <div class="composer">
        <textarea id="flusso-text" placeholder="Scrivi un'idea — o / per un altro tipo, @ per un fascicolo, # per un tag" rows="2"></textarea>
        <div id="flusso-link-badge"></div>
        <div class="composer-row">
          <button type="button" class="chip" data-insert="/idea">/idea</button>
          <button type="button" class="chip" data-insert="/doc">/doc</button>
          <button type="button" class="chip" data-insert="/scadenza">/scadenza</button>
          <button type="button" class="chip" data-insert="/progetto">/progetto</button>
          <button type="button" class="chip chip-fascicolo" data-insert="@">@fascicolo</button>
          <button type="button" class="chip" data-insert="#">#tag</button>
          <button type="button" class="btn btn-primary" id="flusso-save">Salva</button>
        </div>
        <div class="composer-hint">
          <span><span class="kb">Ctrl</span>+<span class="kb">Invio</span> salva</span>
          <span>/ per il tipo · @ per collegare un fascicolo · # per un tag</span>
        </div>
      </div>
    `);
    const textarea = composer.querySelector('#flusso-text');
    const linkBadgeWrap = composer.querySelector('#flusso-link-badge');
    // Tag gia' usati nelle idee esistenti, suggeriti mentre si scrive "#".
    const knownTags = [...new Set(ideas.flatMap((x) => x.tags || []))].sort();

    function renderLinkBadge() {
      linkBadgeWrap.innerHTML = '';
      if (!selectedDossier) return;
      const badge = el(`<span class="composer-link-badge">→ ${esc(selectedDossier.title)} <button type="button" title="Rimuovi">✕</button></span>`);
      badge.querySelector('button').addEventListener('click', () => { selectedDossier = null; renderLinkBadge(); });
      linkBadgeWrap.appendChild(badge);
    }

    // ---- autocomplete /comandi e @fascicolo ----
    const COMMANDS = [
      { token: '/idea', desc: 'nota veloce' },
      { token: '/doc', desc: 'carica documento' },
      { token: '/scadenza', desc: 'nuovo promemoria' },
      { token: '/progetto', desc: 'nuovo progetto' },
    ];
    let menuEl = null;
    let menuItems = [];
    let menuActive = 0;
    let menuTrigger = null;

    function closeMenu() {
      if (menuEl) { menuEl.remove(); menuEl = null; }
      menuItems = [];
      menuTrigger = null;
    }

    function highlightMenu() {
      if (!menuEl) return;
      menuEl.querySelectorAll('.composer-menu-item').forEach((n, i) => n.classList.toggle('active', i === menuActive));
    }

    async function selectMenuItem(i) {
      const item = menuItems[i];
      const trigger = menuTrigger;
      closeMenu();
      if (!item || !trigger) return;

      if (trigger.type === '#') {
        // il tag e' testo vero e proprio: si completa restando nella frase,
        // non viene rimosso come i comandi "/" e le menzioni "@".
        const before = textarea.value.slice(0, trigger.start);
        const after = textarea.value.slice(trigger.end);
        const needsSpace = !/^\s/.test(after);
        textarea.value = before + item.token + (needsSpace ? ' ' : '') + after;
        const caret = before.length + item.token.length + (needsSpace ? 1 : 0);
        textarea.focus();
        textarea.setSelectionRange(caret, caret);
        return;
      }

      // rimuove il token digitato ("/xxx" o "@xxx") dal testo, mantenendo il resto
      const before = textarea.value.slice(0, trigger.start);
      const after = textarea.value.slice(trigger.end);
      textarea.value = before + after;
      const caret = before.length;
      textarea.focus();
      textarea.setSelectionRange(caret, caret);

      if (trigger.type === '@') {
        selectedDossier = item.dossier;
        renderLinkBadge();
        return;
      }
      if (item.token === '/idea') return; // e' gia' il tipo di default
      if (item.token === '/scadenza') {
        const form = reminderModal();
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          await api('/reminders', { method: 'POST', body: JSON.stringify({ label: form.label.value, date: form.date.value, notes: form.notes.value }) });
          closeModal(); toast('Scadenza salvata'); render('flusso', opts);
        });
        form.querySelector('[data-cancel]').addEventListener('click', closeModal);
        openModal('Nuova scadenza', form);
        return;
      }
      if (item.token === '/doc') {
        await render('drive');
        const btn = document.getElementById('new-doc');
        if (btn) btn.click();
        return;
      }
      if (item.token === '/progetto') {
        await render('projects');
        const btn = document.getElementById('new-project');
        if (btn) btn.click();
      }
    }

    function openMenu(items) {
      if (menuEl) { menuEl.remove(); menuEl = null; }
      if (!items.length) { menuItems = []; return; }
      menuItems = items;
      menuActive = 0;
      menuEl = el('<div class="composer-menu"></div>');
      items.forEach((it, i) => {
        const row = el(`
          <div class="composer-menu-item ${i === 0 ? 'active' : ''}">
            <span class="cmi-token">${esc(it.token)}</span><span class="cmi-desc">${esc(it.desc)}</span>
          </div>
        `);
        row.addEventListener('mousedown', (e) => { e.preventDefault(); selectMenuItem(i); });
        menuEl.appendChild(row);
      });
      composer.appendChild(menuEl);
    }

    function currentTrigger() {
      const pos = textarea.selectionStart;
      const upToCaret = textarea.value.slice(0, pos);
      const match = upToCaret.match(/(^|\s)([/@#][^\s]*)$/);
      if (!match) return null;
      const tokenStart = pos - match[2].length;
      return { type: match[2][0], query: match[2].slice(1).toLowerCase(), start: tokenStart, end: pos };
    }

    function updateMenu() {
      const trigger = currentTrigger();
      menuTrigger = trigger;
      if (!trigger) { closeMenu(); return; }
      if (trigger.type === '/') {
        openMenu(COMMANDS.filter((c) => c.token.slice(1).startsWith(trigger.query)));
      } else if (trigger.type === '@') {
        openMenu(
          dossiers
            .filter((d) => d.title.toLowerCase().includes(trigger.query))
            .map((d) => ({ token: '@' + d.title, desc: 'fascicolo', dossier: d }))
        );
      } else {
        openMenu(
          knownTags
            .filter((t) => t.toLowerCase().startsWith(trigger.query))
            .map((t) => ({ token: '#' + t, desc: 'tag' }))
        );
      }
    }

    textarea.addEventListener('input', updateMenu);
    textarea.addEventListener('click', updateMenu);
    textarea.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); saveEntry(); return; }
      if (!menuEl) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); menuActive = (menuActive + 1) % menuItems.length; highlightMenu(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); menuActive = (menuActive - 1 + menuItems.length) % menuItems.length; highlightMenu(); }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); selectMenuItem(menuActive); }
      else if (e.key === 'Escape') { closeMenu(); }
    });
    composerMenuOutsideClick = (e) => {
      if (menuEl && !composer.contains(e.target)) closeMenu();
    };

    // Chip sotto il testo: scorciatoie che inseriscono il trigger e aprono subito il menu.
    composer.querySelectorAll('[data-insert]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const insert = chip.dataset.insert;
        const pos = textarea.selectionStart;
        const needsSpace = pos > 0 && !/\s/.test(textarea.value[pos - 1] || '');
        const prefix = needsSpace ? ' ' : '';
        textarea.value = textarea.value.slice(0, pos) + prefix + insert + textarea.value.slice(pos);
        const caret = pos + prefix.length + insert.length;
        textarea.focus();
        textarea.setSelectionRange(caret, caret);
        updateMenu();
      });
    });

    let saving = false;
    async function saveEntry() {
      const text = textarea.value.trim();
      if (!text || saving) return;
      saving = true;
      const saveBtn = composer.querySelector('#flusso-save');
      saveBtn.disabled = true;
      try {
        const title = text.length > 80 ? text.slice(0, 80) + '…' : text;
        // I tag restano nel testo (come su Twitter/Notion): li estraiamo solo
        // per popolare il campo "tags" gia' usato altrove per filtrare/raggruppare.
        const tags = [...new Set((text.match(/#([a-zA-Z0-9_-]+)/g) || []).map((t) => t.slice(1)))];
        const idea = await api('/ideas', { method: 'POST', body: JSON.stringify({ title, body: text, tags }) });
        if (selectedDossier) {
          await api(`/dossiers/${selectedDossier.id}/links`, { method: 'POST', body: JSON.stringify({ item_type: 'idea', item_id: idea.id }) });
        }
        toast('Aggiunto al flusso');
        render('flusso', opts);
      } finally {
        saving = false;
        saveBtn.disabled = false;
      }
    }
    composer.querySelector('#flusso-save').addEventListener('click', saveEntry);
    main.appendChild(composer);

    // ---- feed ----
    if (!entries.length) {
      main.appendChild(el('<div class="empty-state">Il flusso e\' vuoto: scrivi qualcosa qui sopra.</div>'));
    } else {
      let lastLabel = null;
      entries.forEach((item) => {
        const label = dayLabel(item.created_at);
        if (label !== lastLabel) {
          main.appendChild(el(`<div class="day-label">${esc(label)}</div>`));
          lastLabel = label;
        }
        const card = renderEntryCard(item, linkIndex);
        // Solo le scadenze arrivano qui con un highlight (vedi TYPE_TO_VIEW):
        // e' l'unico tipo di elemento del flusso senza una sezione propria.
        if (highlightId && item.kind === 'scadenza' && String(item.id) === highlightId) card.classList.add('card-highlight');
        main.appendChild(card);
      });
    }
    layout.appendChild(main);
    if (highlightId) {
      const target = main.querySelector('.card-highlight');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // ---- right rail (statistiche sull'intero flusso, non sul sotto-filtro attivo) ----
    const deadlinesBlock = el('<div class="rail-block"><h6>Scadenze</h6></div>');
    if (!upcoming.length) {
      deadlinesBlock.appendChild(el('<p class="card-sub">Nessuna scadenza nei prossimi 45 giorni.</p>'));
    } else {
      upcoming.slice(0, 6).forEach((r) => {
        const days = Math.round((new Date(r.date) - new Date()) / 86400000);
        const cls = days < 0 ? 'overdue' : days <= 7 ? 'soon' : '';
        const row = el(`
          <button type="button" class="rail-deadline">
            <span class="rail-deadline-days ${cls}">${days < 0 ? days : '+' + days}</span>
            <span>${esc(r.label)}</span>
          </button>
        `);
        row.addEventListener('click', () => render(TYPE_TO_VIEW[r.type], { highlight: r.id }));
        deadlinesBlock.appendChild(row);
      });
    }
    rail.appendChild(deadlinesBlock);

    const dossiersBlock = el('<div class="rail-block"><h6>Fascicoli attivi</h6></div>');
    if (!dossiers.length) {
      dossiersBlock.appendChild(el('<p class="card-sub">Nessun fascicolo ancora.</p>'));
    } else {
      [...dossiers].sort((a, b) => b.items.length - a.items.length).slice(0, 6).forEach((d, i) => {
        const row = el(`
          <button type="button" class="rail-dossier ${i === 0 ? 'top' : ''}">
            <span class="rail-dossier-dot">◆</span><span class="rail-dossier-label">${esc(d.title)}</span><span class="rail-dossier-count">${d.items.length}</span>
          </button>
        `);
        row.addEventListener('click', () => render('dossiers', { highlight: d.id }));
        dossiersBlock.appendChild(row);
      });
    }
    rail.appendChild(dossiersBlock);

    const weekBlock = el('<div class="rail-block"><h6>Questa settimana</h6></div>');
    const weekAgo = Date.now() - 7 * 86400000;
    const recent = allEntries.filter((x) => new Date(x.created_at).getTime() >= weekAgo);
    const unlinked = allEntries.filter((x) => !linkIndex.has(`${FLUSSO_API_TYPE[x.kind]}:${x.id}`)).length;
    weekBlock.appendChild(el(`
      <div class="rail-stats">
        <div>${recent.filter((x) => x.kind === 'idea').length} note · ${recent.filter((x) => x.kind === 'documento').length} documenti</div>
        <div>${recent.filter((x) => x.kind === 'progetto').length} progetti mossi</div>
        <div>${unlinked} voci senza fascicolo</div>
      </div>
    `));
    rail.appendChild(weekBlock);

    const overviewBlock = el('<div class="rail-block"><h6>Panoramica</h6></div>');
    const overview = [
      ['Idee', 'ideas', ideas.length], ['Progetti', 'projects', projects.length], ['Voci vault', 'vault', vault.length],
      ['Abbonamenti', 'accounts', accounts.length], ['Documenti', 'drive', documents.length],
    ];
    overview.forEach(([label, view, count]) => {
      const row = el(`<button type="button" class="rail-dossier"><span class="rail-dossier-label">${esc(label)}</span><span class="rail-dossier-count">${count}</span></button>`);
      row.addEventListener('click', () => render(view));
      overviewBlock.appendChild(row);
    });
    rail.appendChild(overviewBlock);

    layout.appendChild(rail);
    root.appendChild(layout);
    textarea.focus();
  };

  // ==================================================================
  // IDEE
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
        <h2>Idee</h2>
        <div class="view-header-actions"><button class="btn btn-primary" id="new-idea">+ Nuova idea</button></div>
      </div>
    `));

    root.querySelector('#new-idea').addEventListener('click', () => {
      const form = ideaModal();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const tags = parseTags(form);
        await api('/ideas', { method: 'POST', body: JSON.stringify({ title: form.title.value, body: form.body.value, tags }) });
        closeModal(); toast('Idea salvata'); render('ideas');
      });
      form.querySelector('[data-cancel]').addEventListener('click', closeModal);
      openModal('Nuova idea', form);
    });

    if (!ideas.length) {
      root.appendChild(el('<div class="empty-state">Nessuna idea ancora. Butta giu\' la prima.</div>'));
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
            <button class="btn btn-sm" data-link>Fascicolo</button>
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
          closeModal(); toast('Idea aggiornata'); render('ideas');
        });
        form.querySelector('[data-cancel]').addEventListener('click', closeModal);
        openModal('Modifica idea', form);
      });
      card.querySelector('[data-link]').addEventListener('click', () => openLinkToDossierModal('idea', idea.id, idea.title));
      card.querySelector('[data-del]').addEventListener('click', async () => {
        if (!confirm('Spostare questa idea nel cestino?')) return;
        await api(`/ideas/${idea.id}`, { method: 'DELETE' });
        toast('Idea eliminata'); render('ideas');
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

    const grid = el('<div class="grid"></div>');
    projects.forEach((p) => {
      const { done, total } = checklistProgress(p.checklist);
      const total_budget = budgetTotal(p.budget);
      const card = el(`
        <div class="card">
          <span class="status-pill status-${p.status}">${p.status.replace('_', ' ')}</span>
          <p class="card-title">${esc(p.title)}</p>
          <p class="card-body">${escTrim(p.description, 160)}</p>
          ${p.deadline ? `<p class="card-sub">Scadenza: ${fmtDate(p.deadline)}</p>` : ''}
          ${total ? `<p class="card-sub">Checklist: ${done}/${total} completati</p>` : ''}
          ${(p.contacts || []).length ? `<p class="card-sub">Persone: ${esc(p.contacts.join(', '))}</p>` : ''}
          ${total_budget ? `<p class="card-sub">Budget: ${fmtMoney(total_budget)}</p>` : ''}
          <div class="tag-row">${(p.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
          <div class="card-actions">
            <button class="btn btn-sm" data-edit>Modifica</button>
            <button class="btn btn-sm" data-link>Fascicolo</button>
            <button class="btn btn-sm btn-danger" data-del>Elimina</button>
          </div>
        </div>
      `);
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
      grid.appendChild(card);
    });
    root.appendChild(grid);
    if (highlightId) {
      const target = grid.querySelector('.card-highlight');
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
        <div class="view-header-actions">
          <label class="btn btn-ghost" style="cursor:pointer">
            Importa CSV
            <input type="file" id="csv-input" accept=".csv" class="hidden" />
          </label>
          <button class="btn btn-primary" id="new-vault">+ Nuova voce</button>
        </div>
      </div>
      <p class="card-sub">L'import CSV riconosce colonne come site/name/title, username/login/email, password, url, notes.</p>
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
    entries.forEach((entry) => {
      const row = el(`
        <div class="vault-row row-card">
          <strong><span class="chip-type">${esc(TYPE_LABEL[entry.type] || entry.type)}</span> ${esc(entry.site)}</strong>
          <span>${esc(entry.username) || '—'}</span>
          <span class="password-field" data-pwd>${entry.type === 'note' ? '(nota sicura)' : '••••••••'}</span>
          <span class="card-actions" style="padding:0">
            ${entry.hasTotp ? '<button class="btn btn-sm" data-totp>Codice</button>' : ''}
            <button class="btn btn-sm" data-reveal>Mostra</button>
            <button class="btn btn-sm" data-edit>Modifica</button>
            <button class="btn btn-sm" data-link>Fascicolo</button>
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
      root.appendChild(row);
    });
    if (highlightId) {
      const target = root.querySelector('.card-highlight');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  // ==================================================================
  // ACCOUNT
  // ==================================================================
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
      form.renewal_date.value = existing.renewal_date ? existing.renewal_date.slice(0, 10) : '';
      form.notes.value = existing.notes;
      form.tags.value = (existing.tags || []).join(', ');
    }
    syncTypeFields();
    return form;
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
          ${a.renewal_date ? `<p class="card-sub">Rinnovo: ${fmtDate(a.renewal_date)}</p>` : ''}
          <div class="tag-row">${(a.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
          <div class="card-actions">
            <button class="btn btn-sm" data-edit>Modifica</button>
            <button class="btn btn-sm" data-link>Fascicolo</button>
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
            <button class="btn btn-sm" data-link>Fascicolo</button>
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
        <h2>Fascicoli</h2>
        <div class="view-header-actions"><button class="btn btn-primary" id="new-dossier">+ Nuovo fascicolo</button></div>
      </div>
      <p class="card-sub">Un fascicolo raccoglie insieme documenti, password, abbonamenti e idee legati allo stesso tema. Collega gli elementi dai loro pulsanti "Fascicolo".</p>
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
        closeModal(); toast('Fascicolo creato'); render('dossiers');
      });
      form.querySelector('[data-cancel]').addEventListener('click', closeModal);
      openModal('Nuovo fascicolo', form);
    });

    if (!dossiers.length) {
      root.appendChild(el('<div class="empty-state">Nessun fascicolo ancora.</div>'));
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
            <button class="btn btn-sm btn-danger" data-del>Elimina fascicolo</button>
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
        if (!confirm('Spostare questo fascicolo nel cestino? Gli elementi collegati non verranno eliminati.')) return;
        await api(`/dossiers/${d.id}`, { method: 'DELETE' });
        toast('Fascicolo eliminato'); render('dossiers');
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
  const TYPE_LABELS = { idea: 'Idea', project: 'Progetto', vault: 'Vault', account: 'Abbonamento', document: 'Documento', dossier: 'Fascicolo', reminder: 'Scadenza' };

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
  searchToggle.innerHTML = icona('cerca');
  searchToggle.addEventListener('click', () => {
    const aperta = topbar.classList.toggle('search-open');
    searchToggle.setAttribute('aria-expanded', String(aperta));
    searchToggle.innerHTML = icona(aperta ? 'chiudi' : 'cerca');
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
            render(TYPE_TO_VIEW[r.type] || 'flusso', { highlight: r.id });
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
