'use strict';

const { randomUUID } = require('crypto');

// Felder einer Analyse-Vorlage — 1:1 aus dem Ursprungs-Tool portiert
// (localStorage-Key `soc_analyse_vtpl`). Eine Vorlage füllt diese
// Felder eines Tickets vor: Beschreibung, IOCs, Logs, Maßnahmen, Empfehlung, Notizen.
const TEMPLATE_FIELDS = ['desc', 'iocs', 'logs', 'actions', 'rec', 'notes'];

const MAX_NAME  = 120;
const MAX_FIELD = 20_000; // Kappung gegen Riesen-Payloads (DoS-Schutz an der Domain-Grenze)

function _field(v) {
  return String(v ?? '').slice(0, MAX_FIELD);
}

/**
 * AnalysisTemplate — geteilte Analyse-Vorlage (Enterprise: über alle Analysten,
 * Postgres-persistent; im Ursprungs-Tool war das pro-Browser localStorage).
 *
 * Eine Vorlage ist ein benannter Satz vorbefüllter Ticket-Textfelder, den ein
 * Analyst beim Anlegen eines Tickets in das Formular laden kann.
 */
class AnalysisTemplate {
  constructor({ id, name, desc = '', iocs = '', logs = '', actions = '', rec = '',
    notes = '', author = '', createdAt, updatedAt } = {}) {
    this.id        = id || randomUUID();
    this.name      = String(name ?? '').trim().slice(0, MAX_NAME);
    this.desc      = _field(desc);
    this.iocs      = _field(iocs);
    this.logs      = _field(logs);
    this.actions   = _field(actions);
    this.rec       = _field(rec);
    this.notes     = _field(notes);
    this.author    = String(author ?? '').trim();
    this.createdAt = createdAt || new Date().toISOString();
    this.updatedAt = updatedAt || new Date().toISOString();
  }

  /** Eine Vorlage braucht mindestens einen Namen. */
  isValid() {
    return Boolean(this.name);
  }

  toJSON() {
    return {
      id: this.id, name: this.name,
      desc: this.desc, iocs: this.iocs, logs: this.logs,
      actions: this.actions, rec: this.rec, notes: this.notes,
      author: this.author, createdAt: this.createdAt, updatedAt: this.updatedAt,
    };
  }
}

module.exports = { AnalysisTemplate, TEMPLATE_FIELDS, MAX_NAME, MAX_FIELD };
