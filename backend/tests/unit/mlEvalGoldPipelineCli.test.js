'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseArgs, main } = require('../../scripts/mlEvalGoldPipeline');

describe('mlEvalGoldPipeline CLI', () => {
  test('parseArgs liest pipeline optionen', () => {
    expect(parseArgs([
      'gold.jsonl',
      '--out-dir', '../artifacts/ml-eval',
      '--dataset-name', 'dataset-a',
      '--split-name', 'split-a',
      '--run-name', 'run-a',
      '--seed', 'seed-1',
    ])).toEqual({
      sourceFile: 'gold.jsonl',
      outDir: '../artifacts/ml-eval',
      datasetName: 'dataset-a',
      splitName: 'split-a',
      runName: 'run-a',
      seed: 'seed-1',
    });
  });

  test('main baut die komplette artefaktkette fuer gold input', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-gold-pipeline-'));
    const source = path.join(dir, 'gold.jsonl');
    fs.writeFileSync(source, [
      JSON.stringify({
        schema_version: 'v1',
        entity_type: 'ticket',
        entity_id: 'gold-1',
        ticket_id: 'gold-1',
        label_source: 'gold_review',
        source_kind: 'gold_sample',
        kind: 'alert',
        source_system: 'wazuh',
        source_model: '',
        raw_verdict: 'incident',
        raw_confidence: 0.95,
        review_status: 'CLOSED',
        human_label: 'incident',
        human_reason: 'Gold review: confirmed',
        close_reason: 'resolved',
        priority: 'critical',
        created_at: '2026-06-29T08:00:00Z',
        reviewed_at: '2026-06-29T09:00:00Z',
      }),
      JSON.stringify({
        schema_version: 'v1',
        entity_type: 'ticket',
        entity_id: 'gold-2',
        ticket_id: 'gold-2',
        label_source: 'gold_review',
        source_kind: 'gold_sample',
        kind: 'alert',
        source_system: 'manual',
        source_model: '',
        raw_verdict: 'false_positive',
        raw_confidence: 0.8,
        review_status: 'CLOSED',
        human_label: 'false_positive',
        human_reason: 'Gold review: maintenance false positive',
        close_reason: 'false_positive',
        priority: 'low',
        created_at: '2026-06-29T10:00:00Z',
        reviewed_at: '2026-06-29T10:20:00Z',
      }),
    ].join('\n'), 'utf8');

    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const exitCode = main([source, '--out-dir', dir, '--dataset-name', 'dataset-a', '--split-name', 'split-a', '--run-name', 'run-a']);
      expect(exitCode).toBe(1);
      const childDirs = fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
      expect(childDirs).toHaveLength(1);
      const out = path.join(dir, childDirs[0].name);
      for (const file of ['manifest.json', 'split-manifest.json', 'baseline-run.json', 'baseline-eval.json', 'readiness-report.json']) {
        expect(fs.existsSync(path.join(out, file))).toBe(true);
      }
    } finally {
      stdout.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
