'use strict';

// ─────────────────────────────────────────────────────────────────────────
// CE-5.2 — FqdnResolver (DNS forward-confirm)
//
// Reine Resolver-Schicht. Bestätigt einen KANDIDATENNAMEN gegen die Flow-IP:
//   Name → A-Record(s) → enthält die erwartete IP?  Nur dann gilt der FQDN als
//   belegt (confidence high). Erfindet NIE einen Namen aus einer nackten IP —
//   ohne Kandidatennamen wird nichts geraten (no_candidate).
//
// Der eigentliche DNS-Lookup (`resolve4`) wird injiziert → ohne echtes DNS
// testbar. Noch KEINE Live-Integration in ticketFlows/Correlation (das ist CE-5.3).
//
// missingReason (ehrlich, nie Fake):
//   disabled         Resolver aus / kein DNS-Lookup konfiguriert
//   no_ip            keine Flow-IP zum Abgleich
//   no_candidate     kein Kandidatenname (aus IP raten wir nicht)
//   dns_no_record    Name hat keinen A-Record
//   dns_unconfirmed  A-Record(s) vorhanden, aber keiner == Flow-IP
//   dns_error        DNS-Timeout/-Fehler (kein Crash)
// ─────────────────────────────────────────────────────────────────────────

const dns = require('dns');

const SOURCE = 'dns_forward_confirm';

function isEmpty(v) { return v === undefined || v === null || v === ''; }

function provenance(query, expectedIp, resolvedIps, dnsServer) {
  return {
    query: isEmpty(query) ? null : String(query),
    expectedIp: isEmpty(expectedIp) ? null : String(expectedIp),
    resolvedIps: Array.isArray(resolvedIps) ? resolvedIps.map(String) : [],
    dnsServer: isEmpty(dnsServer) ? null : String(dnsServer),
  };
}

function result(over) {
  return { fqdn: null, source: SOURCE, confidence: null, provenance: null, missingReason: null, ...over };
}

/**
 * Forward-confirm eines Kandidatennamens gegen die Flow-IP.
 * @param {{ ip?: string, candidateName?: string }} input
 * @param {{ resolve4?: (name:string)=>Promise<string[]>, dnsServer?: string, enabled?: boolean }} deps
 *        resolve4: injizierter A-Record-Lookup (in Tests gefälscht).
 * @returns {Promise<{ fqdn, source, confidence, provenance, missingReason }>}
 */
async function resolveFqdn({ ip, candidateName } = {}, { resolve4, dnsServer = null, enabled = true } = {}) {
  if (!enabled || typeof resolve4 !== 'function') return result({ missingReason: 'disabled' });
  if (isEmpty(ip))            return result({ missingReason: 'no_ip' });
  if (isEmpty(candidateName)) return result({ missingReason: 'no_candidate' });

  let resolvedIps;
  try {
    resolvedIps = await resolve4(candidateName);
  } catch (err) {
    const code = err && err.code;
    const reason = (code === 'ENOTFOUND' || code === 'ENODATA') ? 'dns_no_record' : 'dns_error';
    return result({ missingReason: reason, provenance: provenance(candidateName, ip, [], dnsServer) });
  }

  const ips = Array.isArray(resolvedIps) ? resolvedIps.map(String) : [];
  const prov = provenance(candidateName, ip, ips, dnsServer);
  if (ips.length === 0)          return result({ missingReason: 'dns_no_record', provenance: prov });
  if (ips.includes(String(ip)))  return result({ fqdn: String(candidateName), confidence: 'high', provenance: prov });
  return result({ missingReason: 'dns_unconfirmed', provenance: prov });
}

/**
 * Echter A-Record-Lookup gegen einen konfigurierbaren DNS-Server (read-only).
 * Wird in CE-5.3 als `resolve4` injiziert — hier nur bereitgestellt, NICHT verdrahtet.
 */
function createNodeResolve4({ dnsServer = null, timeoutMs = 2000 } = {}) {
  return async (name) => {
    const resolver = new dns.promises.Resolver({ timeout: timeoutMs, tries: 1 });
    if (dnsServer) resolver.setServers([String(dnsServer)]);
    return resolver.resolve4(String(name));
  };
}

module.exports = { resolveFqdn, createNodeResolve4, SOURCE };
