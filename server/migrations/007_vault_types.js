module.exports = function up(db) {
  db.exec(`
    ALTER TABLE vault_entries ADD COLUMN type TEXT NOT NULL DEFAULT 'password';
    ALTER TABLE vault_entries ADD COLUMN totp_secret_encrypted TEXT;
    ALTER TABLE vault_entries ADD COLUMN card_cvv_encrypted TEXT;
    ALTER TABLE vault_entries ADD COLUMN card_expiry TEXT;
  `);
};
