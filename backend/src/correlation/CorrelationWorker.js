'use strict';

const logger = require('../logger');
const { CorrelationJob, CorrelationResult, CORRELATION_STATUS } = require('./correlationJobDomain');
const { CAP_MAX_CHILDREN, CAP_MAX_RETRIES } = require('../applyChannel/RuntimeConfigProvider');

const DEFAULT_HEARTBEAT_INTERVAL_MS = 5000;

/**
 * CorrelationWorker — P_CORR_1b. Verarbeitet persistente Correlation-Jobs asynchron:
 *
 *   Queue-Job { correlationJobId } → Job laden → bounded Input laden → pure CorrelationEngine
 *   → source_revision erneut prüfen → Resultat ATOMAR speichern → Job completed → Queue ack
 *
 * Pflichtregeln:
 *  - Job wird ERST nach erfolgreichem atomarem saveResult abgeschlossen.
 *  - Fehler werden NICHT geschluckt → an die Queue zurückgeworfen (pg-boss retry/dead-letter).
 *  - source_revision vor dem finalen Speichern erneut prüfen; bei Änderung KEIN stale Result.
 *  - Input ist begrenzt (maxChildren) — keine unbounded Evidence-/Flow-Mengen.
 *  - Explizites start()/stop().
 *
 * Reine Orchestrierung; die fachliche Korrelation rechnet die unveränderte pure CorrelationEngine.
 * Deps injizierbar → ohne HTTP/DB testbar.
 */

const DEFAULT_MAX_CHILDREN = 200;  // < MAX_RESULT_EVIDENCE (Domain), kein unbounded Input
const DEFAULT_MAX_RETRIES  = 3;

class CorrelationWorker {
  /**
   * @param {object} deps
   * @param {object} deps.repo     Correlation-Repo (createJob/findJobById/updateJob/saveResult/findResultByInputHash)
   * @param {object} deps.queue    QueueService (registerWorker)
   * @param {object} deps.engine   { correlate(ticket, children) } — pure CorrelationEngine
   * @param {object} deps.tickets  { getById(id), findChildren(id,{limit}), getRevision(id) }
   */
  constructor({ repo, queue, engine, tickets, queueName, maxChildren = DEFAULT_MAX_CHILDREN, maxRetries = DEFAULT_MAX_RETRIES, configProvider = null, statusReporter = null, heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS } = {}) {
    if (!repo || !queue || !engine || !tickets) {
      throw new Error('CorrelationWorker: repo, queue, engine und tickets sind erforderlich');
    }
    this._repo        = repo;
    this._queue       = queue;
    this._engine      = engine;
    this._tickets     = tickets;
    this._queueName   = queueName;
    this._maxChildren = Math.max(1, Number(maxChildren) || DEFAULT_MAX_CHILDREN);
    this._maxRetries  = Math.max(1, Number(maxRetries) || DEFAULT_MAX_RETRIES);
    // Optional (P_CORR_ADMIN_2 Stufe 2): liest angewendete Werte an Job-Grenzen aus dem
    // Runtime-Config-Store. Ohne Provider bleibt das Verhalten exakt wie bisher.
    this._configProvider = configProvider;
    // Optional (Stufe 3): meldet Live-Status (Heartbeat, übernommene Config-Version,
    // Queue-Zustand) persistent. Ohne Reporter bleibt das Verhalten exakt wie bisher.
    this._statusReporter = statusReporter;
    this._heartbeatIntervalMs = Math.max(1000, Number(heartbeatIntervalMs) || DEFAULT_HEARTBEAT_INTERVAL_MS);
    this._heartbeatTimer = null;
    this._running     = false;
  }

  // Stufe 3: an einer Job-Grenze (oder idle-Tick) die aktiven Store-Versionen als
  // „übernommen" melden + Heartbeat mit Queue-Zustand. Best-effort: ein Melde-Fehler
  // bricht die Korrelation NICHT ab (Health-Seite ist ohnehin fail-closed).
  async _reportBoundary(state) {
    if (!this._statusReporter) return;
    try {
      if (this._configProvider) {
        for (const cap of [CAP_MAX_CHILDREN, CAP_MAX_RETRIES]) {
          const v = await this._configProvider.getActiveVersionFor(cap);
          if (v != null) await this._statusReporter.adopt(cap, v, state);
        }
      }
      await this._statusReporter.heartbeat(state);
    } catch (e) {
      logger.warn('worker_status_report_failed', { state, message: e.message });
    }
  }

  // An der Job-Grenze gelesener, fail-safe Wert (Provider → sonst Konstruktor-Default).
  async _maxChildrenForJob() {
    if (!this._configProvider) return this._maxChildren;
    return Math.max(1, Number(await this._configProvider.getMaxChildren(this._maxChildren)) || this._maxChildren);
  }
  async _maxRetriesForJob() {
    if (!this._configProvider) return this._maxRetries;
    return Math.max(1, Number(await this._configProvider.getMaxRetries(this._maxRetries)) || this._maxRetries);
  }

  async start() {
    if (this._running) return;
    await this._queue.registerWorker(this._queueName, (job) => this.process(job));
    this._running = true;
    // Stufe 3: idle-Heartbeat-Tick — auch ohne Jobs lebt der Worker und übernimmt die
    // neueste Config (kein laufender Job → sicher). So kann auch ein idle-Worker eine
    // frische Apply-Version bestätigen.
    if (this._statusReporter) {
      await this._reportBoundary('idle');
      this._heartbeatTimer = setInterval(() => { this._reportBoundary('idle').catch(() => {}); }, this._heartbeatIntervalMs);
      if (this._heartbeatTimer.unref) this._heartbeatTimer.unref();
    }
    logger.info('correlation_worker_started', { queue: this._queueName });
  }

  async stop() {
    this._running = false;
    if (this._heartbeatTimer) { clearInterval(this._heartbeatTimer); this._heartbeatTimer = null; }
    logger.info('correlation_worker_stopped', { queue: this._queueName });
  }

  isRunning() { return this._running; }

  async process(queueJob) {
    const correlationJobId = queueJob && queueJob.data && queueJob.data.correlationJobId;
    if (!correlationJobId) {
      // Fehlerhafte Nachricht → ack (kein endloser Retry auf etwas Unverarbeitbares).
      logger.warn('correlation_worker_no_job_id', { jobId: queueJob && queueJob.id });
      return;
    }

    const stored = await this._repo.findJobById(correlationJobId);
    if (!stored) {
      logger.warn('correlation_worker_job_missing', { correlationJobId }); // veraltete Nachricht → ack
      return;
    }

    const job = new CorrelationJob(stored);
    // Job-Grenze: Worker übernimmt hier die aktuelle Runtime-Config (Snapshot für DIESEN
    // Job) und meldet die übernommene Version + processing-Heartbeat.
    await this._reportBoundary('processing');
    if (job.isTerminal()) {
      logger.info('correlation_worker_job_terminal', { id: job.id, status: job.status }); // idempotent → ack
      return;
    }

    // Idempotenz: existiert bereits ein Resultat für diesen inputHash → kein Recompute, nur verknüpfen.
    const existing = await this._repo.findResultByInputHash(job.inputHash);
    if (existing) {
      job.start();
      job.complete(existing.id);
      await this._repo.updateJob(job.toJSON());
      logger.info('correlation_worker_reused_result', { id: job.id, resultId: existing.id });
      return;
    }

    job.start();
    await this._repo.updateJob(job.toJSON());

    try {
      // 1. Bounded Input: Ticket + (bei Case) begrenzt geladene Child-Tickets.
      // maxChildren wird an DIESER Job-Grenze gelesen (Snapshot für diesen Job).
      const maxChildren = await this._maxChildrenForJob();
      const ticket = await this._tickets.getById(job.ticketId);
      if (!ticket) {
        // Ticket wurde gelöscht, während der Job in der Queue lag → KEIN Retry-Storm
        // (weder App- noch pg-boss-Retry). Kontrolliert als failed beenden (ack), analog
        // zum superseded-Pfad: kein throw. (Verhindert das Delete-Timeout-Symptom.)
        job.fail(`ticket_deleted: ${job.ticketId} nicht mehr vorhanden`);
        await this._repo.updateJob(job.toJSON());
        logger.info('correlation_worker_ticket_deleted', { id: job.id, ticketId: job.ticketId });
        return; // ack — keine Retries
      }
      const children = ticket.kind === 'case'
        ? await this._tickets.findChildren(job.ticketId, { limit: maxChildren })
        : [];

      // 2. Pure Correlation Engine (unverändert, keine Seiteneffekte).
      const correlated = this._engine.correlate(ticket, children);

      // 3. source_revision erneut prüfen — Input noch gültig?
      const currentRevision = String((await this._tickets.getRevision(job.ticketId)) ?? '');
      if (currentRevision !== String(job.sourceRevision)) {
        // Input hat sich geändert → normalerweise KEIN veraltetes Resultat schreiben;
        // ein frischer Job für die neue Revision ist Sache des Triggers (1c).
        //
        // AUSNAHME (Starvation): Hat das Ticket noch GAR KEIN Resultat, würde stures
        // Verwerfen es dauerhaft ohne Evidence lassen — aktiv aggregierende Tickets
        // (Honeypot: sekündlich neue Alerts) werden IMMER superseded, der Folgejob
        // ebenso. Genau das ließ 99,8 % der Tickets ohne Resultat und das Analysis-Deck
        // (u. a. Commands) leer. Der Lesepfad ist auf veraltete Resultate vorbereitet:
        // er vergleicht den inputHash und labelt sie ehrlich als `superseded`. Ein
        // korrekt getaggtes Resultat schlägt ein dauerhaft leeres Deck.
        // Monotonie bleibt gewahrt: existiert bereits eines, wird NICHT überschrieben.
        const existingForTicket = await this._repo.findLatestResultByTicket(job.ticketId);
        if (!existingForTicket) {
          const staleRecord = new CorrelationResult({
            ticketId:       job.ticketId,
            jobId:          job.id,
            inputHash:      job.inputHash,      // trägt die Revision, aus der gerechnet wurde
            sourceRevision: job.sourceRevision,
            engineVersion:  job.engineVersion,
            result:         correlated,
            evidenceRefs:   this._buildEvidenceRefs(ticket, children),
          });
          await this._repo.saveResult(staleRecord.toJSON());
          logger.info('correlation_worker_superseded_first_result_kept', { id: job.id, ticketId: job.ticketId });
        }

        job.fail(`superseded: source_revision geändert (${job.sourceRevision} → ${currentRevision})`);
        await this._repo.updateJob(job.toJSON());
        logger.info('correlation_worker_superseded', { id: job.id, ticketId: job.ticketId });
        return; // ack — kein Fehler, sondern kontrollierte Verwerfung
      }

      // 4. Resultat ATOMAR speichern (engine_version/input_hash/Evidence-Refs/Zeitpunkt inklusive).
      const resultRecord = new CorrelationResult({
        ticketId:       job.ticketId,
        jobId:          job.id,
        inputHash:      job.inputHash,
        sourceRevision: job.sourceRevision,
        engineVersion:  job.engineVersion,
        result:         correlated,
        evidenceRefs:   this._buildEvidenceRefs(ticket, children),
      });
      const saved = await this._repo.saveResult(resultRecord.toJSON());

      // 5. Job ERST nach erfolgreichem Speichern abschließen (Pflichtregel 1).
      job.complete(saved.id);
      await this._repo.updateJob(job.toJSON());
      logger.info('correlation_worker_completed', { id: job.id, resultId: saved.id, children: children.length });
    } catch (err) {
      // Pflichtregeln 2+3: nicht schlucken; Domain-Status spiegeln; an die Queue zurückwerfen.
      await this._reflectFailure(job.id, err);
      throw err;
    }
  }

  // Domain-Status nach einem Fehler spiegeln: retry (bounded) oder endgültig failed.
  async _reflectFailure(jobId, err) {
    try {
      const stored = await this._repo.findJobById(jobId);
      if (!stored) return;
      const j = new CorrelationJob(stored);
      if (j.status !== CORRELATION_STATUS.RUNNING) return;
      const maxRetries = await this._maxRetriesForJob();
      if (j.retryCount + 1 >= maxRetries) j.fail(err.message);
      else j.retry(err.message);
      await this._repo.updateJob(j.toJSON());
    } catch (e2) {
      logger.error('correlation_worker_status_update_failed', { id: jobId, message: e2.message });
    }
  }

  // Vollständiger Rückverweis: Subject-Ticket + beitragende Child-Tickets (bounded).
  _buildEvidenceRefs(ticket, children) {
    const refs = [{ ticketId: ticket.id, role: 'subject' }];
    for (const c of children) refs.push({ ticketId: c.id, role: 'child' });
    return refs;
  }
}

module.exports = { CorrelationWorker, DEFAULT_MAX_CHILDREN, DEFAULT_MAX_RETRIES };
