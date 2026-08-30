'use strict';

const { UseCaseDraft }       = require('../domain/UseCaseDraft');
const { PublishedDetection } = require('../domain/PublishedDetection');
const { NotFoundError, ConflictError } = require('../errors/AppError');

/** Fortlaufende Zähl-Nummer → menschenlesbare Katalog-Nummer UC-INC000001 (analog INC000001). */
function formatUcNumber(n) {
  return `UC-INC${String(n).padStart(6, '0')}`;
}

/**
 * UseCaseDeveloperService — orchestriert den KI Use-Case Developer.
 *
 * Fluss: Kontext laden (Ticket/Evidence/…) → Provider erzeugt Draft (Ollama/Stub)
 * → QualityValidator bewertet → Repo speichert (status='draft'). Status-Übergänge
 * (sendToReview/approve/reject/publish) laufen über die Domain (Validierung) und
 * werden per repo.setStatus persistiert.
 *
 * Human-in-the-loop: erzeugt NUR Entwürfe. Keine Wazuh-/SIEM-Regel-Aktivierung,
 * kein Auto-Restart, kein Auto-Publish — alles über explizite, RBAC-geschützte Calls.
 *
 * Abhängigkeiten injiziert (repo, provider, validator, ticketService) → testbar.
 */
class UseCaseDeveloperService {
  constructor({ repo, provider, validator, ticketService = null, detectionRepo = null } = {}) {
    if (!repo) throw new Error('UseCaseDeveloperService: repo erforderlich');
    if (!provider || typeof provider.develop !== 'function') {
      throw new Error('UseCaseDeveloperService: provider mit develop() erforderlich');
    }
    if (typeof validator !== 'function') {
      throw new Error('UseCaseDeveloperService: validator-Funktion erforderlich');
    }
    this._repo           = repo;
    this._provider       = provider;
    this._validate       = validator;
    this._ticketService  = ticketService;
    // Optional: PublishedDetection-Repo. Null → publish ohne Detection-Eintrag (Abwärtskompatibilität).
    this._detectionRepo  = detectionRepo;
  }

  /**
   * Erzeugt einen neuen Use-Case-Draft aus einer SOC-Quelle.
   * @returns {Promise<{ draft: object, quality: object }>}
   */
  async generate({ sourceType = 'manual', sourceId = '', actor = {} } = {}) {
    const context  = await this._loadContext(sourceType, sourceId);
    const draftData = await this._provider.develop(context); // wirft bei LLM-Fehler (kein Silent)
    draftData.sourceType = sourceType;
    draftData.sourceId   = sourceId;
    draftData.status     = 'draft';
    // Menschenlesbare Katalog-Nummer bei der Erstellung vergeben (UC-INC000001), analog
    // zur Ticket-Nummer. Fällt der Repo-Zähler aus, bleibt ucNumber null (kein harter Fehler).
    if (typeof this._repo.nextUseCaseNumber === 'function') {
      draftData.ucNumber = formatUcNumber(await this._repo.nextUseCaseNumber());
    }
    const quality = this._validate(draftData);
    const saved   = await this._repo.create(draftData);
    return { draft: saved, quality };
  }

  // Kontext aus der Quelle laden. MVP: Ticket (primär) + manual; weitere Quellen
  // reichen sourceId durch (Provider arbeitet defensiv mit vorhandenen Feldern).
  async _loadContext(sourceType, sourceId) {
    const base = { sourceType, sourceId };
    if (sourceType === 'ticket' && this._ticketService && sourceId) {
      const t = await this._ticketService.findById(sourceId).catch(() => null);
      if (t) base.ticket = typeof t.toJSON === 'function' ? t.toJSON() : t;
    }
    return base;
  }

  /** Liste (paginiert), optional nach Status gefiltert. */
  async list({ status = '', limit = 50, offset = 0 } = {}) {
    return status
      ? this._repo.findByStatus(status, { limit, offset })
      : this._repo.findAll({ limit, offset });
  }

  async get(id) {
    return this._repo.findById(id);
  }

  /** Re-Bewertung eines bestehenden Drafts (Quality-Gate). */
  async quality(id) {
    const data = await this._loadOr404(id);
    return this._validate(data);
  }

  sendToReview(id, actor) { return this._transition(id, 'sendToReview', actor); }
  approve(id, actor)      { return this._transition(id, 'approve', actor); }
  reject(id, actor)       { return this._transition(id, 'reject', actor); }

  async publish(id, actor) {
    const result = await this._transition(id, 'publish', actor);
    await this._createDetectionSnapshot(id, actor);
    return result;
  }

  // ─── intern ───────────────────────────────────────────────────────────────

  async _loadOr404(id) {
    const data = await this._repo.findById(id);
    if (!data) throw new NotFoundError('UseCaseDraft');
    return data;
  }

  // Transition über die Domain validieren, dann gezielt persistieren. Die Domain
  // wirft bei ungültigem Übergang einen plain Error mit status 409 — in eine
  // ConflictError übersetzen, damit der zentrale errorHandler korrekt 409 mappt.
  async _transition(id, method, actor = {}) {
    const data   = await this._loadOr404(id);
    const domain = new UseCaseDraft(data);
    try {
      domain[method](actor.id); // sendToReview/publish ignorieren das Argument
    } catch (err) {
      if (err && err.status === 409) throw new ConflictError(err.message);
      throw err;
    }
    return this._repo.setStatus(id, domain.status, domain.reviewedBy);
  }

  // ─── Detection-Snapshot nach Publish ─────────────────────────────────────
  //
  // Erzeugt einen idempotenten PublishedDetection-Eintrag in der Detection-Library.
  // Kein Silent-Fail: Fehler werden geworfen (konsistent mit dem Projektstil).
  //
  // Idempotenz: findByDraftId prüft vorher — wenn bereits vorhanden, überspringen.
  // Ohne _detectionRepo (null): kein Detection-Eintrag, kein Fehler (Abwärtskompatibilität).
  async _createDetectionSnapshot(draftId, actor = {}) {
    if (!this._detectionRepo) return;

    // Idempotenz-Check: existiert bereits ein Eintrag für diesen Draft?
    const existing = await this._detectionRepo.findByDraftId(draftId);
    if (existing) return;

    const draft = await this._repo.findById(draftId);
    if (!draft) {
      // Defensiv: Draft gelöscht zwischen Publish und Snapshot — nicht im Normalfall.
      return;
    }

    const detection = PublishedDetection.create(draft, actor.id || actor.email || '');
    await this._detectionRepo.create(detection);
  }
}

module.exports = { UseCaseDeveloperService };
