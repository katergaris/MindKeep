const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// Mindkeep gira spesso dietro un reverse proxy che termina TLS (vedi
// server/index.js): senza "trust proxy" req.protocol resta sempre "http" e
// req.ip resta l'IP del proxy, il che rompe sia la verifica dell'origine
// WebAuthn sia il blocco anti forza bruta sul login. Qui si verifica che
// l'impostazione usata in produzione si fidi degli header X-Forwarded-* solo
// quando la connessione arriva da un indirizzo privato/locale (dove gira
// tipicamente il proxy), come nei test qui sotto (il client si connette da
// 127.0.0.1).
async function withApp(fn) {
  const app = express();
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  app.get('/whoami', (req, res) => {
    res.json({ protocol: req.protocol, hostname: req.hostname, ip: req.ip });
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('senza reverse proxy davanti: protocollo e host sono quelli reali della richiesta', async () => {
  await withApp(async (base) => {
    const body = await fetch(`${base}/whoami`).then((r) => r.json());
    assert.equal(body.protocol, 'http');
    assert.equal(body.hostname, '127.0.0.1');
  });
});

test('dietro un reverse proxy TLS-terminating (X-Forwarded-Proto): il protocollo diventa https', async () => {
  await withApp(async (base) => {
    const body = await fetch(`${base}/whoami`, {
      headers: { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'mindkeep.esempio.it' },
    }).then((r) => r.json());
    // Il client di test si connette da 127.0.0.1 (loopback, di cui ci si fida):
    // Express deve leggere gli header X-Forwarded-* invece di ignorarli.
    assert.equal(body.protocol, 'https');
    assert.equal(body.hostname, 'mindkeep.esempio.it');
  });
});
