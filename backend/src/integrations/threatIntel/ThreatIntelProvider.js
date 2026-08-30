'use strict';

// Basis-Interface für Threat-Intel-Provider (Mock, AbuseIPDB, VirusTotal …).
// enrich() liefert ein ThreatIntelProviderResult:
//   { provider, status: 'not_configured'|'ok'|'error'|'rate_limited', verdict, score,
//     confidence, rawSummary, details, checkedAt }
class ThreatIntelProvider {
  get name() { return 'base'; }
  isConfigured() { return false; }
  // eslint-disable-next-line no-unused-vars
  async enrich(indicatorType, indicatorValue) { throw new Error('ThreatIntelProvider.enrich not implemented'); }
}

module.exports = { ThreatIntelProvider };
