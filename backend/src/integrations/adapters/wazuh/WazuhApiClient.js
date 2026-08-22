'use strict';

const { RealHttpClient } = require('../../http/RealHttpClient');

// Wazuh-API-Token gilt standardmäßig ~900s — wir cachen knapp darunter.
const TOKEN_TTL_MS = 800_000;

/**
 * WazuhApiClient — dünner Client für die Wazuh-API (Port 55000).
 *
 * Auth: POST /security/user/authenticate (Basic) → JWT, gecacht bis Ablauf.
 * Self-signed Zertifikat der internen VM → rejectUnauthorized:false.
 * Wird per HttpClient-Abstraktion getestet (InMemoryHttpClient in Tests).
 */
// TLS-Validierung per ENV konfigurierbar. Default false für Lab-Kompatibilität
// (self-signed Zertifikate). In Produktion auf 'true' setzen.
const WAZUH_TLS_REJECT_UNAUTHORIZED = process.env.WAZUH_TLS_REJECT_UNAUTHORIZED === 'true';
// Für den lokalen Wazuh-Docker-Manager wird das API-Zertifikat beim ersten Boot
// erzeugt. Die CA ist dabei nicht immer an den Node-Truststore lieferbar. Ein
// expliziter SHA-256-Pin ist deshalb ein sicherer, fail-closed Trust-Anchor.
const WAZUH_API_TLS_FINGERPRINT = process.env.WAZUH_API_TLS_FINGERPRINT || '';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Der Manager-Restart killt die eigene API mitten in der Antwort → ein
// Verbindungsabbruch (ECONNRESET/Timeout/Socket-Hang-up) ist beim Restart
// ERWARTET, kein Fehler. Echte HTTP-Statusfehler (401/403/…) haben err.status
// und sind dagegen echte Fehler.
function isConnectionDrop(err) {
  if (!err || err.status) return false;
  const code = String(err.code || '');
  if (['ECONNRESET', 'ECONNABORTED', 'ECONNREFUSED', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'EPIPE'].includes(code)) return true;
  return /socket hang up|timed? ?out|aborted|econn|reset|network/i.test(String(err.message || ''));
}

// analysisd ist der kritische Daemon (lädt das Ruleset). Manager gilt als oben,
// wenn analysisd läuft — sonst irgendein Daemon 'running'.
function managerRunning(status) {
  if (!status) return false;
  const item = Array.isArray(status.affected_items) ? status.affected_items[0] : status;
  if (!item || typeof item !== 'object') return false;
  const analysisd = item['wazuh-analysisd'] || item['ossec-analysisd'];
  if (analysisd) return analysisd === 'running';
  return Object.values(item).some((v) => v === 'running');
}

class WazuhApiClient {
  constructor({ url = '', user = '', password = '', http = null, restartPoll = null } = {}) {
    this._url      = String(url).replace(/\/+$/, '');
    this._user     = user;
    this._pass     = password;
    this._http     = http || new RealHttpClient({
      rejectUnauthorized: WAZUH_TLS_REJECT_UNAUTHORIZED,
      pinnedFingerprint: WAZUH_API_TLS_FINGERPRINT || undefined,
      timeout: 10_000,
    });
    this._token    = null;
    this._tokenExp = 0;
    // Restart-Bestätigung: Standard ~40s (20 × 2s), in Tests klein injizierbar.
    this._restartPoll = { delayMs: 2000, attempts: 20, ...(restartPoll || {}) };
  }

  isEnabled() { return Boolean(this._url && this._user && this._pass); }

  /**
   * Layer 2: Verbindung zur Laufzeit ändern (Settings-UI). Invalidiert den
   * Token-Cache — der alte JWT gehört zu den alten Credentials.
   */
  reconfigure({ url = '', user = '', password = '' } = {}) {
    this._url      = String(url).replace(/\/+$/, '');
    this._user     = user;
    this._pass     = password;
    this._token    = null;
    this._tokenExp = 0;
  }

  /** Verbindungstest: authentifiziert einmal frisch. Fehler propagieren sichtbar. */
  async ping() {
    if (!this.isEnabled()) throw new Error('Wazuh-API nicht konfiguriert');
    this._token    = null;   // frische Auth erzwingen — Test soll die Creds prüfen
    this._tokenExp = 0;
    await this._authenticate();
    return { ok: true };
  }

  async _authenticate() {
    if (this._token && Date.now() < this._tokenExp) return this._token;
    const basic = Buffer.from(`${this._user}:${this._pass}`).toString('base64');
    const res   = await this._http.request(`${this._url}/security/user/authenticate?raw=true`, {
      method:  'POST',
      headers: { Authorization: `Basic ${basic}` },
    });
    // raw=true → Token als String; ohne raw → { data: { token } }
    const token = typeof res.data === 'string' ? res.data.trim() : (res.data?.data?.token || '');
    if (!token) throw new Error('Wazuh-API: kein Token erhalten');
    this._token    = token;
    this._tokenExp = Date.now() + TOKEN_TTL_MS;
    return token;
  }

  // Authentifizierter GET → liefert res.data.data ({ affected_items, total_affected_items, … }).
  async _authGet(path) {
    const token = await this._authenticate();
    const res   = await this._http.request(`${this._url}${path}`, {
      method: 'GET', headers: { Authorization: `Bearer ${token}` },
    });
    return res.data?.data || {};
  }

  /** Agent-Details (OS, IP, Status, Gruppe …) oder null. */
  async getAgent(agentId) {
    if (!this.isEnabled() || !agentId) return null;
    const data = await this._authGet(`/agents?agents_list=${encodeURIComponent(agentId)}`);
    return (data.affected_items || [])[0] || null;
  }

  /** Alle registrierten Agents (Heartbeat-Status, OS, IP, lastKeepAlive …). */
  async listAgents() {
    if (!this.isEnabled()) return [];
    const data = await this._authGet('/agents?limit=500&sort=-status');
    return data.affected_items || [];
  }

  /**
   * Host-Enrollment: registriert einen neuen Agent am Manager (POST /agents, create).
   * Liefert { id, name, key } — der `key` ist das einmalige Enrollment-Secret (base64)
   * für die Agent-Installation auf dem Ziel-Host. Wirft, wenn die API nicht
   * konfiguriert ist oder die Antwort unerwartet ist (kein id/key).
   */
  async addAgent({ name, ip } = {}) {
    if (!this.isEnabled()) throw new Error('Wazuh-API nicht konfiguriert');
    if (!name) throw new Error('addAgent: name erforderlich');
    const body = { name: String(name) };
    if (ip) body.ip = String(ip);
    const res  = await this._req('POST', '/agents', { body, contentType: 'application/json' });
    const data = res.data?.data || {};
    if (!data.id || !data.key) {
      throw Object.assign(new Error(`Wazuh-Agent '${name}': unerwartete Antwort (id/key fehlt)`), { status: 502 });
    }
    return { id: data.id, name: String(name), key: data.key };
  }

  /** Regel-Zusammenfassung für Rule-Health (total / enabled / disabled). */
  async rulesSummary() {
    if (!this.isEnabled()) return null;
    const safe = async (p) => { try { return await this._authGet(p); } catch { return {}; } };
    const [all, enabled] = await Promise.all([
      safe('/rules?limit=1'),
      safe('/rules?status=enabled&limit=1'),
    ]);
    const total = all.total_affected_items ?? 0;
    const en    = enabled.total_affected_items ?? 0;
    return { total, enabled: en, disabled: Math.max(0, total - en) };
  }

  /**
   * Detail einer einzelnen Regel (für FP-Targeting). Liefert frequency +
   * if_matched_sid aus den Rule-Details → erlaubt zu erkennen, ob es eine
   * Frequency-/Korrelations-Regel ist und welche Basis-Regel sie aggregiert.
   */
  async getRuleDetail(ruleId) {
    if (!this.isEnabled() || !ruleId) return null;
    const data = await this._authGet(`/rules?rule_ids=${encodeURIComponent(ruleId)}`);
    const item = (data.affected_items || [])[0];
    if (!item) return null;
    const d = item.details || {};
    return {
      id: Number(item.id) || Number(ruleId),
      level: Number(item.level) || 0,
      frequency: d.frequency != null ? Number(d.frequency) : null,
      ifMatchedSid: d.if_matched_sid ? String(d.if_matched_sid) : null,
      ifSid: d.if_sid ? String(d.if_sid) : null,
      groups: item.groups || [],
    };
  }

  /** Geladene Manager-Regeln (Detection Library) — normalisiert + paginiert. */
  async listRules({ search = '', group = '', level = '', limit = 100, offset = 0 } = {}) {
    if (!this.isEnabled()) return { items: [], total: 0 };
    const qs = new URLSearchParams();
    qs.set('limit', String(Math.min(Math.max(Number(limit) || 100, 1), 500)));
    qs.set('offset', String(Math.max(Number(offset) || 0, 0)));
    if (search) qs.set('search', String(search));
    if (group)  qs.set('group', String(group));
    if (level !== '' && level != null) qs.set('level', String(level));
    const data = await this._authGet(`/rules?${qs.toString()}`);
    const mitreIds = (m) => {
      if (!m) return [];
      if (Array.isArray(m)) return m.map((x) => (typeof x === 'string' ? x : (x.id || x.technique || ''))).filter(Boolean);
      if (Array.isArray(m.id)) return m.id;
      return [];
    };
    const items = (data.affected_items || []).map((r) => ({
      id: r.id, level: r.level, description: r.description,
      groups: Array.isArray(r.groups) ? r.groups : [],
      mitre: mitreIds(r.mitre),
      filename: r.filename || '',
    }));
    return { items, total: data.total_affected_items ?? items.length };
  }

  /** Syscollector-Inventory eines Agents (OS, Hardware, Netz, Paket-/Port-Zahl). */
  async getAgentInventory(agentId) {
    if (!this.isEnabled() || !agentId) return null;
    const id = encodeURIComponent(agentId);
    const safe = async (p) => { try { return await this._authGet(p); } catch { return {}; } };
    const [os, hardware, netiface, netaddr, packages, ports, processes] = await Promise.all([
      safe(`/syscollector/${id}/os`),
      safe(`/syscollector/${id}/hardware`),
      safe(`/syscollector/${id}/netiface`),
      safe(`/syscollector/${id}/netaddr`),
      safe(`/syscollector/${id}/packages?limit=1`),
      safe(`/syscollector/${id}/ports?limit=1`),
      safe(`/syscollector/${id}/processes?limit=1`),
    ]);
    return {
      os:             (os.affected_items || [])[0] || null,
      hardware:       (hardware.affected_items || [])[0] || null,
      interfaces:     netiface.affected_items || [],
      addresses:      netaddr.affected_items || [],   // IPs (netiface liefert keine)
      packagesTotal:  packages.total_affected_items ?? 0,
      portsTotal:     ports.total_affected_items ?? 0,
      processesTotal: processes.total_affected_items ?? 0,
    };
  }

  // ── Syscollector-Detail-Abfragen (Evidence Collector, P16) ────────────────
  // Liefern jeweils das rohe affected_items-Array (oder []). Jeder Aufruf kann
  // werfen — der Collector entscheidet pro Call, wie ein Fehler behandelt wird.

  /** Top-Prozesse eines Agents (default: nach Resident-RAM absteigend). */
  async getProcesses(agentId, { limit = 20, sort = '-resident' } = {}) {
    if (!this.isEnabled() || !agentId) return [];
    const id  = encodeURIComponent(agentId);
    const lim = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const data = await this._authGet(
      `/syscollector/${id}/processes?limit=${lim}&sort=${encodeURIComponent(sort)}&select=name,pid,state,resident`,
    );
    return data.affected_items || [];
  }

  /**
   * Installierte Software-Pakete eines Agents — paginiert + optional gefiltert.
   * Liefert { items, total } für die Host-Software-Karte im Frontend.
   * Limit hart auf 200 gecappt (Schutz gegen Riesen-Responses/Missbrauch).
   */
  async getAgentPackages(agentId, { limit = 50, offset = 0, search = '' } = {}) {
    if (!this.isEnabled() || !agentId) return { items: [], total: 0 };
    const id  = encodeURIComponent(agentId);
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const off = Math.max(Number(offset) || 0, 0);
    let path = `/syscollector/${id}/packages?select=name,version,vendor,architecture&limit=${lim}&offset=${off}&sort=name`;
    const term = String(search || '').trim();
    if (term) path += `&search=${encodeURIComponent(term)}`;
    const data = await this._authGet(path);
    return { items: data.affected_items || [], total: data.total_affected_items ?? 0 };
  }

  /** Lauschende Ports eines Agents. */
  async getListeningPorts(agentId) {
    if (!this.isEnabled() || !agentId) return [];
    const id = encodeURIComponent(agentId);
    const data = await this._authGet(
      `/syscollector/${id}/ports?state=listening&select=local_port,protocol,process`,
    );
    return data.affected_items || [];
  }

  /** Netzwerk-Interfaces eines Agents. */
  async getNetInterfaces(agentId) {
    if (!this.isEnabled() || !agentId) return [];
    const id = encodeURIComponent(agentId);
    // select nur gültige netiface-Felder: name,mac. ipv4 ist KEIN netiface-Feld
    // (IPs liegen in netaddr) → würde HTTP 400 auslösen und die MAC-Anreicherung killen.
    const data = await this._authGet(`/syscollector/${id}/netiface?select=name,mac`);
    return data.affected_items || [];
  }

  // Security Configuration Assessment (SCA) eines Agents — CIS-Benchmark-Ergebnisse.
  // Liefert pro Policy score (0–100 Compliance), pass/fail-Checks. Aggregiert:
  // schlechtester Score + Summe fehlgeschlagener Checks (Posture-Signal).
  async getAgentSca(agentId) {
    if (!this.isEnabled() || !agentId) return null;
    const data = await this._authGet(`/sca/${encodeURIComponent(agentId)}`).catch(() => ({}));
    const policies = (data.affected_items || []).map((p) => {
      const fail = p.fail ?? Math.max(0, (p.total_checks ?? 0) - (p.pass ?? 0) - (p.invalid ?? 0));
      return { policyId: p.policy_id, name: p.name, score: p.score ?? null, pass: p.pass ?? 0, fail, totalChecks: p.total_checks ?? 0 };
    });
    if (policies.length === 0) return { policies: [], worstScore: null, totalFail: 0 };
    const scored = policies.filter((p) => typeof p.score === 'number');
    return {
      policies,
      worstScore: scored.length ? Math.min(...scored.map((p) => p.score)) : null,
      totalFail:  policies.reduce((sum, p) => sum + p.fail, 0),
    };
  }

  // ── Outbound: Custom-Rule-Datei verwalten + Manager steuern (Stage 4) ──────
  // Authentifizierter Request mit beliebiger Methode/Body (für PUT/Raw-GET).
  async _req(method, path, { body = null, contentType } = {}) {
    const token   = await this._authenticate();
    const headers = { Authorization: `Bearer ${token}` };
    if (contentType) headers['Content-Type'] = contentType;
    return this._http.request(`${this._url}${path}`, { method, headers, body });
  }

  /** Roh-Inhalt einer Custom-Rule-Datei (leerer String, wenn sie noch nicht existiert). */
  async getRuleFile(filename) {
    if (!this.isEnabled()) return '';
    try {
      const res = await this._req('GET', `/rules/files/${encodeURIComponent(filename)}?raw=true`);
      return typeof res.data === 'string' ? res.data : (res.data?.data || '');
    } catch (err) {
      if (err.status === 404) return '';
      throw err;
    }
  }

  /** Custom-Rule-Datei überschreiben (raw XML). Wirft, wenn API nicht konfiguriert/fehlerhaft. */
  async putRuleFile(filename, content) {
    if (!this.isEnabled()) throw new Error('Wazuh-API nicht konfiguriert');
    const res = await this._req('PUT', `/rules/files/${encodeURIComponent(filename)}?overwrite=true`,
      { body: String(content), contentType: 'application/octet-stream' });
    // Wazuh liefert HTTP 200 auch bei fachlichem Fehler (z.B. leere Regelgruppe
    // ohne <rule> → code 1113 "XML syntax error"). Der echte Status steckt in
    // failed_items — ohne diese Prüfung gingen Schreibfehler still verloren.
    const payload = res.data?.data || res.data || {};
    if (Number(payload.total_failed_items) > 0) {
      const fail = payload.failed_items?.[0]?.error || {};
      throw Object.assign(
        new Error(`Wazuh-Regeldatei '${filename}' nicht geschrieben: ${fail.message || 'unbekannter Fehler'}${fail.code ? ` (code ${fail.code})` : ''}`),
        { status: 502 },
      );
    }
    return payload;
  }

  // Löscht eine (Custom-)Regeldatei. Gebraucht, wenn die letzte FP-Regel entfernt
  // wird — eine leere Regelgruppe lehnt Wazuh ab, also Datei löschen statt leeren.
  async deleteRuleFile(filename) {
    if (!this.isEnabled()) throw new Error('Wazuh-API nicht konfiguriert');
    const res = await this._req('DELETE', `/rules/files/${encodeURIComponent(filename)}`);
    return res.data?.data || res.data || {};
  }

  /** Ruleset/Config validieren (vor Restart). { ok, status, details } */
  async validateConfiguration() {
    if (!this.isEnabled()) return { ok: false, status: 'not_configured', details: null };
    const res = await this._req('GET', '/manager/configuration/validation');
    const d = res.data?.data || {};
    const status = d.status || (Array.isArray(d.affected_items) ? d.affected_items[0]?.status : undefined);
    return { ok: status === 'OK', status: status || 'unknown', details: d };
  }

  /**
   * Manager-Neustart — NUR explizit aufrufen (lädt das geänderte Ruleset).
   * Robust gegen den API-Selbstmord: Der Restart killt die eigene API mitten in
   * der Antwort (ECONNRESET) — das ist erwartet. In dem Fall wird der Erfolg
   * über managerStatus-Polling bestätigt, statt fälschlich zu scheitern (422).
   */
  async restartManager() {
    if (!this.isEnabled()) throw new Error('Wazuh-API nicht konfiguriert');
    try {
      const res = await this._req('PUT', '/manager/restart');
      return res.data?.data || {};
    } catch (err) {
      if (!isConnectionDrop(err)) throw err; // echte HTTP-Fehler (401/403/…) bleiben Fehler
      // Token verfällt mit dem Restart → invalidieren, damit das Polling neu auth't.
      this._token = null; this._tokenExp = 0;
      const up = await this._waitForManagerUp();
      if (!up) {
        throw Object.assign(
          new Error('Manager-Restart angestoßen, aber Status nicht wieder erreichbar (Timeout)'),
          { status: 504, retryable: true },
        );
      }
      return { restarted: true, confirmed: true, viaStatusPoll: true };
    }
  }

  // Pollt managerStatus bis analysisd läuft (oder Versuche erschöpft).
  async _waitForManagerUp() {
    const { delayMs, attempts } = this._restartPoll;
    for (let i = 0; i < attempts; i += 1) {
      await sleep(delayMs);
      try {
        if (managerRunning(await this.managerStatus())) return true;
      } catch { /* Manager noch unten → weiter pollen */ }
    }
    return false;
  }

  /** Manager-Status/Verbindung (optional). */
  async managerStatus() {
    if (!this.isEnabled()) return null;
    const res = await this._req('GET', '/manager/status');
    return res.data?.data || null;
  }
}

module.exports = { WazuhApiClient };
