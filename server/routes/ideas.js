const express = require('express');
const db = require('../db');
const router = express.Router();

function serialize(row) {
  return { ...row, tags: JSON.parse(row.tags || '[]'), checklist: JSON.parse(row.checklist || '[]') };
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM ideas WHERE deleted_at IS NULL ORDER BY updated_at DESC').all();
  res.json(rows.map(serialize));
});

router.post('/', (req, res) => {
  const { title, body = '', tags = [], checklist = [] } = req.body;
  if (!title) return res.status(400).json({ error: 'Il titolo e\' obbligatorio' });
  const info = db
    .prepare('INSERT INTO ideas (title, body, tags, checklist) VALUES (?, ?, ?, ?)')
    .run(title, body, JSON.stringify(tags), JSON.stringify(checklist));
  res.status(201).json(serialize(db.prepare('SELECT * FROM ideas WHERE id = ?').get(info.lastInsertRowid)));
});

router.put('/:id', (req, res) => {
  const { title, body, tags, checklist } = req.body;
  const existing = db.prepare('SELECT * FROM ideas WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Idea non trovata' });
  db.prepare(
    "UPDATE ideas SET title = ?, body = ?, tags = ?, checklist = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(
    title ?? existing.title,
    body ?? existing.body,
    JSON.stringify(tags ?? JSON.parse(existing.tags || '[]')),
    JSON.stringify(checklist ?? JSON.parse(existing.checklist || '[]')),
    req.params.id
  );
  res.json(serialize(db.prepare('SELECT * FROM ideas WHERE id = ?').get(req.params.id)));
});

router.delete('/:id', (req, res) => {
  db.prepare("UPDATE ideas SET deleted_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

router.post('/:id/restore', (req, res) => {
  db.prepare('UPDATE ideas SET deleted_at = NULL WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
