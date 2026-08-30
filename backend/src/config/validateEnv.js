'use strict';

/**
 * Produktions-ENV-Validierung — Fail Fast.
 *
 * Wenn ein Pflicht-Secret fehlt oder den unsicheren Default hat,
 * startet der Server NICHT. Besser ein klarer Fehler als stiller Betrieb.
 *
 * Wird in server.js vor allem anderen aufgerufen.
 */
function validateEnv() {
  const env    = process.env.NODE_ENV || 'development';
  const errors = [];

  if (env !== 'production') return; // Nur in Produktion prüfen

  // ── Pflicht-Secrets ──────────────────────────────────────
  const required = [
    { key: 'JWT_SECRET',    minLength: 32, noDefault: 'dev-secret-change-in-production-min-32-chars' },
    { key: 'DB_HOST' },
    { key: 'DB_NAME' },
    { key: 'DB_USER' },
    { key: 'DB_PASSWORD',   noDefault: 'devpassword' },
  ];

  for (const { key, minLength, noDefault } of required) {
    const val = process.env[key];

    if (!val) {
      errors.push(`${key} ist nicht gesetzt`);
      continue;
    }
    if (noDefault && val === noDefault) {
      errors.push(`${key} hat noch den unsicheren Entwicklungs-Default — bitte ändern`);
    }
    if (minLength && val.length < minLength) {
      errors.push(`${key} muss mindestens ${minLength} Zeichen haben (aktuell: ${val.length})`);
    }
  }

  // ── Platzhalter-Schutz (Fresh-Install) ───────────────────────
  // Wer deploy/.env.production.example kopiert, ohne gen-env-production.sh zu laufen,
  // hätte "CHANGE_ME_…"-Platzhalter als Secrets. Die sind >32 Zeichen und ≠ den
  // bekannten Dev-Defaults → würden die obige Prüfung passieren. Hier generisch fangen,
  // sonst bootet die Prod mit einem im Repo öffentlich dokumentierten Platzhalter.
  for (const key of [
    'JWT_SECRET', 'DB_PASSWORD', 'AUDIT_IP_SALT',
    'WEBHOOK_SECRET_GENERIC', 'WEBHOOK_SECRET_WAZUH', 'WEBHOOK_SECRET_DATAPLANE', 'ADMIN_PASSWORD',
  ]) {
    const val = process.env[key];
    if (val && /CHANGE_ME/i.test(val)) {
      errors.push(`${key} enthält noch einen "CHANGE_ME"-Platzhalter — Secrets generieren (deploy/gen-env-production.sh)`);
    }
  }

  // ── Warnung wenn CORS zu offen ────────────────────────────
  const cors = process.env.CORS_ORIGINS || '';
  if (cors.includes('*') || cors.includes('localhost')) {
    errors.push('CORS_ORIGINS enthält * oder localhost — in Produktion nicht erlaubt');
  }

  // ── Webhook-Secret Hinweis ────────────────────────────────
  const webhookGeneric = process.env.WEBHOOK_SECRET_GENERIC;
  if (webhookGeneric === 'dev-webhook-secret-change-in-production') {
    errors.push('WEBHOOK_SECRET_GENERIC hat noch den Entwicklungs-Default');
  }

  // ── Audit-IP-Salt (DSGVO-Pseudonymisierung) — Pflicht-Secret in Produktion ──
  // Mit dem öffentlich bekannten Dev-Default ist die IP-Pseudonymisierung im Audit-Log
  // de-anonymisierbar (DSGVO Art. 25) → Fail-fast. (Operator-Salt in Prod gesetzt 2026-06-30;
  // davor war dies nur eine Warnung, um die laufende Prod nicht zu brechen.)
  const ipSalt = process.env.AUDIT_IP_SALT;
  if (!ipSalt || ipSalt === 'dev-audit-ip-salt-change-in-production') {
    errors.push(
      'AUDIT_IP_SALT ist nicht gesetzt bzw. nutzt den bekannten Entwicklungs-Default — ' +
      'die Audit-IP-Pseudonymisierung wäre de-anonymisierbar (DSGVO Art. 25). ' +
      'AUDIT_IP_SALT (≥32 zufällige Zeichen) setzen.',
    );
  } else if (ipSalt.length < 32) {
    errors.push(`AUDIT_IP_SALT muss mindestens 32 Zeichen haben (aktuell: ${ipSalt.length})`);
  }

  // ── Deployment Center (ADR-041) — Infra-Write nur mit SSRF-Allowlist ──
  // Ist DEPLOY_ENABLED scharf, MUSS eine Hypervisor-Host-Allowlist gesetzt sein,
  // sonst könnte ein Connector-Host beliebig (SSRF) gewählt werden. Fail-fast.
  if (process.env.DEPLOY_ENABLED === 'true') {
    const allowed = String(process.env.DEPLOY_HYPERVISOR_ALLOWED_HOSTS || '').trim();
    if (!allowed) {
      errors.push(
        'DEPLOY_ENABLED=true, aber DEPLOY_HYPERVISOR_ALLOWED_HOSTS ist leer — ' +
        'ohne SSRF-Allowlist der erlaubten Hypervisor-Hosts darf der Deploy-Kanal nicht scharf sein.',
      );
    }
    // Key-Separation: der Hypervisor-API-Token wird verschlüsselt (secretsCrypto). Ohne
    // dediziertes SETTINGS_ENC_KEY fiele der Schlüssel auf JWT_SECRET zurück → eine
    // JWT-Rotation würde alle Deploy-Secrets unlesbar machen. Daher hier Pflicht.
    const encKey = process.env.SETTINGS_ENC_KEY || '';
    if (encKey.length < 16) {
      errors.push(
        'DEPLOY_ENABLED=true erfordert ein dediziertes SETTINGS_ENC_KEY (≥32 zufällige Zeichen) — ' +
        'kein JWT_SECRET-Fallback zum Verschlüsseln der Hypervisor-Token (Key-Separation).',
      );
    }
  }

  // ── TLS-Warnung Wazuh ────────────────────────────────────
  // Kein Fehler (Lab-Default bleibt false), aber in Produktion explizit warnen.
  if (process.env.WAZUH_TLS_REJECT_UNAUTHORIZED !== 'true') {
    console.warn(
      '[validateEnv] WARNUNG: WAZUH_TLS_REJECT_UNAUTHORIZED ist nicht "true" — ' +
      'TLS-Zertifikat-Validierung für Wazuh-API und Indexer ist deaktiviert. ' +
      'In Produktion auf "true" setzen und ein gültiges Zertifikat verwenden.',
    );
  }

  if (errors.length > 0) {
    console.error('\n╔══════════════════════════════════════════════════╗');
    console.error('║  PRODUKTIONS-KONFIGURATION UNGÜLTIG               ║');
    console.error('╚══════════════════════════════════════════════════╝\n');
    errors.forEach(e => console.error(`  ✗ ${e}`));
    console.error('\nServer wird nicht gestartet. ENV-Datei prüfen.\n');
    process.exit(1);
  }
}

module.exports = { validateEnv };
