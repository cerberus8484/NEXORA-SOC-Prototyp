'use strict';

// Evidence Collector (P16) — sammelt Endpoint-Artefakte (Prozesse, lauschende
// Ports, Netzwerk-Interfaces) vom Wazuh-Syscollector und hängt sie als
// Evidence-Einträge an ein Ticket. Fail-safe: ein fehlgeschlagener
// Syscollector-Call stoppt nicht den gesamten Collector.

const logger = require('../../../logger');
const { wazuhApiClient } = require('./wazuhApiInstance');

const COLLECTED_BY = 'system:evidence-collector';
const EVIDENCE_SOURCE = 'evidenceCollector';

// Formatiert eine Prozess-Liste als lesbaren Evidence-Text.
function formatProcesses(items) {
  return items
    .map((p) => `PID ${p.pid ?? '?'}  ${p.name ?? '?'}  state=${p.state ?? '?'}  resident=${p.resident ?? '?'}`)
    .join('\n');
}

// Formatiert lauschende Ports als lesbaren Evidence-Text.
function formatPorts(items) {
  return items
    .map((p) => {
      const proc = p.process ? `  proc=${p.process}` : '';
      return `${(p.protocol ?? '?').toUpperCase()}/${p.local_port ?? '?'}${proc}`;
    })
    .join('\n');
}

// Formatiert Netzwerk-Interfaces als lesbaren Evidence-Text.
function formatInterfaces(items) {
  return items
    .map((i) => {
      const ips = Array.isArray(i.ipv4) ? i.ipv4.map((a) => a.address || a).join(', ') : (i.ipv4 || '');
      return `${i.name ?? '?'}  mac=${i.mac ?? '?'}  ipv4=${ips}`;
    })
    .join('\n');
}

// Ein einzelner Sammelschritt: holt Daten, erzeugt (bei Treffer) einen
// Evidence-Eintrag. Wirft NICHT — Fehler werden geloggt und übersprungen,
// damit ein einzelner Ausfall den restlichen Collector nicht abbricht.
async function collectStep({ label, type, title, fetchFn, formatFn, ticketId, evidenceService }) {
  try {
    const items = await fetchFn();
    if (!Array.isArray(items) || items.length === 0) return 0;
    const result = await evidenceService.add({
      ticketId,
      type,
      source: EVIDENCE_SOURCE,
      title,
      rawText: formatFn(items),
      collectedBy: COLLECTED_BY,
    });
    if (!result.ok) {
      logger.warn('evidence-collector: Evidence nicht gespeichert', { label, ticketId, error: result.error });
      return 0;
    }
    return 1;
  } catch (err) {
    logger.error('evidence-collector: Syscollector-Schritt fehlgeschlagen', {
      label, ticketId, error: err.message,
    });
    return 0;
  }
}

/**
 * Sammelt Endpoint-Artefakte eines Wazuh-Agents und legt sie als Evidence ab.
 * @param {string} agentId
 * @param {string} ticketId
 * @param {{ add: Function }} evidenceService
 * @param {{ wazuh?: object }} [deps] — optionaler Wazuh-Client (Tests)
 * @returns {Promise<number>} Anzahl erzeugter Evidence-Einträge
 */
async function collectEndpointEvidence(agentId, ticketId, evidenceService, deps = {}) {
  const wazuh = deps.wazuh || wazuhApiClient;
  if (!agentId || !ticketId || !evidenceService) {
    logger.warn('evidence-collector: agentId/ticketId/evidenceService fehlt', { agentId, ticketId });
    return 0;
  }
  if (typeof wazuh.isEnabled === 'function' && !wazuh.isEnabled()) {
    logger.info('evidence-collector: Wazuh-API nicht konfiguriert — übersprungen', { agentId, ticketId });
    return 0;
  }

  const steps = [
    {
      label: 'processes', type: 'process', title: `Top-Prozesse (Agent ${agentId})`,
      fetchFn: () => wazuh.getProcesses(agentId), formatFn: formatProcesses,
    },
    {
      label: 'ports', type: 'network', title: `Lauschende Ports (Agent ${agentId})`,
      fetchFn: () => wazuh.getListeningPorts(agentId), formatFn: formatPorts,
    },
    {
      label: 'netiface', type: 'network', title: `Netzwerk-Interfaces (Agent ${agentId})`,
      fetchFn: () => wazuh.getNetInterfaces(agentId), formatFn: formatInterfaces,
    },
  ];

  let count = 0;
  for (const step of steps) {
    count += await collectStep({ ...step, ticketId, evidenceService });
  }
  logger.info('evidence-collector: abgeschlossen', { agentId, ticketId, count });
  return count;
}

module.exports = { collectEndpointEvidence };
