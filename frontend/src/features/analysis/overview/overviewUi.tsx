import type { CSSProperties, ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { Card } from '../../../components/ui';

// Gemeinsame Bausteine des Overview-Grids: Card mit Header (Icon + Titel) und
// optionalem Footer-Link „… →". Werte fehlen → ehrliches „—" (keine Fake-Daten).

export function OverviewCard({ title, icon, footerLabel, onFooter, children, style, headerRight }: {
  title: string; icon?: ReactNode; footerLabel?: string; onFooter?: () => void; children: ReactNode; style?: CSSProperties; headerRight?: ReactNode;
}) {
  return (
    <Card style={{ padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--border-soft)' }}>
        {icon}
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', letterSpacing: 0.2 }}>{title}</span>
        {headerRight && <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>{headerRight}</span>}
      </div>
      <div style={{ padding: '12px 14px', flex: 1, minWidth: 0 }}>{children}</div>
      {footerLabel && (
        <button type="button" onClick={onFooter}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '10px 14px', borderTop: '1px solid var(--border-soft)', background: 'transparent', border: 'none', borderTopLeftRadius: 0, cursor: onFooter ? 'pointer' : 'default', color: 'var(--accent)', fontSize: 12, fontWeight: 600, textAlign: 'left' }}>
          {footerLabel} <ArrowRight size={13} />
        </button>
      )}
    </Card>
  );
}

// Label/Wert-Zeile (linkes muted Label, rechter Wert) — „—" wenn leer.
export function Row({ label, value, mono }: { label: string; value?: ReactNode; mono?: boolean }) {
  const empty = value === undefined || value === null || value === '';
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '5px 0', fontSize: 12 }}>
      <span style={{ color: 'var(--text-dim)', flexShrink: 0 }}>{label}</span>
      <span style={{ color: empty ? 'var(--text-dim)' : 'var(--text)', fontFamily: mono ? 'var(--font-mono)' : undefined, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '62%' }} title={typeof value === 'string' ? value : undefined}>
        {empty ? '—' : value}
      </span>
    </div>
  );
}

/** Ehrlicher Leerzustand innerhalb einer Card. */
export function CardEmpty({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 12, color: 'var(--text-dim)', padding: '4px 0', lineHeight: 1.5 }}>{children}</div>;
}

export const GRID_2: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14 };
