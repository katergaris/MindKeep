const webpush = require('web-push');
const db = require('./db');

let configured = false;
function ensureConfigured() {
  if (configured) return;
  webpush.setVapidDetails(
    'mailto:mindkeep@localhost',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  configured = true;
}

// Manda a tutte le sottoscrizioni salvate (app single-utente: nessun filtro
// per account). Una sottoscrizione scaduta/revocata (404/410 dal browser)
// viene rimossa qui invece di essere ritentata all'infinito.
async function sendToAll(payload) {
  const subs = db.prepare('SELECT * FROM push_subscriptions').all();
  if (!subs.length) return;
  ensureConfigured();
  const body = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body
        );
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
        } else {
          console.error('Invio notifica push fallito:', err.message);
        }
      }
    })
  );
}

module.exports = { sendToAll };
