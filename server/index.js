const path = require('path');
// Percorso esplicito: cosi' "node server/index.js" trova il file .env anche
// se viene lanciato da una cartella diversa da quella del progetto.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
// Se SESSION_SECRET/ENCRYPTION_KEY non arrivano da .env, li genera e li salva
// in data/.secrets.env: deve girare prima di qualunque require che li legga
// (es. server/crypto.js), quindi resta il primo require applicativo del file.
require('./secrets').ensureSecrets();
const express = require('express');
const session = require('express-session');
const auth = require('./auth');
const SqliteStore = require('./session-store');

const app = express();
const PORT = process.env.PORT || 3000;
// ENCRYPTION_KEY viene ulteriormente validata (presenza/lunghezza minima) da server/crypto.js al primo require

// --- Durata dell'accesso (SESSION_DAYS nel file .env) ---
// 0 (valore predefinito) = l'accesso non scade mai da solo: si esce solo con
// il pulsante "Esci". Un numero N > 0 = l'accesso dura N giorni, che ripartono
// a ogni utilizzo ("rolling"): si viene disconnessi solo dopo N giorni di
// inattivita' completa.
const DAY_MS = 1000 * 60 * 60 * 24;
const NEVER_MS = DAY_MS * 3650; // 10 anni: in pratica nessuna scadenza

function sessionMaxAge() {
  const raw = String(process.env.SESSION_DAYS ?? '').trim();
  if (!raw) return NEVER_MS;
  const days = Number(raw);
  if (!Number.isFinite(days) || days <= 0) return NEVER_MS;
  return Math.min(days, 3650) * DAY_MS;
}

const SESSION_MAX_AGE = sessionMaxAge();

app.use(express.json({ limit: '2mb' }));
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    store: new SqliteStore({ ttlMs: SESSION_MAX_AGE }),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { maxAge: SESSION_MAX_AGE, sameSite: 'lax', httpOnly: true },
  })
);

// --- Health check (pubblico, usato da Docker e dallo script di setup) ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// --- Autenticazione ---
app.get('/api/auth/status', (req, res) => {
  res.json({ setupNeeded: !auth.hasUser(), authenticated: !!(req.session && req.session.userId) });
});

// Rigenera l'id di sessione dopo l'autenticazione (evita il session fixation:
// un id ottenuto prima del login non deve restare valido dopo).
function startSession(req, res, username, status) {
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Impossibile creare la sessione' });
    req.session.userId = username;
    req.session.save((saveErr) => {
      if (saveErr) return res.status(500).json({ error: 'Impossibile creare la sessione' });
      res.status(status).json({ ok: true });
    });
  });
}

app.post('/api/auth/setup', (req, res) => {
  if (auth.hasUser()) return res.status(400).json({ error: 'Utente gia\' configurato' });
  const { username, password } = req.body || {};
  if (!username || !password || password.length < 8) {
    return res.status(400).json({ error: 'Username obbligatorio e password di almeno 8 caratteri' });
  }
  auth.createUser(username, password);
  startSession(req, res, username, 201);
});

// Freno anti forza bruta: il vault e' protetto da una sola password, quindi
// dopo troppi tentativi falliti dallo stesso IP il login si blocca per un po'.
const MAX_ATTEMPTS = 10;
const LOCK_MS = 15 * 60 * 1000;
const loginAttempts = new Map();

function attemptsFor(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry || Date.now() > entry.until) {
    loginAttempts.delete(ip);
    return null;
  }
  return entry;
}

// Evita che la mappa cresca all'infinito con IP che non tornano piu'.
function pruneAttempts() {
  if (loginAttempts.size < 1000) return;
  const now = Date.now();
  for (const [ip, entry] of loginAttempts) {
    if (now > entry.until) loginAttempts.delete(ip);
  }
}

app.post('/api/auth/login', (req, res) => {
  const ip = req.ip || 'unknown';
  const entry = attemptsFor(ip);
  if (entry && entry.count >= MAX_ATTEMPTS) {
    const minutes = Math.ceil((entry.until - Date.now()) / 60000);
    return res.status(429).json({ error: `Troppi tentativi falliti. Riprova tra ${minutes} minuti.` });
  }

  const { username, password, code } = req.body || {};
  const registraFallimento = () => {
    const count = (entry ? entry.count : 0) + 1;
    pruneAttempts();
    loginAttempts.set(ip, { count, until: Date.now() + LOCK_MS });
  };

  if (!auth.verifyUser(username, password)) {
    registraFallimento();
    return res.status(401).json({ error: 'Credenziali non valide' });
  }

  // Secondo fattore: la password da sola non basta se l'utente ha attivato
  // l'app di autenticazione. Nessuna sessione viene creata prima del codice.
  if (auth.twoFactorEnabled(username)) {
    if (!code) {
      return res.status(401).json({ totpRequired: true, error: 'Serve il codice dell\'app di autenticazione' });
    }
    const clean = String(code).trim();
    // Un codice a 6 cifre viene dall'app; qualsiasi altra cosa e' un codice di recupero.
    const valido = /^\d{6}$/.test(clean.replace(/\s/g, ''))
      ? auth.verifyTotp(username, clean)
      : auth.verifyRecoveryCode(username, clean);
    if (!valido) {
      registraFallimento();
      return res.status(401).json({ totpRequired: true, error: 'Codice non valido o gia\' usato' });
    }
  }

  loginAttempts.delete(ip);
  startSession(req, res, username, 200);
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// --- Rotte protette ---
app.use('/api/ideas', auth.requireAuth, require('./routes/ideas'));
app.use('/api/projects', auth.requireAuth, require('./routes/projects'));
app.use('/api/vault', auth.requireAuth, require('./routes/vault'));
app.use('/api/accounts', auth.requireAuth, require('./routes/accounts'));
app.use('/api/drive', auth.requireAuth, require('./routes/drive'));
app.use('/api/dossiers', auth.requireAuth, require('./routes/dossiers'));
app.use('/api/reminders', auth.requireAuth, require('./routes/reminders'));
app.use('/api/search', auth.requireAuth, require('./routes/search'));
app.use('/api/trash', auth.requireAuth, require('./routes/trash'));
app.use('/api/backup', auth.requireAuth, require('./routes/backup'));
app.use('/api/security', auth.requireAuth, require('./routes/security'));

// Una rotta /api inesistente deve rispondere 404 JSON: senza questo finiva nel
// catch-all qui sotto e il client riceveva la index.html con status 200.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Endpoint non trovato' });
});

// --- Frontend statico ---
// Interfaccia testuale minima (senza sidebar/vista grafica): login e comandi
// rapidi (/progetto, /scadenza, idee) da riga di comando, stessa sessione
// dell'interfaccia normale.
app.get('/cli', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'cli.html'));
});
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Gestore errori centrale: senza, multer (file troppo grande) o un JSON malformato
// producevano una pagina HTML di errore che il frontend non sa interpretare.
// La firma a 4 parametri e' quella che Express riconosce come error handler.
app.use((err, req, res, next) => {
  // Risposta gia' iniziata (es. download in corso): lasciamo che Express chiuda.
  if (res.headersSent) return next(err);
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File troppo grande' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Richiesta troppo grande' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Corpo della richiesta non valido' });
  }
  console.error('Errore non gestito:', err);
  res.status(500).json({ error: 'Errore interno del server' });
});

const server = app.listen(PORT, () => {
  console.log(`Mindkeep in ascolto su http://localhost:${PORT}`);
  console.log(
    SESSION_MAX_AGE >= NEVER_MS
      ? 'Accesso: nessuna scadenza automatica (imposta SESSION_DAYS nel file .env per cambiarla)'
      : `Accesso: scade dopo ${Math.round(SESSION_MAX_AGE / DAY_MS)} giorni di inattivita'`
  );
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `La porta ${PORT} e' gia' in uso. Cambia PORT nel file .env (e la mappatura corrispondente in docker-compose.yml) oppure chiudi il processo che la occupa.`
    );
  } else {
    console.error('Errore di avvio del server:', err.message);
  }
  process.exit(1);
});
