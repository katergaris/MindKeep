(() => {
  'use strict';

  // ---------------- Lingua ----------------
  const I18N = window.MindkeepI18n;
  const tr = I18N.t;

  // ---------------- PWA: cache del guscio per installabilita' e avvio offline ----------------
  // Se la registrazione fallisce (es. accesso in http semplice, senza
  // certificato: i service worker richiedono https) l'app funziona comunque,
  // solo senza installabilita' ne' cache offline.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

  // ---------------- Notifiche push (scadenze) ----------------
  // La chiave pubblica VAPID arriva codificata base64url (compatta, sicura
  // negli URL): PushManager.subscribe vuole invece un Uint8Array grezzo.
  function urlBase64ToUint8Array(base64) {
    const padding = '='.repeat((4 - (base64.length % 4)) % 4);
    const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }

  async function getPushSubscription() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }

  async function enablePushNotifications() {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error(tr('err_notification_permission_denied'));
    const { publicKey } = await api('/push/vapid-public-key');
    if (!publicKey) throw new Error(tr('err_server_key_unavailable'));
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    await api('/push/subscribe', { method: 'POST', body: JSON.stringify(sub.toJSON()) });
  }

  async function disablePushNotifications() {
    const sub = await getPushSubscription();
    if (!sub) return;
    await api('/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) });
    await sub.unsubscribe();
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
      throw new Error(tr('err_offline'));
    }
    // Un 401 sulle rotte di accesso e' una credenziale sbagliata, non una
    // sessione scaduta: va lasciato passare alla schermata di login, che sa
    // spiegare cosa manca (password errata, codice a due fattori, ...).
    if (res.status === 401 && !path.startsWith('/auth/')) {
      showAuthScreen();
      throw new Error(tr('err_session_expired'));
    }
    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch (e) { /* corpo vuoto */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || tr('err_unexpected'));
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

  // Tempo concreto invece della sola data (countdown, non solo calendario):
  // riusato da Scadenze e dalla scadenza dei Progetti in Bacheca.
  function daysUntil(dateStr) {
    return Math.round((new Date(dateStr) - new Date()) / 86400000);
  }

  // Etichetta "Scade tra N giorni"/"Scaduto da N giorni", riusata da
  // Progetti/Scadenze/Abbonamenti ovunque serva mostrare una scadenza.
  function dueLabel(days) {
    if (days === 0) return tr('due_today');
    const unit = tr(Math.abs(days) === 1 ? 'day_one' : 'day_other');
    return days > 0 ? tr('due_in', { n: days, unit }) : tr('overdue_by', { n: -days, unit });
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
    I18N.applyStaticTranslations(backdrop);
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

  // Simbolo per categoria di file in Drive, cosi' si riconosce a colpo
  // d'occhio se e' un'immagine/audio/video senza dover leggere l'estensione.
  function fileCategoryIcon(mime) {
    const m = mime || '';
    if (m.startsWith('image/')) return 'immagine';
    if (m.startsWith('audio/')) return 'musica';
    if (m.startsWith('video/')) return 'video';
    return 'documento';
  }
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
            <a class="btn btn-sm" href="/api/drive/${doc.id}/download">${esc(tr('btn_download'))}</a>
            <button type="button" class="preview-close" aria-label="${esc(tr('btn_close'))}">✕</button>
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
    authSub.textContent = setupMode ? tr('auth_sub_setup') : tr('auth_sub_login');
    authSubmit.textContent = setupMode ? tr('auth_submit_setup') : tr('auth_submit_login');
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
        authSubmit.textContent = tr('auth_submit_verify');
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
    calendar: '<rect x="3" y="3.5" width="14" height="14" rx="0.8" fill="#f5f5f5" stroke="#4a4a52" stroke-width="0.8"/><rect x="3" y="3.5" width="14" height="4" fill="#c0392b" stroke="#4a4a52" stroke-width="0.8"/><rect x="6" y="1.5" width="1.6" height="3" fill="#8a8a92"/><rect x="12.4" y="1.5" width="1.6" height="3" fill="#8a8a92"/><rect x="5.5" y="10" width="2.6" height="2.2" fill="#4a7fc9"/><rect x="9.2" y="10" width="2.6" height="2.2" fill="#c8c8ce" stroke="#8a8a92" stroke-width="0.4"/><rect x="12.9" y="10" width="2.6" height="2.2" fill="#c8c8ce" stroke="#8a8a92" stroke-width="0.4"/>',
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
    occhio: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    'occhio-off': '<path d="M3 3l18 18"/><path d="M10.6 5.2A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-4 4.9M6.3 6.5C3.4 8.3 2 12 2 12s3.6 7 10 7c1.4 0 2.7-.3 3.8-.8"/><path d="M9.5 9.7a3 3 0 0 0 4.2 4.2"/>',
    matita: '<path d="M4 20l.9-4L16 4.9a1.6 1.6 0 0 1 2.3 0l.8.8a1.6 1.6 0 0 1 0 2.3L8 19.1z"/><path d="M14.5 7.5l2 2"/>',
    cartellaLinea: '<path d="M3 7a1.8 1.8 0 0 1 1.8-1.8h4l2 2h8.4A1.8 1.8 0 0 1 21 9v8.2A1.8 1.8 0 0 1 19.2 19H4.8A1.8 1.8 0 0 1 3 17.2z"/>',
    cestino: '<path d="M4.5 7h15M9.5 7V4.5h5V7M7 7l1 12.5a1.5 1.5 0 0 0 1.5 1.4h7a1.5 1.5 0 0 0 1.5-1.4L18 7"/><path d="M10.2 11v6M13.8 11v6"/>',
    codice: '<rect x="2" y="5.5" width="20" height="13" rx="1"/><text x="6" y="15" font-size="9.5" font-family="var(--font-mono, monospace)" font-weight="700" stroke="none" fill="currentColor">01</text>',
    immagine: '<rect x="3" y="4" width="18" height="15" rx="1"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M3 15l5-4.5 4 3.5 3-2.5 6 5"/>',
    musica: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
    video: '<rect x="2.5" y="5" width="19" height="14" rx="1"/><path d="M10 9.5v5l4.5-2.5z" fill="currentColor" stroke="none"/>',
    documento: '<path d="M6 2.5h8l4 4v15H6z"/><path d="M14 2.5v4h4"/><path d="M8.5 12h7M8.5 15.5h5"/>',
    frecciaSx: '<path d="M14.5 5.5l-6.5 6.5 6.5 6.5"/>',
    frecciaDx: '<path d="M9.5 5.5l6.5 6.5-6.5 6.5"/>',
  };
  function iconaLinea(nome) {
    return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${VECTOR_ICONS[nome] || ''}</svg>`;
  }

  // Elenco unico delle app: alimenta il menu Avvio (computer e telefono).
  const SECTIONS = [
    { view: 'projects', label: tr('nav_projects') },
    { view: 'ideas', label: tr('nav_ideas') },
    { view: 'vault', label: tr('nav_vault') },
    { view: 'accounts', label: tr('nav_accounts') },
    { view: 'drive', label: tr('nav_drive') },
    { view: 'dossiers', label: tr('nav_dossiers') },
    { view: 'reminders', label: tr('nav_reminders') },
    { view: 'calendar', label: tr('nav_calendar') },
    { view: 'trash', label: tr('nav_trash') },
    { view: 'security', label: tr('nav_security') },
  ];
  // Voci di configurazione separate da quelle d'uso quotidiano con un
  // divisore nel menu Avvio, per ridurre le scelte a parita' di sguardo.
  const SETTINGS_VIEWS = new Set(['trash', 'security']);

  // Sezione in cui vive ciascun tipo di elemento collegato a una cartella o
  // trovato dalla ricerca globale: usata per aprire l'elemento cliccandolo.
  const TYPE_TO_VIEW = { document: 'drive', idea: 'ideas', project: 'projects', account: 'accounts', vault: 'vault', reminder: 'reminders', dossier: 'dossiers' };

  const VIEW_LABELS = Object.fromEntries(SECTIONS.map((s) => [s.view, s.label]));

  // Aprire un elemento da dentro una cartella mostra solo quell'elemento
  // (non l'intero elenco) e aggiunge un modo per tornare alla cartella —
  // stesso meccanismo in ogni vista che puo' essere raggiunta da li'.
  function onlyFilter(opts) {
    return (item) => !opts.only || String(item.id) === String(opts.only);
  }
  function backToDossierButtonHtml(opts) {
    return opts.fromDossier ? `<button type="button" class="btn btn-sm" data-back-to-dossier>${esc(tr('btn_back_to_folder'))}</button>` : '';
  }
  function wireBackToDossier(root, opts) {
    if (!opts.fromDossier) return;
    const btn = root.querySelector('[data-back-to-dossier]');
    if (btn) btn.addEventListener('click', () => render('dossiers', { highlight: opts.fromDossier }));
  }

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
    const esci = el(`<div class="menu-row">${appIcon('esci')}<span>${esc(tr('btn_logout'))}</span></div>`);
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

  // Gesto swipe-up per aprire il menu Avvio su mobile (paradigma "pocket PC"
  // suggerito dalla skill Windows 95): il tasto Avvio resta comunque sempre
  // raggiungibile, questa e' solo una scorciatoia in piu'. Stessa soglia di
  // breakpoint gia' usata in wm.js/style.css (760px), non una nuova.
  const startGestureMQ = window.matchMedia('(max-width: 760px)');
  const SWIPE_ZONE_PX = 70; // quanto vicino alla base dello schermo deve partire il tocco
  const SWIPE_MIN_DISTANCE = 45;
  const SWIPE_MAX_DURATION = 600; // ms, oltre e' uno scroll lento, non uno swipe
  let swipeStartY = null;
  let swipeStartX = 0;
  let swipeStartTime = 0;
  document.addEventListener('touchstart', (e) => {
    if (!startGestureMQ.matches || !startMenu.classList.contains('hidden')) { swipeStartY = null; return; }
    const touch = e.touches[0];
    if (window.innerHeight - touch.clientY > SWIPE_ZONE_PX) { swipeStartY = null; return; }
    swipeStartY = touch.clientY;
    swipeStartX = touch.clientX;
    swipeStartTime = Date.now();
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (swipeStartY == null) return;
    const touch = e.changedTouches[0];
    const dy = swipeStartY - touch.clientY;
    const dx = Math.abs(touch.clientX - swipeStartX);
    const dt = Date.now() - swipeStartTime;
    swipeStartY = null;
    if (dy > SWIPE_MIN_DISTANCE && dx < 60 && dt < SWIPE_MAX_DURATION) openStartMenu();
  }, { passive: true });

  // ---------------- Desktop: sfondo, cartelle e note recenti come icone ----------------
  // Lo sfondo e' una preferenza solo del dispositivo (localStorage), non un
  // dato di Mindkeep: niente migrazione, niente sincronizzazione fra dispositivi.
  const WALLPAPERS = {
    classico: { label: tr('wallpaper_classic') },
    'vaporwave-tramonto': { label: tr('wallpaper_sunset'), url: '/wallpapers/wp-tramonto.jpg' },
    'vaporwave-palma': { label: tr('wallpaper_palm'), url: '/wallpapers/wp-palma.jpg' },
    grigio: { label: tr('wallpaper_gray'), color: '#6b6b76' },
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
      desktopWallpaperEl.appendChild(el('<img class="wallpaper-logo" src="/icon-512.png" alt="" />'));
    }
    localStorage.setItem('mindkeep-wallpaper', name);
  }

  const POSTIT_CLASSES = ['postit-y', 'postit-p', 'postit-b'];

  // Le note sul desktop mostrano solo il titolo per restare compatte; al tocco
  // si allargano sul posto per mostrare corpo/checklist/tag (stesso comportamento
  // su desktop e mobile, cosi' non serve aprire la finestra Note solo per leggere).
  // Si richiudono al tocco di un qualsiasi punto (anche se stesso) o non appena
  // parte una nuova operazione, perche' quel tocco arriva comunque al listener
  // globale sotto.
  let expandedPostit = null;

  function collapsePostit() {
    if (!expandedPostit) return;
    const { el: noteEl, original } = expandedPostit;
    noteEl.classList.remove('postit-expanded');
    noteEl.innerHTML = '';
    noteEl.appendChild(original);
    expandedPostit = null;
  }

  function expandPostit(noteEl, idea) {
    collapsePostit();
    const original = document.createDocumentFragment();
    while (noteEl.firstChild) original.appendChild(noteEl.firstChild);
    noteEl.classList.add('postit-expanded');
    const { done, total } = checklistProgress(idea.checklist);
    noteEl.innerHTML = `
      <p class="postit-expanded-title">${esc(idea.title)}</p>
      ${idea.body ? `<p class="postit-expanded-body">${esc(idea.body)}</p>` : ''}
      ${total ? `<p class="postit-expanded-sub">${esc(tr('label_completed_count', { done, total }))}</p>` : ''}
      ${(idea.tags || []).length ? `<div class="tag-row">${idea.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
    `;
    expandedPostit = { el: noteEl, original };
  }

  document.addEventListener('click', (e) => {
    if (!expandedPostit || expandedPostit.el.contains(e.target)) return;
    collapsePostit();
  });

  async function buildDesktop() {
    applyWallpaper(currentWallpaper());
    expandedPostit = null;
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
        const title = idea.title || idea.body || '';
        note.textContent = title.length > 90 ? title.slice(0, 90) + '…' : title;
        note.addEventListener('click', (e) => {
          e.stopPropagation();
          if (note.classList.contains('postit-expanded')) collapsePostit();
          else expandPostit(note, idea);
        });
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
    { token: '/nota', desc: tr('qc_desc_note') },
    { token: '/doc', desc: tr('qc_desc_doc') },
    { token: '/scadenza', desc: tr('qc_desc_reminder') },
    { token: '/progetto', desc: tr('qc_desc_project') },
  ];

  function closeQuickCapture() {
    quickCaptureEl.classList.add('hidden');
    quickCaptureEl.innerHTML = '';
    // Riportata alla posizione di default (in alto al centro): uno
    // spostamento manuale non e' pensato per restare tra un'apertura e
    // l'altra, solo per togliersi di mezzo da quello che stai facendo ora.
    quickCaptureEl.style.left = '';
    quickCaptureEl.style.top = '';
    quickCaptureEl.style.transform = '';
    btnNuovo.classList.remove('pressed');
    qcMenuEl = null; qcMenuItems = []; qcMenuTrigger = null; qcSelectedDossier = null;
  }

  // Trascinamento libero del riquadro tramite la barretta in cima — stessa
  // tecnica pointer-capture di attachDrag() in wm.js, ma indipendente: la
  // cattura veloce non e' una finestra vera (niente focus/z-index/taskbar).
  function attachQcDrag(handle) {
    handle.addEventListener('pointerdown', (e) => {
      handle.setPointerCapture(e.pointerId);
      const rect = quickCaptureEl.getBoundingClientRect();
      quickCaptureEl.style.left = rect.left + 'px';
      quickCaptureEl.style.top = rect.top + 'px';
      quickCaptureEl.style.transform = 'none';
      const startX = e.clientX, startY = e.clientY;
      const startLeft = rect.left, startTop = rect.top;
      const onMove = (e2) => {
        const left = Math.max(4, Math.min(window.innerWidth - 60, startLeft + (e2.clientX - startX)));
        const top = Math.max(4, Math.min(window.innerHeight - 60, startTop + (e2.clientY - startY)));
        quickCaptureEl.style.left = left + 'px';
        quickCaptureEl.style.top = top + 'px';
      };
      const onUp = () => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });
  }

  async function openQuickCapture(presetDossier) {
    closeStartMenu();
    quickCaptureEl.innerHTML = '';
    const dossiers = await api('/dossiers').catch(() => []);
    const dragHandle = el(`<div class="qc-drag-handle" title="${esc(tr('qc_drag_title'))}">⋮⋮⋮</div>`);
    const composer = el(`
      <div class="composer">
        <textarea id="qc-text" placeholder="${esc(tr('qc_placeholder'))}" rows="2"></textarea>
        <div id="qc-link-badge"></div>
        <div class="composer-row">
          <button type="button" class="btn btn-sm" id="qc-type" title="${esc(tr('qc_change_type'))}">…</button>
          <button type="button" class="btn btn-primary" id="qc-save">${esc(tr('btn_save'))}</button>
        </div>
        <div class="composer-hint">
          <span>${esc(tr('qc_hint'))}</span>
        </div>
      </div>
    `);
    quickCaptureEl.appendChild(dragHandle);
    quickCaptureEl.appendChild(composer);
    quickCaptureEl.classList.remove('hidden');
    btnNuovo.classList.add('pressed');
    attachQcDrag(dragHandle);

    const textarea = composer.querySelector('#qc-text');
    const linkBadgeWrap = composer.querySelector('#qc-link-badge');
    const ideasForTags = await api('/ideas').catch(() => []);
    const knownTags = [...new Set(ideasForTags.flatMap((x) => x.tags || []))].sort();

    function renderLinkBadge() {
      linkBadgeWrap.innerHTML = '';
      if (!qcSelectedDossier) return;
      const badge = el(`<span class="composer-link-badge">→ ${esc(qcSelectedDossier.title)} <button type="button" title="${esc(tr('title_remove'))}">✕</button></span>`);
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
        openQcMenu(dossiers.filter((d) => d.title.toLowerCase().includes(trigger.query)).map((d) => ({ token: '@' + d.title, desc: tr('qc_desc_folder'), dossier: d })));
      } else {
        openQcMenu(knownTags.filter((t) => t.toLowerCase().startsWith(trigger.query)).map((t) => ({ token: '#' + t, desc: tr('qc_desc_tag') })));
      }
    }
    // Cambiare tipo (da /comando digitato o dal tasto "…") non scrive mai
    // dentro la cattura veloce: /nota resta li' (e' gia' il default), gli
    // altri chiudono il riquadro e aprono la schermata di inserimento
    // completa di quel tipo — la stessa che permette anche di scegliere una
    // cartella, cosa che qui non e' mai stata replicata apposta.
    function applyTypeCommand(token) {
      if (token === '/nota') return;
      if (token === '/scadenza') {
        const form = reminderModal();
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          await api('/reminders', { method: 'POST', body: JSON.stringify({ label: form.label.value, date: form.date.value, time: form.time.value, notes: form.notes.value }) });
          closeModal(); toast(tr('toast_reminder_saved')); closeQuickCapture(); render('reminders');
        });
        form.querySelector('[data-cancel]').addEventListener('click', closeModal);
        openModal(tr('modal_new_reminder'), form);
        return;
      }
      if (token === '/doc') {
        closeQuickCapture();
        render('drive').then(() => { const btn = document.getElementById('new-doc'); if (btn) btn.click(); });
        return;
      }
      if (token === '/progetto') {
        closeQuickCapture();
        render('projects').then(() => { const btn = document.getElementById('new-project'); if (btn) btn.click(); });
      }
    }

    async function selectQcMenuItem(i) {
      const item = qcMenuItems[i];
      const trigger = qcMenuTrigger;
      closeQcMenu();
      if (!item || !trigger) return;
      if (trigger.type === 'button') { applyTypeCommand(item.token); return; }
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
      applyTypeCommand(item.token);
    }

    composer.querySelector('#qc-type').addEventListener('click', () => {
      qcMenuTrigger = { type: 'button' };
      openQcMenu(QC_COMMANDS);
      // Rimette il focus sul testo: le frecce/Invio per scegliere dal menu
      // sono gestite dal keydown della textarea, non del tasto "…".
      textarea.focus();
    });

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
          if (MindkeepWM.getWindow(windowId('dossiers'))) render('dossiers', { highlight: qcSelectedDossier.id });
        }
        toast(tr('toast_idea_saved'));
        closeQuickCapture();
        buildDesktop();
      } finally {
        qcSaving = false;
      }
    }
    composer.querySelector('#qc-save').addEventListener('click', saveQc);
    if (presetDossier) { qcSelectedDossier = presetDossier; renderLinkBadge(); }
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

  const WINDOW_SIZES = { vault: { w: 1040, h: 640 }, dossiers: { w: 760, h: 560 }, calendar: { w: 820, h: 620 } };

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
      // Cartelle e Note compaiono anche come icone sul desktop: ogni volta che
      // la loro finestra si aggiorna (creazione/modifica/eliminazione), le
      // icone devono riflettere subito lo stesso stato, senza dover ricaricare.
      if (view === 'ideas' || view === 'dossiers') buildDesktop();
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
      wrap.appendChild(el(`<p class="card-sub">${esc(tr('dossiers_none_yet'))}</p>`));
    } else {
      dossiers.forEach((d) => {
        const row = el(`
          <div class="trash-row row-card">
            <span>${esc(d.title)}</span>
            <button class="btn btn-sm btn-primary">${esc(tr('btn_link'))}</button>
          </div>
        `);
        row.querySelector('button').addEventListener('click', async () => {
          await api(`/dossiers/${d.id}/links`, {
            method: 'POST',
            body: JSON.stringify({ item_type: itemType, item_id: itemId }),
          });
          toast(tr('toast_linked_to_dossier', { item: itemLabel, dossier: d.title }));
          closeModal();
        });
        wrap.appendChild(row);
      });
    }
    openModal(tr('modal_link_to_dossier'), wrap);
  }

  // ==================================================================
  // SCADENZE (promemoria — elenco minimo; il calendario vero e' lavoro futuro)
  // ==================================================================
  function reminderModal(existing) {
    const form = el(`
      <form class="modal-body" style="padding:0">
        <div class="form-row"><label>${esc(tr('field_what'))}</label><input type="text" name="label" required /></div>
        <div style="display:flex;gap:10px">
          <div class="form-row" style="flex:1"><label>${esc(tr('field_when'))}</label><input type="date" name="date" required /></div>
          <div class="form-row" style="flex:1"><label>${esc(tr('field_time_optional'))}</label><input type="time" name="time" /></div>
        </div>
        <div class="form-row"><label>${esc(tr('field_notes'))}</label><textarea name="notes" rows="3"></textarea></div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-cancel>${esc(tr('btn_cancel'))}</button>
          <button type="submit" class="btn btn-primary">${esc(tr('btn_save'))}</button>
        </div>
      </form>
    `);
    if (existing) {
      form.label.value = existing.label;
      form.date.value = existing.date ? existing.date.slice(0, 10) : '';
      form.time.value = existing.time || '';
      form.notes.value = existing.notes;
    }
    return form;
  }

  views.reminders = async (root, opts = {}) => {
    const highlightId = opts.highlight ? String(opts.highlight) : null;
    const reminders = (await api('/reminders')).filter(onlyFilter(opts));
    root.innerHTML = '';
    root.appendChild(el(`
      <div class="view-header">
        <h2>${esc(tr('nav_reminders_title'))}</h2>
        <div class="view-header-actions">${backToDossierButtonHtml(opts)}<button class="btn btn-primary" id="new-reminder">${esc(tr('btn_new_reminder'))}</button></div>
      </div>
    `));
    wireBackToDossier(root, opts);

    root.querySelector('#new-reminder').addEventListener('click', () => {
      const form = reminderModal();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await api('/reminders', { method: 'POST', body: JSON.stringify({ label: form.label.value, date: form.date.value, time: form.time.value, notes: form.notes.value }) });
        closeModal(); toast(tr('toast_reminder_saved')); render('reminders');
      });
      form.querySelector('[data-cancel]').addEventListener('click', closeModal);
      openModal(tr('modal_new_reminder'), form);
    });

    if (!reminders.length) {
      root.appendChild(el(`<div class="empty-state">${esc(tr('empty_reminders'))}</div>`));
      return;
    }

    reminders
      .slice()
      .sort((a, b) => new Date(`${a.date}T${a.time || '00:00'}`) - new Date(`${b.date}T${b.time || '00:00'}`))
      .forEach((r) => {
        const days = daysUntil(r.date);
        const unit = tr(Math.abs(days) === 1 ? 'day_one' : 'day_other');
        const dayLabel = days === 0 ? tr('today_lc') : days > 0 ? tr('due_in_n', { n: days, unit }) : tr('overdue_by_passed', { n: -days, unit });
        const row = el(`
          <div class="trash-row row-card">
            <span>
              <strong>${esc(r.label)}</strong>
              <span class="card-sub" style="display:block">${fmtDate(r.date)}${r.time ? ' · ' + esc(r.time) : ''} · ${esc(dayLabel)}${r.notes ? ' · ' + escTrim(r.notes, 80) : ''}</span>
            </span>
            <span class="card-actions" style="padding:0">
              <button class="btn btn-sm" data-edit>${esc(tr('btn_edit'))}</button>
              <button class="btn btn-sm" data-link>${esc(tr('btn_link_folder'))}</button>
              <button class="btn btn-sm btn-danger" data-del>${esc(tr('btn_delete'))}</button>
            </span>
          </div>
        `);
        row.querySelector('[data-edit]').addEventListener('click', () => {
          const form = reminderModal(r);
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await api(`/reminders/${r.id}`, { method: 'PUT', body: JSON.stringify({ label: form.label.value, date: form.date.value, time: form.time.value, notes: form.notes.value }) });
            closeModal(); toast(tr('toast_reminder_updated')); render('reminders');
          });
          form.querySelector('[data-cancel]').addEventListener('click', closeModal);
          openModal(tr('modal_edit_reminder'), form);
        });
        row.querySelector('[data-link]').addEventListener('click', () => openLinkToDossierModal('reminder', r.id, r.label));
        row.querySelector('[data-del]').addEventListener('click', async () => {
          if (!confirm(tr('confirm_delete_reminder'))) return;
          await api(`/reminders/${r.id}`, { method: 'DELETE' });
          toast(tr('toast_reminder_deleted')); render('reminders');
        });
        if (highlightId && String(r.id) === highlightId) row.classList.add('card-highlight');
        root.appendChild(row);
      });
  };

  // Calendario: griglia mensile, riusa l'API e il modulo delle Scadenze —
  // stessi dati, vista diversa. Click su un giorno vuoto = nuova scadenza con
  // quella data precompilata; click su una voce = modifica.
  const MONTH_LABELS = ['month_0', 'month_1', 'month_2', 'month_3', 'month_4', 'month_5', 'month_6', 'month_7', 'month_8', 'month_9', 'month_10', 'month_11'].map(tr);
  const WEEKDAY_LABELS = ['weekday_short_1', 'weekday_short_2', 'weekday_short_3', 'weekday_short_4', 'weekday_short_5', 'weekday_short_6', 'weekday_short_7'].map(tr);
  const WEEKDAY_LABELS_FULL = ['weekday_1', 'weekday_2', 'weekday_3', 'weekday_4', 'weekday_5', 'weekday_6', 'weekday_7'].map(tr);

  views.calendar = async (root, opts = {}) => {
    const reminders = await api('/reminders');
    root.innerHTML = '';
    root.appendChild(el(`
      <div class="view-header">
        <h2>${esc(tr('nav_calendar_title'))}</h2>
        <div class="view-header-actions"><button class="btn btn-primary" id="new-reminder-cal">${esc(tr('btn_new_reminder'))}</button></div>
      </div>
    `));

    function saveNew(dateStr) {
      const form = reminderModal();
      if (dateStr) form.date.value = dateStr;
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await api('/reminders', { method: 'POST', body: JSON.stringify({ label: form.label.value, date: form.date.value, time: form.time.value, notes: form.notes.value }) });
        closeModal(); toast(tr('toast_reminder_saved')); render('calendar', { month: monthKey(cursor) });
      });
      form.querySelector('[data-cancel]').addEventListener('click', closeModal);
      openModal(tr('modal_new_reminder'), form);
    }

    function saveEdit(r) {
      const form = reminderModal(r);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await api(`/reminders/${r.id}`, { method: 'PUT', body: JSON.stringify({ label: form.label.value, date: form.date.value, time: form.time.value, notes: form.notes.value }) });
        closeModal(); toast(tr('toast_reminder_updated')); render('calendar', { month: monthKey(cursor) });
      });
      form.querySelector('[data-cancel]').addEventListener('click', closeModal);
      openModal(tr('modal_edit_reminder'), form);
    }

    root.querySelector('#new-reminder-cal').addEventListener('click', () => saveNew());

    function monthKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
    const cursor = opts.month ? new Date(`${opts.month}-01T00:00:00`) : new Date();
    cursor.setDate(1);

    const toolbar = el(`
      <div class="calendar-toolbar">
        <button type="button" class="btn" id="cal-prev">◄</button>
        <span class="calendar-label" id="cal-label"></span>
        <button type="button" class="btn" id="cal-next">►</button>
        <button type="button" class="btn" id="cal-today">${esc(tr('btn_today'))}</button>
      </div>
    `);
    const gridWrap = el('<div class="calendar-grid"></div>');
    root.appendChild(toolbar);
    root.appendChild(gridWrap);

    function remindersOn(dateStr) {
      return reminders
        .filter((r) => (r.date || '').slice(0, 10) === dateStr)
        .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    }

    function renderMonth() {
      toolbar.querySelector('#cal-label').textContent = `${MONTH_LABELS[cursor.getMonth()]} ${cursor.getFullYear()}`;
      gridWrap.innerHTML = '';
      WEEKDAY_LABELS.forEach((w) => gridWrap.appendChild(el(`<div class="calendar-weekday">${w}</div>`)));

      const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      const firstWeekday = (firstOfMonth.getDay() + 6) % 7; // Lun=0 ... Dom=6 (getDay() e' Dom=0 ... Sab=6)
      const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
      const todayStr = new Date().toISOString().slice(0, 10);

      for (let i = 0; i < firstWeekday; i++) gridWrap.appendChild(el('<div class="calendar-cell calendar-cell-empty"></div>'));

      for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const cell = el(`
          <div class="calendar-cell${dateStr === todayStr ? ' calendar-cell-today' : ''}">
            <span class="calendar-daynum">${day}</span>
            <div class="calendar-entries"></div>
          </div>
        `);
        const entriesEl = cell.querySelector('.calendar-entries');
        remindersOn(dateStr).forEach((r) => {
          const chip = el(`<button type="button" class="calendar-entry">${r.time ? `<span class="calendar-entry-time">${esc(r.time)}</span> ` : ''}${escTrim(r.label, 40)}</button>`);
          chip.addEventListener('click', (e) => { e.stopPropagation(); saveEdit(r); });
          entriesEl.appendChild(chip);
        });
        cell.addEventListener('click', () => saveNew(dateStr));
        gridWrap.appendChild(cell);
      }
    }

    toolbar.querySelector('#cal-prev').addEventListener('click', () => { cursor.setMonth(cursor.getMonth() - 1); renderMonth(); });
    toolbar.querySelector('#cal-next').addEventListener('click', () => { cursor.setMonth(cursor.getMonth() + 1); renderMonth(); });
    toolbar.querySelector('#cal-today').addEventListener('click', () => { cursor.setFullYear(new Date().getFullYear(), new Date().getMonth(), 1); renderMonth(); });

    renderMonth();
  };

  // ==================================================================
  // NOTE
  // ==================================================================
  function ideaModal(existing) {
    const form = el(`
      <form class="modal-body" style="padding:0">
        <div class="form-row"><label>${esc(tr('field_title'))}</label><input type="text" name="title" required /></div>
        <div class="form-row"><label>${esc(tr('field_description'))}</label><textarea name="body" rows="5"></textarea></div>
        <div class="form-row"><label>${esc(tr('field_checklist'))}</label><textarea name="checklist" rows="4" placeholder="${esc(tr('idea_checklist_placeholder'))}"></textarea></div>
        <div class="form-row"><label>${esc(tr('field_tags'))}</label><input type="text" name="tags" /></div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-cancel>${esc(tr('btn_cancel'))}</button>
          <button type="submit" class="btn btn-primary">${esc(tr('btn_save'))}</button>
        </div>
      </form>
    `);
    if (existing) {
      form.title.value = existing.title;
      form.body.value = existing.body;
      form.checklist.value = (existing.checklist || []).map((c) => c.text).join('\n');
      form.tags.value = (existing.tags || []).join(', ');
    }
    return form;
  }

  views.ideas = async (root, opts = {}) => {
    const highlightId = opts.highlight ? String(opts.highlight) : null;
    const ideas = (await api('/ideas')).filter(onlyFilter(opts));
    root.innerHTML = '';
    root.appendChild(el(`
      <div class="view-header">
        <h2>${esc(tr('nav_ideas_title'))}</h2>
        <div class="view-header-actions">${backToDossierButtonHtml(opts)}<button class="btn btn-primary" id="new-idea">${esc(tr('btn_new_idea'))}</button></div>
      </div>
    `));
    wireBackToDossier(root, opts);

    root.querySelector('#new-idea').addEventListener('click', () => {
      const form = ideaModal();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const tags = parseTags(form);
        const checklist = collectChecklist(form, []);
        await api('/ideas', { method: 'POST', body: JSON.stringify({ title: form.title.value, body: form.body.value, tags, checklist }) });
        closeModal(); toast(tr('toast_idea_saved')); render('ideas');
      });
      form.querySelector('[data-cancel]').addEventListener('click', closeModal);
      openModal(tr('modal_new_idea'), form);
    });

    if (!ideas.length) {
      root.appendChild(el(`<div class="empty-state">${esc(tr('empty_ideas'))}</div>`));
      return;
    }

    const grid = el('<div class="grid"></div>');
    ideas.forEach((idea) => {
      const { done, total } = checklistProgress(idea.checklist);
      const card = el(`
        <div class="card">
          <p class="card-title">${esc(idea.title)}</p>
          <p class="card-body">${escTrim(idea.body, 220)}</p>
          <div class="tag-row">${(idea.tags || []).map((tg) => `<span class="tag">${esc(tg)}</span>`).join('')}</div>
          <div class="card-actions">
            <button class="btn btn-sm" data-edit>${esc(tr('btn_edit'))}</button>
            <button class="btn btn-sm" data-link>${esc(tr('btn_link_folder'))}</button>
            <button class="btn btn-sm btn-danger" data-del>${esc(tr('btn_delete'))}</button>
          </div>
        </div>
      `);
      if (total) {
        const checklistEl = el('<div class="idea-checklist"></div>');
        checklistEl.appendChild(el(`<p class="card-sub">${esc(tr('label_completed_count', { done, total }))}</p>`));
        (idea.checklist || []).forEach((item, i) => {
          const row = el(`
            <label class="idea-checklist-item">
              <input type="checkbox" ${item.done ? 'checked' : ''} />
              <span>${esc(item.text)}</span>
              ${item.done ? `<span class="idea-checklist-badge" title="${esc(tr('label_completed_title'))}">✓</span>` : ''}
            </label>
          `);
          row.querySelector('input').addEventListener('change', async (e) => {
            const updated = idea.checklist.map((c, j) => (j === i ? { ...c, done: e.target.checked } : c));
            await api(`/ideas/${idea.id}`, { method: 'PUT', body: JSON.stringify({ checklist: updated }) });
            render('ideas');
          });
          checklistEl.appendChild(row);
        });
        card.querySelector('.card-body').insertAdjacentElement('afterend', checklistEl);
      }
      card.querySelector('[data-edit]').addEventListener('click', () => {
        const form = ideaModal(idea);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const tags = parseTags(form);
          const checklist = collectChecklist(form, idea.checklist);
          await api(`/ideas/${idea.id}`, { method: 'PUT', body: JSON.stringify({ title: form.title.value, body: form.body.value, tags, checklist }) });
          closeModal(); toast(tr('toast_idea_updated')); render('ideas');
        });
        form.querySelector('[data-cancel]').addEventListener('click', closeModal);
        openModal(tr('modal_edit_idea'), form);
      });
      card.querySelector('[data-link]').addEventListener('click', () => openLinkToDossierModal('idea', idea.id, idea.title));
      card.querySelector('[data-del]').addEventListener('click', async () => {
        if (!confirm(tr('confirm_delete_idea'))) return;
        await api(`/ideas/${idea.id}`, { method: 'DELETE' });
        toast(tr('toast_idea_deleted')); render('ideas');
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
        <div class="form-row"><label>${esc(tr('field_title'))}</label><input type="text" name="title" required /></div>
        <div class="form-row"><label>${esc(tr('field_description'))}</label><textarea name="description" rows="4"></textarea></div>
        <div class="form-row"><label>${esc(tr('field_status'))}</label>
          <select name="status">
            <option value="da_fare">${esc(tr('status_todo'))}</option>
            <option value="in_corso">${esc(tr('status_doing'))}</option>
            <option value="fatto">${esc(tr('status_done'))}</option>
          </select>
        </div>
        <div class="form-row"><label>${esc(tr('field_deadline_optional'))}</label><input type="date" name="deadline" /></div>
        <div class="form-row"><label>${esc(tr('field_checklist_required'))}</label><textarea name="checklist" rows="4" placeholder="${esc(tr('field_checklist_project_placeholder'))}"></textarea></div>
        <div class="form-row"><label>${esc(tr('field_contacts'))}</label><input type="text" name="contacts" placeholder="${esc(tr('field_contacts_placeholder'))}" /></div>
        <div class="form-row"><label>${esc(tr('field_budget'))}</label><textarea name="budget" rows="3" placeholder="${esc(tr('field_budget_placeholder'))}"></textarea></div>
        <div class="form-row"><label>${esc(tr('field_tags'))}</label><input type="text" name="tags" /></div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-cancel>${esc(tr('btn_cancel'))}</button>
          <button type="submit" class="btn btn-primary">${esc(tr('btn_save'))}</button>
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
    const projects = (await api('/projects')).filter(onlyFilter(opts));
    root.innerHTML = '';
    root.appendChild(el(`
      <div class="view-header">
        <h2>${esc(tr('nav_projects'))}</h2>
        <div class="view-header-actions">${backToDossierButtonHtml(opts)}<button class="btn btn-primary" id="new-project">${esc(tr('btn_new_project'))}</button></div>
      </div>
    `));
    wireBackToDossier(root, opts);

    root.querySelector('#new-project').addEventListener('click', () => {
      const form = projectModal();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const tags = parseTags(form);
        const contacts = parseContacts(form);
        const budget = parseBudgetLines(form.budget.value);
        const checklist = collectChecklist(form, []);
        await api('/projects', { method: 'POST', body: JSON.stringify({ title: form.title.value, description: form.description.value, status: form.status.value, deadline: form.deadline.value || null, checklist, contacts, budget, tags }) });
        closeModal(); toast(tr('toast_project_saved')); render('projects');
      });
      form.querySelector('[data-cancel]').addEventListener('click', closeModal);
      openModal(tr('modal_new_project'), form);
    });

    if (!projects.length) {
      root.appendChild(el(`<div class="empty-state">${esc(tr('empty_none_yet'))}</div>`));
      return;
    }

    const STATUSES = [
      { key: 'da_fare', label: tr('status_todo') },
      { key: 'in_corso', label: tr('status_doing') },
      { key: 'fatto', label: tr('status_done') },
    ];
    const board = el('<div class="board"></div>');

    // Trascinamento vero delle card tra colonne (le frecce restano come
    // alternativa funzionante, es. per chi preferisce non trascinare).
    // Solo mouse: su schermi stretti le colonne si impilano una sopra
    // l'altra e "trascinare tra colonne" coinciderebbe con lo scroll
    // verticale della pagina — le frecce restano l'unico modo su touch.
    function attachCardDrag(card, p) {
      card.addEventListener('pointerdown', (e) => {
        if (e.pointerType && e.pointerType !== 'mouse') return;
        if (e.button !== 0) return;
        if (e.target.closest('button, label, input')) return;
        const startX = e.clientX, startY = e.clientY;
        const rect = card.getBoundingClientRect();
        const offsetX = startX - rect.left, offsetY = startY - rect.top;
        let dragging = false;
        let ghost = null;

        function clearHighlights() {
          board.querySelectorAll('.board-col.board-col-drop-target').forEach((c) => c.classList.remove('board-col-drop-target'));
        }
        function dropColAt(x, y) {
          const target = document.elementFromPoint(x, y);
          return target ? target.closest('.board-col') : null;
        }
        function startDrag() {
          dragging = true;
          card.classList.add('board-card-dragging');
          ghost = card.cloneNode(true);
          ghost.classList.add('board-card-ghost');
          ghost.style.width = rect.width + 'px';
          document.body.appendChild(ghost);
        }
        function moveGhost(x, y) {
          ghost.style.left = (x - offsetX) + 'px';
          ghost.style.top = (y - offsetY) + 'px';
        }
        function cleanup() {
          card.removeEventListener('pointermove', onMove);
          card.removeEventListener('pointerup', onUp);
          card.removeEventListener('pointercancel', onCancel);
          if (ghost) { ghost.remove(); ghost = null; }
          card.classList.remove('board-card-dragging');
          clearHighlights();
        }
        function onMove(e2) {
          if (!dragging) {
            if (Math.abs(e2.clientX - startX) < 6 && Math.abs(e2.clientY - startY) < 6) return;
            startDrag();
          }
          moveGhost(e2.clientX, e2.clientY);
          clearHighlights();
          const col = dropColAt(e2.clientX, e2.clientY);
          if (col) col.classList.add('board-col-drop-target');
        }
        function onUp(e2) {
          const wasDragging = dragging;
          const col = wasDragging ? dropColAt(e2.clientX, e2.clientY) : null;
          cleanup();
          const newStatus = col && col.dataset.status;
          if (wasDragging && newStatus && newStatus !== p.status) {
            api(`/projects/${p.id}`, { method: 'PUT', body: JSON.stringify({ status: newStatus }) }).then(() => render('projects'));
          }
        }
        function onCancel() { cleanup(); }

        card.setPointerCapture(e.pointerId);
        card.addEventListener('pointermove', onMove);
        card.addEventListener('pointerup', onUp);
        card.addEventListener('pointercancel', onCancel);
      });
    }

    STATUSES.forEach((s, i) => {
      const col = el(`
        <div class="board-col" data-status="${s.key}">
          <div class="board-col-head"><span>${esc(s.label)}</span><span class="board-col-count">${projects.filter((p) => p.status === s.key).length}</span></div>
          <div class="board-col-body"></div>
        </div>
      `);
      const body = col.querySelector('.board-col-body');
      const colProjects = projects.filter((p) => p.status === s.key);
      if (!colProjects.length) {
        body.appendChild(el(`<p class="board-col-empty">${esc(tr('empty_none_yet'))}</p>`));
      }
      colProjects.forEach((p) => {
        const { done, total } = checklistProgress(p.checklist);
        const pct = total ? Math.round((done / total) * 100) : 0;
        const totalBudget = budgetTotal(p.budget);
        const budgetTitle = (p.budget || []).map((b) => `${b.label}: ${fmtMoney(b.amount)}`).join(', ');
        let deadlineChip = '';
        if (p.deadline) {
          const days = daysUntil(p.deadline);
          const kind = days < 0 ? 'late' : days <= 3 ? 'soon' : 'far';
          deadlineChip = `<span class="chip-deadline chip-deadline-${kind}">${esc(dueLabel(days))}</span>`;
        }
        const card = el(`
          <div class="board-card">
            <div class="board-card-top">
              <p class="board-card-title">${esc(p.title)}</p>
              ${deadlineChip}
            </div>
            ${p.description ? `<p class="board-card-desc">${escTrim(p.description, 90)}</p>` : ''}
            ${totalBudget ? `<p class="card-sub" title="${esc(budgetTitle)}">${tr('budget_label', { amount: fmtMoney(totalBudget) })}</p>` : ''}
            ${(p.contacts || []).length ? `<p class="card-sub">${tr('contacts_prefix', { names: escTrim(p.contacts.join(', '), 60) })}</p>` : ''}
            <div class="board-card-actions">
              <div class="board-card-move">
                <button type="button" class="btn btn-sm btn-icon" data-prev ${i === 0 ? 'disabled' : ''} title="${esc(tr('move_back'))}">${iconaLinea('frecciaSx')}</button>
                <button type="button" class="btn btn-sm btn-icon" data-next ${i === STATUSES.length - 1 ? 'disabled' : ''} title="${esc(tr('move_forward'))}">${iconaLinea('frecciaDx')}</button>
              </div>
              <div class="board-card-ops">
                <button type="button" class="btn btn-sm btn-icon" data-edit title="${esc(tr('btn_edit'))}">${iconaLinea('matita')}</button>
                <button type="button" class="btn btn-sm btn-icon" data-link title="${esc(tr('btn_link_folder'))}">${iconaLinea('cartellaLinea')}</button>
                <button type="button" class="btn btn-sm btn-icon btn-danger" data-del title="${esc(tr('btn_delete'))}">${iconaLinea('cestino')}</button>
              </div>
            </div>
          </div>
        `);
        if (total) {
          const checklistWrap = el('<div class="board-checklist"></div>');
          checklistWrap.appendChild(el(`
            <div class="board-progress-row" title="${esc(tr('label_completed_count', { done, total }))}">
              <div class="board-progress"><div class="board-progress-fill" style="width:${pct}%"></div></div>
              <span class="board-progress-label">${done}/${total}</span>
            </div>
          `));
          const itemsEl = el('<div class="idea-checklist"></div>');
          (p.checklist || []).forEach((item, idx) => {
            const row = el(`
              <label class="idea-checklist-item">
                <input type="checkbox" ${item.done ? 'checked' : ''} />
                <span>${esc(item.text)}</span>
                ${item.done ? `<span class="idea-checklist-badge" title="${esc(tr('label_completed_title'))}">✓</span>` : ''}
              </label>
            `);
            row.querySelector('input').addEventListener('change', async (e) => {
              const updated = p.checklist.map((c, j) => (j === idx ? { ...c, done: e.target.checked } : c));
              await api(`/projects/${p.id}`, { method: 'PUT', body: JSON.stringify({ checklist: updated }) });
              render('projects');
            });
            itemsEl.appendChild(row);
          });
          checklistWrap.appendChild(itemsEl);
          const anchor = card.querySelector('.board-card-desc') || card.querySelector('.board-card-top');
          anchor.insertAdjacentElement('afterend', checklistWrap);
        }
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
            closeModal(); toast(tr('toast_project_updated')); render('projects');
          });
          form.querySelector('[data-cancel]').addEventListener('click', closeModal);
          openModal(tr('modal_edit_project'), form);
        });
        card.querySelector('[data-link]').addEventListener('click', () => openLinkToDossierModal('project', p.id, p.title));
        attachCardDrag(card, p);
        card.querySelector('[data-del]').addEventListener('click', async () => {
          if (!confirm(tr('confirm_delete_project'))) return;
          await api(`/projects/${p.id}`, { method: 'DELETE' });
          toast(tr('toast_project_deleted')); render('projects');
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
        <div class="form-row"><label>${esc(tr('field_title'))}</label><input type="text" name="site" required /></div>
        <div class="form-row"><label>${esc(tr('field_type'))}</label>
          <select name="type">
            <option value="password">${esc(tr('vault_type_password'))}</option>
            <option value="note">${esc(tr('vault_type_note'))}</option>
            <option value="card">${esc(tr('vault_type_card'))}</option>
          </select>
        </div>

        <div data-type-fields="password">
          <div class="form-row"><label>${esc(tr('field_username'))}</label><input type="text" name="username" /></div>
          <div class="form-row">
            <label>${esc(tr('field_password'))}${existing ? esc(tr('leave_blank_f')) : ''}</label>
            <div style="display:flex;gap:6px">
              <input type="text" name="password" style="flex:1" />
              <button type="button" class="btn btn-sm" id="gen-password">${esc(tr('btn_generate'))}</button>
            </div>
          </div>
          <div class="form-row"><label>${esc(tr('field_url'))}</label><input type="text" name="url" /></div>
          <div class="form-row">
            <label>${esc(tr('vault_totp_code'))}${existing ? esc(tr('leave_blank_m')) : esc(tr('totp_optional'))}</label>
            <input type="text" name="totp_secret" placeholder="${esc(tr('vault_totp_placeholder'))}" />
            <span class="field-hint">${esc(tr('vault_totp_hint'))}</span>
          </div>
          <div class="form-row" id="remove-totp-row" style="display:none">
            <label style="flex-direction:row;align-items:center;gap:6px">
              <input type="checkbox" name="remove_totp" style="width:auto" /> ${esc(tr('vault_remove_totp'))}
            </label>
          </div>
        </div>

        <div data-type-fields="note">
          <div class="form-row"><label>${esc(tr('field_content'))}${existing ? esc(tr('leave_blank_m')) : ''}</label><textarea name="secure_note" rows="6"></textarea></div>
        </div>

        <div data-type-fields="card">
          <div class="form-row"><label>${esc(tr('field_card_holder'))}</label><input type="text" name="card_holder" /></div>
          <div class="form-row"><label>${esc(tr('field_card_number'))}${existing ? esc(tr('leave_blank_m')) : ''}</label><input type="text" name="card_number" inputmode="numeric" /></div>
          <div style="display:flex;gap:10px">
            <div class="form-row" style="flex:1"><label>${esc(tr('field_card_expiry'))}</label><input type="text" name="card_expiry" placeholder="12/28" /></div>
            <div class="form-row" style="flex:1"><label>${esc(tr('field_cvv'))}${existing ? esc(tr('leave_blank_m')) : ''}</label><input type="text" name="card_cvv" inputmode="numeric" /></div>
          </div>
        </div>

        <div class="form-row"><label>${esc(tr('field_notes'))}</label><textarea name="notes" rows="3"></textarea></div>
        <div class="form-row"><label>${esc(tr('field_tags'))}</label><input type="text" name="tags" /></div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-cancel>${esc(tr('btn_cancel'))}</button>
          <button type="submit" class="btn btn-primary">${esc(tr('btn_save'))}</button>
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
    if (type === 'password' && !form.password.value) return tr('err_password_required');
    if (type === 'note' && !form.secure_note.value) return tr('err_note_content_required');
    if (type === 'card' && !form.card_number.value) return tr('err_card_number_required');
    return null;
  }

  views.vault = async (root, opts = {}) => {
    const highlightId = opts.highlight ? String(opts.highlight) : null;
    const entries = (await api('/vault')).filter(onlyFilter(opts));
    root.innerHTML = '';
    root.appendChild(el(`
      <div class="view-header">
        <h2>${esc(tr('nav_vault_title'))}</h2>
        <div class="view-header-actions">${backToDossierButtonHtml(opts)}</div>
      </div>
      <p class="card-sub">${esc(tr('vault_csv_hint'))}</p>
      <div class="vault-toolbar">
        <label class="btn btn-ghost" style="cursor:pointer">
          ${esc(tr('btn_import_csv'))}
          <input type="file" id="csv-input" accept=".csv" class="hidden" />
        </label>
        <button class="btn btn-primary" id="new-vault">${esc(tr('btn_new_vault_entry'))}</button>
      </div>
    `));
    wireBackToDossier(root, opts);

    root.querySelector('#csv-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const fd = new FormData();
      fd.append('file', file);
      try {
        const result = await api('/vault/import', { method: 'POST', body: fd });
        toast(tr('toast_vault_import', { imported: result.imported, skipped: result.skipped }));
        render('vault');
      } catch (err) {
        toast(tr('toast_vault_import_failed', { msg: err.message }));
      }
    });

    root.querySelector('#new-vault').addEventListener('click', () => {
      const form = vaultModal();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const error = vaultPrimaryFieldError(form, null);
        if (error) { toast(error); return; }
        await api('/vault', { method: 'POST', body: JSON.stringify(collectVaultPayload(form, null)) });
        closeModal(); toast(tr('toast_vault_saved')); render('vault');
      });
      form.querySelector('[data-cancel]').addEventListener('click', closeModal);
      openModal(tr('modal_new_vault_entry'), form);
    });

    if (!entries.length) {
      root.appendChild(el(`<div class="empty-state">${esc(tr('vault_empty'))}</div>`));
      return;
    }

    const TYPE_LABEL = { password: tr('vault_type_password'), note: tr('vault_type_note'), card: tr('vault_type_card') };
    const sheet = el(`
      <div class="vault-sheet">
        <div class="vault-sheet-head">
          <span class="vsh-cell">${esc(tr('col_num'))}</span>
          <span class="vsh-cell">${esc(tr('col_type'))}</span>
          <span class="vsh-cell">${esc(tr('col_site'))}</span>
          <span class="vsh-cell">${esc(tr('col_username'))}</span>
          <span class="vsh-cell">${esc(tr('col_password'))}</span>
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
          <span class="vs-cell vs-type" data-label="${esc(tr('col_type'))}"><span class="vs-type-dot vs-type-${esc(entry.type)}"></span>${esc(TYPE_LABEL[entry.type] || entry.type)}</span>
          <span class="vs-cell" data-label="${esc(tr('col_site'))}">${esc(entry.site)}</span>
          <span class="vs-cell" data-label="${esc(tr('col_username'))}">${esc(entry.username) || '—'}</span>
          <span class="vs-cell vs-pwd" data-label="${esc(tr('col_password'))}" data-pwd>${entry.type === 'note' ? esc(tr('vault_secure_note')) : '••••••••'}</span>
          <span class="vs-cell vs-actions">
            ${entry.hasTotp ? `<button class="btn btn-sm btn-icon" data-totp title="${esc(tr('title_totp_code'))}">${iconaLinea('codice')}</button>` : ''}
            <button class="btn btn-sm btn-icon" data-reveal title="${esc(tr('title_show'))}">${iconaLinea('occhio')}</button>
            <button class="btn btn-sm btn-icon" data-edit title="${esc(tr('btn_edit'))}">${iconaLinea('matita')}</button>
            <button class="btn btn-sm btn-icon" data-link title="${esc(tr('btn_link_folder'))}">${iconaLinea('cartellaLinea')}</button>
            <button class="btn btn-sm btn-icon btn-danger" data-del title="${esc(tr('btn_delete'))}">${iconaLinea('cestino')}</button>
          </span>
        </div>
      `);
      let revealed = false;
      const revealBtn = row.querySelector('[data-reveal]');
      revealBtn.addEventListener('click', async () => {
        const pwdEl = row.querySelector('[data-pwd]');
        if (!revealed) {
          const full = await api(`/vault/${entry.id}/reveal`);
          pwdEl.textContent = entry.type === 'card'
            ? tr('vault_card_cvv_inline', { password: full.password || tr('vault_empty_value'), cvv: full.cvv || '—' })
            : (full.password || tr('vault_empty_value'));
          revealed = true;
          revealBtn.innerHTML = iconaLinea('occhio-off');
          revealBtn.title = tr('title_hide');
        } else {
          pwdEl.textContent = entry.type === 'note' ? tr('vault_secure_note') : '••••••••';
          revealed = false;
          revealBtn.innerHTML = iconaLinea('occhio');
          revealBtn.title = tr('title_show');
        }
      });
      if (entry.hasTotp) {
        let totpTimer = null;
        const totpBtn = row.querySelector('[data-totp]');
        totpBtn.addEventListener('click', async () => {
          if (totpTimer) {
            clearInterval(totpTimer);
            totpTimer = null;
            row.querySelector('[data-pwd]').textContent = entry.type === 'note' ? tr('vault_secure_note') : (revealed ? row.querySelector('[data-pwd]').textContent : '••••••••');
            totpBtn.innerHTML = iconaLinea('codice');
            totpBtn.title = tr('title_totp_code');
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
              pwdEl.textContent = tr('vault_code_unavailable');
            }
          };
          await showCode();
          totpTimer = setInterval(showCode, 1000);
          totpBtn.innerHTML = iconaLinea('occhio-off');
          totpBtn.title = tr('title_hide_code');
        });
      }
      row.querySelector('[data-edit]').addEventListener('click', () => {
        const form = vaultModal(entry);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          await api(`/vault/${entry.id}`, { method: 'PUT', body: JSON.stringify(collectVaultPayload(form, entry)) });
          closeModal(); toast(tr('toast_vault_updated')); render('vault');
        });
        form.querySelector('[data-cancel]').addEventListener('click', closeModal);
        openModal(tr('modal_edit_vault_entry'), form);
      });
      row.querySelector('[data-link]').addEventListener('click', () => openLinkToDossierModal('vault', entry.id, entry.site));
      row.querySelector('[data-del]').addEventListener('click', async () => {
        if (!confirm(tr('confirm_delete_vault_entry'))) return;
        await api(`/vault/${entry.id}`, { method: 'DELETE' });
        toast(tr('toast_vault_deleted')); render('vault');
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
    '': tr('billing_unspecified'),
    settimanale: tr('billing_weekly'),
    mensile: tr('billing_monthly'),
    trimestrale: tr('billing_quarterly'),
    semestrale: tr('billing_semiannual'),
    annuale: tr('billing_annual'),
    una_tantum: tr('billing_onetime'),
  };

  // Cosa serve per individuare il rinnovo dipende dalla cadenza: settimanale
  // vuole solo il giorno della settimana, mensile solo il giorno del mese,
  // trimestrale/semestrale/annuale vogliono giorno+mese di riferimento (per
  // sapere in quale dei periodi dell'anno cade). "day"/"month" hanno quindi
  // un significato diverso a seconda di "frequency" — vedi il form in
  // accountModal() per quali campi si vedono in ciascun caso.
  const BILLING_STEP_MONTHS = { trimestrale: 3, semestrale: 6, annuale: 12 };
  // Ricalcola la data da zero a ogni passo invece di sommare mese dopo mese
  // sulla stessa istanza: altrimenti un giorno che non esiste in un mese
  // intermedio (es. 31 a settembre, che Date normalizza a 1 ottobre) trascina
  // la ricorrenza su un giorno diverso per tutte le occorrenze successive.
  function monthlyOccurrence(anchorYear, anchorMonth0, offsetMonths, day) {
    const total = anchorYear * 12 + anchorMonth0 + offsetMonths;
    return new Date(Math.floor(total / 12), ((total % 12) + 12) % 12, day);
  }
  function nextRenewalDate(day, month, frequency) {
    if (!day) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (frequency === 'settimanale') {
      // day: 1 = Lunedi' ... 7 = Domenica (stessa convenzione di WEEKDAY_LABELS).
      const todayIso = ((today.getDay() + 6) % 7) + 1;
      const candidate = new Date(today);
      candidate.setDate(candidate.getDate() + ((day - todayIso + 7) % 7));
      return candidate;
    }
    if (frequency === 'mensile') {
      // day: giorno del mese, nessun mese di riferimento necessario.
      let candidate = new Date(today.getFullYear(), today.getMonth(), day);
      if (candidate < today) candidate = new Date(today.getFullYear(), today.getMonth() + 1, day);
      return candidate;
    }
    // trimestrale / semestrale / annuale (o cadenza non riconosciuta, trattata
    // come annuale in assenza di altra informazione): serve anche il mese.
    if (!month) return null;
    const stepMonths = BILLING_STEP_MONTHS[frequency] || 12;
    const anchorYear = today.getFullYear() - 1;
    const anchorMonth0 = month - 1;
    let offset = 0;
    let candidate = monthlyOccurrence(anchorYear, anchorMonth0, offset, day);
    while (candidate < today) {
      offset += stepMonths;
      candidate = monthlyOccurrence(anchorYear, anchorMonth0, offset, day);
    }
    return candidate;
  }

  function accountModal(existing) {
    const form = el(`
      <form class="modal-body" style="padding:0">
        <div class="form-row"><label>${esc(tr('field_service'))}</label><input type="text" name="service" required /></div>
        <div class="form-row"><label>${esc(tr('field_type'))}</label>
          <select name="type">
            <option value="digitale">${esc(tr('account_type_digital'))}</option>
            <option value="cartaceo">${esc(tr('account_type_paper'))}</option>
          </select>
        </div>
        <div data-type-fields="digitale">
          <div class="form-row"><label>${esc(tr('field_email'))}</label><input type="text" name="email" /></div>
          <div class="form-row"><label>${esc(tr('field_plan'))}</label><input type="text" name="plan" /></div>
        </div>
        <div data-type-fields="cartaceo">
          <div class="form-row"><label>${esc(tr('field_location'))}</label><input type="text" name="location" placeholder="${esc(tr('field_location_placeholder'))}" /></div>
          <div class="form-row"><label>${esc(tr('field_payment_method'))}</label><input type="text" name="payment_method" placeholder="${esc(tr('field_payment_method_placeholder'))}" /></div>
        </div>
        <div class="form-row"><label>${esc(tr('field_billing_frequency'))}</label>
          <select name="billing_frequency">
            ${Object.entries(BILLING_LABELS).map(([v, label]) => `<option value="${v}">${esc(label)}</option>`).join('')}
          </select>
        </div>
        <div class="form-row"><label>${esc(tr('field_amount'))}</label><input type="number" name="amount" step="0.01" min="0" placeholder="${esc(tr('field_amount_placeholder'))}" /></div>
        <div class="form-row"><label>${esc(tr('field_start_date_optional'))}</label><input type="date" name="start_date" /></div>
        <div data-billing-fields="settimanale" class="form-row">
          <label>${esc(tr('renewal_weekday_label'))}</label>
          <select name="renewal_weekday">
            <option value="">—</option>
            ${WEEKDAY_LABELS_FULL.map((w, i) => `<option value="${i + 1}">${esc(w)}</option>`).join('')}
          </select>
        </div>
        <div data-billing-fields="mensile" class="form-row">
          <label>${esc(tr('renewal_monthday_label'))}</label>
          <select name="renewal_monthday">
            <option value="">—</option>
            ${Array.from({ length: 31 }, (_, i) => i + 1).map((d) => `<option value="${d}">${d}</option>`).join('')}
          </select>
        </div>
        <div data-billing-fields="trimestrale semestrale annuale" class="form-row">
          <label>${esc(tr('renewal_daymonth_label'))}</label>
          <div style="display:flex;gap:8px">
            <select name="renewal_day" style="flex:1">
              <option value="">${esc(tr('field_day'))}</option>
              ${Array.from({ length: 31 }, (_, i) => i + 1).map((d) => `<option value="${d}">${d}</option>`).join('')}
            </select>
            <select name="renewal_month" style="flex:2">
              <option value="">${esc(tr('field_month'))}</option>
              ${MONTH_LABELS.map((m, i) => `<option value="${i + 1}">${esc(m)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-row"><label>${esc(tr('field_notes'))}</label><textarea name="notes" rows="3"></textarea></div>
        <div class="form-row"><label>${esc(tr('field_tags'))}</label><input type="text" name="tags" /></div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-cancel>${esc(tr('btn_cancel'))}</button>
          <button type="submit" class="btn btn-primary">${esc(tr('btn_save'))}</button>
        </div>
      </form>
    `);
    function syncTypeFields() {
      form.querySelectorAll('[data-type-fields]').forEach((group) => {
        group.classList.toggle('hidden', group.dataset.typeFields !== form.type.value);
      });
    }
    function syncBillingFields() {
      form.querySelectorAll('[data-billing-fields]').forEach((group) => {
        group.classList.toggle('hidden', !group.dataset.billingFields.split(' ').includes(form.billing_frequency.value));
      });
    }
    form.type.addEventListener('change', syncTypeFields);
    form.billing_frequency.addEventListener('change', syncBillingFields);
    if (existing) {
      form.service.value = existing.service;
      form.type.value = existing.type || 'digitale';
      form.email.value = existing.email;
      form.plan.value = existing.plan;
      form.location.value = existing.location || '';
      form.payment_method.value = existing.payment_method || '';
      form.billing_frequency.value = existing.billing_frequency || '';
      form.amount.value = existing.amount != null ? existing.amount : '';
      form.start_date.value = existing.start_date ? existing.start_date.slice(0, 10) : '';
      // "day" ha un significato diverso a seconda della frequenza: si ripopola
      // solo il campo che corrisponde a quella gia' salvata.
      if (existing.billing_frequency === 'settimanale') form.renewal_weekday.value = existing.renewal_day || '';
      else if (existing.billing_frequency === 'mensile') form.renewal_monthday.value = existing.renewal_day || '';
      else { form.renewal_day.value = existing.renewal_day || ''; form.renewal_month.value = existing.renewal_month || ''; }
      form.notes.value = existing.notes;
      form.tags.value = (existing.tags || []).join(', ');
    }
    syncTypeFields();
    syncBillingFields();
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
          <span>${tr('credentials_linked_label', { label: esc(account.vaultEntry.site) + (account.vaultEntry.username ? ' · ' + esc(account.vaultEntry.username) : '') })}</span>
          <button class="btn btn-sm btn-danger">${esc(tr('btn_unlink'))}</button>
        </div>
      `);
      current.querySelector('button').addEventListener('click', async () => {
        await api(`/accounts/${account.id}`, { method: 'PUT', body: JSON.stringify({ vault_entry_id: null }) });
        toast(tr('toast_credentials_unlinked'));
        closeModal(); render('accounts');
      });
      wrap.appendChild(current);
    }
    if (!entries.length) {
      wrap.appendChild(el(`<p class="card-sub">${esc(tr('vault_none_yet'))}</p>`));
    } else {
      entries.forEach((v) => {
        const row = el(`
          <div class="trash-row row-card">
            <span>${esc(v.site)}${v.username ? ' · ' + esc(v.username) : ''}</span>
            <button class="btn btn-sm btn-primary">${esc(tr('btn_link'))}</button>
          </div>
        `);
        row.querySelector('button').addEventListener('click', async () => {
          await api(`/accounts/${account.id}`, { method: 'PUT', body: JSON.stringify({ vault_entry_id: v.id }) });
          toast(tr('toast_credentials_linked', { site: v.site }));
          closeModal(); render('accounts');
        });
        wrap.appendChild(row);
      });
    }
    openModal(tr('modal_link_credentials'), wrap);
  }

  views.accounts = async (root, opts = {}) => {
    const highlightId = opts.highlight ? String(opts.highlight) : null;
    const accounts = (await api('/accounts')).filter(onlyFilter(opts));
    root.innerHTML = '';
    root.appendChild(el(`
      <div class="view-header">
        <h2>${esc(tr('nav_accounts_title'))}</h2>
        <div class="view-header-actions">${backToDossierButtonHtml(opts)}<button class="btn btn-primary" id="new-account">${esc(tr('btn_new_account'))}</button></div>
      </div>
    `));
    wireBackToDossier(root, opts);

    // "day"/"month" hanno un significato diverso a seconda della frequenza
    // scelta (vedi accountModal): qui si sceglie quale campo del form leggere.
    function renewalPayload(form) {
      const freq = form.billing_frequency.value;
      if (freq === 'settimanale') return { renewal_day: form.renewal_weekday.value || null, renewal_month: null };
      if (freq === 'mensile') return { renewal_day: form.renewal_monthday.value || null, renewal_month: null };
      return { renewal_day: form.renewal_day.value || null, renewal_month: form.renewal_month.value || null };
    }
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
        start_date: form.start_date.value || null,
        ...renewalPayload(form),
        notes: form.notes.value,
        tags: parseTags(form),
      };
    }

    root.querySelector('#new-account').addEventListener('click', () => {
      const form = accountModal();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await api('/accounts', { method: 'POST', body: JSON.stringify(accountPayload(form)) });
        closeModal(); toast(tr('toast_account_saved')); render('accounts');
      });
      form.querySelector('[data-cancel]').addEventListener('click', closeModal);
      openModal(tr('modal_new_account'), form);
    });

    if (!accounts.length) {
      root.appendChild(el(`<div class="empty-state">${esc(tr('empty_accounts'))}</div>`));
      return;
    }

    // Prossimo rinnovo in assoluto tra tutti gli abbonamenti, per la vista
    // riassuntiva in cima. L'ordine della griglia sotto segue lo stesso
    // criterio: chi rinnova prima compare prima. Non ha senso quando si sta
    // gia' guardando un solo abbonamento arrivando da una cartella.
    if (!opts.only) {
      const withRenewal = accounts
        .map((a) => ({ a, next: nextRenewalDate(a.renewal_day, a.renewal_month, a.billing_frequency) }))
        .filter((x) => x.next);
      withRenewal.sort((x, y) => x.next - y.next);
      if (withRenewal.length) {
        const soonest = withRenewal[0];
        const days = daysUntil(soonest.next.toISOString().slice(0, 10));
        const dayLabel = days === 0 ? tr('today_lc') : days === 1 ? tr('due_tomorrow') : tr('due_in_n', { n: days, unit: tr('day_other') });
        root.appendChild(el(`
          <div class="section-block" style="margin-bottom:14px">
            <p class="card-sub" style="margin-bottom:4px">${esc(tr('next_renewal_title'))}</p>
            <p class="card-title" style="font-size:1rem">${tr('next_renewal_line', { service: esc(soonest.a.service), day: soonest.next.getDate(), month: esc(MONTH_LABELS[soonest.next.getMonth()]), when: esc(dayLabel) })}</p>
          </div>
        `));
      }
      const renewalOrder = new Map(withRenewal.map((x, i) => [x.a.id, i]));
      accounts.sort((a, b) => {
        const ra = renewalOrder.has(a.id) ? renewalOrder.get(a.id) : Infinity;
        const rb = renewalOrder.has(b.id) ? renewalOrder.get(b.id) : Infinity;
        return ra - rb;
      });
    }

    const grid = el('<div class="grid"></div>');
    accounts.forEach((a) => {
      const isCartaceo = a.type === 'cartaceo';
      const next = nextRenewalDate(a.renewal_day, a.renewal_month, a.billing_frequency);
      // "renewal_day"/"renewal_month" hanno un significato diverso a seconda
      // della frequenza (vedi nextRenewalDate): per mostrarli si usa sempre
      // la prossima data vera e propria gia' calcolata, mai i campi grezzi.
      const renewalLabel = next
        ? tr('field_renewal_label', { day: next.getDate(), month: esc(MONTH_LABELS[next.getMonth()]), when: tr('due_in_n', { n: daysUntil(next.toISOString().slice(0, 10)), unit: tr('day_other') }) })
        : '';
      const card = el(`
        <div class="card">
          <span class="tag tag-neutral" style="width:fit-content">${isCartaceo ? esc(tr('account_type_paper')) : esc(tr('account_type_digital'))}</span>
          <p class="card-title">${esc(a.service)}</p>
          ${isCartaceo
            ? `<p class="card-sub">${esc(a.location) || '—'}${a.payment_method ? ' · ' + esc(a.payment_method) : ''}</p>`
            : `<p class="card-sub">${esc(a.email) || '—'} ${a.plan ? '· ' + esc(a.plan) : ''}</p>`}
          ${a.billing_frequency || a.amount != null
            ? `<p class="card-sub">${a.billing_frequency ? esc(BILLING_LABELS[a.billing_frequency] || a.billing_frequency) : ''}${a.billing_frequency && a.amount != null ? ' · ' : ''}${a.amount != null ? fmtMoney(a.amount) : ''}</p>`
            : ''}
          ${a.start_date ? `<p class="card-sub">${tr('field_start_date_label', { date: fmtDate(a.start_date) })}</p>` : ''}
          ${renewalLabel ? `<p class="card-sub">${renewalLabel}</p>` : ''}
          ${a.vaultEntry ? `<p class="card-sub">${tr('credentials_prefix', { label: esc(a.vaultEntry.site) + (a.vaultEntry.username ? ' · ' + esc(a.vaultEntry.username) : '') })}</p>` : ''}
          <div class="tag-row">${(a.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
          <div class="card-actions">
            <button class="btn btn-sm" data-edit>${esc(tr('btn_edit'))}</button>
            <button class="btn btn-sm" data-link>${esc(tr('btn_link_folder'))}</button>
            <button class="btn btn-sm" data-vault>${a.vaultEntry ? esc(tr('btn_change_credentials')) : esc(tr('btn_link_credentials'))}</button>
            <button class="btn btn-sm btn-danger" data-del>${esc(tr('btn_delete'))}</button>
          </div>
        </div>
      `);
      card.querySelector('[data-edit]').addEventListener('click', () => {
        const form = accountModal(a);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          await api(`/accounts/${a.id}`, { method: 'PUT', body: JSON.stringify(accountPayload(form)) });
          closeModal(); toast(tr('toast_account_updated')); render('accounts');
        });
        form.querySelector('[data-cancel]').addEventListener('click', closeModal);
        openModal(tr('modal_edit_account'), form);
      });
      card.querySelector('[data-link]').addEventListener('click', () => openLinkToDossierModal('account', a.id, a.service));
      card.querySelector('[data-vault]').addEventListener('click', () => openLinkVaultModal(a));
      card.querySelector('[data-del]').addEventListener('click', async () => {
        if (!confirm(tr('confirm_delete_account'))) return;
        await api(`/accounts/${a.id}`, { method: 'DELETE' });
        toast(tr('toast_account_deleted')); render('accounts');
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
  function dossierSelectOptions(dossiers, selectedId) {
    return `<option value="">${esc(tr('dossier_select_none'))}</option>` + dossiers.map((ds) =>
      `<option value="${ds.id}"${String(ds.id) === String(selectedId) ? ' selected' : ''}>${esc(ds.title)}</option>`
    ).join('');
  }

  function documentModal(existing, dossiers, currentDossierId) {
    const form = el(`
      <form class="modal-body" style="padding:0">
        <div class="form-row"><label>${esc(tr('field_display_name'))}</label><input type="text" name="display_name" placeholder="${esc(tr('field_display_name_placeholder'))}" /></div>
        <p class="card-sub" style="margin:-6px 0 0">${tr('original_file_label', { name: esc(existing.original_name) })}</p>
        <div class="form-row"><label>${esc(tr('field_folder'))}</label><select name="dossier_id">${dossierSelectOptions(dossiers, currentDossierId)}</select></div>
        <div class="form-row"><label>${esc(tr('field_expiry_optional'))}</label><input type="date" name="expiry_date" /></div>
        <div class="form-row"><label>${esc(tr('field_tags'))}</label><input type="text" name="tags" /></div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-cancel>${esc(tr('btn_cancel'))}</button>
          <button type="submit" class="btn btn-primary">${esc(tr('btn_save'))}</button>
        </div>
      </form>
    `);
    form.display_name.value = existing.display_name || '';
    form.expiry_date.value = existing.expiry_date ? existing.expiry_date.slice(0, 10) : '';
    form.tags.value = (existing.tags || []).join(', ');
    return form;
  }

  // Riallinea i collegamenti cartella di un elemento a un solo id selezionato
  // da un menu a tendina (scollega gli altri, collega quello nuovo se manca).
  async function setSingleDossierLink(itemType, itemId, currentDossierIds, newDossierId) {
    const targets = currentDossierIds.filter((id) => String(id) !== String(newDossierId));
    await Promise.all(targets.map((id) => api(`/dossiers/${id}/links/${itemType}/${itemId}`, { method: 'DELETE' })));
    if (newDossierId && !currentDossierIds.some((id) => String(id) === String(newDossierId))) {
      await api(`/dossiers/${newDossierId}/links`, { method: 'POST', body: JSON.stringify({ item_type: itemType, item_id: itemId }) });
    }
  }

  views.drive = async (root, opts = {}) => {
    const highlightId = opts.highlight ? String(opts.highlight) : null;
    const [docsAll, dossiers] = await Promise.all([api('/drive'), api('/dossiers')]);
    const docs = docsAll.filter(onlyFilter(opts));
    // Documento -> cartelle a cui e' collegato (di norma una sola, il menu a
    // tendina tratta il collegamento come singolo anche se il modello dati
    // sotto permetterebbe piu' cartelle per lo stesso elemento).
    const docDossiers = {};
    dossiers.forEach((ds) => {
      ds.items.forEach((it) => {
        if (it.type === 'document') (docDossiers[it.id] ||= []).push(ds);
      });
    });
    root.innerHTML = '';
    root.appendChild(el(`
      <div class="view-header">
        <h2>${esc(tr('nav_drive_title'))}</h2>
        <div class="view-header-actions">${backToDossierButtonHtml(opts)}<button class="btn btn-primary" id="new-doc">${esc(tr('btn_upload_document'))}</button></div>
      </div>
    `));
    wireBackToDossier(root, opts);

    root.querySelector('#new-doc').addEventListener('click', () => {
      const form = el(`
        <form class="modal-body" style="padding:0">
          <div class="form-row"><label>${esc(tr('field_file'))}</label><input type="file" name="file" required /></div>
          <div class="form-row"><label>${esc(tr('field_display_name'))}</label><input type="text" name="display_name" placeholder="${esc(tr('field_display_name_placeholder'))}" /></div>
          <div class="form-row"><label>${esc(tr('field_folder_optional'))}</label><select name="dossier_id">${dossierSelectOptions(dossiers, '')}</select></div>
          <div class="form-row"><label>${esc(tr('field_expiry_optional'))}</label><input type="date" name="expiry_date" /></div>
          <div class="form-row"><label>${esc(tr('field_tags'))}</label><input type="text" name="tags" /></div>
          <div class="form-actions">
            <button type="button" class="btn btn-ghost" data-cancel>${esc(tr('btn_cancel'))}</button>
            <button type="submit" class="btn btn-primary">${esc(tr('btn_upload'))}</button>
          </div>
        </form>
      `);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const tags = parseTags(form);
        const fd = new FormData();
        fd.append('file', form.file.files[0]);
        fd.append('display_name', form.display_name.value);
        fd.append('expiry_date', form.expiry_date.value || '');
        fd.append('tags', JSON.stringify(tags));
        const doc = await api('/drive', { method: 'POST', body: fd });
        if (form.dossier_id.value) {
          await api(`/dossiers/${form.dossier_id.value}/links`, { method: 'POST', body: JSON.stringify({ item_type: 'document', item_id: doc.id }) });
        }
        closeModal(); toast(tr('toast_document_uploaded')); render('drive');
      });
      form.querySelector('[data-cancel]').addEventListener('click', closeModal);
      openModal(tr('modal_upload_document'), form);
    });

    if (!docs.length) {
      root.appendChild(el(`<div class="empty-state">${esc(tr('empty_documents'))}</div>`));
      return;
    }

    docs.forEach((d) => {
      const ext = (d.original_name.includes('.') ? d.original_name.split('.').pop() : '').toUpperCase().slice(0, 4);
      const previewable = PREVIEWABLE_MIME.has(d.mime);
      const linkedDossiers = docDossiers[d.id] || [];
      const row = el(`
        <div class="doc-row row-card">
          <div style="display:flex;gap:10px;align-items:center;min-width:0">
            <div class="entry-doc${previewable ? ' entry-doc-clickable' : ''}" style="margin-top:0;flex:none">
              ${iconaLinea(fileCategoryIcon(d.mime))}
              <span class="entry-doc-ext">${esc(ext || 'FILE')}</span>
            </div>
            <div style="min-width:0">
              <div class="doc-name">${esc(d.display_name || d.original_name)}</div>
              ${d.display_name ? `<div class="doc-original">${esc(d.original_name)}</div>` : ''}
              <div class="doc-meta">${d.folder ? esc(d.folder) + ' · ' : ''}${fmtSize(d.size)}${d.expiry_date ? tr('doc_expiry_suffix', { date: fmtDate(d.expiry_date) }) : ''}</div>
              ${linkedDossiers.length ? `<div class="doc-dossier">${tr('doc_dossier_link', { names: linkedDossiers.map((ds) => esc(ds.title)).join(', ') })}</div>` : ''}
            </div>
          </div>
          <span class="card-actions" style="padding:0">
            <a class="btn btn-sm" href="/api/drive/${d.id}/download">${esc(tr('btn_download'))}</a>
            <button class="btn btn-sm" data-edit>${esc(tr('btn_edit'))}</button>
            <button class="btn btn-sm btn-danger" data-del>${esc(tr('btn_delete'))}</button>
          </span>
        </div>
      `);
      if (previewable) row.querySelector('.entry-doc').addEventListener('click', () => openDocumentPreview(d));
      row.querySelector('[data-edit]').addEventListener('click', () => {
        const currentIds = linkedDossiers.map((ds) => ds.id);
        const form = documentModal(d, dossiers, currentIds[0] || '');
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const tags = parseTags(form);
          await api(`/drive/${d.id}`, { method: 'PUT', body: JSON.stringify({ display_name: form.display_name.value, expiry_date: form.expiry_date.value || null, tags }) });
          await setSingleDossierLink('document', d.id, currentIds, form.dossier_id.value);
          closeModal(); toast(tr('toast_document_updated')); render('drive');
        });
        form.querySelector('[data-cancel]').addEventListener('click', closeModal);
        openModal(tr('modal_edit_document'), form);
      });
      row.querySelector('[data-del]').addEventListener('click', async () => {
        if (!confirm(tr('confirm_delete_document'))) return;
        await api(`/drive/${d.id}`, { method: 'DELETE' });
        toast(tr('toast_document_deleted')); render('drive');
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
  // Vista Cartelle: griglia a icone stile Esplora Risorse. Livello radice =
  // icona-cartella per ogni dossier; entrando (click) si vede il contenuto
  // collegato come icone del tipo reale (documento/vault/nota/...), stesso
  // set icone gia' usato da menu Avvio/taskbar (appIcon), nessuna nuova
  // icona necessaria. Nessuna sotto-cartella: un solo livello di profondita'.
  views.dossiers = async (root, opts = {}) => {
    const dossiers = await api('/dossiers');
    const highlightId = opts.highlight ? String(opts.highlight) : null;
    root.innerHTML = '';

    const toolbar = el(`
      <div class="explorer-toolbar">
        <button type="button" class="btn" id="explorer-up" disabled>${esc(tr('btn_up'))}</button>
        <span class="explorer-path" id="explorer-path">${esc(tr('nav_dossiers_title'))}</span>
        <button type="button" class="btn btn-primary" id="new-dossier">${esc(tr('btn_new_dossier'))}</button>
        <button type="button" class="btn btn-primary hidden" id="new-item-in-dossier">${esc(tr('btn_new_item'))}</button>
      </div>
    `);
    const gridWrap = el('<div></div>');
    root.appendChild(toolbar);
    root.appendChild(gridWrap);

    const upBtn = toolbar.querySelector('#explorer-up');
    const pathEl = toolbar.querySelector('#explorer-path');
    const newDossierBtn = toolbar.querySelector('#new-dossier');
    const newItemBtn = toolbar.querySelector('#new-item-in-dossier');
    newItemBtn.addEventListener('click', () => openQuickCapture(currentDossier));

    toolbar.querySelector('#new-dossier').addEventListener('click', () => {
      const form = el(`
        <form class="modal-body" style="padding:0">
          <div class="form-row"><label>${esc(tr('field_title'))}</label><input type="text" name="title" required /></div>
          <div class="form-row"><label>${esc(tr('field_description'))}</label><textarea name="description" rows="3"></textarea></div>
          <div class="form-actions">
            <button type="button" class="btn btn-ghost" data-cancel>${esc(tr('btn_cancel'))}</button>
            <button type="submit" class="btn btn-primary">${esc(tr('btn_create'))}</button>
          </div>
        </form>
      `);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await api('/dossiers', { method: 'POST', body: JSON.stringify({ title: form.title.value, description: form.description.value }) });
        closeModal(); toast(tr('toast_dossier_created')); render('dossiers');
      });
      form.querySelector('[data-cancel]').addEventListener('click', closeModal);
      openModal(tr('modal_new_dossier'), form);
    });

    let currentDossier = null;

    function renderRoot() {
      currentDossier = null;
      upBtn.disabled = true;
      pathEl.textContent = tr('nav_dossiers_title');
      newDossierBtn.classList.remove('hidden');
      newItemBtn.classList.add('hidden');
      gridWrap.innerHTML = '';
      if (!dossiers.length) {
        gridWrap.appendChild(el(`<div class="empty-state">${esc(tr('empty_dossiers'))}</div>`));
        return;
      }
      const grid = el('<div class="explorer-grid"></div>');
      dossiers.forEach((d) => {
        const n = d.items.length;
        const icon = el(`
          <button type="button" class="explorer-icon">
            <span class="unlink-badge" data-del title="${esc(tr('title_delete_dossier'))}">✕</span>
            ${appIcon('dossiers', 34)}
            <span class="label">${esc(d.title)}</span>
            <span class="count">${esc(tr(n === 1 ? 'count_items_one' : 'count_items_other', { n }))}</span>
          </button>
        `);
        icon.addEventListener('click', (e) => {
          if (e.target.closest('[data-del]')) return;
          renderDossier(d);
        });
        icon.querySelector('[data-del]').addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm(tr('confirm_delete_dossier'))) return;
          await api(`/dossiers/${d.id}`, { method: 'DELETE' });
          toast(tr('toast_dossier_deleted')); render('dossiers');
        });
        grid.appendChild(icon);
      });
      gridWrap.appendChild(grid);
    }

    function renderDossier(d) {
      currentDossier = d;
      upBtn.disabled = false;
      pathEl.textContent = tr('dossier_path', { title: d.title });
      newDossierBtn.classList.add('hidden');
      newItemBtn.classList.remove('hidden');
      gridWrap.innerHTML = '';
      if (!d.items.length) {
        gridWrap.appendChild(el(`<div class="empty-state">${esc(tr('empty_dossier_items'))}</div>`));
        return;
      }
      const grid = el('<div class="explorer-grid"></div>');
      d.items.forEach((item) => {
        const view = TYPE_TO_VIEW[item.type];
        const icon = el(`
          <button type="button" class="explorer-icon">
            <span class="unlink-badge" data-unlink title="${esc(tr('title_unlink'))}">✕</span>
            ${appIcon(view, 34)}
            <span class="label">${esc(item.label)}</span>
          </button>
        `);
        icon.addEventListener('click', (e) => {
          if (e.target.closest('[data-unlink]')) return;
          if (view) render(view, { only: item.id, fromDossier: d.id });
        });
        icon.querySelector('[data-unlink]').addEventListener('click', async (e) => {
          e.stopPropagation();
          await api(`/dossiers/${d.id}/links/${item.type}/${item.id}`, { method: 'DELETE' });
          toast(tr('toast_item_unlinked')); render('dossiers');
        });
        grid.appendChild(icon);
      });
      gridWrap.appendChild(grid);
    }

    upBtn.addEventListener('click', renderRoot);

    if (highlightId) {
      const match = dossiers.find((d) => String(d.id) === highlightId);
      if (match) { renderDossier(match); return; }
    }
    renderRoot();
  };

  // ==================================================================
  // CESTINO
  // ==================================================================
  const TYPE_LABELS = { idea: tr('type_idea'), project: tr('type_project'), vault: tr('type_vault'), account: tr('type_account'), document: tr('type_document'), dossier: tr('type_dossier'), reminder: tr('type_reminder') };

  views.trash = async (root) => {
    const items = await api('/trash');
    root.innerHTML = '';
    root.appendChild(el(`<div class="view-header"><h2>${esc(tr('nav_trash_title'))}</h2></div>`));

    if (!items.length) {
      root.appendChild(el(`<div class="empty-state">${esc(tr('empty_trash'))}</div>`));
      return;
    }

    items.forEach((item) => {
      const row = el(`
        <div class="trash-row row-card">
          <span><span class="chip-type">${esc(TYPE_LABELS[item.type] || item.type)}</span> &nbsp;${esc(item.label)}</span>
          <span class="card-actions" style="padding:0">
            <button class="btn btn-sm" data-restore>${esc(tr('btn_restore'))}</button>
            <button class="btn btn-sm btn-danger" data-purge>${esc(tr('btn_purge'))}</button>
          </span>
        </div>
      `);
      row.querySelector('[data-restore]').addEventListener('click', async () => {
        await api(`/trash/${item.type}/${item.id}/restore`, { method: 'POST' });
        toast(tr('toast_restored')); render('trash');
      });
      row.querySelector('[data-purge]').addEventListener('click', async () => {
        if (!confirm(tr('confirm_purge'))) return;
        await api(`/trash/${item.type}/${item.id}`, { method: 'DELETE' });
        toast(tr('toast_purged')); render('trash');
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
      <p class="card-sub">${tr('recovery_codes_intro')}</p>
    `));
    const list = el('<div class="recovery-codes"></div>');
    codes.forEach((c) => list.appendChild(el(`<code>${esc(c)}</code>`)));
    wrap.appendChild(list);

    const actions = el('<div class="form-actions"></div>');
    const copy = el(`<button type="button" class="btn btn-ghost">${esc(tr('btn_copy_all'))}</button>`);
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(codes.join('\n'));
        toast(tr('toast_codes_copied'));
      } catch (e) {
        toast(tr('toast_copy_failed'));
      }
    });
    const done = el(`<button type="button" class="btn btn-primary">${esc(tr('btn_codes_saved'))}</button>`);
    done.addEventListener('click', () => { closeModal(); render('security'); });
    actions.appendChild(copy);
    actions.appendChild(done);
    wrap.appendChild(actions);
    openModal(tr('modal_recovery_codes'), wrap);
  }

  function askPassword(title, testo, onConfirm) {
    const form = el(`
      <form class="modal-body" style="padding:0">
        <p class="card-sub">${esc(testo)}</p>
        <div class="form-row"><label>${esc(tr('field_password'))}</label><input type="password" name="password" required /></div>
        <p class="form-error hidden" data-err></p>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-cancel>${esc(tr('btn_cancel'))}</button>
          <button type="submit" class="btn btn-primary">${esc(tr('btn_confirm'))}</button>
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
          <li>${tr('totp_step1')}</li>
          <li>${tr('totp_step2')}</li>
        </ol>
      `));
      const qr = el(`<div class="qr-box">${data.qr}</div>`);
      wrap.appendChild(qr);
      wrap.appendChild(el(`
        <p class="card-sub">${tr('totp_manual_hint')}
        <br /><code class="totp-secret">${esc(data.secret)}</code></p>
      `));

      const form = el(`
        <form class="modal-body" style="padding:0">
          <div class="form-row">
            <label>${esc(tr('totp_code_label'))}</label>
            <input type="text" name="code" inputmode="numeric" maxlength="7" placeholder="123456" required />
          </div>
          <p class="form-error hidden" data-err></p>
          <div class="form-actions">
            <button type="button" class="btn btn-ghost" data-cancel>${esc(tr('btn_cancel'))}</button>
            <button type="submit" class="btn btn-primary">${esc(tr('btn_activate'))}</button>
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
          toast(tr('toast_totp_enabled'));
          showRecoveryCodes(res.recoveryCodes);
        } catch (err) {
          errEl.textContent = err.message;
          errEl.classList.remove('hidden');
        }
      });
      form.querySelector('[data-cancel]').addEventListener('click', closeModal);
      wrap.appendChild(form);
      openModal(tr('modal_activate_totp'), wrap);
    });
  }

  views.security = async (root) => {
    const info = await api('/security');
    root.innerHTML = '';
    root.appendChild(el(`<div class="view-header"><h2>${esc(tr('nav_security_title'))}</h2></div>`));

    const block = el(`<div class="section-block"><h3>${esc(tr('section_2fa'))}</h3></div>`);

    if (!info.totpEnabled) {
      block.appendChild(el(`
        <p class="card-sub">${esc(tr('totp_disabled_hint'))}</p>
      `));
      const btn = el(`<button class="btn btn-primary">${esc(tr('btn_activate_qr'))}</button>`);
      btn.addEventListener('click', startTotpSetup);
      block.appendChild(btn);
    } else {
      block.appendChild(el(`
        <p class="card-sub">${esc(tr('totp_enabled_hint'))}</p>
        <p class="card-sub">${tr('recovery_codes_left', { n: info.recoveryCodesLeft })}</p>
      `));
      const actions = el('<div class="card-actions" style="padding:12px 0 0"></div>');

      const nuovi = el(`<button class="btn btn-sm">${esc(tr('btn_new_recovery_codes'))}</button>`);
      nuovi.addEventListener('click', () => {
        askPassword(
          tr('modal_new_recovery_codes'),
          tr('confirm_new_recovery_codes'),
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

      const off = el(`<button class="btn btn-sm btn-danger">${esc(tr('btn_deactivate'))}</button>`);
      off.addEventListener('click', () => {
        askPassword(
          tr('modal_deactivate_totp'),
          tr('confirm_deactivate_totp'),
          async (password) => {
            await api('/security/totp/disable', { method: 'POST', body: JSON.stringify({ password }) });
            closeModal();
            toast(tr('toast_totp_disabled'));
            render('security');
          }
        );
      });

      actions.appendChild(nuovi);
      actions.appendChild(off);
      block.appendChild(actions);

      if (info.recoveryCodesLeft === 0) {
        block.appendChild(el(`
          <p class="form-error">${esc(tr('recovery_codes_zero_warning'))}</p>
        `));
      }
    }

    root.appendChild(block);

    const notifyBlock = el(`<div class="section-block"><h3>${esc(tr('section_push_notifications'))}</h3></div>`);
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    if (!supported) {
      notifyBlock.appendChild(el(`<p class="card-sub">${esc(tr('push_not_supported'))}</p>`));
    } else {
      const existingSub = await getPushSubscription();
      if (Notification.permission === 'denied') {
        notifyBlock.appendChild(el(`
          <p class="card-sub">${esc(tr('push_blocked'))}</p>
        `));
      } else if (existingSub) {
        notifyBlock.appendChild(el(`
          <p class="card-sub">${esc(tr('push_active_hint'))}</p>
        `));
        const off = el(`<button class="btn btn-sm btn-danger">${esc(tr('btn_deactivate'))}</button>`);
        off.addEventListener('click', async () => {
          await disablePushNotifications();
          toast(tr('toast_push_disabled')); render('security');
        });
        notifyBlock.appendChild(off);
      } else {
        notifyBlock.appendChild(el(`
          <p class="card-sub">${esc(tr('push_inactive_hint'))}</p>
        `));
        const on = el(`<button class="btn btn-primary">${esc(tr('btn_enable_notifications'))}</button>`);
        on.addEventListener('click', async () => {
          try {
            await enablePushNotifications();
            toast(tr('toast_push_enabled')); render('security');
          } catch (err) {
            toast(err.message);
          }
        });
        notifyBlock.appendChild(on);
      }
    }
    root.appendChild(notifyBlock);

    const wallpaperBlock = el(`<div class="section-block"><h3>${esc(tr('section_wallpaper'))}</h3><p class="card-sub">${esc(tr('wallpaper_device_only'))}</p></div>`);
    const wallpaperRow = el('<div class="card-actions" style="padding-top:10px"></div>');
    Object.entries(WALLPAPERS).forEach(([key, wp]) => {
      const btn = el(`<button class="btn btn-sm${key === currentWallpaper() ? ' btn-primary' : ''}" data-wp="${key}"></button>`);
      btn.textContent = wp.label;
      btn.addEventListener('click', () => { applyWallpaper(key); render('security'); });
      wallpaperRow.appendChild(btn);
    });
    wallpaperBlock.appendChild(wallpaperRow);
    root.appendChild(wallpaperBlock);

    const langBlock = el(`<div class="section-block"><h3>${esc(tr('settings_language'))}</h3><p class="card-sub">${esc(tr('settings_language_hint'))}</p></div>`);
    const langRow = el('<div class="card-actions" style="padding-top:10px"></div>');
    [['it', 'Italiano'], ['en', 'English']].forEach(([code, label]) => {
      const btn = el(`<button class="btn btn-sm${code === I18N.getLang() ? ' btn-primary' : ''}" data-lang="${code}"></button>`);
      btn.textContent = label;
      btn.addEventListener('click', () => { I18N.setLang(code); location.reload(); });
      langRow.appendChild(btn);
    });
    langBlock.appendChild(langRow);
    root.appendChild(langBlock);

    const help = el(`<div class="section-block"><h3>${esc(tr('section_lost_phone'))}</h3></div>`);
    help.appendChild(el(`
      <p class="card-sub">${esc(tr('lost_phone_hint'))}</p>
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

  // La ricerca sta sempre dietro l'icona lente in taskbar (desktop e mobile
  // allo stesso modo): al tocco apre la barra in cima, libera lo spazio
  // quando non serve.
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
        searchResults.appendChild(el(`<div class="search-result-item">${esc(tr('no_results'))}</div>`));
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
    const msg = e.reason && e.reason.message ? e.reason.message : tr('err_unexpected');
    if (msg !== tr('err_session_expired')) toast(msg);
    e.preventDefault();
  });

  // Versione applicativa: si vede sia prima sia dopo l'accesso. Il commit
  // (quando disponibile: non su una build locale senza GIT_SHA) si vede
  // solo qui, cosi' dopo un aggiornamento si controlla subito se il
  // container sta girando sull'ultimo codice o su una build vecchia.
  api('/health').then((health) => {
    const label = health.build && health.build !== 'dev'
      ? tr('version_label_build', { version: health.version, build: health.build })
      : tr('version_label', { version: health.version });
    const authEl = document.getElementById('auth-version');
    const sidebarEl = document.getElementById('sidebar-version');
    if (authEl) authEl.textContent = label;
    if (sidebarEl) sidebarEl.textContent = label;
  }).catch(() => {});

  // ---------------- Avvio ----------------
  // La lingua si sceglie una volta sola, al primissimo avvio del
  // dispositivo, prima ancora che esista un account (non ha senso chiederla
  // di nuovo a ogni accesso di chi ha gia' scelto, ne' ha senso mostrarla a
  // chi ha gia' un account creato prima che questa schermata esistesse:
  // quelli restano semplicemente in italiano finche' non la cambiano da
  // Sicurezza).
  const langScreen = document.getElementById('lang-screen');
  function startAfterLanguage() {
    I18N.applyStaticTranslations();
    checkAuth().catch((err) => {
      authError.textContent = err.message;
      authError.classList.remove('hidden');
      showAuthScreen();
    });
  }
  if (I18N.hasChosenLang()) {
    startAfterLanguage();
  } else {
    langScreen.classList.remove('hidden');
    langScreen.querySelectorAll('[data-lang]').forEach((btn) => {
      btn.addEventListener('click', () => {
        I18N.setLang(btn.dataset.lang);
        // Un ricaricamento vero, non solo un re-render: titoli finestra, mesi,
        // giorni della settimana ecc. sono costanti calcolate una volta sola
        // all'avvio dello script (prima ancora che questa scelta esistesse),
        // quindi restano nella lingua di default finche' lo script non riparte.
        location.reload();
      });
    });
  }
})();
