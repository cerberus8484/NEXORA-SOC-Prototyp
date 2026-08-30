'use strict';

const { query } = require('../../db/pool');

/**
 * PostgresHuntRepository — erfüllt denselben Vertrag wie InMemoryHuntRepository.
 *
 * HuntService übergibt `.toJSON()`-Objekte an save* und erwartet von find*
 * `.toJSON()`-förmige Objekte zurück (damit X.fromPersistence(raw) funktioniert).
 *
 * Mapping-Strategie:
 *   - camelCase (Domain JSON) ↔ snake_case (DB-Spalte)
 *   - Datumsfelder: Domain liefert ISO-String, DB liefert Date → _iso()
 *   - JSONB (metadata, artifactIds): beim Schreiben JSON.stringify, beim Lesen Objekt
 */
class PostgresHuntRepository {

  // ── Helper ─────────────────────────────────────────────────────────────────

  /** DB-Date | ISO-String | null → ISO-String | null */
  _iso(v) {
    if (!v) return null;
    return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
  }

  /** JSONB aus DB (Objekt) oder String → JS-Wert */
  _json(v, fallback) {
    if (v === null || v === undefined) return fallback;
    return typeof v === 'string' ? JSON.parse(v) : v;
  }

  // ── Session ────────────────────────────────────────────────────────────────

  async saveSession(s) {
    await query(`
      INSERT INTO hunt_sessions
        (id, ticket_id, analyst_id, target_host, scope, hypothesis, status, created_at, updated_at, started_at, closed_at,
         hunt_type, title, risk_level, summary, findings_count)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT (id) DO UPDATE SET
        ticket_id   = EXCLUDED.ticket_id,
        target_host = EXCLUDED.target_host,
        scope       = EXCLUDED.scope,
        hypothesis  = EXCLUDED.hypothesis,
        status      = EXCLUDED.status,
        updated_at  = EXCLUDED.updated_at,
        started_at  = EXCLUDED.started_at,
        closed_at   = EXCLUDED.closed_at,
        hunt_type      = EXCLUDED.hunt_type,
        title          = EXCLUDED.title,
        risk_level     = EXCLUDED.risk_level,
        summary        = EXCLUDED.summary,
        findings_count = EXCLUDED.findings_count
    `, [
      s.id, s.ticketId || null, s.analystId, s.targetHost, s.scope || '', s.hypothesis || '',
      s.status, s.createdAt, s.updatedAt, s.startedAt || null, s.closedAt || null,
      s.huntType || '', s.title || '', s.riskLevel || 'low', s.summary || '',
      Number.isFinite(s.findingsCount) ? s.findingsCount : 0,
    ]);
    return this.findSessionById(s.id);
  }

  _rowToSession(r) {
    if (!r) return null;
    return {
      id:         r.id,
      ticketId:   r.ticket_id,
      analystId:  r.analyst_id,
      targetHost: r.target_host,
      scope:      r.scope,
      hypothesis: r.hypothesis,
      status:     r.status,
      huntType:      r.hunt_type || '',
      title:         r.title || '',
      riskLevel:     r.risk_level || 'low',
      summary:       r.summary || '',
      findingsCount: Number.isFinite(r.findings_count) ? r.findings_count : Number(r.findings_count || 0),
      createdAt:  this._iso(r.created_at),
      updatedAt:  this._iso(r.updated_at),
      startedAt:  this._iso(r.started_at),
      closedAt:   this._iso(r.closed_at),
    };
  }

  async findSessionById(id) {
    const res = await query('SELECT * FROM hunt_sessions WHERE id = $1', [id]);
    return this._rowToSession(res.rows[0]);
  }

  async findSessionsByTicketId(ticketId) {
    const res = await query('SELECT * FROM hunt_sessions WHERE ticket_id = $1 ORDER BY created_at DESC', [ticketId]);
    return res.rows.map(r => this._rowToSession(r));
  }

  async findSessionsByAnalyst(analystId) {
    const res = await query('SELECT * FROM hunt_sessions WHERE analyst_id = $1 ORDER BY created_at DESC', [analystId]);
    return res.rows.map(r => this._rowToSession(r));
  }

  async findAllSessions() {
    const res = await query('SELECT * FROM hunt_sessions ORDER BY created_at DESC');
    return res.rows.map(r => this._rowToSession(r));
  }

  // ── Command ────────────────────────────────────────────────────────────────

  async saveCommand(c) {
    await query(`
      INSERT INTO hunt_commands
        (id, session_id, type, command, description, status, result, stdout, stderr,
         exit_code, blocked_reason, analyst_id, created_at, updated_at, executed_at, completed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT (id) DO UPDATE SET
        status         = EXCLUDED.status,
        result         = EXCLUDED.result,
        stdout         = EXCLUDED.stdout,
        stderr         = EXCLUDED.stderr,
        exit_code      = EXCLUDED.exit_code,
        blocked_reason = EXCLUDED.blocked_reason,
        updated_at     = EXCLUDED.updated_at,
        executed_at    = EXCLUDED.executed_at,
        completed_at   = EXCLUDED.completed_at
    `, [
      c.id, c.sessionId, c.type, c.command, c.description || '', c.status,
      c.result || '', c.stdout || '', c.stderr || '',
      c.exitCode ?? null, c.blockedReason || '', c.analystId,
      c.createdAt, c.updatedAt, c.executedAt || null, c.completedAt || null,
    ]);
    return this.findCommandById(c.id);
  }

  _rowToCommand(r) {
    if (!r) return null;
    return {
      id:            r.id,
      sessionId:     r.session_id,
      type:          r.type,
      command:       r.command,
      description:   r.description,
      status:        r.status,
      result:        r.result,
      stdout:        r.stdout,
      stderr:        r.stderr,
      exitCode:      r.exit_code,
      blockedReason: r.blocked_reason,
      analystId:     r.analyst_id,
      createdAt:     this._iso(r.created_at),
      updatedAt:     this._iso(r.updated_at),
      executedAt:    this._iso(r.executed_at),
      completedAt:   this._iso(r.completed_at),
    };
  }

  async findCommandById(id) {
    const res = await query('SELECT * FROM hunt_commands WHERE id = $1', [id]);
    return this._rowToCommand(res.rows[0]);
  }

  async findCommandsBySession(sessionId) {
    const res = await query('SELECT * FROM hunt_commands WHERE session_id = $1 ORDER BY created_at ASC', [sessionId]);
    return res.rows.map(r => this._rowToCommand(r));
  }

  // ── Artifact ───────────────────────────────────────────────────────────────

  async saveArtifact(a) {
    await query(`
      INSERT INTO hunt_artifacts
        (id, session_id, command_id, type, value, metadata, source, analyst_id, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (id) DO UPDATE SET
        type     = EXCLUDED.type,
        value    = EXCLUDED.value,
        metadata = EXCLUDED.metadata,
        source   = EXCLUDED.source
    `, [
      a.id, a.sessionId, a.commandId || null, a.type, a.value,
      JSON.stringify(a.metadata || {}), a.source || '', a.analystId, a.createdAt,
    ]);
    return this.findArtifactById(a.id);
  }

  _rowToArtifact(r) {
    if (!r) return null;
    return {
      id:        r.id,
      sessionId: r.session_id,
      commandId: r.command_id,
      type:      r.type,
      value:     r.value,
      metadata:  this._json(r.metadata, {}),
      source:    r.source,
      analystId: r.analyst_id,
      createdAt: this._iso(r.created_at),
    };
  }

  async findArtifactById(id) {
    const res = await query('SELECT * FROM hunt_artifacts WHERE id = $1', [id]);
    return this._rowToArtifact(res.rows[0]);
  }

  async findArtifactsBySession(sessionId) {
    const res = await query('SELECT * FROM hunt_artifacts WHERE session_id = $1 ORDER BY created_at ASC', [sessionId]);
    return res.rows.map(r => this._rowToArtifact(r));
  }

  async findArtifactsByCommand(commandId) {
    const res = await query('SELECT * FROM hunt_artifacts WHERE command_id = $1 ORDER BY created_at ASC', [commandId]);
    return res.rows.map(r => this._rowToArtifact(r));
  }

  // ── Finding ────────────────────────────────────────────────────────────────

  async saveFinding(f) {
    // Platzhalter-Zählung:
    // $1=id  $2=session_id  $3=title  $4=description  $5=severity  $6=confidence
    // $7=artifact_ids  $8=mitre_attack  $9=recommendation  $10=analyst_id
    // $11=ticket_id  $12=created_at  $13=updated_at  $14=context  $15=verdict
    await query(`
      INSERT INTO hunt_findings
        (id, session_id, title, description, severity, confidence, artifact_ids,
         mitre_attack, recommendation, analyst_id, ticket_id, created_at, updated_at, context, verdict)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (id) DO UPDATE SET
        title          = EXCLUDED.title,
        description    = EXCLUDED.description,
        severity       = EXCLUDED.severity,
        confidence     = EXCLUDED.confidence,
        artifact_ids   = EXCLUDED.artifact_ids,
        mitre_attack   = EXCLUDED.mitre_attack,
        recommendation = EXCLUDED.recommendation,
        ticket_id      = EXCLUDED.ticket_id,
        updated_at     = EXCLUDED.updated_at,
        context        = EXCLUDED.context,
        verdict        = EXCLUDED.verdict
    `, [
      f.id, f.sessionId, f.title, f.description || '', f.severity, f.confidence,
      JSON.stringify(f.artifactIds || []), f.mitreAttack || '', f.recommendation || '',
      f.analystId, f.ticketId || null, f.createdAt, f.updatedAt,
      JSON.stringify(f.context || {}), typeof f.verdict === 'string' ? f.verdict : '',
    ]);
    return this.findFindingById(f.id);
  }

  _rowToFinding(r) {
    if (!r) return null;
    return {
      id:             r.id,
      sessionId:      r.session_id,
      title:          r.title,
      description:    r.description,
      severity:       r.severity,
      confidence:     r.confidence,
      artifactIds:    this._json(r.artifact_ids, []),
      mitreAttack:    r.mitre_attack,
      recommendation: r.recommendation,
      analystId:      r.analyst_id,
      ticketId:       r.ticket_id,
      // verdict: NULL aus DB (Rows vor Migration 024) → leerer String
      verdict:        typeof r.verdict === 'string' ? r.verdict : '',
      context:        this._json(r.context, {}),
      createdAt:      this._iso(r.created_at),
      updatedAt:      this._iso(r.updated_at),
    };
  }

  // ── Logs (Hunt-Console) ──────────────────────────────────────────────────────

  async saveLog(l) {
    await query(`
      INSERT INTO hunt_logs (id, session_id, seq, level, message, timestamp)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (id) DO NOTHING
    `, [l.id, l.sessionId, l.seq || 0, l.level, l.message, l.timestamp]);
    const res = await query('SELECT * FROM hunt_logs WHERE id = $1', [l.id]);
    return this._rowToLog(res.rows[0]);
  }

  _rowToLog(r) {
    if (!r) return null;
    return {
      id:        r.id,
      sessionId: r.session_id,
      seq:       r.seq,
      level:     r.level,
      message:   r.message,
      timestamp: this._iso(r.timestamp),
    };
  }

  async findLogsBySession(sessionId) {
    const res = await query(
      'SELECT * FROM hunt_logs WHERE session_id = $1 ORDER BY seq ASC, timestamp ASC', [sessionId]);
    return res.rows.map(r => this._rowToLog(r));
  }

  // ── Response Actions (Approval-Gate, Stufe 2) ────────────────────────────────

  async saveResponseAction(a) {
    await query(`
      INSERT INTO hunt_response_actions
        (id, hunt_session_id, target_host, kind, command, reason, risk_tier, status,
         requested_by, requested_at, approved_by, approved_at, rejection_reason, note, authorization_basis)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (id) DO UPDATE SET
        status=$8, approved_by=$11, approved_at=$12, rejection_reason=$13, note=$14, authorization_basis=$15
    `, [
      a.id, a.huntSessionId, a.targetHost, a.kind, a.command, a.reason, a.riskTier, a.status,
      a.requestedBy, a.requestedAt, a.approvedBy, a.approvedAt, a.rejectionReason, a.note, a.authorizationBasis || '',
    ]);
    return this.findResponseActionById(a.id);
  }

  _rowToResponseAction(r) {
    if (!r) return null;
    return {
      id: r.id, huntSessionId: r.hunt_session_id, targetHost: r.target_host,
      kind: r.kind, command: r.command, reason: r.reason, riskTier: r.risk_tier, status: r.status,
      requestedBy: r.requested_by, requestedAt: this._iso(r.requested_at),
      approvedBy: r.approved_by, approvedAt: this._iso(r.approved_at),
      rejectionReason: r.rejection_reason, note: r.note,
      authorizationBasis: r.authorization_basis || '',
    };
  }

  async findResponseActionById(id) {
    const res = await query('SELECT * FROM hunt_response_actions WHERE id = $1', [id]);
    return this._rowToResponseAction(res.rows[0]);
  }

  async findResponseActionsBySession(sessionId) {
    const res = await query('SELECT * FROM hunt_response_actions WHERE hunt_session_id = $1 ORDER BY requested_at DESC', [sessionId]);
    return res.rows.map((r) => this._rowToResponseAction(r));
  }

  async findFindingById(id) {
    const res = await query('SELECT * FROM hunt_findings WHERE id = $1', [id]);
    return this._rowToFinding(res.rows[0]);
  }

  async findFindingsBySession(sessionId) {
    const res = await query('SELECT * FROM hunt_findings WHERE session_id = $1 ORDER BY created_at ASC', [sessionId]);
    return res.rows.map(r => this._rowToFinding(r));
  }

  async findFindingsByTicket(ticketId) {
    const res = await query('SELECT * FROM hunt_findings WHERE ticket_id = $1 ORDER BY created_at ASC', [ticketId]);
    return res.rows.map(r => this._rowToFinding(r));
  }

  // ── Note ───────────────────────────────────────────────────────────────────

  async saveNote(n) {
    await query(`
      INSERT INTO hunt_notes (id, session_id, content, analyst_id, created_at)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (id) DO NOTHING
    `, [n.id, n.sessionId, n.content, n.analystId, n.createdAt]);
    const res = await query('SELECT * FROM hunt_notes WHERE id = $1', [n.id]);
    return this._rowToNote(res.rows[0]);
  }

  _rowToNote(r) {
    if (!r) return null;
    return {
      id:        r.id,
      sessionId: r.session_id,
      content:   r.content,
      analystId: r.analyst_id,
      createdAt: this._iso(r.created_at),
    };
  }

  async findNotesBySession(sessionId) {
    const res = await query('SELECT * FROM hunt_notes WHERE session_id = $1 ORDER BY created_at ASC', [sessionId]);
    return res.rows.map(r => this._rowToNote(r));
  }

  // ── Ticket-Links (P13.4) ─────────────────────────────────────────────────────

  async saveTicketLink(l) {
    await query(`
      INSERT INTO hunt_ticket_links
        (id, hunt_session_id, ticket_id, source_type, source_id, summary, linked_by, linked_at, deduplication_key)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (deduplication_key) DO NOTHING
    `, [
      l.id, l.huntSessionId, l.ticketId, l.sourceType, l.sourceId,
      l.summary || '', l.linkedBy, l.linkedAt, l.deduplicationKey,
    ]);
    const res = await query('SELECT * FROM hunt_ticket_links WHERE deduplication_key = $1', [l.deduplicationKey]);
    return this._rowToLink(res.rows[0]);
  }

  _rowToLink(r) {
    if (!r) return null;
    return {
      id:               r.id,
      huntSessionId:    r.hunt_session_id,
      ticketId:         r.ticket_id,
      sourceType:       r.source_type,
      sourceId:         r.source_id,
      summary:          r.summary,
      linkedBy:         r.linked_by,
      linkedAt:         this._iso(r.linked_at),
      deduplicationKey: r.deduplication_key,
    };
  }

  async findTicketLinkByDeduplicationKey(key) {
    const res = await query('SELECT * FROM hunt_ticket_links WHERE deduplication_key = $1', [key]);
    return this._rowToLink(res.rows[0]);
  }

  async findTicketLinksBySession(sessionId) {
    const res = await query('SELECT * FROM hunt_ticket_links WHERE hunt_session_id = $1 ORDER BY linked_at ASC', [sessionId]);
    return res.rows.map(r => this._rowToLink(r));
  }

  async findTicketLinksByTicket(ticketId) {
    const res = await query('SELECT * FROM hunt_ticket_links WHERE ticket_id = $1 ORDER BY linked_at ASC', [ticketId]);
    return res.rows.map(r => this._rowToLink(r));
  }
}

module.exports = { PostgresHuntRepository };
