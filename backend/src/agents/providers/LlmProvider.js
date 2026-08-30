'use strict';

/**
 * LlmProvider — Adapter-Interface für den KI-Agenten (Projekt-Hardrule:
 * "No integration without an adapter layer").
 *
 * Implementierungen:
 *   - StubLlmProvider   → deterministisch, kein externes Modell (Tests/Dev, P19 Alpha)
 *   - OllamaLlmProvider → lokales Llama 3.1 8B (P19a–c, folgt)
 *
 * Vertrag:
 *   async propose({ ticket, kind }) → { proposal, rationale, confidence, model }
 */
class LlmProvider {
  // eslint-disable-next-line no-unused-vars
  async propose({ ticket, kind }) {
    throw new Error('LlmProvider.propose() nicht implementiert');
  }
}

module.exports = { LlmProvider };
