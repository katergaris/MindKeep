const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.DB_PATH = ':memory:';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-not-for-production';
const vaultRouter = require('./routes/vault');
const totp = require('./totp');

async function withServer(fn) {
  const app = express();
  app.use(express.json());
  app.use('/vault', vaultRouter);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/vault`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('voce di tipo password con codice TOTP: creazione, rivelazione, codice a 6 cifre', async () => {
  await withServer(async (base) => {
    const secret = totp.generateSecret();
    const created = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site: 'GitHub', username: 'me', password: 'hunter2', totp_secret: secret }),
    }).then((r) => r.json());
    assert.equal(created.type, 'password');
    assert.equal(created.hasTotp, true);
    assert.equal(created.password_encrypted, undefined, 'il valore cifrato non deve mai uscire dalla API');

    const revealed = await fetch(`${base}/${created.id}/reveal`).then((r) => r.json());
    assert.equal(revealed.password, 'hunter2');

    const totpRes = await fetch(`${base}/${created.id}/totp`);
    assert.equal(totpRes.status, 200);
    const { code, secondsRemaining } = await totpRes.json();
    assert.match(code, /^\d{6}$/);
    assert.equal(code, totp.codeForStep(secret, totp.currentStep()));
    assert.ok(secondsRemaining > 0 && secondsRemaining <= 30);
  });
});

test('voce senza codice TOTP: /totp risponde 404, non un errore generico', async () => {
  await withServer(async (base) => {
    const created = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site: 'Senza 2FA', password: 'x' }),
    }).then((r) => r.json());
    assert.equal(created.hasTotp, false);
    const res = await fetch(`${base}/${created.id}/totp`);
    assert.equal(res.status, 404);
  });
});

test('segreto TOTP non valido viene rifiutato (400), non salvato silenziosamente', async () => {
  await withServer(async (base) => {
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site: 'X', password: 'x', totp_secret: 'non e\' base32!!!' }),
    });
    assert.equal(res.status, 400);
  });
});

test('rimuovere il codice TOTP con "-" lo cancella davvero', async () => {
  await withServer(async (base) => {
    const secret = totp.generateSecret();
    const created = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site: 'X', password: 'x', totp_secret: secret }),
    }).then((r) => r.json());
    assert.equal(created.hasTotp, true);

    const updated = await fetch(`${base}/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ totp_secret: '-' }),
    }).then((r) => r.json());
    assert.equal(updated.hasTotp, false);

    const totpRes = await fetch(`${base}/${created.id}/totp`);
    assert.equal(totpRes.status, 404);
  });
});

test('voce di tipo nota sicura: il contenuto passa dal campo "password" ed e\' cifrato', async () => {
  await withServer(async (base) => {
    const created = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site: 'Combinazione cassaforte', password: '12-34-56', type: 'note' }),
    }).then((r) => r.json());
    assert.equal(created.type, 'note');
    const revealed = await fetch(`${base}/${created.id}/reveal`).then((r) => r.json());
    assert.equal(revealed.password, '12-34-56');
  });
});

test('voce di tipo carta: numero (in "password") e CVV sono entrambi cifrati e rivelabili', async () => {
  await withServer(async (base) => {
    const created = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        site: 'Visa personale', username: 'Mario Rossi', password: '4111111111111111',
        type: 'card', card_cvv: '123', card_expiry: '12/28',
      }),
    }).then((r) => r.json());
    assert.equal(created.type, 'card');
    assert.equal(created.card_expiry, '12/28');
    assert.equal(created.card_cvv_encrypted, undefined);

    const revealed = await fetch(`${base}/${created.id}/reveal`).then((r) => r.json());
    assert.equal(revealed.password, '4111111111111111');
    assert.equal(revealed.cvv, '123');
  });
});
