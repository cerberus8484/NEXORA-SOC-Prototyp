'use strict';

/**
 * BaseAdapter — Interface für alle Integrationsadapter.
 *
 * Jeder Adapter (QRadar, Splunk, ServiceNow, ...) erbt von hier.
 * Externe Systeme werden NIE direkt in Services/Routes angesprochen.
 *
 * Architektur-Regel:
 *   Externer Input → Adapter → Validierung → Normalisierung → IntegrationEvent
 */
class BaseAdapter {
  constructor(source) {
    if (!source) throw new Error('BaseAdapter benötigt einen source-Namen');
    this.source = source;
  }

  /**
   * Eingehende Rohdaten validieren.
   * Wirft ValidationError wenn Daten ungültig.
   * @param {object} rawPayload
   */
  // eslint-disable-next-line no-unused-vars
  validate(rawPayload) {
    this._notImplemented('validate');
  }

  /**
   * Rohdaten → normalisiertes Format.
   * Gibt ein Objekt zurück das alle weiteren Schritte verstehen.
   * @param {object} rawPayload
   * @returns {{ title, priority, externalId, category, srcIp, dstIp, datetime, raw }}
   */
  // eslint-disable-next-line no-unused-vars
  normalize(rawPayload) {
    this._notImplemented('normalize');
  }

  /**
   * Normalisierte Daten → Ticket-Draft.
   * Optional — nicht alle Adapter erzeugen direkt Tickets.
   * Default: gibt normalizedData unverändert zurück.
   * @param {object} normalizedData
   */
  toTicketDraft(normalizedData) {
    return normalizedData;
  }

  _notImplemented(method) {
    throw new Error(`${this.constructor.name}.${method}() ist nicht implementiert`);
  }
}

module.exports = { BaseAdapter };
