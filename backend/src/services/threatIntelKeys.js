'use strict';

// Layer 2 (Frontend-Administrierbarkeit): Threat-Intel-Provider-Keys (VirusTotal +
// AbuseIPDB) aus der DB verwalten statt nur ENV. Konvention wie Wazuh-Verbindung:
//   - DB gewinnt über ENV, ENV bleibt Fail-safe-Fallback,
//   - Keys AES-256-GCM-verschlüsselt (secretsCrypto), nie Klartext in DB/Log,
//   - nach außen nur maskiert (keySet-Boolean + Quelle).

const { encryptSecret, decryptSecret } = require('../config/secretsCrypto');

const TI_PROVIDERS = ['virustotal', 'abuseipdb'];

// Settings-Key (verschlüsselt gespeichert) je Provider.
const KEY_SETTING_KEY = {
  virustotal: 'virusTotalApiKey',
  abuseipdb:  'abuseIpDbApiKey',
};

// ENV-Variable je Provider (Fallback, wenn kein DB-Key gesetzt ist).
const KEY_ENV = {
  virustotal: 'VIRUSTOTAL_API_KEY',
  abuseipdb:  'ABUSEIPDB_API_KEY',
};

function _assertKnown(provider) {
  if (!TI_PROVIDERS.includes(provider)) {
    throw new Error(`Unbekannter Threat-Intel-Provider: ${provider}`);
  }
}

/** Effektiver Key eines Providers (DB > ENV) — entschlüsselt, nur backend-intern nutzen. */
async function resolveTiKey(provider, repo) {
  _assertKnown(provider);
  const stored = await repo.get(KEY_SETTING_KEY[provider]);
  if (typeof stored === 'string' && stored !== '') {
    return { key: decryptSecret(stored), source: 'db' };
  }
  const envKey = process.env[KEY_ENV[provider]];
  if (envKey) return { key: envKey, source: 'env' };
  return { key: '', source: 'none' };
}

/** Keys speichern ({ virustotal?, abuseipdb? }); leerer Wert = unverändert.
 *  Liefert die Liste der tatsächlich geänderten Provider (für Audit). */
async function saveTiKeys(repo, patch) {
  const changed = [];
  for (const provider of TI_PROVIDERS) {
    const raw = patch && patch[provider];
    if (typeof raw === 'string' && raw.trim() !== '') {
      await repo.set(KEY_SETTING_KEY[provider], encryptSecret(raw.trim()));
      changed.push(provider);
    }
  }
  return changed;
}

/** Maskierte Sicht fürs Frontend — NIE Key-Werte, nur keySet + Quelle. */
async function maskedTiKeys(repo) {
  const out = [];
  for (const provider of TI_PROVIDERS) {
    const { key, source } = await resolveTiKey(provider, repo);
    out.push({ provider, keySet: key !== '', source });
  }
  return out;
}

module.exports = { TI_PROVIDERS, KEY_SETTING_KEY, KEY_ENV, resolveTiKey, saveTiKeys, maskedTiKeys };
