'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { main, parseArgs } = require('../../scripts/mlEvalDatasetPack');

describe('mlEvalDatasetPack CLI', () => {
  test('parseArgs liest out-dir und dataset-name', () => {
    expect(parseArgs([
      'snapshot.jsonl',
      '--out-dir', '../artifacts/ml-eval',
      '--dataset-name', 'baseline-a',
    ])).toEqual({
      file: 'snapshot.jsonl',
      outDir: '../artifacts/ml-eval',
      datasetName: 'baseline-a',
    });
  });

  test('main schreibt Dataset-Pack mit Manifest und Reports', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-eval-pack-'));
    const file = path.join(dir, 'snapshot.jsonl');
    fs.writeFileSync(file, [
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
    ].join('\n'));

    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const exitCode = main([
        file,
        '--out-dir', dir,
        '--dataset-name', 'baseline-pack',
      ]);
      expect(exitCode).toBe(1);

      const childDirs = fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
      expect(childDirs).toHaveLength(1);
      const packDir = path.join(dir, childDirs[0].name);
      expect(fs.existsSync(path.join(packDir, 'snapshot.jsonl'))).toBe(true);
      expect(fs.existsSync(path.join(packDir, 'manifest.json'))).toBe(true);
      expect(fs.existsSync(path.join(packDir, 'report.json'))).toBe(true);
      expect(fs.existsSync(path.join(packDir, 'report.md'))).toBe(true);
      const manifest = JSON.parse(fs.readFileSync(path.join(packDir, 'manifest.json'), 'utf8'));
      expect(manifest.datasetName).toBe('baseline-pack');
      expect(manifest.snapshot.recordSha256).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      stdout.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
