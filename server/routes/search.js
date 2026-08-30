const express = require('express');
const db = require('../db');
const router = express.Router();

// In LIKE i caratteri % e _ sono jolly: senza escape cercare "100%" o "a_b"
// restituiva risultati non pertinenti (o addirittura tutto il contenuto).
function likePattern(raw) {
  return `%${raw.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
}

router.get('/', (req, res) => {
  const raw = String(req.query.q || '').trim();
  if (!raw) return res.json([]);
  const q = likePattern(raw);

  const results = [];

  db.prepare("SELECT id, title FROM ideas WHERE deleted_at IS NULL AND (title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')")
    .all(q, q, q)
    .forEach((r) => results.push({ type: 'idea', id: r.id, label: r.title }));

  db.prepare("SELECT id, title FROM projects WHERE deleted_at IS NULL AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')")
    .all(q, q, q)
    .forEach((r) => results.push({ type: 'project', id: r.id, label: r.title }));

  db.prepare("SELECT id, site FROM vault_entries WHERE deleted_at IS NULL AND (site LIKE ? ESCAPE '\\' OR username LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')")
    .all(q, q, q, q)
    .forEach((r) => results.push({ type: 'vault', id: r.id, label: r.site }));

  db.prepare("SELECT id, service FROM accounts WHERE deleted_at IS NULL AND (service LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')")
    .all(q, q, q, q)
    .forEach((r) => results.push({ type: 'account', id: r.id, label: r.service }));

  db.prepare("SELECT id, original_name, display_name FROM documents WHERE deleted_at IS NULL AND (original_name LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\' OR folder LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')")
    .all(q, q, q, q)
    .forEach((r) => results.push({ type: 'document', id: r.id, label: r.display_name || r.original_name }));

  db.prepare("SELECT id, title FROM dossiers WHERE deleted_at IS NULL AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')")
    .all(q, q)
    .forEach((r) => results.push({ type: 'dossier', id: r.id, label: r.title }));

  db.prepare("SELECT id, label FROM reminders WHERE deleted_at IS NULL AND (label LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\')")
    .all(q, q)
    .forEach((r) => results.push({ type: 'reminder', id: r.id, label: r.label }));

  res.json(results);
});

// Cosa serve per individuare il rinnovo dipende dalla cadenza: settimanale
// vuole solo il giorno della settimana (1=Lunedi'...7=Domenica), mensile solo
// il giorno del mese, trimestrale/semestrale/annuale vogliono giorno+mese di
// riferimento. "day"/"month" hanno quindi un significato diverso a seconda
// di "frequency" — stessa logica di nextRenewalDate() in public/app.js.
const BILLING_STEP_MONTHS = { trimestrale: 3, semestrale: 6, annuale: 12 };
// Ricalcola la data da zero a ogni passo invece di sommare mese dopo mese
// sulla stessa istanza: altrimenti un giorno che non esiste in un mese
// intermedio (es. 31 a settembre, che Date normalizza a 1 ottobre) trascina
// la ricorrenza su un giorno diverso per tutte le occorrenze successive.
function monthlyOccurrence(anchorYear, anchorMonth0, offsetMonths, day) {
  const total = anchorYear * 12 + anchorMonth0 + offsetMonths;
  return new Date(Math.floor(total / 12), ((total % 12) + 12) % 12, day);
}
function nextOccurrence(day, month, frequency) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (frequency === 'settimanale') {
    const todayIso = ((today.getDay() + 6) % 7) + 1;
    const candidate = new Date(today);
    candidate.setDate(candidate.getDate() + ((day - todayIso + 7) % 7));
    return candidate.toISOString().slice(0, 10);
  }
  if (frequency === 'mensile') {
    let candidate = new Date(today.getFullYear(), today.getMonth(), day);
    if (candidate < today) candidate = new Date(today.getFullYear(), today.getMonth() + 1, day);
    return candidate.toISOString().slice(0, 10);
  }
  const stepMonths = BILLING_STEP_MONTHS[frequency] || 12;
  const anchorYear = today.getFullYear() - 1;
  const anchorMonth0 = month - 1;
  let offset = 0;
  let candidate = monthlyOccurrence(anchorYear, anchorMonth0, offset, day);
  while (candidate < today) {
    offset += stepMonths;
    candidate = monthlyOccurrence(anchorYear, anchorMonth0, offset, day);
  }
  return candidate.toISOString().slice(0, 10);
}

// Elementi con scadenza vicina (account e documenti), usati per i promemoria
router.get('/reminders/upcoming', (req, res) => {
  const parsed = parseInt(req.query.days, 10);
  // Un valore assente, negativo o assurdo rendeva la query priva di senso
  // (finestra al passato o interrogazione senza limite).
  const days = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 3650) : 30;
  const limit = `+${days} days`;
  const windowEnd = new Date();
  windowEnd.setHours(0, 0, 0, 0);
  windowEnd.setDate(windowEnd.getDate() + days);
  const windowEndStr = windowEnd.toISOString().slice(0, 10);

  const accounts = db
    // renewal_month resta NULL per le cadenze settimanale/mensile (non serve,
    // solo il giorno conta): non va richiesto anche lui, altrimenti quelle
    // non comparirebbero mai qui.
    .prepare('SELECT id, service AS label, renewal_day, renewal_month, billing_frequency FROM accounts WHERE deleted_at IS NULL AND renewal_day IS NOT NULL')
    .all()
    .map((r) => ({ id: r.id, label: r.label, date: nextOccurrence(r.renewal_day, r.renewal_month, r.billing_frequency), type: 'account' }))
    .filter((r) => r.date <= windowEndStr)
    .sort((a, b) => (a.date > b.date ? 1 : -1));

  const documents = db
    .prepare(
      "SELECT id, COALESCE(NULLIF(display_name, ''), original_name) AS label, expiry_date AS date FROM documents WHERE deleted_at IS NULL AND expiry_date IS NOT NULL AND date(expiry_date) <= date('now', ?) ORDER BY expiry_date ASC"
    )
    .all(limit)
    .map((r) => ({ ...r, type: 'document' }));

  const reminders = db
    .prepare(
      "SELECT id, label, date FROM reminders WHERE deleted_at IS NULL AND date(date) <= date('now', ?) ORDER BY date ASC"
    )
    .all(limit)
    .map((r) => ({ ...r, type: 'reminder' }));

  const projects = db
    .prepare(
      "SELECT id, title AS label, deadline AS date FROM projects WHERE deleted_at IS NULL AND deadline IS NOT NULL AND date(deadline) <= date('now', ?) ORDER BY deadline ASC"
    )
    .all(limit)
    .map((r) => ({ ...r, type: 'project' }));

  res.json([...accounts, ...documents, ...reminders, ...projects].sort((a, b) => (a.date > b.date ? 1 : -1)));
});

module.exports = router;
