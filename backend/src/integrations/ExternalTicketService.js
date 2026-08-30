'use strict';

const { ExternalLink } = require('../domain/ExternalLink');
const { auditService, AUDIT_ACTIONS: CENTRAL_AUDIT_ACTIONS } = require('../services/AuditService');
const { NotFoundError } = require('../errors/AppError');
const logger = require('../logger');
const { InMemoryExternalLinkRepository } = require('../repositories/ExternalLinkRepository');

// Kurz-Aliase auf die zentrale Audit-Registry (Single Source of Truth in AuditService).
const AUDIT_ACTIONS = {
  EXPORT_SUCCESS:      CENTRAL_AUDIT_ACTIONS.EXTERNAL_TICKET_EXPORT_SUCCESS,
  EXPORT_FAILED:       CENTRAL_AUDIT_ACTIONS.EXTERNAL_TICKET_EXPORT_FAILED,
  STATUS_SYNC_SUCCESS: CENTRAL_AUDIT_ACTIONS.EXTERNAL_TICKET_STATUS_SYNC_SUCCESS,
  STATUS_SYNC_FAILED:  CENTRAL_AUDIT_ACTIONS.EXTERNAL_TICKET_STATUS_SYNC_FAILED,
};

class ExternalTicketService {
  constructor(adapters = {}, externalLinkRepository = null) {
    this._adapters = adapters;
    this._linkRepo = externalLinkRepository || new InMemoryExternalLinkRepository();
  }

  /**
   * P12.1: Ticket für Export vorbereiten — ohne echten HTTP-Call.
   * Gibt das externe Payload zurück, speichert noch nichts.
   * Dient als Vertrag/Preview: "So würde das externe Ticket aussehen."
   */
  prepareExport(ticket, system) {
    const adapter = this._getAdapter(system);
    const payload = adapter.mapToExternal(ticket);
    adapter.validateExternalPayload(payload);

    logger.info('external_ticket_export_prepared', {
      ticketId: ticket.id,
      system,
      title: payload.short_description || payload.Title || '',
    });

    return { system, payload, adapter };
  }

  /**
   * P12.2+: Ticket tatsächlich exportieren + ExternalLink speichern.
   * @param {Ticket}  ticket
   * @param {string}  system   Zielsystem-Schlüssel ('servicenow' | 'otrs')
   * @param {object}  actor    optionaler Aufrufer-Kontext für das Audit
   *                           ({ actorUserId, actorLabel, ip }) — wer hat exportiert.
   */
  async exportTicket(ticket, system, actor = {}) {
    const { actorUserId, actorLabel, ip } = actor;

    try {
      // prepareExport (Mapping/Validierung) bewusst INNERHALB des try: ein
      // Outbound-Export, der schon beim Mapping/Adapter-Lookup scheitert, hinterlässt
      // ebenfalls eine Audit-Spur (EXPORT_FAILED) — kein still verschluckter Fehlversuch.
      const { adapter } = this.prepareExport(ticket, system);
      const result = await adapter.sendTicket(ticket);

      const link = ExternalLink.create({
        internalTicketId: ticket.id,
        externalSystem:   system,
        externalId:       result.externalId,
        externalUrl:      result.externalUrl || '',
        syncDirection:    'outbound',
      });
      link.markSynced();
      await this._linkRepo.save(link);

      // Der externe Export ist bereits passiert — ein fehlschlagender Audit-Write
      // (z.B. DB-Ausfall) darf das Ergebnis NICHT in einen 500 verwandeln (sonst
      // Retry → Doppel-Ticket extern). Audit-Fehler wird geloggt + geschluckt.
      await this._writeAudit({
        action:    AUDIT_ACTIONS.EXPORT_SUCCESS,
        actorUserId, actorLabel, ip,
        targetType: 'ticket', targetId: ticket.id,
        metadata:  { system, externalId: result.externalId, externalRef: result.externalRef },
      });

      return { status: 'exported', externalId: result.externalId, link };
    } catch (err) {
      // Fehler-Audit darf den ursprünglichen err NICHT überlagern (DB down im catch).
      // reason gekürzt: err.message kann externe Server-Strings (OTRS ErrorMessage) tragen.
      await this._writeAudit({
        action:    AUDIT_ACTIONS.EXPORT_FAILED,
        actorUserId, actorLabel, ip,
        targetType: 'ticket', targetId: ticket.id,
        metadata:  { system, reason: String(err && err.message ? err.message : err).slice(0, 200) },
      });
      throw err;
    }
  }

  /**
   * P12.4: Status eines BEREITS exportierten Tickets ins externe System spiegeln.
   * Findet den gespeicherten ExternalLink (externalId) für ticket+system und ruft
   * adapter.updateTicketStatus(externalId, ticket.status). Auditiert Erfolg/Fehler.
   */
  async syncStatus(ticket, system, actor = {}) {
    const { actorUserId, actorLabel, ip } = actor;

    try {
      const adapter = this._getAdapter(system);
      const links   = await this._linkRepo.findByTicketId(ticket.id);
      const link    = (links || []).find((l) => l.externalSystem === system);
      if (!link || !link.externalId) {
        throw new NotFoundError(`Kein Export-Link für Ticket ${ticket.id} / System ${system} — erst exportieren.`);
      }

      const result = await adapter.updateTicketStatus(link.externalId, ticket.status);

      await this._writeAudit({
        action:    AUDIT_ACTIONS.STATUS_SYNC_SUCCESS,
        actorUserId, actorLabel, ip,
        targetType: 'ticket', targetId: ticket.id,
        metadata:  { system, externalId: link.externalId, status: ticket.status },
      });

      return { status: 'synced', externalId: link.externalId, externalStatus: result.externalStatus };
    } catch (err) {
      await this._writeAudit({
        action:    AUDIT_ACTIONS.STATUS_SYNC_FAILED,
        actorUserId, actorLabel, ip,
        targetType: 'ticket', targetId: ticket.id,
        metadata:  { system, reason: String(err && err.message ? err.message : err).slice(0, 200) },
      });
      throw err;
    }
  }

  // Audit-Schreiben kapseln: ein Audit-Fehler darf die Hauptoperation (erfolgter
  // oder fehlgeschlagener Export) niemals überlagern — nur loggen, nie werfen.
  async _writeAudit(entry) {
    try {
      await auditService.write(entry);
    } catch (auditErr) {
      logger.error('external_ticket_audit_write_failed', {
        action:   entry.action,
        ticketId: entry.targetId,
        error:    auditErr.message,
      });
    }
  }

  /**
   * Layer 2: die effektive Verbindung (DB > ENV) eines Zielsystems auf den
   * registrierten Singleton-Adapter anwenden — ohne Prozess-Neustart. No-op, wenn das
   * System nicht registriert ist oder der Adapter kein reconfigure() kennt.
   */
  reconfigureAdapter(system, conn = {}) {
    const adapter = this._adapters[system];
    if (adapter && typeof adapter.reconfigure === 'function') {
      adapter.reconfigure(conn);
    }
  }

  _getAdapter(system) {
    const adapter = this._adapters[system];
    if (!adapter) throw new NotFoundError(`Kein Adapter für System: ${system}`);
    return adapter;
  }

  registeredSystems() { return Object.keys(this._adapters); }
}

module.exports = { ExternalTicketService, AUDIT_ACTIONS };
