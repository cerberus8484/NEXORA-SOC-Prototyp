// Security-Posture-Karten (obere Reihe im Sicherheit-Tab).
// Zeigt Passwort-Stärke, Sitzungs-Rating, MFA-Abdeckung, SSO-Status.
// Alle Werte aus computeSecurityPosture — kein Fake-Wert.

import type { SecurityPosture, PasswordStrength, SessionRating } from './securityScore';
import { Badge } from '../../components/ui';

interface SecurityPostureProps {
  posture: SecurityPosture;
}

// ── Posture-Karten ────────────────────────────────────────────────────────────

const s = {
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 12,
  } satisfies React.CSSProperties,

  card: {
    background: 'var(--bg-card-soft)',
    border: '1px solid var(--border-soft)',
    borderRadius: 'var(--radius-sm)',
    padding: '14px 12px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  } satisfies React.CSSProperties,

  label: {
    fontSize: 10,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    color: 'var(--text-dim)',
    fontWeight: 600,
  } satisfies React.CSSProperties,

  value: {
    fontSize: 15,
    fontWeight: 700,
    color: 'var(--text)',
  } satisfies React.CSSProperties,

  sub: {
    fontSize: 11,
    color: 'var(--text-dim)',
    marginTop: 2,
  } satisfies React.CSSProperties,
};

function pwTone(strength: PasswordStrength): 'success' | 'warning' | 'danger' {
  if (strength === 'stark') return 'success';
  if (strength === 'ok') return 'warning';
  return 'danger';
}

function sessionTone(rating: SessionRating): 'success' | 'warning' | 'accent' {
  if (rating === 'streng') return 'success';
  if (rating === 'ok')     return 'warning';
  return 'accent';
}

export function SecurityPostureCards({ posture }: SecurityPostureProps) {
  return (
    <div style={s.grid}>
      {/* Passwort-Richtlinie */}
      <div style={s.card}>
        <div style={s.label}>Passwort-Stärke</div>
        <div style={s.value}>
          <Badge tone={pwTone(posture.passwordStrength)}>
            {posture.passwordStrength === 'stark' ? 'Stark'
              : posture.passwordStrength === 'ok' ? 'Ausreichend'
              : 'Schwach'}
          </Badge>
        </div>
        <div style={s.sub}>Serverseitig erzwungen</div>
      </div>

      {/* Sitzungs-Richtlinie */}
      <div style={s.card}>
        <div style={s.label}>Sitzungs-Richtlinie</div>
        <div style={s.value}>
          <Badge tone={sessionTone(posture.sessionRating)}>
            {posture.sessionRating === 'streng' ? 'Streng'
              : posture.sessionRating === 'ok' ? 'Ausreichend'
              : 'Locker'}
          </Badge>
        </div>
        <div style={s.sub}>Serverseitig erzwungen</div>
      </div>

      {/* MFA — bewusst 0 % */}
      <div style={s.card}>
        <div style={s.label}>MFA-Abdeckung</div>
        <div style={{ ...s.value, color: 'var(--text-dim)' }}>0 %</div>
        <div style={s.sub}>Nicht implementiert — geplant</div>
      </div>

      {/* SSO — bewusst nicht konfiguriert */}
      <div style={s.card}>
        <div style={s.label}>SSO / OIDC</div>
        <div style={{ ...s.value, color: 'var(--text-dim)' }}>
          <Badge tone="muted">Nicht konfiguriert</Badge>
        </div>
        <div style={s.sub}>Geplant — noch nicht verfügbar</div>
      </div>
    </div>
  );
}
