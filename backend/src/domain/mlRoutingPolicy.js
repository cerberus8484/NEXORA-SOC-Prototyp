'use strict';

// Baut aus einem Policy-Vergleich (mlEvalThresholdComparison / Policy-Compare-CLI)
// und dem zugehörigen Run-Manifest ein DEPLOYBARES Routing-Policy-Artefakt:
// genau EINE gewählte Policy, ein Akzeptanz-Threshold, vollständige Provenance
// (Dataset-/Split-SHA, Routing-Gate) und die belegenden Validation/Test-Metriken.
//
// Semantik des Thresholds: Agent-Vorschläge mit confidence >= threshold werden
// auto-akzeptiert, darunter an die menschliche Review geroutet.
//
// Fail-closed: blockierter Run/Vergleich oder unbekannte Policy → status 'blocked',
// kein Threshold. Niemals erfundene Metriken.

const SCHEMA_VERSION = 'nexora.ml.routing-policy.v1';

// Default ist die konservative Policy: im Zweifel an die menschliche Review —
// für ein SOC-Werkzeug die sicherere Produktions-Voreinstellung.
const DEFAULT_POLICY = 'conservative_review_bias';

function selectComparison(policyComparison, policyName) {
  const comparisons = policyComparison?.comparisons || [];
  return comparisons.find((entry) => entry.policy === policyName) || null;
}

function pickMetrics(splitMetrics) {
  if (!splitMetrics) return null;
  return {
    threshold: splitMetrics.threshold,
    total: splitMetrics.total,
    accepted: splitMetrics.accepted,
    routedToReview: splitMetrics.routedToReview,
    correct: splitMetrics.correct,
    agreement: splitMetrics.agreement,
    coverage: splitMetrics.coverage,
  };
}

function buildProvenance(runManifest, policyComparison) {
  return {
    runName: runManifest.runName,
    datasetName: runManifest.dataset?.datasetName ?? null,
    datasetSha256: runManifest.dataset?.datasetSha256 ?? null,
    splitSha256: runManifest.split?.splitSha256 ?? null,
    splitCounts: runManifest.split?.counts ?? null,
    comparisonGeneratedAt: policyComparison.summary?.generatedAt ?? null,
    routingGate: runManifest.gates?.routingGate ?? null,
  };
}

function buildRationale(policyName, threshold, selected) {
  const v = selected?.validation || {};
  const t = selected?.test || {};
  const fmt = (value) => (value === null || value === undefined ? 'n/a' : value);
  return (
    `Policy '${policyName}' wählt Akzeptanz-Threshold >=${threshold}: ` +
    `Agent-Vorschläge mit confidence >=${threshold} werden auto-akzeptiert, ` +
    'darunter an die menschliche Review geroutet. ' +
    `Belegt durch Validation (agreement=${fmt(v.agreement)}, coverage=${fmt(v.coverage)}, n=${fmt(v.total)}) ` +
    `und Test (agreement=${fmt(t.agreement)}, coverage=${fmt(t.coverage)}, n=${fmt(t.total)}).`
  );
}

function collectBlockers({ policyComparison, comparison, runManifest, policyName }) {
  const blockers = [];
  if (runManifest.status !== 'ready') blockers.push('run_not_ready');
  if (policyComparison.summary?.status && policyComparison.summary.status !== 'ok') {
    blockers.push('policy_comparison_blocked');
  }
  if (!comparison) {
    blockers.push(`policy_not_found:${policyName}`);
    return blockers;
  }
  if (comparison.status && comparison.status !== 'ok') blockers.push('selected_policy_blocked');
  if (comparison.recommendedThreshold === null || comparison.recommendedThreshold === undefined) {
    blockers.push('no_recommended_threshold');
  }
  return blockers;
}

function buildRoutingPolicy({ policyComparison, runManifest, policy = DEFAULT_POLICY } = {}) {
  if (!policyComparison) throw new Error('policyComparison is required');
  if (!runManifest) throw new Error('runManifest is required');

  const policyName = policy || DEFAULT_POLICY;
  const comparison = selectComparison(policyComparison, policyName);
  const blockers = collectBlockers({ policyComparison, comparison, runManifest, policyName });
  const provenance = buildProvenance(runManifest, policyComparison);

  if (blockers.length) {
    return {
      schemaVersion: SCHEMA_VERSION,
      status: 'blocked',
      generatedAt: new Date().toISOString(),
      policyName,
      recommendedThreshold: null,
      rationale: 'Policy-Export blockiert — siehe blockers.',
      provenance,
      metrics: null,
      blockers,
    };
  }

  const selected = comparison.selectedByValidation || {};
  const threshold = comparison.recommendedThreshold;

  return {
    schemaVersion: SCHEMA_VERSION,
    status: 'ready',
    generatedAt: new Date().toISOString(),
    policyName,
    recommendedThreshold: threshold,
    rationale: buildRationale(policyName, threshold, selected),
    provenance,
    metrics: {
      train: pickMetrics(selected.train),
      validation: pickMetrics(selected.validation),
      test: pickMetrics(selected.test),
    },
    blockers: [],
  };
}

function renderRoutingPolicyMarkdown(policy) {
  const lines = [
    '# Nexora ML Routing Policy',
    '',
    `Schema: ${policy.schemaVersion}`,
    `Status: ${policy.status}`,
    `Policy: ${policy.policyName}`,
  ];
  if (policy.recommendedThreshold !== null && policy.recommendedThreshold !== undefined) {
    lines.push(`Accept threshold: >=${policy.recommendedThreshold}`);
  }
  lines.push('', '## Provenance', '');
  lines.push(`- run=${policy.provenance.runName}`);
  lines.push(`- dataset=${policy.provenance.datasetName} (${policy.provenance.datasetSha256})`);
  if (policy.provenance.routingGate) {
    lines.push(`- routing_gate=${policy.provenance.routingGate.status}`);
  }
  lines.push('', '## Rationale', '', policy.rationale);

  if (policy.status === 'ready' && policy.metrics) {
    lines.push('', '## Metrics (selected threshold)', '');
    for (const split of ['train', 'validation', 'test']) {
      const m = policy.metrics[split];
      if (!m) continue;
      lines.push(`- ${split}: agreement=${m.agreement ?? 'n/a'}, coverage=${m.coverage ?? 'n/a'}, n=${m.total ?? 'n/a'}`);
    }
  }

  if (policy.blockers.length) {
    lines.push('', '## Blockers', '');
    for (const blocker of policy.blockers) lines.push(`- ${blocker}`);
  }
  return `${lines.join('\n')}\n`;
}

// ── Read-time Routing-Advisory ────────────────────────────────────────────
// Reine Funktionen für die Verdrahtung in die Agent-Routing (Tag 3): aus einer
// Vorschlags-confidence + aktivem Policy-Threshold eine ADVISORY-Empfehlung
// ableiten. Kein Auto-Handeln — nur ein Triage-Hinweis für den Analysten.

// confidence >= threshold → auto-accept-eligible, sonst route-to-review.
// Unbekannte Werte → 'unknown' (niemals raten).
function classifyRouting(confidence, threshold) {
  // null/undefined sind keine 0 — fehlende Werte werden NICHT geraten.
  if (confidence === null || confidence === undefined) return 'unknown';
  if (threshold === null || threshold === undefined) return 'unknown';
  const c = Number(confidence);
  const t = Number(threshold);
  if (!Number.isFinite(c) || !Number.isFinite(t)) return 'unknown';
  return c >= t ? 'auto_accept_eligible' : 'route_to_review';
}

// active: das Ergebnis von getActiveRoutingPolicy() ({ active, policyName, threshold }).
// Inaktiv/fehlend → null (fail-safe: kein Advisory, unverändertes Verhalten).
function routingAdvisory(confidence, active) {
  if (!active || !active.active) return null;
  return {
    policyName: active.policyName,
    threshold: active.threshold,
    recommendation: classifyRouting(confidence, active.threshold),
    source: 'ml-routing-policy',
  };
}

// Hängt das Advisory (falls aktiv) an ein serialisiertes Suggestion-JSON.
// Immutable: gibt ein neues Objekt zurück, mutiert das Original nicht.
function decorateWithRouting(suggestionJson, active) {
  const advisory = routingAdvisory(suggestionJson && suggestionJson.confidence, active);
  if (!advisory) return suggestionJson;
  return { ...suggestionJson, routing: advisory };
}

module.exports = {
  SCHEMA_VERSION,
  DEFAULT_POLICY,
  selectComparison,
  buildRoutingPolicy,
  renderRoutingPolicyMarkdown,
  classifyRouting,
  routingAdvisory,
  decorateWithRouting,
};
