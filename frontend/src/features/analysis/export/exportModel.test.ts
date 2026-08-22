import { describe, it, expect } from 'vitest';
import { exportScopeItems, selectedCount, buildScopedMarkdown, estimateBytes, fmtBytes, FULL_SCOPE, type ExportScope } from './exportModel';
import type { Ioc, TicketTimeline } from '../analysisModel';
import type { SummaryBullet, EntityItem } from '../deckModel';
import type { Ticket } from '../../../lib/types';

const ticket = (over: Partial<Ticket> = {}): Ticket => ({
  id: 't1', ticketNr: 'INC1', title: 'Phishing', priority: 'high', status: 'assigned', analyst: 'a',
  createdAt: '2026-06-22T10:00:00Z', updatedAt: '2026-06-22T11:00:00Z', ...over,
});
const bullets: SummaryBullet[] = [{ kind: 'process', text: 'powershell.exe ausgeführt' }];
const iocs: Ioc[] = [{ type: 'ip', value: '1.2.3.4', reputation: 'malicious' }];
const entities: EntityItem[] = [{ kind: 'host', value: 'WEC01' }, { kind: 'user', value: 'j.bauer' }];
const tl = (events: TicketTimeline['events']): TicketTimeline => ({ count: events.length, first: null, last: null, dstPorts: [], actions: [], events });

describe('exportScopeItems / selectedCount', () => {
  it('zählt je Abschnitt real', () => {
    const items = exportScopeItems(bullets, iocs, entities, tl([{ time: 't' }]), ticket({ decision: 'incident' }));
    expect(items.find((i) => i.key === 'summary')?.count).toBe(1);
    expect(items.find((i) => i.key === 'iocs')?.count).toBe(1);
    expect(items.find((i) => i.key === 'entities')?.count).toBe(2);
    expect(items.find((i) => i.key === 'timeline')?.count).toBe(1);
    expect(items.find((i) => i.key === 'decision')?.count).toBe(1);
  });
  it('summiert nur ausgewählte Abschnitte', () => {
    const items = exportScopeItems(bullets, iocs, entities, null, ticket());
    const scope: ExportScope = { summary: true, iocs: true, entities: false, timeline: false, decision: false };
    expect(selectedCount(items, scope)).toBe(2); // 1 summary + 1 ioc
  });
});

describe('buildScopedMarkdown', () => {
  it('filtert Abschnitte anhand des Scopes wirklich', () => {
    const md = buildScopedMarkdown(ticket(), bullets, iocs, entities, null, { summary: true, iocs: false, entities: false, timeline: false, decision: false });
    expect(md).toContain('## Analyst Summary');
    expect(md).not.toContain('## IoCs');
    expect(md).not.toContain('## Entities');
  });
  it('schreibt Classification + Watermark in den Header/Footer', () => {
    const md = buildScopedMarkdown(ticket(), bullets, iocs, entities, null, FULL_SCOPE, { classification: 'TLP: AMBER', watermark: 'Confidential', preparedBy: 'Alex' });
    expect(md).toContain('TLP: AMBER');
    expect(md).toContain('Prepared by:** Alex');
    expect(md).toContain('> Confidential');
  });
});

describe('estimateBytes / fmtBytes', () => {
  it('schätzt Größe und formatiert', () => {
    expect(estimateBytes('abc')).toBe(3);
    expect(fmtBytes(512)).toBe('512 B');
    expect(fmtBytes(2048)).toBe('2.0 KB');
  });
});
