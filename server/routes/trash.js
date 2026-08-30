const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

const RESOURCES = {
  idea: { table: 'ideas', label: (r) => r.title },
  project: { table: 'projects', label: (r) => r.title },
  vault: { table: 'vault_entries', label: (r) => r.site },
  account: { table: 'accounts', label: (r) => r.service },
  document: { table: 'documents', label: (r) => r.display_name || r.original_name },
  dossier: { table: 'dossiers', label: (r) => r.title },
  reminder: { table: 'reminders', label: (r) => r.label },
};

router.get('/', (req, res) => {
  const items = [];
  for (const [type, def] of Object.entries(RESOURCES)) {
    const rows = db.prepare(`SELECT * FROM ${def.table} WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`).all();
    rows.forEach((r) => items.push({ type, id: r.id, label: def.label(r), deleted_at: r.deleted_at }));
  }
  items.sort((a, b) => (a.deleted_at < b.deleted_at ? 1 : -1));
  res.json(items);
});

router.post('/:type/:id/restore', (req, res) => {
  const def = RESOURCES[req.params.type];
  if (!def) return res.status(400).json({ error: 'Tipo non valido' });
  db.prepare(`UPDATE ${def.table} SET deleted_at = NULL WHERE id = ?`).run(req.params.id);
  res.status(204).end();
});

router.delete('/:type/:id', (req, res) => {
  const type = req.params.type;
  const def = RESOURCES[type];
  if (!def) return res.status(400).json({ error: 'Tipo non valido' });

  const row = db.prepare(`SELECT * FROM ${def.table} WHERE id = ? AND deleted_at IS NOT NULL`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Elemento non trovato nel cestino' });

  const purge = db.transaction(() => {
    db.prepare(`DELETE FROM ${def.table} WHERE id = ? AND deleted_at IS NOT NULL`).run(req.params.id);
    // I collegamenti ai fascicoli non hanno una foreign key verso le singole
    // tabelle: senza questa pulizia restavano righe orfane in dossier_links.
    if (type !== 'dossier') {
      db.prepare('DELETE FROM dossier_links WHERE item_type = ? AND item_id = ?').run(type, req.params.id);
    }
    // Stesso motivo per il collegamento abbonamento -> credenziali Vault:
    // niente foreign key, quindi va scollegato a mano quando il Vault viene
    // svuotato definitivamente, altrimenti l'account restava agganciato a un
    // id ormai inesistente.
    if (type === 'vault') {
      db.prepare('UPDATE accounts SET vault_entry_id = NULL WHERE vault_entry_id = ?').run(req.params.id);
    }
  });
  purge();

  // Un documento eliminato definitivamente deve sparire anche dal disco,
  // altrimenti il file caricato restava in uploads/ per sempre.
  if (type === 'document' && row.stored_name) {
    const filePath = path.join(UPLOAD_DIR, path.basename(row.stored_name));
    fs.promises.unlink(filePath).catch((err) => {
      if (err.code !== 'ENOENT') console.error('Impossibile eliminare il file:', err.message);
    });
  }

  res.status(204).end();
});

module.exports = router;
