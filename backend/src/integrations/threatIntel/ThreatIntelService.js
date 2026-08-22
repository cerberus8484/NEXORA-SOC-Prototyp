'use strict';

const { randomUUID } = require('crypto');

const TYPES = ['ip', 'domain', 'url', 'hash'];
const VERDICT_RANK = { unknown: 0, clean: 1, suspicious: 2, malicious: 3 };
const IPV4 = /^(\d{1,3})(\.\d{1,3}){3}$/;
const DOMAIN_RE = /^(?=.{1,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const MAX_INDICATOR_LENGTH = 2048;

function validIp(v) {
  if (/:/.test(v)) return true; // grobe IPv6-Akzeptanz
  if (!IPV4.test(v)) return false;
  return v.split('.').every((o) => Number(o) >= 0 && Number(o) <= 255);
}

// Liefert eine Fehlermeldung (string) oder null.
function validateIndicator(type, value) {
  if (!TYPES.includes(type)) return `indicatorType muss eines von ${TYPES.join(', ')} sein`;
  if (!value || !String(value).trim()) return 'indicatorValue fehlt';
  const v = String(value).trim();
  if (v.length > MAX_INDICATOR_LENGTH) return `indicatorValue darf maximal ${MAX_INDICATOR_LENGTH} Zeichen lang sein`;
  if (type === 'ip' && !validIp(v)) return 'ungültige IP-Adresse';
  if (type === 'hash' && !/^[a-f0-9]{32,64}$/i.test(v)) return 'ungültiger Hash (MD5/SHA1/SHA256)';
  if (type === 'domain' && !DOMAIN_RE.test(v)) return 'ungueltige Domain';
  if (type === 'url' && !validUrl(v)) return 'ungueltige URL';
  return null;
}

function validUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/**
 * ThreatIntelService — validiert einen Indikator, ruft die konfigurierten Provider
 * (best-effort) und aggregiert sie zu einem normalisierten ThreatIntelResult.
 * Provider-Fehler brechen den Service NIE; Verdict = „schlechtester" über alle ok-Provider.
 */
class ThreatIntelService {
  constructor({ providers = [], cache = null, ttlMs = 24 * 3600 * 1000 } = {}) {
    this._providers = providers;
    this._cache = cache;
    this._ttl = ttlMs;
  }

  async enrich({ indicatorType, indicatorValue } = {}) {
    const type = String(indicatorType || '').toLowerCase();
    const value = String(indicatorValue || '').trim();
    const err = validateIndicator(type, value);
    if (err) return { ok: false, error: err };

    const key = `${type}:${value.toLowerCase()}`;
    if (this._cache) {
      const hit = await this._cache.get(key);
      if (hit) return { ok: true, result: { ...hit, source: 'cache' } };
    }

    const providerResults = [];
    for (const p of this._providers) {
      const checkedAt = new Date().toISOString();
      if (!p.isConfigured?.()) {
        providerResults.push({ provider: p.name, status: 'not_configured', verdict: 'unknown', score: 0, confidence: 0, rawSummary: 'Provider nicht konfiguriert', details: {}, checkedAt });
        continue;
      }
      try {
        const r = await p.enrich(type, value);
        providerResults.push({ verdict: 'unknown', score: 0, confidence: 0, details: {}, checkedAt, ...r, provider: p.name, status: r.status || 'ok' });
      } catch (e) {
        providerResults.push({ provider: p.name, status: 'error', verdict: 'unknown', score: 0, confidence: 0, rawSummary: e.message, details: {}, checkedAt });
      }
    }

    const ok = providerResults.filter((r) => r.status === 'ok');
    const verdict = ok.reduce((acc, r) => (VERDICT_RANK[r.verdict] > VERDICT_RANK[acc] ? r.verdict : acc), 'unknown');
    const score = ok.reduce((m, r) => Math.max(m, r.score || 0), 0);
    const confidence = ok.length ? Math.round(ok.reduce((s, r) => s + (r.confidence || 0), 0) / ok.length) : 0;
    const tags = [...new Set(ok.flatMap((r) => (r.details && r.details.tags) || []))];
    const summary = (ok.find((r) => r.verdict === verdict) || ok[0] || {}).rawSummary || 'Keine Threat-Intel-Daten.';
    const realProvider = ok.some((r) => r.provider !== 'mock');

    const result = {
      id: randomUUID(),
      indicatorType: type,
      indicatorValue: value,
      verdict, confidence, score,
      providers: providerResults,
      summary, tags,
      createdAt: new Date().toISOString(),
      source: realProvider ? 'provider' : 'mock',
    };
    if (this._cache) {
      await this._cache.set(key, result, this._ttl);
      result.cachedUntil = new Date(Date.now() + this._ttl).toISOString();
    }
    return { ok: true, result };
  }
}

module.exports = { ThreatIntelService, validateIndicator, TYPES, VERDICT_RANK };
