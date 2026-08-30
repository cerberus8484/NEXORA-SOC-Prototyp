'use strict';

const { randomUUID } = require('crypto');

/**
 * Typen von Artefakten, die ein Hunt ergeben kann.
 */
const ARTIFACT_TYPE = Object.freeze({
  FILE:          'file',           // Datei (Hash, Pfad, Größe)
  PROCESS:       'process',        // Prozess (PID, Name, Parent, Cmdline)
  NETWORK_CONN:  'network_conn',   // Netzwerkverbindung (src/dst IP+Port, Proto)
  REGISTRY_KEY:  'registry_key',   // Registry-Eintrag (Key, Value)
  USER_ACCOUNT:  'user_account',   // Benutzerkonto (Name, SID, Gruppe)
  LOG_ENTRY:     'log_entry',      // Log-Zeile (Quelle, Zeitstempel, Inhalt)
  IOC:           'ioc',            // IOC (Hash, IP, Domain, URL)
  MEMORY_REGION: 'memory_region',  // Memory-Dump (nur Beschreibung, kein Blob — P13.5+)
  OTHER:         'other',
});

/**
 * HuntArtifact — ein konkreter Befund aus einem HuntCommand.
 *
 * Artefakte sind reine Datenbehälter. Sie werden nicht direkt ans Ticket gehängt —
 * das passiert über HuntFinding (P13.4).
 */
class HuntArtifact {
  /**
   * @param {object} props
   * @param {string} props.id
   * @param {string} props.sessionId    — ThreatHuntSession.id
   * @param {string} props.commandId    — HuntCommand.id (optional — kann manuell erfasst werden)
   * @param {string} props.type         — ARTIFACT_TYPE
   * @param {string} props.value        — Hauptwert (Hash, IP, Pfad, ...)
   * @param {object} props.metadata     — Zusätzliche strukturierte Felder (frei)
   * @param {string} props.source       — Woher stammt das Artefakt? (Tool, Log, ...)
   * @param {string} props.analystId    — wer hat es erfasst?
   * @param {Date}   props.createdAt
   */
  constructor(props) {
    this.id        = props.id;
    this.sessionId = props.sessionId;
    this.commandId = props.commandId || null;
    this.type      = props.type;
    this.value     = props.value;
    this.metadata  = props.metadata  || {};
    this.source    = props.source    || '';
    this.analystId = props.analystId;
    this.createdAt = props.createdAt instanceof Date ? props.createdAt : new Date(props.createdAt);
  }

  static create({ sessionId, commandId = null, type, value, metadata = {}, source = '', analystId }) {
    if (!sessionId?.trim()) throw new Error('HuntArtifact: sessionId ist Pflichtfeld');
    if (!value?.trim())     throw new Error('HuntArtifact: value ist Pflichtfeld');
    if (!analystId?.trim()) throw new Error('HuntArtifact: analystId ist Pflichtfeld');

    const validTypes = Object.values(ARTIFACT_TYPE);
    if (!validTypes.includes(type)) {
      throw new Error(`HuntArtifact: Ungültiger Typ "${type}". Erlaubt: ${validTypes.join(', ')}`);
    }

    return new HuntArtifact({
      id:        randomUUID(),
      sessionId: sessionId.trim(),
      commandId: commandId || null,
      type,
      value:     value.trim(),
      metadata,
      source:    source.trim(),
      analystId: analystId.trim(),
      createdAt: new Date(),
    });
  }

  static fromPersistence(raw) {
    return new HuntArtifact({
      ...raw,
      metadata: typeof raw.metadata === 'string' ? JSON.parse(raw.metadata) : (raw.metadata || {}),
    });
  }

  toJSON() {
    return {
      id:        this.id,
      sessionId: this.sessionId,
      commandId: this.commandId,
      type:      this.type,
      value:     this.value,
      metadata:  this.metadata,
      source:    this.source,
      analystId: this.analystId,
      createdAt: this.createdAt.toISOString(),
    };
  }
}

module.exports = { HuntArtifact, ARTIFACT_TYPE };
