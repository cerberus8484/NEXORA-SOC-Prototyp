'use strict';

const { AgentSuggestion, KINDS } = require('../domain/AgentSuggestion');
const { build: buildBundle }     = require('../agents/bundle/EvidenceBundleBuilder');
const { metrics }                = require('../metrics/metricsRegistry');
const { agentMetrics }           = require('./AgentMetrics');
const logger                     = require('../logger');

// Provider-Name "ollama:llama3.2:3b" → { provider:"ollama", model:"llama3.2:3b" }.
function splitProviderName(name) {
  const s = String(name || 'unknown');
  const i = s.indexOf(':');
  return i > 0
    ? { provider: s.slice(0, i), model: s.slice(i + 1) }
    : { provider: s, model: s };
}

/**
 * AgentService — KI-Agent-Vorschläge + Human-Approval-Workflow (P19 Alpha).
 *
 * propose() lässt den LlmProvider einen Vorschlag erzeugen und legt ihn als
 * 'pending' ab. approve()/reject() sind die menschlichen Entscheidungen.
 * Es wird nie automatisch gehandelt.
 */
class AgentService {
  constructor({ repo, provider, audit = null, minConfidence = 0.5,
    ticketService = null, fpExceptionBuilder = null, ragService = null, wazuhApi = null,
    ragIncidentIngest = null } = {}) {
    this._repo     = repo;
    this._provider = provider;
    this._audit    = audit;
    this._minConfidence   = minConfidence;
    this._ragService      = ragService;
    this._wazuhApi        = wazuhApi;   // für Inventory-Anreicherung (OS/MAC), fail-safe
    // Optional: für Auto-FP-Regel-Vorschau beim Genehmigen (sicher, kein Wazuh-Write).
    this._ticketService      = ticketService;
    this._fpExceptionBuilder = fpExceptionBuilder;
    // Optional: genehmigte Vorschläge in die RAG-Wissensbasis einspeisen (Lernschleife).
    this._ragIncidentIngest  = ragIncidentIngest;
  }

  /**
   * Reichert das Bundle mit Asset-Inventory (OS, MAC, FQDN) aus dem Wazuh-Syscollector an.
   * Genau die Daten, die der Agent kennt, aber nicht im Alert-Payload stehen. Fail-safe.
   */
  async _enrichInventory(bundle, ticket) {
    let agentId;
    try {
      if (!this._wazuhApi || typeof this._wazuhApi.isEnabled !== 'function' || !this._wazuhApi.isEnabled()) return;
      agentId = bundle.wazuhAlert?.agentId
        || (String(ticket.offenseId || '').match(/:agent:([^:\s]+)/) || [])[1];
      if (!agentId) return;
      const inv = await this._wazuhApi.getAgentInventory(agentId);
      if (!inv) {
        logger.warn('agent_inventory_empty', { agentId, reason: 'getAgentInventory lieferte null (Wazuh-API aus oder kein Agent)' });
        return;
      }
      const os = inv.os || {};
      // Echte NIC wählen: Loopback und Null-MAC (00:00:00:00:00:00) überspringen.
      const ifaces = inv.interfaces || [];
      const realIf = ifaces.find((i) => i && i.mac
        && i.mac !== '00:00:00:00:00:00'
        && !/loopback|pseudo/i.test(i.name || '')) || {};
      // Echte IPv4 aus /netaddr (netiface liefert keine Adressen) — Loopback/Link-Local raus.
      const ipv4Row = (inv.addresses || []).find((a) => a && /ipv4/i.test(a.proto || '')
        && a.address && !/^127\.|^169\.254\./.test(a.address)) || {};
      const hostname = os.hostname || bundle.wazuhAlert?.agentName || '';
      bundle.inventory = {
        hostname,
        fqdn:      hostname,
        os:        os.os?.name || os.os_name || os.sysname || '',
        osVersion: os.os?.display_version || os.os?.version || os.version || '',
        mac:       realIf.mac || '',
        ipv4:      ipv4Row.address || (realIf.ipv4?.address || [])[0] || bundle.wazuhAlert?.agentIp || '',
      };
      // Sichtbar machen, WARUM Host-Felder leer bleiben (statt still verschlucken — Hard-Rule).
      if (!bundle.inventory.os && !bundle.inventory.mac) {
        logger.warn('agent_inventory_sparse', { agentId, reason: 'Syscollector lieferte weder OS noch MAC (Agent ohne Inventar / Manager 000?)' });
      }
    } catch (err) {
      logger.warn('agent_inventory_enrich_failed', { agentId, error: err && err.message });
    }
  }

  get minConfidence() { return this._minConfidence; }

  /**
   * Lässt den Agenten einen Vorschlag zu einem Ticket erzeugen (Status pending).
   * @param {string} [note] Optionaler Analyst-Hinweis (z. B. „Needs more context") →
   *   fließt als zusätzlicher Prompt-Abschnitt in die KI-Analyse, ändert kein Schema.
   */
  async propose({ ticket, kind = 'triage', evidence = [], note = '' }) {
    if (!ticket || !ticket.id) {
      throw Object.assign(new Error('ticket (mit id) ist Pflicht'), { status: 400 });
    }
    if (!KINDS.includes(kind)) {
      throw Object.assign(new Error(`Unbekannte kind: ${kind} — erlaubt: ${KINDS.join(', ')}`), { status: 400 });
    }
    // P18.1: EvidenceBundle bauen — normalisiert Wazuh-Alert + leitet Observations ab
    const bundle = buildBundle(ticket, evidence);
    // Asset-Inventory (OS/MAC/FQDN) aus dem Wazuh-Syscollector anreichern (fail-safe).
    await this._enrichInventory(bundle, ticket);
    // P19b: RAG-Kontext aus Qdrant (fail-safe: '' wenn disabled oder Qdrant down)
    let ragContext = '';
    if (this._ragService && this._ragService.enabled) {
      const summary = [ticket.title, ticket.description,
        bundle.wazuhAlert && bundle.wazuhAlert.ruleDescription,
        bundle.wazuhAlert && (bundle.wazuhAlert.mitreTechniques || []).join(' '),
      ].filter(Boolean).join(' — ');
      ragContext = await this._ragService.buildContext(summary);
    }
    // KI-Nutzungs-/Latenz-Metrik (in-memory, Schätzung). Messung AUSSEN um den
    // propose-Aufruf — die propose-/Floor-Logik selbst bleibt unberührt. try/finally,
    // Fehler werden weitergeworfen, der fehlgeschlagene Call wird trotzdem erfasst.
    const started = Date.now();
    let ok = false;
    let result;
    try {
      result = await this._provider.propose({ ticket, kind, evidence, bundle, ragContext, note });
      ok = true;
    } finally {
      const { provider: provName, model: provModel } = splitProviderName(this._provider && this._provider.name);
      // Prompt-Zeichen grob aus dem an den Provider gereichten Kontext schätzen;
      // Antwort-Zeichen aus proposal+rationale (echte Modell-Token kennen wir on-prem nicht).
      const promptChars = JSON.stringify({ ticket, bundle, ragContext }).length;
      const responseChars = result ? String((result.proposal || '') + (result.rationale || '')).length : 0;
      agentMetrics.record({
        provider: provName, model: provModel,
        latencyMs: Date.now() - started, ok, promptChars, responseChars,
      });
    }
    const { proposal, rationale, confidence, model, verdict, analysis } = result;
    const suggestion = new AgentSuggestion({
      ticketId: ticket.id, kind, proposal, rationale, confidence, model, verdict, analysis,
    });
    // P20: Prometheus — KI-Vorschläge nach kind + verdict.
    metrics.agentSuggestionsTotal.inc({ kind, verdict: verdict || 'unknown' });
    return this._repo.save(suggestion);
  }

  async getSuggestion(id) {
    const s = await this._repo.findById(id);
    if (!s) throw Object.assign(new Error('Suggestion nicht gefunden'), { status: 404 });
    return s;
  }

  async listSuggestions({ status, ticketId } = {}) {
    return this._repo.findAll({ status, ticketId });
  }

  /** Mensch genehmigt den Vorschlag. */
  async approve(id, userId, actorLabel = '') {
    const s = await this.getSuggestion(id);
    s.approve(userId);                 // wirft 409 wenn bereits beurteilt
    await this._repo.save(s);
    await this._writeAudit('AGENT_SUGGESTION_APPROVE', s, userId, actorLabel);
    // Bei genehmigtem False-Positive-Triage: scoped Wazuh-FP-Regel als VORSCHAU
    // erzeugen + ans Ticket hängen. KEIN Wazuh-Write, kein Restart (best-effort).
    await this._maybeAttachFpException(s, userId).catch((err) => {
      // approve darf nie brechen — aber der Fehler muss sichtbar sein (war stiller Bug).
      logger.error('fp_preview_failed', { suggestionId: s.id, ticketId: s.ticketId, message: err.message });
    });
    // Lernschleife: genehmigten Vorschlag in die RAG-Wissensbasis einspeisen.
    // Fire-and-forget, best-effort — approve darf dadurch NIE brechen.
    if (this._ragIncidentIngest) {
      this._ragIncidentIngest.ingestSuggestion(s).catch((err) => {
        logger.warn('rag_incident_ingest_failed', { suggestionId: s.id, message: err.message });
      });
    }
    return s;
  }

  /** Erzeugt bei FP-Triage die scoped FP-Regel-Vorschau und hängt sie als Ticket-Notiz an. */
  async _maybeAttachFpException(s, userId) {
    // false_positive_review: Analyst hat durch Genehmigung die FP-Entscheidung getroffen —
    // Vorschau immer, unabhängig vom KI-Verdict (Modell kann z. B. needs_more_info liefern
    // obwohl der Analyst die Lage beurteilt hat).
    // triage: Vorschau nur wenn KI ebenfalls false_positive einstuft.
    const shouldPreview =
      s.kind === 'false_positive_review' ||
      (s.kind === 'triage' && s.verdict === 'false_positive');
    if (!shouldPreview) return;
    if (!this._ticketService || !this._fpExceptionBuilder) {
      logger.warn('fp_preview_skipped', { suggestionId: s.id, reason: 'builder_not_wired' });
      return;
    }

    const ticket = await this._ticketService.findById(s.ticketId);
    if (!ticket || ticket.source !== 'wazuh') {
      logger.info('fp_preview_skipped', { suggestionId: s.id, ticketId: s.ticketId, reason: ticket ? 'ticket_not_wazuh' : 'ticket_not_found' });
      return;
    }

    // Begründung aus dem genehmigten Vorschlag — Pflichtfeld der Scope-Guardrails.
    const reason = `False-positive review approved by analyst: ${String(s.proposal || '').slice(0, 140)}`.trim();
    const result = this._fpExceptionBuilder(ticket, { reason });
    if (!result || !result.xml) {
      // Kein stiller Abbruch mehr: Log + Audit-Light, damit fehlende Previews auffallen.
      const errors = (result && result.errors) || ['unknown'];
      logger.warn('fp_preview_skipped', { suggestionId: s.id, ticketId: s.ticketId, reason: 'missing_scoped_selector', errors });
      if (this._audit) {
        await this._audit.write({
          actorUserId: userId, actorLabel: '', action: 'AGENT_FP_EXCEPTION_SKIPPED',
          targetType: 'ticket', targetId: s.ticketId,
          metadata: { suggestionId: s.id, errors },
        });
      }
      return;
    }

    const warningLines = (result.warnings || []).map((w) => `⚠ ${w}`);
    const note = [
      '[KI-Agent · genehmigt] Vorgeschlagene scoped Wazuh-FP-Exception (VORSCHAU — NICHT angewendet):',
      `Scope: ${JSON.stringify(result.scope)}`,
      ...(warningLines.length ? ['', ...warningLines] : []),
      '',
      result.xml,
      '',
      'Anwenden: Ticket → FP-Exception → Apply (admin, manuell). Kein Auto-Write/Restart.',
    ].join('\n');
    const prevNotes = ticket.notes ? `${ticket.notes}\n\n` : '';
    await this._ticketService.update(ticket.id, { notes: prevNotes + note });

    if (this._audit) {
      await this._audit.write({
        actorUserId: userId, actorLabel: '', action: 'AGENT_FP_EXCEPTION_GENERATED',
        targetType: 'ticket', targetId: s.ticketId,
        metadata: { suggestionId: s.id, ruleId: result.ruleId || '', applied: false },
      });
    }
  }

  /** Mensch lehnt den Vorschlag ab. */
  async reject(id, userId, reason = '', actorLabel = '') {
    const s = await this.getSuggestion(id);
    s.reject(userId, reason);
    await this._repo.save(s);
    await this._writeAudit('AGENT_SUGGESTION_REJECT', s, userId, actorLabel);
    return s;
  }

  async _writeAudit(action, suggestion, userId, actorLabel) {
    if (!this._audit) return;
    await this._audit.write({
      actorUserId: userId,
      actorLabel,
      action,
      targetType: 'agent_suggestion',
      targetId:   suggestion.id,
      metadata:   { ticketId: suggestion.ticketId, kind: suggestion.kind, confidence: suggestion.confidence },
    });
  }
}

module.exports = { AgentService };
