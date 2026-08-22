// Threat-Intel-Panel der rechten Spalte (P17.1 Mock-first) — Kontext, kein Auto-Verdict.
import type { CSSProperties } from 'react';
import { Globe } from 'lucide-react';
import { Badge, Button, Card, type Tone } from '../../../components/ui';
import type { ParsedEvidence, ThreatIntelResult } from '../analysisModel';
import { tiSourceBadge } from '../tiSourceBadge';

const tiTone = (v: string): Tone => v === 'malicious' ? 'danger' : v === 'suspicious' ? 'warning' : v === 'clean' ? 'success' : 'muted';
const PROVIDER_LABEL: Record<string, string> = { mock: 'Mock', abuseipdb: 'AbuseIPDB', virustotal: 'VirusTotal' };

export function EnrichmentSidebar({ evidence, tiResult, busy, onEnrich, onSaveEvidence, saved }: { evidence: ParsedEvidence; tiResult: ThreatIntelResult | null; busy: boolean; onEnrich: () => void; onSaveEvidence: () => void; saved: boolean }) {
  const box: CSSProperties = { padding: '12px 14px' };
  const targetIp = evidence.destination.ip || evidence.source.ip || '';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card style={box}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}><Globe size={14} style={{ color: 'var(--accent)' }} /> Threat Intel</span>
          {tiResult && (() => { const b = tiSourceBadge(tiResult.source); return <Badge tone={b.tone}>{b.label}</Badge>; })()}
        </div>

        {!targetIp ? (
          <div style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>Keine IP zum Anreichern (Destination/Source leer).</div>
        ) : !tiResult ? (
          <>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 8 }}>Ziel: <span className="mono" style={{ color: 'var(--text)' }}>{targetIp}</span></div>
            <Button variant="primary" size="sm" icon={<Globe size={13} />} disabled={busy} onClick={onEnrich} style={{ width: '100%' }}>{busy ? 'Enriching …' : 'Enrich'}</Button>
            <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 8 }}>Mock intelligence — Provider (VirusTotal/AbuseIPDB) noch nicht verbunden.</div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Badge tone={tiTone(tiResult.verdict)} dot>{tiResult.verdict}</Badge>
              <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{tiResult.indicatorValue}</span>
            </div>
            <div style={{ display: 'flex', gap: 14, fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 6 }}>
              <span>Score <b style={{ color: 'var(--text)' }}>{tiResult.score}</b></span>
              <span>Confidence <b style={{ color: 'var(--text)' }}>{tiResult.confidence}%</b></span>
            </div>
            {tiResult.tags.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>{tiResult.tags.map((t) => <Badge key={t} tone="muted">{t}</Badge>)}</div>}
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 8 }}>{tiResult.summary}</div>
            <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 6 }}>
              {tiResult.providers.map((p) => (
                <div key={p.provider} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '2px 0' }}>
                  <span style={{ color: 'var(--text-dim)' }} title={p.rawSummary || ''}>{PROVIDER_LABEL[p.provider] || p.provider}</span>
                  <Badge tone={p.status === 'ok' ? tiTone(p.verdict) : p.status === 'not_configured' ? 'muted' : p.status === 'rate_limited' ? 'warning' : 'danger'}>{p.status === 'ok' ? p.verdict : p.status}</Badge>
                </div>
              ))}
            </div>
            {(() => {
              const isLocal = tiResult.tags.some((x) => ['multicast', 'internal', 'rfc1918', 'local-network-control'].includes(x));
              if (tiResult.verdict === 'malicious' || tiResult.verdict === 'suspicious') {
                return <div style={{ marginTop: 8, padding: '6px 8px', borderRadius: 'var(--radius-sm)', background: 'var(--danger-soft)', color: 'var(--danger)', fontSize: 11 }}>Reputation suggests suspicious activity. Analyst confirmation required.</div>;
              }
              if (isLocal) {
                return <div style={{ marginTop: 8, padding: '6px 8px', borderRadius: 'var(--radius-sm)', background: 'var(--success-soft)', color: 'var(--success)', fontSize: 11 }}>Local/multicast/internal indicator. Possible false-positive context.</div>;
              }
              return null;
            })()}
            <Button variant="ghost" size="sm" disabled={busy} onClick={onEnrich} style={{ width: '100%', marginTop: 8 }}>Erneut prüfen</Button>
            <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 6 }}>Threat Intel = Kontext, keine automatische Ticket-Entscheidung.</div>
          </>
        )}
      </Card>

      <Card style={box}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Evidence Actions</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Button variant={saved ? 'ghost' : 'primary'} size="sm" disabled={!tiResult || saved} onClick={onSaveEvidence} title={!tiResult ? 'Zuerst „Enrich"' : ''}>{saved ? '✓ Als Evidence gespeichert' : 'Add enrichment as Evidence'}</Button>
          <Button variant="ghost" size="sm" disabled title="Coming soon">Mark as Important</Button>
        </div>
      </Card>
    </div>
  );
}
