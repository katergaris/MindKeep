const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.DB_PATH = ':memory:';
process.env.VAPID_PUBLIC_KEY = 'chiave-pubblica-di-prova';
const db = require('./db');
const pushRouter = require('./routes/push');

async function withServer(fn) {
  const app = express();
  app.use(express.json());
  app.use('/push', pushRouter);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/push`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('espone la chiave pubblica VAPID', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/vapid-public-key`).then((r) => r.json());
    assert.equal(res.publicKey, 'chiave-pubblica-di-prova');
  });
});

test('sottoscrive, e la stessa sottoscrizione (stesso endpoint) aggiorna invece di duplicare', async () => {
  await withServer(async (base) => {
    const sub = { endpoint: 'https://push.example/abc', keys: { p256dh: 'p256dh-1', auth: 'auth-1' } };
    const res1 = await fetch(`${base}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub),
    });
    assert.equal(res1.status, 201);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n, 1);

    // Ri-sottoscrizione con lo stesso endpoint ma chiavi diverse (es. dopo che
    // il browser ha ruotato le chiavi): deve aggiornare la riga, non duplicarla.
    const sub2 = { ...sub, keys: { p256dh: 'p256dh-2', auth: 'auth-2' } };
    await fetch(`${base}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub2),
    });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n, 1);
    assert.equal(db.prepare('SELECT p256dh FROM push_subscriptions WHERE endpoint = ?').get(sub.endpoint).p256dh, 'p256dh-2');
  });
});

test('rifiuta una sottoscrizione senza endpoint o senza chiavi', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'https://push.example/x' }),
    });
    assert.equal(res.status, 400);
  });
});

test('disiscrizione rimuove la sottoscrizione', async () => {
  await withServer(async (base) => {
    const endpoint = 'https://push.example/da-rimuovere';
    await fetch(`${base}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint, keys: { p256dh: 'a', auth: 'b' } }),
    });
    const res = await fetch(`${base}/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    });
    assert.equal(res.status, 204);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE endpoint = ?').get(endpoint).n, 0);
  });
});
