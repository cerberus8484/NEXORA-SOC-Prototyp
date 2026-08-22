'use strict';

const { ExternalTicketAdapter } = require('../../ExternalTicketAdapter');
const { mapBaseFields }         = require('../../externalTicketMapper');
const { RealHttpClient }        = require('../../http/RealHttpClient');

const SN_PRIORITY = { critical: '1', high: '2', medium: '3', low: '4', info: '4' };
const SN_STATE    = { open: '1', progress: '2', closed: '6', fp: '7' };

class ServiceNowAdapter extends ExternalTicketAdapter {
  constructor({
    baseUrl  = '',
    username = '',
    password = '',
    table    = 'incident',
    httpClient = null,
  } = {}) {
    super('servicenow');
    this._baseUrl  = baseUrl  || process.env.SERVICENOW_BASE_URL  || '';
    this._username = username || process.env.SERVICENOW_USERNAME  || '';
    this._password = password || process.env.SERVICENOW_PASSWORD  || '';
    this._table    = table;
    // HTTP-Client injizierbar — InMemoryHttpClient in Tests, RealHttpClient in Produktion
    this._http = httpClient || new RealHttpClient({ ssrfProtection: true });
  }

  /**
   * Layer 2: die effektive Verbindung (DB > ENV) auf diese Singleton-Instanz anwenden —
   * beim Boot und nach jedem PUT /servicenow/connection. Nur gesetzte Felder werden
   * überschrieben; leere Werte aus der Auflösung ('none') setzen bewusst zurück, damit
   * ein gelöschter DB-Eintrag ohne ENV wieder als "nicht konfiguriert" scheitert.
   */
  reconfigure(conn = {}) {
    if (typeof conn.baseUrl  === 'string') this._baseUrl  = conn.baseUrl;
    if (typeof conn.username === 'string') this._username = conn.username;
    if (typeof conn.password === 'string') this._password = conn.password;
    if (typeof conn.table    === 'string' && conn.table) this._table = conn.table;
  }

  /**
   * Read-only-Verbindungstest (legt NICHTS an): GET Table API mit sysparm_limit=1.
   * 200 → Auth + Erreichbarkeit ok; 401 → Credentials falsch. Wirft bei Fehler.
   */
  async testConnection() {
    if (!this._baseUrl) throw new Error('ServiceNow: Base-URL fehlt');
    if (!this._username || !this._password) throw new Error('ServiceNow: Credentials fehlen');
    const url     = `${this._baseUrl.replace(/\/$/, '')}/api/now/table/${this._table}?sysparm_limit=1`;
    const authB64 = Buffer.from(`${this._username}:${this._password}`).toString('base64');
    await this._http.get(url, { 'Authorization': `Basic ${authB64}`, 'Accept': 'application/json' });
  }

  mapToExternal(ticket) {
    const base = mapBaseFields(ticket);
    return {
      short_description:  base.title.slice(0, 160),
      description:        base.description,
      priority:           SN_PRIORITY[ticket.priority] || '3',
      state:              SN_STATE[ticket.status]      || '1',
      category:           'security',
      subcategory:        base.category || 'incident',
      caller_id:          base.analyst,
      assigned_to:        base.analyst,
      correlation_id:     `soc:${base.internalId}`,
      correlation_display:`SOC-${base.internalRef}`,
      cmdb_ci:            base.affectedHost,
      work_notes:         this._buildWorkNotes(ticket),
      opened_at:          base.occuredAt || base.createdAt,
    };
  }

  validateExternalPayload(payload) {
    if (!payload.short_description?.trim()) {
      throw new Error('ServiceNow: short_description ist Pflichtfeld');
    }
  }

  /**
   * P12.2 ✅ — Ticket an ServiceNow Table API senden.
   *
   * POST /api/now/table/{table}
   * Auth: Basic (username:password Base64)
   * Response: { result: { sys_id, number, ... } }
   */
  async sendTicket(ticket) {
    if (!this._baseUrl) throw new Error('ServiceNow: SERVICENOW_BASE_URL ist nicht konfiguriert');
    if (!this._username || !this._password) throw new Error('ServiceNow: Credentials fehlen');

    const payload = this.mapToExternal(ticket);
    this.validateExternalPayload(payload);

    const url     = `${this._baseUrl.replace(/\/$/, '')}/api/now/table/${this._table}`;
    const authB64 = Buffer.from(`${this._username}:${this._password}`).toString('base64');

    const { data } = await this._http.post(url, payload, {
      'Authorization':    `Basic ${authB64}`,
      'Accept':           'application/json',
      'Content-Type':     'application/json',
      'X-no-response-ui': 'true',
    });

    const result = data?.result || data;
    if (!result?.sys_id) {
      throw new Error(`ServiceNow: Unerwartete Antwort — sys_id fehlt`);
    }

    return {
      externalId:  result.sys_id,
      externalRef: result.number || result.sys_id,
      externalUrl: `${this._baseUrl.replace(/\/$/, '')}/nav_to.do?uri=incident.do?sys_id=${result.sys_id}`,
      raw:         result,
    };
  }

  /**
   * P12.4 ✅ — Status eines bereits exportierten ServiceNow-Incidents aktualisieren.
   * PATCH /api/now/table/{table}/{sys_id} mit { state: <SN_STATE> }.
   */
  async updateTicketStatus(externalId, status) {
    if (!this._baseUrl) throw new Error('ServiceNow: SERVICENOW_BASE_URL ist nicht konfiguriert');
    if (!this._username || !this._password) throw new Error('ServiceNow: Credentials fehlen');
    if (!externalId) throw new Error('ServiceNow: externalId fehlt');

    const url     = `${this._baseUrl.replace(/\/$/, '')}/api/now/table/${this._table}/${externalId}`;
    const authB64 = Buffer.from(`${this._username}:${this._password}`).toString('base64');
    const body    = { state: SN_STATE[status] || '1' };

    const { data } = await this._http.patch(url, body, {
      'Authorization':    `Basic ${authB64}`,
      'Accept':           'application/json',
      'Content-Type':     'application/json',
      'X-no-response-ui': 'true',
    });

    const result = data?.result || data || {};
    return { externalId: String(externalId), externalStatus: result.state ?? body.state, raw: result };
  }

  _buildWorkNotes(ticket) {
    const notes = [`SOC Ticket: ${ticket.ticketNr || ticket.id}`];
    if (ticket.mitre)   notes.push(`MITRE: ${ticket.mitre}`);
    if (ticket.srcIp)   notes.push(`Source IP: ${ticket.srcIp}${ticket.srcFqdn ? ` (${ticket.srcFqdn})` : ''}`);
    if (ticket.dstIp)   notes.push(`Dest IP: ${ticket.dstIp}${ticket.dstFqdn ? ` (${ticket.dstFqdn})` : ''}`);
    if (ticket.iocs)    notes.push(`IOCs:\n${ticket.iocs}`);
    return notes.join('\n');
  }

  get tableApiUrl() {
    return this._baseUrl
      ? `${this._baseUrl.replace(/\/$/, '')}/api/now/table/${this._table}`
      : '';
  }
}

module.exports = { ServiceNowAdapter, SN_PRIORITY, SN_STATE };
