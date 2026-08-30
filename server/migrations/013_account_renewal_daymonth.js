module.exports = function up(db) {
  // Il rinnovo di un abbonamento e' periodico (la cadenza vera resta
  // "billing_frequency", da settimanale ad annuale): l'anno nella vecchia
  // "renewal_date" non aveva senso, serviva solo un riferimento giorno+mese.
  // "start_date" e' invece una data vera e propria, opzionale, per quando
  // l'abbonamento e' iniziato la prima volta.
  db.exec(`
    ALTER TABLE accounts ADD COLUMN start_date TEXT;
    ALTER TABLE accounts ADD COLUMN renewal_day INTEGER;
    ALTER TABLE accounts ADD COLUMN renewal_month INTEGER;
  `);
  // La vecchia renewal_date resta in tabella (non si butta via un dato gia'
  // salvato dall'utente) ma non viene piu' scritta dai form: qui si estrae
  // giorno/mese da quella gia' presente, cosi' chi aveva gia' un rinnovo
  // impostato non lo perde passando al nuovo formato.
  db.exec(`
    UPDATE accounts
    SET renewal_day = CAST(strftime('%d', renewal_date) AS INTEGER),
        renewal_month = CAST(strftime('%m', renewal_date) AS INTEGER)
    WHERE renewal_date IS NOT NULL AND renewal_date != '' AND renewal_day IS NULL
  `);
};
