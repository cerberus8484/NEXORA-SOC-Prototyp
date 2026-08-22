'use strict';

/**
 * AgentMetrics — In-Memory-Erfassung der KI-Nutzung (Provider, Modell, Latenz,
 * ok/Fehler, geschätzte Tokens, geschätzte Kosten) seit Prozess-Start.
 *
 * Low-Risk: rein additive Messung, kein Eingriff in die LLM-Logik. Wird in
 * AgentService um den propose()-Aufruf herum instrumentiert (try/finally).
 *
 * EHRLICHKEIT (ADR-009): Tokens und Kosten sind SCHÄTZUNGEN — wir haben on-prem
 * keine echte Token-Zählung. Geschätzt über (Prompt+Antwort-Zeichen)/4. Alle
 * geschätzten Felder tragen das Prefix `est`. Lokale Provider (ollama) kosten $0.
 */

// Heuristik: ~4 Zeichen ≈ 1 Token (grobe, gut dokumentierte Faustregel).
const CHARS_PER_TOKEN = 4;

/**
 * Grobe Preis-Tabelle ($ pro 1 Mio. Tokens), getrennt nach Input/Output.
 * SCHÄTZWERTE für die Kostenanzeige — NICHT abrechnungsgenau. Lokale Modelle = $0.
 * Provider-Key ist case-insensitiv; Modell-Match per Prefix, sonst Provider-Default.
 */
const PRICE_TABLE = Object.freeze({
  ollama:    { default: { in: 0, out: 0 } },
  anthropic: {
    default:               { in: 3.0,  out: 15.0 },
    'claude-3-5-haiku':    { in: 0.8,  out: 4.0 },
    'claude-3-5-sonnet':   { in: 3.0,  out: 15.0 },
    'claude-3-opus':       { in: 15.0, out: 75.0 },
  },
  openai: {
    default:    { in: 2.5,  out: 10.0 },
    'gpt-4o-mini': { in: 0.15, out: 0.6 },
    'gpt-4o':      { in: 2.5,  out: 10.0 },
  },
  google: {
    default:           { in: 1.25, out: 5.0 },
    'gemini-1.5-flash':{ in: 0.075, out: 0.3 },
    'gemini-1.5-pro':  { in: 1.25, out: 5.0 },
  },
});

/** Schätzt Tokens aus einer Zeichenanzahl (>= 0, ganzzahlig). */
function estimateTokens(charCount) {
  const n = Number(charCount);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n / CHARS_PER_TOKEN);
}

/** Wählt den Preis-Eintrag für Provider/Modell (Prefix-Match, sonst Default, sonst $0). */
function priceFor(provider, model) {
  const p = PRICE_TABLE[String(provider || '').toLowerCase()];
  if (!p) return { in: 0, out: 0 };
  const m = String(model || '').toLowerCase();
  for (const key of Object.keys(p)) {
    if (key !== 'default' && m.startsWith(key)) return p[key];
  }
  return p.default || { in: 0, out: 0 };
}

/** Geschätzte Kosten in USD aus Prompt-/Completion-Tokens (Schätzung). */
function estimateCostUsd(provider, model, promptTokens, completionTokens) {
  const price = priceFor(provider, model);
  const cost = (promptTokens / 1e6) * price.in + (completionTokens / 1e6) * price.out;
  return Number.isFinite(cost) ? cost : 0;
}

/** Leerer Aggregat-Bucket (Provider/Modell-Ebene). */
function emptyBucket(provider, model) {
  return {
    provider, model,
    calls: 0, errors: 0,
    totalLatencyMs: 0,
    estPromptTokens: 0,
    estCompletionTokens: 0,
    estCostUsd: 0,
  };
}

/** Runden auf 6 Nachkommastellen — Kosten sind klein (Mikro-Dollar). */
const round6 = (n) => Math.round((Number(n) || 0) * 1e6) / 1e6;

class AgentMetrics {
  constructor() {
    this.reset();
  }

  /** Setzt alle Zähler zurück (auch der sinceBoot-Zeitstempel). Für Tests + Boot. */
  reset() {
    this._sinceBoot = new Date().toISOString();
    this._totals = { calls: 0, errors: 0, totalLatencyMs: 0, estPromptTokens: 0, estCompletionTokens: 0, estCostUsd: 0 };
    this._byKey = new Map(); // "provider|model" → bucket
  }

  /**
   * Erfasst genau einen LLM-Call.
   *
   * @param {object}  p
   * @param {string}  p.provider     Provider-Name (z.B. "ollama", "anthropic")
   * @param {string}  p.model        Modell-Name
   * @param {number}  p.latencyMs    Gemessene Latenz in ms
   * @param {boolean} p.ok           true = erfolgreich, false = Fehler
   * @param {number} [p.promptChars] Zeichenanzahl des Prompts (für Token-Schätzung)
   * @param {number} [p.responseChars] Zeichenanzahl der Antwort (für Token-Schätzung)
   */
  record({ provider, model, latencyMs, ok, promptChars = 0, responseChars = 0 } = {}) {
    const prov = String(provider || 'unknown');
    const mod  = String(model || 'unknown');
    const lat  = Math.max(0, Number(latencyMs) || 0);
    const promptTokens     = estimateTokens(promptChars);
    const completionTokens = estimateTokens(responseChars);
    const cost = estimateCostUsd(prov, mod, promptTokens, completionTokens);

    const key = `${prov}|${mod}`;
    const bucket = this._byKey.get(key) || emptyBucket(prov, mod);
    bucket.calls += 1;
    if (!ok) bucket.errors += 1;
    bucket.totalLatencyMs    += lat;
    bucket.estPromptTokens     += promptTokens;
    bucket.estCompletionTokens += completionTokens;
    bucket.estCostUsd          += cost;
    this._byKey.set(key, bucket);

    const t = this._totals;
    t.calls += 1;
    if (!ok) t.errors += 1;
    t.totalLatencyMs      += lat;
    t.estPromptTokens       += promptTokens;
    t.estCompletionTokens   += completionTokens;
    t.estCostUsd            += cost;
  }

  /** Liefert das aggregierte Snapshot-Objekt (read-only Sicht für die Route). */
  snapshot() {
    const t = this._totals;
    const avg = (sum, n) => (n > 0 ? Math.round(sum / n) : 0);
    return {
      sinceBoot: this._sinceBoot,
      estimated: true, // Tokens & Kosten sind Schätzungen, nicht abrechnungsgenau.
      totals: {
        calls: t.calls,
        errors: t.errors,
        avgLatencyMs: avg(t.totalLatencyMs, t.calls),
        estPromptTokens: t.estPromptTokens,
        estCompletionTokens: t.estCompletionTokens,
        estCostUsd: round6(t.estCostUsd),
      },
      byProvider: [...this._byKey.values()].map((b) => ({
        provider: b.provider,
        model: b.model,
        calls: b.calls,
        errors: b.errors,
        avgLatencyMs: avg(b.totalLatencyMs, b.calls),
        estTokens: b.estPromptTokens + b.estCompletionTokens,
        estCostUsd: round6(b.estCostUsd),
      })),
    };
  }
}

// Prozess-weiter Singleton (in-memory, seit Boot).
const agentMetrics = new AgentMetrics();

module.exports = { AgentMetrics, agentMetrics, estimateTokens, estimateCostUsd, CHARS_PER_TOKEN };
