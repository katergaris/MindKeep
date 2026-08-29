module.exports = function up(db) {
  db.exec(`
    ALTER TABLE accounts ADD COLUMN billing_frequency TEXT DEFAULT '';
    ALTER TABLE accounts ADD COLUMN amount REAL;
    ALTER TABLE accounts ADD COLUMN vault_entry_id INTEGER;
  `);
};
