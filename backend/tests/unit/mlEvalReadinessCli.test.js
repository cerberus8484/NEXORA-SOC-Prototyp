'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseArgs, main } = require('../../scripts/mlEvalReadiness');

describe('mlEvalReadiness CLI', () => {
  test('parseArgs liest dataset-pack-dir', () => {
    expect(parseArgs(['../artifacts/ml-eval/abc'])).toEqual({ datasetDir: '../artifacts/ml-eval/abc' });
  });

  test('main schreibt readiness-report artefakte', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-eval-readiness-'));
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
      datasetName: 'dataset-a',
      quality: {
        goldRecords: 4,
        routingGate: {
          status: 'fail',
          gate: { minGoldRecords: 20 },
          failures: ['gold_records 4 < 20'],
        },
      },
    }), 'utf8');
    fs.writeFileSync(path.join(dir, 'split-manifest.json'), JSON.stringify({
      counts: { train: 4, validation: 0, test: 0, total: 4 },
      splitQuality: { warnings: ['validation_split_empty', 'test_split_empty'] },
    }), 'utf8');
    fs.writeFileSync(path.join(dir, 'baseline-run.json'), JSON.stringify({
      runName: 'run-a',
      status: 'blocked',
      blockers: ['routing_gate_fail'],
    }), 'utf8');

    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const exitCode = main([dir]);
      expect(exitCode).toBe(1);
      expect(fs.existsSync(path.join(dir, 'readiness-report.json'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'readiness-report.md'))).toBe(true);
      const report = JSON.parse(fs.readFileSync(path.join(dir, 'readiness-report.json'), 'utf8'));
      expect(report.nextActions).toContain('add_at_least_16_more_gold_records');
    } finally {
      stdout.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
