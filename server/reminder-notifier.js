const db = require('./db');
const push = require('./push');

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

// Le scadenze hanno una data e, opzionalmente, un orario (ora locale, HH:MM).
// "Dovuta" significa: la data e' gia' passata, oppure e' oggi e (nessun
// orario impostato, oppure l'orario impostato e' gia' passato). notified_at
// segna che questa scadenza e' gia' stata processata, cosi' non si rimanda
// la stessa notifica ad ogni giro — non e' una coda di ritentativi: se non
// c'e' ancora nessuna sottoscrizione attiva, la scadenza viene comunque
// segnata come "vista" e non notificata piu' tardi quando l'utente attivera'
// le notifiche.
async function checkDueReminders() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const nowTime = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  const due = db
    .prepare(
      `SELECT * FROM reminders WHERE deleted_at IS NULL AND notified_at IS NULL
       AND (date < ? OR (date = ? AND (time IS NULL OR time <= ?)))
       ORDER BY date, time`
    )
    .all(today, today, nowTime);
  if (!due.length) return;

  const markNotified = db.prepare("UPDATE reminders SET notified_at = datetime('now') WHERE id = ?");
  for (const r of due) {
    try {
      await push.sendToAll({ title: 'Scadenza: ' + r.label, body: r.notes || '', url: '/' });
    } catch (err) {
      console.error('Notifica scadenza fallita:', err.message);
    }
    markNotified.run(r.id);
  }
}

let timer = null;
function start() {
  if (timer) return;
  checkDueReminders().catch((err) => console.error('Controllo scadenze fallito:', err.message));
  timer = setInterval(() => {
    checkDueReminders().catch((err) => console.error('Controllo scadenze fallito:', err.message));
  }, CHECK_INTERVAL_MS);
  timer.unref();
}

module.exports = { start, checkDueReminders };
