'use strict';

// ─────────────────────────────────────────────────────────────────────────
// CE-4.2 — Flow-Inventory-Anreicherung (Wazuh Syscollector)
//
// Reichert normalisierte Flows (CE-3) mit Host/MAC/Interface aus dem Wazuh-
// Agenten-Inventar an: Flow-IP → netaddr (Interface) → netiface (MAC) → os
// (Hostname). Rein (keine Fetches, keine Mutation): der Aufrufer baut den
// IP-Lookup aus den Agenten-Inventaren und reicht ihn hinein.
//
// ADR-009: nie Werte erfinden. Fehlt etwas, Wert=null + missingReason:
//   not_in_inventory     IP gehoert keinem Wazuh-Agent
//   inventory_not_loaded Lookup gar nicht vorhanden (CE-4 lief nicht)
//   field_missing        Agent/IP da, aber Feld (z. B. FQDN) nicht im Inventar
//   source_provides_none Quelle liefert das Feld grundsaetzlich nicht (zone)
//
// Bestehende, bereits gesetzte Flow-Werte werden NICHT ueberschrieben (z. B.
// sourceHost aus dem Sysmon-Event bleibt erhalten).
// ─────────────────────────────────────────────────────────────────────────

const { isRealFqdn } = require('./flowNormalizer');

const SOURCE = 'wazuh_api';
const NULL_MAC = '00:00:00:00:00:00';

function isRealMac(mac) {
  const v = typeof mac === 'string' ? mac.trim() : '';
  return /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i.test(v) && v.toLowerCase() !== NULL_MAC;
}
function isEmpty(v) { return v === undefined || v === null || v === ''; }

/**
 * IP-basierten Lookup aus Agenten-Inventaren bauen.
 * @param {Array<{agentId,host,fqdn?,interfaces:Array<{name,mac}>,addresses:Array<{iface,address,proto}>}>} agents
 * @returns {{ byIp: Object }}
 */
function buildInventoryLookup(agents = []) {
  const byIp = {};
  for (const a of (Array.isArray(agents) ? agents : [])) {
    const macByIface = {};
    for (const i of (a.interfaces || [])) {
      if (i && i.name) macByIface[i.name] = isRealMac(i.mac) ? i.mac : null;
    }
    for (const addr of (a.addresses || [])) {
      if (!addr || addr.proto !== 'ipv4') continue;
      const ip = String(addr.address || '').trim();
      if (!ip || ip === '127.0.0.1' || ip.startsWith('169.254.')) continue;
      if (byIp[ip]) continue; // erste (echte) Zuordnung gewinnt
      byIp[ip] = {
        agentId: a.agentId || null,
        host: a.host || null,
        fqdn: a.fqdn || null,
        interfaceName: addr.iface || null,
        mac: macByIface[addr.iface] ?? null,
        source: SOURCE,
      };
    }
  }
  return { byIp };
}

function provFound(fieldPath, collectedAt, confidence = 'high') {
  return { source: SOURCE, fieldPath, confidence, collectedAt };
}
function provMissing(collectedAt, missingReason) {
  return { source: SOURCE, fieldPath: null, confidence: null, collectedAt, missingReason };
}

// Ein Inventar-Feld setzen — nur wenn der Flow es noch nicht hat (kein Ueberschreiben).
function setIfEmpty(out, key, value, prov) {
  if (!isEmpty(out[key])) return; // bestehenden Wert + Provenance behalten
  out[key] = isEmpty(value) ? null : value;
  out.provenance[key] = prov;
  if (prov.missingReason) out.missingReason[key] = prov.missingReason;
  else delete out.missingReason[key];
}

// Eine Seite (source|destination) aus dem Lookup anreichern.
function enrichSide(out, ip, keys, loaded, lookup, collectedAt) {
  const { macKey, ifaceKey, hostKey, fqdnKey } = keys;
  // Lookup gar nicht da → inventory_not_loaded fuer alle vier.
  if (!loaded) {
    for (const k of [macKey, ifaceKey, hostKey, fqdnKey]) setIfEmpty(out, k, null, provMissing(collectedAt, 'inventory_not_loaded'));
    return;
  }
  const entry = !isEmpty(ip) ? lookup.byIp[ip] : undefined;
  if (!entry) {
    // IP gehoert keinem Agent (oder keine IP) → not_in_inventory.
    for (const k of [macKey, ifaceKey, hostKey, fqdnKey]) setIfEmpty(out, k, null, provMissing(collectedAt, 'not_in_inventory'));
    return;
  }
  setIfEmpty(out, macKey, entry.mac, entry.mac ? provFound('syscollector.netiface.mac', collectedAt) : provMissing(collectedAt, 'field_missing'));
  // Host-NIC-Name aus dem Inventar (netiface.name) — bewusst getrennt vom Firewall-Interface (CE-3).
  setIfEmpty(out, ifaceKey, entry.interfaceName, entry.interfaceName ? provFound('syscollector.netiface.name', collectedAt) : provMissing(collectedAt, 'field_missing'));
  setIfEmpty(out, hostKey, entry.host, entry.host ? provFound('syscollector.os.hostname', collectedAt) : provMissing(collectedAt, 'field_missing'));
  // FQDN: Inventar liefert i. d. R. nur Kurznamen -> nur setzen, wenn ECHTER FQDN
  // (Punkt, kein Kurzname/localhost/IP). Sonst null + field_missing (kein Fake).
  const fq = isRealFqdn(entry.fqdn) ? entry.fqdn : null;
  setIfEmpty(out, fqdnKey, fq, fq ? provFound('syscollector.os.hostname', collectedAt, 'medium') : provMissing(collectedAt, 'field_missing'));
}

/**
 * Einen Flow mit dem Inventory-Lookup anreichern (immutabel — neuer Flow).
 */
function enrichFlowWithInventory(flow, lookup, { now } = {}) {
  const collectedAt = now || new Date().toISOString();
  const out = { ...flow, provenance: { ...(flow.provenance || {}) }, missingReason: { ...(flow.missingReason || {}) } };
  const loaded = Boolean(lookup && lookup.byIp);

  enrichSide(out, out.sourceIp, { macKey: 'sourceMac', ifaceKey: 'sourceHostInterface', hostKey: 'sourceHost', fqdnKey: 'sourceFqdn' }, loaded, lookup, collectedAt);
  enrichSide(out, out.destinationIp, { macKey: 'destinationMac', ifaceKey: 'destinationHostInterface', hostKey: 'destinationHost', fqdnKey: 'destinationFqdn' }, loaded, lookup, collectedAt);

  // Zone hat KEINE Quelle (Wazuh kennt kein Zone-Konzept) -> endgueltig source_provides_none.
  setIfEmpty(out, 'sourceZone', null, provMissing(collectedAt, 'source_provides_none'));
  setIfEmpty(out, 'destinationZone', null, provMissing(collectedAt, 'source_provides_none'));

  return out;
}

function enrichFlowsWithInventory(flows, lookup, opts) {
  return (Array.isArray(flows) ? flows : []).map((f) => enrichFlowWithInventory(f, lookup, opts));
}

module.exports = { buildInventoryLookup, enrichFlowWithInventory, enrichFlowsWithInventory, isRealMac };
