module.exports = function up(db) {
  db.exec(`
    ALTER TABLE ideas ADD COLUMN checklist TEXT DEFAULT '[]';
  `);
};
