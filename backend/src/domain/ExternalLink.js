'use strict';

const { randomUUID } = require('crypto');

const EXTERNAL_SYSTEMS = [
  'qradar',       // IBM QRadar — Offense ID
  'splunk',       // Splunk — Notable Event ID
  'servicenow',   // ServiceNow — INC-Nummer
  'otrs',         // OTRS/Znuny — Ticket-Nummer
  'jira',         // Jira — Issue Key
  'thehive',      // TheHive — Case ID
  'soar',         // SOAR-Plattform (generisch)
  'webhook',      // Generischer Webhook-Sender
  'other',        // Sonstiges externes System
];

const SYNC_DIRECTIONS = [
  'inbound',        // Externes System → wir
  'outbound',       // Wir → externes System
  'bidirectional',  // Beide Richtungen
];

const SYNC_STATUSES = [
  'pending',    // Synchronisation ausstehend
  'synced',     // Erfolgreich synchronisiert
  'failed',     // Fehler beim Sync
  'stale',      // Veraltet — externes System hat neuere Version
];

class ExternalLink {
  constructor({
    id               = randomUUID(),
    internalTicketId = '',
    externalSystem   = '',     // Schlüssel aus EXTERNAL_SYSTEMS
    externalId       = '',     // ID im externen System (z.B. "OFF-009134")
    externalUrl      = '',     // Direktlink zum externen Ticket
    syncDirection    = 'inbound',
    syncStatus       = 'pending',
    lastSyncAt       = null,
    lastSyncError    = null,   // Fehlermeldung bei lastSyncStatus = 'failed'
    rawPayloadHash   = '',     // SHA256 der Rohdaten beim Import (Traceability)
    createdAt        = new Date().toISOString(),
    updatedAt        = new Date().toISOString(),
  } = {}) {
    this.id               = id;
    this.internalTicketId = internalTicketId;
    this.externalSystem   = externalSystem;
    this.externalId       = externalId;
    this.externalUrl      = externalUrl;
    this.syncDirection    = syncDirection;
    this.syncStatus       = syncStatus;
    this.lastSyncAt       = lastSyncAt;
    this.lastSyncError    = lastSyncError;
    this.rawPayloadHash   = rawPayloadHash;
    this.createdAt        = createdAt;
    this.updatedAt        = updatedAt;
  }

  // Deduplizierungs-Key — verhindert doppelte Links vom selben System
  get deduplicationKey() {
    return `${this.externalSystem}::${this.externalId}`;
  }

  static create(data) {
    return new ExternalLink({
      ...data,
      id:        randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  markSynced() {
    this.syncStatus = 'synced';
    this.lastSyncAt = new Date().toISOString();
    this.lastSyncError = null;
    this.updatedAt  = new Date().toISOString();
  }

  markFailed(error) {
    this.syncStatus    = 'failed';
    this.lastSyncAt    = new Date().toISOString();
    this.lastSyncError = error;
    this.updatedAt     = new Date().toISOString();
  }

  toJSON() {
    return { ...this };
  }
}

module.exports = { ExternalLink, EXTERNAL_SYSTEMS, SYNC_DIRECTIONS, SYNC_STATUSES };
