'use strict';
// CE-5.3 — Prozess-Instanz des FQDN-Resolvers (ENV-konfiguriert, default AUS).
const { resolveFqdn, createNodeResolve4 } = require('./fqdnResolver');
const FQDN_ENABLED    = process.env.FQDN_RESOLVER_ENABLED === 'true';   // default false
const FQDN_DNS_SERVER = process.env.FQDN_DNS_SERVER || null;            // z. B. 10.99.99.10 (AD-DNS)
const FQDN_DOMAIN     = process.env.FQDN_DOMAIN || null;               // z. B. nexora.example
const _resolve4 = createNodeResolve4({ dnsServer: FQDN_DNS_SERVER });
// Gebundener Resolver: read-only A-Lookup gegen den konfigurierten DNS-Server.
async function fqdnResolver(args) {
  return resolveFqdn(args, { resolve4: _resolve4, dnsServer: FQDN_DNS_SERVER, enabled: FQDN_ENABLED });
}
module.exports = { fqdnResolver, FQDN_ENABLED, FQDN_DNS_SERVER, FQDN_DOMAIN };
