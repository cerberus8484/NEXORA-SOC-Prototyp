'use strict';

const { ExternalTicketAdapter } = require('../../ExternalTicketAdapter');
const { mapBaseFields }         = require('../../externalTicketMapper');
const { RealHttpClient }        = require('../../http/RealHttpClient');

const OTRS_PRIORITY = { critical: '5 very high', high: '4 high', medium: '3 normal', low: '2 low', info: '1 very low' };
const OTRS_STATE    = { open: 'new', progress: 'open', closed: 'closed successful', fp: 'closed unsuccessful' };

class OTRSAdapter extends ExternalTicketAdapter {
  constructor({
    baseUrl    = '',
    username   = '',
    password   = '',
    queue      = 'Security',
    webService = 'GenericTicketConnectorREST',
    operation  = 'TicketCreate',
    httpClient = null,
  } = {}) {
    super('otrs');
    this._baseUrl    = baseUrl    || process.env.OTRS_BASE_URL    || '';
    this._username   = username   || process.env.OTRS_USERNAME    || '';
    this._password   = password   || process.env.OTRS_PASSWORD    || '';
    this._queue      = queue;
    this._webService = webService || process.env.OTRS_WEB_SERVICE  || 'GenericTicketConnectorREST';
    this._operation  = operation  || process.env.OTRS_OPERATION    || 'TicketCreate';
    this._http       = httpClient || new RealHttpClient();
  }

  /**
   * Layer 2: die effektive Verbindung (DB > ENV) auf diese Singleton-Instanz anwenden —
   * beim Boot und nach jedem PUT /otrs/connection. Nur gesetzte Felder werden
   * überschrieben; leere Werte aus der Auflösung ('none') setzen bewusst zurück, damit
   * ein gelöschter DB-Eintrag ohne ENV wieder als "nicht konfiguriert" scheitert.
   */
  reconfigure(conn = {}) {
    if (typeof conn.baseUrl    === 'string') this._baseUrl    = conn.baseUrl;
    if (typeof conn.username   === 'string') this._username   = conn.username;
    if (typeof conn.password   === 'string') this._password   = conn.password;
    if (typeof conn.queue      === 'string' && conn.queue)      this._queue      = conn.queue;
    if (typeof conn.webService === 'string' && conn.webService) this._webService = conn.webService;
    if (typeof conn.operation  === 'string' && conn.operation)  this._operation  = conn.operation;
  }

  /**
   * Read-only-Verbindungstest (legt KEIN Ticket an): SessionCreate gegen das
   * GenericInterface. SessionID → Auth + WebService ok; Error/kein SessionID → Fehler.
   */
  async testConnection() {
    if (!this._baseUrl) throw new Error('OTRS: Base-URL fehlt');
    if (!this._username || !this._password) throw new Error('OTRS: Credentials fehlen');
    const base = this._baseUrl.replace(/\/$/, '');
    const url  = `${base}/nph-genericinterface.pl/Webservice/${this._webService}/SessionCreate`;
    const { data } = await this._http.post(url, { UserLogin: this._username, Password: this._password }, {
      'Accept': 'application/json', 'Content-Type': 'application/json',
    });
    if (data?.Error) {
      const { ErrorCode, ErrorMessage } = data.Error;
      throw new Error(`OTRS Fehler ${ErrorCode}: ${ErrorMessage}`);
    }
    if (!data?.SessionID) {
      throw new Error('OTRS: SessionCreate ohne SessionID — WebService/Operation prüfen');
    }
  }

  /**
   * Internes Ticket → OTRS Generic Interface Payload.
   * OTRS-Spezifisch: Credentials im Body, nicht im Header.
   */
  mapToExternal(ticket) {
    const base = mapBaseFields(ticket);
    return {
      // OTRS Auth im Body — nicht im Header!
      UserLogin: this._username,
      Password:  this._password,

      Ticket: {
        Title:      base.title.slice(0, 200),
        Queue:      this._queue,
        Priority:   OTRS_PRIORITY[ticket.priority] || '3 normal',
        State:      OTRS_STATE[ticket.status]       || 'new',
        Type:       'Incident',
        CustomerID: base.analyst || 'soc-team',
        CustomerUser: base.analyst || '',
        // SOC-Referenz als Anhang ans Ticket
        PendingTime: {},
      },

      Article: {
        Subject:     base.title.slice(0, 200),
        Body:        this._buildArticleBody(ticket, base),
        ContentType: 'text/plain; charset=utf-8',
        ArticleType: 'note-internal',
        SenderType:  'agent',
        From:        `SOC Analyst <${base.analyst || 'soc@firma.de'}>`,
      },

      DynamicField: this._buildDynamicFields(ticket, base),
    };
  }

  validateExternalPayload(payload) {
    if (!payload.Ticket?.Title?.trim()) {
      throw new Error('OTRS: Ticket.Title ist Pflichtfeld');
    }
    if (!payload.Ticket?.Queue?.trim()) {
      throw new Error('OTRS: Ticket.Queue ist Pflichtfeld');
    }
    if (!payload.UserLogin?.trim()) {
      throw new Error('OTRS: UserLogin ist Pflichtfeld');
    }
  }

  /**
   * P12.3 ✅ — Ticket an OTRS Generic Interface senden.
   *
   * POST {baseUrl}/nph-genericinterface.pl/Webservice/{webService}/{operation}
   * Auth: Credentials im JSON-Body (OTRS-spezifisch, nicht HTTP Basic)
   * Response: { TicketID: '123', TicketNumber: 'TICKET-456' }
   *        or { Error: { ErrorCode, ErrorMessage } }
   */
  async sendTicket(ticket) {
    if (!this._baseUrl) throw new Error('OTRS: OTRS_BASE_URL ist nicht konfiguriert');
    if (!this._username || !this._password) throw new Error('OTRS: Credentials fehlen (OTRS_USERNAME / OTRS_PASSWORD)');

    const payload = this.mapToExternal(ticket);
    this.validateExternalPayload(payload);

    const url = this._buildUrl();

    // OTRS: kein Auth-Header — Credentials sind im Body
    const { data } = await this._http.post(url, payload, {
      'Accept':       'application/json',
      'Content-Type': 'application/json',
    });

    // OTRS sendet Fehler im Response-Body, nicht als HTTP-Status
    if (data?.Error) {
      const { ErrorCode, ErrorMessage } = data.Error;
      throw new Error(`OTRS Fehler ${ErrorCode}: ${ErrorMessage}`);
    }

    const ticketId     = data?.TicketID     || data?.ticketid;
    const ticketNumber = data?.TicketNumber || data?.ticketnumber;

    if (!ticketId) {
      throw new Error('OTRS: Unerwartete Antwort — TicketID fehlt');
    }

    return {
      externalId:  String(ticketId),
      externalRef: ticketNumber || String(ticketId),
      externalUrl: this._buildTicketUrl(ticketId),
      raw:         data,
    };
  }

  /**
   * P12.4 ✅ — Status eines bereits exportierten OTRS-Tickets aktualisieren.
   * TicketUpdate-Operation (Credentials im Body, OTRS-spezifisch).
   */
  async updateTicketStatus(externalId, status) {
    if (!this._baseUrl) throw new Error('OTRS: OTRS_BASE_URL ist nicht konfiguriert');
    if (!this._username || !this._password) throw new Error('OTRS: Credentials fehlen (OTRS_USERNAME / OTRS_PASSWORD)');
    if (!externalId) throw new Error('OTRS: externalId fehlt');

    const base = this._baseUrl.replace(/\/$/, '');
    const url  = `${base}/nph-genericinterface.pl/Webservice/${this._webService}/TicketUpdate`;
    const payload = {
      UserLogin: this._username,
      Password:  this._password,
      TicketID:  String(externalId),
      Ticket:    { State: OTRS_STATE[status] || 'open' },
    };

    const { data } = await this._http.post(url, payload, {
      'Accept':       'application/json',
      'Content-Type': 'application/json',
    });

    if (data?.Error) {
      const { ErrorCode, ErrorMessage } = data.Error;
      throw new Error(`OTRS Fehler ${ErrorCode}: ${ErrorMessage}`);
    }

    const ticketId = data?.TicketID || data?.ticketid || externalId;
    return { externalId: String(ticketId), externalStatus: OTRS_STATE[status] || 'open', raw: data };
  }

  _buildUrl() {
    const base = this._baseUrl.replace(/\/$/, '');
    return `${base}/nph-genericinterface.pl/Webservice/${this._webService}/${this._operation}`;
  }

  _buildTicketUrl(ticketId) {
    if (!this._baseUrl) return '';
    return `${this._baseUrl.replace(/\/$/, '')}/index.pl?Action=AgentTicketZoom;TicketID=${ticketId}`;
  }

  _buildArticleBody(ticket, base) {
    const lines = [
      'SOC Incident Report',
      '===================',
      `Ticket: ${base.internalRef}`,
      `Analyst: ${base.analyst}`,
      '',
      'Beschreibung:',
      base.description || '(keine Beschreibung)',
    ];
    if (base.mitre)    lines.push(`\nMITRE ATT&CK: ${base.mitre}`);
    if (base.sourceIp) lines.push(`Source IP: ${base.sourceIp}${ticket.srcFqdn ? ` (${ticket.srcFqdn})` : ''}`);
    if (base.destIp)   lines.push(`Dest IP: ${base.destIp}`);
    return lines.join('\n').trim();
  }

  _buildDynamicFields(ticket, base) {
    return [
      { Name: 'SOCInternalId', Value: base.internalId    },
      { Name: 'SOCRef',        Value: base.internalRef   },
      { Name: 'SOCMitre',      Value: base.mitre     || '' },
      { Name: 'SOCSourceIP',   Value: base.sourceIp  || '' },
      { Name: 'SOCDestIP',     Value: base.destIp    || '' },
      { Name: 'SOCAnalyst',    Value: base.analyst   || '' },
    ].filter(f => f.Value);
  }

  get operationUrl() { return this._buildUrl(); }
}

module.exports = { OTRSAdapter, OTRS_PRIORITY, OTRS_STATE };
