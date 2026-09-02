module.exports = function up(db) {
  // Credenziali WebAuthn (impronta/Face ID) registrate per sbloccare una voce
  // del vault senza dover rifare tutto il login. "credential_id" e "public_key"
  // sono quelli restituiti dal dispositivo in fase di registrazione: solo il
  // dispositivo conserva la chiave privata, qui viene salvata solo quella pubblica.
  db.exec(`
    CREATE TABLE IF NOT EXISTS webauthn_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      credential_id TEXT UNIQUE NOT NULL,
      public_key TEXT NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      transports TEXT,
      device_type TEXT,
      backed_up INTEGER NOT NULL DEFAULT 0,
      device_name TEXT NOT NULL DEFAULT 'Dispositivo',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user ON webauthn_credentials(user_id);
  `);
};
