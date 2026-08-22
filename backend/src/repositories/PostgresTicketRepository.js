'use strict';

const { TicketRepository } = require('./TicketRepository');
const { query }            = require('../db/pool');
const { Ticket }           = require('../domain/Ticket');

// ── FIELD_MAP — Single Source of Truth für Domain ↔ DB Mapping ────────────
//
// Flat fields: direkt auf DB-Spalte gemappt
// JSONB groups: Felder die in einer JSONB-Spalte gruppiert sind
//
// Neues Feld hinzufügen:
//   1. Ticket.js (Domain)
//   2. Migration (SQL)
//   3. Hier in FLAT_FIELDS oder in JSONB_GROUPS — fertig.

const FLAT_FIELDS = [
  { domain: 'ticketNr',   db: 'ticket_number' },
  { domain: 'offenseId',  db: 'offense_id'    },
  { domain: 'title',      db: 'title'         },
  { domain: 'category',   db: 'category'      },
  { domain: 'useCase',    db: 'use_case'       },
  { domain: 'priority',   db: 'priority'      },
  { domain: 'state',      db: 'state'         },
  { domain: 'status',     db: 'status'        },
  { domain: 'closeReason', db: 'close_reason' },
  { domain: 'analyst',    db: 'analyst'       },
  { domain: 'customer',   db: 'customer'      },
  { domain: 'source',     db: 'source'        },
  { domain: 'kind',       db: 'kind'          },
];

// Whitelist erlaubter Sortier-Felder → echte DB-Spalte.
// Verhindert "column does not exist" (Postgres lowercased unquotiertes createdAt)
// UND SQL-Injection über den sort-Parameter.
const SORT_COLUMNS = {
  createdAt:  'created_at',  created_at: 'created_at',
  updatedAt:  'updated_at',  updated_at: 'updated_at',
  priority:   'priority',
  state:      'state',
  status:     'status',
  title:      'title',
  alertCount: 'alert_count', alert_count: 'alert_count',
};

function sortColumn(sort) {
  return SORT_COLUMNS[sort] || 'created_at';
}

const JSONB_GROUPS = {
  identity: ['user','email','dept','manager','userType','accStatus'],
  network:  ['srcIp','srcFqdn','dstIp','dstFqdn','extIp','extFqdn','sensorIp','attackerIp',
             'mac','hostname','network','port','protocol','vpn',
             'bytesSent','bytesRecv',
             'pktsSent','pktsRecv','firewallAction','firstSeen','lastSeen','eventCount',
             'postNatSrc','postNatSrcFqdn','postNatDst','postNatDstFqdn'],
  asset:    ['os','assetTag','criticality','process','commandLine','hash','mitre'],
  analysis: ['description','iocs','logs','actions','recommendation','notes','decision','confidence'],
};

class PostgresTicketRepository extends TicketRepository {
  constructor({ queryFn = query } = {}) {
    super();
    this._query = queryFn;
  }

  // Fortlaufende, eindeutige Ticket-Nummer aus Postgres-Sequenz (race-frei).
  async nextTicketNumber() {
    const { rows } = await this._query("SELECT nextval('ticket_number_seq') AS n");
    return Number(rows[0].n);
  }

  // Domain-Ticket → DB-Row (nutzt FIELD_MAP)
  _toRow(ticket) {
    const row = { id: ticket.id };

    // Flache Felder
    for (const { domain, db } of FLAT_FIELDS) {
      row[db] = ticket[domain] || '';
    }
    row.occurred_at = ticket.datetime || null;
    row.alert_count = ticket.alertCount || 1; // numerisch — NICHT über FLAT_FIELDS (||'' bricht INT)
    row.parent_id   = ticket.parentId || null; // UUID — NULL statt '' (sonst bricht UUID-Spalte)

    // JSONB-Gruppen
    for (const [group, fields] of Object.entries(JSONB_GROUPS)) {
      row[group] = JSON.stringify(
        Object.fromEntries(fields.map(f => [f, f === 'confidence' ? (ticket.confidence ?? null) : (ticket[f] || '')]))
      );
    }

    // Relations (Arrays) — payloads trägt eingebettete Payload-Objekte
    // (Editor-Parität); Alt-Rows enthalten '[]' (payloadIds war nie befüllt).
    row.payloads       = JSON.stringify(ticket.payloads        || []);
    row.ti_entries     = JSON.stringify(ticket.tiEntries       || []);
    row.analyst_state  = JSON.stringify(ticket.analystState    || {});
    row.evidence       = JSON.stringify(ticket.evidenceIds     || []);
    row.external_links = JSON.stringify(ticket.externalLinkIds || []);

    // Timestamps
    row.created_at = ticket.createdAt;
    row.updated_at = ticket.updatedAt;
    // Echter Close-Zeitpunkt (Audit #1) — NULL solange offen. Das Domain-Modell
    // hält closedAt bereits konsistent zum state; hier nur durchreichen.
    row.closed_at  = ticket.closedAt || null;

    return row;
  }

  // DB-Row → Domain-Ticket (nutzt FIELD_MAP)
  _fromRow(row) {
    if (!row) return null;

    const data = { id: row.id };

    // Flache Felder
    for (const { domain, db } of FLAT_FIELDS) {
      data[domain] = row[db] || '';
    }
    data.datetime   = row.occurred_at?.toISOString() || '';
    data.alertCount = row.alert_count ?? 1;
    data.parentId   = row.parent_id || '';

    // JSONB-Gruppen entpacken
    for (const [group, fields] of Object.entries(JSONB_GROUPS)) {
      const src = row[group] || {};
      for (const f of fields) {
        data[f] = f === 'confidence' ? (src.confidence ?? null) : (src[f] || '');
      }
    }

    // Relations
    data.payloads        = row.payloads        || [];
    data.tiEntries       = row.ti_entries      || [];
    data.analystState    = row.analyst_state   || {};
    data.evidenceIds     = row.evidence        || [];
    data.externalLinkIds = row.external_links  || [];

    // Timestamps
    data.createdAt = row.created_at?.toISOString();
    data.updatedAt = row.updated_at?.toISOString();
    // closed_at kann NULL sein (offenes Ticket) → null. pg liefert ein Date;
    // defensiv auch String zulassen (→ normalisiert auf ISO).
    data.closedAt  = row.closed_at
      ? (typeof row.closed_at.toISOString === 'function' ? row.closed_at.toISOString() : new Date(row.closed_at).toISOString())
      : null;

    return new Ticket(data);
  }

  async save(ticket) {
    const r = this._toRow(ticket);
    await this._query(`
      INSERT INTO tickets (
        id, ticket_number, offense_id, title, category, use_case,
        priority, state, status, close_reason, analyst, customer, source, occurred_at, alert_count, kind, parent_id,
        identity, network, asset, analysis,
        payloads, ti_entries, analyst_state, evidence, external_links,
        created_at, updated_at, closed_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
        $18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29
      )
      ON CONFLICT (id) DO UPDATE SET
        ticket_number  = EXCLUDED.ticket_number,
        offense_id     = EXCLUDED.offense_id,
        title          = EXCLUDED.title,
        category       = EXCLUDED.category,
        use_case       = EXCLUDED.use_case,
        priority       = EXCLUDED.priority,
        state          = EXCLUDED.state,
        status         = EXCLUDED.status,
        close_reason   = EXCLUDED.close_reason,
        analyst        = EXCLUDED.analyst,
        customer       = EXCLUDED.customer,
        source         = EXCLUDED.source,
        occurred_at    = EXCLUDED.occurred_at,
        alert_count    = EXCLUDED.alert_count,
        kind           = EXCLUDED.kind,
        parent_id      = EXCLUDED.parent_id,
        identity       = EXCLUDED.identity,
        network        = EXCLUDED.network,
        asset          = EXCLUDED.asset,
        analysis       = EXCLUDED.analysis,
        payloads       = EXCLUDED.payloads,
        ti_entries     = EXCLUDED.ti_entries,
        analyst_state  = EXCLUDED.analyst_state,
        evidence       = EXCLUDED.evidence,
        external_links = EXCLUDED.external_links,
        updated_at     = NOW(),
        closed_at      = EXCLUDED.closed_at
    `, [
      r.id, r.ticket_number, r.offense_id, r.title, r.category, r.use_case,
      r.priority, r.state, r.status, r.close_reason, r.analyst, r.customer, r.source, r.occurred_at, r.alert_count, r.kind, r.parent_id,
      r.identity, r.network, r.asset, r.analysis,
      r.payloads, r.ti_entries, r.analyst_state, r.evidence, r.external_links,
      r.created_at, r.updated_at, r.closed_at,
    ]);
    return this.findById(r.id);
  }

  async findById(id) {
    const result = await this._query('SELECT * FROM tickets WHERE id = $1', [id]);
    return this._fromRow(result.rows[0]);
  }

  async findAll({ state, status, priority, source, analyst, customer, search, limit = 50, offset = 0, sort = 'created_at', order = 'desc' } = {}) {
    const conditions = [];
    const params     = [];
    let   p          = 1;

    if (state)    { conditions.push(`state = $${p++}`);    params.push(state);    }
    if (status)   { conditions.push(`status = $${p++}`);   params.push(status);   }
    if (priority) { conditions.push(`priority = $${p++}`); params.push(priority); }
    if (source)   { conditions.push(`source = $${p++}`);   params.push(source);   }
    if (analyst)  { conditions.push(`analyst = $${p++}`);  params.push(analyst);  }
    if (customer) { conditions.push(`customer = $${p++}`); params.push(customer); }
    if (search) {
      conditions.push(`to_tsvector('english', title || ' ' || analyst || ' ' || ticket_number || ' ' || offense_id) @@ plainto_tsquery('english', $${p++})`);
      params.push(search);
    }

    const where    = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderSql = `ORDER BY ${sortColumn(sort)} ${order === 'asc' ? 'ASC' : 'DESC'}`;

    const countResult = await this._query(`SELECT COUNT(*) FROM tickets ${where}`, params);
    const total       = parseInt(countResult.rows[0].count, 10);

    params.push(limit, offset);
    const dataResult = await this._query(
      `SELECT * FROM tickets ${where} ${orderSql} LIMIT $${p++} OFFSET $${p++}`,
      params
    );

    return {
      data:   dataResult.rows.map(r => this._fromRow(r)),
      total,
      limit,
      offset,
    };
  }

  async findByOffense(source, offenseId) {
    if (!source || !offenseId) return null;
    const result = await this._query(
      `SELECT * FROM tickets
        WHERE source = $1 AND offense_id = $2 AND state = 'OPEN'
        ORDER BY created_at DESC
        LIMIT 1`,
      [source, offenseId]
    );
    return this._fromRow(result.rows[0]);
  }

  // Anti-Flood-Dedup: offenes Ticket desselben (source, srcIp, dstIp, category).
  // srcIp/dstIp liegen in der network-JSONB → über ->> abgefragt.
  async findOpenByEndpoints(source, { srcIp, dstIp, category } = {}) {
    if (!source || !srcIp || !dstIp || !category) return null;
    const result = await this._query(
      `SELECT * FROM tickets
        WHERE source = $1 AND state = 'OPEN' AND category = $2
          AND network->>'srcIp' = $3 AND network->>'dstIp' = $4
        ORDER BY created_at DESC
        LIMIT 1`,
      [source, category, srcIp, dstIp]
    );
    return this._fromRow(result.rows[0]);
  }

  // Vorhandene, noch elternlose Child-Offenses eines Hosts unter den Case hängen.
  async assignParentByAgent(agentId, parentId) {
    if (!agentId || !parentId) return 0;
    const res = await this._query(
      `UPDATE tickets SET parent_id = $1
         WHERE source = 'wazuh' AND kind = 'alert' AND parent_id IS NULL
           AND offense_id LIKE '%:agent:' || $2`,
      [parentId, agentId]
    );
    return res.rowCount;
  }

  // Cross-Reference: Tickets die den Indikator in network/analysis (JSONB) enthalten.
  async findByIndicator(value, excludeId = null) {
    const pattern = `%${value}%`;
    const rows = excludeId
      ? (await this._query(
          `SELECT id, ticket_number, title, priority, state, status, created_at
             FROM tickets
             WHERE (network::text ILIKE $1 OR analysis::text ILIKE $1) AND id <> $2
             ORDER BY created_at DESC LIMIT 50`,
          [pattern, excludeId]
        )).rows
      : (await this._query(
          `SELECT id, ticket_number, title, priority, state, status, created_at
             FROM tickets
             WHERE network::text ILIKE $1 OR analysis::text ILIKE $1
             ORDER BY created_at DESC LIMIT 50`,
          [pattern]
        )).rows;
    return rows.map((r) => ({
      id: r.id, ticketNr: r.ticket_number, title: r.title,
      priority: r.priority, state: r.state, status: r.status,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    }));
  }

  // Alert-Historie eines Hosts: agentId via offense_id, hostname via network JSONB.
  async findByHost({ agentId = '', hostname = '', limit = 20 } = {}) {
    const conditions = [];
    const params = [];
    let p = 1;
    if (agentId)  { conditions.push(`offense_id LIKE '%:agent:' || $${p++}`); params.push(agentId); }
    if (hostname) { conditions.push(`network->>'hostname' ILIKE $${p++}`);   params.push(hostname); }
    if (!conditions.length) return [];
    params.push(limit);
    const { rows } = await this._query(
      `SELECT id, ticket_number, title, priority, state, status,
              asset->>'mitre' AS mitre, offense_id,
              analysis->>'description' AS description, created_at
         FROM tickets
         WHERE ${conditions.join(' OR ')}
         ORDER BY created_at DESC LIMIT $${p}`,
      params
    );
    return rows.map((r) => ({
      id: r.id, ticketNr: r.ticket_number, title: r.title, priority: r.priority,
      state: r.state, status: r.status, mitre: r.mitre || '',
      offenseId: r.offense_id, description: r.description || '',
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    }));
  }

  // Child-Tickets eines Parent-Cases — neueste zuerst, begrenzt.
  async findChildren(parentId, { limit = 200 } = {}) {
    if (!parentId) return [];
    const { rows } = await this._query(
      'SELECT * FROM tickets WHERE parent_id = $1 ORDER BY created_at DESC LIMIT $2',
      [parentId, limit]
    );
    return rows.map((r) => this._fromRow(r));
  }

  async delete(id) {
    await this._query('DELETE FROM tickets WHERE id = $1', [id]);
  }

  // Sammel-Löschung in EINEM atomaren Statement (transaktional, ein Round-Trip,
  // bounded durch das Route-Schema). RETURNING id liefert die tatsächlich
  // gelöschten IDs → nachvollziehbares Ergebnis (deleted/missing).
  async deleteMany(ids = []) {
    if (!ids.length) return { deletedIds: [] };
    const { rows } = await this._query('DELETE FROM tickets WHERE id = ANY($1::uuid[]) RETURNING id', [ids]);
    return { deletedIds: rows.map((r) => r.id) };
  }

  // Ingestion-Aktivität je Quelle (echte Ticket-Daten) — Parität zur (getesteten)
  // InMemory-Aggregation. SERVERSEITIG via GROUP BY, kein Vollscan in Node.
  // ⚠️ LIVE-GATE: gegen realistische Daten via EXPLAIN verifizieren (kein lokaler DB-Test).
  async ingestActivityBySource({ windowHours = 24 } = {}) {
    const h = Math.max(1, Math.min(Number(windowHours) || 24, 24 * 90));
    const res = await this._query(`
      SELECT COALESCE(NULLIF(TRIM(source), ''), 'unknown') AS source,
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE created_at >= now() - make_interval(hours => $1))::int AS recent,
             MAX(created_at) AS last_seen
        FROM tickets
       GROUP BY 1
       ORDER BY total DESC`, [h]);
    return res.rows.map((r) => ({
      source:   r.source,
      total:    r.total,
      recent:   r.recent,
      lastSeen: r.last_seen ? new Date(r.last_seen).toISOString() : null,
    }));
  }

  // ── P_STABILITY_2 · 3.3 — SOC-Metriken SERVERSEITIG aggregieren ───────────────
  // Mehrere KLEINE Aggregat-Queries statt eines Ticket-Vollscans in Node → kein
  // großer Heap-Load. Liefert dieselbe Form wie domain/socMetricsAggregate.
  // ⚠️ LIVE-GATE: gegen realistische Daten via EXPLAIN + Parität zur (getesteten)
  // InMemory-Aggregation verifizieren, BEVOR deployt wird (kein lokaler DB-Test möglich).
  async aggregateMetrics({ topN = 10, since = null } = {}) {
    const n = Math.max(1, Math.min(Number(topN) || 10, 100));

    // Zeitraumfilter (Audit #2): optionales `since` (ISO) → nur Tickets mit
    // created_at >= since. `since` als $-Parameter (kein String-Splicing → keine
    // SQL-Injection). Ungültiges `since` fängt der Aufrufer (Route) ab.
    const sinceIso = since ? new Date(since).toISOString() : null;
    const where = sinceIso ? 'WHERE created_at >= $S' : '';
    // Query-Builder: hängt `since` als letzten Parameter an und ersetzt $S.
    const q = (sql, params = []) => {
      if (!sinceIso) return this._query(sql.replace('$S', ''), params);
      const idx = params.length + 1;
      return this._query(sql.replace('$S', `$${idx}`), [...params, sinceIso]);
    };
    const andSince = sinceIso ? 'AND created_at >= $S' : '';

    // FP-Rate-Nenner (Audit #3): NUR klassifiziert geschlossene Tickets
    // (close_reason <> ''). Ein CLOSED-Ticket ohne Schliessgrund ist nicht
    // klassifiziert → gehört nicht in die FP/nicht-FP-Grundgesamtheit.
    const counts = await q(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE state = 'CLOSED' AND COALESCE(close_reason,'') <> '')::int AS classified,
             COUNT(*) FILTER (WHERE state = 'CLOSED' AND close_reason = 'false_positive')::int AS fp
        FROM tickets ${where}`);
    // MTTR (Audit #1): closed_at − created_at, nicht updated_at. Tickets ohne
    // closed_at (Altbestand ohne Backfill / inkonsistent) zählen NICHT mit.
    const mttr = await q(`
      SELECT AVG(EXTRACT(EPOCH FROM (closed_at - created_at)) * 1000) AS mean_ms,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (closed_at - created_at)) * 1000) AS median_ms,
             COUNT(*)::int AS sample
        FROM tickets
       WHERE state = 'CLOSED' AND closed_at IS NOT NULL AND closed_at >= created_at ${andSince}`);
    const byState  = await q(`SELECT COALESCE(NULLIF(state,''), '_unset')  AS k, COUNT(*)::int AS c FROM tickets ${where} GROUP BY 1`);
    const byStatus = await q(`SELECT COALESCE(NULLIF(status,''), '_unset') AS k, COUNT(*)::int AS c FROM tickets ${where} GROUP BY 1`);
    const top = await q(`
      SELECT CASE WHEN offense_id ~ '^rule:[0-9]+' THEN substring(offense_id FROM '^rule:[0-9]+') ELSE offense_id END AS k,
             COUNT(*)::int AS c
        FROM tickets WHERE COALESCE(offense_id,'') <> '' ${andSince}
       GROUP BY 1 ORDER BY c DESC LIMIT $1`, [n]);
    const analyst = await q(`
      SELECT COALESCE(NULLIF(analyst,''), '_unassigned') AS analyst,
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE state = 'OPEN')::int AS open
        FROM tickets ${where ? where : ''} GROUP BY 1 ORDER BY total DESC LIMIT $1`, [n]);

    const c = counts.rows[0];
    const m = mttr.rows[0];
    return {
      mttr: m.sample > 0
        ? { meanMs: Math.round(Number(m.mean_ms)), medianMs: Math.round(Number(m.median_ms)), sampleSize: m.sample }
        : { meanMs: null, medianMs: null, sampleSize: 0 },
      // Nenner = klassifiziert geschlossene Tickets (close_reason<>''), damit die
      // FP-Rate ehrlich ist (Audit #3). fpCount = darunter false_positive.
      fpRate: c.classified > 0
        ? { rate: c.fp / c.classified, fpCount: c.fp, classifiedCount: c.classified }
        : { rate: null, fpCount: 0, classifiedCount: 0 },
      byState:  Object.fromEntries(byState.rows.map((r) => [r.k, r.c])),
      byStatus: Object.fromEntries(byStatus.rows.map((r) => [r.k, r.c])),
      topRules: top.rows.map((r) => ({ key: r.k, count: r.c })),
      analystLoad: analyst.rows.map((r) => ({ analyst: r.analyst, total: r.total, open: r.open })),
      // SQL-Aggregation scannt NICHT in Node → kein Stichproben-Cap nötig.
      meta: { totalTickets: c.total, sampledTickets: c.total, capped: false, since: sinceIso },
    };
  }
}

module.exports = { PostgresTicketRepository, FLAT_FIELDS, JSONB_GROUPS, SORT_COLUMNS, sortColumn };
