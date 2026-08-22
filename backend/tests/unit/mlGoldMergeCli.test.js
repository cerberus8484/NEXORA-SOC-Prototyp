'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseArgs, main } = require('../../scripts/mlGoldMerge');

describe('mlGoldMerge CLI', () => {
  test('parseArgs liest base, incoming und out', () => {
    expect(parseArgs([
      'base.jsonl',
      'incoming.jsonl',
      '--out', 'merged.jsonl',
    ])).toEqual({
      baseFile: 'base.jsonl',
      incomingFile: 'incoming.jsonl',
      outFile: 'merged.jsonl',
    });
  });

  test('main merged zwei Gold-Dateien und schreibt Output', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-gold-merge-'));
    const base = path.join(dir, 'base.jsonl');
    const incoming = path.join(dir, 'incoming.jsonl');
    const out = path.join(dir, 'merged.jsonl');
    fs.writeFileSync(base, `${JSON.stringify({
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
      raw_confidence: 0.9,
      review_status: 'CLOSED',
      human_label: 'incident',
      human_reason: 'Gold review: confirmed',
      close_reason: 'resolved',
      priority: 'high',
      created_at: '2026-06-29T08:00:00Z',
      reviewed_at: '2026-06-29T09:00:00Z',
    })}\n`, 'utf8');
    fs.writeFileSync(incoming, `${JSON.stringify({
      schema_version: 'v1',
      entity_type: 'ticket',
      entity_id: 'gold-2',
      ticket_id: 'gold-2',
      label_source: 'gold_review',
      source_kind: 'gold_sample',
      kind: 'alert',
      source_system: 'manual',
      source_model: '',
      raw_verdict: 'benign',
      raw_confidence: 0.7,
      review_status: 'CLOSED',
      human_label: 'benign',
      human_reason: 'Gold review: approved admin action',
      close_reason: 'benign',
      priority: 'medium',
      created_at: '2026-06-29T10:00:00Z',
      reviewed_at: '2026-06-29T10:30:00Z',
    })}\n`, 'utf8');

    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      expect(main([base, incoming, '--out', out])).toBe(0);
      expect(fs.existsSync(out)).toBe(true);
      const merged = fs.readFileSync(out, 'utf8');
      expect(merged).toContain('"entity_id":"gold-1"');
      expect(merged).toContain('"entity_id":"gold-2"');
    } finally {
      stdout.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
