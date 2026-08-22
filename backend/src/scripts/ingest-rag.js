'use strict';

// Manueller + Cron-fähiger RAG-Ingest. Idempotent.
//   node src/scripts/ingest-rag.js
//   node src/scripts/ingest-rag.js --mitre /pfad/enterprise-attack.json

require('dotenv').config();

const fs = require('fs');
const logger = require('../logger');
const config = require('../config');
const { OllamaEmbedder } = require('../rag/OllamaEmbedder');
const { QdrantClient } = require('../rag/QdrantClient');
const { RagIngestionService } = require('../rag/RagIngestionService');

async function loadClosedHighIncidents() {
  if (!config.db.enabled) return [];
  const { query } = require('../db/pool');
  const res = await query(
    `SELECT id, ticket_number AS "ticketNumber", title, analysis AS description, '' AS mitre, priority AS severity
       FROM tickets
      WHERE status = 'closed' AND priority IN ('high', 'critical')
      LIMIT 1000`);
  return res.rows;
}

(async () => {
  try {
    const embedder = new OllamaEmbedder({});
    const qdrant   = new QdrantClient({});
    const svc = new RagIngestionService({ embedder, qdrant });

    const mitreIdx = process.argv.indexOf('--mitre');
    if (mitreIdx !== -1 && process.argv[mitreIdx + 1]) {
      const bundle = JSON.parse(fs.readFileSync(process.argv[mitreIdx + 1], 'utf8'));
      const n = await svc.ingestMitre(bundle);
      logger.info('rag_mitre_ingested', { count: n });
    }

    await svc.ingestHunts();

    const incidents = await loadClosedHighIncidents();
    await svc.ingestIncidents(incidents);

    logger.info('rag_ingest_complete');
    process.exit(0);
  } catch (err) {
    logger.error('rag_ingest_failed', { message: err.message, stack: err.stack });
    process.exit(1);
  }
})();
