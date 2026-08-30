// Security-Score-Card mit Donut und Empfehlungsliste.
// Score kommt aus computeSecurityPosture — transparent, kein Hardcode.
// ADR-009: "Empfehlungen anzeigen" listet echte offene Punkte.

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardHeader, CardBody, Donut, Button } from '../../components/ui';
import type { SecurityPosture } from './securityScore';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';

interface SecurityScoreCardProps {
  posture: SecurityPosture;
}

function scoreColor(score: number): string {
  if (score >= 60) return 'var(--success)';
  if (score >= 35) return 'var(--warning)';
  return 'var(--danger)';
}

function scoreLabel(score: number): string {
  if (score >= 60) return 'Gut';
  if (score >= 35) return 'Verbesserungsbedarf';
  return i18n.t('common.critical');
}

const s = {
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 20,
  } satisfies React.CSSProperties,

  recList: {
    listStyle: 'none',
    margin: '12px 0 0',
    padding: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  } satisfies React.CSSProperties,

  recItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    fontSize: 12,
    color: 'var(--text-muted)',
    lineHeight: 1.4,
  } satisfies React.CSSProperties,

  dot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: 'var(--warning)',
    flexShrink: 0,
    marginTop: 4,
  } satisfies React.CSSProperties,

  legend: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
    flex: 1,
  } satisfies React.CSSProperties,

  legendRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 12,
  } satisfies React.CSSProperties,
};

export function SecurityScoreCard({ posture }: SecurityScoreCardProps) {
  const { t: tr } = useTranslation();
  const [showRecs, setShowRecs] = useState(false);

  const color = scoreColor(posture.score);

  const segments = [
    { label: 'Score', value: posture.score,          color },
    { label: 'Rest',  value: 100 - posture.score,    color: 'var(--border-soft)' },
  ];

  return (
    <Card>
      <CardHeader
        title="Security Score"
        actions={
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            aus echten Richtlinien berechnet
          </span>
        }
      />
      <CardBody>
        <div style={s.row}>
          <Donut
            segments={segments}
            size={120}
            thickness={14}
            centerTop={`${posture.score}`}
            centerBottom={scoreLabel(posture.score)}
          />

          <div style={s.legend}>
            <LegendRow label={tr('settings.passwordStrength')} value={
              posture.passwordStrength === 'stark' ? 'Stark'
                : posture.passwordStrength === 'ok' ? 'Ausreichend'
                : 'Schwach'
            } color={
              posture.passwordStrength === 'stark' ? 'var(--success)'
                : posture.passwordStrength === 'ok' ? 'var(--warning)'
                : 'var(--danger)'
            } />
            <LegendRow label={tr('common.session')} value={
              posture.sessionRating === 'streng' ? 'Streng'
                : posture.sessionRating === 'ok' ? 'Ausreichend'
                : 'Locker'
            } color={
              posture.sessionRating === 'streng' ? 'var(--success)'
                : posture.sessionRating === 'ok' ? 'var(--warning)'
                : 'var(--accent)'
            } />
            <LegendRow label="MFA"  value={tr('settings.0NotImplemented')} color="var(--danger)" />
            <LegendRow label="SSO"  value={tr('text.notConfigured')}         color="var(--text-dim)" />
          </div>
        </div>

        {/* Empfehlungen */}
        <Button
          variant="ghost"
          size="sm"
          style={{ marginTop: 12 }}
          onClick={() => setShowRecs((v) => !v)}
          icon={showRecs ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        >
          {posture.recommendations.length} Empfehlungen anzeigen
        </Button>

        {showRecs && (
          <ul style={s.recList}>
            {posture.recommendations.map((rec) => (
              <li key={rec} style={s.recItem}>
                <span style={s.dot} />
                <span>{rec}</span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function LegendRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={s.legendRow}>
      <span style={{ color: 'var(--text-dim)' }}>{label}</span>
      <span style={{ color, fontWeight: 600, fontSize: 11 }}>{value}</span>
    </div>
  );
}
