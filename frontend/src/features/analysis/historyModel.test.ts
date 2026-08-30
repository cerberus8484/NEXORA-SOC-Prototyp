import { describe, it, expect } from 'vitest';
import { describeAuditEntry, auditCategory, activitySummary, decisionEntries, revisions, changedFieldLabels, type AuditEntry } from './historyModel';

function entry(over: Partial<AuditEntry>): AuditEntry {
  return {
    id: '1', actorUserId: null, actorLabel: 'analyst@soc', action: 'TICKET_CREATE',
    targetType: 'ticket', targetId: 't-1', metadata: {}, ip: '', createdAt: '2026-06-10T10:00:00Z',
    ...over,
  };
}

describe('describeAuditEntry', () => {
  it('übersetzt TICKET_CREATE', () => {
    const d = describeAuditEntry(entry({ action: 'TICKET_CREATE' }));
    expect(d.label).toBe('Ticket erstellt');
    expect(d.tone).toBe('success');
    expect(d.detail).toBe('');
  });

  it('zeigt bei TICKET_UPDATE die geänderten Felder mit lesbaren Labels', () => {
    const d = describeAuditEntry(entry({ action: 'TICKET_UPDATE', metadata: { fields: ['decision', 'confidence'] } }));
    expect(d.label).toBe('Ticket aktualisiert');
    expect(d.detail).toBe('Decision, Confidence');
  });

  it('lässt unbekannte Feldnamen unverändert durch', () => {
    const d = describeAuditEntry(entry({ action: 'TICKET_UPDATE', metadata: { fields: ['weirdField'] } }));
    expect(d.detail).toBe('weirdField');
  });

  it('verträgt TICKET_UPDATE ohne metadata.fields', () => {
    const d = describeAuditEntry(entry({ action: 'TICKET_UPDATE', metadata: {} }));
    expect(d.detail).toBe('');
  });

  it('fällt bei unbekannter Action auf den Rohnamen zurück (muted)', () => {
    const d = describeAuditEntry(entry({ action: 'SOMETHING_NEW' }));
    expect(d.label).toBe('SOMETHING_NEW');
    expect(d.tone).toBe('muted');
  });

  it('KI-Aktionen werden übersetzt', () => {
    expect(describeAuditEntry(entry({ action: 'AGENT_SUGGESTION_APPROVE' })).label).toBe('KI-Vorschlag genehmigt');
    expect(describeAuditEntry(entry({ action: 'AGENT_SUGGESTION_REJECT' })).tone).toBe('warning');
  });
});

describe('auditCategory', () => {
  it('mappt Action/Felder auf Kategorien', () => {
    expect(auditCategory(entry({ action: 'TICKET_CREATE' })).label).toBe('System');
    expect(auditCategory(entry({ action: 'AGENT_SUGGESTION_APPROVE' })).key).toBe('analysis');
    expect(auditCategory(entry({ action: 'TICKET_UPDATE', metadata: { fields: ['decision'] } })).key).toBe('decision');
    expect(auditCategory(entry({ action: 'TICKET_UPDATE', metadata: { fields: ['status'] } })).key).toBe('status');
    expect(auditCategory(entry({ action: 'TICKET_UPDATE', metadata: { fields: ['notes'] } })).key).toBe('note');
  });
});

describe('activitySummary', () => {
  it('zählt analyst/system/automation', () => {
    const s = activitySummary([
      entry({ action: 'TICKET_CREATE', actorUserId: null }),
      entry({ action: 'TICKET_UPDATE', actorUserId: 'u1', metadata: { fields: ['decision'] } }),
      entry({ action: 'AGENT_SUGGESTION_APPROVE', actorUserId: 'u1' }),
    ]);
    expect(s).toMatchObject({ total: 3, analyst: 1, system: 1, automation: 1 });
  });
});

describe('decisionEntries', () => {
  it('liefert nur Create + decision/status-Änderungen', () => {
    const es = decisionEntries([
      entry({ id: 'a', action: 'TICKET_CREATE' }),
      entry({ id: 'b', action: 'TICKET_UPDATE', metadata: { fields: ['notes'] } }),
      entry({ id: 'c', action: 'TICKET_UPDATE', metadata: { fields: ['status'] } }),
    ]);
    expect(es.map((e) => e.id)).toEqual(['a', 'c']);
  });
});

describe('revisions', () => {
  it('nummeriert Revisionen (neueste zuerst) mit lesbaren Changes', () => {
    const rs = revisions([
      entry({ id: 'a', action: 'TICKET_CREATE', createdAt: '2025-05-12T09:15:00Z', actorLabel: 'System' }),
      entry({ id: 'b', action: 'TICKET_UPDATE', createdAt: '2025-05-12T09:31:00Z', actorLabel: 'Jamie', metadata: { fields: ['decision', 'status'] } }),
    ]);
    expect(rs[0].id).toBe('b');
    expect(rs[0].changes).toBe('Decision, Status');
    expect(rs[1].version).toBe('v1.0');
    expect(changedFieldLabels(entry({ metadata: { fields: ['priority'] } }))).toEqual(['Priorität']);
  });
});
