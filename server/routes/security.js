const express = require('express');
const qrcode = require('qrcode-generator');
const auth = require('../auth');
const totp = require('../totp');
const webauthn = require('../webauthn');

const router = express.Router();

// Il QR viene disegnato qui sul tuo server: nessuna immagine viene chiesta a
// servizi esterni, quindi il segreto non esce mai dalla tua rete.
function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
}

function currentUser(req) {
  return auth.getUser(req.session.userId);
}

router.get('/', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Non autenticato' });
  res.json({
    username: user.username,
    totpEnabled: !!user.totp_enabled,
    recoveryCodesLeft: user.totp_enabled ? auth.countUnusedRecoveryCodes(user.id) : 0,
  });
});

// Passo 1: genera un segreto e il QR da inquadrare. Il secondo fattore non e'
// ancora attivo: lo diventa solo dopo che un codice valido dimostra che l'app
// e' stata configurata davvero (evita di restare chiusi fuori).
router.post('/totp/setup', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Non autenticato' });
  if (user.totp_enabled) return res.status(400).json({ error: 'La verifica in due passaggi e\' gia\' attiva' });

  const secret = totp.generateSecret();
  auth.setTotpSecret(user.id, secret);
  const url = totp.otpauthUrl(secret, { account: user.username });
  res.json({ qr: qrSvg(url), secret: totp.formatSecret(secret), otpauth: url });
});

// Passo 2: conferma con un codice dell'app e ricevi i codici di recupero.
router.post('/totp/enable', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Non autenticato' });
  if (user.totp_enabled) return res.status(400).json({ error: 'La verifica in due passaggi e\' gia\' attiva' });
  if (!user.totp_secret) return res.status(400).json({ error: 'Genera prima il QR da inquadrare' });

  const { code } = req.body || {};
  if (!auth.verifyTotp(user.username, code)) {
    return res.status(400).json({ error: 'Codice non valido. Controlla che l\'ora del telefono sia corretta e riprova.' });
  }

  auth.enableTotp(user.id);
  // Mostrati una sola volta: nel database restano solo gli hash.
  res.json({ ok: true, recoveryCodes: auth.generateRecoveryCodes(user.id) });
});

// Rigenera i codici di recupero (i precedenti smettono di funzionare).
router.post('/totp/recovery-codes', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Non autenticato' });
  if (!user.totp_enabled) return res.status(400).json({ error: 'La verifica in due passaggi non e\' attiva' });

  const { password } = req.body || {};
  if (!auth.verifyUser(user.username, password)) {
    return res.status(403).json({ error: 'Password non corretta' });
  }
  res.json({ ok: true, recoveryCodes: auth.generateRecoveryCodes(user.id) });
});

// Disattivazione: serve la password, cosi' chi trovasse una sessione aperta
// non puo' togliere il secondo fattore senza conoscerla.
router.post('/totp/disable', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Non autenticato' });
  const { password } = req.body || {};
  if (!auth.verifyUser(user.username, password)) {
    return res.status(403).json({ error: 'Password non corretta' });
  }
  auth.disableTotp(user.id);
  res.json({ ok: true });
});

// --- Impronta digitale / Face ID (WebAuthn) per sbloccare il vault ---
router.get('/webauthn', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Non autenticato' });
  res.json({
    credentials: webauthn.credentialsForUser(user.id).map((c) => ({
      id: c.id,
      deviceName: c.device_name,
      createdAt: c.created_at,
      lastUsedAt: c.last_used_at,
    })),
  });
});

// Registrazione additiva (come il QR del TOTP): non serve la password, basta
// la sessione gia' autenticata su questo stesso dispositivo.
router.post('/webauthn/register/options', async (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Non autenticato' });
  const options = await webauthn.generateEnrollOptions(req, user);
  res.json(options);
});

router.post('/webauthn/register/verify', async (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Non autenticato' });
  const { credential, deviceName } = req.body || {};
  if (!credential) return res.status(400).json({ error: 'Corpo della richiesta non valido' });
  try {
    await webauthn.verifyEnroll(req, user, credential, deviceName);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  res.json({ ok: true });
});

// Rimozione: serve la password, come per la disattivazione del TOTP (chi
// trovasse una sessione aperta non deve poter togliere la protezione da solo).
router.delete('/webauthn/:id', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Non autenticato' });
  const { password } = req.body || {};
  if (!auth.verifyUser(user.username, password)) {
    return res.status(403).json({ error: 'Password non corretta' });
  }
  webauthn.removeCredential(user.id, req.params.id);
  res.status(204).end();
});

module.exports = router;
