(() => {
  'use strict';

  const output = document.getElementById('cli-output');
  const input = document.getElementById('cli-input');
  const prompt = document.getElementById('cli-prompt');
  const screen = document.getElementById('cli-screen');

  function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function print(text, cls) {
    const line = document.createElement('div');
    line.className = 'cli-line' + (cls ? ' ' + cls : '');
    line.innerHTML = esc(text);
    output.appendChild(line);
    screen.scrollTop = screen.scrollHeight;
  }

  function printEcho(text) {
    print(`${promptSymbol()} ${text}`, 'cli-echo');
  }

  function promptSymbol() {
    return prompt.textContent;
  }

  async function api(path, opts = {}) {
    const res = await fetch('/api' + path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    let body = null;
    try { body = await res.json(); } catch (e) { /* corpo vuoto, es. 204 */ }
    if (!res.ok) {
      const err = new Error((body && body.error) || `Errore ${res.status}`);
      if (body && body.totpRequired) err.totpRequired = true;
      throw err;
    }
    return body;
  }

  // ---------------- Login testuale ----------------
  // mode: 'username' | 'password' | 'totp' | 'ready'
  let mode = 'username';
  let pendingUsername = '';
  let pendingPassword = '';

  function askUsername() {
    mode = 'username';
    input.type = 'text';
    prompt.textContent = 'username:';
  }
  function askPassword() {
    mode = 'password';
    input.type = 'password';
    prompt.textContent = 'password:';
  }
  function askTotp() {
    mode = 'totp';
    input.type = 'text';
    prompt.textContent = 'codice 2FA:';
  }
  function ready(username) {
    mode = 'ready';
    input.type = 'text';
    prompt.textContent = '>';
    print(`Bentornato, ${username}. Scrivi "help" per i comandi.`, 'cli-info');
  }

  async function boot() {
    print('Mindkeep — accesso da riga di comando', 'cli-banner');
    try {
      const status = await api('/auth/status');
      if (status.authenticated) {
        // La sessione (stesso browser) e' gia' valida: non richiede di nuovo le credenziali.
        ready(status.username || 'utente');
        return;
      }
      if (status.setupNeeded) {
        print('Nessun utente configurato: crea prima un accesso dall\'interfaccia grafica.', 'cli-error');
      }
    } catch (e) {
      print('Impossibile contattare il server.', 'cli-error');
    }
    askUsername();
  }

  async function handleLogin(value) {
    if (mode === 'username') {
      pendingUsername = value.trim();
      printEcho(pendingUsername);
      askPassword();
      return;
    }
    if (mode === 'password') {
      pendingPassword = value;
      printEcho('••••••••');
      try {
        await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: pendingUsername, password: pendingPassword }) });
        ready(pendingUsername);
      } catch (err) {
        if (err.totpRequired) { print(err.message, 'cli-info'); askTotp(); return; }
        print(err.message, 'cli-error');
        pendingPassword = '';
        askUsername();
      }
      return;
    }
    if (mode === 'totp') {
      printEcho(value.trim());
      try {
        await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: pendingUsername, password: pendingPassword, code: value.trim() }) });
        ready(pendingUsername);
      } catch (err) {
        print(err.message, 'cli-error');
        if (err.totpRequired) { askTotp(); return; } // codice sbagliato: ritenta senza richiedere di nuovo la password
        askUsername();
      }
    }
  }

  // ---------------- Cronologia comandi (frecce su/giu', persistente) ----------------
  const HISTORY_KEY = 'mindkeep-cli-history';
  const MAX_HISTORY = 100;
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (e) { return []; }
  }
  function pushHistory(cmd) {
    const history = loadHistory();
    history.push(cmd);
    while (history.length > MAX_HISTORY) history.shift();
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch (e) { /* storage non disponibile: pazienza */ }
  }
  let historyIndex = loadHistory().length;

  // ---------------- "Forse intendevi...?" per i comandi "/" sbagliati ----------------
  function levenshtein(a, b) {
    const track = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));
    for (let i = 0; i <= a.length; i++) track[0][i] = i;
    for (let j = 0; j <= b.length; j++) track[j][0] = j;
    for (let j = 1; j <= b.length; j++) {
      for (let i = 1; i <= a.length; i++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        track[j][i] = Math.min(track[j][i - 1] + 1, track[j - 1][i] + 1, track[j - 1][i - 1] + cost);
      }
    }
    return track[b.length][a.length];
  }
  const KNOWN_SLASH_COMMANDS = ['/progetto', '/scadenza'];

  // ---------------- Comandi ----------------
  const HELP = [
    ['<testo>', 'nuova idea nel Flusso'],
    ['/progetto <titolo>', 'nuovo progetto'],
    ['/scadenza <testo> il <AAAA-MM-GG>', 'nuovo promemoria'],
    ['... @<fascicolo>', 'collega alla fine di uno qualsiasi dei precedenti'],
    ['... #<tag> #<tag2>', 'aggiunge tag (solo idee)'],
    ['whoami', 'utente collegato'],
    ['logout', 'chiude la sessione'],
    ['clear', 'pulisce lo schermo'],
    ['gui', 'apre l\'interfaccia grafica'],
    ['↑ / ↓', 'richiama i comandi precedenti'],
    ['TAB', 'completa /progetto, /scadenza'],
  ];

  // Estrae "#tag" e "@fascicolo" da una riga: il fascicolo e' tutto cio' che
  // segue l'ultima "@" (i nomi dei fascicoli possono contenere spazi), i tag
  // sono parole singole precedute da "#".
  function extractTagsAndDossier(raw) {
    let text = raw;
    const tags = [];
    text = text.replace(/#([a-zA-Z0-9_-]+)/g, (m, t) => { tags.push(t); return ''; });
    let dossierName = null;
    const atIdx = text.lastIndexOf('@');
    if (atIdx !== -1) {
      dossierName = text.slice(atIdx + 1).trim();
      text = text.slice(0, atIdx);
    }
    return { text: text.replace(/\s+/g, ' ').trim(), tags, dossierName };
  }

  async function findDossier(name) {
    if (!name) return null;
    const dossiers = await api('/dossiers');
    const match = dossiers.find((d) => d.title.toLowerCase() === name.toLowerCase())
      || dossiers.find((d) => d.title.toLowerCase().includes(name.toLowerCase()));
    if (!match) throw new Error(`Fascicolo "${name}" non trovato.`);
    return match;
  }

  async function linkToDossier(dossierName, itemType, itemId) {
    if (!dossierName) return null;
    const dossier = await findDossier(dossierName);
    await api(`/dossiers/${dossier.id}/links`, { method: 'POST', body: JSON.stringify({ item_type: itemType, item_id: itemId }) });
    return dossier;
  }

  async function runCommand(raw) {
    const trimmed = raw.trim();
    printEcho(raw);
    if (!trimmed) return;

    if (trimmed === 'clear') { output.innerHTML = ''; return; }
    if (trimmed === 'help') {
      const width = Math.max(...HELP.map(([c]) => c.length));
      HELP.forEach(([c, d]) => print(`  ${c.padEnd(width + 2)}${d}`, 'cli-help'));
      return;
    }
    if (trimmed === 'whoami') { print(pendingUsername || '(sconosciuto)', 'cli-info'); return; }
    if (trimmed === 'gui') { location.href = '/'; return; }
    if (trimmed === 'logout') {
      await api('/auth/logout', { method: 'POST' }).catch(() => {});
      print('Sessione chiusa.', 'cli-info');
      pendingUsername = ''; pendingPassword = '';
      askUsername();
      return;
    }

    try {
      if (trimmed.startsWith('/progetto ')) {
        const { text, dossierName } = extractTagsAndDossier(trimmed.slice('/progetto '.length));
        if (!text) throw new Error('Serve un titolo: /progetto <titolo>');
        const project = await api('/projects', { method: 'POST', body: JSON.stringify({ title: text }) });
        const dossier = await linkToDossier(dossierName, 'project', project.id);
        print(`✓ Progetto creato${dossier ? ` — collegato a "${dossier.title}"` : ''}.`, 'cli-ok');
        return;
      }

      if (trimmed.startsWith('/scadenza ')) {
        let rest = trimmed.slice('/scadenza '.length);
        let date = null;
        rest = rest.replace(/\bil (\d{4}-\d{2}-\d{2})\b/, (m, d) => { date = d; return ''; });
        const { text, dossierName } = extractTagsAndDossier(rest);
        if (!text) throw new Error('Serve un testo: /scadenza <testo> il <AAAA-MM-GG>');
        if (!date) throw new Error('Serve una data: ... il <AAAA-MM-GG>');
        const reminder = await api('/reminders', { method: 'POST', body: JSON.stringify({ label: text, date }) });
        const dossier = await linkToDossier(dossierName, 'reminder', reminder.id);
        print(`✓ Scadenza creata${dossier ? ` — collegata a "${dossier.title}"` : ''}.`, 'cli-ok');
        return;
      }

      if (trimmed.startsWith('/')) {
        const typed = trimmed.split(' ')[0];
        const best = KNOWN_SLASH_COMMANDS.map((c) => ({ c, d: levenshtein(typed, c) })).sort((a, b) => a.d - b.d)[0];
        const hint = best && best.d <= 3 ? ` Forse intendevi "${best.c}"?` : ' Scrivi "help" per l\'elenco.';
        throw new Error(`Comando sconosciuto: ${typed}.${hint}`);
      }

      // Nessun prefisso: idea (il tipo predefinito, come nel Flusso).
      const { text, tags, dossierName } = extractTagsAndDossier(trimmed);
      if (!text) throw new Error('Testo vuoto.');
      const idea = await api('/ideas', { method: 'POST', body: JSON.stringify({ title: text.length > 80 ? text.slice(0, 80) + '…' : text, body: text, tags }) });
      const dossier = await linkToDossier(dossierName, 'idea', idea.id);
      print(`✓ Idea creata${dossier ? ` — collegata a "${dossier.title}"` : ''}.`, 'cli-ok');
    } catch (err) {
      print(`✗ ${err.message}`, 'cli-error');
    }
  }

  const COMMAND_NAMES = ['/progetto ', '/scadenza '];
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Tab' && mode === 'ready') {
      const match = COMMAND_NAMES.find((c) => c.startsWith(input.value) && c !== input.value);
      if (match) { e.preventDefault(); input.value = match; }
      return;
    }
    // La cronologia (con le frecce) ha senso solo per i comandi, mai per
    // richiamare per sbaglio una password digitata durante l'accesso.
    if (e.key === 'ArrowUp' && mode === 'ready') {
      e.preventDefault();
      const history = loadHistory();
      if (historyIndex > 0) { historyIndex--; input.value = history[historyIndex]; }
      return;
    }
    if (e.key === 'ArrowDown' && mode === 'ready') {
      e.preventDefault();
      const history = loadHistory();
      historyIndex = Math.min(historyIndex + 1, history.length);
      input.value = historyIndex < history.length ? history[historyIndex] : '';
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const value = input.value;
    input.value = '';
    input.disabled = true;
    try {
      if (mode === 'ready') {
        if (value.trim()) { pushHistory(value); historyIndex = loadHistory().length; }
        await runCommand(value);
      } else {
        await handleLogin(value);
      }
    } finally {
      input.disabled = false;
      input.focus();
    }
  });

  screen.addEventListener('click', () => input.focus());
  input.focus();
  boot();
})();
