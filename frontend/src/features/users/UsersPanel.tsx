import { useEffect, useState } from 'react';
import {
  ShieldCheck, UserPlus, X, KeyRound, Copy, AlertTriangle,
  Search, ChevronLeft, ChevronRight, ShieldOff,
} from 'lucide-react';
import { ArmPasswordDialog } from '../services/ArmPasswordDialog';
import { ApiError } from '../../lib/apiClient';
import {
  Card, CardHeader, CardBody,
  Badge, Button, Select, EmptyState, Spinner, ErrorCard,
} from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { can } from '../../lib/rbac';
import { useConfirm } from '../../hooks/useConfirm';
import { userApi } from './userApi';
import { ROLES, canDeactivate, canChangeRoleTo, type ManagedUser } from './userMgmtModel';
import { resetPasswordResult, resetPasswordErrorMessage, type ResetPasswordSuccess } from './resetPasswordFeedback';
import { filterUsers, paginateUsers } from './userTableHelpers';
import { UserAuditFeed } from './UserAuditFeed';
import { RolesOverviewCard } from './RolesOverviewCard';
import { PermissionMatrixCard } from './PermissionMatrixCard';

const ROLE_OPTIONS = ROLES.map((r) => ({ value: r, label: r }));
const roleFilterOptions = () => [
  { value: '', label: i18n.t('label.allRoles') },
  ...ROLE_OPTIONS,
];
const PAGE_SIZE = 5;
const EMPTY_FORM = { email: '', password: '', role: 'analyst' };

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  outerGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gridTemplateRows: 'auto auto',
    gap: 16,
  },
  tableSection: {
    gridColumn: '1',
    gridRow: '1',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  auditSection: {
    gridColumn: '2',
    gridRow: '1',
  },
  rolesSection: {
    gridColumn: '1',
    gridRow: '2',
  },
  matrixSection: {
    gridColumn: '2',
    gridRow: '2',
  },
  searchBar: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: 8,
  },
  searchWrap: {
    position: 'relative' as const,
    display: 'flex',
    alignItems: 'center',
  },
  searchIcon: {
    position: 'absolute' as const,
    left: 9,
    color: 'var(--text-dim)',
    pointerEvents: 'none' as const,
  },
  searchInput: {
    padding: '6px 10px 6px 30px',
    fontSize: 12,
    borderRadius: 6,
    border: '1px solid var(--border, rgba(255,255,255,0.12))',
    background: 'var(--bg-input)',
    color: 'var(--text)',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
  },
  userRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 100px 80px 34px 34px',
    gap: 10,
    alignItems: 'center',
    padding: '9px 12px',
    borderRadius: 8,
    background: 'var(--bg-card-soft)',
  },
  nameCol: {
    minWidth: 0,
  },
  name: {
    fontSize: 12.5,
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  email: {
    fontSize: 11,
    color: 'var(--text-dim)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  lastLogin: {
    fontSize: 10,
    color: 'var(--text-dim)',
    marginTop: 1,
  },
  statusDot: {
    display: 'inline-block',
    width: 7,
    height: 7,
    borderRadius: '50%',
    flexShrink: 0,
  } as React.CSSProperties,
  pagination: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: 11,
    color: 'var(--text-dim)',
    marginTop: 4,
  },
  pageNav: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  inlineForm: {
    marginBottom: 2,
    padding: '14px 16px',
    borderRadius: 8,
    background: 'var(--bg-card-soft)',
    border: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatLastLogin(iso: string | null | undefined): string {
  if (!iso) return 'Nie';
  try {
    return new Intl.DateTimeFormat('de-DE', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

// ─── UsersPanel ───────────────────────────────────────────────────────────────

/**
 * Admin-Benutzerverwaltung — 4-Quadranten-Layout:
 *   oben links:  Benutzer-Tabelle (Such/Filter/Pagination)
 *   oben rechts: Audit-Aktivität (letzte User-Events)
 *   unten links: Rollenübersicht (Counts real, „Neue Rolle" ehrlich disabled)
 *   unten rechts: Berechtigungs-Matrix (akkurat zur echten RBAC)
 *
 * Sichtbarkeit (admin-only) entscheidet die SettingsPage; der Server erzwingt RBAC zusätzlich.
 */
export function UsersPanel() {
  const { t: tr } = useTranslation();
  const { user } = useAuth();
  const [users, setUsers]         = useState<ManagedUser[] | null>(null);
  const [listError, setListError] = useState('');
  const { confirm, confirmDialog } = useConfirm();
  const [actionError, setActionError] = useState('');
  const [busyId, setBusyId]       = useState('');

  // Tabellen-Filter + Pagination
  const [search, setSearch]       = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [page, setPage]           = useState(1);

  // Formular-State (Benutzer anlegen)
  const [showForm, setShowForm]   = useState(false);
  const [form, setForm]           = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [creating, setCreating]   = useState(false);

  // Passwort-Reset
  const isAdmin = can.admin(user?.role);
  const [resetResult, setResetResult] = useState<(ResetPasswordSuccess & { email: string }) | null>(null);
  const [copied, setCopied]       = useState(false);

  // MFA-Admin-Reset (Recovery für ausgesperrte User) — mit Passwort-Step-up des Admins.
  const [mfaTarget, setMfaTarget]   = useState<ManagedUser | null>(null);
  const [mfaBusy, setMfaBusy]       = useState(false);
  const [mfaError, setMfaError]     = useState('');
  const [mfaNotice, setMfaNotice]   = useState('');

  async function onResetMfa(password: string) {
    if (!mfaTarget) return;
    setMfaBusy(true);
    setMfaError('');
    try {
      await userApi.resetMfa(mfaTarget.id, password);
      setMfaNotice(tr('users.mfaResetDone', { email: mfaTarget.email }));
      setMfaTarget(null);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      setMfaError(
        status === 403 ? tr('common.invalidPassword')
          : status === 404 ? tr('ui.userNotFound')
            : status === 400 ? tr('users.passwordRequired')
              : tr('ui.resetFailed'),
      );
    } finally {
      setMfaBusy(false);
    }
  }

  useEffect(() => {
    let alive = true;
    userApi.list()
      .then((res) => { if (alive) setUsers(res.data); })
      .catch((err: unknown) => {
        if (alive) setListError(err instanceof Error ? err.message : i18n.t('text.loadingFailed2'));
      });
    return () => { alive = false; };
  }, []);

  // Seite zurücksetzen wenn Filter sich ändert
  useEffect(() => { setPage(1); }, [search, roleFilter]);

  function replace(updated: ManagedUser) {
    setUsers((prev) => (prev ? prev.map((u) => (u.id === updated.id ? updated : u)) : prev));
  }

  async function onRole(target: ManagedUser, role: string) {
    if (role === target.role) return;
    setBusyId(target.id);
    setActionError('');
    try {
      const res = await userApi.setRole(target.id, role);
      replace(res.data);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : tr('ui.roleChangeFailed'));
    } finally {
      setBusyId('');
    }
  }

  async function onActive(target: ManagedUser) {
    setBusyId(target.id);
    setActionError('');
    try {
      const res = await userApi.setActive(target.id, !target.isActive);
      replace(res.data);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : tr('ui.statusChangeFailed'));
    } finally {
      setBusyId('');
    }
  }

  async function onResetPassword(target: ManagedUser) {
    if (!(await confirm({
      title: tr('ui.resetPassword'),
      message: tr('users.resetPasswordConfirm', { email: target.email }),
      confirmLabel: tr('analysis.reset'),
      danger: true,
    }))) return;
    setBusyId(target.id);
    setActionError('');
    setCopied(false);
    try {
      const res = await userApi.resetPassword(target.id);
      const result = resetPasswordResult(res);
      if (result.ok) {
        setResetResult({ ...result, email: target.email });
      } else {
        setActionError(result.message);
      }
    } catch (err) {
      setActionError(resetPasswordErrorMessage(err));
    } finally {
      setBusyId('');
    }
  }

  async function copyTempPassword() {
    if (!resetResult) return;
    try {
      await navigator.clipboard.writeText(resetResult.tempPassword);
      setCopied(true);
    } catch (err) {
      setActionError(err instanceof Error ? tr('common.copyFailedWith', { message: err.message }) : tr('common.copyFailed'));
    }
  }

  function openForm() {
    setForm(EMPTY_FORM);
    setFormError('');
    setShowForm(true);
  }
  function closeForm() {
    setShowForm(false);
    setForm(EMPTY_FORM);
    setFormError('');
  }

  async function onCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!form.email.trim() || !form.email.includes('@')) {
      setFormError(tr('ui.pleaseEnterValidEmailAddress'));
      return;
    }
    if (form.password.length < 8) {
      setFormError(tr('ui.passwordMustLeast8Characters'));
      return;
    }
    setCreating(true);
    try {
      const res = await userApi.create({ email: form.email.trim(), password: form.password, role: form.role });
      setUsers((prev) => (prev ? [...prev, res.data].sort((a, b) => a.email.localeCompare(b.email)) : [res.data]));
      closeForm();
    } catch (err) {
      const msg = err instanceof Error ? err.message : tr('common.createFailed');
      setFormError(msg.includes('409') || msg.toLowerCase().includes('vorhanden')
        ? tr('users.emailExists')
        : msg);
    } finally {
      setCreating(false);
    }
  }

  const me = user?.id ?? '';

  // Gefilterte + paginierte Daten
  const filtered  = filterUsers(users ?? [], { search, role: roleFilter });
  const paginated = paginateUsers(filtered, page, PAGE_SIZE);
  const totalPages = paginated.totalPages;

  // ─── Render ──────────────────────────────────────────────────────────────

  const headerTitle = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <ShieldCheck size={15} />{tr('users.usersAndRoles')}</span>
  );
  const headerAction = (
    <Button size="sm" variant="primary" onClick={showForm ? closeForm : openForm}>
      {showForm
        ? <><X size={13} style={{ marginRight: 4 }} />{tr('common.cancel2')}</>
        : <><UserPlus size={13} style={{ marginRight: 4 }} />{tr('users.create')}</>}
    </Button>
  );

  return (
    <Card>
      {confirmDialog}
      <CardHeader title={headerTitle} actions={headerAction} />
      <CardBody>

        {/* Inline-Formular "Benutzer anlegen" */}
        {showForm && (
          <form onSubmit={(e) => void onCreateSubmit(e)} style={s.inlineForm}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 2 }}>{tr('users.createNew')}</div>
            {formError && (
              <div style={{ fontSize: 12, color: 'var(--danger)', padding: '6px 8px', background: 'rgba(220,38,38,0.08)', borderRadius: 4 }}>
                {formError}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 140px', gap: 8, alignItems: 'end' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>E-Mail</span>
                <input
                  type="email" autoComplete="off" required
                  value={form.email} placeholder="analyst@nexora.example" disabled={creating}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  style={{ padding: '6px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--border, rgba(255,255,255,0.12))', background: 'var(--bg-input)', color: 'var(--text)', outline: 'none', width: '100%', boxSizing: 'border-box' }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{tr('users.passwordMin8')}</span>
                <input
                  type="password" autoComplete="new-password" required minLength={8}
                  value={form.password} placeholder="••••••••" disabled={creating}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  style={{ padding: '6px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--border, rgba(255,255,255,0.12))', background: 'var(--bg-input)', color: 'var(--text)', outline: 'none', width: '100%', boxSizing: 'border-box' }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{tr('common.role')}</span>
                <Select options={ROLE_OPTIONS} value={form.role} disabled={creating}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button size="sm" variant="ghost" type="button" disabled={creating} onClick={closeForm}>{tr('common.cancel2')}</Button>
              <Button size="sm" variant="primary" type="submit" disabled={creating}>
                {creating ? tr('text.creating') : tr('common.save')}
              </Button>
            </div>
          </form>
        )}

        {/* 4-Quadranten-Grid */}
        <div style={s.outerGrid}>

          {/* ── Oben links: Benutzer-Tabelle ──────────────────────────────── */}
          <div style={s.tableSection}>

            {/* Such + Rollen-Filter */}
            <div style={s.searchBar}>
              <div style={s.searchWrap}>
                <Search size={13} style={s.searchIcon} />
                <input
                  type="search"
                  placeholder={tr('ui.searchNameEmail')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={s.searchInput}
                  aria-label={tr('users.search')}
                />
              </div>
              <Select
                options={roleFilterOptions()}
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
              />
            </div>

            {/* Fehler / Lader / Liste */}
            {actionError && (
              <div style={{ fontSize: 12, color: 'var(--danger)' }}>{actionError}</div>
            )}

            {users === null && !listError && <Spinner />}
            {listError && <ErrorCard message={listError} />}

            {users !== null && !listError && filtered.length === 0 && (
              <EmptyState
                title={tr('text.noUsersFound')}
                message={search || roleFilter ? tr('ui.adjustFilterClearSearch') : tr('ui.noUserAccountsYet')}
              />
            )}

            {users !== null && !listError && paginated.items.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {paginated.items.map((u) => {
                  const isSelf = u.id === me;
                  return (
                    <div
                      key={u.id}
                      style={{ ...s.userRow, opacity: u.isActive ? 1 : 0.55 }}
                    >
                      {/* Name + E-Mail + Status-Dot + Letzter Login */}
                      <div style={s.nameCol}>
                        <div style={s.name}>
                          <span style={{ ...s.statusDot, background: u.isActive ? 'var(--success, #22c55e)' : 'var(--text-dim, #6b7280)' }} title={u.isActive ? tr('common.active') : tr('text.inactive')} />
                          {u.displayName || u.email}
                          {isSelf && <Badge tone="muted">Ich</Badge>}
                        </div>
                        <div style={s.email}>{u.email}</div>
                        <div style={s.lastLogin}>
                          Letzter Login: {formatLastLogin(u.lastLoginAt)}
                        </div>
                      </div>

                      {/* Rollen-Selector */}
                      <Select
                        options={ROLE_OPTIONS}
                        value={u.role}
                        disabled={busyId === u.id}
                        onChange={(e) => {
                          const next = e.target.value;
                          if (canChangeRoleTo(me, u, next)) void onRole(u, next);
                        }}
                      />

                      {/* Aktiv/Inaktiv-Toggle */}
                      <Button
                        size="sm"
                        variant={u.isActive ? 'ghost' : 'primary'}
                        disabled={busyId === u.id || !canDeactivate(me, u)}
                        title={!canDeactivate(me, u) ? tr('ui.youCannotDeactivateYourOwn') : undefined}
                        onClick={() => void onActive(u)}
                      >
                        {u.isActive ? 'Deakt.' : 'Akt.'}
                      </Button>

                      {/* Passwort-Reset (admin only) */}
                      {isAdmin && (
                        <Button
                          size="sm" variant="ghost"
                          icon={<KeyRound size={13} />}
                          disabled={busyId === u.id}
                          title={tr('users.resetPasswordOf', { email: u.email })}
                          aria-label={tr('users.resetPasswordOf', { email: u.email })}
                          onClick={() => void onResetPassword(u)}
                        />
                      )}

                      {/* MFA-Reset (admin only) — Recovery für ausgesperrte User */}
                      {isAdmin && (
                        <Button
                          size="sm" variant="ghost"
                          icon={<ShieldOff size={13} />}
                          disabled={busyId === u.id}
                          title={tr('users.resetMfaTitle', { email: u.email })}
                          aria-label={tr('users.resetMfaOf', { email: u.email })}
                          onClick={() => { setMfaError(''); setMfaNotice(''); setMfaTarget(u); }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Pagination */}
            {users !== null && filtered.length > PAGE_SIZE && (
              <div style={s.pagination}>
                <span>
                  {filtered.length === 0
                    ? tr('users.zeroUsers')
                    : tr('common.rangeOf', { from: paginated.fromIndex, to: paginated.toIndex, total: paginated.totalCount })}
                </span>
                <div style={s.pageNav}>
                  <Button
                    size="sm" variant="ghost"
                    icon={<ChevronLeft size={13} />}
                    disabled={page <= 1}
                    aria-label={tr('common.previousPage')}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  />
                  <span style={{ fontSize: 11 }}>{page} / {totalPages}</span>
                  <Button
                    size="sm" variant="ghost"
                    icon={<ChevronRight size={13} />}
                    disabled={page >= totalPages}
                    aria-label={tr('ui.nextPage')}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  />
                </div>
              </div>
            )}
          </div>

          {/* ── Oben rechts: Audit-Aktivität ──────────────────────────────── */}
          <div style={s.auditSection}>
            <UserAuditFeed />
          </div>

          {/* ── Unten links: Rollenübersicht ──────────────────────────────── */}
          <div style={s.rolesSection}>
            <RolesOverviewCard users={users ?? []} />
          </div>

          {/* ── Unten rechts: Berechtigungs-Matrix ───────────────────────── */}
          <div style={s.matrixSection}>
            <PermissionMatrixCard />
          </div>
        </div>

        {/* MFA-Reset-Erfolg (nicht-blockierender Hinweis) */}
        {mfaNotice && (
          <div role="status" style={{ marginTop: 12, display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: 'var(--success)', background: 'color-mix(in srgb, var(--success) 10%, transparent)', border: '1px solid var(--success)', borderRadius: 6, padding: '8px 12px' }}>
            <ShieldOff size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{mfaNotice}</span>
          </div>
        )}

      </CardBody>

      {/* MFA-Admin-Reset: Passwort-Step-up des Admins */}
      <ArmPasswordDialog
        open={mfaTarget !== null}
        busy={mfaBusy}
        error={mfaError}
        title={tr('ui.resetMfa')}
        description={mfaTarget
          ? tr('users.resetMfaStepUp', { email: mfaTarget.email })
          : ''}
        confirmLabel={tr('ui.resetMfa')}
        onConfirm={(password) => void onResetMfa(password)}
        onCancel={() => setMfaTarget(null)}
      />

      {/* Temp-Passwort-Dialog */}
      {resetResult && (
        // a11y: Backdrop-Klick schließt (Maus-Ergänzung); Tastaturpfad ist der fokussierbare Schließen-Button im Dialog
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events
        <div
          role="dialog" aria-modal="true" aria-labelledby="reset-pw-title"
          style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', padding: 16 }}
          onClick={() => setResetResult(null)}
        >
          {/* onClick nur zur Event-Eindämmung (stopPropagation), keine Aktion; Dialog-Rolle liegt am Wrapper */}
          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(520px, 100%)', borderRadius: 12, padding: 20, background: 'var(--bg-card, #141824)', border: '1px solid var(--border, rgba(255,255,255,0.1))', display: 'flex', flexDirection: 'column', gap: 14 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 id="reset-pw-title" style={{ margin: 0, fontSize: 15, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--text)' }}>
                <KeyRound size={16} />{tr('users.temporaryPassword')}</h2>
              <Button size="sm" variant="ghost" icon={<X size={14} />} aria-label={tr('ui.closeDialog')} onClick={() => setResetResult(null)} />
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>{tr('users.newPasswordFor')}<strong style={{ color: 'var(--text)' }}>{resetResult.email}</strong>:
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{tr('ui.temporaryPassword')}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  readOnly value={resetResult.tempPassword} aria-label={tr('ui.temporaryPassword')}
                  onFocus={(e) => e.currentTarget.select()}
                  style={{ flex: 1, padding: '8px 10px', fontSize: 14, fontFamily: 'var(--font-mono, monospace)', borderRadius: 6, border: '1px solid var(--border, rgba(255,255,255,0.12))', background: 'var(--bg-input, #0e1420)', color: 'var(--text)', boxSizing: 'border-box' }}
                />
                <Button size="sm" variant="primary" icon={<Copy size={13} />} onClick={() => void copyTempPassword()}>
                  {copied ? tr('common.copied') : tr('common.copy')}
                </Button>
              </div>
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: 'var(--warning, #f59e0b)', background: 'rgba(245,158,11,0.08)', padding: '8px 10px', borderRadius: 6 }}>
              <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{resetResult.warning}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button size="sm" variant="ghost" onClick={() => setResetResult(null)}>{tr('common.close')}</Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

import React from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
