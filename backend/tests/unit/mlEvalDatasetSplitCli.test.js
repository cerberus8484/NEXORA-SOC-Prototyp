'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseArgs, main } = require('../../scripts/mlEvalDatasetSplit');

describe('mlEvalDatasetSplit CLI', () => {
  test('parseArgs liest Split-Optionen', () => {
    expect(parseArgs([
      '../artifacts/ml-eval/abc',
      '--seed', 'seed-1',
      '--train', '0.6',
      '--validation', '0.2',
      '--test', '0.2',
      '--split-name', 'baseline-v1',
    ])).toEqual({
      datasetDir: '../artifacts/ml-eval/abc',
      seed: 'seed-1',
      train: 0.6,
      validation: 0.2,
      test: 0.2,
      splitName: 'baseline-v1',
    });
  });

  test('main schreibt Split-Dateien in ein Dataset-Pack', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-eval-split-'));
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
      datasetName: 'baseline-pack',
      snapshot: { recordSha256: 'a'.repeat(64) },
    }), 'utf8');
    fs.writeFileSync(path.join(dir, 'snapshot.jsonl'), [
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
        source_system: 'wazuh',
        source_model: '',
        raw_verdict: 'false_positive',
        raw_confidence: 0.81,
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
      const exitCode = main([dir, '--split-name', 'baseline-v1']);
      expect(exitCode).toBe(1);
      expect(fs.existsSync(path.join(dir, 'train.jsonl'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'validation.jsonl'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'test.jsonl'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'split-manifest.json'))).toBe(true);
      const splitManifest = JSON.parse(fs.readFileSync(path.join(dir, 'split-manifest.json'), 'utf8'));
      expect(splitManifest.splitName).toBe('baseline-v1');
      expect(splitManifest.datasetName).toBe('baseline-pack');
      expect(splitManifest.counts.total).toBe(2);
      expect(splitManifest.splitQuality.status).toBe('warn');
    } finally {
      stdout.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
