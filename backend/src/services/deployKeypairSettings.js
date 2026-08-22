'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Platform-Deploy-Keypair (Slice 6d) — das SSH-Keypair, mit dem Nexora deployte
// Server für Updates erreicht (Auth-Modell A). Nexora GENERIERT es selbst (ed25519):
//   - der PRIVATE Key wird AES-256-GCM verschlüsselt in platform_settings abgelegt
//     (secretsCrypto) und NIE herausgegeben — nur transient beim Runner-Bau (6f);
//   - der PUBLIC Key (OpenSSH-Format) ist öffentlich: der Renderer (6e) legt ihn in
//     authorized_keys der deployten VM; der Admin sieht ihn + den Fingerprint.
//
// Rotieren (neu generieren) invalidiert bestehende authorized_keys-Provisionierungen
// → sicherheitsrelevant (Route erzwingt Reauth). Kein TOFU: der Private-Key ist die
// einzige Auth zum Ziel, der gepinnte Host-Key (6a–c) die Gegenrichtung.
// ─────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const { encryptSecret, decryptSecret, isEncrypted } = require('../config/secretsCrypto');
const { createSettingsRepository } = require('../repositories/settingsRepositoryFactory');

const KEY = 'deploy_keypair';
const COMMENT = 'nexora-deploy';

function lenPrefixed(buf) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(buf.length, 0);
  return Buffer.concat([len, buf]);
}

// OpenSSH-Public-Key (authorized_keys-Zeile) aus einem ed25519-Public-Key ableiten.
// Wire-Format: string "ssh-ed25519" + string <32-Byte-Raw-Pubkey>, base64-kodiert.
function toOpenSshEd25519(publicKeyObj) {
  // publicKeyObj ist ein crypto.KeyObject (aus generateKeyPairSync) ODER Key-Material —
  // createPublicKey normalisiert Key-Material; ein KeyObject wird direkt exportiert.
  const keyObj = (publicKeyObj && typeof publicKeyObj.export === 'function' && publicKeyObj.type)
    ? publicKeyObj : crypto.createPublicKey(publicKeyObj);
  const jwk = keyObj.export({ format: 'jwk' });
  const raw = Buffer.from(jwk.x, 'base64url'); // 32-Byte ed25519-Public-Key
  const blob = Buffer.concat([lenPrefixed(Buffer.from('ssh-ed25519')), lenPrefixed(raw)]);
  const b64 = blob.toString('base64');
  // OpenSSH-Fingerprint: SHA256:<base64(sha256(blob)) ohne Padding>
  const fp = 'SHA256:' + crypto.createHash('sha256').update(blob).digest('base64').replace(/=+$/, '');
  return { publicKey: `ssh-ed25519 ${b64} ${COMMENT}`, fingerprint: fp };
}

/** Maskierte Sicht — NIE der Private-Key. { isSet, publicKey?, fingerprint?, createdAt? } */
async function getDeployKeypair(repo = createSettingsRepository()) {
  const s = await repo.get(KEY);
  if (!s || !s.privateKeyEnc) return { isSet: false };
  return { isSet: true, publicKey: s.publicKey || null, fingerprint: s.fingerprint || null, createdAt: s.createdAt || null };
}

/** Generiert (oder rotiert) das Deploy-Keypair. Speichert den Private-Key verschlüsselt.
 *  @returns {Promise<{isSet:true, publicKey:string, fingerprint:string, createdAt:string}>} (maskiert) */
async function generateDeployKeypair(repo = createSettingsRepository(), { now } = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const { publicKey: openSsh, fingerprint } = toOpenSshEd25519(publicKey);
  const createdAt = now || new Date().toISOString();
  await repo.set(KEY, { privateKeyEnc: encryptSecret(privatePem), publicKey: openSsh, fingerprint, createdAt });
  return { isSet: true, publicKey: openSsh, fingerprint, createdAt };
}

/** Transient: entschlüsselter Private-Key (PEM) NUR für den Runner-Bau (6f). Null, wenn
 *  nicht gesetzt. Wirft fail-closed, wenn der gespeicherte Wert nicht verschlüsselt ist. */
async function resolveDeployPrivateKey(repo = createSettingsRepository()) {
  const s = await repo.get(KEY);
  if (!s || !s.privateKeyEnc) return null;
  if (!isEncrypted(s.privateKeyEnc)) throw new Error('deploy_keypair: privateKeyEnc ist nicht verschlüsselt — Abbruch (fail-closed)');
  return decryptSecret(s.privateKeyEnc);
}

/** Nur der Public-Key (für den Renderer 6e). Null, wenn nicht gesetzt. */
async function resolveDeployPublicKey(repo = createSettingsRepository()) {
  const s = await repo.get(KEY);
  return (s && s.publicKey) || null;
}

module.exports = { getDeployKeypair, generateDeployKeypair, resolveDeployPrivateKey, resolveDeployPublicKey, toOpenSshEd25519, KEY };
