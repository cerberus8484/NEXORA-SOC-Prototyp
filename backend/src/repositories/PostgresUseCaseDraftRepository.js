'use strict';

const { query }        = require('../db/pool');
const { UseCaseDraft } = require('../domain/UseCaseDraft');

// ─── Row-Mapping ──────────────────────────────────────────────────────────────

/** Domain-Objekt → Postgres-Row */
function toRow(d) {
  return {
    id:                   d.id,
    title:                d.title || '',
    source_type:          d.sourceType || 'manual',
    source_id:            d.sourceId  || '',
    status:               d.status    || 'draft',
    severity:             d.severity  || 'medium',
    confidence:           d.confidence ?? 0,
    generated_by:         d.generatedBy || 'ollama',
    reviewed_by:          d.reviewedBy  || null,
    // DSGVO: Felder mit potenziellem PII-Inhalt (IPs/Hostnames in detectionLogic/testCases)
    // werden als JSONB gespeichert — Minimierungspflicht liegt beim Befüller (Agent UCD-C).
    payload:              JSON.stringify({
      ucNumber:             d.ucNumber             || null,
      description:          d.description          || '',
      detectionGoal:        d.detectionGoal        || '',
      dataSources:          d.dataSources          || [],
      requiredFields:       d.requiredFields       || [],
      detectionLogic:       d.detectionLogic       || {},
      mitre:                d.mitre                || [],
      falsePositiveRisks:   d.falsePositiveRisks   || [],
      testCases:            d.testCases            || [],
      recommendedActions:   d.recommendedActions   || [],
      playbookSteps:        d.playbookSteps        || [],
    }),
    created_at: d.createdAt,
    updated_at: d.updatedAt,
  };
}

/** Postgres-Row → Domain-Objekt (als Plain JSON via toJSON()) */
function fromRow(row) {
  if (!row) return null;
  const p = row.payload || {};
  return new UseCaseDraft({
    id:                 row.id,
    ucNumber:           p.ucNumber               || null,
    title:              row.title                || '',
    sourceType:         row.source_type          || 'manual',
    sourceId:           row.source_id            || '',
    status:             row.status               || 'draft',
    severity:           row.severity             || 'medium',
    confidence:         Number(row.confidence)   || 0,
    generatedBy:        row.generated_by         || 'ollama',
    reviewedBy:         row.reviewed_by          || null,
    description:        p.description            || '',
    detectionGoal:      p.detectionGoal          || '',
    dataSources:        p.dataSources            || [],
    requiredFields:     p.requiredFields         || [],
    detectionLogic:     p.detectionLogic         || {},
    mitre:              p.mitre                  || [],
    falsePositiveRisks: p.falsePositiveRisks     || [],
    testCases:          p.testCases              || [],
    recommendedActions: p.recommendedActions     || [],
    playbookSteps:      p.playbookSteps          || [],
    createdAt:          row.created_at?.toISOString?.() || row.created_at,
    updatedAt:          row.updated_at?.toISOString?.() || row.updated_at,
  }).toJSON();
}

// ─── Repository ───────────────────────────────────────────────────────────────

class PostgresUseCaseDraftRepository {
  /** Nächste fortlaufende Use-Case-Nummer (Integer; die App formatiert UC-INC000001). */
  async nextUseCaseNumber() {
    const { rows } = await query("SELECT nextval('use_case_number_seq') AS n");
    return Number(rows[0].n);
  }

  async create(data) {
    const draft = data instanceof UseCaseDraft ? data : UseCaseDraft.create(data);
    const r     = toRow(draft);
    await query(`
      INSERT INTO use_case_drafts
        (id, title, source_type, source_id, status, severity, confidence,
         generated_by, reviewed_by, payload, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    `, [r.id, r.title, r.source_type, r.source_id, r.status, r.severity,
        r.confidence, r.generated_by, r.reviewed_by, r.payload, r.created_at, r.updated_at]);
    return this.findById(r.id);
  }

  async update(id, patch) {
    const cur = await this._raw(id);
    if (!cur) return null;
    // Lade Domain-Objekt, wende Patch an, persistiere zurück
    const draft = new UseCaseDraft(fromRow(cur));
    draft.update(patch);
    const r = toRow(draft);
    // RETURNING * spart den zweiten SELECT; updated_at setzt der DB-Trigger.
    // (source_type/source_id/generated_by sind bewusst immutabel — nicht im SET.)
    const { rows } = await query(`
      UPDATE use_case_drafts SET
        title=$2, status=$3, severity=$4, confidence=$5,
        reviewed_by=$6, payload=$7
      WHERE id=$1
      RETURNING *
    `, [id, r.title, r.status, r.severity, r.confidence, r.reviewed_by, r.payload]);
    return fromRow(rows[0]);
  }

  async findById(id) {
    return fromRow(await this._raw(id));
  }

  async findAll({ limit = 50, offset = 0 } = {}) {
    const { rows: [{ count }] } = await query('SELECT COUNT(*)::int AS count FROM use_case_drafts');
    const { rows } = await query(
      'SELECT * FROM use_case_drafts ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    return { data: rows.map(fromRow), total: count };
  }

  async findByStatus(status, { limit = 50, offset = 0 } = {}) {
    const { rows: [{ count }] } = await query('SELECT COUNT(*)::int AS count FROM use_case_drafts WHERE status=$1', [status]);
    const { rows } = await query(
      'SELECT * FROM use_case_drafts WHERE status=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [status, limit, offset]
    );
    return { data: rows.map(fromRow), total: count };
  }

  async findBySource(sourceType, sourceId, { limit = 100, offset = 0 } = {}) {
    const { rows: [{ count }] } = await query('SELECT COUNT(*)::int AS count FROM use_case_drafts WHERE source_type=$1 AND source_id=$2', [sourceType, sourceId]);
    const { rows } = await query(
      'SELECT * FROM use_case_drafts WHERE source_type=$1 AND source_id=$2 ORDER BY created_at DESC LIMIT $3 OFFSET $4',
      [sourceType, sourceId, limit, offset]
    );
    return { data: rows.map(fromRow), total: count };
  }

  // Persistiert einen Status-Übergang (Validierung erfolgt vorher in der Domain).
  async setStatus(id, status, reviewedBy) {
    const { rows } = await query(
      'UPDATE use_case_drafts SET status=$2, reviewed_by=$3 WHERE id=$1 RETURNING *',
      [id, status, reviewedBy ?? null],
    );
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async delete(id) {
    await query('DELETE FROM use_case_drafts WHERE id=$1', [id]);
  }

  // ─── intern ─────────────────────────────────────────────────────────────

  async _raw(id) {
    const { rows } = await query('SELECT * FROM use_case_drafts WHERE id=$1', [id]);
    return rows[0] || null;
  }
}

module.exports = { PostgresUseCaseDraftRepository };
