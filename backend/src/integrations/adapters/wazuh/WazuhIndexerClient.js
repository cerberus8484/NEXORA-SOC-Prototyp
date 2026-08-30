'use strict';

const { RealHttpClient } = require('../../http/RealHttpClient');

// Severity-Bänder nach rule.level (Wazuh). Tunebar; Default-Konvention:
//   critical >= 12 · high 8–11 · medium 4–7 · low 0–3
const SEV = {
  critical: { gte: 12 },
  high:     { gte: 8, lt: 12 },
  medium:   { gte: 4, lt: 8 },
  low:      { lt: 4 },
};
// Gruppen, die wir als Threat-Intel-Treffer werten (best-effort, ohne eigenen TI-Service).
const TI_GROUPS = ['virustotal', 'threat_intel', 'threatintel', 'ti'];
// Firewall-Events: OPNsense filterlog läuft über den pfSense-Decoder —
// rule.groups ist im Live-Index 'pfsense' (verifiziert 2026-06-11).
const FW_GROUPS = ['pfsense', 'firewall', 'pf', 'opnsense'];
// Windows-Defender-Kanal: rule.groups 'windows_defender' (Live-Index verifiziert);
// Events 1116 Malware erkannt / 1117 Aktion ausgeführt.
const DEFENDER_GROUPS = ['windows_defender'];
// WEF-Collector-Agents: deren EventChannel-Events mit fremdem Quell-Computer
// zählen als „forwarded". location ist im Live-Index nur 'EventChannel' —
// darum der Umweg über agent.name + data.win.system.computer.
const WEF_COLLECTORS = ['WEC01'];
// Wazuh-interne Agent-Buffer-Regeln: ein voller Event-Puffer heißt, der Agent
// verwirft gleich Events → blinder Fleck auf dem Host.
//   202 = Queue ≥ X% voll (Warnung) · 203 = Buffer geflutet (Events verworfen).
const AGENT_BUFFER_WARN_RULE = '202';
const AGENT_BUFFER_FULL_RULE = '203';
const AGENT_BUFFER_RULES = [AGENT_BUFFER_WARN_RULE, AGENT_BUFFER_FULL_RULE];

// Honeypot-Session-Fetch (Slice 2b.1): enges Zeitfenster + harte Obergrenze,
// damit wiederkehrende Scans desselben Angreifers keine fremden Cowrie-Sessions
// ins Ticket ziehen. HP_SESSION_MAX_SIZE ist die dokumentierte Kappung.
const HP_SESSION_BUFFER_MS = 15 * 60 * 1000;   // ±15 min um das Ticket-/Flow-Fenster
const HP_SESSION_DEFAULT_SIZE = 500;
const HP_SESSION_MAX_SIZE = 1000;

// Firewall-Kandidaten-Fetch (Slice 3b): etwas weiteres Fenster als das Engine-Match-Fenster,
// damit die reine Engine danach präzise filtert. Harte Obergrenze.
const FW_FLOW_BUFFER_MS = 5 * 60 * 1000;       // ±5 min
const FW_FLOW_DEFAULT_SIZE = 200;
const FW_FLOW_MAX_SIZE = 1000;

// TLS-Validierung per ENV konfigurierbar (shared mit WazuhApiClient via derselben Variable).
// Default false für Lab-Kompatibilität. In Produktion auf 'true' setzen.
const WAZUH_TLS_REJECT_UNAUTHORIZED = process.env.WAZUH_TLS_REJECT_UNAUTHORIZED === 'true';

/**
 * WazuhIndexerClient — Read-only-Aggregationen über die Wazuh-Indexer-Alerts
 * (OpenSearch, Index-Pattern `wazuh-alerts-*`, Port 9200).
 *
 * Auth: HTTP Basic (admin) pro Request. Self-signed → rejectUnauthorized per ENV.
 * Über HttpClient-Abstraktion testbar (InMemoryHttpClient).
 */
class WazuhIndexerClient {
  constructor({ url = '', user = '', password = '', index = 'wazuh-alerts-*', vulnIndex = 'wazuh-states-vulnerabilities-*', http = null } = {}) {
    this._url   = String(url).replace(/\/+$/, '');
    this._user  = user;
    this._pass  = password;
    this._index = index;
    this._vulnIndex = vulnIndex;
    this._http  = http || new RealHttpClient({ rejectUnauthorized: WAZUH_TLS_REJECT_UNAUTHORIZED, timeout: 12_000 });
  }

  isEnabled() { return Boolean(this._url && this._user && this._pass); }

  /** Layer 2: Verbindung zur Laufzeit ändern (Settings-UI). Basic-Auth pro Request → kein Token-Cache.
   *  Übernimmt ALLE veränderlichen Felder der Instanz; index/vulnIndex behalten ihren
   *  bisherigen Wert, wenn sie im Patch fehlen (PoLA: die Methode überrascht nicht mit
   *  stillschweigend verschluckten Feldern). */
  reconfigure({ url = '', user = '', password = '', index, vulnIndex } = {}) {
    this._url  = String(url).replace(/\/+$/, '');
    this._user = user;
    this._pass = password;
    if (index !== undefined)     this._index = index;
    if (vulnIndex !== undefined) this._vulnIndex = vulnIndex;
  }

  /** Verbindungstest: Root-Endpoint mit Basic-Auth. Fehler propagieren sichtbar. */
  async ping() {
    if (!this.isEnabled()) throw new Error('Wazuh-Indexer nicht konfiguriert');
    const basic = Buffer.from(`${this._user}:${this._pass}`).toString('base64');
    await this._http.request(`${this._url}/`, {
      method: 'GET', headers: { Authorization: `Basic ${basic}` },
    });
    return { ok: true };
  }

  // Suche auf einem beliebigen Index (für den Vulnerabilities-State-Index).
  async _searchOn(index, body) {
    const basic = Buffer.from(`${this._user}:${this._pass}`).toString('base64');
    const res = await this._http.request(
      `${this._url}/${encodeURIComponent(index)}/_search`,
      { method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' }, body },
    );
    return res.data || {};
  }

  /**
   * CVE-Befunde eines Agents aus `wazuh-states-vulnerabilities-*`:
   * Counts je Severity + die schwersten CVEs (nach Base-Score). Posture-Signal
   * für den Host-Risk-Score. Gibt null zurück, wenn der Indexer nicht konfiguriert ist.
   */
  async agentVulnerabilities(agentId, { topN = 8 } = {}) {
    if (!this.isEnabled() || !agentId) return null;
    const body = {
      size: topN,
      query: { bool: { filter: [{ term: { 'agent.id': String(agentId) } }] } },
      _source: ['vulnerability.id', 'vulnerability.severity', 'vulnerability.score', 'package.name', 'package.version'],
      sort: [{ 'vulnerability.score.base': { order: 'desc', missing: '_last' } }],
      aggs: { sev: { terms: { field: 'vulnerability.severity', size: 12 } } },
    };
    let d;
    try { d = await this._searchOn(this._vulnIndex, body); } catch { return null; }
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const b of (d.aggregations?.sev?.buckets || [])) {
      const key = String(b.key).toLowerCase();
      if (key in counts) counts[key] = b.doc_count;
    }
    const total = d.hits?.total?.value ?? (counts.critical + counts.high + counts.medium + counts.low);
    const topCves = (d.hits?.hits || []).map((h) => ({
      cve:      h._source?.vulnerability?.id,
      severity: h._source?.vulnerability?.severity,
      score:    h._source?.vulnerability?.score?.base ?? null,
      package:  h._source?.package?.name,
      version:  h._source?.package?.version,
    })).filter((c) => c.cve);
    return { ...counts, total, topCves };
  }

  async _search(body) {
    const basic = Buffer.from(`${this._user}:${this._pass}`).toString('base64');
    const res = await this._http.request(
      `${this._url}/${encodeURIComponent(this._index)}/_search`,
      { method: 'POST', headers: { Authorization: `Basic ${basic}` }, body },
    );
    return res.data || {};
  }

  static _rangeQuery(gte, lt) {
    const ts = { gte };
    if (lt) ts.lt = lt;
    return { range: { '@timestamp': ts } };
  }

  /** Trefferzahl (size:0) für ein Zeitfenster + optionale Zusatzfilter. */
  async _count(gte, lt, extraFilters = []) {
    const body = {
      size: 0, track_total_hits: true,
      query: { bool: { filter: [WazuhIndexerClient._rangeQuery(gte, lt), ...extraFilters] } },
    };
    const r = await this._search(body);
    return r.hits?.total?.value ?? 0;
  }

  async _kpis() {
    const sevCritical = { range: { 'rule.level': SEV.critical } };
    const tiFilter    = { terms: { 'rule.groups': TI_GROUPS } };
    const [
      alertsToday, alertsPrevDay, critToday, critPrevDay, ruleMatches24h, tiMatches24h,
    ] = await Promise.all([
      this._count('now/d', null),
      this._count('now-1d/d', 'now/d'),
      this._count('now/d', null, [sevCritical]),
      this._count('now-1d/d', 'now/d', [sevCritical]),
      this._count('now-24h', null),
      this._count('now-24h', null, [tiFilter]),
    ]);
    const pct = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);
    return {
      alertsToday, alertsTodayDeltaPct: pct(alertsToday, alertsPrevDay),
      critical: critToday, criticalDeltaPct: pct(critToday, critPrevDay),
      ruleMatches: ruleMatches24h,
      threatIntelMatches: tiMatches24h,
    };
  }

  async _timeSeries() {
    const body = {
      size: 0, query: WazuhIndexerClient._rangeQuery('now-24h', null),
      aggs: { over_time: { date_histogram: { field: '@timestamp', fixed_interval: '1h', min_doc_count: 0 } } },
    };
    const r = await this._search(body);
    return (r.aggregations?.over_time?.buckets || []).map((b) => ({ t: b.key_as_string || b.key, count: b.doc_count }));
  }

  async _severity() {
    const body = {
      size: 0, query: WazuhIndexerClient._rangeQuery('now-24h', null),
      aggs: {
        sev: {
          filters: {
            filters: {
              critical: { range: { 'rule.level': SEV.critical } },
              high:     { range: { 'rule.level': SEV.high } },
              medium:   { range: { 'rule.level': SEV.medium } },
              low:      { range: { 'rule.level': SEV.low } },
            },
          },
        },
      },
    };
    const r = (await this._search(body)).aggregations?.sev?.buckets || {};
    return {
      critical: r.critical?.doc_count ?? 0,
      high:     r.high?.doc_count ?? 0,
      medium:   r.medium?.doc_count ?? 0,
      low:      r.low?.doc_count ?? 0,
    };
  }

  async _recentAlerts(size = 8) {
    const body = {
      size, sort: [{ '@timestamp': 'desc' }],
      _source: ['@timestamp', 'rule.id', 'rule.level', 'rule.description', 'agent.name', 'data.srcip', 'data.dstip'],
      query: WazuhIndexerClient._rangeQuery('now-24h', null),
    };
    const hits = (await this._search(body)).hits?.hits || [];
    return hits.map((h) => {
      const s = h._source || {};
      const level = s.rule?.level ?? 0;
      const severity = level >= 12 ? 'critical' : level >= 8 ? 'high' : level >= 4 ? 'medium' : 'low';
      return {
        time: s['@timestamp'],
        ruleId: s.rule?.id,
        level,
        severity,
        description: s.rule?.description,
        host: s.agent?.name,
        srcIp: s.data?.srcip || null,
        dstIp: s.data?.dstip || null,
      };
    });
  }

  async _termsAgg(field, size, subField) {
    const aggs = { top: { terms: { field, size } } };
    if (subField) aggs.top.aggs = { sub: { terms: { field: subField, size: 3 } } };
    const body = { size: 0, query: WazuhIndexerClient._rangeQuery('now-24h', null), aggs };
    const r = await this._search(body);
    return r.aggregations?.top?.buckets || [];
  }

  async _topTactics() {
    const total = await this._count('now-24h', null);
    const buckets = await this._termsAgg('rule.mitre.tactic', 5, 'rule.mitre.id');
    return buckets.map((b) => ({
      tactic: b.key,
      count: b.doc_count,
      pct: total > 0 ? Math.round((b.doc_count / total) * 1000) / 10 : 0,
      techniques: (b.sub?.buckets || []).map((t) => t.key),
    }));
  }

  async _topHosts() {
    return (await this._termsAgg('agent.name', 5)).map((b) => ({ host: b.key, count: b.doc_count }));
  }

  async _topSourceIps() {
    // Reputation bleibt 'unknown' bis Threat-Intel-Service (P17) — kein Fake-Label.
    return (await this._termsAgg('data.srcip', 6)).map((b) => ({ ip: b.key, count: b.doc_count, reputation: 'unknown' }));
  }

  /**
   * Flow-/Event-Timeline für ein Ticket: alle Alerts dieser Offense (rule.id + src/agent)
   * über die letzten {days} Tage. Liefert Einzel-Events + Aggregate (first/last/count/ports/actions).
   */
  // Flow-Relevanz: nur Events, die der CE-3-Normalizer zu einem Flow macht
  // (Firewall src/dst-IP ODER Sysmon Event 3 / NetworkConnect). Für Host-Cases
  // (kein ruleId) genutzt, damit Nicht-Flow-Events eines busy Hosts (WMI/FileCreate)
  // ältere Sysmon-E3-Flows nicht aus dem size-Fenster verdrängen.
  static _flowRelevanceQuery() {
    return { bool: { should: [
      { exists: { field: 'data.srcip' } },
      { exists: { field: 'data.dstip' } },
      { term:   { 'data.win.system.eventID': '3' } },
      { exists: { field: 'data.win.eventdata.sourceIp' } },
      { exists: { field: 'data.win.eventdata.destinationIp' } },
      // Cowrie-Honeypot (Slice 2b.4): JEDES cowrie.*-Event ist flow-relevant — die real
      // indexierten eventids sind login/command/client.version (KEIN connect/closed).
      { prefix: { 'data.eventid': 'cowrie.' } },
    ], minimum_should_match: 1 } };
  }

  async ticketFlows({ ruleId, srcIp, agentId, size = 50, days = 30, flowOnly = false } = {}) {
    if (!this.isEnabled()) return null;
    const filter = [WazuhIndexerClient._rangeQuery(`now-${days}d`, null)];
    if (ruleId) filter.push({ term: { 'rule.id': String(ruleId) } });
    // Host-Case: gezielt nur flow-relevante Events holen (rule-scoped bleibt unverändert).
    if (flowOnly) filter.push(WazuhIndexerClient._flowRelevanceQuery());
    const should = [];
    if (srcIp)   should.push({ term: { 'data.srcip': srcIp } });
    if (agentId) should.push({ term: { 'agent.id': String(agentId) } });

    const body = {
      size, track_total_hits: true, sort: [{ '@timestamp': 'desc' }],
      _source: ['@timestamp', 'rule.id', 'rule.level', 'rule.description', 'agent.name', 'agent.id',
        'data.srcip', 'data.dstip', 'data.srcport', 'data.dstport', 'data.protocol', 'data.action',
        // Cowrie-Honeypot (Slice 1): Session-Flow-Felder für den CE-3 Flow-Normalizer.
        // src_ip/dst_ip mit Unterstrich; session/sensor/duration/timestamp für Extras.
        'data.eventid', 'data.src_ip', 'data.src_port', 'data.dst_ip', 'data.dst_port',
        'data.session', 'data.sensor', 'data.duration', 'data.timestamp',
        // Sysmon Event 3 (NetworkConnect) — Felder für den CE-3 Flow-Normalizer.
        // computer = meldender Host (CE-4.4 sourceFqdn); initiated = Richtung + source-seitiger FQDN-Gate.
        'data.win.system.eventID', 'data.win.system.computer',
        'data.win.eventdata.sourceIp', 'data.win.eventdata.sourcePort',
        'data.win.eventdata.destinationIp', 'data.win.eventdata.destinationPort',
        'data.win.eventdata.protocol', 'data.win.eventdata.image', 'data.win.eventdata.initiated',
        'data.win.eventdata.processId', 'data.win.eventdata.processGuid',
        'data.win.eventdata.user', 'data.win.eventdata.utcTime'],
      query: { bool: { filter, ...(should.length ? { should, minimum_should_match: 1 } : {}) } },
      aggs: {
        first: { min: { field: '@timestamp' } },
        last:  { max: { field: '@timestamp' } },
        dstports: { terms: { field: 'data.dstport', size: 6 } },
        actions:  { terms: { field: 'data.action', size: 4 } },
      },
    };
    const r = await this._search(body);
    const hits = r.hits?.hits || [];
    const a = r.aggregations || {};
    return {
      count:    r.hits?.total?.value ?? hits.length,
      first:    a.first?.value_as_string || null,
      last:     a.last?.value_as_string || null,
      dstPorts: (a.dstports?.buckets || []).map((b) => ({ port: b.key, count: b.doc_count })),
      actions:  (a.actions?.buckets || []).map((b) => ({ action: b.key, count: b.doc_count })),
      // CE-3: rohe _source-Events für den Flow-Normalizer (Firewall + Sysmon Event 3).
      sources: hits.map((h) => h._source || {}),
      events: hits.map((h) => {
        const s = h._source || {};
        return {
          time: s['@timestamp'], ruleId: s.rule?.id, level: s.rule?.level, description: s.rule?.description,
          host: s.agent?.name, srcIp: s.data?.srcip, dstIp: s.data?.dstip,
          srcPort: s.data?.srcport, dstPort: s.data?.dstport, protocol: s.data?.protocol, action: s.data?.action,
        };
      }),
    };
  }

  /**
   * Cowrie-Honeypot-Session-Events für EIN Ticket holen (Slice 2b.1). Read-only.
   * Eng begrenzt: Honeypot-Agent + Angreifer-IP + Ticket-/Flow-Zeitfenster
   * (±HP_SESSION_BUFFER_MS). `data.session` verengt optional zusätzlich, ist aber
   * KEINE Voraussetzung. `data.password` wird BEWUSST NIE projiziert (auch nicht
   * maskiert) — Datensparsamkeit an der Quelle. Aggregation zu honeypot_session
   * passiert separat (honeypotSessionNormalizer).
   *
   * @returns {Promise<null|{events:object[], total:number, window?:object, reason?:string}>}
   *   null = Indexer aus · {events:[],reason} = Voraussetzung fehlt → KEINE breite Suche.
   */
  async ticketHoneypotSessions({ agentId, srcIp, firstSeen = null, lastSeen = null, sessionId = null,
    size = HP_SESSION_DEFAULT_SIZE, bufferMs = HP_SESSION_BUFFER_MS } = {}) {
    if (!this.isEnabled()) return null;
    if (!agentId) return { events: [], total: 0, reason: 'missing_agent' };
    if (!srcIp)   return { events: [], total: 0, reason: 'missing_src_ip' };

    const tFirst = Date.parse(firstSeen);
    const tLast  = Date.parse(lastSeen);
    const lo = Number.isFinite(tFirst) ? tFirst : tLast;
    const hi = Number.isFinite(tLast)  ? tLast  : tFirst;
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      return { events: [], total: 0, reason: 'missing_time_window' };
    }
    const gte = new Date(lo - bufferMs).toISOString();
    const lte = new Date(hi + bufferMs).toISOString();
    const cappedSize = Math.max(1, Math.min(Number(size) || HP_SESSION_DEFAULT_SIZE, HP_SESSION_MAX_SIZE));

    const filter = [
      { term:   { 'agent.id': String(agentId) } },
      { term:   { 'data.src_ip': String(srcIp) } },
      { range:  { '@timestamp': { gte, lte } } },
      { prefix: { 'data.eventid': 'cowrie.' } },   // nur Cowrie-Events
    ];
    if (sessionId) filter.push({ term: { 'data.session': String(sessionId) } });

    const body = {
      size: cappedSize, track_total_hits: true, sort: [{ '@timestamp': 'asc' }],
      // BEWUSST OHNE data.password (auch nicht maskiert) — Datensparsamkeit an der Quelle.
      _source: ['@timestamp', 'rule.id',
        'data.eventid', 'data.session', 'data.sensor',
        'data.src_ip', 'data.src_port', 'data.dst_ip', 'data.dst_port', 'data.protocol',
        'data.timestamp', 'data.duration',
        'data.username', 'data.input',
        'data.url', 'data.outfile', 'data.destfile', 'data.filename', 'data.shasum',
        'data.hassh', 'data.version'],
      query: { bool: { filter } },
    };
    const r = await this._search(body);
    const hits = r.hits?.hits || [];
    return {
      events: hits.map((h) => h._source || {}),
      total: r.hits?.total?.value ?? hits.length,
      window: { gte, lte },
    };
  }

  /**
   * Firewall-5-Tuple-Events für Exposure-Stitching holen (Slice 3b). Read-only.
   * Eng begrenzt: gleiche externe Source-IP + Firewall-Gruppen + Session-Fenster
   * (±FW_FLOW_BUFFER_MS — etwas weiter als das Engine-Match-Fenster, das danach präzise
   * filtert). Liefert engine-fertige, normalisierte Firewall-Flows inkl. eventId.
   * KEINE NAT-Felder (existieren in dieser Umgebung nicht, ADR-034).
   *
   * @returns {Promise<null|{flows:object[], total:number, window?:object, reason?:string}>}
   *   null = Indexer aus · {flows:[],reason} = Voraussetzung fehlt → KEINE breite Suche.
   */
  async ticketFirewallFlows({ srcIp, firstSeen = null, lastSeen = null, size = FW_FLOW_DEFAULT_SIZE, bufferMs = FW_FLOW_BUFFER_MS } = {}) {
    if (!this.isEnabled()) return null;
    if (!srcIp) return { flows: [], total: 0, reason: 'missing_src_ip' };
    const tFirst = Date.parse(firstSeen);
    const tLast = Date.parse(lastSeen);
    const lo = Number.isFinite(tFirst) ? tFirst : tLast;
    const hi = Number.isFinite(tLast) ? tLast : tFirst;
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { flows: [], total: 0, reason: 'missing_time_window' };
    const gte = new Date(lo - bufferMs).toISOString();
    const lte = new Date(hi + bufferMs).toISOString();
    const cappedSize = Math.max(1, Math.min(Number(size) || FW_FLOW_DEFAULT_SIZE, FW_FLOW_MAX_SIZE));

    const body = {
      size: cappedSize, track_total_hits: true, sort: [{ '@timestamp': 'asc' }],
      _source: ['@timestamp', 'data.id', 'data.srcip', 'data.dstip', 'data.srcport', 'data.dstport', 'data.protocol', 'data.action'],
      query: { bool: { filter: [
        { terms: { 'rule.groups': FW_GROUPS } },
        { term: { 'data.srcip': String(srcIp) } },
        { range: { '@timestamp': { gte, lte } } },
      ] } },
    };
    const r = await this._search(body);
    const hits = r.hits?.hits || [];
    const num = (v) => (v === undefined || v === null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
    const flows = hits.map((h) => {
      const s = h._source || {}; const d = s.data || {};
      return {
        sourceType: 'firewall',
        eventId: d.id != null ? d.id : (h._id != null ? h._id : null),
        sourceIp: d.srcip != null ? d.srcip : null,
        destinationIp: d.dstip != null ? d.dstip : null,
        sourcePort: num(d.srcport),
        destinationPort: num(d.dstport),
        protocol: d.protocol != null ? String(d.protocol).toLowerCase() : null,
        action: d.action != null ? d.action : null,
        timestamp: s['@timestamp'] != null ? s['@timestamp'] : null,
      };
    });
    return { flows, total: r.hits?.total?.value ?? hits.length, window: { gte, lte } };
  }

  /**
   * Telemetrie-Serien fürs Dashboard — eine Query für alle Reihen
   * (filters-Agg × date_histogram). Nur Zähler pro Zeitfenster, keine
   * Benutzernamen in den Aggregaten (DSGVO).
   *
   * Serien: events (alle) · alerts (level≥7) · dcLogons (4624/4768/4769) ·
   * dcFailed (4625) · defender (1116/1117) · fwBlock/fwPass (OPNsense filterlog).
   */
  async telemetry({ hours = 24, interval = '15m' } = {}) {
    if (!this.isEnabled()) return null;

    const winEvent = (ids) => ({ terms: { 'data.win.system.eventID': ids } });
    const seriesFilters = {
      events:   { match_all: {} },
      alerts:   { range: { 'rule.level': { gte: 7 } } },
      dcLogons: winEvent(['4624', '4768', '4769']),
      dcFailed: winEvent(['4625']),
      defender: { bool: { filter: [
        { terms: { 'rule.groups': DEFENDER_GROUPS } },
        winEvent(['1116', '1117']),
      ] } },
      fwBlock:  { bool: { filter: [
        { terms: { 'rule.groups': FW_GROUPS } }, { term: { 'data.action': 'block' } },
      ] } },
      fwPass:   { bool: { filter: [
        { terms: { 'rule.groups': FW_GROUPS } }, { terms: { 'data.action': ['pass', 'allow', 'accept'] } },
      ] } },
      // WEF forwarded: am Collector gesammelt, aber auf einem anderen Computer
      // entstanden (z.B. DC01 → WEC01). exists-Filter hält Collector-eigene
      // Nicht-EventChannel-Events (syscheck/sca) raus.
      wef: { bool: {
        filter: [
          { terms: { 'agent.name': WEF_COLLECTORS } },
          { exists: { field: 'data.win.system.computer' } },
        ],
        must_not: WEF_COLLECTORS.map((n) => ({ prefix: { 'data.win.system.computer': n } })),
      } },
      // Agent-Buffer-Warnungen (Regel 202/203) — Host droht Events zu verwerfen.
      agentBuffer: { terms: { 'rule.id': AGENT_BUFFER_RULES } },
    };
    const overTime = { date_histogram: {
      field: '@timestamp', fixed_interval: interval, min_doc_count: 0,
      extended_bounds: { min: `now-${Number(hours)}h`, max: 'now' },
    } };
    const body = {
      size: 0,
      query: WazuhIndexerClient._rangeQuery(`now-${Number(hours)}h`, null),
      aggs: {
        series: {
          filters: { filters: seriesFilters },
          // extended_bounds: ohne sie spannt das Histogramm nur den Zeitraum mit
          // Treffern auf — dünne Serien (z.B. 8 Defender-Events in 1 Minute)
          // ergeben sonst 1 Bucket und damit keine zeichenbare Kurve.
          aggs: { over_time: overTime },
        },
        // Pro-Agent-Serien für die Netz-Zonen-Karten; das Mapping Agent→VLAN
        // ist Lab-Topologie und liegt bewusst im Frontend (topology.ts).
        byAgent: { terms: { field: 'agent.name', size: 12 }, aggs: { over_time: overTime } },
        // Welche Agents haben Buffer-Warnungen? Pro Agent nach Regel-ID, damit
        // 202 (Warnung) von 203 (Events verworfen) unterscheidbar bleibt.
        bufferAgents: {
          filter: { terms: { 'rule.id': AGENT_BUFFER_RULES } },
          aggs: {
            byAgent: {
              terms: { field: 'agent.name', size: 20 },
              aggs: { byRule: { terms: { field: 'rule.id', size: 5 } } },
            },
          },
        },
      },
    };

    const [r, defenderRecent, recent] = await Promise.all([
      this._search(body), this._defenderRecent(), this._recentAlerts(12),
    ]);
    const buckets = r.aggregations?.series?.buckets || {};
    const mapSeries = (b) => (b?.over_time?.buckets || [])
      .map((x) => ({ t: x.key_as_string || x.key, count: x.doc_count }));

    const series = {};
    for (const key of Object.keys(seriesFilters)) series[key] = mapSeries(buckets[key]);
    const agents = (r.aggregations?.byAgent?.buckets || [])
      .map((b) => ({ name: b.key, points: mapSeries(b) }));

    // Buffer-Warnungen pro Agent: warn=202-Treffer, full=203-Treffer (verworfen).
    const bufferAgents = (r.aggregations?.bufferAgents?.byAgent?.buckets || []).map((b) => {
      const byRule = Object.fromEntries((b.byRule?.buckets || []).map((x) => [String(x.key), x.doc_count]));
      return {
        name: b.key,
        warn: byRule[AGENT_BUFFER_WARN_RULE] || 0,
        full: byRule[AGENT_BUFFER_FULL_RULE] || 0,
      };
    });

    return { range: { hours, interval }, series, agents, bufferAgents, defenderRecent, recent };
  }

  /** Letzte Defender-Funde (1116 erkannt / 1117 Aktion) — für die „Letzte Funde"-Liste. */
  async _defenderRecent(size = 6) {
    const body = {
      size, sort: [{ '@timestamp': 'desc' }],
      _source: ['@timestamp', 'agent.name', 'rule.level', 'rule.description',
        'data.win.system.eventID', 'data.win.eventdata'],
      query: { bool: { filter: [
        WazuhIndexerClient._rangeQuery('now-7d', null),
        { terms: { 'rule.groups': DEFENDER_GROUPS } },
        { terms: { 'data.win.system.eventID': ['1116', '1117'] } },
      ] } },
    };
    const hits = (await this._search(body)).hits?.hits || [];
    return hits.map((h) => {
      const s  = h._source || {};
      const ev = s.data?.win?.eventdata || {};
      return {
        time:        s['@timestamp'],
        host:        s.agent?.name || null,
        eventID:     s.data?.win?.system?.eventID || null,
        level:       s.rule?.level ?? 0,
        description: s.rule?.description || null,
        // Feldnamen je nach Decoder-Version — best-effort, null statt Fake-Wert.
        threat:      ev.threatName || ev.threat_name || null,
        action:      ev.actionName || ev.action_name || null,
        path:        ev.path || null,
      };
    });
  }

  /** Komplettes Dashboard-DTO (Indexer-Anteil). Wirft bei Verbindungs-/Auth-Fehlern. */
  async dashboard() {
    const [kpis, timeSeries, severity, recentAlerts, topTactics, topHosts, topSourceIps] = await Promise.all([
      this._kpis(), this._timeSeries(), this._severity(), this._recentAlerts(),
      this._topTactics(), this._topHosts(), this._topSourceIps(),
    ]);
    return { kpis, timeSeries, severity, recentAlerts, topTactics, topHosts, topSourceIps };
  }
}

module.exports = { WazuhIndexerClient, SEV, TI_GROUPS };
