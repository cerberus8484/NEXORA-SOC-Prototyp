'use strict';

// Symmetrische Verschlüsselung für at-rest gespeicherte Secrets (z.B. Cloud-LLM-API-Keys).
// AES-256-GCM. Der Schlüssel wird aus SETTINGS_ENC_KEY abgeleitet (Fallback: JWT_SECRET,
// das in Produktion ohnehin gesetzt + ≥32 Zeichen ist). So ist kein zusätzliches ENV
// zwingend nötig, und Secrets liegen NIE im Klartext in der DB.
//
// Format: "enc:v1:" + base64( iv(12) | authTag(16) | ciphertext )

const crypto = require('crypto');

const PREFIX = 'enc:v1:';

// Nur außerhalb Produktion: stabiler Dev-Fallback, damit Verschlüsselung ohne
// ENV out-of-box funktioniert (analog zum JWT-Dev-Fallback). In Produktion ist
// JWT_SECRET ohnehin Pflicht (≥32 Zeichen) → echter Schlüssel.
const DEV_FALLBACK_KEY = 'dev-settings-encryption-fallback-key-change-me-32+';

function _deriveKey() {
  let src = process.env.SETTINGS_ENC_KEY || process.env.JWT_SECRET || '';
  if ((!src || src.length < 16) && process.env.NODE_ENV !== 'production') {
    src = DEV_FALLBACK_KEY;
  }
  if (!src || src.length < 16) return null;
  return crypto.createHash('sha256').update(String(src)).digest(); // 32 Byte
}

/** Verschlüsselt einen Klartext. Leerer/null-Wert → '' (nichts zu speichern). */
function encryptSecret(plaintext) {
  if (plaintext == null || plaintext === '') return '';
  const key = _deriveKey();
  if (!key) throw new Error('Kein Verschlüsselungs-Schlüssel verfügbar (SETTINGS_ENC_KEY oder JWT_SECRET setzen)');
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct     = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

/** Entschlüsselt einen gespeicherten Wert. Nicht-verschlüsselte Werte werden unverändert
 *  zurückgegeben (Abwärtskompatibilität). Bei Fehler/fehlendem Key → ''. */
function decryptSecret(stored) {
  if (typeof stored !== 'string' || !stored.startsWith(PREFIX)) return stored || '';
  const key = _deriveKey();
  if (!key) return '';
  try {
    const buf = Buffer.from(stored.slice(PREFIX.length), 'base64');
    const iv  = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct  = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch (err) {
    // GCM-Auth-Tag-Fehler (korrupt/getampert/falscher Key nach Rotation) sichtbar
    // machen — sonst sieht der Aufrufer '' und hält es für „kein Wert konfiguriert",
    // was z.B. Cloud-LLM-Provider still deaktiviert. Kein Klartext/Key im Log.
    require('../logger').warn('secret_decrypt_failed', { message: err.message });
    return '';
  }
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

module.exports = { encryptSecret, decryptSecret, isEncrypted };
