'use strict';

// QRadar Dashboard Provider.
//
// Liest Offenses direkt aus der QRadar REST API sobald QRADAR_BASE_URL +
// QRADAR_TOKEN gesetzt sind. Auth: SEC-Header (API-Token, nicht User/Password).
// Fallback: fehlendes ENV oder API-Fehler → leere Daten, kein Crash (connected:false).
// TLS: QRADAR_TLS_REJECT_UNAUTHORIZED=true für Prod mit gültigem Zertifikat.
// QRadar REST API: https://ibmsecuritydocs.github.io/qradar_api_14.0/

const { RealHttpClient } = require('../../http/RealHttpClient');
const { mapSeverityToPriority, mapTimestamp } = require('./qradarMapper');

const TLS_REJECT_UNAUTHORIZED = process.env.QRADAR_TLS_REJECT_UNAUTHORIZED !== 'false';

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function strArray(v) { return Array.isArray(v) ? v.filter((x) => x != null).map(String) : []; }
function logSourceNames(raw) {
  if (Array.isArray(raw.log_source_names)) return strArray(raw.log_source_names);
  if (Array.isArray(raw.log_sources)) return raw.log_sources.map((s) => String(s && s.name != null ? s.name : s));
  return [];
}

/**
 * Rohe QRadar-Offense (snake_case REST-API) → QRadarOffense-DTO (camelCase) fürs Dashboard.
 * BUG-Fix: zuvor wurden die Roh-Felder ungemappt durchgereicht → das Frontend (camelCase)
 * zeigte alle Offense-Felder als „—". Alle Felder defaulten sicher (nie undefined).
 */
function mapOffenseDto(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id:          num(raw.id),
    offenseName: raw.offense_name != null ? String(raw.offense_name) : '',
    description: raw.description != null ? String(raw.description) : '',
    status:      raw.status || 'OPEN',
    priority:    mapSeverityToPriority(raw.severity, raw.credibility, raw.relevance),
    severity:    num(raw.severity),
    credibility: num(raw.credibility),
    relevance:   num(raw.relevance),
    magnitude:   num(raw.magnitude),
    categories:  strArray(raw.categories),
    eventCount:  num(raw.event_count),
    flowCount:   num(raw.flow_count),
    sourceCount: num(raw.source_count),
    sourceIps:   strArray(raw.source_addresses ?? raw.local_source_addresses),
    destIps:     strArray(raw.local_destination_addresses),
    assignedTo:  raw.assigned_to != null ? String(raw.assigned_to) : null,
    mitreT:      strArray(raw.mitre_techniques),
    logSources:  logSourceNames(raw),
    startTime:   raw.start_time != null ? mapTimestamp(raw.start_time) : '',
    lastUpdated: raw.last_updated_time != null ? mapTimestamp(raw.last_updated_time) : '',
  };
}

/** Rohes QRadar-Event → QRadarEvent-DTO (Frontend nutzt snake_case-Feldnamen). Best-effort. */
function mapEventDto(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const pick = (...keys) => { for (const k of keys) if (raw[k] != null) return raw[k]; return null; };
  const str = (v) => (v != null ? String(v) : null);
  const t = pick('starttime', 'devicetime', 'start_time', 'time');
  const port = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  return {
    time:       t != null ? mapTimestamp(t) : '',
    src_ip:     str(pick('sourceip', 'source_ip', 'src_ip')),
    dst_ip:     str(pick('destinationip', 'destination_ip', 'dst_ip')),
    src_port:   port(pick('sourceport', 'source_port', 'src_port')),
    dst_port:   port(pick('destinationport', 'destination_port', 'dst_port')),
    protocol:   str(pick('protocolname', 'protocol')),
    log_source: str(pick('logsourcename', 'log_source', 'logsource')) || '',
    category:   str(pick('categoryname', 'category')) || '',
    username:   str(pick('username', 'user')),
    message:    str(pick('message', 'qidname', 'qid_name', 'payload')) || '',
  };
}

const EMPTY_STATS = Object.freeze({
  openCount: 0,
  criticalCount: 0,
  highCount: 0,
  totalEvents: 0,
  bySeverity: Object.freeze({ critical: 0, high: 0, medium: 0, low: 0, info: 0 }),
  topCategories: Object.freeze([]),
});

// QRadar severity 1–10 → Kategorie (gleiche Schwellen wie der Mapper).
function classifySeverity(severity) {
  const sev = Number(severity) || 0;
  if (sev >= 9) return 'critical';
  if (sev >= 7) return 'high';
  if (sev >= 5) return 'medium';
  if (sev >= 3) return 'low';
  return 'info';
}

function aggregateTopCategories(offenses) {
  const counts = {};
  for (const o of offenses) {
    for (const cat of (o.categories || [])) counts[cat] = (counts[cat] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));
}

class QRadarDashboardProvider {
  /**
   * @param {{ http?: object }} opts — injizierter HTTP-Client (Tests).
   */
  constructor({ http = null } = {}) {
    this.key   = 'qradar';
    this._http = http || new RealHttpClient({ rejectUnauthorized: TLS_REJECT_UNAUTHORIZED, timeout: 10_000, ssrfProtection: true });
    // Layer 2: in der UI gesetzte Verbindung (DB > ENV). Leer = ENV greift.
    this._override = { baseUrl: '', token: '' };
  }

  /**
   * Layer 2: Verbindung zur Laufzeit setzen (Settings-UI). Leere Werte → ENV greift
   * wieder. Der Applier ruft dies beim Boot und nach jedem PUT.
   */
  reconfigure({ baseUrl = '', token = '' } = {}) {
    this._override = { baseUrl: String(baseUrl).replace(/\/+$/, ''), token: String(token) };
  }

  _effUrl()   { return this._override.baseUrl || (process.env.QRADAR_BASE_URL || '').replace(/\/+$/, ''); }
  _effToken() { return this._override.token   || process.env.QRADAR_TOKEN || ''; }

  /** Erst aktiv wenn Base-URL + Token gesetzt (Override ODER ENV). */
  isEnabled() {
    return !!(this._effUrl() && this._effToken());
  }

  _baseUrl()      { return this._effUrl(); }
  _authHeaders()  { return { SEC: this._effToken(), Accept: 'application/json' }; }

  /** Verbindungstest: leichter Offenses-Fetch (range 0-0). Fehler propagieren sichtbar. */
  async ping() {
    if (!this.isEnabled()) throw new Error('QRadar nicht konfiguriert');
    await this._http.request(`${this._baseUrl()}/api/siem/offenses?fields=id&range=0-0`, { headers: this._authHeaders() });
    return { ok: true };
  }

  /** Roh-Fetch (snake_case QRadar-API-Objekte) — Basis für getOffenses + getStats. */
  async _fetchRawOffenses(filter = 'OPEN') {
    if (!this.isEnabled()) return [];
    try {
      const statusFilter = filter === 'ALL' ? '' : 'filter=status%3DOPEN&';
      const url = `${this._baseUrl()}/api/siem/offenses?${statusFilter}fields=id,description,offense_name,severity,magnitude,credibility,relevance,status,start_time,last_updated_time,event_count,categories&sort=%2Blast_updated_time&range=0-99`;
      const res = await this._http.request(url, { headers: this._authHeaders() });
      return Array.isArray(res.data) ? res.data : [];
    } catch (err) {
      // Sichtbar machen: sonst sieht der Analyst ein LEERES Dashboard statt eines
      // QRadar-Fehlers (revoked Token/TLS/Timeout) — und übersieht evtl. echte Offenses.
      require('../../../logger').warn('qradar_offenses_fetch_failed', { message: err.message });
      return [];
    }
  }

  async getOffenses(filter = 'OPEN') {
    const raw = await this._fetchRawOffenses(filter);
    return raw.map(mapOffenseDto).filter(Boolean);
  }

  async getOffense(id) {
    if (!this.isEnabled() || !id) return null;
    try {
      const url = `${this._baseUrl()}/api/siem/offenses/${encodeURIComponent(id)}`;
      const res = await this._http.request(url, { headers: this._authHeaders() });
      return mapOffenseDto(res.data);
    } catch (err) {
      require('../../../logger').warn('qradar_offense_fetch_failed', { id, message: err.message });
      return null;
    }
  }

  async getOffenseEvents(id) {
    if (!this.isEnabled() || !id) return [];
    try {
      const url = `${this._baseUrl()}/api/siem/offenses/${encodeURIComponent(id)}/events?range=0-9`;
      const res = await this._http.request(url, { headers: this._authHeaders() });
      return Array.isArray(res.data) ? res.data.map(mapEventDto).filter(Boolean) : [];
    } catch (err) {
      require('../../../logger').warn('qradar_offense_events_fetch_failed', { id, message: err.message });
      return [];
    }
  }

  async getStats() {
    if (!this.isEnabled()) {
      return { ...EMPTY_STATS, bySeverity: { ...EMPTY_STATS.bySeverity }, topCategories: [], connected: false };
    }
    try {
      const offenses = await this._fetchRawOffenses('OPEN'); // Roh-Felder (severity/event_count) für die Aggregation
      const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
      let totalEvents = 0;
      for (const o of offenses) {
        bySeverity[classifySeverity(o.severity)] += 1;
        totalEvents += Number(o.event_count || 0);
      }
      return {
        openCount:     offenses.length,
        criticalCount: bySeverity.critical,
        highCount:     bySeverity.high,
        totalEvents,
        bySeverity,
        topCategories: aggregateTopCategories(offenses),
        connected:     true,
      };
    } catch (err) {
      // Sichtbar machen: connected:false sonst lautlos — der Analyst sähe leere
      // Stats statt eines echten QRadar-Fehlers (analog _fetchRawOffenses).
      require('../../../logger').warn('qradar_stats_failed', { message: err.message });
      return { ...EMPTY_STATS, bySeverity: { ...EMPTY_STATS.bySeverity }, topCategories: [], connected: false };
    }
  }
}

const qradarDashboardProvider = new QRadarDashboardProvider();

module.exports = { QRadarDashboardProvider, qradarDashboardProvider, mapOffenseDto, mapEventDto };
