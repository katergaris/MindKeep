const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const db = require('./db');

const RP_NAME = 'Mindkeep';
const CHALLENGE_TTL_MS = 2 * 60 * 1000;

// Mindkeep e' self-hosted e puo' essere raggiunto da domini diversi (IP della
// rete locale, dominio personale, Tailscale, ...): l'RP ID di WebAuthn viene
// preso dall'host della richiesta invece che fissato una volta per tutte, cosi'
// la stessa impronta funziona da qualunque indirizzo si usi per aprire l'app
// (basta restare sullo stesso host sia quando la registri sia quando la usi).
function rpID(req) {
  return req.hostname;
}

function origin(req) {
  return `${req.protocol}://${req.get('host')}`;
}

function credentialsForUser(userId) {
  return db.prepare('SELECT * FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at').all(userId);
}

function hasCredentials(userId) {
  return credentialsForUser(userId).length > 0;
}

function toWebAuthnCredential(row) {
  return {
    id: row.credential_id,
    publicKey: new Uint8Array(Buffer.from(row.public_key, 'base64')),
    counter: row.counter,
    transports: row.transports ? JSON.parse(row.transports) : undefined,
  };
}

async function generateEnrollOptions(req, user) {
  const existing = credentialsForUser(user.id);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rpID(req),
    userName: user.username,
    userDisplayName: user.username,
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({
      id: c.credential_id,
      transports: c.transports ? JSON.parse(c.transports) : undefined,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      // 'required': deve essere davvero l'impronta/il volto a sbloccare, non
      // basta che il telefono sia semplicemente in mano (user presence).
      userVerification: 'required',
      authenticatorAttachment: 'platform',
    },
  });
  req.session.webauthnChallenge = { challenge: options.challenge, rpID: rpID(req), expires: Date.now() + CHALLENGE_TTL_MS };
  return options;
}

async function verifyEnroll(req, user, response, deviceName) {
  const pending = req.session.webauthnChallenge;
  if (!pending || pending.expires < Date.now()) throw new Error('Richiesta scaduta, riprova');
  delete req.session.webauthnChallenge;

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: pending.challenge,
    expectedOrigin: origin(req),
    expectedRPID: pending.rpID,
    requireUserVerification: true,
  });
  if (!verification.verified || !verification.registrationInfo) throw new Error('Verifica non riuscita');

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  db.prepare(
    'INSERT INTO webauthn_credentials (user_id, credential_id, public_key, counter, transports, device_type, backed_up, device_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    user.id,
    credential.id,
    Buffer.from(credential.publicKey).toString('base64'),
    credential.counter,
    credential.transports ? JSON.stringify(credential.transports) : null,
    credentialDeviceType,
    credentialBackedUp ? 1 : 0,
    deviceName || 'Dispositivo'
  );
}

function removeCredential(userId, id) {
  db.prepare('DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?').run(id, userId);
}

async function generateRevealOptions(req, user, vaultEntryId) {
  const creds = credentialsForUser(user.id);
  const options = await generateAuthenticationOptions({
    rpID: rpID(req),
    userVerification: 'required',
    allowCredentials: creds.map((c) => ({
      id: c.credential_id,
      transports: c.transports ? JSON.parse(c.transports) : undefined,
    })),
  });
  req.session.webauthnChallenge = {
    challenge: options.challenge,
    rpID: rpID(req),
    // Lega la sfida alla voce del vault per cui e' stata generata: una
    // risposta valida non puo' essere riusata entro la finestra di validita'
    // per sbloccare una voce diversa da quella per cui e' stato chiesto il tocco.
    vaultEntryId: String(vaultEntryId),
    expires: Date.now() + CHALLENGE_TTL_MS,
  };
  return options;
}

async function verifyReveal(req, user, response, vaultEntryId) {
  const pending = req.session.webauthnChallenge;
  if (!pending || pending.expires < Date.now() || pending.vaultEntryId !== String(vaultEntryId)) {
    throw new Error('Richiesta scaduta, riprova');
  }

  const row = db.prepare('SELECT * FROM webauthn_credentials WHERE user_id = ? AND credential_id = ?').get(user.id, response.id);
  if (!row) throw new Error('Impronta non riconosciuta');

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: pending.challenge,
    expectedOrigin: origin(req),
    expectedRPID: pending.rpID,
    credential: toWebAuthnCredential(row),
    requireUserVerification: true,
  });
  if (!verification.verified) throw new Error('Verifica non riuscita');
  delete req.session.webauthnChallenge;

  db.prepare("UPDATE webauthn_credentials SET counter = ?, last_used_at = datetime('now') WHERE id = ?").run(
    verification.authenticationInfo.newCounter,
    row.id
  );
}

module.exports = {
  hasCredentials,
  credentialsForUser,
  generateEnrollOptions,
  verifyEnroll,
  removeCredential,
  generateRevealOptions,
  verifyReveal,
};
