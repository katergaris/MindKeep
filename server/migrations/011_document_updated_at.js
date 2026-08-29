module.exports = function up(db) {
  db.exec(`
    ALTER TABLE documents ADD COLUMN updated_at TEXT;
    UPDATE documents SET updated_at = created_at WHERE updated_at IS NULL;
  `);
};
