'use strict';

// ─────────────────────────────────────────────────────────────────────────
// ManualHostService — Geschäftslogik für die Manual-Host-Quelle.
//
// Hängt am Repo-Interface (InMemory/Postgres via Factory), nie am Storage.
// Jede state-changing Aktion (add/remove) wird auditiert (wie Host-Enrollment).
// ─────────────────────────────────────────────────────────────────────────

const { ManualHost } = require('../domain/ManualHost');
const { createManualHostRepository } = require('../repositories/manualHostRepositoryFactory');
const { auditService, AUDIT_ACTIONS } = require('./AuditService');

class ManualHostService {
  constructor({ repo, auditService: audit } = {}) {
    if (!repo) throw new Error('ManualHostService: repo erforderlich');
    this._repo = repo;
    this._audit = audit;
  }

  async list() {
    return this._repo.findAll();
  }

  /**
   * @param {object} input   validierte Manual-Host-Felder (hostname, ipAddresses, os, customer, notes)
   * @param {object} actor   { userId, label, ip }
   */
  async add(input = {}, actor = {}) {
    const host = ManualHost.create({
      hostname:    input.hostname,
      ipAddresses: input.ipAddresses || [],
      os:          input.os || '',
      customer:    input.customer || '',
      notes:       input.notes || '',
      createdBy:   actor.label || null,
    });
    const saved = await this._repo.save(host);
    await this._writeAudit(AUDIT_ACTIONS.MANUAL_HOST_ADDED, saved, actor);
    return saved;
  }

  /** @returns {Promise<boolean>} true, wenn tatsächlich gelöscht wurde. */
  async remove(id, actor = {}) {
    const existing = await this._repo.findById(id);
    if (!existing) return false;
    const ok = await this._repo.delete(id);
    if (ok) await this._writeAudit(AUDIT_ACTIONS.MANUAL_HOST_REMOVED, existing, actor);
    return ok;
  }

  async _writeAudit(action, host, actor) {
    if (!this._audit || typeof this._audit.write !== 'function') return;
    await this._audit.write({
      actorUserId: actor.userId || null,
      actorLabel:  actor.label || null,
      action,
      targetType:  'manual_host',
      targetId:    host.id,
      metadata:    { hostname: host.hostname },
      ip:          actor.ip || null,
    });
  }
}

// Singleton fürs Routing (Repo via Factory, echter AuditService).
const manualHostService = new ManualHostService({ repo: createManualHostRepository(), auditService });

module.exports = { ManualHostService, manualHostService };
