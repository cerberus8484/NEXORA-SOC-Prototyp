'use strict';

const { ThreatIntelProvider } = require('./ThreatIntelProvider');

// DEMO/MOCK — keine echten Calls, keine Keys. Konsistente Heuristik für die UI,
// bis AbuseIPDB (P17.2) / VirusTotal (P17.3) angebunden sind. Threat Intel ist
// Enrichment, NICHT Wahrheit — kein automatischer Ticket-Verdict daraus.

const isPrivateV4 = (ip) => /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
const isMulticast = (ip) => { const o = Number(ip.split('.')[0]); return o >= 224 && o <= 239; };
// Beispiel-„malicious" nur für die Demo (Tor-Exit-Range, die wir schon kennen).
const DEMO_MALICIOUS = new Set(['185.220.101.12', '45.9.148.215']);

class MockThreatIntelProvider extends ThreatIntelProvider {
  get name() { return 'mock'; }
  isConfigured() { return true; } // Mock ist immer verfügbar (klar als Mock gekennzeichnet)

  async enrich(indicatorType, indicatorValue) {
    const checkedAt = new Date().toISOString();
    const base = { provider: 'mock', status: 'ok', checkedAt };

    if (indicatorType === 'ip') {
      const ip = indicatorValue;
      if (isMulticast(ip)) {
        const local = ip.startsWith('224.0.0.');
        return {
          ...base, verdict: 'clean', score: 5, confidence: 60,
          rawSummary: local
            ? 'Local multicast address (224.0.0.0/24, Local Network Control), normally not internet-routable.'
            : 'IPv4 multicast address, normally not internet-routable.',
          details: { category: 'multicast', tags: ['multicast', ...(local ? ['local-network-control'] : [])] },
        };
      }
      if (isPrivateV4(ip)) {
        return {
          ...base, verdict: 'clean', score: 2, confidence: 50,
          rawSummary: 'Private/internal address (RFC1918 / loopback / link-local).',
          details: { category: 'internal', tags: ['internal', 'rfc1918'] },
        };
      }
      if (DEMO_MALICIOUS.has(ip)) {
        return {
          ...base, verdict: 'malicious', score: 88, confidence: 90,
          rawSummary: 'Known malicious (DEMO) — example C2 / Tor-exit indicator.',
          details: { category: 'malicious', tags: ['demo', 'c2', 'tor-exit'] },
        };
      }
      return {
        ...base, verdict: 'unknown', score: 0, confidence: 10,
        rawSummary: 'Mock intelligence — no provider connected for this public IP.',
        details: { category: 'unknown', tags: [] },
      };
    }

    if (indicatorType === 'domain') {
      const susp = /suspicious|malware|phish|c2|beacon/i.test(indicatorValue);
      return {
        ...base, verdict: susp ? 'suspicious' : 'unknown', score: susp ? 60 : 0, confidence: susp ? 50 : 10,
        rawSummary: susp ? 'Mock — domain name pattern looks suspicious.' : 'Mock — no provider connected for domain.',
        details: { tags: susp ? ['suspicious-name'] : [] },
      };
    }

    // url / hash — in P17.1 nur neutral
    return {
      ...base, verdict: 'unknown', score: 0, confidence: 10,
      rawSummary: `Mock — no provider connected for ${indicatorType}.`,
      details: { tags: [] },
    };
  }
}

module.exports = { MockThreatIntelProvider, isPrivateV4, isMulticast };
