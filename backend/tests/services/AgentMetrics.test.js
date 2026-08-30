'use strict';

const { AgentMetrics, estimateTokens, estimateCostUsd } = require('../../src/services/AgentMetrics');

describe('AgentMetrics — Token-Schätzung', () => {
  it('schätzt ~1 Token je 4 Zeichen (aufgerundet)', () => {
    expect(estimateTokens(0)).toBe(0);
    expect(estimateTokens(4)).toBe(1);
    expect(estimateTokens(5)).toBe(2);
    expect(estimateTokens(400)).toBe(100);
  });

  it('liefert 0 bei ungültiger Eingabe', () => {
    expect(estimateTokens(-10)).toBe(0);
    expect(estimateTokens('abc')).toBe(0);
    expect(estimateTokens(undefined)).toBe(0);
  });
});

describe('AgentMetrics — Kosten-Schätzung', () => {
  it('lokaler Provider (ollama) kostet $0', () => {
    expect(estimateCostUsd('ollama', 'llama3.2:3b', 100000, 100000)).toBe(0);
  });

  it('Cloud-Provider liefert positive Schätzkosten', () => {
    const cost = estimateCostUsd('anthropic', 'claude-3-5-sonnet', 1e6, 1e6);
    expect(cost).toBeGreaterThan(0);
    // 1M in @ $3 + 1M out @ $15 = $18 (Schätzung)
    expect(cost).toBeCloseTo(18, 5);
  });

  it('unbekannter Provider → $0 (kein Phantasie-Preis)', () => {
    expect(estimateCostUsd('mystery', 'x', 1e6, 1e6)).toBe(0);
  });
});

describe('AgentMetrics — record/aggregate', () => {
  let m;
  beforeEach(() => { m = new AgentMetrics(); });

  it('startet leer mit sinceBoot + estimated-Flag', () => {
    const s = m.snapshot();
    expect(s.totals.calls).toBe(0);
    expect(s.totals.errors).toBe(0);
    expect(s.byProvider).toEqual([]);
    expect(s.estimated).toBe(true);
    expect(typeof s.sinceBoot).toBe('string');
  });

  it('zählt Calls, Fehler und mittelt Latenz', () => {
    m.record({ provider: 'ollama', model: 'llama3.2:3b', latencyMs: 100, ok: true, promptChars: 400, responseChars: 40 });
    m.record({ provider: 'ollama', model: 'llama3.2:3b', latencyMs: 300, ok: false, promptChars: 400, responseChars: 0 });
    const s = m.snapshot();
    expect(s.totals.calls).toBe(2);
    expect(s.totals.errors).toBe(1);
    expect(s.totals.avgLatencyMs).toBe(200); // (100+300)/2
    expect(s.totals.estPromptTokens).toBe(200); // (400+400)/4
    expect(s.totals.estCompletionTokens).toBe(10); // 40/4
  });

  it('gruppiert nach provider|model', () => {
    m.record({ provider: 'ollama', model: 'a', latencyMs: 10, ok: true });
    m.record({ provider: 'anthropic', model: 'claude-3-5-sonnet', latencyMs: 20, ok: true, promptChars: 4e6, responseChars: 0 });
    const s = m.snapshot();
    expect(s.byProvider).toHaveLength(2);
    const cloud = s.byProvider.find((b) => b.provider === 'anthropic');
    expect(cloud.calls).toBe(1);
    expect(cloud.estCostUsd).toBeGreaterThan(0); // 1M Input-Tokens × $3 = $3
  });

  it('reset() leert die Zähler und setzt sinceBoot neu', async () => {
    m.record({ provider: 'ollama', model: 'a', latencyMs: 10, ok: true });
    const before = m.snapshot().sinceBoot;
    await new Promise((r) => setTimeout(r, 5));
    m.reset();
    const s = m.snapshot();
    expect(s.totals.calls).toBe(0);
    expect(s.byProvider).toEqual([]);
    expect(s.sinceBoot >= before).toBe(true);
  });

  it('ok=false bei fehlendem Result trotzdem als Fehler-Call erfasst', () => {
    m.record({ provider: 'ollama', model: 'a', latencyMs: 50, ok: false });
    const s = m.snapshot();
    expect(s.totals.calls).toBe(1);
    expect(s.totals.errors).toBe(1);
  });
});
