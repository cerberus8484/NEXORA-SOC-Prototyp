'use strict';

const {
  SCHEMA_VERSION,
  DEFAULT_POLICY,
  buildRoutingPolicy,
  renderRoutingPolicyMarkdown,
  classifyRouting,
  routingAdvisory,
  decorateWithRouting,
} = require('../../src/domain/mlRoutingPolicy');

// Minimal, realistische Fixtures angelehnt an echte Artefakte
// (artifacts/ml-eval/247968fbba1c/{baseline-run,policy-comparison}.json).
function readyRunManifest(overrides = {}) {
  return {
    runName: 'ml-eval-test-run',
    status: 'ready',
    blockers: [],
    dataset: {
      datasetName: 'ml-eval-test',
      datasetSha256: 'abc123def456',
      generatedAt: '2026-06-29T16:11:58.215Z',
    },
    split: {
      counts: { train: 16, validation: 2, test: 2, total: 20 },
      splitSha256: { train: 't-sha', validation: 'v-sha', test: 'x-sha' },
    },
    gates: {
      routingGate: {
        status: 'pass',
        gate: { minAgreement: 0.8, minCoverage: 0.5, minGoldRecords: 20 },
        selectedThreshold: 0,
        failures: [],
      },
    },
    ...overrides,
  };
}

function thresholdRow(threshold, agreement, coverage) {
  const metrics = {
    threshold,
    total: 2,
    comparable: 2,
    accepted: 2,
    routedToReview: 0,
    correct: 2,
    agreement,
    coverage,
  };
  return { threshold, train: { ...metrics, total: 16, correct: 15, agreement: 0.9375 }, validation: metrics, test: metrics };
}

function okComparison(overrides = {}) {
  const conservativeSelected = thresholdRow(0.7, 1, 1);
  const aggressiveSelected = thresholdRow(0, 1, 1);
  return {
    summary: {
      runName: 'ml-eval-test-run',
      generatedAt: '2026-06-29T16:21:04.267Z',
      status: 'ok',
      policies: [
        { policy: 'max_validation_agreement', recommendedThreshold: 0, blockers: [] },
        { policy: 'conservative_review_bias', recommendedThreshold: 0.7, blockers: [] },
      ],
    },
    comparisons: [
      {
        runName: 'ml-eval-test-run',
        status: 'ok',
        blockers: [],
        policy: 'max_validation_agreement',
        recommendedThreshold: 0,
        selectedByValidation: aggressiveSelected,
        thresholds: [aggressiveSelected],
      },
      {
        runName: 'ml-eval-test-run',
        status: 'ok',
        blockers: [],
        policy: 'conservative_review_bias',
        recommendedThreshold: 0.7,
        selectedByValidation: conservativeSelected,
        thresholds: [conservativeSelected],
      },
    ],
    ...overrides,
  };
}

describe('mlRoutingPolicy.buildRoutingPolicy', () => {
  test('requires policyComparison and runManifest', () => {
    expect(() => buildRoutingPolicy({ runManifest: readyRunManifest() })).toThrow(/policyComparison/);
    expect(() => buildRoutingPolicy({ policyComparison: okComparison() })).toThrow(/runManifest/);
  });

  test('defaults to the conservative_review_bias policy (review-on-uncertainty for a SOC)', () => {
    expect(DEFAULT_POLICY).toBe('conservative_review_bias');
  });

  test('builds a ready, deployable policy with provenance and metrics', () => {
    const policy = buildRoutingPolicy({
      policyComparison: okComparison(),
      runManifest: readyRunManifest(),
    });

    expect(policy.schemaVersion).toBe(SCHEMA_VERSION);
    expect(policy.status).toBe('ready');
    expect(policy.policyName).toBe('conservative_review_bias');
    expect(policy.recommendedThreshold).toBe(0.7);
    expect(policy.blockers).toEqual([]);

    // Provenance — reproduzierbar & prüfbar
    expect(policy.provenance.datasetSha256).toBe('abc123def456');
    expect(policy.provenance.runName).toBe('ml-eval-test-run');
    expect(policy.provenance.splitSha256).toEqual({ train: 't-sha', validation: 'v-sha', test: 'x-sha' });
    expect(policy.provenance.routingGate.status).toBe('pass');

    // Metriken aus selectedByValidation
    expect(policy.metrics.validation.agreement).toBe(1);
    expect(policy.metrics.test.coverage).toBe(1);
    expect(policy.metrics.train.total).toBe(16);

    // Rationale erklärt die Routing-Semantik
    expect(policy.rationale).toMatch(/0\.7/);
    expect(policy.rationale).toMatch(/review/i);
  });

  test('honours an explicit policy override (aggressive)', () => {
    const policy = buildRoutingPolicy({
      policyComparison: okComparison(),
      runManifest: readyRunManifest(),
      policy: 'max_validation_agreement',
    });
    expect(policy.policyName).toBe('max_validation_agreement');
    expect(policy.recommendedThreshold).toBe(0);
  });

  test('fail-closed: blocked run yields a blocked policy with no threshold', () => {
    const policy = buildRoutingPolicy({
      policyComparison: okComparison(),
      runManifest: readyRunManifest({ status: 'blocked', blockers: ['routing_gate_fail'] }),
    });
    expect(policy.status).toBe('blocked');
    expect(policy.recommendedThreshold).toBeNull();
    expect(policy.blockers).toContain('run_not_ready');
    expect(policy.metrics).toBeNull();
    // Provenance bleibt zur Nachvollziehbarkeit erhalten
    expect(policy.provenance.runName).toBe('ml-eval-test-run');
  });

  test('fail-closed: blocked comparison yields a blocked policy', () => {
    const blocked = okComparison({ summary: { ...okComparison().summary, status: 'blocked' } });
    const policy = buildRoutingPolicy({ policyComparison: blocked, runManifest: readyRunManifest() });
    expect(policy.status).toBe('blocked');
    expect(policy.blockers).toContain('policy_comparison_blocked');
  });

  test('fail-closed: unknown policy name yields a blocked policy', () => {
    const policy = buildRoutingPolicy({
      policyComparison: okComparison(),
      runManifest: readyRunManifest(),
      policy: 'does_not_exist',
    });
    expect(policy.status).toBe('blocked');
    expect(policy.blockers.some((b) => b.startsWith('policy_not_found'))).toBe(true);
  });
});

describe('mlRoutingPolicy.renderRoutingPolicyMarkdown', () => {
  test('renders a human-readable policy summary', () => {
    const md = renderRoutingPolicyMarkdown(
      buildRoutingPolicy({ policyComparison: okComparison(), runManifest: readyRunManifest() }),
    );
    expect(md).toMatch(/# Nexora ML Routing Policy/);
    expect(md).toMatch(/conservative_review_bias/);
    expect(md).toMatch(/>=0\.7/);
    expect(md).toMatch(/Status: ready/);
  });

  test('renders blockers for a blocked policy', () => {
    const md = renderRoutingPolicyMarkdown(
      buildRoutingPolicy({
        policyComparison: okComparison(),
        runManifest: readyRunManifest({ status: 'blocked', blockers: [] }),
      }),
    );
    expect(md).toMatch(/Status: blocked/);
    expect(md).toMatch(/run_not_ready/);
  });
});

describe('mlRoutingPolicy.classifyRouting', () => {
  test('confidence at or above threshold → auto_accept_eligible', () => {
    expect(classifyRouting(0.7, 0.7)).toBe('auto_accept_eligible');
    expect(classifyRouting(0.95, 0.7)).toBe('auto_accept_eligible');
  });

  test('confidence below threshold → route_to_review', () => {
    expect(classifyRouting(0.5, 0.7)).toBe('route_to_review');
    expect(classifyRouting(0, 0.7)).toBe('route_to_review');
  });

  test('non-finite inputs → unknown (never guess)', () => {
    expect(classifyRouting(undefined, 0.7)).toBe('unknown');
    expect(classifyRouting(null, 0.7)).toBe('unknown');
    expect(classifyRouting(0.7, undefined)).toBe('unknown');
    expect(classifyRouting('n/a', 0.7)).toBe('unknown');
  });
});

describe('mlRoutingPolicy.routingAdvisory', () => {
  const active = { active: true, policyName: 'conservative_review_bias', threshold: 0.7 };

  test('inactive/missing policy → null (fail-safe)', () => {
    expect(routingAdvisory(0.9, null)).toBeNull();
    expect(routingAdvisory(0.9, { active: false })).toBeNull();
    expect(routingAdvisory(0.9, undefined)).toBeNull();
  });

  test('active policy → advisory with recommendation + provenance', () => {
    expect(routingAdvisory(0.9, active)).toEqual({
      policyName: 'conservative_review_bias',
      threshold: 0.7,
      recommendation: 'auto_accept_eligible',
      source: 'ml-routing-policy',
    });
    expect(routingAdvisory(0.4, active).recommendation).toBe('route_to_review');
  });
});

describe('mlRoutingPolicy.decorateWithRouting', () => {
  const active = { active: true, policyName: 'conservative_review_bias', threshold: 0.7 };

  test('active policy adds an immutable routing field', () => {
    const json = { id: 's1', confidence: 0.8 };
    const decorated = decorateWithRouting(json, active);
    expect(decorated.routing.recommendation).toBe('auto_accept_eligible');
    expect(decorated).not.toBe(json);
    expect(json.routing).toBeUndefined(); // Original unverändert
  });

  test('inactive policy returns the json unchanged', () => {
    const json = { id: 's1', confidence: 0.8 };
    expect(decorateWithRouting(json, { active: false })).toBe(json);
  });
});
