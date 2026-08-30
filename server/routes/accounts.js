const express = require('express');
const db = require('../db');
const router = express.Router();

const VALID_TYPES = ['digitale', 'cartaceo'];
// Cadenza di addebito: '' = non specificata (es. abbonamenti gratuiti o
// una tantum senza rinnovo tracciato).
const VALID_BILLING = ['settimanale', 'mensile', 'trimestrale', 'semestrale', 'annuale', 'una_tantum'];

// Il numero arriva dal form come stringa: '' o non numerico diventano NULL
// invece di finire salvati come 0 o "NaN".
function parseAmount(raw) {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// L'id della voce Vault collegata (credenziali gia' salvate): validato contro
// la tabella vault_entries qui sotto, prima di essere passato a questa
// funzione pura di solo parsing.
function parseVaultEntryId(raw) {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) ? n : null;
}

// Giorno/mese del rinnovo periodico: fuori range o non numerico diventa
// NULL invece di salvare un valore senza senso (es. giorno 45).
function parseDayMonth(raw, max) {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 1 && n <= max ? n : null;
}

function serialize(row) {
  const { vault_site, vault_username, vault_type, ...account } = row;
  return {
    ...account,
    tags: JSON.parse(row.tags || '[]'),
    // null se non c'e' alcun collegamento, o se la voce Vault collegata e'
    // stata eliminata definitivamente (la join non trova piu' nulla: la
    // pulizia in trash.js azzera vault_entry_id in quel caso, ma la join
    // resta comunque la fonte di verita').
    vaultEntry: account.vault_entry_id != null && vault_site != null
      ? { id: account.vault_entry_id, site: vault_site, username: vault_username, type: vault_type }
      : null,
  };
}

const SELECT_WITH_VAULT = `
  SELECT accounts.*, vault_entries.site AS vault_site, vault_entries.username AS vault_username, vault_entries.type AS vault_type
  FROM accounts LEFT JOIN vault_entries ON vault_entries.id = accounts.vault_entry_id
`;

router.get('/', (req, res) => {
  const rows = db.prepare(`${SELECT_WITH_VAULT} WHERE accounts.deleted_at IS NULL ORDER BY accounts.updated_at DESC`).all();
  res.json(rows.map(serialize));
});

function getById(id) {
  return db.prepare(`${SELECT_WITH_VAULT} WHERE accounts.id = ?`).get(id);
}

router.post('/', (req, res) => {
  const {
    service, type = 'digitale', email = '', plan = '', location = '', payment_method = '',
    start_date = null, renewal_day = null, renewal_month = null,
    notes = '', tags = [], billing_frequency = '', amount = null, vault_entry_id = null,
  } = req.body;
  if (!service) return res.status(400).json({ error: 'Il servizio e\' obbligatorio' });
  const finalType = VALID_TYPES.includes(type) ? type : 'digitale';
  const finalBilling = VALID_BILLING.includes(billing_frequency) ? billing_frequency : '';
  const finalAmount = parseAmount(amount);
  const finalRenewalDay = parseDayMonth(renewal_day, 31);
  const finalRenewalMonth = parseDayMonth(renewal_month, 12);

  let finalVaultEntryId = parseVaultEntryId(vault_entry_id);
  if (finalVaultEntryId != null) {
    const linked = db.prepare('SELECT id FROM vault_entries WHERE id = ? AND deleted_at IS NULL').get(finalVaultEntryId);
    if (!linked) return res.status(404).json({ error: 'Voce Vault da collegare non trovata' });
  }

  const info = db
    .prepare(
      'INSERT INTO accounts (service, type, email, plan, location, payment_method, start_date, renewal_day, renewal_month, notes, tags, billing_frequency, amount, vault_entry_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(service, finalType, email, plan, location, payment_method, start_date || null, finalRenewalDay, finalRenewalMonth, notes, JSON.stringify(tags), finalBilling, finalAmount, finalVaultEntryId);
  res.status(201).json(serialize(getById(info.lastInsertRowid)));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM accounts WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Account non trovato' });
  const { service, type, email, plan, location, payment_method, start_date, renewal_day, renewal_month, notes, tags, billing_frequency, amount, vault_entry_id } = req.body;
  const finalType = type && VALID_TYPES.includes(type) ? type : existing.type;
  const finalBilling = billing_frequency !== undefined
    ? (VALID_BILLING.includes(billing_frequency) ? billing_frequency : '')
    : existing.billing_frequency;
  const parsedAmount = parseAmount(amount);
  const finalAmount = parsedAmount !== undefined ? parsedAmount : existing.amount;
  const parsedRenewalDay = parseDayMonth(renewal_day, 31);
  const parsedRenewalMonth = parseDayMonth(renewal_month, 12);
  const finalRenewalDay = renewal_day !== undefined ? parsedRenewalDay : existing.renewal_day;
  const finalRenewalMonth = renewal_month !== undefined ? parsedRenewalMonth : existing.renewal_month;

  let finalVaultEntryId = existing.vault_entry_id;
  const parsedVaultEntryId = parseVaultEntryId(vault_entry_id);
  if (parsedVaultEntryId !== undefined) {
    if (parsedVaultEntryId != null) {
      const linked = db.prepare('SELECT id FROM vault_entries WHERE id = ? AND deleted_at IS NULL').get(parsedVaultEntryId);
      if (!linked) return res.status(404).json({ error: 'Voce Vault da collegare non trovata' });
    }
    finalVaultEntryId = parsedVaultEntryId;
  }

  db.prepare(
    "UPDATE accounts SET service = ?, type = ?, email = ?, plan = ?, location = ?, payment_method = ?, start_date = ?, renewal_day = ?, renewal_month = ?, notes = ?, tags = ?, billing_frequency = ?, amount = ?, vault_entry_id = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(
    service ?? existing.service,
    finalType,
    email ?? existing.email,
    plan ?? existing.plan,
    location ?? existing.location,
    payment_method ?? existing.payment_method,
    start_date !== undefined ? (start_date || null) : existing.start_date,
    finalRenewalDay,
    finalRenewalMonth,
    notes ?? existing.notes,
    JSON.stringify(tags ?? JSON.parse(existing.tags || '[]')),
    finalBilling,
    finalAmount,
    finalVaultEntryId,
    req.params.id
  );
  res.json(serialize(getById(req.params.id)));
});

router.delete('/:id', (req, res) => {
  db.prepare("UPDATE accounts SET deleted_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

router.post('/:id/restore', (req, res) => {
  db.prepare('UPDATE accounts SET deleted_at = NULL WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
