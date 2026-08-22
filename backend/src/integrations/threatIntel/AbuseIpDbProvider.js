'use strict';

const { ThreatIntelProvider } = require('./ThreatIntelProvider');
const { RealHttpClient } = require('../http/RealHttpClient');
const { isPublicIp } = require('./ipClass');

// AbuseIPDB v2 /check — nur IPv4/IPv6, nur öffentliche IPs. Key backend-only.
// https://api.abuseipdb.com/api/v2/check?ipAddress=...&maxAgeInDays=...  (Header: Key, Accept)
class AbuseIpDbProvider extends ThreatIntelProvider {
  constructor({ key = '', maxAgeInDays = 90, http = null } = {}) {
    super();
    this._key = key;
    this._maxAge = maxAgeInDays;
    this._http = http || new RealHttpClient({ timeout: 8000 });
  }

  get name() { return 'abuseipdb'; }
  isConfigured() { return Boolean(this._key); }

  /** Layer 2: Key/maxAge zur Laufzeit ändern (Settings-UI). maxAgeInDays optional. */
  reconfigure({ key = '', maxAgeInDays } = {}) {
    this._key = key;
    if (maxAgeInDays !== undefined) this._maxAge = maxAgeInDays;
  }

  async enrich(indicatorType, indicatorValue) {
    const checkedAt = new Date().toISOString();
    const base = { provider: 'abuseipdb', checkedAt, details: {} };

    if (indicatorType !== 'ip') {
      return { ...base, status: 'ok', verdict: 'unknown', score: 0, confidence: 0, rawSummary: 'AbuseIPDB unterstützt nur IP-Indikatoren.' };
    }
    const ip = String(indicatorValue).trim();
    if (!isPublicIp(ip)) {
      return { ...base, status: 'ok', verdict: 'unknown', score: 0, confidence: 0, rawSummary: 'Nicht-öffentliche IP — nicht extern abgefragt.', details: { skipped: true } };
    }

    try {
      const res = await this._http.request(
        `https://api.abuseipdb.com/api/v2/check?ipAddress=${encodeURIComponent(ip)}&maxAgeInDays=${this._maxAge}`,
        { method: 'GET', headers: { Key: this._key, Accept: 'application/json' } },
      );
      const d = (res.data && res.data.data) || {};
      const score = Number(d.abuseConfidenceScore || 0);
      const verdict = d.isWhitelisted ? 'clean' : score >= 75 ? 'malicious' : score >= 25 ? 'suspicious' : 'clean';
      return {
        ...base, status: 'ok', verdict, score, confidence: score,
        rawSummary: `AbuseIPDB: ${score}% Confidence, ${d.totalReports || 0} Reports${d.countryCode ? `, ${d.countryCode}` : ''}.`,
        details: {
          tags: [d.usageType, d.countryCode].filter(Boolean),
          totalReports: d.totalReports || 0, country: d.countryCode, isp: d.isp, usageType: d.usageType, domain: d.domain,
        },
      };
    } catch (err) {
      const status = err.status === 429 ? 'rate_limited' : 'error';
      return { ...base, status, verdict: 'unknown', score: 0, confidence: 0, rawSummary: err.status === 429 ? 'AbuseIPDB Rate-Limit erreicht.' : `AbuseIPDB Fehler: ${err.message}` };
    }
  }
}

module.exports = { AbuseIpDbProvider };
