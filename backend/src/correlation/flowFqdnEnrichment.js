'use strict';

// ─────────────────────────────────────────────────────────────────────────
// CE-5.3 — DNS-FQDN-Anreicherung (forward-confirm)
//
// Läuft NACH der Inventory-Anreicherung (CE-4). Füllt ausschließlich LEERE
// FQDN-Felder: ein bereits gesetzter FQDN (Event-Computer/Inventory) gewinnt und
// wird nie überschrieben. Aus Host-Kurzname + Domain wird ein Kandidatenname
// gebaut und vom injizierten `resolveFqdn` gegen die Flow-IP bestätigt
// (Name → A-Record == IP?). Kein Fake: nicht bestätigt → `null` + ehrlicher
// missingReason (dns_no_record/dns_unconfirmed/dns_error). Immutabel (neue Flows).
//
// Reine Schicht (kein eigener DNS-Call) — der Resolver wird hineingereicht
// (CE-5.2 `resolveFqdn`, in der Route via `fqdnResolverInstance` ENV-gebunden).
// ─────────────────────────────────────────────────────────────────────────

const SOURCE = 'dns_forward_confirm';

function isEmpty(v) { return v === undefined || v === null || v === ''; }

// Kandidatenname: Host hat schon einen Punkt → direkt nutzen; sonst Domain
// anhängen; ohne Domain kein Kandidat (wir raten nichts). Defense-in-depth:
// nur valide Hostnamen werden abgefragt (kein Null-Byte/Injection in den Lookup).
function candidateNameFor(host, domain) {
  if (isEmpty(host)) return null;
  const h = String(host);
  const name = h.includes('.') ? h : (isEmpty(domain) ? null : `${h}.${domain}`);
  if (!name) return null;
  if (name.length > 253 || !/^[A-Za-z0-9._-]+$/.test(name)) return null;
  return name;
}

function provFound(r, now) {
  const p = (r && r.provenance) || {};
  return {
    source: SOURCE,
    fieldPath: 'dns.A',
    confidence: 'high',
    collectedAt: now,
    query: p.query ?? null,
    resolvedIps: p.resolvedIps ?? [],
    dnsServer: p.dnsServer ?? null,
  };
}

// Miss-Provenance — gleiche Form wie die Inventory-Anreicherung, damit
// collectGaps() den dns_*-Grund sieht (liest provenance[field].missingReason).
function provMiss(r, now, missingReason) {
  const p = (r && r.provenance) || {};
  return {
    source: SOURCE,
    fieldPath: null,
    confidence: null,
    collectedAt: now,
    missingReason,
    query: p.query ?? null,
    resolvedIps: p.resolvedIps ?? [],
    dnsServer: p.dnsServer ?? null,
  };
}

// Eine Seite (source|destination) der frischen Flow-Kopie anreichern.
async function enrichSide(out, keys, deps) {
  const { ipKey, hostKey, fqdnKey } = keys;
  const { resolveFqdn, domain, now } = deps;
  if (!isEmpty(out[fqdnKey])) return;                       // bereits gesetzt → gewinnt
  if (isEmpty(out[ipKey]) || isEmpty(out[hostKey])) return; // kein Abgleichspartner
  const candidateName = candidateNameFor(out[hostKey], domain);
  if (!candidateName) return;                               // ohne Domain kein Kandidat
  const r = await resolveFqdn({ ip: out[ipKey], candidateName });
  if (r && r.fqdn) {
    out[fqdnKey] = String(r.fqdn);
    out.provenance[fqdnKey] = provFound(r, now);
    delete out.missingReason[fqdnKey];
  } else {
    const reason = (r && r.missingReason) || 'dns_error';
    out.missingReason[fqdnKey] = reason;
    // Auch in die Provenance, damit collectGaps() den Grund surfacet (Review-Fix).
    out.provenance[fqdnKey] = provMiss(r, now, reason);
  }
}

async function enrichFlowWithDnsFqdn(flow, deps) {
  const out = { ...flow, provenance: { ...(flow.provenance || {}) }, missingReason: { ...(flow.missingReason || {}) } };
  await enrichSide(out, { ipKey: 'sourceIp', hostKey: 'sourceHost', fqdnKey: 'sourceFqdn' }, deps);
  await enrichSide(out, { ipKey: 'destinationIp', hostKey: 'destinationHost', fqdnKey: 'destinationFqdn' }, deps);
  return out;
}

/**
 * Flows mit DNS-forward-confirm-FQDN anreichern (immutabel).
 * @param {object[]} flows
 * @param {{ resolveFqdn: Function, domain: ?string, enabled: boolean, now?: string }} deps
 * @returns {Promise<object[]>}  Neues Array; bei disabled/kein Resolver unverändert.
 */
async function enrichFlowsWithDnsFqdn(flows, deps = {}) {
  const list = Array.isArray(flows) ? flows : [];
  if (!deps.enabled || typeof deps.resolveFqdn !== 'function') return list.map((f) => f);
  const now = deps.now || new Date().toISOString();
  const out = [];
  for (const f of list) out.push(await enrichFlowWithDnsFqdn(f, { ...deps, now }));
  return out;
}

module.exports = { enrichFlowsWithDnsFqdn, candidateNameFor };
