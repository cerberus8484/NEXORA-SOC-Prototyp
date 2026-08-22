'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Nis2ReadinessService (P_NIS2_1)
//
// Führt den statischen Control-Katalog mit den persistierten Assessments +
// Evidence-Links zusammen und berechnet ehrliche Signale (needsReview, overdue,
// missingEvidence). Schreibende Operationen erzeugen Audit-Events mit NUR sicheren
// Metadaten — niemals notes, Evidence-Inhalte oder URLs.
//
// Ehrlichkeit: `addressed` ohne Evidence wird NICHT als vollständiger Nachweis
// dargestellt — es erzeugt needsReview.
// ─────────────────────────────────────────────────────────────────────────

const { NIS2_CONTROLS, CATALOG_VERSION, isKnownControlKey } = require('./nis2ControlCatalog');
const { Nis2Assessment, ASSESSMENT_STATUS } = require('./Nis2Assessment');
const { Nis2EvidenceLink } = require('./Nis2EvidenceLink');
const { AUDIT_ACTIONS } = require('../../services/AuditService');
const { NotFoundError } = require('../../errors/AppError');

// Ehrliche Positionierung — überall dort ausgeben, wo ein Management-Bericht entsteht.
// KEIN „konform"/„compliant"/„zertifiziert".
const READINESS_DISCLAIMER =
  'Arbeits-/Nachweis-Unterstützung — kein Konformitätsnachweis, keine Zertifizierung, kein Rechtsgutachten.';

// Sichere, nicht-personenbezogene Felder eines Tickets für den Incident-Nachweis.
// NIEMALS PII (email/user/srcIp/…) übernehmen — nur ID/Nummer/Titel/Priorität/State.
function safeIncidentSnapshot(ticket) {
  const ref = String(ticket.ticketNr || ticket.id || '').trim();
  const rawTitle = String(ticket.title || '').replace(/[<>]/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  const title = (rawTitle || ref).slice(0, 200);
  const priority = String(ticket.priority || '').slice(0, 40);
  const state = String(ticket.state || '').slice(0, 40);
  return { ref, title, priority, state };
}

// Review-Kadenz (P_NIS2_3): ein Nachweis muss periodisch re-reviewed werden, sonst
// ist er auditrechtlich nicht mehr aktuell. NIS2/Managementaufsicht verlangt eine
// periodische Überprüfung der Maßnahmen — 365 Tage als sinnvoller Default.
const DAY_MS = 86_400_000;
const REVIEW_INTERVAL_DAYS_DEFAULT = 365;

function computeFlags(status, evidenceCount, dueDate, now, lastReviewedAt = null, reviewIntervalDays = REVIEW_INTERVAL_DAYS_DEFAULT) {
  const overdue = Boolean(dueDate) && new Date(dueDate).getTime() < now
    && status !== 'addressed' && status !== 'not_applicable';
  const missingEvidence = status !== 'not_applicable' && evidenceCount === 0;
  const needsReview = status === 'needs_review' || (status === 'addressed' && evidenceCount === 0);
  // reviewDue (P_NIS2_3): ein „addressed"-Control MIT Evidence, dessen letzter Review
  // älter als die Kadenz ist → der Nachweis ist nicht mehr aktuell. Nur bei gesetztem
  // lastReviewedAt — „nie reviewed" erzeugt KEINEN Fehlalarm (das deckt needsReview ab).
  const reviewDue = status === 'addressed' && evidenceCount > 0
    && Boolean(lastReviewedAt)
    && (now - new Date(lastReviewedAt).getTime() > reviewIntervalDays * DAY_MS);
  return { overdue, missingEvidence, needsReview, reviewDue };
}

class Nis2ReadinessService {
  constructor({ repo, audit, ticketService, reviewIntervalDays } = {}) {
    this._repo = repo || null;
    this._audit = audit || null;
    this._ticketService = ticketService || null;
    this._reviewIntervalDays = reviewIntervalDays || REVIEW_INTERVAL_DAYS_DEFAULT;
  }

  _getRepo() {
    if (!this._repo) this._repo = require('../../repositories/nis2RepositoryFactory').createNis2Repository();
    return this._repo;
  }
  _getAudit() {
    if (!this._audit) this._audit = require('../../services/AuditService').auditService;
    return this._audit;
  }
  // Geteilter Ticket-Service-Singleton (gleiche Instanz wie die Tickets-Route) —
  // so sieht der Incident-Nachweis dieselben Tickets (InMemory) bzw. dieselbe DB.
  _getTicketService() {
    if (!this._ticketService) this._ticketService = require('../../services/TicketService').ticketService;
    return this._ticketService;
  }

  // Hilfsmittel: controlKey → evidenceCount (eine listAllEvidence-Abfrage, kein N+1).
  async _evidenceCountByControlKey() {
    const repo = this._getRepo();
    const [assessments, evidence] = await Promise.all([repo.listAssessments(), repo.listAllEvidence()]);
    const assessmentIdToKey = new Map(assessments.map((a) => [a.id, a.controlKey]));
    const counts = new Map();
    for (const e of evidence) {
      const key = assessmentIdToKey.get(e.assessmentId);
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    }
    return { assessments, counts };
  }

  // ─── Read: Readiness-Übersicht (Katalog ⨝ Assessments ⨝ EvidenceCount) ───
  async getReadiness() {
    const now = Date.now();
    const { assessments, counts } = await this._evidenceCountByControlKey();
    const byKey = new Map(assessments.map((a) => [a.controlKey, a]));

    const controls = NIS2_CONTROLS.map((c) => {
      const a = byKey.get(c.key) || null;
      const status = a ? a.status : 'not_started';
      const evidenceCount = counts.get(c.key) || 0;
      const flags = computeFlags(status, evidenceCount, a ? a.dueDate : null, now, a ? a.lastReviewedAt : null, this._reviewIntervalDays);
      return {
        key: c.key, title: c.title, shortDescription: c.shortDescription,
        defaultRiskArea: c.defaultRiskArea, sourceReference: c.sourceReference,
        status, owner: a ? a.owner : '', dueDate: a ? a.dueDate : null,
        lastReviewedAt: a ? a.lastReviewedAt : null, evidenceCount,
        hasAssessment: Boolean(a), ...flags,
      };
    });

    const total = controls.length;
    const withEvidenceOrNa = controls.filter((c) => c.evidenceCount > 0 || c.status === 'not_applicable').length;
    const summary = {
      catalogVersion: CATALOG_VERSION,
      controlsTotal: total,
      evidenceCoverage: withEvidenceOrNa,
      evidenceCoveragePct: total ? Math.round((withEvidenceOrNa / total) * 100) : 0,
      needsReview: controls.filter((c) => c.needsReview).length,
      overdue: controls.filter((c) => c.overdue).length,
      missingEvidence: controls.filter((c) => c.missingEvidence).length,
      reviewDue: controls.filter((c) => c.reviewDue).length,
    };
    return { summary, controls };
  }

  // ─── Read: Control-Detail (Katalog + Assessment + Evidence-Liste) ─────────
  async getControlDetail(controlKey) {
    if (!isKnownControlKey(controlKey)) throw new NotFoundError('NIS2-Control');
    const repo = this._getRepo();
    const control = NIS2_CONTROLS.find((c) => c.key === controlKey);
    const assessment = await repo.getAssessment(controlKey);
    const evidence = assessment ? await repo.listEvidence(assessment.id) : [];
    const status = assessment ? assessment.status : 'not_started';
    const flags = computeFlags(status, evidence.length, assessment ? assessment.dueDate : null, Date.now(), assessment ? assessment.lastReviewedAt : null, this._reviewIntervalDays);
    return { control, assessment, evidence, ...flags, evidenceCount: evidence.length };
  }

  // ─── Write (Admin): Assessment anlegen/aktualisieren ─────────────────────
  async upsertAssessment(controlKey, patch = {}, actor = {}) {
    if (!isKnownControlKey(controlKey)) throw new NotFoundError('NIS2-Control');
    const repo = this._getRepo();
    const existing = await repo.getAssessment(controlKey);

    const before = existing ? { status: existing.status, owner: existing.owner } : { status: null, owner: null };
    let domain;
    if (existing) {
      domain = new Nis2Assessment(existing).update(patch, actor.label || '');
    } else {
      domain = Nis2Assessment.create({ ...patch, controlKey }, actor.label || '');
    }
    const saved = await repo.saveAssessment(domain);

    await this._writeAudit(existing ? AUDIT_ACTIONS.NIS2_ASSESSMENT_UPDATED : AUDIT_ACTIONS.NIS2_ASSESSMENT_CREATED, actor, {
      controlKey, assessmentId: saved.id,
      statusBefore: before.status, statusAfter: saved.status,
      ownerBefore: before.owner, ownerAfter: saved.owner,
    });
    if (before.status !== saved.status) {
      await this._writeAudit(AUDIT_ACTIONS.NIS2_STATUS_CHANGED, actor, {
        controlKey, assessmentId: saved.id, statusBefore: before.status, statusAfter: saved.status,
      });
    }
    return saved;
  }

  // ─── Write (Admin): Evidence-Link hinzufügen ─────────────────────────────
  async addEvidence(controlKey, data = {}, actor = {}) {
    if (!isKnownControlKey(controlKey)) throw new NotFoundError('NIS2-Control');
    const repo = this._getRepo();
    // Evidence hängt immer an einem Assessment — falls keins existiert, ein
    // not_started anlegen (damit Owner/Status danach gepflegt werden können).
    let assessment = await repo.getAssessment(controlKey);
    if (!assessment) {
      assessment = await repo.saveAssessment(Nis2Assessment.create({ controlKey }, actor.label || ''));
    }
    const domain = Nis2EvidenceLink.create({ ...data, assessmentId: assessment.id }, actor.label || '');
    const saved = await repo.addEvidence(domain);
    await this._writeAudit(AUDIT_ACTIONS.NIS2_EVIDENCE_LINKED, actor, {
      controlKey, assessmentId: assessment.id, evidenceId: saved.id, evidenceType: saved.evidenceType,
    });
    return saved;
  }

  // ─── Write (Admin): Evidence-Link entfernen ──────────────────────────────
  async removeEvidence(evidenceId, actor = {}) {
    const repo = this._getRepo();
    const evidence = await repo.getEvidence(evidenceId);
    if (!evidence) throw new NotFoundError('Evidence-Link');
    await repo.deleteEvidence(evidenceId);
    await this._writeAudit(AUDIT_ACTIONS.NIS2_EVIDENCE_REMOVED, actor, {
      assessmentId: evidence.assessmentId, evidenceId, evidenceType: evidence.evidenceType,
    });
    return { id: evidenceId, removed: true };
  }

  // ─── Write (Admin): Incident-Ticket als Evidence verknüpfen ──────────────
  // Validiert, dass das Ticket existiert (sonst NotFound → 404), und legt einen
  // ticket-Evidence-Link mit NUR sicheren Snapshot-Feldern an (INC-Nummer, Titel,
  // Priorität, State) — NIE PII (email/user/srcIp/…). Audit trägt nur die INC-Nummer.
  async linkIncident(controlKey, { ticketId } = {}, actor = {}) {
    if (!isKnownControlKey(controlKey)) throw new NotFoundError('NIS2-Control');
    const ticket = await this._getTicketService().findById(ticketId); // wirft NotFoundError, wenn Ticket fehlt
    const snap = safeIncidentSnapshot(ticket);

    const repo = this._getRepo();
    let assessment = await repo.getAssessment(controlKey);
    if (!assessment) {
      assessment = await repo.saveAssessment(Nis2Assessment.create({ controlKey }, actor.label || ''));
    }
    const summary = [snap.priority, snap.state].filter(Boolean).join(' · ');
    const domain = Nis2EvidenceLink.create({
      assessmentId: assessment.id,
      evidenceType: 'ticket',
      evidenceRef: snap.ref,
      title: snap.title,
      description: summary ? `Incident ${snap.ref} · ${summary}` : `Incident ${snap.ref}`,
    }, actor.label || '');
    const saved = await repo.addEvidence(domain);
    await this._writeAudit(AUDIT_ACTIONS.NIS2_EVIDENCE_LINKED, actor, {
      controlKey, assessmentId: assessment.id, evidenceId: saved.id,
      evidenceType: 'ticket', ticketRef: snap.ref, // ticketRef = INC-Nummer (kein PII/Secret)
    });
    return saved;
  }

  // ─── Read: Management-Readiness-Report (Aggregat über alle Controls) ──────
  // Rein lesend, ehrlich (kein Konformitäts-Claim). Verbindet Controls, Assessment-
  // Status, Evidence-Abdeckung und Incident-Nachweise zu einer Management-Sicht.
  async getManagementReport() {
    const now = Date.now();
    const repo = this._getRepo();
    const [assessments, evidence] = await Promise.all([repo.listAssessments(), repo.listAllEvidence()]);
    const idToKey = new Map(assessments.map((a) => [a.id, a.controlKey]));
    const byKey = new Map(assessments.map((a) => [a.controlKey, a]));

    const evidenceCountByKey = new Map();
    const incidentCountByKey = new Map();
    for (const e of evidence) {
      const key = idToKey.get(e.assessmentId);
      if (!key) continue;
      evidenceCountByKey.set(key, (evidenceCountByKey.get(key) || 0) + 1);
      if (e.evidenceType === 'ticket') incidentCountByKey.set(key, (incidentCountByKey.get(key) || 0) + 1);
    }

    const byStatus = {};
    for (const s of ASSESSMENT_STATUS) byStatus[s] = 0;
    let incidentEvidenceTotal = 0;
    let addressedWithEvidence = 0;

    const controls = NIS2_CONTROLS.map((c) => {
      const a = byKey.get(c.key) || null;
      const status = a ? a.status : 'not_started';
      const evidenceCount = evidenceCountByKey.get(c.key) || 0;
      const incidentEvidenceCount = incidentCountByKey.get(c.key) || 0;
      incidentEvidenceTotal += incidentEvidenceCount;
      byStatus[status] = (byStatus[status] || 0) + 1;
      if (status === 'addressed' && evidenceCount > 0) addressedWithEvidence += 1;
      const flags = computeFlags(status, evidenceCount, a ? a.dueDate : null, now, a ? a.lastReviewedAt : null, this._reviewIntervalDays);
      return {
        key: c.key, title: c.title, status, owner: a ? a.owner : '', dueDate: a ? a.dueDate : null,
        evidenceCount, incidentEvidenceCount, ...flags,
      };
    });

    const total = controls.length;
    const withEvidenceOrNa = controls.filter((c) => c.evidenceCount > 0 || c.status === 'not_applicable').length;
    const summary = {
      controlsTotal: total,
      byStatus,
      evidenceCoverage: withEvidenceOrNa,
      evidenceCoveragePct: total ? Math.round((withEvidenceOrNa / total) * 100) : 0,
      incidentEvidenceTotal,
      addressedWithEvidence,
      needsReview: controls.filter((c) => c.needsReview).length,
      overdue: controls.filter((c) => c.overdue).length,
      missingEvidence: controls.filter((c) => c.missingEvidence).length,
      reviewDue: controls.filter((c) => c.reviewDue).length,
    };
    return {
      meta: { generatedAt: new Date(now).toISOString(), catalogVersion: CATALOG_VERSION, disclaimer: READINESS_DISCLAIMER },
      summary, controls,
    };
  }

  // Audit mit NUR sicheren Metadaten — nie notes/URL/Evidence-Inhalt.
  async _writeAudit(action, actor, metadata) {
    await this._getAudit().write({
      actorUserId: actor.userId || null,
      actorLabel: actor.label || '',
      action,
      targetType: 'nis2_assessment',
      targetId: metadata.controlKey || metadata.assessmentId || '',
      metadata,
      ip: actor.ip || '',
    });
  }
}

module.exports = { Nis2ReadinessService, computeFlags, READINESS_DISCLAIMER, safeIncidentSnapshot };
