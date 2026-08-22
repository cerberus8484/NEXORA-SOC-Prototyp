'use strict';

const { randomUUID } = require('crypto');

// Lifecycle einer Wazuh-False-Positive-Ausnahme.
//   draft            – nur Vorschau/Entwurf, nichts geschrieben
//   submitted        – vom Analyst erstellt + weitergeleitet, wartet auf Engineer/Admin-Apply
//   applied          – Datei geschrieben + validiert (Übergang)
//   restart_required – geschrieben + validiert, wartet auf bewussten Manager-Restart
//   active           – nach Restart wirksam
//   reverted         – Regel entfernt (wartet ggf. auf Restart)
//   failed           – Schreiben/Validierung fehlgeschlagen (Rollback erfolgt)
const FP_STATUSES = ['draft', 'submitted', 'applied', 'restart_required', 'active', 'reverted', 'failed'];

class WazuhFpException {
  constructor({
    id = randomUUID(),
    ticketId = '',
    parentRuleId = '',
    generatedRuleId = null,
    srcips = [],
    dstips = [],
    dstports = [],
    protocol = '',
    agentId = '',
    reason = '',
    scopeHash = '',
    xml = '',
    file = 'soc_fp_exceptions.xml',
    status = 'draft',
    createdBy = '',
    approvedBy = '',
    beforeHash = '',
    afterHash = '',
    lastError = '',
    createdAt = new Date().toISOString(),
    updatedAt = new Date().toISOString(),
    appliedAt = null,
    revertedAt = null,
  } = {}) {
    this.id = id;
    this.ticketId = ticketId;
    this.parentRuleId = parentRuleId;
    this.generatedRuleId = generatedRuleId;
    this.srcips = srcips;
    this.dstips = dstips;
    this.dstports = dstports;
    this.protocol = protocol;
    this.agentId = agentId;
    this.reason = reason;
    this.scopeHash = scopeHash;
    this.xml = xml;
    this.file = file;
    this.status = status;
    this.createdBy = createdBy;
    this.approvedBy = approvedBy;
    this.beforeHash = beforeHash;
    this.afterHash = afterHash;
    this.lastError = lastError;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
    this.appliedAt = appliedAt;
    this.revertedAt = revertedAt;
  }

  static create(data) {
    const now = new Date().toISOString();
    return new WazuhFpException({ ...data, id: randomUUID(), createdAt: now, updatedAt: now });
  }

  update(patch = {}) {
    const allowed = [
      'generatedRuleId', 'xml', 'status', 'approvedBy', 'beforeHash', 'afterHash',
      'lastError', 'appliedAt', 'revertedAt',
    ];
    allowed.forEach((k) => { if (patch[k] !== undefined) this[k] = patch[k]; });
    this.updatedAt = new Date().toISOString();
    return this;
  }

  toJSON() { return { ...this }; }
}

module.exports = { WazuhFpException, FP_STATUSES };
