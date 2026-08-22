'use strict';

/**
 * integrationStatusMapper — pure Mapping-Logik (kein I/O, vollständig testbar).
 *
 * Liest Config-Presence aus ENV (oder einem injizierten env-Objekt) und baut
 * je Integration ein Status-Objekt:
 *   { id, name, category, configured, endpoint, status, testable }
 *
 * SICHERHEITS-INVARIANTEN (per Test belegt):
 *   - endpoint enthält NUR Host (keine user:pass@, keine Pfade, keine API-Keys)
 *   - Response-Objekte haben KEINE Felder api_key / password / token / secret
 *   - Credentials werden aus URLs herausgestrippt (stripCredentials)
 */

/**
 * Entfernt user:password@... aus einer URL und gibt nur Host[:Port] zurück.
 * Gibt '' zurück wenn url leer/ungültig.
 *
 * @param {string} rawUrl
 * @returns {string}
 */
function extractHost(rawUrl) {
  if (!rawUrl) return '';
  try {
    // Wenn die URL kein Schema hat, URL-Parser mit Dummy-Schema aufrufen.
    const withSchema = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    const u = new URL(withSchema);
    // Host = hostname + port (kein Pfad, kein user:pass)
    return u.host; // z.B. "wazuh.example.com:55000"
  } catch {
    // Kein gültiges URL-Format → leerer String (kein Leak)
    return '';
  }
}

/**
 * Alle bekannten Integrationen mit ihren Konfigurationsquellen.
 *
 * testable = true  → POST /integrations/:id/test führt echten Netzwerk-Check durch
 * testable = false → Test nicht implementierbar (kein einfacher Ping) → 501
 */
const INTEGRATION_DEFINITIONS = [
  // ── SIEM ──────────────────────────────────────────────────────────────────
  {
    id:       'wazuh',
    name:     'Wazuh',
    category: 'siem',
    testable: true,
    isConfigured: (env) => Boolean(
      (env.WAZUH_API_URL && env.WAZUH_API_USER && env.WAZUH_API_PASSWORD)
      || (env.WAZUH_INDEXER_URL && env.WAZUH_INDEXER_USER && env.WAZUH_INDEXER_PASSWORD),
    ),
    getEndpoint:  (env) => extractHost(env.WAZUH_API_URL || env.WAZUH_INDEXER_URL || ''),
  },
  {
    id:       'qradar',
    name:     'QRadar',
    category: 'siem',
    testable: false,
    isConfigured: (env) => Boolean(env.QRADAR_BASE_URL && env.QRADAR_TOKEN),
    getEndpoint:  (env) => extractHost(env.QRADAR_BASE_URL || ''),
  },
  {
    id:       'splunk',
    name:     'Splunk',
    category: 'siem',
    testable: false,
    isConfigured: (env) => Boolean(env.SPLUNK_HOST || env.SPLUNK_BASE_URL),
    getEndpoint:  (env) => extractHost(env.SPLUNK_HOST || env.SPLUNK_BASE_URL || ''),
  },

  // ── Threat Intel ──────────────────────────────────────────────────────────
  {
    id:       'virustotal',
    name:     'VirusTotal',
    category: 'threat_intel',
    testable: true,
    isConfigured: (env) => Boolean(env.VIRUSTOTAL_API_KEY),
    // API-Key enthält keinen Host → kein sinnvoller Endpoint anzeigbar
    getEndpoint:  () => 'www.virustotal.com',
  },
  {
    id:       'abuseipdb',
    name:     'AbuseIPDB',
    category: 'threat_intel',
    testable: true,
    isConfigured: (env) => Boolean(env.ABUSEIPDB_API_KEY),
    getEndpoint:  () => 'api.abuseipdb.com',
  },

  // ── LLM / KI ──────────────────────────────────────────────────────────────
  {
    id:       'ollama',
    name:     'Ollama (LLM)',
    category: 'llm',
    testable: true,
    // Ollama-URL kommt aus ENV OLLAMA_BASE_URL (oder wird via Settings gespeichert)
    isConfigured: (env) => Boolean(env.OLLAMA_BASE_URL),
    getEndpoint:  (env) => extractHost(env.OLLAMA_BASE_URL || ''),
  },

  // ── Ticketing ─────────────────────────────────────────────────────────────
  {
    id:       'servicenow',
    name:     'ServiceNow',
    category: 'ticketing',
    testable: false,
    isConfigured: (env) => Boolean(env.SERVICENOW_BASE_URL),
    getEndpoint:  (env) => extractHost(env.SERVICENOW_BASE_URL || ''),
  },
  {
    id:       'otrs',
    name:     'OTRS / Znuny',
    category: 'ticketing',
    testable: false,
    isConfigured: (env) => Boolean(env.OTRS_BASE_URL),
    getEndpoint:  (env) => extractHost(env.OTRS_BASE_URL || ''),
  },

  // ── E-Mail ────────────────────────────────────────────────────────────────
  {
    id:       'email',
    name:     'E-Mail (IMAP)',
    category: 'email',
    testable: false,
    isConfigured: (env) => Boolean(env.IMAP_HOST && env.IMAP_USER && env.IMAP_PASSWORD),
    getEndpoint:  (env) => env.IMAP_HOST || '',
  },
];

// Erlaubte IDs — für Allowlist-Validierung im Router
const INTEGRATION_IDS = INTEGRATION_DEFINITIONS.map((d) => d.id);
const definitionById = (id) => INTEGRATION_DEFINITIONS.find((d) => d.id === id);

function makeStatusItem(def, configured, endpoint) {
  return {
    id: def.id,
    name: def.name,
    category: def.category,
    configured,
    endpoint: configured ? (endpoint || '') : '',
    status: configured ? 'configured' : 'not_configured',
    testable: def.testable,
  };
}

/**
 * Baut die Integrations-Status-Liste aus Config-Presence.
 *
 * Kein Netzwerk-Aufruf, kein I/O — nur ENV-Lesung.
 * Injiziertes env-Objekt erlaubt vollständiges Testen ohne process.env zu mutierten.
 *
 * @param {{ env?: Record<string, string> }} opts
 * @returns {Array<{id, name, category, configured, endpoint, status, testable}>}
 */
function buildIntegrationStatus({ env = process.env } = {}) {
  return INTEGRATION_DEFINITIONS.map((def) => {
    const configured = def.isConfigured(env);
    const endpoint   = configured ? (def.getEndpoint(env) || '') : '';
    return makeStatusItem(def, configured, endpoint);
  });
}

/**
 * Effektiver Integrations-Status fuer die echte Admin-Uebersicht.
 * Nutzt dieselben Layer-2-Quellen wie die Konfig-Seiten:
 *   - DB gewinnt ueber ENV
 *   - ENV bleibt Fallback
 *
 * Die pure Funktion buildIntegrationStatus bleibt fuer einfache ENV-Mapping-Tests erhalten.
 */
async function buildEffectiveIntegrationStatus({ settingsRepo, env = process.env } = {}) {
  const {
    resolveWazuhConnection,
  } = require('../services/wazuhConnectionSettings');
  const {
    resolveQradarConnection,
  } = require('../services/qradarConnectionSettings');
  const {
    resolveServicenowConnection,
  } = require('../services/servicenowConnectionSettings');
  const {
    resolveOtrsConnection,
  } = require('../services/otrsConnectionSettings');
  const {
    resolveImapConnection,
  } = require('../services/imapConnectionSettings');
  const {
    resolveTiKey,
  } = require('../services/threatIntelKeys');
  const {
    resolveOllamaConnection,
  } = require('../services/ollamaConnectionSettings');

  const [
    wazuh,
    qradar,
    servicenow,
    otrs,
    imap,
    virustotal,
    abuseipdb,
    ollama,
  ] = await Promise.all([
    resolveWazuhConnection(settingsRepo),
    resolveQradarConnection(settingsRepo),
    resolveServicenowConnection(settingsRepo, env),
    resolveOtrsConnection(settingsRepo, env),
    resolveImapConnection(settingsRepo, env),
    resolveTiKey('virustotal', settingsRepo),
    resolveTiKey('abuseipdb', settingsRepo),
    resolveOllamaConnection(settingsRepo, env),
  ]);

  const wazuhConfigured = Boolean(
    (wazuh.api.url && wazuh.api.user && wazuh.api.password)
    || (wazuh.indexer.url && wazuh.indexer.user && wazuh.indexer.password),
  );
  const wazuhEndpoint = extractHost(wazuh.api.url || wazuh.indexer.url || '');

  const overrides = new Map([
    ['wazuh', makeStatusItem(definitionById('wazuh'), wazuhConfigured, wazuhEndpoint)],
    ['qradar', makeStatusItem(definitionById('qradar'), Boolean(qradar.baseUrl && qradar.token), extractHost(qradar.baseUrl || ''))],
    ['virustotal', makeStatusItem(definitionById('virustotal'), Boolean(virustotal.key), 'www.virustotal.com')],
    ['abuseipdb', makeStatusItem(definitionById('abuseipdb'), Boolean(abuseipdb.key), 'api.abuseipdb.com')],
    ['ollama', makeStatusItem(definitionById('ollama'), Boolean(ollama.baseUrl), extractHost(ollama.baseUrl))],
    ['servicenow', makeStatusItem(definitionById('servicenow'), Boolean(servicenow.baseUrl && servicenow.username && servicenow.password), extractHost(servicenow.baseUrl || ''))],
    ['otrs', makeStatusItem(definitionById('otrs'), Boolean(otrs.baseUrl && otrs.username && otrs.password), extractHost(otrs.baseUrl || ''))],
    ['email', makeStatusItem(definitionById('email'), Boolean(imap.host && imap.user && imap.password), imap.host || '')],
  ]);

  return INTEGRATION_DEFINITIONS.map((def) => overrides.get(def.id) || makeStatusItem(def, def.isConfigured(env), def.getEndpoint(env)));
}

module.exports = { buildIntegrationStatus, buildEffectiveIntegrationStatus, INTEGRATION_IDS, INTEGRATION_DEFINITIONS };
