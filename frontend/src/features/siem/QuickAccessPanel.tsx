import type { CSSProperties } from 'react';
import { ExternalLink } from 'lucide-react';
import { useTopology } from './useTopology';
import { OpsSectionHead } from './OpsSection';

// Quick Access — Infrastruktur-Links (Vorlage: opnsense-dashboard.html, Sektion [06]).
// Externe Ops-Oberflächen; öffnet immer in neuem Tab ohne Referrer.

const s: Record<string, CSSProperties> = {
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 },
  link: {
    display: 'block', textDecoration: 'none',
    background: 'linear-gradient(165deg, var(--bg-card-soft), var(--bg-card))',
    border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)',
    padding: '12px 14px',
  },
  title: {
    display: 'flex', alignItems: 'center', gap: 8,
    fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700,
    letterSpacing: '0.06em', color: 'var(--text)',
  },
  url: { fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent)', marginTop: 5 },
  desc: { fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--text-dim)', marginTop: 3, letterSpacing: '0.04em' },
};

export function QuickAccessPanel() {
  const { quickLinks } = useTopology();
  return (
    <div style={{ marginTop: 14 }}>
      <OpsSectionHead tag="[03]" title="Quick Access — Infrastruktur" />
      <div style={s.grid}>
        {quickLinks.map((l) => (
          <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" style={s.link}>
            <span style={s.title}>
              <ExternalLink size={13} style={{ color: 'var(--text-dim)' }} />
              {l.label}
            </span>
            <div style={s.url}>{l.url}</div>
            <div style={s.desc}>{l.desc}</div>
          </a>
        ))}
      </div>
    </div>
  );
}
