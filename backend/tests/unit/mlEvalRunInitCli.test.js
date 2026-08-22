'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseArgs, main } = require('../../scripts/mlEvalRunInit');

describe('mlEvalRunInit CLI', () => {
  test('parseArgs liest Run-Optionen', () => {
    expect(parseArgs([
      '../artifacts/ml-eval/abc',
      '--run-name', 'baseline-v1',
      '--objective', 'routing_threshold_baseline',
      '--strategy', 'rule_baseline',
      '--notes', 'first run',
    ])).toEqual({
      datasetDir: '../artifacts/ml-eval/abc',
      runName: 'baseline-v1',
      objective: 'routing_threshold_baseline',
      strategy: 'rule_baseline',
      notes: 'first run',
    });
  });

  test('main schreibt baseline-run.json und bleibt blocked bei offenen Blockern', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-eval-run-'));
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
      datasetName: 'dataset-a',
      generatedAt: '2026-06-29T15:00:00.000Z',
      snapshot: { recordSha256: 'a'.repeat(64) },
      quality: {
        routingGate: { status: 'fail', gate: { minAgreement: 0.8 }, failures: ['gold_records 4 < 20'] },
      },
    }), 'utf8');
    fs.writeFileSync(path.join(dir, 'split-manifest.json'), JSON.stringify({
      splitName: 'split-a',
      seed: 'seed-1',
      ratios: { train: 0.7, validation: 0.15, test: 0.15 },
      counts: { train: 4, validation: 0, test: 0, total: 4 },
      splitQuality: { status: 'warn', warnings: ['validation_split_empty', 'test_split_empty'] },
      splitSha256: { train: 'b'.repeat(64), validation: 'c'.repeat(64), test: 'd'.repeat(64) },
    }), 'utf8');

    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const exitCode = main([dir, '--run-name', 'baseline-v1']);
      expect(exitCode).toBe(1);
      const runManifest = JSON.parse(fs.readFileSync(path.join(dir, 'baseline-run.json'), 'utf8'));
      expect(runManifest.runName).toBe('baseline-v1');
      expect(runManifest.status).toBe('blocked');
      expect(runManifest.blockers).toContain('routing_gate_fail');
    } finally {
      stdout.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
