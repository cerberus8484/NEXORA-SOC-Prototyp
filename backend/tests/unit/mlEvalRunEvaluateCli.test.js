'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseArgs, main } = require('../../scripts/mlEvalRunEvaluate');

describe('mlEvalRunEvaluate CLI', () => {
  test('parseArgs liest dataset-pack-dir', () => {
    expect(parseArgs(['../artifacts/ml-eval/abc'])).toEqual({ datasetDir: '../artifacts/ml-eval/abc' });
  });

  test('main schreibt blocked baseline eval fuer blockierten run', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-eval-run-eval-'));
    fs.writeFileSync(path.join(dir, 'baseline-run.json'), JSON.stringify({
      runName: 'blocked-run',
      status: 'blocked',
      blockers: ['routing_gate_fail'],
      gates: { routingGate: { selectedThreshold: null } },
    }), 'utf8');
    fs.writeFileSync(path.join(dir, 'train.jsonl'), '', 'utf8');
    fs.writeFileSync(path.join(dir, 'validation.jsonl'), '', 'utf8');
    fs.writeFileSync(path.join(dir, 'test.jsonl'), '', 'utf8');

    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const exitCode = main([dir]);
      expect(exitCode).toBe(1);
      expect(fs.existsSync(path.join(dir, 'baseline-eval.json'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'baseline-eval.md'))).toBe(true);
      const result = JSON.parse(fs.readFileSync(path.join(dir, 'baseline-eval.json'), 'utf8'));
      expect(result.status).toBe('blocked');
      expect(result.blockers).toEqual(['routing_gate_fail']);
    } finally {
      stdout.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
