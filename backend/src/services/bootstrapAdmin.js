'use strict';

const { authService } = require('./AuthService');
const logger = require('../logger');

/**
 * Liest ADMIN_EMAIL / ADMIN_PASSWORD aus der Umgebung und legt — idempotent —
 * einen Admin an, falls dieser noch nicht existiert.
 * Loggt NIEMALS das Passwort. Wirft nicht: Fehler werden geloggt + zurückgegeben,
 * damit ein Konfigurationsfehler den Serverstart nicht verhindert.
 */
async function ensureAdminFromEnv(svc = authService) {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    logger.info('admin_bootstrap_skipped', { reason: 'ADMIN_EMAIL/ADMIN_PASSWORD nicht gesetzt' });
    return { skipped: true };
  }

  try {
    // Default: Wechsel beim ersten Login erzwingen. Automatisierte Fixtures (E2E)
    // können via ADMIN_MUST_CHANGE_PASSWORD=false opt-out — dann ist der Admin
    // direkt nutzbar (kein Erstanmeldungs-Screen).
    const mustChangePassword = process.env.ADMIN_MUST_CHANGE_PASSWORD !== 'false';
    const result = await svc.ensureAdminUser({ email, password, mustChangePassword });
    if (result.created) logger.info('admin_bootstrap_created', { email });
    else                logger.info('admin_bootstrap_exists',  { email });
    return result;
  } catch (err) {
    // Nur die Fehlermeldung loggen — niemals das Passwort.
    logger.error('admin_bootstrap_failed', { message: err.message });
    return { error: err.message };
  }
}

module.exports = { ensureAdminFromEnv };
