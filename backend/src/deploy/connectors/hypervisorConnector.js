'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Deployment Center — Hypervisor-Connector-Vertrag (WOHIN deployt wird).
//
// Ein Connector kapselt EINEN Hypervisor hinter einem einheitlichen Interface.
// Der DeployOrchestrator (Phase 4) hängt NUR an diesem Vertrag — nie an einem
// konkreten Hypervisor. So ist der Fake (CI) gegen den echten REST-Connector
// (Prod) austauschbar, und ein 2. Hypervisor (ESXi) ist additiv.
//
// Vertrag (alle async, alle idempotenzbewusst):
//   checkPreconditions(spec)         → { ok, templateExists, bridgeExists, vmidFree, issues[] }
//   cloneFromTemplate(templateRef, s)→ { vmid }
//   setResources(vmid, {cpu,ramMB,diskGB})
//   attachNetwork(vmid, {bridge,vlanTag})
//   start(vmid)
//   status(vmid)                     → { running, agentReady }
//   destroy(vmid)                    (Rollback)
//   snapshot(vmid, name)
// ─────────────────────────────────────────────────────────────────────────

const { CONNECTOR_OPERATIONS } = require('../hypervisorConnectorCatalog');

/** Wirft, wenn `obj` den Connector-Vertrag nicht vollständig erfüllt. */
function assertConnectorShape(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('Connector muss ein Objekt sein');
  for (const op of CONNECTOR_OPERATIONS) {
    if (typeof obj[op] !== 'function') throw new Error(`Connector erfüllt den Vertrag nicht: Operation '${op}' fehlt`);
  }
  return obj;
}

module.exports = { assertConnectorShape, CONNECTOR_OPERATIONS };
