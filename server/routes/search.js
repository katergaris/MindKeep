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

// Il giorno+mese di un abbonamento e' solo un riferimento nel calendario: la
// cadenza vera e' quella di "billing_frequency" (settimanale...annuale) — un
// abbonamento mensile non diventa annuale solo perche' si esprime come
// giorno+mese invece che con una data completa. Senza una cadenza
// riconosciuta si assume annuale, l'unica ipotesi ragionevole senza altro.
const BILLING_STEP = {
  settimanale: { unit: 'days', amount: 7 },
  mensile: { unit: 'months', amount: 1 },
  trimestrale: { unit: 'months', amount: 3 },
  semestrale: { unit: 'months', amount: 6 },
  annuale: { unit: 'months', amount: 12 },
};
// Ricalcola la data da zero a ogni passo invece di sommare mese dopo mese
// sulla stessa istanza: altrimenti un giorno che non esiste in un mese
// intermedio (es. 31 a settembre, che Date normalizza a 1 ottobre) trascina
// la ricorrenza su un giorno diverso per tutte le occorrenze successive.
function monthlyOccurrence(anchorYear, anchorMonth0, offsetMonths, day) {
  const total = anchorYear * 12 + anchorMonth0 + offsetMonths;
  return new Date(Math.floor(total / 12), ((total % 12) + 12) % 12, day);
}
function nextOccurrence(day, month, frequency) {
  const step = BILLING_STEP[frequency] || BILLING_STEP.annuale;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let candidate;
  if (step.unit === 'days') {
    candidate = new Date(today.getFullYear() - 1, month - 1, day);
    while (candidate < today) candidate.setDate(candidate.getDate() + step.amount);
  } else {
    const anchorYear = today.getFullYear() - 1;
    const anchorMonth0 = month - 1;
    let offset = 0;
    candidate = monthlyOccurrence(anchorYear, anchorMonth0, offset, day);
    while (candidate < today) {
      offset += step.amount;
      candidate = monthlyOccurrence(anchorYear, anchorMonth0, offset, day);
    }
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
    .prepare('SELECT id, service AS label, renewal_day, renewal_month, billing_frequency FROM accounts WHERE deleted_at IS NULL AND renewal_day IS NOT NULL AND renewal_month IS NOT NULL')
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
