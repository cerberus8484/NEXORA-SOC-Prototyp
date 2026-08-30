'use strict';

const { query }              = require('../db/pool');
const { PublishedDetection } = require('../domain/PublishedDetection');

// ─── Row-Mapping ──────────────────────────────────────────────────────────────

function fromRow(row) {
  if (!row) return null;
  return new PublishedDetection({
    id:          row.id,
    draftId:     row.draft_id     || '',
    title:       row.title        || '',
    language:    row.language     || 'generic',
    rule:        row.rule         || '',
    explanation: row.explanation  || '',
    mitre:       Array.isArray(row.mitre) ? row.mitre : (row.mitre || []),
    severity:    row.severity     || 'medium',
    sourceType:  row.source_type  || '',
    sourceId:    row.source_id    || '',
    publishedBy: row.published_by || '',
    createdAt:   row.created_at?.toISOString?.() || row.created_at,
  }).toJSON();
}

// ─── Repository ───────────────────────────────────────────────────────────────

class PostgresPublishedDetectionRepository {
  /**
   * Legt einen neuen Detection-Eintrag an (idempotent via ON CONFLICT DO NOTHING).
   * Falls für diese draftId bereits ein Eintrag existiert, wird nichts überschrieben
   * und der bestehende Eintrag zurückgegeben.
   */
  async create(detection) {
    const pd = detection instanceof PublishedDetection
      ? detection
      : new PublishedDetection(detection);

    const { rows } = await query(`
      INSERT INTO published_detections
        (id, draft_id, title, language, rule, explanation,
         mitre, severity, source_type, source_id, published_by, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12)
      ON CONFLICT (draft_id) DO NOTHING
      RETURNING *
    `, [
      pd.id,
      pd.draftId,
      pd.title,
      pd.language,
      pd.rule,
      pd.explanation,
      JSON.stringify(pd.mitre),
      pd.severity,
      pd.sourceType,
      pd.sourceId,
      pd.publishedBy,
      pd.createdAt,
    ]);

    // ON CONFLICT DO NOTHING → kein RETURNING → existierenden Eintrag laden
    if (rows[0]) return fromRow(rows[0]);
    return this.findByDraftId(pd.draftId);
  }

  async findByDraftId(draftId) {
    const { rows } = await query(
      'SELECT * FROM published_detections WHERE draft_id = $1',
      [draftId]
    );
    return fromRow(rows[0] || null);
  }

  async findAll({ limit = 50, offset = 0 } = {}) {
    const { rows: [{ count }] } = await query(
      'SELECT COUNT(*)::int AS count FROM published_detections'
    );
    const { rows } = await query(
      'SELECT * FROM published_detections ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    return { data: rows.map(fromRow), total: count };
  }
}

module.exports = { PostgresPublishedDetectionRepository };
