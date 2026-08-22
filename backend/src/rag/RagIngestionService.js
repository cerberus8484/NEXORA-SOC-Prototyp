'use strict';

const crypto = require('crypto');
const logger = require('../logger');
const { COLLECTIONS } = require('./RagQueryService');
const { getCatalog } = require('../threatHunting/domain/HuntType');

function stableId(key) {
  const hash = crypto.createHash('sha256').update(String(key)).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

class RagIngestionService {
  constructor({ embedder, qdrant }) {
    this._embedder = embedder;
    this._qdrant   = qdrant;
  }

  async _embedAndUpsert(collection, items) {
    if (!items.length) {
      logger.info('rag_ingest_empty', { collection });
      return 0;
    }
    // In Chunks embedden+upserten: ein einziger /api/embed-Call über hunderte
    // MITRE-Techniken (CPU-Ollama) läuft sonst ins Timeout / sprengt den RAM.
    const BATCH_SIZE = parseInt(process.env.RAG_INGEST_BATCH_SIZE || '50', 10);
    let total = 0;
    let ensured = false;
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const chunk   = items.slice(i, i + BATCH_SIZE);
      const vectors = await this._embedder.embedBatch(chunk.map((c) => c.text));
      if (!ensured) {
        await this._qdrant.ensureCollection(collection, vectors[0].length);
        ensured = true;
      }
      const points = chunk.map((it, idx) => ({
        id: stableId(it.key), vector: vectors[idx], payload: it.payload,
      }));
      await this._qdrant.upsert(collection, points);
      total += points.length;
      logger.info('rag_ingest_progress', { collection, done: total, of: items.length });
    }
    logger.info('rag_ingest_done', { collection, count: total });
    return total;
  }

  async ingestMitre(stixBundle) {
    const objects = (stixBundle && stixBundle.objects) || [];
    const items = objects
      .filter((o) => o.type === 'attack-pattern' && !o.x_mitre_deprecated && !o.revoked)
      .map((o) => {
        const ext = (o.external_references || []).find((r) => r.source_name === 'mitre-attack');
        const techniqueId = ext ? ext.external_id : '';
        const tactics   = (o.kill_chain_phases || []).map((k) => k.phase_name);
        const platforms = o.x_mitre_platforms || [];
        const name = o.name || '';
        const description = String(o.description || '').slice(0, 2000);
        return {
          key: `mitre:${techniqueId || o.id}`,
          text: `${techniqueId} ${name}\n${description}\nTactics: ${tactics.join(', ')}`,
          payload: { techniqueId, name, description, tactics, platforms },
        };
      })
      .filter((i) => i.payload.techniqueId);
    return this._embedAndUpsert(COLLECTIONS.MITRE, items);
  }

  async ingestHunts() {
    const items = getCatalog().map((h) => ({
      key: `hunt:${h.key}`,
      text: `${h.label}\n${h.description}\nKategorie: ${h.category} MITRE: ${h.mitre}`,
      payload: {
        huntKey: h.key, label: h.label, description: h.description,
        category: h.category, mitre: h.mitre, riskLevel: h.riskLevel,
        dataSources: h.dataSources,
      },
    }));
    return this._embedAndUpsert(COLLECTIONS.HUNTS, items);
  }

  async ingestIncidents(tickets) {
    const items = (tickets || []).map((t) => {
      const anon = anonymizeIncident(t);
      return {
        key: `incident:${t.id}`,
        text: `${anon.title}\n${anon.description}\nMITRE: ${anon.mitre} IOC-Typen: ${anon.iocTypes.join(', ')}`,
        payload: anon,
      };
    });
    return this._embedAndUpsert(COLLECTIONS.INCIDENTS, items);
  }
}

const IOC_PATTERNS = [
  ['url',    /\bhttps?:\/\/\S+/gi],
  ['email',  /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g],
  ['ipv4',   /\b\d{1,3}(?:\.\d{1,3}){3}\b/g],
  ['hash',   /\b[a-f0-9]{32,64}\b/gi],
  ['domain', /\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/gi],
];

function anonymizeIncident(ticket) {
  const iocTypes = new Set();
  const scrub = (s) => {
    let out = String(s ?? '');
    for (const [type, re] of IOC_PATTERNS) {
      re.lastIndex = 0;
      if (re.test(out)) {
        re.lastIndex = 0;
        iocTypes.add(type);
        out = out.replace(re, `<${type}>`);
      }
    }
    return out;
  };
  return {
    incidentRef: ticket.ticketNumber || `INC-${String(ticket.id).slice(0, 8)}`,
    title:       scrub(ticket.title),
    description: scrub(ticket.description).slice(0, 2000),
    mitre:       String(ticket.mitre || '').trim(),
    severity:    ticket.severity || ticket.priority || '',
    iocTypes:    [...iocTypes],
  };
}

module.exports = { RagIngestionService, anonymizeIncident, stableId };
