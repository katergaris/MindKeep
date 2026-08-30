const express = require('express');
const db = require('../db');
const router = express.Router();

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM reminders WHERE deleted_at IS NULL ORDER BY created_at DESC').all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const { label, date, time = null, notes = '' } = req.body;
  if (!label) return res.status(400).json({ error: 'Il testo e\' obbligatorio' });
  if (!date) return res.status(400).json({ error: 'La data e\' obbligatoria' });
  const info = db.prepare('INSERT INTO reminders (label, date, time, notes) VALUES (?, ?, ?, ?)').run(label, date, time || null, notes);
  res.status(201).json(db.prepare('SELECT * FROM reminders WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const { label, date, time, notes } = req.body;
  const existing = db.prepare('SELECT * FROM reminders WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Scadenza non trovata' });
  const finalDate = date ?? existing.date;
  const finalTime = time === undefined ? existing.time : (time || null);
  // Se la data o l'orario si spostano, la scadenza puo' notificare di nuovo
  // quando il nuovo momento arriva: altrimenti chi lo rimanda non riceverebbe
  // piu' nulla.
  const notifiedAt = (finalDate === existing.date && finalTime === existing.time) ? existing.notified_at : null;
  db.prepare(
    "UPDATE reminders SET label = ?, date = ?, time = ?, notes = ?, notified_at = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(label ?? existing.label, finalDate, finalTime, notes ?? existing.notes, notifiedAt, req.params.id);
  res.json(db.prepare('SELECT * FROM reminders WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  db.prepare("UPDATE reminders SET deleted_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

router.post('/:id/restore', (req, res) => {
  db.prepare('UPDATE reminders SET deleted_at = NULL WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
