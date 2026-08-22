'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseArgs, main } = require('../../scripts/mlEvalPolicyExport');

function seedDir({ runStatus = 'ready' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-policy-export-'));
  const selected = {
    threshold: 0.7,
    train: { threshold: 0.7, total: 16, accepted: 14, routedToReview: 2, correct: 13, agreement: 0.9286, coverage: 0.875 },
    validation: { threshold: 0.7, total: 2, accepted: 2, routedToReview: 0, correct: 2, agreement: 1, coverage: 1 },
    test: { threshold: 0.7, total: 2, accepted: 2, routedToReview: 0, correct: 2, agreement: 1, coverage: 1 },
  };
  fs.writeFileSync(path.join(dir, 'baseline-run.json'), JSON.stringify({
    runName: 'ready-run',
    status: runStatus,
    blockers: runStatus === 'ready' ? [] : ['routing_gate_fail'],
    dataset: { datasetName: 'ds', datasetSha256: 'sha-ds', generatedAt: 't' },
    split: { counts: { train: 16, validation: 2, test: 2, total: 20 }, splitSha256: { train: 'a', validation: 'b', test: 'c' } },
    gates: { routingGate: { status: 'pass', gate: { minGoldRecords: 20 }, selectedThreshold: 0, failures: [] } },
  }), 'utf8');
  fs.writeFileSync(path.join(dir, 'policy-comparison.json'), JSON.stringify({
    summary: {
      runName: 'ready-run',
      generatedAt: '2026-06-29T16:21:04.267Z',
      status: 'ok',
      policies: [
        { policy: 'max_validation_agreement', recommendedThreshold: 0, blockers: [] },
        { policy: 'conservative_review_bias', recommendedThreshold: 0.7, blockers: [] },
      ],
    },
    comparisons: [
      { policy: 'max_validation_agreement', status: 'ok', recommendedThreshold: 0, selectedByValidation: { ...selected, threshold: 0 }, thresholds: [] },
      { policy: 'conservative_review_bias', status: 'ok', recommendedThreshold: 0.7, selectedByValidation: selected, thresholds: [] },
    ],
  }), 'utf8');
  return dir;
}

describe('mlEvalPolicyExport CLI', () => {
  test('parseArgs liest dir und optionale policy', () => {
    expect(parseArgs(['../artifacts/ml-eval/abc'])).toEqual({
      datasetDir: '../artifacts/ml-eval/abc',
      policy: 'conservative_review_bias',
    });
    expect(parseArgs(['dir', '--policy', 'max_validation_agreement'])).toEqual({
      datasetDir: 'dir',
      policy: 'max_validation_agreement',
    });
  });

  test('parseArgs gibt null ohne dir', () => {
    expect(parseArgs([])).toBeNull();
  });

  test('main schreibt ein deploybares Routing-Policy-Artefakt (ready → exit 0)', () => {
    const dir = seedDir();
    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      expect(main([dir])).toBe(0);
      const artifactPath = path.join(dir, 'recommended-routing-policy.json');
      expect(fs.existsSync(artifactPath)).toBe(true);
      expect(fs.existsSync(path.join(dir, 'recommended-routing-policy.md'))).toBe(true);

      const policy = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
      expect(policy.status).toBe('ready');
      expect(policy.policyName).toBe('conservative_review_bias');
      expect(policy.recommendedThreshold).toBe(0.7);
      expect(policy.provenance.datasetSha256).toBe('sha-ds');
      expect(policy.metrics.validation.agreement).toBe(1);
    } finally {
      stdout.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('main respektiert --policy override', () => {
    const dir = seedDir();
    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      expect(main([dir, '--policy', 'max_validation_agreement'])).toBe(0);
      const policy = JSON.parse(fs.readFileSync(path.join(dir, 'recommended-routing-policy.json'), 'utf8'));
      expect(policy.policyName).toBe('max_validation_agreement');
      expect(policy.recommendedThreshold).toBe(0);
    } finally {
      stdout.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('fail-closed: blockierter Run → blocked Artefakt + exit 1', () => {
    const dir = seedDir({ runStatus: 'blocked' });
    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(main([dir])).toBe(1);
      const policy = JSON.parse(fs.readFileSync(path.join(dir, 'recommended-routing-policy.json'), 'utf8'));
      expect(policy.status).toBe('blocked');
      expect(policy.recommendedThreshold).toBeNull();
      expect(policy.blockers).toContain('run_not_ready');
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('main ohne dir gibt usage und exit 2', () => {
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(main([])).toBe(2);
    } finally {
      stderr.mockRestore();
    }
  });

  test('unbekannte --policy → exit 2 (Allowlist, kein Datei-Zugriff)', () => {
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(main(['some-dir', '--policy', 'bogus_policy'])).toBe(2);
    } finally {
      stderr.mockRestore();
    }
  });
});
