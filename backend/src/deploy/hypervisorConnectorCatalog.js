'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Deployment Center — Hypervisor-Connector-Typ-Katalog (Code-Allowlist).
//
// Nur bekannte Connector-Typen (WOHIN deployt wird) sind zulässig. Der Katalog
// beschreibt den einheitlichen Connector-Vertrag (§2.2 der Architektur) als
// Stammdaten. Die echte REST-Implementierung folgt in Phase 3.
//
// Schnitt #1 kennt genau einen Typ: proxmox.
// ─────────────────────────────────────────────────────────────────────────

const { AppError } = require('../errors/AppError');

const CODE_BY_STATUS = { 400: 'BAD_REQUEST', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT' };
function err(message, status = 400) {
  const e = new AppError(message, status, CODE_BY_STATUS[status] || 'DEPLOY_CONNECTOR_ERROR');
  e.status = status;
  return e;
}

// Der einheitliche Connector-Vertrag — jede Implementierung MUSS diese Operationen erfüllen.
// attachConfigMedia hängt das gerenderte config.xml-Artefakt (First-Boot-Drive) an die VM.
const CONNECTOR_OPERATIONS = [
  'cloneFromTemplate', 'setResources', 'attachNetwork', 'start', 'status', 'destroy', 'snapshot',
  'checkPreconditions', 'attachConfigMedia',
];

const CATALOG = [
  {
    id: 'proxmox',
    name: 'Proxmox VE',
    description:
      'Klont ein Golden-Template über die Proxmox-REST-API, setzt Ressourcen + Netz/VLAN, '
      + 'startet/stoppt/zerstört die VM. Kein Shell/SSH — nur die REST-API.',
    operations: [...CONNECTOR_OPERATIONS],
  },
];

class ConnectorTypeDefinition {
  constructor(def) { this._def = def; }
  get id() { return this._def.id; }
  get name() { return this._def.name; }
  get description() { return this._def.description; }
  get operations() { return [...this._def.operations]; }

  toJSON() {
    return { id: this.id, name: this.name, description: this.description, operations: this.operations };
  }
}

const CATALOG_BY_ID = new Map(CATALOG.map((d) => [d.id, d]));

function listConnectorTypes() { return CATALOG.map((def) => new ConnectorTypeDefinition(def)); }

function getConnectorType(id) {
  const def = CATALOG_BY_ID.get(id);
  if (!def) throw err(`unbekannter Hypervisor-Connector-Typ: '${id}' — nicht in der Allowlist`, 404);
  return new ConnectorTypeDefinition(def);
}

/** Reiner Allowlist-Check ohne Werfen (für Domain-Validierung). */
function isKnownConnectorType(id) { return CATALOG_BY_ID.has(id); }

module.exports = {
  ConnectorTypeDefinition, CONNECTOR_OPERATIONS,
  listConnectorTypes, getConnectorType, isKnownConnectorType, err,
};
