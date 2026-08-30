'use strict';

const {
  mapAgentSuggestionToEvalRecord,
  mapTicketToEvalRecord,
  buildSnapshotMeta,
  toJsonl,
} = require('../domain/mlEvalSnapshot');

const MAX_EXPORT_LIMIT = 1000;

function normalizeLimit(limit) {
  const n = Number(limit) || 100;
  return Math.max(1, Math.min(n, MAX_EXPORT_LIMIT));
}

class MlEvalExportService {
  constructor({ agentSuggestionRepo, ticketRepo } = {}) {
    this._agentSuggestionRepo = agentSuggestionRepo;
    this._ticketRepo = ticketRepo;
  }

  async buildSnapshot({ include = 'all', limit = 100 } = {}) {
    const max = normalizeLimit(limit);
    const records = [];
    const counts = { agent_suggestion: 0, ticket: 0 };
    const remaining = () => max - records.length;

    if ((include === 'all' || include === 'agent_suggestions') && this._agentSuggestionRepo) {
      for (const status of ['approved', 'rejected']) {
        if (remaining() <= 0) break;
        const suggestions = await this._agentSuggestionRepo.findAll({ status, limit: remaining(), offset: 0 });
        for (const suggestion of suggestions) {
          if (remaining() <= 0) break;
          records.push(mapAgentSuggestionToEvalRecord(suggestion));
          counts.agent_suggestion += 1;
        }
      }
    }

    if ((include === 'all' || include === 'tickets') && this._ticketRepo && remaining() > 0) {
      const result = await this._ticketRepo.findAll({
        state: 'CLOSED',
        limit: remaining(),
        offset: 0,
        sort: 'updatedAt',
        order: 'desc',
      });
      const tickets = Array.isArray(result) ? result : result.data || [];
      for (const ticket of tickets) {
        if (remaining() <= 0) break;
        records.push(mapTicketToEvalRecord(ticket));
        counts.ticket += 1;
      }
    }

    return {
      ...buildSnapshotMeta(records),
      records,
      returned: records.length,
      counts,
      exportLimit: max,
      include,
    };
  }

  async buildJsonl(options = {}) {
    const snapshot = await this.buildSnapshot(options);
    return { ...snapshot, body: toJsonl(snapshot.records) };
  }
}

module.exports = { MlEvalExportService, MAX_EXPORT_LIMIT, normalizeLimit };
