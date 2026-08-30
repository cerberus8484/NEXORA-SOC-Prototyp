'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseArgs, main } = require('../../scripts/mlEvalRunPolicyCompare');

describe('mlEvalRunPolicyCompare CLI', () => {
  test('parseArgs liest thresholds', () => {
    expect(parseArgs(['../artifacts/ml-eval/abc', '--thresholds', '0,0.7'])).toEqual({
      datasetDir: '../artifacts/ml-eval/abc',
      thresholds: [0, 0.7],
    });
  });

  test('main schreibt policy comparison artefakte', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-policy-compare-'));
    fs.writeFileSync(path.join(dir, 'baseline-run.json'), JSON.stringify({
      runName: 'ready-run',
      status: 'ready',
      blockers: [],
    }), 'utf8');
    fs.writeFileSync(path.join(dir, 'train.jsonl'), `${JSON.stringify({ human_label: 'incident', raw_verdict: 'incident', raw_confidence: 0.9 })}\n`, 'utf8');
    fs.writeFileSync(path.join(dir, 'validation.jsonl'), `${JSON.stringify({ human_label: 'incident', raw_verdict: 'incident', raw_confidence: 0.9 })}\n`, 'utf8');
    fs.writeFileSync(path.join(dir, 'test.jsonl'), `${JSON.stringify({ human_label: 'incident', raw_verdict: 'incident', raw_confidence: 0.9 })}\n`, 'utf8');

    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      expect(main([dir])).toBe(0);
      expect(fs.existsSync(path.join(dir, 'policy-comparison.json'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'policy-comparison.md'))).toBe(true);
    } finally {
      stdout.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
