'use strict';

/**
 * InMemoryHuntRepository — Testdoppel + Basis-Interface für das Hunt-Modul.
 *
 * Deckt alle Domain-Objekte in einem einzigen Repository ab (P13.1).
 * Für Postgres-Implementierung wird später ein PostgresHuntRepository erstellt.
 *
 * Interface (alle Methoden):
 *   Session:  saveSession, findSessionById, findSessionsByTicketId, findSessionsByAnalyst
 *   Command:  saveCommand, findCommandsBySession
 *   Artifact: saveArtifact, findArtifactsBySession, findArtifactsByCommand
 *   Finding:  saveFinding, findFindingsBySession, findFindingsByTicket
 *   Note:     saveNote, findNotesBySession
 */
class InMemoryHuntRepository {
  constructor() {
    this._sessions    = new Map();
    this._commands    = new Map();
    this._artifacts   = new Map();
    this._findings    = new Map();
    this._notes       = new Map();
    this._ticketLinks = new Map(); // id → link
    this._linkDedup   = new Map(); // deduplicationKey → id
    this._logs        = new Map(); // id → log
    this._responseActions = new Map(); // id → response action
  }

  // ─── Response Actions (Approval-Gate, Stufe 2) ──────────────────────────────

  async saveResponseAction(a) {
    this._responseActions.set(a.id, { ...a });
    return { ...a };
  }

  async findResponseActionById(id) {
    const a = this._responseActions.get(id);
    return a ? { ...a } : null;
  }

  async findResponseActionsBySession(sessionId) {
    return [...this._responseActions.values()]
      .filter((a) => a.huntSessionId === sessionId)
      .sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1))
      .map((a) => ({ ...a }));
  }

  // ─── Logs (Hunt-Console) ────────────────────────────────────────────────────

  async saveLog(log) {
    this._logs.set(log.id, { ...log });
    return { ...log };
  }

  async findLogsBySession(sessionId) {
    return [...this._logs.values()]
      .filter(l => l.sessionId === sessionId)
      .sort((a, b) => (a.seq - b.seq) || (new Date(a.timestamp) - new Date(b.timestamp)))
      .map(l => ({ ...l }));
  }

  // ─── Session ──────────────────────────────────────────────────────────────

  async saveSession(session) {
    this._sessions.set(session.id, { ...session });
    return { ...session };
  }

  async findSessionById(id) {
    const s = this._sessions.get(id);
    return s ? { ...s } : null;
  }

  async findSessionsByTicketId(ticketId) {
    return [...this._sessions.values()]
      .filter(s => s.ticketId === ticketId)
      .map(s => ({ ...s }));
  }

  async findSessionsByAnalyst(analystId) {
    return [...this._sessions.values()]
      .filter(s => s.analystId === analystId)
      .map(s => ({ ...s }));
  }

  async findAllSessions() {
    return [...this._sessions.values()].map(s => ({ ...s }));
  }

  // ─── Command ──────────────────────────────────────────────────────────────

  async saveCommand(command) {
    this._commands.set(command.id, { ...command });
    return { ...command };
  }

  async findCommandById(id) {
    const c = this._commands.get(id);
    return c ? { ...c } : null;
  }

  async findCommandsBySession(sessionId) {
    return [...this._commands.values()]
      .filter(c => c.sessionId === sessionId)
      .map(c => ({ ...c }));
  }

  // ─── Artifact ─────────────────────────────────────────────────────────────

  async saveArtifact(artifact) {
    this._artifacts.set(artifact.id, { ...artifact });
    return { ...artifact };
  }

  async findArtifactById(id) {
    const a = this._artifacts.get(id);
    return a ? { ...a } : null;
  }

  async findArtifactsBySession(sessionId) {
    return [...this._artifacts.values()]
      .filter(a => a.sessionId === sessionId)
      .map(a => ({ ...a }));
  }

  async findArtifactsByCommand(commandId) {
    return [...this._artifacts.values()]
      .filter(a => a.commandId === commandId)
      .map(a => ({ ...a }));
  }

  // ─── Finding ──────────────────────────────────────────────────────────────

  async saveFinding(finding) {
    this._findings.set(finding.id, { ...finding });
    return { ...finding };
  }

  async findFindingById(id) {
    const f = this._findings.get(id);
    return f ? { ...f } : null;
  }

  async findFindingsBySession(sessionId) {
    return [...this._findings.values()]
      .filter(f => f.sessionId === sessionId)
      .map(f => ({ ...f }));
  }

  async findFindingsByTicket(ticketId) {
    return [...this._findings.values()]
      .filter(f => f.ticketId === ticketId)
      .map(f => ({ ...f }));
  }

  // ─── Note ─────────────────────────────────────────────────────────────────

  async saveNote(note) {
    this._notes.set(note.id, { ...note });
    return { ...note };
  }

  async findNotesBySession(sessionId) {
    return [...this._notes.values()]
      .filter(n => n.sessionId === sessionId)
      .map(n => ({ ...n }));
  }

  // ─── Ticket-Links (P13.4) ─────────────────────────────────────────────────

  async saveTicketLink(link) {
    this._ticketLinks.set(link.id, { ...link });
    this._linkDedup.set(link.deduplicationKey, link.id);
    return { ...link };
  }

  /** Idempotenz-Lookup: existiert bereits ein identischer Link? */
  async findTicketLinkByDeduplicationKey(key) {
    const id = this._linkDedup.get(key);
    return id ? { ...this._ticketLinks.get(id) } : null;
  }

  async findTicketLinksBySession(sessionId) {
    return [...this._ticketLinks.values()]
      .filter(l => l.huntSessionId === sessionId)
      .map(l => ({ ...l }));
  }

  async findTicketLinksByTicket(ticketId) {
    return [...this._ticketLinks.values()]
      .filter(l => l.ticketId === ticketId)
      .map(l => ({ ...l }));
  }

  // ─── Test-Utilities ───────────────────────────────────────────────────────

  clear() {
    this._sessions.clear();
    this._commands.clear();
    this._artifacts.clear();
    this._findings.clear();
    this._notes.clear();
    this._ticketLinks.clear();
    this._linkDedup.clear();
    this._logs.clear();
    this._responseActions.clear();
  }

  counts() {
    return {
      sessions:    this._sessions.size,
      commands:    this._commands.size,
      artifacts:   this._artifacts.size,
      findings:    this._findings.size,
      notes:       this._notes.size,
      ticketLinks: this._ticketLinks.size,
    };
  }
}

module.exports = { InMemoryHuntRepository };
