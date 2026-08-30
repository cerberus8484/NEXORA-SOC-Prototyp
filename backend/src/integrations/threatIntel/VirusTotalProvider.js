'use strict';

const { ThreatIntelProvider } = require('./ThreatIntelProvider');
const { RealHttpClient } = require('../http/RealHttpClient');
const { isPublicIp } = require('./ipClass');

// VirusTotal v3 — IP-Report. Key backend-only (Free-Tier ~4 req/min, 500/day → Cache + nur public IPs).
// https://www.virustotal.com/api/v3/ip_addresses/{ip}  (Header: x-apikey)
class VirusTotalProvider extends ThreatIntelProvider {
  constructor({ key = '', http = null } = {}) {
    super();
    this._key = key;
    this._http = http || new RealHttpClient({ timeout: 8000 });
  }

  get name() { return 'virustotal'; }
  isConfigured() { return Boolean(this._key); }

  /** Layer 2: Key zur Laufzeit ändern (Settings-UI). */
  reconfigure({ key = '' } = {}) {
    this._key = key;
  }

  async enrich(indicatorType, indicatorValue) {
    const checkedAt = new Date().toISOString();
    const base = { provider: 'virustotal', checkedAt, details: {} };

    if (indicatorType !== 'ip') {
      return { ...base, status: 'ok', verdict: 'unknown', score: 0, confidence: 0, rawSummary: 'VirusTotal-Adapter unterstützt aktuell nur IP-Indikatoren.' };
    }
    const ip = String(indicatorValue).trim();
    if (!isPublicIp(ip)) {
      return { ...base, status: 'ok', verdict: 'unknown', score: 0, confidence: 0, rawSummary: 'Nicht-öffentliche IP — nicht extern abgefragt.', details: { skipped: true } };
    }

    try {
      const res = await this._http.request(
        `https://www.virustotal.com/api/v3/ip_addresses/${encodeURIComponent(ip)}`,
        { method: 'GET', headers: { 'x-apikey': this._key } },
      );
      const attr = (((res.data || {}).data || {}).attributes) || {};
      const s = attr.last_analysis_stats || {};
      const malicious = Number(s.malicious || 0);
      const suspicious = Number(s.suspicious || 0);
      const harmless = Number(s.harmless || 0);
      const undetected = Number(s.undetected || 0);
      const total = malicious + suspicious + harmless + undetected;
      // >=3 Engines „malicious" → malicious (gegen Einzel-Vendor-FP); 1–2 oder suspicious → suspicious.
      const verdict = malicious >= 3 ? 'malicious' : (malicious > 0 || suspicious > 0) ? 'suspicious' : harmless > 0 ? 'clean' : 'unknown';
      const score = total > 0 ? Math.round((malicious / total) * 100) : 0;
      const confidence = total > 0 ? Math.min(100, total) : 0;
      return {
        ...base, status: 'ok', verdict, score, confidence,
        rawSummary: `VirusTotal: ${malicious} malicious / ${suspicious} suspicious / ${harmless} harmless (${total} engines).`,
        details: {
          tags: [attr.as_owner, attr.country].filter(Boolean),
          malicious, suspicious, harmless, undetected, reputation: attr.reputation, asOwner: attr.as_owner, country: attr.country,
        },
      };
    } catch (err) {
      const status = err.status === 429 ? 'rate_limited' : 'error';
      return { ...base, status, verdict: 'unknown', score: 0, confidence: 0, rawSummary: err.status === 429 ? 'VirusTotal Rate-Limit (Free-Tier 4/min).' : `VirusTotal Fehler: ${err.message}` };
    }
  }
}

module.exports = { VirusTotalProvider };
