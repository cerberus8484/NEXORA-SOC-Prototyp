'use strict';

const { AgentService } = require('./AgentService');
const { FallbackLlmProvider } = require('../agents/providers/llmProviderFactory');
const { createAgentSuggestionRepository } = require('../repositories/agentSuggestionRepositoryFactory');
const { auditService } = require('./AuditService');
const { ticketService } = require('./TicketService');
const { normalizeWazuhEvidence } = require('../integrations/adapters/wazuh/wazuhEvidenceNormalizer');
const { buildFpException, scopeFromEvidence } = require('../integrations/adapters/wazuh/wazuhRuleExceptionBuilder');
const { OllamaEmbedder } = require('../rag/OllamaEmbedder');
const { QdrantClient } = require('../rag/QdrantClient');
const { RagQueryService } = require('../rag/RagQueryService');
const { RagIncidentIngestService } = require('../rag/RagIncidentIngestService');

/**
 * Erzeugt aus einem Wazuh-Ticket die scoped FP-Exception-VORSCHAU (kein Write).
 * Wird beim Genehmigen eines FP-Triage-Vorschlags genutzt.
 * @param {object} ticket   Domain-Ticket (toJSON-Form)
 * @param {{ reason?: string }} context  Begründung aus dem genehmigten KI-Vorschlag
 * @returns {{ scope, xml, ruleId, warnings, applyBlocked } | { skipped: true, errors }}
 */
function fpExceptionBuilder(ticket, context = {}) {
  if (!ticket || ticket.source !== 'wazuh') return { skipped: true, errors: ['ticket_not_wazuh'] };
  const evidence = normalizeWazuhEvidence(ticket);
  const scope = evidence ? scopeFromEvidence(evidence, ticket) : null;
  if (!scope) return { skipped: true, errors: ['no_evidence_scope'] };
  // reason kommt aus dem genehmigten Vorschlag; ohne explizite Begründung eine
  // sichere generische (Pflichtfeld der Guardrails — sonst nie eine Vorschau).
  scope.reason = String(context.reason || '').trim() || 'False-positive review approved by analyst';
  const result = buildFpException({ ...scope, ticketId: ticket.id });
  if (!result || !result.ok || !result.xml) return { skipped: true, errors: result?.errors || ['build_failed'] };
  return { scope, xml: result.xml, ruleId: result.ruleId, warnings: result.warnings || [], applyBlocked: !!result.applyBlocked };
}

// RAG: nur bauen wenn RAG_ENABLED=true (default false — kein Qdrant nötig für normalen Betrieb)
const ragService = process.env.RAG_ENABLED === 'true'
  ? new RagQueryService({ embedder: new OllamaEmbedder({}), qdrant: new QdrantClient({}) })
  : null;

// Lernschleife: genehmigte Vorschläge in die RAG-Wissensbasis einspeisen (gleicher Gate).
const ragIncidentIngest = process.env.RAG_ENABLED === 'true'
  ? new RagIncidentIngestService({ embedder: new OllamaEmbedder({}), qdrant: new QdrantClient({}) })
  : null;

// Provider settings-bewusst zur Laufzeit wählbar: stub (Default) · ollama · anthropic · openai · google.
// Die UI-Auswahl (Settings → KI) wirkt live; API-Keys kommen ausschließlich aus der Umgebung.
const { wazuhApiClient } = require('../integrations/adapters/wazuh/wazuhApiInstance');

const agentService = new AgentService({
  repo: createAgentSuggestionRepository(),
  provider: new FallbackLlmProvider(),
  audit: auditService,
  minConfidence: 0.5,
  ticketService,
  fpExceptionBuilder,
  ragService,
  ragIncidentIngest,
  wazuhApi: wazuhApiClient,
});

module.exports = { agentService };
