const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
const db = require('./db');
const { checkDueReminders } = require('./reminder-notifier');

function addReminder(label, date, notifiedAt = null) {
  const info = db.prepare('INSERT INTO reminders (label, date, notified_at) VALUES (?, ?, ?)').run(label, date, notifiedAt);
  return info.lastInsertRowid;
}

test('segna come notificate solo le scadenze arrivate (oggi o passate), non quelle future', async () => {
  // Nessuna sottoscrizione push registrata: niente rete, sendToAll ritorna
  // subito senza contattare alcun servizio push (verificato leggendo push.js).
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  const pastId = addReminder('Passata', yesterday);
  const todayId = addReminder('Oggi', today);
  const futureId = addReminder('Futura', tomorrow);

  await checkDueReminders();

  assert.ok(db.prepare('SELECT notified_at FROM reminders WHERE id = ?').get(pastId).notified_at);
  assert.ok(db.prepare('SELECT notified_at FROM reminders WHERE id = ?').get(todayId).notified_at);
  assert.equal(db.prepare('SELECT notified_at FROM reminders WHERE id = ?').get(futureId).notified_at, null);
});

test('non ritocca una scadenza gia\' notificata (idempotente)', async () => {
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const already = '2020-01-01 00:00:00';
  const id = addReminder('Gia\' notificata', yesterday, already);

  await checkDueReminders();

  assert.equal(db.prepare('SELECT notified_at FROM reminders WHERE id = ?').get(id).notified_at, already);
});

test('ignora le scadenze eliminate (nel cestino)', async () => {
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const id = addReminder('Nel cestino', yesterday);
  db.prepare("UPDATE reminders SET deleted_at = datetime('now') WHERE id = ?").run(id);

  await checkDueReminders();

  assert.equal(db.prepare('SELECT notified_at FROM reminders WHERE id = ?').get(id).notified_at, null);
});
