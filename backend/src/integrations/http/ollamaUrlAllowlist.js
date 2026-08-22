'use strict';

// SSRF-Schutz: eine Ollama-Base-URL darf NUR auf localhost oder einen RFC-1918-Host
// zeigen (interner Inferenz-Server). Von routes/settings.js (PUT/GET /settings/ki,
// /ki/models) UND routes/integrations.js (Status-Ping) genutzt. Die Regex selbst
// lebt geteilt in internalUrlAllowlist.js (Single Source of Truth, auch Wazuh-Verbindung).
const { INTERNAL_URL_ALLOWLIST } = require('./internalUrlAllowlist');
const OLLAMA_URL_ALLOWLIST = INTERNAL_URL_ALLOWLIST;

function isAllowedOllamaUrl(url) {
  return typeof url === 'string' && OLLAMA_URL_ALLOWLIST.test(url);
}

module.exports = { OLLAMA_URL_ALLOWLIST, isAllowedOllamaUrl };
