import type { CorrelationStatusInfo } from '../analysisModel';
import { corrStatusLabel, corrStatusTone, hasStaleResult, sanitizeFailureReason } from '../correlationStatusView';

interface Props {
  correlation: CorrelationStatusInfo;
}

function fmtTs(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const TONE_COLORS: Record<string, { dot: string; bg: string; border: string; text: string }> = {
  success: {
    dot: 'var(--success, #22c55e)',
    bg: 'var(--success-soft, rgba(34,197,94,0.08))',
    border: 'var(--success, #22c55e)',
    text: 'var(--success, #22c55e)',
  },
  warning: {
    dot: 'var(--warning, #f59e0b)',
    bg: 'var(--warning-soft, rgba(245,158,11,0.08))',
    border: 'var(--warning, #f59e0b)',
    text: 'var(--warning, #f59e0b)',
  },
  danger: {
    dot: 'var(--danger, #ef4444)',
    bg: 'var(--danger-soft, rgba(239,68,68,0.08))',
    border: 'var(--danger, #ef4444)',
    text: 'var(--danger, #ef4444)',
  },
  muted: {
    dot: 'var(--text-secondary, #6b7280)',
    bg: 'rgba(107,114,128,0.06)',
    border: 'var(--border, rgba(255,255,255,0.08))',
    text: 'var(--text-secondary, #6b7280)',
  },
};

export function CorrelationStatusBanner({ correlation }: Props) {
  const tone = corrStatusTone(correlation.status);
  const colors = TONE_COLORS[tone] ?? TONE_COLORS.muted;
  const label = corrStatusLabel(correlation.status);
  const stale = hasStaleResult(correlation);

  return (
    <div
      role="status"
      aria-label="Korrelationsstatus"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '7px 10px',
        borderRadius: 'var(--radius-sm, 6px)',
        border: `1px solid ${colors.border}`,
        background: colors.bg,
        fontSize: 12,
      }}
    >
      {/* Status-Zeile */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span
          aria-hidden="true"
          style={{
            width: 8, height: 8, borderRadius: '50%',
            background: colors.dot, flexShrink: 0,
          }}
        />
        <span style={{ color: colors.text, fontWeight: 500 }}>
          Korrelation:&nbsp;{label}
        </span>
        {correlation.status === 'current' && correlation.resultCreatedAt && (
          <span style={{ color: 'var(--text-secondary, #6b7280)', marginLeft: 4 }}>
            – {fmtTs(correlation.resultCreatedAt)}
          </span>
        )}
      </div>

      {/* Alter Stand — nur wenn aktiver/fehlgeschlagener Job + Resultat vorhanden */}
      {stale && correlation.resultCreatedAt && (
        <div style={{ color: 'var(--text-secondary, #6b7280)', paddingLeft: 15 }}>
          Letzter erfolgreicher Stand von {fmtTs(correlation.resultCreatedAt)}
        </div>
      )}

      {/* Sanitierter Fehlertext — niemals Stack-Trace/DB-Inhalt */}
      {correlation.status === 'failed' && (
        <div style={{ color: colors.text, paddingLeft: 15 }}>
          {sanitizeFailureReason(correlation.lastFailureReason)}
        </div>
      )}
    </div>
  );
}
