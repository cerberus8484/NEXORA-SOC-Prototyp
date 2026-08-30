'use strict';

const { ServiceUnavailableError } = require('../../errors/AppError');

// Gemeinsamer System-Hinweis für Cloud-Chat-APIs: striktes JSON, keine Prosa drumherum.
// Der eigentliche Analyse-Prompt (aus der gemeinsamen Basis) kommt als User-Nachricht.
const CLOUD_SYSTEM_PROMPT =
  'Du bist ein erfahrener SOC-Analyst. Antworte AUSSCHLIESSLICH mit gültigem JSON gemäß ' +
  'den Vorgaben im folgenden Prompt — keinerlei Text außerhalb des JSON-Objekts.';

// Default-Timeout für Cloud-APIs. Die SOC-Triage fordert ein umfangreiches JSON-Schema;
// Claude braucht dafür im Live-Pfad regelmäßig mehr als 60s, das Frontend wartet bis 3 min.
const CLOUD_TIMEOUT_MS = parseInt(process.env.AGENT_CLOUD_TIMEOUT_MS || '120000', 10);

// Wirft, wenn kein API-Key konfiguriert ist — klare, nicht-leakende Meldung.
function requireApiKey(apiKey, providerName, envVar) {
  if (!apiKey) {
    throw new ServiceUnavailableError(
      `Der KI-Provider (${providerName}) ist nicht konfiguriert — ${envVar} fehlt.`,
      'AGENT_LLM_MISCONFIGURED',
    );
  }
}

// Mappt HTTP-/Netzwerkfehler auf eine saubere, key-freie Client-Meldung.
// Der Original-Fehler wird nur als cause fürs serverseitige Log durchgereicht.
function cloudLlmError(err, providerName) {
  const isTimeout = /timeout|ETIMEDOUT|aborted/i.test(err.message || '');
  const isAuth    = err.status === 401 || err.status === 403;
  const code = isTimeout ? 'AGENT_LLM_TIMEOUT' : isAuth ? 'AGENT_LLM_AUTH' : 'AGENT_LLM_UNAVAILABLE';
  const msg = isTimeout
    ? `Der KI-Provider (${providerName}) hat das Zeitlimit überschritten. Bitte später erneut versuchen.`
    : isAuth
      ? `Der KI-Provider (${providerName}) hat die Authentifizierung abgelehnt — API-Key prüfen.`
      : `Der KI-Provider (${providerName}) ist nicht erreichbar.`;
  return new ServiceUnavailableError(msg, code, err);
}

module.exports = { CLOUD_SYSTEM_PROMPT, CLOUD_TIMEOUT_MS, requireApiKey, cloudLlmError };
