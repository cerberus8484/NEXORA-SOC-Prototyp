// Gemeinsame UI-Bausteine des Analyst Decks — kompakte Cards, dichte Tabellen.
import type { CSSProperties, ReactNode } from 'react';
import { Card } from '../../../components/ui';

export const LABEL: CSSProperties = { fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.4 };
export const PANEL_H: CSSProperties = { fontSize: 12.5, fontWeight: 700, color: 'var(--text)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 7 };
export const TH: CSSProperties = { textAlign: 'left', fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5, padding: '7px 10px', borderBottom: '1px solid var(--border-soft)', whiteSpace: 'nowrap' };
export const TD: CSSProperties = { fontSize: 12, padding: '7px 10px', borderBottom: '1px solid var(--border-soft)', color: 'var(--text)' };

/** Karte mit Titelzeile (Icon + Titel + optionale Aktion rechts). */
export function DeckCard({ title, icon, action, children, style }: {
  title: string; icon?: ReactNode; action?: ReactNode; children: ReactNode; style?: CSSProperties;
}) {
  return (
    <Card style={{ padding: '14px 16px', ...style }}>
      <div style={{ ...PANEL_H, justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>{icon}{title}</span>
        {action}
      </div>
      {children}
    </Card>
  );
}

/** Label/Wert-Zeile — „—" wenn der Wert fehlt (keine erfundenen Daten). */
export function KV({ label, value, mono }: { label: string; value?: ReactNode; mono?: boolean }) {
  const empty = value === undefined || value === null || value === '';
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0', borderBottom: '1px solid var(--border-soft)', fontSize: 12 }}>
      <span style={{ color: 'var(--text-dim)', flexShrink: 0 }}>{label}</span>
      <span style={{ color: empty ? 'var(--text-dim)' : 'var(--text)', fontFamily: mono ? 'var(--font-mono)' : undefined, textAlign: 'right', overflowWrap: 'anywhere' }}>
        {empty ? '—' : value}
      </span>
    </div>
  );
}

/** Kleiner Hinweistext unter Cards (Datenquelle / Einschränkung). */
export function Hint({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8 }}>{children}</div>;
}
