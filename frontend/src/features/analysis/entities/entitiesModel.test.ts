import { describe, it, expect } from 'vitest';
import {
  entitiesOfKind, entityTypeLabel, observationCount, entityConfidence,
  toEntityRow, entitiesOfInterest, mitreLinkedEntities, buildEntityGraph,
} from './entitiesModel';
import { EMPTY_EVIDENCE, type ParsedEvidence } from '../analysisModel';
import type { EntityItem } from '../deckModel';
import type { Ticket } from '../../../lib/types';

const ticket = (over: Partial<Ticket> = {}): Ticket => ({
  id: 't1', ticketNr: 'INC1', title: 'T', priority: 'high', status: 'assigned', analyst: 'a',
  createdAt: '2026-06-22T10:00:00Z', updatedAt: '2026-06-22T11:00:00Z', ...over,
});
const ev = (over: Partial<ParsedEvidence>): ParsedEvidence => ({ ...EMPTY_EVIDENCE, ...over });

const items: EntityItem[] = [
  { kind: 'host', value: 'WEC01' }, { kind: 'user', value: 'j.bauer' },
  { kind: 'ip', value: '10.99.99.11' }, { kind: 'ip', value: '10.99.99.5' }, { kind: 'process', value: 'powershell.exe' },
];

describe('entitiesOfKind', () => {
  it('filtert nach Arten', () => {
    expect(entitiesOfKind(items, ['ip']).map((e) => e.value)).toEqual(['10.99.99.11', '10.99.99.5']);
  });
});

describe('entityTypeLabel', () => {
  it('mappt Art → Label', () => {
    expect(entityTypeLabel('host')).toBe('Host');
    expect(entityTypeLabel('url')).toBe('URL');
    expect(entityTypeLabel('other')).toBe('Other');
  });
});

describe('observationCount', () => {
  it('summiert die ×N-Counts aus der Provenance-Notiz', () => {
    expect(observationCount({ kind: 'ip', value: 'x', note: 'Wazuh ×38 · QRadar ×2' })).toBe(40);
  });
  it('fällt auf den Event-Count zurück, wenn keine Provenance da ist', () => {
    expect(observationCount({ kind: 'ip', value: 'x', events: 7 })).toBe(7);
  });
  it('ist null ohne jede Beobachtungstiefe', () => {
    expect(observationCount({ kind: 'host', value: 'x', note: 'Source' })).toBeNull();
    expect(observationCount({ kind: 'host', value: 'x' })).toBeNull();
  });
});

describe('entityConfidence', () => {
  it('bucketed aus der Beobachtungstiefe (kein Verdict)', () => {
    expect(entityConfidence({ kind: 'ip', value: 'x', note: '×12' })).toBe('high');
    expect(entityConfidence({ kind: 'ip', value: 'x', events: 4 })).toBe('medium');
    expect(entityConfidence({ kind: 'ip', value: 'x', events: 1 })).toBe('low');
    expect(entityConfidence({ kind: 'ip', value: 'x' })).toBeNull();
  });
});

describe('toEntityRow', () => {
  it('baut eine Tabellenzeile mit ehrlichen Feldern', () => {
    const row = toEntityRow({ kind: 'file', value: 'a.ps1', firstSeen: '2026-06-20T10:00:00Z', lastSeen: null, note: '×5' });
    expect(row.typeLabel).toBe('File');
    expect(row.confidence).toBe('medium');
    expect(row.evidence).toBe(5);
    expect(row.firstSeen).toBe('2026-06-20T10:00:00Z');
  });
});

describe('entitiesOfInterest', () => {
  it('flaggt externe Ziele/Artefakte mit transparentem Grund, sortiert nach Tiefe', () => {
    const rows = entitiesOfInterest([
      { kind: 'host', value: 'WEC01' },
      { kind: 'user', value: 'j.bauer' },
      { kind: 'ip', value: '10.99.99.5', note: 'Destination ×3' },
      { kind: 'domain', value: 'bad.example', note: '×9' },
      { kind: 'file', value: 'drop.ps1' },
    ]);
    // Host/User sind kein Interesse; Domain (9) vor IP-Destination (3) vor File (kein Count)
    expect(rows.map((r) => r.value)).toEqual(['bad.example', '10.99.99.5', 'drop.ps1']);
    expect(rows[1].reason).toBe('Externes Ziel');
    expect(rows[0].reason).toBe('Externe Domain');
  });
  it('ist leer ohne prüfenswerte Entities', () => {
    expect(entitiesOfInterest([{ kind: 'host', value: 'WEC01' }, { kind: 'user', value: 'a' }])).toHaveLength(0);
  });
});

describe('mitreLinkedEntities', () => {
  it('verknüpft die reale Ticket-Technik mit dem primären Artefakt (Prozess bevorzugt)', () => {
    const rows = mitreLinkedEntities(
      ev({ metadata: { ...EMPTY_EVIDENCE.metadata, mitreTechnique: 'T1059.001', mitreTactic: 'Execution' } }),
      items,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe('powershell.exe');
    expect(rows[0].technique).toBe('T1059.001');
    expect(rows[0].tactic).toBe('Execution');
  });
  it('ist leer ohne reale MITRE-Technik', () => {
    expect(mitreLinkedEntities(EMPTY_EVIDENCE, items)).toHaveLength(0);
  });
});

describe('buildEntityGraph', () => {
  it('baut nur beobachtete Knoten + Kanten, observed vs inferred korrekt', () => {
    const g = buildEntityGraph(
      ticket({ dstIp: '203.0.113.45' }),
      ev({
        source: { ...EMPTY_EVIDENCE.source, host: 'WEC01', user: 'j.bauer', ip: '10.99.99.11' },
        process: { ...EMPTY_EVIDENCE.process, image: 'powershell.exe', parentImage: 'explorer.exe' },
        file: { ...EMPTY_EVIDENCE.file, name: 'drop.ps1' },
      }),
    );
    const nodeIds = g.nodes.map((n) => n.id).sort();
    expect(nodeIds).toEqual(['file', 'host', 'ip', 'parent', 'proc', 'user'].sort());

    const started = g.edges.find((e) => e.from === 'host' && e.to === 'proc');
    expect(started?.label).toBe('gestartet');
    expect(started?.inferred).toBe(false);

    const dropped = g.edges.find((e) => e.to === 'file');
    expect(dropped?.from).toBe('proc');
    expect(dropped?.inferred).toBe(true);

    const conn = g.edges.find((e) => e.to === 'ip');
    expect(conn?.from).toBe('proc');
    expect(conn?.label).toBe('verbindet zu');
  });

  it('hat keine Knoten ohne reale Identitäten', () => {
    expect(buildEntityGraph(ticket(), EMPTY_EVIDENCE).nodes).toHaveLength(0);
  });

  it('nutzt den Host als Origin, wenn kein Prozess vorhanden ist', () => {
    const g = buildEntityGraph(ticket(), ev({
      source: { ...EMPTY_EVIDENCE.source, host: 'WEC01' },
      destination: { ...EMPTY_EVIDENCE.destination, ip: '203.0.113.45' },
    }));
    const conn = g.edges.find((e) => e.to === 'ip');
    expect(conn?.from).toBe('host');
  });
});
