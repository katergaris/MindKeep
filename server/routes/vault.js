const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const db = require('../db');
const { encrypt, decrypt } = require('../crypto');
const totp = require('../totp');
const auth = require('../auth');
const webauthn = require('../webauthn');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function currentUser(req) {
  return req.session ? auth.getUser(req.session.userId) : null;
}

// Tipi di voce: cambia solo il significato dei campi condivisi (site/username/
// password_encrypted), non lo schema. "password_encrypted" contiene sempre
// l'unico segreto principale della voce: la password, il numero di carta o il
// contenuto della nota sicura, a seconda del tipo.
const VALID_TYPES = ['password', 'note', 'card'];

function serialize(row, { reveal = false } = {}) {
  const base = { ...row, tags: JSON.parse(row.tags || '[]'), hasTotp: !!row.totp_secret_encrypted };
  delete base.password_encrypted;
  delete base.totp_secret_encrypted;
  delete base.card_cvv_encrypted;
  if (reveal) {
    try {
      base.password = decrypt(row.password_encrypted);
    } catch (e) {
      base.password = null;
    }
    if (row.card_cvv_encrypted) {
      try { base.cvv = decrypt(row.card_cvv_encrypted); } catch (e) { base.cvv = null; }
    }
  }
  return base;
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM vault_entries WHERE deleted_at IS NULL ORDER BY updated_at DESC').all();
  res.json(rows.map((r) => serialize(r)));
});

router.get('/:id/reveal', (req, res) => {
  const row = db.prepare('SELECT * FROM vault_entries WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Voce non trovata' });
  const user = currentUser(req);
  // Se l'utente ha registrato un'impronta, la password non si rivela mai con
  // una semplice GET: il client deve rifare la richiesta come POST qui sotto,
  // dopo aver ottenuto una sfida da /reveal/options e averla firmata col tocco.
  if (user && webauthn.hasCredentials(user.id)) {
    return res.status(401).json({ error: 'Serve la conferma con impronta digitale', webauthnRequired: true });
  }
  res.json(serialize(row, { reveal: true }));
});

// Passo 1 dello sblocco con impronta: genera la sfida da firmare col tocco.
router.get('/:id/reveal/options', async (req, res) => {
  const row = db.prepare('SELECT id FROM vault_entries WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Voce non trovata' });
  const user = currentUser(req);
  if (!user || !webauthn.hasCredentials(user.id)) {
    return res.status(400).json({ error: 'Nessuna impronta registrata per questo account' });
  }
  const options = await webauthn.generateRevealOptions(req, user, row.id);
  res.json(options);
});

// Passo 2: verifica la risposta del dispositivo e, solo se valida, rivela la password.
router.post('/:id/reveal', async (req, res) => {
  const row = db.prepare('SELECT * FROM vault_entries WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Voce non trovata' });
  const user = currentUser(req);
  const { credential } = req.body || {};
  if (!user || !credential) return res.status(400).json({ error: 'Corpo della richiesta non valido' });
  try {
    await webauthn.verifyReveal(req, user, credential, row.id);
  } catch (e) {
    return res.status(401).json({ error: e.message });
  }
  res.json(serialize(row, { reveal: true }));
});

// Codice attuale a 6 cifre per il TOTP salvato su questa voce: non espone mai
// il segreto stesso al frontend, solo il codice effimero gia' calcolato.
router.get('/:id/totp', (req, res) => {
  const row = db.prepare('SELECT totp_secret_encrypted FROM vault_entries WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Voce non trovata' });
  if (!row.totp_secret_encrypted) return res.status(404).json({ error: 'Nessun codice configurato per questa voce' });
  let secret;
  try {
    secret = decrypt(row.totp_secret_encrypted);
  } catch (e) {
    return res.status(500).json({ error: 'Impossibile decifrare il codice' });
  }
  const code = totp.codeForStep(secret, totp.currentStep());
  const secondsRemaining = 30 - (Math.floor(Date.now() / 1000) % 30);
  res.json({ code, secondsRemaining });
});

function encryptTotpSecret(raw) {
  const clean = String(raw).replace(/\s/g, '');
  totp.base32Decode(clean); // lancia se non e' base32 valido
  return encrypt(clean);
}

router.post('/', (req, res) => {
  const { site, username = '', password, url = '', notes = '', tags = [], type = 'password', totp_secret = '', card_cvv = '', card_expiry = '' } = req.body;
  if (!site || !password) return res.status(400).json({ error: 'Titolo e contenuto sono obbligatori' });
  const finalType = VALID_TYPES.includes(type) ? type : 'password';

  let totpSecretEncrypted = null;
  if (totp_secret) {
    try {
      totpSecretEncrypted = encryptTotpSecret(totp_secret);
    } catch (e) {
      return res.status(400).json({ error: 'Segreto TOTP non valido' });
    }
  }

  const info = db
    .prepare(
      'INSERT INTO vault_entries (site, username, password_encrypted, url, notes, tags, type, totp_secret_encrypted, card_cvv_encrypted, card_expiry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      site, username, encrypt(password), url, notes, JSON.stringify(tags),
      finalType, totpSecretEncrypted, card_cvv ? encrypt(card_cvv) : null, card_expiry || null
    );
  res.status(201).json(serialize(db.prepare('SELECT * FROM vault_entries WHERE id = ?').get(info.lastInsertRowid)));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM vault_entries WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Voce non trovata' });
  const { site, username, password, url, notes, tags, type, totp_secret, card_cvv, card_expiry } = req.body;
  const finalType = type && VALID_TYPES.includes(type) ? type : existing.type;

  // Come la password: campo vuoto = non cambiarlo. Per rimuovere del tutto il
  // codice TOTP il frontend manda esplicitamente la stringa "-" (vedi il
  // checkbox "rimuovi" nel modulo di modifica).
  let totpSecretEncrypted = existing.totp_secret_encrypted;
  if (totp_secret === '-') {
    totpSecretEncrypted = null;
  } else if (totp_secret) {
    try {
      totpSecretEncrypted = encryptTotpSecret(totp_secret);
    } catch (e) {
      return res.status(400).json({ error: 'Segreto TOTP non valido' });
    }
  }

  const cardCvvEncrypted = card_cvv ? encrypt(card_cvv) : existing.card_cvv_encrypted;

  db.prepare(
    "UPDATE vault_entries SET site = ?, username = ?, password_encrypted = ?, url = ?, notes = ?, tags = ?, type = ?, totp_secret_encrypted = ?, card_cvv_encrypted = ?, card_expiry = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(
    site ?? existing.site,
    username ?? existing.username,
    password ? encrypt(password) : existing.password_encrypted,
    url ?? existing.url,
    notes ?? existing.notes,
    JSON.stringify(tags ?? JSON.parse(existing.tags || '[]')),
    finalType,
    totpSecretEncrypted,
    cardCvvEncrypted,
    card_expiry !== undefined ? (card_expiry || null) : existing.card_expiry,
    req.params.id
  );
  res.json(serialize(db.prepare('SELECT * FROM vault_entries WHERE id = ?').get(req.params.id)));
});

router.delete('/:id', (req, res) => {
  db.prepare("UPDATE vault_entries SET deleted_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

router.post('/:id/restore', (req, res) => {
  db.prepare('UPDATE vault_entries SET deleted_at = NULL WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// Import da CSV. Riconosce automaticamente le intestazioni piu' comuni
// (esportazioni da browser o altri password manager): site/name/title,
// username/login/email, password, url/link, notes/note.
const HEADER_MAP = {
  site: ['site', 'name', 'title'],
  username: ['username', 'login', 'email', 'user'],
  password: ['password', 'pass'],
  url: ['url', 'link', 'website'],
  notes: ['notes', 'note', 'comment'],
};

function mapHeaders(headers) {
  const lower = headers.map((h) => h.trim().toLowerCase());
  const mapping = {};
  for (const [field, aliases] of Object.entries(HEADER_MAP)) {
    const idx = lower.findIndex((h) => aliases.includes(h));
    if (idx !== -1) mapping[field] = headers[idx];
  }
  return mapping;
}

router.post('/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nessun file caricato' });

  let records;
  try {
    records = parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true });
  } catch (e) {
    return res.status(400).json({ error: 'CSV non valido: ' + e.message });
  }
  if (!records.length) return res.status(400).json({ error: 'Il file CSV e\' vuoto' });

  const mapping = mapHeaders(Object.keys(records[0]));
  if (!mapping.site || !mapping.password) {
    return res.status(400).json({
      error:
        'Non trovo colonne riconoscibili per sito e password. Intestazioni attese: site/name/title, password.',
    });
  }

  const insert = db.prepare(
    'INSERT INTO vault_entries (site, username, password_encrypted, url, notes, tags) VALUES (?, ?, ?, ?, ?, ?)'
  );
  let imported = 0;
  let skipped = 0;

  const runImport = db.transaction((rows) => {
    for (const row of rows) {
      const site = mapping.site ? row[mapping.site] : '';
      const password = mapping.password ? row[mapping.password] : '';
      if (!site || !password) {
        skipped += 1;
        continue;
      }
      insert.run(
        site,
        mapping.username ? row[mapping.username] || '' : '',
        encrypt(password),
        mapping.url ? row[mapping.url] || '' : '',
        mapping.notes ? row[mapping.notes] || '' : '',
        JSON.stringify(['importato-csv'])
      );
      imported += 1;
    }
  });
  runImport(records);

  res.json({ imported, skipped, total: records.length });
});

module.exports = router;
