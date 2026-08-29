const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { runMigrations } = require('./migrate');

// Elenco atteso derivato dai file reali, non scritto a mano: cosi' il test
// non va aggiornato ad ogni nuova migrazione aggiunta al progetto.
const EXPECTED_IDS = fs
  .readdirSync(path.join(__dirname, 'migrations'))
  .filter((f) => f.endsWith('.js'))
  .sort()
  .map((f) => f.replace(/\.js$/, ''));

test('su un database vuoto crea tutte le tabelle ed esegue le migrazioni in ordine', () => {
  const db = new Database(':memory:');
  runMigrations(db);

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  for (const t of ['users', 'ideas', 'projects', 'vault_entries', 'accounts', 'documents', 'dossiers', 'dossier_links', 'recovery_codes', 'reminders']) {
    assert.ok(tables.includes(t), `manca la tabella ${t}`);
  }

  const applied = db.prepare('SELECT id FROM schema_migrations ORDER BY rowid').all().map((r) => r.id);
  assert.deepEqual(applied, EXPECTED_IDS);

  const userColumns = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  assert.ok(userColumns.includes('totp_secret'));
  assert.ok(userColumns.includes('totp_enabled'));

  const docColumns = db.prepare('PRAGMA table_info(documents)').all().map((c) => c.name);
  assert.ok(docColumns.includes('display_name'));

  const projectColumns = db.prepare('PRAGMA table_info(projects)').all().map((c) => c.name);
  assert.ok(projectColumns.includes('deadline'));
  assert.ok(projectColumns.includes('contacts'));
  assert.ok(projectColumns.includes('budget'));

  const accountColumns = db.prepare('PRAGMA table_info(accounts)').all().map((c) => c.name);
  assert.ok(accountColumns.includes('type'));
  assert.ok(accountColumns.includes('location'));
  assert.ok(accountColumns.includes('payment_method'));
  assert.ok(accountColumns.includes('billing_frequency'));
  assert.ok(accountColumns.includes('amount'));
  assert.ok(accountColumns.includes('vault_entry_id'));

  const vaultColumns = db.prepare('PRAGMA table_info(vault_entries)').all().map((c) => c.name);
  assert.ok(vaultColumns.includes('type'));
  assert.ok(vaultColumns.includes('totp_secret_encrypted'));
  assert.ok(vaultColumns.includes('card_cvv_encrypted'));
  assert.ok(vaultColumns.includes('card_expiry'));

  const ideaColumns = db.prepare('PRAGMA table_info(ideas)').all().map((c) => c.name);
  assert.ok(ideaColumns.includes('checklist'));
});

test('e\' idempotente: eseguirla piu\' volte non fallisce e non riapplica nulla', () => {
  const db = new Database(':memory:');
  runMigrations(db);
  assert.doesNotThrow(() => runMigrations(db));
  const applied = db.prepare('SELECT id FROM schema_migrations').all();
  assert.equal(applied.length, EXPECTED_IDS.length);
});

test('un database pre-esistente (schema gia\' presente, creato prima di questo sistema) viene adottato senza rieseguire le migrazioni', () => {
  const db = new Database(':memory:');
  // Simula lo schema creato dal vecchio meccanismo ad-hoc: tabelle gia'
  // presenti (incluse quelle su cui le migrazioni successive faranno ALTER
  // TABLE), colonne TOTP gia' aggiunte, ma senza schema_migrations.
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      totp_secret TEXT,
      totp_enabled INTEGER NOT NULL DEFAULT 0,
      totp_last_step INTEGER
    );
    CREATE TABLE ideas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT DEFAULT '',
      tags TEXT DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    );
    CREATE TABLE documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      folder TEXT DEFAULT '',
      mime TEXT DEFAULT '',
      size INTEGER DEFAULT 0,
      expiry_date TEXT,
      tags TEXT DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    );
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'da_fare',
      checklist TEXT DEFAULT '[]',
      tags TEXT DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    );
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service TEXT NOT NULL,
      email TEXT DEFAULT '',
      plan TEXT DEFAULT '',
      renewal_date TEXT,
      notes TEXT DEFAULT '',
      tags TEXT DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    );
    CREATE TABLE vault_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site TEXT NOT NULL,
      username TEXT DEFAULT '',
      password_encrypted TEXT NOT NULL,
      url TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      tags TEXT DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    );
  `);

  // Se rieseguisse le migrazioni invece di adottarle, "ALTER TABLE ADD COLUMN
  // totp_secret" fallirebbe qui perche' la colonna esiste gia'.
  assert.doesNotThrow(() => runMigrations(db));

  const applied = db.prepare('SELECT id FROM schema_migrations ORDER BY rowid').all().map((r) => r.id);
  assert.deepEqual(applied, EXPECTED_IDS);

  // Le migrazioni successive a quelle "legacy" (qui: le scadenze) devono
  // pero' girare per davvero, anche su un database adottato ora: altrimenti
  // chi aggiorna da prima di questo sistema non si ritroverebbe mai la
  // tabella nuova.
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  assert.ok(tables.includes('reminders'), 'la migrazione delle scadenze non e\' stata eseguita sul database legacy');

  const docColumns = db.prepare('PRAGMA table_info(documents)').all().map((c) => c.name);
  assert.ok(docColumns.includes('display_name'), 'la migrazione del nome personalizzato non e\' stata eseguita sul database legacy');

  const projectColumns = db.prepare('PRAGMA table_info(projects)').all().map((c) => c.name);
  assert.ok(projectColumns.includes('deadline'), 'la migrazione dei campi progetto non e\' stata eseguita sul database legacy');

  const accountColumns = db.prepare('PRAGMA table_info(accounts)').all().map((c) => c.name);
  assert.ok(accountColumns.includes('type'), 'la migrazione del tipo account non e\' stata eseguita sul database legacy');
  assert.ok(accountColumns.includes('billing_frequency'), 'la migrazione della fatturazione account non e\' stata eseguita sul database legacy');
  assert.ok(accountColumns.includes('vault_entry_id'), 'la migrazione della fatturazione account non e\' stata eseguita sul database legacy');

  const vaultColumns = db.prepare('PRAGMA table_info(vault_entries)').all().map((c) => c.name);
  assert.ok(vaultColumns.includes('totp_secret_encrypted'), 'la migrazione dei tipi vault non e\' stata eseguita sul database legacy');

  const ideaColumns = db.prepare('PRAGMA table_info(ideas)').all().map((c) => c.name);
  assert.ok(ideaColumns.includes('checklist'), 'la migrazione della checklist note non e\' stata eseguita sul database legacy');
});
