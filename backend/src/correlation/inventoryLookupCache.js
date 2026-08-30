'use strict';

// ─────────────────────────────────────────────────────────────────────────
// CE-4.3 — Inventory-Lookup-Cache
//
// Dünne Cache-Schicht über den WazuhApiClient: lädt die Agentenliste + pro Agent
// das Syscollector-Inventar (netiface/netaddr/os), baut daraus EINMAL den
// IP-basierten Lookup (buildInventoryLookup) und cacht ihn mit TTL. So macht die
// Timeline-Route nicht pro Request N API-Calls.
//
// Soft-Fail (ADR-009, „UI nicht kaputt machen"): jeder Fehler → Lookup = null.
// Der Aufrufer reicht null in buildNetworkCorrelation → Felder bleiben
// missingReason inventory_not_loaded statt Fake-Werte oder Exception.
// ─────────────────────────────────────────────────────────────────────────

const { buildInventoryLookup } = require('./flowInventoryEnrichment');
const { isRealFqdn } = require('./flowNormalizer');

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 Minuten

/**
 * Wazuh-Agent (listAgents) + dessen Inventar (getAgentInventory) in die
 * buildInventoryLookup-Eingabeform überführen.
 * Host: os.hostname bevorzugt (z. B. CERBERUS), Fallback Agent-Name.
 * FQDN: nur wenn os.hostname ein ECHTER FQDN ist (Punkt, kein Kurzname) — sonst
 * null (kein Fake). Wazuh liefert meist Kurznamen → i. d. R. null (CE-5/DNS füllt).
 */
function toLookupInput(agent = {}, inventory = null) {
  const os = (inventory && inventory.os) || null;
  const hostname = os && os.hostname;
  return {
    agentId: agent.id != null ? String(agent.id) : null,
    host: hostname || agent.name || null,
    fqdn: isRealFqdn(hostname) ? String(hostname).trim() : null,
    interfaces: ((inventory && inventory.interfaces) || []).map((i) => ({ name: i.name, mac: i.mac })),
    addresses: ((inventory && inventory.addresses) || []).map((a) => ({ iface: a.iface, address: a.address, proto: a.proto })),
  };
}

/**
 * Cache-Factory.
 * @param {{ client: object, ttlMs?: number, now?: () => number }} opts
 *        client: WazuhApiClient (isEnabled/listAgents/getAgentInventory)
 * @returns {{ getLookup: () => Promise<{byIp: object}|null>, invalidate: () => void }}
 */
function createInventoryLookupCache({ client, ttlMs = DEFAULT_TTL_MS, now = () => Date.now() } = {}) {
  let cache = null; // { lookup, expiresAt }

  async function build() {
    const agents = await client.listAgents();
    const inputs = await Promise.all(
      (Array.isArray(agents) ? agents : []).map(async (agent) => {
        // Pro Agent darf das Inventar fehlschlagen (Agent offline) → ohne Netz-Felder weiter.
        const inventory = await client.getAgentInventory(agent.id).catch(() => null);
        return toLookupInput(agent, inventory);
      }),
    );
    return buildInventoryLookup(inputs);
  }

  async function getLookup() {
    if (!client || typeof client.isEnabled !== 'function' || !client.isEnabled()) return null;
    const t = now();
    if (cache && t < cache.expiresAt) return cache.lookup;
    try {
      const lookup = await build();
      cache = { lookup, expiresAt: t + ttlMs };
      return lookup;
    } catch {
      // Soft-Fail: kein Stale-Serve, nächster Aufruf versucht erneut. UI bleibt heil.
      cache = null;
      return null;
    }
  }

  function invalidate() { cache = null; }

  return { getLookup, invalidate };
}

module.exports = { createInventoryLookupCache, toLookupInput, DEFAULT_TTL_MS };
