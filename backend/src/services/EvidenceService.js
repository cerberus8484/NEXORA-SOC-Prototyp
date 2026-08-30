'use strict';

const { createEvidenceRepository } = require('../repositories/evidenceRepositoryFactory');
const { createCustodyRepository } = require('../repositories/custodyRepositoryFactory');
const { Evidence, validateFileUpload } = require('../domain/Evidence');
const { deriveReviewStatus } = require('../domain/CustodyEvent');

// Orchestriert den Evidence-Store. Append-only (kein update/delete) → Chain of Custody.
class EvidenceService {
  constructor({ repo, custodyRepo } = {}) {
    this._repo    = repo || createEvidenceRepository();
    this._custody = custodyRepo || createCustodyRepository();
  }

  async add(data = {}) {
    if (!data.ticketId) return { ok: false, error: 'ticketId fehlt' };
    if (!data.title)    return { ok: false, error: 'title fehlt' };
    // Datei-Import: `content` ist der Datei-Text → in rawText ablegen, Größe/Typ prüfen.
    let toStore = data;
    if (data.type === 'file_upload') {
      const content = data.content != null ? String(data.content) : String(data.rawText || '');
      const check = validateFileUpload({ filename: data.filename, content });
      if (!check.ok) return { ok: false, error: check.error };
      toStore = { ...data, rawText: content };
      delete toStore.content;
    }
    const evidence = await this._repo.create(toStore);
    return { ok: true, evidence };
  }

  // Hängt den abgeleiteten Review-Status an jedes Item (für Listen-Ansichten).
  // Batch: ein Custody-Aufruf für alle Items statt N einzelne → kein N+1.
  async _withStatus(items) {
    if (items.length === 0) return [];
    const custodyMap = await this._custody.findByEvidenceIds(items.map((it) => it.id));
    return items.map((it) => ({ ...it, reviewStatus: deriveReviewStatus(custodyMap[it.id] ?? []) }));
  }

  async findByTicket(ticketId) { return this._withStatus(await this._repo.findByTicket(ticketId)); }
  async findAll(opts)          { return this._withStatus(await this._repo.findAll(opts)); }
  findById(id)                 { return this._repo.findById(id); }

  // Evidence-Item mit Chain-of-Custody-Log + abgeleitetem Review-Status.
  async detail(id) {
    const item = await this._repo.findById(id);
    if (!item) return null;
    const custody = await this._custody.findByEvidence(id);
    return { ...item, custody, reviewStatus: deriveReviewStatus(custody) };
  }

  // Custody-Event protokollieren (viewed/reviewed/verified/flagged/note).
  async addCustody({ evidenceId, action, actor, note }) {
    const item = await this._repo.findById(evidenceId);
    if (!item) return { ok: false, error: 'Evidence nicht gefunden' };
    const event = await this._custody.create({ evidenceId, action, actor, note });
    return { ok: true, event };
  }

  // Evidence-Paket eines Tickets — inkl. Integritätsprüfung pro Item (Handover/Eskalation).
  // P_TRUST_1 · A4: Jeder Export ist ein Custody-Event PRO Item (echter Zeitpunkt + Actor)
  // → die Chain of Custody belegt, wer wann exportiert hat (kein hartkodiertes "Exported").
  async exportForTicket(ticketId, { actor = '' } = {}) {
    const items = await this._repo.findByTicket(ticketId);
    for (const it of items) {
      await this._custody.create({ evidenceId: it.id, action: 'exported', actor, note: '' });
    }
    const enriched = items.map((it) => ({ ...it, integrityValid: new Evidence(it).verifyIntegrity() }));
    return {
      ticketId,
      exportedAt: new Date().toISOString(),
      exportedBy: actor,
      count: enriched.length,
      integrityOk: enriched.every((i) => i.integrityValid),
      items: enriched,
    };
  }
}

const evidenceService = new EvidenceService();

module.exports = { EvidenceService, evidenceService };
