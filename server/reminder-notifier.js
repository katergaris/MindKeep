const db = require('./db');
const push = require('./push');

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

// Le scadenze hanno solo una data (nessun orario): "dovuta" significa che la
// data e' oggi o gia' passata. notified_at segna che questa scadenza e' gia'
// stata processata, cosi' non si rimanda la stessa notifica ad ogni giro —
// non e' una coda di ritentativi: se non c'e' ancora nessuna sottoscrizione
// attiva, la scadenza viene comunque segnata come "vista" e non notificata
// piu' tardi quando l'utente attivera' le notifiche.
async function checkDueReminders() {
  const today = new Date().toISOString().slice(0, 10);
  const due = db
    .prepare("SELECT * FROM reminders WHERE deleted_at IS NULL AND notified_at IS NULL AND date <= ? ORDER BY date")
    .all(today);
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
