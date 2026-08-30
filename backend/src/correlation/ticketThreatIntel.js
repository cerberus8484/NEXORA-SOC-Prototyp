'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Auto-Threat-Intel für den Deck-Load.
//
// Reichert die ÖFFENTLICHEN IP-Indikatoren eines Tickets automatisch an, ohne
// dass ein Analyst den „Enrich"-Button klicken muss. Bei Honeypot-Tickets ist
// die Angreifer-Source-IP der primäre Indikator → Land/ASN/Reputation/Verdict
// füllen sich von selbst (Cache im Service macht wiederholte Loads billig).
//
// Reines Orchestrierungs-Modul: `enrich` und `isPublic` werden injiziert
// (testbar, keine Fetches/DB hier). Disziplin:
//  - Private/Reserved IPs werden NIE extern angefragt (Quota + Sinn).
//  - dedupliziert, hart auf `max` begrenzt.
//  - Soft-fail: ein Lookup-Fehler bricht den Deck-Load NIE.
// ─────────────────────────────────────────────────────────────────────────

const DEFAULT_MAX = 10;

// Land/ASN/usageType/Reports aus den Provider-Details extrahieren (erstes Vorhandene).
function pickGeo(providers = []) {
  const g = { country: null, asnOwner: null, usageType: null, totalReports: null };
  for (const p of providers) {
    const d = (p && p.details) || {};
    if (!g.country && d.country) g.country = d.country;
    if (!g.asnOwner && d.asOwner) g.asnOwner = d.asOwner;
    if (!g.usageType && d.usageType) g.usageType = d.usageType;
    if (g.totalReports == null && typeof d.totalReports === 'number') g.totalReports = d.totalReports;
  }
  return g;
}

/**
 * @param {object} args
 * @param {string[]} args.ips      Ticket-IP-Indikatoren (Source zuerst → Honeypot-Angreifer).
 * @param {(q:{indicatorType:string,indicatorValue:string})=>Promise<{ok:boolean,result?:object}>} args.enrich
 * @param {(ip:string)=>boolean} [args.isPublic]  nur true-IPs werden extern abgefragt.
 * @param {number} [args.max]
 * @returns {Promise<object[]>}  kompakte, UI-fertige Enrichment-Einträge je IP.
 */
async function buildTicketThreatIntel({ ips = [], enrich, isPublic, max = DEFAULT_MAX } = {}) {
  if (typeof enrich !== 'function') return [];

  const seen = new Set();
  const targets = [];
  for (const raw of Array.isArray(ips) ? ips : []) {
    const ip = String(raw || '').trim();
    if (!ip || seen.has(ip)) continue;
    seen.add(ip);
    if (typeof isPublic === 'function' && !isPublic(ip)) continue; // private/reserved nie extern
    targets.push(ip);
    if (targets.length >= max) break;
  }

  const out = [];
  for (const ip of targets) {
    try {
      const r = await enrich({ indicatorType: 'ip', indicatorValue: ip });
      if (!r || !r.ok || !r.result) continue;
      const res = r.result;
      const geo = pickGeo(res.providers || []);
      out.push({
        indicatorValue: ip,
        verdict: res.verdict ?? 'unknown',
        score: res.score ?? 0,
        confidence: res.confidence ?? 0,
        source: res.source || 'mock',
        summary: res.summary || null,
        country: geo.country,
        asnOwner: geo.asnOwner,
        usageType: geo.usageType,
        totalReports: geo.totalReports,
        tags: Array.isArray(res.tags) ? res.tags : [],
      });
    } catch {
      // soft-fail pro IP — der Deck-Load darf NIE brechen
    }
  }
  return out;
}

module.exports = { buildTicketThreatIntel, pickGeo, DEFAULT_MAX };
