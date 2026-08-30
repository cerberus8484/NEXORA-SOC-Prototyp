'use strict';

/**
 * SystemStatsService — aggregierte DB-Kennzahlen für die native Status-Seite.
 * Eine zusammengefasste Zähl-Query (scalar) + Prioritäts-/State-Verteilung.
 * `query` ist die Pool-Query-Funktion (in Tests injizierbar).
 */
class SystemStatsService {
  constructor({ query, dbEnabled = true, poolSnapshot = null } = {}) {
    this._query = query;
    this._dbEnabled = dbEnabled;
    this._poolSnapshot = poolSnapshot;
  }

  async getStats() {
    if (!this._dbEnabled || !this._query) return { dbEnabled: false };

    const scalar = await this._query(`SELECT
      (SELECT count(*) FROM tickets)::int                                          AS tickets,
      (SELECT count(*) FROM tickets WHERE state='OPEN')::int                       AS tickets_open,
      (SELECT count(*) FROM evidence)::int                                         AS evidence,
      (SELECT count(*) FROM hunt_sessions)::int                                    AS hunts,
      (SELECT count(*) FROM hunt_findings)::int                                    AS findings,
      (SELECT count(*) FROM audit_log WHERE created_at > now() - interval '24 hours')::int AS audit_24h,
      (SELECT count(*) FROM wazuh_fp_exceptions)::int                              AS fp_exceptions,
      (SELECT count(*) FROM users)::int                                            AS users`);

    const prio  = await this._query("SELECT priority, count(*)::int AS n FROM tickets GROUP BY priority");
    const state = await this._query("SELECT state, count(*)::int AS n FROM tickets GROUP BY state");

    // Speicherplatz: DB-Gesamtgröße + größte Tabellen.
    const dbSize = await this._query("SELECT pg_database_size(current_database())::bigint AS bytes");
    const tables = await this._query(
      "SELECT relname AS name, pg_total_relation_size(relid)::bigint AS bytes FROM pg_stat_user_tables ORDER BY bytes DESC LIMIT 8");

    // Schreib-Aktivität pro Tag (audit_log = jede schreibende Aktion), letzte 14 Tage.
    const activity = await this._query(
      "SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, count(*)::int AS n "
      + "FROM audit_log WHERE created_at > now() - interval '14 days' GROUP BY 1 ORDER BY 1");

    const s = scalar.rows[0] || {};
    const pool = typeof this._poolSnapshot === 'function' ? this._poolSnapshot() : null;
    return {
      dbEnabled: true,
      counts: {
        tickets:      s.tickets ?? 0,
        ticketsOpen:  s.tickets_open ?? 0,
        evidence:     s.evidence ?? 0,
        hunts:        s.hunts ?? 0,
        findings:     s.findings ?? 0,
        audit24h:     s.audit_24h ?? 0,
        fpExceptions: s.fp_exceptions ?? 0,
        users:        s.users ?? 0,
      },
      byPriority: Object.fromEntries(prio.rows.map((r) => [r.priority, r.n])),
      byState:    Object.fromEntries(state.rows.map((r) => [r.state, r.n])),
      storage: {
        dbBytes: Number(dbSize.rows[0]?.bytes ?? 0),
        tables:  tables.rows.map((r) => ({ name: r.name, bytes: Number(r.bytes) })),
      },
      activity: activity.rows.map((r) => ({ day: r.day, writes: r.n })),
      pool: pool ? {
        total: Number(pool.total ?? 0),
        idle: Number(pool.idle ?? 0),
        waiting: Number(pool.waiting ?? 0),
        max: Number(pool.max ?? 0),
        saturated: Number(pool.waiting ?? 0) > 0 || (
          pool.max != null
          && Number(pool.max) > 0
          && Number(pool.total ?? 0) >= Number(pool.max)
          && Number(pool.idle ?? 0) === 0
        ),
      } : null,
    };
  }
}

module.exports = { SystemStatsService };
