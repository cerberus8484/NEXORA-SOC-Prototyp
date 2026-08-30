'use strict';

const { ThreatHuntSession }           = require('../domain/ThreatHuntSession');
const { HuntNote }                    = require('../domain/HuntNote');
const { HuntCommand }                 = require('../domain/HuntCommand');
const { HuntFinding, FINDING_VERDICT } = require('../domain/HuntFinding');
const { HuntArtifact }                = require('../domain/HuntArtifact');
const { HuntTicketLink, LINK_SOURCE_TYPE } = require('../domain/HuntTicketLink');
const { HuntLog, LOG_LEVEL }          = require('../domain/HuntLog');
const { getHuntType }                 = require('../domain/HuntType');
const { evaluateSafeCommand }         = require('../domain/SafeCommands');
const { ResponseAction }              = require('../domain/ResponseAction');
const { HUNT_AUDIT_EVENTS }           = require('../domain/HuntAuditEvents');
const { NotFoundError, ConflictError } = require('../../errors/AppError');
const { auditService }                = require('../../services/AuditService');
const config                          = require('../../config');
const { maxRisk, sleep }              = require('./huntRunnerUtils');
const logger                          = require('../../logger');

/**
 * HuntService — Business Logic für Threat Hunt Sessions.
 *
 * Verantwortlichkeiten (SRP):
 *   - Session erstellen / lesen / Statuswechsel
 *   - Notes erfassen
 *   - Audit nach jedem Schreibvorgang
 *   - Domain-Exceptions (ThreatHuntSession._transition) in ConflictError übersetzen
 *
 * Kein HTTP, kein Express. Der ECHTE Endpoint-Exec (ADR-042, Stufe 3) liegt NICHT hier,
 * sondern in einem INJIZIERTEN Runner (Default fail-safe: wirft) — HuntService orchestriert
 * nur die gated Zustandsmaschine (wie beim Mock). Repository injiziert (FCoI) → testbar ohne DB.
 */

// Circuit-Breaker: nach so vielen AUFEINANDERFOLGENDEN fehlgeschlagenen Real-Exec-Versuchen
// wird der Containment-Kanal gesperrt (E_CIRCUIT_OPEN) bis zu einem manuellen Admin-Reset —
// wiederholte Fehler deuten auf ein systemisches Kanal-/Host-Problem (analog apply_safety_lock).
// Ein Erfolg setzt die Serie zurück.
const CIRCUIT_FAIL_THRESHOLD = 3;

// Default-Response-Runner: kein Containment-Kanal konfiguriert → wirft (kein stiller Erfolg).
// Der echte SSH-Runner (ADR-042 Real-SSH-Slice) wird über den Factory injiziert.
function defaultResponseRunnerFactory() {
  throw Object.assign(
    new Error('Containment-Executor nicht konfiguriert — kein Zustellkanal (ADR-042 Real-SSH-Slice).'),
    { status: 503, code: 'E_NO_CHANNEL' },
  );
}

class HuntService {
  /**
   * @param {InMemoryHuntRepository|PostgresHuntRepository} huntRepository
   * @param {object} [deps]
   * @param {TicketService} [deps.ticketService] — für Ticket-Existenzprüfung bei Links (P13.4)
   */
  constructor(huntRepository, {
    ticketService = null, evidenceService = null, auditService: auditSvc = null,
    authService: authSvc = null, responseRunnerFactory = null, isRealExecEnabled = null,
  } = {}) {
    if (!huntRepository) throw new Error('HuntService: huntRepository ist Pflichtfeld');
    this._repo            = huntRepository;
    this._ticketService   = ticketService;
    this._evidenceService = evidenceService;
    // DI: auditService injizierbar (Tests mocken), Fallback auf Singleton.
    this._auditSvc        = auditSvc || auditService;
    // ADR-042 (Stufe 3, echter Containment-Exec) — alles injizierbar, alles fail-closed:
    //  - authService.verifyDeployReauth für die frische Reauth beim Execute;
    //  - responseRunnerFactory baut den echten Runner (Default: wirft, kein Kanal);
    //  - isRealExecEnabled liest den Kill-Switch (default AUS).
    this._authSvc               = authSvc;
    this._responseRunnerFactory = typeof responseRunnerFactory === 'function' ? responseRunnerFactory : defaultResponseRunnerFactory;
    this._isRealExecEnabled     = typeof isRealExecEnabled === 'function'
      ? isRealExecEnabled
      : () => (process.env.HUNT_RESPONSE_REAL_EXEC_ENABLED === 'true' || config.huntResponse?.realExecutionEnabled === true);
    // In-Process-Lock je Ziel-Host: verhindert parallele Containment-Ausführungen gegen
    // denselben Host (isolate/release-Race → nicht-deterministisches Endresultat).
    this._execLocks = new Set();
    // Circuit-Breaker-State (in-process): Serie aufeinanderfolgender Exec-Fehler + offen/zu.
    this._execFailStreak = 0;
    this._circuitOpen = false;
  }

  // ─── Session Lifecycle ───────────────────────────────────────────────────

  /**
   * Neue Hunt Session anlegen.
   * @param {{ ticketId?, analystId, targetHost, scope?, hypothesis? }} dto
   * @returns {ThreatHuntSession}
   */
  async createSession(dto) {
    // Titel/Risk aus Hunt-Typ ableiten, wenn nicht explizit gesetzt.
    const def = dto.huntType ? getHuntType(dto.huntType) : null;
    const enriched = {
      ...dto,
      title:     dto.title     || (def ? def.label : ''),
      riskLevel: dto.riskLevel || (def ? def.riskLevel : 'low'),
    };
    const session = ThreatHuntSession.create(enriched);
    await this._repo.saveSession(session.toJSON());

    await this._audit(HUNT_AUDIT_EVENTS.SESSION_CREATED, session.analystId, session.id, {
      targetHost: session.targetHost,
      ticketId:   session.ticketId,
    });

    logger.info('hunt_session_created', { sessionId: session.id, analystId: session.analystId });
    return session;
  }

  /**
   * Session abrufen — wirft NotFoundError wenn nicht vorhanden.
   */
  async getSession(sessionId) {
    const raw = await this._repo.findSessionById(sessionId);
    if (!raw) throw new NotFoundError(`Hunt Session ${sessionId}`);
    return ThreatHuntSession.fromPersistence(raw);
  }

  /**
   * Alle Sessions auflisten, optional gefiltert nach ticketId oder analystId.
   */
  async listSessions({ ticketId, analystId } = {}) {
    if (ticketId)  return this._repo.findSessionsByTicketId(ticketId);
    if (analystId) return this._repo.findSessionsByAnalyst(analystId);
    // Fallback: InMemory gibt alle zurück — Postgres-Impl. braucht eigene findAll()
    return this._repo.findAllSessions ? this._repo.findAllSessions() : [];
  }

  /**
   * Session aktivieren (planned → active).
   */
  async activateSession(sessionId, actorId) {
    const session = await this.getSession(sessionId);
    this._safeTransition(() => session.activate(), sessionId);
    await this._repo.saveSession(session.toJSON());

    await this._audit(HUNT_AUDIT_EVENTS.SESSION_ACTIVATED, actorId, sessionId);
    logger.info('hunt_session_activated', { sessionId, actorId });
    return session;
  }

  /**
   * Session abschließen (active → completed).
   */
  async completeSession(sessionId, actorId) {
    const session = await this.getSession(sessionId);
    this._safeTransition(() => session.complete(), sessionId);
    await this._repo.saveSession(session.toJSON());

    await this._audit(HUNT_AUDIT_EVENTS.SESSION_COMPLETED, actorId, sessionId);
    logger.info('hunt_session_completed', { sessionId, actorId });
    return session;
  }

  /**
   * Session als gescheitert markieren (active → failed).
   */
  async failSession(sessionId, actorId, reason = '') {
    const session = await this.getSession(sessionId);
    this._safeTransition(() => session.fail(reason), sessionId);
    await this._repo.saveSession(session.toJSON());

    await this._audit(HUNT_AUDIT_EVENTS.SESSION_FAILED, actorId, sessionId, { reason });
    logger.info('hunt_session_failed', { sessionId, actorId, reason });
    return session;
  }

  /**
   * Session abbrechen (planned | active → cancelled).
   */
  async cancelSession(sessionId, actorId) {
    const session = await this.getSession(sessionId);
    this._safeTransition(() => session.cancel(), sessionId);
    await this._repo.saveSession(session.toJSON());

    await this._audit(HUNT_AUDIT_EVENTS.SESSION_CANCELLED, actorId, sessionId);
    logger.info('hunt_session_cancelled', { sessionId, actorId });
    return session;
  }

  // ─── Logs (Hunt-Console) ─────────────────────────────────────────────────

  async getLogs(sessionId) {
    await this.getSession(sessionId);
    return this._repo.findLogsBySession(sessionId);
  }

  /** Eine Logzeile anhängen (intern vom Runner genutzt). */
  async _appendLog(sessionId, level, message, seq, timestamp) {
    const log = HuntLog.create({ sessionId, level, message, seq, timestamp });
    await this._repo.saveLog(log.toJSON());
    return log;
  }

  // ─── Hunt Runner (Start → Execute → Detect → Document) ────────────────────

  /**
   * Startet eine Hunt Session.
   *
   * - Mit huntType: aktiviert → schreibt Runner-Logs → erzeugt Findings →
   *   schließt ab (synchron, deterministisch, mock-backed, KEINE Remote-Exec).
   * - Ohne huntType (Legacy/manuell): nur aktivieren (back-kompatibel).
   *
   * @returns {ThreatHuntSession}
   */
  async startHunt(sessionId, actorId, { stepDelayMs = 0 } = {}) {
    const session = await this.getSession(sessionId);

    // Aktivieren (planned → active). Falls schon active, Konflikt sauberer Fehler.
    this._safeTransition(() => session.activate(), sessionId);
    await this._repo.saveSession(session.toJSON());
    await this._audit(HUNT_AUDIT_EVENTS.SESSION_ACTIVATED, actorId, sessionId);

    const def = getHuntType(session.huntType);
    if (!def) {
      // Kein Runner-Typ → manuelle Session, bleibt aktiv.
      logger.info('hunt_session_activated', { sessionId, actorId, runner: false });
      return session;
    }

    if (stepDelayMs > 0) {
      // Asynchron: Session bleibt 'active', Logs/Findings erscheinen zeitversetzt
      // (Frontend-Polling zeigt echtes "Running"). Fehler abfangen → kein Crash.
      this._runSteps(session, actorId, def, stepDelayMs)
        .catch((err) => logger.error('hunt_run_failed', { sessionId, error: err.message }));
      return session;
    }

    // Synchron (Default, Tests): vollständig durchlaufen und abschließen.
    await this._runSteps(session, actorId, def, 0);
    return this.getSession(sessionId);
  }

  /** Führt die Runner-Schritte aus (Logs → Findings → complete). */
  async _runSteps(session, actorId, def, stepDelayMs) {
    const sessionId = session.id;
    const { logs, findings } = def.build(session);
    const startTs = Date.now();
    let seq = 0;
    for (const [level, message] of logs) {
      if (stepDelayMs > 0) {
        const cur = await this._repo.findSessionById(sessionId);
        if (!cur || cur.status === 'cancelled') return;   // Stop abgebrochen
        await sleep(stepDelayMs);
      }
      await this._appendLog(sessionId, level, message, seq, new Date(startTs + seq * 1000));
      seq += 1;
    }

    let highestRisk = 'low';
    for (const dto of findings) {
      await this.addFinding(sessionId, { ...dto, analystId: session.analystId });
      highestRisk = maxRisk(highestRisk, dto.severity);
    }

    // Frisch laden — könnte zwischenzeitlich abgebrochen worden sein.
    const fresh = await this.getSession(sessionId);
    if (fresh.status === 'cancelled') return;

    this._safeTransition(() => fresh.complete(), sessionId);
    fresh.applyRunResult({
      findingsCount: findings.length,
      riskLevel:     def.riskLevel || highestRisk,
      summary:       `${def.label}: ${findings.length} Finding(s), höchste Severity ${highestRisk}.`,
    });
    await this._repo.saveSession(fresh.toJSON());
    await this._audit(HUNT_AUDIT_EVENTS.SESSION_COMPLETED, actorId, sessionId, {
      findingsCount: findings.length, huntType: fresh.huntType,
    });
    logger.info('hunt_run_completed', { sessionId, huntType: fresh.huntType, findings: findings.length });
  }

  // ─── Safe Command Console (Response-Console Stufe 1) ──────────────────────

  /**
   * Führt einen Safe Command gegen den Ziel-Host der Session aus.
   *
   * SICHERHEIT: nur Allowlist (read-only), KEIN echter Remote-Exec, KEINE
   * destruktiven Befehle. Nicht erlaubte Eingaben → 400, nichts wird angelegt.
   * Erlaubte Befehle werden als HuntCommand (completed, stdout) protokolliert
   * und als Console-Log sichtbar. Audit auf jede Eingabe.
   */
  async runSafeCommand(sessionId, commandText, actorId) {
    const session = await this.getSession(sessionId);
    const input = String(commandText || '').trim();
    if (!input) {
      throw Object.assign(new Error('command fehlt'), { status: 400 });
    }

    const safe = evaluateSafeCommand(input, session.targetHost);
    if (!safe.allowed) {
      await this._audit('SAFE_COMMAND_REJECTED', actorId, sessionId, { command: input });
      throw Object.assign(
        new Error('Command nicht erlaubt — nur Safe-Command-Allowlist (read-only). Keine freie Shell.'),
        { status: 400 },
      );
    }

    const command = HuntCommand.create({
      sessionId, type: safe.type, command: input,
      description: 'Safe command (console, read-only)', analystId: actorId,
    });
    command.start();
    command.complete({ stdout: safe.stdout, exitCode: 0 });
    await this._repo.saveCommand(command.toJSON());

    // Auch in der Console sichtbar machen.
    const logs = await this._repo.findLogsBySession(sessionId);
    const nextSeq = logs.length;
    await this._appendLog(sessionId, LOG_LEVEL.INFO, `Analyst ran safe command: ${input}`, nextSeq);

    await this._audit('SAFE_COMMAND_RUN', actorId, sessionId, { command: input, commandId: command.id });
    logger.info('hunt_safe_command_run', { sessionId, command: input, actorId });
    return command;
  }

  // ─── Response Actions: Approval-Gate + Host-Isolation (Stufe 2) ───────────

  /**
   * Privilegierte Aktion ANFRAGEN (isolate_host / release_isolation /
   * privileged_command). Wird NICHT ausgeführt — Status 'requested', wartet auf
   * Genehmigung durch eine zweite Person. Audit.
   */
  async requestResponseAction(sessionId, { kind, command = '', reason = '' }, actorId) {
    const session = await this.getSession(sessionId);
    const action = ResponseAction.create({
      huntSessionId: sessionId, targetHost: session.targetHost,
      kind, command, reason, requestedBy: actorId,
    });
    await this._repo.saveResponseAction(action.toJSON());
    await this._appendLog(sessionId, 'warning',
      `Response action requested: ${kind}${command ? ` (${command})` : ''} — wartet auf Genehmigung`,
      (await this._repo.findLogsBySession(sessionId)).length);
    await this._audit('RESPONSE_REQUESTED', actorId, sessionId, { actionId: action.id, kind, riskTier: action.riskTier });
    logger.info('hunt_response_requested', { sessionId, kind, actorId });
    return action;
  }

  async listResponseActions(sessionId) {
    await this.getSession(sessionId);
    return this._repo.findResponseActionsBySession(sessionId);
  }

  async getResponseAction(sessionId, actionId) {
    await this.getSession(sessionId);
    const raw = await this._repo.findResponseActionById(actionId);
    if (!raw || raw.huntSessionId !== sessionId) {
      throw Object.assign(new Error('ResponseAction nicht gefunden'), { status: 404 });
    }
    return ResponseAction.fromPersistence(raw);
  }

  /**
   * Genehmigen — Vier-Augen (approver ≠ requester) + PFLICHT-Rechtsgrundlage
   * (Betriebsrat-Zustimmung / Notfall-Freigabe). Kein realer Exec (kein Agent).
   * Die Grundlage wird auditiert — sie IST der Befugnis-Nachweis.
   */
  async approveResponseAction(sessionId, actionId, approverId, authorizationBasis) {
    const action = await this.getResponseAction(sessionId, actionId);
    action.approve(approverId, authorizationBasis);  // 403 (Vier-Augen) / 409 (beurteilt) / 400 (keine Grundlage)
    await this._repo.saveResponseAction(action.toJSON());
    const autoExecEnabled = process.env.HUNT_RESPONSE_AUTO_EXECUTE_MOCK === 'true'
      || config.huntResponse?.autoExecuteMock === true;
    const autoExecEligible = autoExecEnabled
      && (action.kind === 'isolate_host' || action.kind === 'release_isolation');
    await this._appendLog(sessionId, 'success', `Response action approved: ${action.kind}${autoExecEligible ? ' (mock auto-execute enabled)' : ' (pending agent)'}`,
      (await this._repo.findLogsBySession(sessionId)).length);
    await this._audit(action.kind === 'isolate_host' ? 'HOST_ISOLATION_APPROVED' : 'RESPONSE_APPROVED',
      approverId, sessionId, { actionId: action.id, kind: action.kind, authorizationBasis: action.authorizationBasis });
    if (autoExecEligible) {
      return this._autoExecuteApprovedResponseAction(sessionId, action, approverId);
    }
    return action;
  }

  async rejectResponseAction(sessionId, actionId, approverId, reason = '') {
    const action = await this.getResponseAction(sessionId, actionId);
    action.reject(approverId, reason);
    await this._repo.saveResponseAction(action.toJSON());
    await this._audit('RESPONSE_REJECTED', approverId, sessionId, { actionId: action.id, kind: action.kind, reason });
    return action;
  }

  async _autoExecuteApprovedResponseAction(sessionId, action, actorId) {
    const executorLabel = 'system:auto-response-mock';
    try {
      action.startExecution(`Mock-Ausfuehrung gestartet fuer ${action.kind}. Kein echter Endpoint-Agent verbunden.`);
      await this._repo.saveResponseAction(action.toJSON());
      await this._appendLog(sessionId, LOG_LEVEL.WARNING,
        `Response action executing (mock): ${action.kind} on ${action.targetHost || 'target host'}`,
        (await this._repo.findLogsBySession(sessionId)).length);

      const completionNote = action.kind === 'isolate_host'
        ? 'Mock-Containment abgeschlossen. Nexora hat den Response-Workflow automatisch vollzogen; reale Endpoint-Isolation erfordert spaeter einen verbundenen Agenten.'
        : 'Mock-Freigabe abgeschlossen. Nexora hat den Response-Workflow automatisch vollzogen; reale Netzwerkfreigabe erfordert spaeter einen verbundenen Agenten.';

      action.completeExecution(completionNote);
      await this._repo.saveResponseAction(action.toJSON());
      await this._appendLog(sessionId, LOG_LEVEL.SUCCESS,
        `Response action completed (mock): ${action.kind}`,
        (await this._repo.findLogsBySession(sessionId)).length);
      await this._audit('RESPONSE_EXECUTED', actorId || executorLabel, sessionId, {
        actionId: action.id,
        kind: action.kind,
        mode: 'mock',
      });
      await this._audit(action.kind === 'isolate_host' ? 'HOST_ISOLATED' : 'HOST_ISOLATION_RELEASED',
        actorId || executorLabel, sessionId, { actionId: action.id, mode: 'mock' });
      return action;
    } catch (err) {
      action.failExecution(`Mock-Ausfuehrung fehlgeschlagen: ${err.message}`);
      await this._repo.saveResponseAction(action.toJSON());
      await this._appendLog(sessionId, LOG_LEVEL.ERROR,
        `Response action failed (mock): ${action.kind} - ${err.message}`,
        (await this._repo.findLogsBySession(sessionId)).length);
      await this._audit('RESPONSE_EXECUTION_FAILED', actorId || executorLabel, sessionId, {
        actionId: action.id,
        kind: action.kind,
        mode: 'mock',
        reason: err.message,
      });
      return action;
    }
  }

  /**
   * ECHTE Ausführung einer genehmigten Containment-Aktion (ADR-042, Stufe 3).
   * NIE automatisch — nur ein Mensch löst sie aus. Mehrschichtig fail-closed:
   *   1. Kill-Switch (HUNT_RESPONSE_REAL_EXEC_ENABLED, default AUS) — sonst deny;
   *   2. frische Reauth (verifyDeployReauth, an actor.id gebunden) — sonst deny;
   *   3. nur umkehrbare Aktionen (isolate_host/release_isolation) — sonst deny;
   *   4. Drei-Parteien: Ausführender ≠ Anforderer — sonst deny;
   *   5. Status muss 'approved' sein (Domain erzwingt 409);
   *   6. Runner ist INJIZIERT (Default fail-safe: wirft) → echter SSH-Kanal ist eigene Slice.
   * Jede Aktion/Ablehnung wird auditiert (redigiert, kein Roh-Fehler/Secret).
   */
  async executeResponseAction(sessionId, actionId, { actor, reauthToken } = {}) {
    const actorId = actor && actor.id;
    // 1. Kill-Switch (fail-closed)
    if (this._isRealExecEnabled() !== true) {
      await this._audit('RESPONSE_EXECUTION_DENIED', actorId, sessionId, { actionId, reason: 'not_armed' });
      throw Object.assign(new Error('Echte Response-Ausführung ist nicht scharfgeschaltet (HUNT_RESPONSE_REAL_EXEC_ENABLED).'), { status: 503, code: 'E_REAL_EXEC_DISABLED' });
    }
    // 1b. Circuit-Breaker (fail-closed): nach wiederholten Fehlern ist der Kanal gesperrt bis Admin-Reset.
    if (this._circuitOpen) {
      await this._audit('RESPONSE_EXECUTION_DENIED', actorId, sessionId, { actionId, reason: 'circuit_open' });
      throw Object.assign(new Error('Containment-Kanal nach wiederholten Fehlern gesperrt — Admin-Reset erforderlich.'), { status: 503, code: 'E_CIRCUIT_OPEN' });
    }
    // 2. Frische Reauth (fail-closed, an actor.id gebunden) — VOR jedem Runner-Kontakt
    const reauth = this._authSvc && await this._authSvc.verifyDeployReauth(reauthToken, actorId);
    if (!reauth || !reauth.ok) {
      await this._audit('RESPONSE_EXECUTION_DENIED', actorId, sessionId, { actionId, reason: 'reauth' });
      throw Object.assign(new Error('Frische Reauth erforderlich (X-Reauth-Token).'), { status: 401, code: 'E_REAUTH' });
    }
    // 3. Aktion aus der Registry (session-scoped, 404)
    const action = await this.getResponseAction(sessionId, actionId);
    // 4. Nur umkehrbare Containment-Aktionen im ersten Schnitt (ADR-042 §6)
    if (action.kind !== 'isolate_host' && action.kind !== 'release_isolation') {
      throw Object.assign(new Error(`Echte Ausführung nur für umkehrbare Containment-Aktionen (isolate_host/release_isolation), nicht ${action.kind}.`), { status: 400, code: 'E_UNSUPPORTED_REAL_EXEC' });
    }
    // 5. Drei-Parteien-Trennung: Ausführender darf nicht der Anforderer sein (≥ 2 Menschen)
    if (actorId && action.requestedBy && actorId === action.requestedBy) {
      await this._audit('RESPONSE_EXECUTION_DENIED', actorId, sessionId, { actionId, reason: 'self_execute' });
      throw Object.assign(new Error('Drei-Parteien-Trennung: Ausführender darf nicht der Anforderer sein.'), { status: 403, code: 'E_SELF_EXECUTE' });
    }
    // 6. Status-Guard (nur approved) — bevor der Runner gebaut wird
    if (action.status !== 'approved') {
      throw Object.assign(new Error(`Ausführung nur aus approved möglich (Status: ${action.status})`), { status: 409, code: 'E_NOT_APPROVED' });
    }
    // 7. Concurrency-Lock je Ziel-Host (fail-closed): nie zwei parallele Containment-
    //    Ausführungen gegen denselben Host (isolate/release-Race → unklares Endresultat).
    const lockKey = action.targetHost || action.id;
    if (this._execLocks.has(lockKey)) {
      await this._audit('RESPONSE_EXECUTION_DENIED', actorId, sessionId, { actionId, reason: 'in_progress' });
      throw Object.assign(new Error('Für diesen Ziel-Host läuft bereits eine Containment-Ausführung.'), { status: 409, code: 'E_EXEC_IN_PROGRESS' });
    }
    this._execLocks.add(lockKey);
    try {
      // 8. Runner bauen (injiziert; Default fail-safe wirft E_NO_CHANNEL) — VOR startExecution,
      //    damit ein fehlender Kanal die Aktion 'approved' lässt (retriable), nicht 'executing'.
      const runner = await this._responseRunnerFactory(action); // kann fail-closed werfen

      action.startExecution(`Reale Ausführung gestartet (${action.kind}) auf ${action.targetHost || 'Ziel-Host'}.`);
      await this._repo.saveResponseAction(action.toJSON());
      await this._appendLog(sessionId, LOG_LEVEL.WARNING,
        `Response action executing (ssh): ${action.kind} on ${action.targetHost || 'target host'}`,
        (await this._repo.findLogsBySession(sessionId)).length);

      let result;
      try {
        result = await runner({ action: { id: action.id, kind: action.kind, targetHost: action.targetHost } });
      } catch (e) {
        action.failExecution('Ausführung fehlgeschlagen (Transport).');
        await this._repo.saveResponseAction(action.toJSON());
        await this._audit('RESPONSE_EXECUTION_FAILED', actorId, sessionId, { actionId: action.id, kind: action.kind, mode: 'ssh', reason: 'exec_error' });
        await this._tripCircuitOnFailure(actorId, sessionId, action);
        throw Object.assign(new Error('Containment-Ausführung fehlgeschlagen.'), { status: 502, code: 'E_EXEC' });
      }
      if (!result || result.code !== 0) {
        action.failExecution('Ausführung nicht erfolgreich (Exit ≠ 0).');
        await this._repo.saveResponseAction(action.toJSON());
        await this._audit('RESPONSE_EXECUTION_FAILED', actorId, sessionId, { actionId: action.id, kind: action.kind, mode: 'ssh', reason: 'nonzero' });
        await this._tripCircuitOnFailure(actorId, sessionId, action);
        throw Object.assign(new Error('Containment-Ausführung nicht erfolgreich.'), { status: 502, code: 'E_EXEC_FAILED' });
      }

      this._execFailStreak = 0; // erfolgreicher Exec schließt die Fehlerserie
      action.executedBy = actorId || null;
      action.completeExecution(`Reale Ausführung abgeschlossen (${action.kind}).`);
      await this._repo.saveResponseAction(action.toJSON());
      await this._appendLog(sessionId, LOG_LEVEL.SUCCESS,
        `Response action completed (ssh): ${action.kind}`,
        (await this._repo.findLogsBySession(sessionId)).length);
      await this._audit('RESPONSE_EXECUTED', actorId, sessionId, { actionId: action.id, kind: action.kind, mode: 'ssh', executedBy: actorId });
      await this._audit(action.kind === 'isolate_host' ? 'HOST_ISOLATED' : 'HOST_ISOLATION_RELEASED',
        actorId, sessionId, { actionId: action.id, mode: 'ssh' });
      return action;
    } finally {
      this._execLocks.delete(lockKey);
    }
  }

  /** Zählt einen Exec-Fehler; öffnet den Kanal beim Erreichen der Schwelle (einmalig auditiert). */
  async _tripCircuitOnFailure(actorId, sessionId, action) {
    this._execFailStreak += 1;
    if (this._execFailStreak < CIRCUIT_FAIL_THRESHOLD || this._circuitOpen) return;
    this._circuitOpen = true;
    await this._audit('RESPONSE_CIRCUIT_OPENED', actorId, sessionId, { actionId: action.id, streak: this._execFailStreak });
    logger.warn('response_circuit_opened', { host: action.targetHost, streak: this._execFailStreak });
  }

  /** Aktueller Circuit-Zustand (für Status/UI). */
  getResponseCircuit() {
    return { open: this._circuitOpen, failStreak: this._execFailStreak, threshold: CIRCUIT_FAIL_THRESHOLD };
  }

  /** Manueller Admin-Reset des Containment-Kanals (nach Review). Auditiert. */
  async resetResponseCircuit({ actor } = {}) {
    const actorId = actor && actor.id;
    const wasOpen = this._circuitOpen;
    this._circuitOpen = false;
    this._execFailStreak = 0;
    await this._audit('RESPONSE_CIRCUIT_RESET', actorId, null, { wasOpen });
    logger.info('response_circuit_reset', { actorId, wasOpen });
    return { open: false, wasOpen };
  }

  // ─── Notes ───────────────────────────────────────────────────────────────

  /**
   * Notiz einer aktiven (oder geplanten) Session hinzufügen.
   */
  async addNote(sessionId, { content, analystId }) {
    // Session muss existieren — wirft NotFoundError wenn nicht
    await this.getSession(sessionId);

    const note = HuntNote.create({ sessionId, content, analystId });
    await this._repo.saveNote(note.toJSON());

    await this._audit(HUNT_AUDIT_EVENTS.NOTE_ADDED, analystId, sessionId, {
      noteId: note.id,
    });

    return note;
  }

  async getNotes(sessionId) {
    await this.getSession(sessionId);   // existence check
    return this._repo.findNotesBySession(sessionId);
  }

  // ─── Commands ────────────────────────────────────────────────────────────

  /**
   * Neuen Command zu einer Session hinzufügen.
   * @param {string} sessionId
   * @param {{ type, command, description?, analystId }} dto
   */
  async addCommand(sessionId, dto) {
    await this.getSession(sessionId);   // existence check + 404 guard

    const command = HuntCommand.create({ sessionId, ...dto });
    await this._repo.saveCommand(command.toJSON());

    await this._audit(HUNT_AUDIT_EVENTS.COMMAND_ADDED, dto.analystId, sessionId, {
      commandId: command.id,
      type:      command.type,
    });

    return command;
  }

  /**
   * Einzelnen Command laden — wirft NotFoundError wenn nicht vorhanden.
   */
  async getCommand(sessionId, commandId) {
    await this.getSession(sessionId);
    const raw = await this._repo.findCommandById(commandId);
    if (!raw || raw.sessionId !== sessionId) {
      throw new NotFoundError(`HuntCommand ${commandId}`);
    }
    return HuntCommand.fromPersistence(raw);
  }

  async getCommands(sessionId) {
    await this.getSession(sessionId);
    return this._repo.findCommandsBySession(sessionId);
  }

  /** Command starten (queued → running) */
  async startCommand(sessionId, commandId, actorId) {
    const command = await this.getCommand(sessionId, commandId);
    this._safeTransition(() => command.start(), commandId);
    await this._repo.saveCommand(command.toJSON());

    await this._audit(HUNT_AUDIT_EVENTS.COMMAND_STARTED, actorId, sessionId, { commandId });
    return command;
  }

  /** Command abschließen (running → completed) */
  async completeCommand(sessionId, commandId, actorId, { stdout = '', stderr = '', exitCode = null } = {}) {
    const command = await this.getCommand(sessionId, commandId);
    this._safeTransition(() => command.complete({ stdout, stderr, exitCode }), commandId);
    await this._repo.saveCommand(command.toJSON());

    await this._audit(HUNT_AUDIT_EVENTS.COMMAND_COMPLETED, actorId, sessionId, {
      commandId, exitCode,
    });
    return command;
  }

  /** Command als gescheitert markieren (running → failed) */
  async failCommand(sessionId, commandId, actorId, { reason = '', stderr = '', exitCode = null } = {}) {
    const command = await this.getCommand(sessionId, commandId);
    this._safeTransition(() => command.fail({ reason, stderr, exitCode }), commandId);
    await this._repo.saveCommand(command.toJSON());

    await this._audit(HUNT_AUDIT_EVENTS.COMMAND_FAILED, actorId, sessionId, {
      commandId, reason,
    });
    return command;
  }

  /** Command blockieren (queued → blocked) */
  async blockCommand(sessionId, commandId, actorId, reason = '') {
    const command = await this.getCommand(sessionId, commandId);
    this._safeTransition(() => command.block(reason), commandId);
    await this._repo.saveCommand(command.toJSON());

    await this._audit(HUNT_AUDIT_EVENTS.COMMAND_BLOCKED, actorId, sessionId, {
      commandId, reason,
    });
    return command;
  }

  /** Command zurück in Queue (blocked → queued) */
  async requeueCommand(sessionId, commandId, actorId) {
    const command = await this.getCommand(sessionId, commandId);
    this._safeTransition(() => command.requeue(), commandId);
    await this._repo.saveCommand(command.toJSON());

    await this._audit(HUNT_AUDIT_EVENTS.COMMAND_REQUEUED, actorId, sessionId, { commandId });
    return command;
  }

  // ─── Artifacts ───────────────────────────────────────────────────────────

  async addArtifact(sessionId, dto) {
    await this.getSession(sessionId);
    const artifact = HuntArtifact.create({ sessionId, ...dto });
    await this._repo.saveArtifact(artifact.toJSON());

    await this._audit(HUNT_AUDIT_EVENTS.ARTIFACT_COLLECTED, dto.analystId, sessionId, {
      artifactId: artifact.id, type: artifact.type,
    });
    return artifact;
  }

  async getArtifacts(sessionId) {
    await this.getSession(sessionId);
    return this._repo.findArtifactsBySession(sessionId);
  }

  async getArtifact(sessionId, artifactId) {
    await this.getSession(sessionId);
    const raw = await this._repo.findArtifactById(artifactId);
    if (!raw || raw.sessionId !== sessionId) {
      throw new NotFoundError(`HuntArtifact ${artifactId}`);
    }
    return HuntArtifact.fromPersistence(raw);
  }

  // ─── Findings ────────────────────────────────────────────────────────────

  async addFinding(sessionId, dto) {
    await this.getSession(sessionId);
    const finding = HuntFinding.create({ sessionId, ...dto });
    await this._repo.saveFinding(finding.toJSON());

    await this._audit(HUNT_AUDIT_EVENTS.FINDING_CREATED, dto.analystId, sessionId, {
      findingId: finding.id, severity: finding.severity,
    });
    return finding;
  }

  async getFindings(sessionId) {
    await this.getSession(sessionId);
    return this._repo.findFindingsBySession(sessionId);
  }

  async getFinding(sessionId, findingId) {
    await this.getSession(sessionId);
    const raw = await this._repo.findFindingById(findingId);
    if (!raw || raw.sessionId !== sessionId) {
      throw new NotFoundError(`HuntFinding ${findingId}`);
    }
    return HuntFinding.fromPersistence(raw);
  }

  // ─── Finding-Verdict (Block B2) ───────────────────────────────────────────

  /**
   * Analyst-Verdict an einem Finding setzen.
   *
   * Erlaubte Werte: '', 'benign', 'suspicious', 'malicious', 'inconclusive'.
   * Wirft bei ungültigem Verdict (HuntFinding.setVerdict validiert).
   * 404 wenn Session oder Finding nicht existieren.
   * Schreibt Audit-Log-Eintrag.
   *
   * @param {string} sessionId
   * @param {string} findingId
   * @param {string} verdict  — FINDING_VERDICT-Wert
   * @param {string} actorId  — Analyst-ID
   * @returns {HuntFinding}
   */
  async setFindingVerdict(sessionId, findingId, verdict, actorId) {
    const finding = await this.getFinding(sessionId, findingId);
    // Validierung in Domain — wirft Error bei ungültigem Wert
    finding.setVerdict(verdict);
    await this._repo.saveFinding(finding.toJSON());

    await this._audit(HUNT_AUDIT_EVENTS.FINDING_VERDICT_SET, actorId, sessionId, {
      findingId, verdict,
    });

    logger.info('hunt_finding_verdict_set', { sessionId, findingId, verdict, actorId });
    return finding;
  }

  // ─── Finding-Aktionen: Ticket erzeugen / Evidence anlegen (P13.5) ─────────

  /**
   * Erzeugt aus einem Finding ein echtes SOC-Ticket und verknüpft beides.
   * Severity → Ticket-Priority (gleiche Skala). Kontextfelder werden gemappt.
   */
  async createTicketFromFinding(sessionId, findingId, actorId) {
    if (!this._ticketService) {
      throw Object.assign(new Error('TicketService nicht verfügbar'), { status: 503 });
    }
    const finding = await this.getFinding(sessionId, findingId);
    const ctx = finding.context || {};

    const ticket = await this._ticketService.create({
      title:          finding.title,
      priority:       finding.severity,            // PRIORITIES-Skala identisch
      source:         'threat_hunt',
      category:       'Threat Hunt',
      analyst:        actorId || '',
      description:    finding.description || '',
      recommendation: finding.recommendation || '',
      mitre:          finding.mitreAttack || ctx.mitreTechnique || '',
      user:           ctx.user || '',
      srcIp:          ctx.sourceIp || '',
      dstIp:          ctx.destinationIp || '',
      hostname:       ctx.host || '',
      port:           ctx.destinationPort ? String(ctx.destinationPort) : '',
      protocol:       ctx.protocol || '',
      process:        ctx.process || '',
      confidence:     Number.isFinite(ctx.confidencePct) ? ctx.confidencePct : null,
    });

    // Finding ↔ Ticket verknüpfen (setzt finding.ticketId, Audit, HuntTicketLink).
    await this.linkFindingToTicket(sessionId, findingId, ticket.id, actorId);

    logger.info('hunt_finding_ticket_created', { sessionId, findingId, ticketId: ticket.id, actorId });
    return ticket;
  }

  /**
   * Legt ein Evidence-Item aus einem Finding an (append-only, Chain of Custody).
   * Evidence braucht ein Ticket — fehlt eines, wird zuerst eines erzeugt.
   */
  async addFindingToEvidence(sessionId, findingId, actorId) {
    if (!this._evidenceService) {
      throw Object.assign(new Error('EvidenceService nicht verfügbar'), { status: 503 });
    }
    const finding = await this.getFinding(sessionId, findingId);
    const ctx = finding.context || {};

    let ticketId = finding.ticketId;
    if (!ticketId) {
      const ticket = await this.createTicketFromFinding(sessionId, findingId, actorId);
      ticketId = ticket.id;
    }

    const res = await this._evidenceService.add({
      ticketId,
      title:       finding.title,
      type:        'log_entry',
      source:      ctx.source || 'threat_hunt',
      logSource:   ctx.source || 'Threat Hunt',
      eventId:     ctx.ruleId || ctx.mitreTechnique || '',
      rawText:     ctx.commandLine || ctx.destinationIp || ctx.process || finding.description || finding.title,
      confidence:  Number.isFinite(ctx.confidencePct) ? ctx.confidencePct : null,
      comment:     finding.recommendation || '',
      collectedBy: actorId || 'agent',
    });
    if (!res.ok) throw Object.assign(new Error(res.error || 'Evidence konnte nicht angelegt werden'), { status: 400 });

    await this._audit('HUNT_FINDING_TO_EVIDENCE', actorId, sessionId, {
      findingId, evidenceId: res.evidence?.id, ticketId,
    });
    logger.info('hunt_finding_evidence_added', { sessionId, findingId, evidenceId: res.evidence?.id, ticketId });
    return { evidence: res.evidence, ticketId };
  }

  // ─── Ticket-Links (P13.4) ────────────────────────────────────────────────

  /**
   * Finding mit einem Ticket verknüpfen.
   * Setzt zusätzlich ticketId auf dem Finding (für direkte Rückverfolgung).
   * Idempotent: derselbe Finding→Ticket-Link wird nicht doppelt erzeugt.
   */
  async linkFindingToTicket(sessionId, findingId, ticketId, actorId) {
    const finding = await this.getFinding(sessionId, findingId);
    await this._assertTicketExists(ticketId);

    const link = await this._createLink({
      sessionId, ticketId, actorId,
      sourceType: LINK_SOURCE_TYPE.FINDING,
      sourceId:   findingId,
      summary:    finding.title,
      auditEvent: HUNT_AUDIT_EVENTS.FINDING_LINKED,
    });

    // Finding selbst mit Ticket markieren (Rückverweis)
    finding.linkToTicket(ticketId);
    await this._repo.saveFinding(finding.toJSON());

    return link;
  }

  /**
   * Artifact als Evidence-Quelle mit einem Ticket verknüpfen.
   */
  async linkArtifactToTicket(sessionId, artifactId, ticketId, actorId) {
    const artifact = await this.getArtifact(sessionId, artifactId);
    await this._assertTicketExists(ticketId);

    return this._createLink({
      sessionId, ticketId, actorId,
      sourceType: LINK_SOURCE_TYPE.ARTIFACT,
      sourceId:   artifactId,
      summary:    `${artifact.type}: ${artifact.value}`.slice(0, 200),
      auditEvent: HUNT_AUDIT_EVENTS.ARTIFACT_LINKED,
    });
  }

  /**
   * Gesamte Hunt-Session-Zusammenfassung mit einem Ticket verknüpfen.
   */
  async linkSummaryToTicket(sessionId, ticketId, actorId) {
    const session = await this.getSession(sessionId);
    await this._assertTicketExists(ticketId);

    const summary = await this._buildSessionSummary(session);

    return this._createLink({
      sessionId, ticketId, actorId,
      sourceType: LINK_SOURCE_TYPE.SUMMARY,
      sourceId:   sessionId,
      summary,
      auditEvent: HUNT_AUDIT_EVENTS.SUMMARY_LINKED,
    });
  }

  async getTicketLinks(sessionId) {
    await this.getSession(sessionId);
    return this._repo.findTicketLinksBySession(sessionId);
  }

  // ─── Intern ──────────────────────────────────────────────────────────────

  /**
   * Erstellt einen HuntTicketLink idempotent + schreibt Audit.
   * Existiert der Link bereits (gleicher Dedup-Key), wird der vorhandene zurückgegeben.
   */
  async _createLink({ sessionId, ticketId, actorId, sourceType, sourceId, summary, auditEvent }) {
    const link = HuntTicketLink.create({
      huntSessionId: sessionId,
      ticketId,
      sourceType,
      sourceId,
      summary,
      linkedBy: actorId,
    });

    const existing = await this._repo.findTicketLinkByDeduplicationKey(link.deduplicationKey);
    if (existing) {
      return HuntTicketLink.fromPersistence(existing);   // idempotent — kein zweites Audit
    }

    await this._repo.saveTicketLink(link.toJSON());
    await this._audit(auditEvent, actorId, sessionId, {
      ticketId, sourceType, sourceId, linkId: link.id,
    });

    logger.info('hunt_ticket_link_created', { sessionId, ticketId, sourceType, sourceId, actorId });
    return link;
  }

  /**
   * Prüft, ob das Ziel-Ticket existiert. Wirft NotFoundError wenn nicht.
   * Wenn kein ticketService injiziert ist (z.B. isolierte Unit-Tests),
   * wird die Prüfung übersprungen.
   */
  async _assertTicketExists(ticketId) {
    if (!this._ticketService) return;
    await this._ticketService.findById(ticketId);   // wirft NotFoundError('Ticket')
  }

  /**
   * Baut eine textuelle Zusammenfassung der Session für den Ticket-Anhang.
   */
  async _buildSessionSummary(session) {
    const [commands, artifacts, findings] = await Promise.all([
      this._repo.findCommandsBySession(session.id),
      this._repo.findArtifactsBySession(session.id),
      this._repo.findFindingsBySession(session.id),
    ]);

    return [
      `Threat Hunt Session ${session.id}`,
      `Target: ${session.targetHost}`,
      `Status: ${session.status}`,
      `Scope: ${session.scope || '(kein Scope)'}`,
      `Commands: ${commands.length} · Artifacts: ${artifacts.length} · Findings: ${findings.length}`,
    ].join('\n');
  }

  /**
   * Domain-Exceptions aus _transition() sauber in ConflictError übersetzen.
   * Alle anderen Exceptions bleiben unverändert.
   */
  _safeTransition(fn, sessionId) {
    try {
      fn();
    } catch (err) {
      if (err.message.includes('Ungültiger Übergang')) {
        throw new ConflictError(`Hunt Session ${sessionId}: ${err.message}`);
      }
      throw err;
    }
  }

  async _audit(action, actorId, sessionId, metadata = {}) {
    await this._auditSvc.write({
      action,
      targetType: 'hunt_session',
      targetId:   sessionId,
      actorId:    actorId || 'system',
      metadata,
    });
  }
}

module.exports = { HuntService };
