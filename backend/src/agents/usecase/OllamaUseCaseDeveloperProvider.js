'use strict';

const { RealHttpClient }          = require('../../integrations/http/RealHttpClient');
const { ServiceUnavailableError } = require('../../errors/AppError');
const { build: buildPrompt }      = require('./UseCasePromptBuilder');
const logger                      = require('../../logger');

// ── snake_case → camelCase Feldmappings ──────────────────────────────────────

/** Mappt die LLM-Antwort (snake_case-Felder) ins vereinbarte camelCase-Shape. */
function mapDetectionLogic(dl) {
  if (!dl || typeof dl !== 'object') return { language: '', queryOrRule: '', explanation: '' };
  return {
    language:    String(dl.language    || dl.queryLanguage || '').trim(),
    queryOrRule: String(dl.query_or_rule || dl.queryOrRule || dl.query || dl.rule || '').trim(),
    explanation: String(dl.explanation  || '').trim(),
  };
}

function mapMitre(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((m) => m && typeof m === 'object')
    .map((m) => ({
      tactic:    String(m.tactic    || '').trim(),
      technique: String(m.technique || '').trim(),
    }))
    .filter((m) => m.tactic || m.technique);
}

function mapTestCases(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((tc) => tc && typeof tc === 'object')
    .map((tc) => ({
      name:           String(tc.name           || '').trim(),
      type:           String(tc.type           || 'true_positive').toLowerCase(),
      event:          tc.event && typeof tc.event === 'object' ? tc.event : {},
      expectedResult: String(tc.expected_result || tc.expectedResult || '').trim(),
    }));
}

function toStringArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === 'string' && v.trim()) return [v.trim()];
  return [];
}

/**
 * Mappt ein rohes JSON-Objekt vom LLM auf das vereinbarte UseCaseDraft-Shape (camelCase).
 * Setzt status:'draft' und generatedBy:'ollama' — immer, unabhängig vom LLM-Output.
 *
 * @param {object} obj
 * @param {string} modelName
 * @returns {object} UseCaseDraft
 */
function mapToDraft(obj, modelName) {
  const confidence = Math.min(100, Math.max(0, Number(obj.confidence) || 0));
  return {
    title:           String(obj.title           || '').trim(),
    description:     String(obj.description     || '').trim(),
    detectionGoal:   String(obj.detection_goal  || obj.detectionGoal  || '').trim(),
    dataSources:     toStringArray(obj.data_sources    || obj.dataSources),
    requiredFields:  toStringArray(obj.required_fields || obj.requiredFields),
    detectionLogic:  mapDetectionLogic(obj.detection_logic || obj.detectionLogic),
    mitre:           mapMitre(obj.mitre || obj.mitre_attack),
    severity:        String(obj.severity        || 'medium').toLowerCase(),
    confidence,
    falsePositiveRisks: toStringArray(obj.false_positive_risks || obj.falsePositiveRisks),
    testCases:          mapTestCases(obj.test_cases || obj.testCases),
    recommendedActions: toStringArray(obj.recommended_actions || obj.recommendedActions),
    playbookSteps:      toStringArray(obj.playbook_steps || obj.playbookSteps),
    // Pflichtfelder — immer gesetzt, nie vom LLM überschrieben
    status:      'draft',
    generatedBy: 'ollama',
    model:       modelName,
  };
}

/**
 * Extrahiert robustes JSON aus einem LLM-Roh-String.
 * Strategie:
 *   1. Direktes JSON.parse
 *   2. Markdown-Fence-Extraktion (```json ... ```)
 *   3. Erstes { ... } mit balanciertem Klammer-Matching
 *
 * Kein Silent-Fail: wirft expliziten Fehler wenn nichts parsebar ist.
 *
 * @param {string} raw
 * @returns {object}
 * @throws {Error} wenn kein valides JSON-Objekt gefunden
 */
function extractJson(raw) {
  const text = String(raw || '').trim();

  // 1. Direkt
  try { const o = JSON.parse(text); if (o && typeof o === 'object') return o; } catch { /* weiter */ }

  // 2. Markdown-Fence
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    try { const o = JSON.parse(fenceMatch[1].trim()); if (o && typeof o === 'object') return o; } catch { /* weiter */ }
  }

  // 3. Erstes balanciertes { ... }
  const start = text.indexOf('{');
  if (start !== -1) {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') { depth--; if (depth === 0) {
        try { const o = JSON.parse(text.slice(start, i + 1)); if (o && typeof o === 'object') return o; } catch { break; }
      }}
    }
  }

  // KEIN Rohtext in der Exception-Message — die LLM-Antwort spiegelt den Kontext
  // (mögliche PII) und könnte über den errorHandler nach außen gelangen. Der
  // Aufrufer (develop) loggt eine gekürzte Probe nur server-seitig.
  throw new Error('OllamaUseCaseDeveloperProvider: LLM-Antwort enthält kein valides JSON-Objekt');
}

// ── Provider ─────────────────────────────────────────────────────────────────

/**
 * OllamaUseCaseDeveloperProvider — ruft das lokale Ollama-Modell und erzeugt
 * einen UseCaseDraft aus dem normalisierten SOC-Kontext.
 *
 * Pattern: identisch zu OllamaLlmProvider (injizierter HTTP-Client → testbar).
 * Nutzt UseCasePromptBuilder für die Prompt-Konstruktion.
 *
 * Security:
 *   - Kein untrusted Input wird als Code ausgeführt.
 *   - Timeout-geschützt (OLLAMA_TIMEOUT_MS / OLLAMA_UC_TIMEOUT_MS).
 *   - Bei Netzwerkfehler/Timeout: ServiceUnavailableError (nie Silent).
 *   - Bei kaputtem JSON: expliziter Fehler (nie Silent).
 *   - sourceType/sourceId werden NICHT vom LLM befüllt — Caller-Responsibility.
 *
 * DSGVO:
 *   - Prompt fordert synthetische Testfall-Events (keine echten PII).
 *   - Kein PII-Logging aus der Modell-Antwort.
 */
class OllamaUseCaseDeveloperProvider {
  /**
   * @param {object} opts
   * @param {string}  [opts.baseUrl]  — Ollama-API-Basis-URL (Fallback: OLLAMA_BASE_URL / 127.0.0.1:11434)
   * @param {string}  [opts.model]    — Modell-Name (Fallback: OLLAMA_MODEL / llama3.2:3b)
   * @param {object}  [opts.http]     — HttpClient-Instanz (Fallback: RealHttpClient)
   * @param {number}  [opts.timeout]  — Timeout in ms
   */
  constructor({ baseUrl, model, http, timeout } = {}) {
    const t = timeout
      ?? parseInt(process.env.OLLAMA_UC_TIMEOUT_MS || process.env.OLLAMA_TIMEOUT_MS || '120000', 10);
    this._baseUrl = (baseUrl || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
    this._model   = model   || process.env.OLLAMA_MODEL || 'llama3.2:3b';
    // TLS konfigurierbar (wie OllamaEmbedder) — nicht permanent deaktiviert, falls
    // OLLAMA_BASE_URL künftig auf HTTPS zeigt.
    this._http    = http    || new RealHttpClient({ timeout: t, rejectUnauthorized: process.env.OLLAMA_TLS_REJECT_UNAUTHORIZED === 'true' });
    this.name     = `ollama-usecase:${this._model}`;
    this._numPredict = parseInt(process.env.OLLAMA_NUM_PREDICT || '512', 10);
  }

  /**
   * Erzeugt einen UseCaseDraft aus dem SOC-Kontext.
   *
   * @param {object} context — { ticket?, finding?, evidence?, wazuhRule?, sourceType?, sourceId? }
   * @returns {Promise<object>} UseCaseDraft (camelCase, status:'draft', generatedBy:'ollama')
   * @throws {ServiceUnavailableError} wenn Ollama nicht erreichbar / Timeout
   * @throws {Error} wenn LLM-Antwort kein valides JSON enthält
   */
  async develop(context) {
    const prompt = buildPrompt(context);

    let res;
    try {
      res = await this._http.request(`${this._baseUrl}/api/generate`, {
        method: 'POST',
        body: {
          model:   this._model,
          prompt,
          stream:  false,
          format:  'json',
          options: { temperature: 0.1, num_predict: this._numPredict },
        },
      });
    } catch (err) {
      const isTimeout = /timeout|ETIMEDOUT|aborted/i.test(err.message || '');
      const code = isTimeout ? 'USECASE_LLM_TIMEOUT' : 'USECASE_LLM_UNAVAILABLE';
      const msg  = isTimeout
        ? 'Der Use-Case-Generator (Ollama) hat das Zeitlimit überschritten.'
        : 'Der Use-Case-Generator (Ollama) ist nicht erreichbar.';
      throw new ServiceUnavailableError(msg, code, err);
    }

    const raw = res.data?.response ?? (typeof res.data === 'string' ? res.data : '');
    if (!raw) throw new Error('OllamaUseCaseDeveloperProvider: leere oder fehlende response aus Ollama');
    // extractJson wirft bei kaputtem LLM-Output — kein Silent-Fail. Rohtext-Probe
    // nur server-seitig loggen (PII-Schutz), nicht in der nach außen sichtbaren Message.
    let obj;
    try {
      obj = extractJson(String(raw));
    } catch (err) {
      logger.warn('usecase_llm_bad_json', { sample: String(raw).slice(0, 200) });
      throw err;
    }
    const draft = mapToDraft(obj, this.name);

    // sourceType/sourceId aus dem Kontext übernehmen, falls übergeben
    if (context && context.sourceType) draft.sourceType = String(context.sourceType);
    if (context && context.sourceId)   draft.sourceId   = String(context.sourceId);

    return draft;
  }
}

module.exports = { OllamaUseCaseDeveloperProvider, mapToDraft, extractJson };
