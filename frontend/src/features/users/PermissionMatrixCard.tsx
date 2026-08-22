import { Lock, Check, Minus } from 'lucide-react';
import {
  ROLE_PERMISSION_MATRIX,
  PERMISSION_LABELS,
  type RoleName,
  type PermissionRow,
} from './rolePermissions';

const ROLE_ORDER: RoleName[] = ['viewer', 'analyst', 'engineer', 'admin'];
const PERMISSION_KEYS = Object.keys(PERMISSION_LABELS) as (keyof PermissionRow)[];

const s: Record<string, React.CSSProperties> = {
  card: {
    background: 'var(--bg-card, #141824)',
    border: '1px solid var(--border, rgba(255,255,255,0.08))',
    borderRadius: 10,
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    overflowX: 'auto',
  },
  title: {
    fontSize: 13,
    fontWeight: 700,
    color: 'var(--text)',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: 12,
  },
  th: {
    padding: '6px 10px',
    textAlign: 'center' as const,
    fontWeight: 700,
    fontSize: 11,
    color: 'var(--text-dim)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    borderBottom: '1px solid var(--border, rgba(255,255,255,0.08))',
    whiteSpace: 'nowrap' as const,
  },
  thLabel: {
    padding: '6px 10px',
    textAlign: 'left' as const,
    fontWeight: 700,
    fontSize: 11,
    color: 'var(--text-dim)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    borderBottom: '1px solid var(--border, rgba(255,255,255,0.08))',
  },
  td: {
    padding: '7px 10px',
    textAlign: 'center' as const,
    borderBottom: '1px solid var(--border, rgba(255,255,255,0.05))',
    verticalAlign: 'middle' as const,
  },
  tdLabel: {
    padding: '7px 10px',
    textAlign: 'left' as const,
    color: 'var(--text)',
    borderBottom: '1px solid var(--border, rgba(255,255,255,0.05))',
    fontSize: 12,
    verticalAlign: 'middle' as const,
  },
  legend: {
    display: 'flex',
    gap: 16,
    fontSize: 11,
    color: 'var(--text-dim)',
    marginTop: 4,
  },
  legendItem: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
  },
  hint: {
    fontSize: 11,
    color: 'var(--text-dim)',
    fontStyle: 'italic',
    marginTop: 4,
  },
};

const ROLE_DISPLAY: Record<RoleName, string> = {
  viewer: 'Viewer',
  analyst: 'Analyst',
  engineer: 'Engineer',
  admin: 'Admin',
};

function PermCell({ allowed }: { allowed: boolean }) {
  return allowed ? (
    <Check size={14} color="var(--success, #22c55e)" aria-label="Erlaubt" />
  ) : (
    <Minus size={14} color="var(--text-dim, #6b7280)" aria-label="Nicht erlaubt" />
  );
}

/**
 * Statische Berechtigungs-Matrix (Funktion × Rolle).
 * Akkurat zur echten RBAC — Durchsetzung serverseitig.
 */
export function PermissionMatrixCard() {
  return (
    <div style={s.card}>
      <span style={s.title}>
        <Lock size={14} /> Berechtigungs-Matrix
      </span>

      <table style={s.table} aria-label="Berechtigungs-Matrix: Funktion je Rolle">
        <thead>
          <tr>
            <th style={s.thLabel}>Funktion</th>
            {ROLE_ORDER.map((role) => (
              <th key={role} style={s.th}>{ROLE_DISPLAY[role]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PERMISSION_KEYS.map((key) => (
            <tr key={key}>
              <td style={s.tdLabel}>{PERMISSION_LABELS[key]}</td>
              {ROLE_ORDER.map((role) => (
                <td key={role} style={s.td}>
                  <PermCell allowed={ROLE_PERMISSION_MATRIX[role][key]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div style={s.legend}>
        <span style={s.legendItem}>
          <Check size={12} color="var(--success, #22c55e)" /> Erlaubt
        </span>
        <span style={s.legendItem}>
          <Minus size={12} color="var(--text-dim, #6b7280)" /> Nicht erlaubt
        </span>
      </div>

      <p style={s.hint}>
        Durchsetzung erfolgt serverseitig. Die UI-Anzeige spiegelt die tatsächliche RBAC.
      </p>
    </div>
  );
}

import React from 'react';
