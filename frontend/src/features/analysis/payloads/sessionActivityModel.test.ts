import { describe, it, expect } from 'vitest';
import { deriveSessionActivity, hasSessionActivity, type SessionActivityRow } from './sessionActivityModel';
import type { Ticket, TicketPayload } from '../../../lib/types';

const ticket = (payloads?: TicketPayload[]): Ticket => ({
  id: 't1', ticketNr: 'INC000770', title: 'Honeypot', priority: 'high', status: 'OPEN',
  analyst: '', createdAt: '', updatedAt: '', payloads,
});

describe('deriveSessionActivity', () => {
  it('liefert [] wenn payloads fehlen oder leer', () => {
    expect(deriveSessionActivity(ticket(undefined))).toEqual([]);
    expect(deriveSessionActivity(ticket([]))).toEqual([]);
  });

  it('ignoriert Einträge ohne bekannten Session-kind (Windows-Payload etc.)', () => {
    const rows = deriveSessionActivity(ticket([
      { type: 'Command', raw: 'powershell.exe -enc AAAA', fields: {} },
      { type: 'Andere', raw: 'irgendwas' },
      { type: 'Command', raw: 'whoami', fields: { kind: 'command', at: '2026-06-30T10:00:00Z' } },
    ]));
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('command');
    expect(rows[0].value).toBe('whoami');
  });

  it('mappt command → Befehl-Label und trägt raw als value', () => {
    const rows = deriveSessionActivity(ticket([
      { type: 'Command', raw: 'cat /etc/passwd', fields: { kind: 'command', at: '2026-06-30T10:00:00Z' } },
    ]));
    expect(rows[0]).toMatchObject<Partial<SessionActivityRow>>({ kind: 'command', label: 'Befehl', value: 'cat /etc/passwd', at: '2026-06-30T10:00:00Z' });
  });

  it('mappt login → Login-Label und value aus fields.user (raw leer)', () => {
    const rows = deriveSessionActivity(ticket([
      { type: 'Andere', raw: '', fields: { kind: 'login', user: 'root', at: '2026-06-30T09:59:00Z' } },
    ]));
    expect(rows[0].kind).toBe('login');
    expect(rows[0].label).toBe('Login');
    expect(rows[0].value).toBe('root');
    expect(rows[0].user).toBe('root');
  });

  it('mappt download → Download-Label, tunnel → Tunnel-Label', () => {
    const rows = deriveSessionActivity(ticket([
      { type: 'URL', raw: 'http://evil.example/x.sh', fields: { kind: 'download', at: '2026-06-30T10:01:00Z' } },
      { type: 'Andere', raw: '10.0.0.5:4444', fields: { kind: 'tunnel', at: '2026-06-30T10:02:00Z' } },
    ]));
    const byKind = Object.fromEntries(rows.map((r) => [r.kind, r]));
    expect(byKind.download.label).toBe('Download');
    expect(byKind.download.value).toBe('http://evil.example/x.sh');
    expect(byKind.tunnel.label).toBe('Tunnel');
    expect(byKind.tunnel.value).toBe('10.0.0.5:4444');
  });

  it('sortiert chronologisch nach fields.at (aufsteigend)', () => {
    const rows = deriveSessionActivity(ticket([
      { type: 'Command', raw: 'zweiter', fields: { kind: 'command', at: '2026-06-30T10:05:00Z' } },
      { type: 'Command', raw: 'erster', fields: { kind: 'command', at: '2026-06-30T10:00:00Z' } },
      { type: 'Command', raw: 'ohne-zeit', fields: { kind: 'command' } },
    ]));
    expect(rows.map((r) => r.value)).toEqual(['erster', 'zweiter', 'ohne-zeit']);
  });

  it('ist robust gegen fehlende fields / leere raw', () => {
    const rows = deriveSessionActivity(ticket([
      { type: 'Command', raw: '  ', fields: { kind: 'command' } },
      { type: 'Andere', raw: '', fields: { kind: 'login' } },
    ]));
    // command mit leerem raw → keine sinnvolle value, wird ausgelassen
    expect(rows.find((r) => r.kind === 'command')).toBeUndefined();
    // login ohne user → value fällt auf '—'-Ersatz? Nein: value bleibt leer, Eintrag ausgelassen
    expect(rows.find((r) => r.kind === 'login')).toBeUndefined();
  });

  it('ignoriert nicht-Array payloads defensiv', () => {
    // @ts-expect-error absichtlich falscher Typ (Backend-Robustheit)
    expect(deriveSessionActivity(ticket('kaputt'))).toEqual([]);
  });
});

describe('hasSessionActivity', () => {
  it('true nur wenn mindestens eine Session-Aktivität ableitbar', () => {
    expect(hasSessionActivity(ticket([{ type: 'Command', raw: 'id', fields: { kind: 'command' } }]))).toBe(true);
    expect(hasSessionActivity(ticket([{ type: 'Command', raw: 'x', fields: {} }]))).toBe(false);
    expect(hasSessionActivity(ticket(undefined))).toBe(false);
  });
});
