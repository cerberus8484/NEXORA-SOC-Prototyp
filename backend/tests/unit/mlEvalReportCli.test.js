'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { main, parseArgs } = require('../../scripts/mlEvalReport');

describe('mlEvalReport CLI args', () => {
  test('parseArgs liest Format und Gate-Konfiguration', () => {
    expect(parseArgs([
      'snapshot.jsonl',
      '--format', 'json',
      '--min-agreement', '0.9',
      '--min-coverage', '0.4',
      '--min-gold-records', '12',
    ])).toEqual({
      file: 'snapshot.jsonl',
      format: 'json',
      gate: {
        minAgreement: 0.9,
        minCoverage: 0.4,
        minGoldRecords: 12,
      },
    });
  });

  test('parseArgs failt bei ungueltigem Format', () => {
    expect(parseArgs(['snapshot.jsonl', '--format', 'xlsx'])).toBeNull();
  });

  test('main liefert Exit-Code 1 wenn das Routing-Gate failt', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-eval-gate-fail-'));
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
        raw_confidence: 0.91,
        review_status: 'CLOSED',
        human_label: 'incident',
        human_reason: 'Gold review: confirmed by analyst',
        close_reason: 'resolved',
        priority: 'high',
        created_at: '2026-06-29T08:00:00Z',
        reviewed_at: '2026-06-29T08:30:00Z',
      }),
    ].join('\n'));

    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      expect(main([file, '--format', 'json'])).toBe(1);
    } finally {
      stdout.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('main liefert Exit-Code 0 wenn Gate und Validierung passen', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-eval-gate-pass-'));
    const file = path.join(dir, 'snapshot.jsonl');
    const lines = [
      {
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
      },
      {
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
        raw_confidence: 0.82,
        review_status: 'CLOSED',
        human_label: 'false_positive',
        human_reason: 'Gold review: maintenance false positive',
        close_reason: 'false_positive',
        priority: 'low',
        created_at: '2026-06-29T10:00:00Z',
        reviewed_at: '2026-06-29T10:20:00Z',
      },
    ];
    fs.writeFileSync(file, lines.map((line) => JSON.stringify(line)).join('\n'));

    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      expect(main([
        file,
        '--format', 'json',
        '--min-agreement', '0.8',
        '--min-coverage', '0.5',
        '--min-gold-records', '2',
      ])).toBe(0);
    } finally {
      stdout.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
