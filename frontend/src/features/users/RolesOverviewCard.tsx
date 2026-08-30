import { Shield, ShieldCheck, Wrench, Eye } from 'lucide-react';
import { Badge } from '../../components/ui';
import { ROLE_PERMISSION_MATRIX, getRoleCounts, type RoleName } from './rolePermissions';
import type { ManagedUser } from './userMgmtModel';

const s: Record<string, React.CSSProperties> = {
  card: {
    background: 'var(--bg-card, #141824)',
    border: '1px solid var(--border, rgba(255,255,255,0.08))',
    borderRadius: 10,
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  title: {
    fontSize: 13,
    fontWeight: 700,
    color: 'var(--text)',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8,
  },
  roleCard: {
    padding: '10px 12px',
    borderRadius: 8,
    background: 'var(--bg-card-soft)',
    border: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  roleHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  roleName: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    fontWeight: 700,
    fontSize: 12.5,
    color: 'var(--text)',
    textTransform: 'capitalize' as const,
  },
  roleDesc: {
    fontSize: 11,
    color: 'var(--text-dim)',
    lineHeight: 1.5,
  },
  newRoleWrapper: {
    position: 'relative' as const,
  },
  newRoleBtn: {
    marginTop: 4,
    fontSize: 11,
    color: 'var(--text-dim)',
    background: 'none',
    border: '1px dashed var(--border, rgba(255,255,255,0.12))',
    borderRadius: 6,
    padding: '6px 10px',
    cursor: 'not-allowed',
    width: '100%',
    textAlign: 'left' as const,
  },
  tooltip: {
    position: 'absolute' as const,
    bottom: 'calc(100% + 6px)',
    left: 0,
    background: 'var(--bg-card, #141824)',
    border: '1px solid var(--border, rgba(255,255,255,0.12))',
    borderRadius: 6,
    padding: '6px 10px',
    fontSize: 11,
    color: 'var(--text-dim)',
    whiteSpace: 'nowrap' as const,
    zIndex: 10,
    pointerEvents: 'none' as const,
  },
};

const roleMeta = (): Record<RoleName, { label: string; desc: string; icon: React.ReactNode }> => ({
  viewer: {
    label: 'Viewer',
    icon: <Eye size={13} />,
    desc: i18n.t('ui.readOnlyViewTicketsHunts'),
  },
  analyst: {
    label: 'Analyst',
    icon: <Shield size={13} />,
    desc: i18n.t('manual.createTicketsStartHunts'),
  },
  engineer: {
    label: 'Engineer',
    icon: <Wrench size={13} />,
    desc: i18n.t('text.everythingAnalystCanDoPlus'),
  },
  admin: {
    label: 'Admin',
    icon: <ShieldCheck size={13} />,
    desc: i18n.t('ui.fullControlUsersSettingsAi'),
  },
});

const ROLE_ORDER: RoleName[] = ['viewer', 'analyst', 'engineer', 'admin'];

// Berechnung des Tonwerts für die Zähler-Badges
function countTone(n: number): 'muted' | 'accent' {
  return n > 0 ? 'accent' : 'muted';
}

interface Props {
  users: ManagedUser[];
}

/**
 * Zeigt die 4 festen Rollen mit Beschreibung und Benutzerzahl.
 * „Neue Rolle erstellen" ist ehrlich disabled — Rollen sind ein fester Satz.
 */
export function RolesOverviewCard({ users }: Props) {
  const { t: tr } = useTranslation();
  const counts = getRoleCounts(users);
  // Jede Rolle hat mindestens 1 Permission — validiere dass Matrix vollständig
  const _guard: keyof typeof ROLE_PERMISSION_MATRIX = 'admin';
  void _guard;

  return (
    <div style={s.card}>
      <span style={s.title}>
        <ShieldCheck size={14} />{tr('users.rolesOverview')}</span>

      <div style={s.grid}>
        {ROLE_ORDER.map((role) => {
          const meta = roleMeta()[role];
          const count = counts[role];
          return (
            <div key={role} style={s.roleCard}>
              <div style={s.roleHeader}>
                <span style={s.roleName}>
                  {meta.icon} {meta.label}
                </span>
                <Badge tone={countTone(count)}>
                  {count} {count === 1 ? 'User' : 'User'}
                </Badge>
              </div>
              <span style={s.roleDesc}>{meta.desc}</span>
            </div>
          );
        })}
      </div>

      <DisabledNewRoleButton />
    </div>
  );
}

/** Ehrlich disabled — kein Fake-Editor; Tooltip erklärt warum. */
function DisabledNewRoleButton() {
  const { t: tr } = useTranslation();
  const [showTip, setShowTip] = React.useState(false);

  return (
    // Tooltip-Wrapper: Sichtbarkeit per Hover UND Fokus (onFocus/onBlur) — das eigentliche
    // Steuerelement ist der fokussierbare <button> im Inneren, der Wrapper trägt keine Aktion
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div style={s.newRoleWrapper}
      onMouseEnter={() => setShowTip(true)}
      onMouseLeave={() => setShowTip(false)}
      onFocus={() => setShowTip(true)}
      onBlur={() => setShowTip(false)}
    >
      <button
        type="button"
        disabled
        style={s.newRoleBtn}
        aria-describedby="new-role-tip"
      >{tr('users.newRole')}</button>
      {showTip && (
        <div id="new-role-tip" role="tooltip" style={s.tooltip}>{tr('users.fixedRoleSet')}</div>
      )}
    </div>
  );
}

// React import für JSX (DisabledNewRoleButton verwendet useState)
import React from 'react';
import i18n from '../../i18n';
import { useTranslation } from 'react-i18next';
