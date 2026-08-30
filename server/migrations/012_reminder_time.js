module.exports = function up(db) {
  // Orario opzionale (HH:MM, ora locale) per le scadenze: NULL = solo data,
  // come si comportava prima di questa colonna.
  db.exec(`ALTER TABLE reminders ADD COLUMN time TEXT;`);
};
