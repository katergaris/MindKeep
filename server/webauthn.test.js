const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.DB_PATH = ':memory:';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-not-for-production';

const db = require('./db');
const auth = require('./auth');
const vaultRouter = require('./routes/vault');
const securityRouter = require('./routes/security');

// Nessun express-session vero: una sola sessione condivisa e' sufficiente per
// verificare il cancello WebAuthn sul reveal, senza dover firmare davvero una
// risposta con un autenticatore (richiederebbe simulare CBOR/COSE).
const fakeSession = { userId: 'tester' };

async function withServer(fn) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.session = fakeSession; next(); });
  app.use('/vault', vaultRouter);
  app.use('/security', securityRouter);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('reveal della password: senza impronte registrate funziona come prima (GET diretta)', async () => {
  auth.createUser('tester', 'testpassword123');
  const entry = db
    .prepare(
      "INSERT INTO vault_entries (site, username, password_encrypted) VALUES ('Test', 'me', ?)"
    )
    .run(require('./crypto').encrypt('supersecret'));

  await withServer(async (base) => {
    const res = await fetch(`${base}/vault/${entry.lastInsertRowid}/reveal`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.password, 'supersecret');
  });
});

test('reveal della password: con un\'impronta registrata, la GET si rifiuta e chiede WebAuthn', async () => {
  const user = auth.getUser('tester');
  const entry = db
    .prepare(
      "INSERT INTO vault_entries (site, username, password_encrypted) VALUES ('Test 2', 'me', ?)"
    )
    .run(require('./crypto').encrypt('altrosegreto'));
  db.prepare(
    "INSERT INTO webauthn_credentials (user_id, credential_id, public_key, device_name) VALUES (?, 'cred-finto', 'AAAA', 'Telefono di prova')"
  ).run(user.id);

  await withServer(async (base) => {
    const res = await fetch(`${base}/vault/${entry.lastInsertRowid}/reveal`);
    // 403, non 401: la sessione e' valida, manca solo la conferma con
    // l'impronta. Un 401 qui verrebbe letto dal client come sessione scaduta.
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.webauthnRequired, true);
    assert.equal(body.password, undefined, 'la password non deve mai comparire senza la verifica');

    const optionsRes = await fetch(`${base}/vault/${entry.lastInsertRowid}/reveal/options`);
    assert.equal(optionsRes.status, 200);
    const options = await optionsRes.json();
    assert.equal(options.rpId, '127.0.0.1');
    assert.equal(options.userVerification, 'required');
    assert.deepEqual(options.allowCredentials.map((c) => c.id), ['cred-finto']);

    // Una risposta non firmata davvero da un autenticatore deve fallire, non
    // rivelare comunque la password.
    const postRes = await fetch(`${base}/vault/${entry.lastInsertRowid}/reveal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: { id: 'cred-finto', response: {} } }),
    });
    assert.equal(postRes.status, 403);
    const postBody = await postRes.json();
    assert.equal(postBody.password, undefined);
  });
});

test('impostazioni sicurezza: elenco/rimozione impronte richiede la password per la rimozione', async () => {
  const user = auth.getUser('tester');

  await withServer(async (base) => {
    const listRes = await fetch(`${base}/security/webauthn`);
    const list = await listRes.json();
    assert.ok(list.credentials.some((c) => c.deviceName === 'Telefono di prova'));
    const credId = list.credentials.find((c) => c.deviceName === 'Telefono di prova').id;

    const wrongPwd = await fetch(`${base}/security/webauthn/${credId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'sbagliata' }),
    });
    assert.equal(wrongPwd.status, 403);

    const ok = await fetch(`${base}/security/webauthn/${credId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'testpassword123' }),
    });
    assert.equal(ok.status, 204);

    const listAfter = await fetch(`${base}/security/webauthn`).then((r) => r.json());
    assert.equal(listAfter.credentials.length, 0);
  });
});
