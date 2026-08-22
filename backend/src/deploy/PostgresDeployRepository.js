'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Deployment Center — PostgresDeployRepository. Gleicher Vertrag wie InMemory.
//
// Single-flight + Replay über Partial-Unique-Indizes (Migration 051); ein
// Unique-Konflikt (23505) wird zu ACTIVE_RUN_CONFLICT bzw. DEPLOYED_CONFLICT
// normalisiert. Der API-Token liegt NUR verschlüsselt (api_token_enc) in der DB.
// ─────────────────────────────────────────────────────────────────────────

const { query } = require('../db/pool');

const UNIQUE_VIOLATION = '23505';
function conflict(code, message) { return Object.assign(new Error(message), { code }); }
function iso(v) { return v instanceof Date ? v.toISOString() : v; }

class PostgresDeployRepository {
  constructor({ queryFn = query } = {}) { this._query = queryFn; }

  _connector(r) {
    return r ? {
      id: r.id, type: r.type, name: r.name, host: r.host, apiTokenEnc: r.api_token_enc,
      prefix: r.api_token_prefix, targetNode: r.target_node, storage: r.storage, bridge: r.bridge,
      verifyTls: r.verify_tls, tlsCertificatePem: r.tls_certificate_pem, tlsCertificateFingerprint: r.tls_certificate_fingerprint, status: r.status, createdBy: r.created_by,
      // SSH-Connector-Felder (null bei proxmox).
      sshUser: r.ssh_user, sshPort: r.ssh_port, privateKeyEnc: r.private_key_enc,
      passphraseEnc: r.passphrase_enc, hostKeyPin: r.host_key_pin,
      createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
    } : null;
  }
  _spec(r) {
    return r ? {
      id: r.id, moduleId: r.module_id, connectorId: r.connector_id, targetNode: r.target_node,
      storage: r.storage, bridge: r.bridge, resources: r.resources, params: r.params,
      specHash: r.spec_hash, createdBy: r.created_by, createdAt: iso(r.created_at),
    } : null;
  }
  _run(r) {
    return r ? {
      id: r.id, specId: r.spec_id, status: r.status, vmid: r.vmid,
      startedBy: r.started_by, startedById: r.started_by_id,
      approvedBy: r.approved_by, approvedById: r.approved_by_id,
      startedAt: iso(r.started_at), approvedAt: iso(r.approved_at),
      finishedAt: iso(r.finished_at), failureReason: r.failure_reason,
    } : null;
  }

  // ── Connectors ──
  async createConnector(c) {
    // SSH-Connector: kein api_token/target_node, dafür verschlüsselter Key + Host-Key-Pin.
    if (c.type === 'ssh') {
      const res = await this._query(
        `INSERT INTO hypervisor_connectors
           (id, type, name, host, ssh_user, ssh_port, private_key_enc, passphrase_enc, host_key_pin, status, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),now()) RETURNING *`,
        [c.id, c.type, c.name, c.host, c.sshUser ?? 'root', c.sshPort ?? 22, c.privateKeyEnc, c.passphraseEnc ?? '', c.hostKeyPin, c.status ?? 'active', c.createdBy ?? '']);
      return this._connector(res.rows[0]);
    }
    const res = await this._query(
      `INSERT INTO hypervisor_connectors
         (id, type, name, host, api_token_enc, api_token_prefix, target_node, storage, bridge, verify_tls, status, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now(),now()) RETURNING *`,
      [c.id, c.type, c.name, c.host, c.apiTokenEnc, c.prefix ?? '', c.targetNode, c.storage ?? null, c.bridge ?? null, c.verifyTls !== false, c.status ?? 'active', c.createdBy ?? '']);
    return this._connector(res.rows[0]);
  }
  async getConnector(id) { const r = await this._query('SELECT * FROM hypervisor_connectors WHERE id = $1', [id]); return this._connector(r.rows[0]); }
  async listConnectors() { const r = await this._query('SELECT * FROM hypervisor_connectors ORDER BY created_at DESC', []); return r.rows.map((row) => this._connector(row)); }
  async setConnectorCertificate(id, certificate) {
    const r = await this._query('UPDATE hypervisor_connectors SET tls_certificate_pem=$2, tls_certificate_fingerprint=$3, updated_at=now() WHERE id=$1 RETURNING *', [id, certificate.pem, certificate.fingerprint]);
    return this._connector(r.rows[0]);
  }

  // ── Specs ──
  async createSpec(s) {
    const res = await this._query(
      `INSERT INTO deploy_specs (id, module_id, connector_id, target_node, storage, bridge, resources, params, spec_hash, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()) RETURNING *`,
      [s.id, s.moduleId, s.connectorId, s.targetNode, s.storage, s.bridge, JSON.stringify(s.resources ?? {}), JSON.stringify(s.params ?? {}), s.specHash, s.createdBy ?? '']);
    return this._spec(res.rows[0]);
  }
  async getSpec(id) { const r = await this._query('SELECT * FROM deploy_specs WHERE id = $1', [id]); return this._spec(r.rows[0]); }
  async findSpecByHash(hash) { const r = await this._query('SELECT * FROM deploy_specs WHERE spec_hash = $1', [hash]); return this._spec(r.rows[0]); }

  // ── Runs ──
  async createRun(run) {
    const res = await this._query(
      `INSERT INTO deploy_runs (id, spec_id, status, started_by, started_by_id, started_at)
       VALUES ($1,$2,$3,$4,$5, now()) RETURNING *`,
      [run.id, run.specId, run.status, run.startedBy ?? '', run.startedById ?? null]);
    return this._run(res.rows[0]);
  }
  async updateRun(run) {
    try {
      const res = await this._query(
        `UPDATE deploy_runs SET status=$2, vmid=$3, approved_by=$4, approved_by_id=$5, approved_at=$6, finished_at=$7, failure_reason=$8 WHERE id=$1 RETURNING *`,
        [run.id, run.status, run.vmid ?? null, run.approvedBy ?? null, run.approvedById ?? null, run.approvedAt ?? null, run.finishedAt ?? null, run.failureReason ?? null]);
      return this._run(res.rows[0]);
    } catch (err) {
      if (err.code === UNIQUE_VIOLATION) {
        if (run.status === 'deployed') throw conflict('DEPLOYED_CONFLICT', 'diese Spec wurde bereits deployt');
        throw conflict('ACTIVE_RUN_CONFLICT', 'es läuft bereits ein aktiver Deploy-Run');
      }
      throw err;
    }
  }
  async getRun(id) { const r = await this._query('SELECT * FROM deploy_runs WHERE id = $1', [id]); return this._run(r.rows[0]); }
  async listRuns(limit = 10) {
    const r = await this._query('SELECT * FROM deploy_runs ORDER BY started_at DESC LIMIT $1', [limit]);
    return r.rows.map((row) => this._run(row));
  }
  async findActiveRun() {
    const r = await this._query(
      `SELECT * FROM deploy_runs WHERE status IN ('applying','cloning','starting','configuring','verifying','rolling_back') ORDER BY started_at DESC LIMIT 1`, []);
    return this._run(r.rows[0]);
  }
  async findDeployedRunBySpec(specId) {
    const r = await this._query(`SELECT * FROM deploy_runs WHERE spec_id = $1 AND status='deployed' LIMIT 1`, [specId]);
    return this._run(r.rows[0]);
  }

  // ── Steps (append-only) ──
  async appendRunStep(s) {
    await this._query(
      `INSERT INTO deploy_run_steps (id, run_id, step, status, detail, at) VALUES ($1,$2,$3,$4,$5, now())`,
      [s.id, s.runId, s.step, s.status, s.detail ? JSON.stringify(s.detail) : null]);
    return { ...s };
  }
  async listRunSteps(runId) {
    const r = await this._query('SELECT * FROM deploy_run_steps WHERE run_id = $1 ORDER BY at ASC', [runId]);
    return r.rows.map((row) => ({ id: row.id, runId: row.run_id, step: row.step, status: row.status, detail: row.detail, at: iso(row.at) }));
  }

  // ── Audit (append-only) ──
  async appendDeployAudit(a) {
    await this._query(
      `INSERT INTO deploy_audit (id, type, actor, spec_id, run_id, connector_id, detail, at) VALUES ($1,$2,$3,$4,$5,$6,$7, now())`,
      [a.id, a.type, a.actor ?? null, a.specId ?? null, a.runId ?? null, a.connectorId ?? null, a.detail ? JSON.stringify(a.detail) : null]);
    return { ...a };
  }
  async listDeployAudit(filter = {}) {
    const where = []; const params = []; let p = 1;
    if (filter.runId) { where.push(`run_id = $${p++}`); params.push(filter.runId); }
    if (filter.specId) { where.push(`spec_id = $${p++}`); params.push(filter.specId); }
    const sql = `SELECT * FROM deploy_audit ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY at DESC LIMIT 500`;
    const r = await this._query(sql, params);
    return r.rows.map((row) => ({ id: row.id, type: row.type, actor: row.actor, specId: row.spec_id, runId: row.run_id, connectorId: row.connector_id, detail: row.detail, at: iso(row.at) }));
  }

  // ── Safety-Lock ──
  async getSafetyLock() {
    const r = await this._query(`SELECT * FROM deploy_safety_lock WHERE id='global'`, []);
    const row = r.rows[0] || { locked: false, reason: '' };
    return { id: 'global', locked: !!row.locked, reason: row.reason || '', updatedAt: iso(row.updated_at) };
  }
  async setSafetyLock(locked, reason = '') {
    const r = await this._query(
      `INSERT INTO deploy_safety_lock (id, locked, reason, updated_at) VALUES ('global',$1,$2,now())
       ON CONFLICT (id) DO UPDATE SET locked=$1, reason=$2, updated_at=now() RETURNING *`,
      [!!locked, String(reason || '')]);
    const row = r.rows[0];
    return { id: 'global', locked: !!row.locked, reason: row.reason || '', updatedAt: iso(row.updated_at) };
  }
}

module.exports = { PostgresDeployRepository };
