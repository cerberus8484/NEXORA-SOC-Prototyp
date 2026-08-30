// ApiTokensCard — Persönliche API-Tokens verwalten
//
// tokensEnabled=false → ehrliche "Geplant"-Card (kein Fake)
// tokensEnabled=true  → vollständige Token-Verwaltung
//
// SICHERHEITS-INVARIANTEN:
//   - Token-Wert wird NUR einmalig im Erstellungs-Modal angezeigt
//   - Nach Schließen des Modals wird der Token-Wert aus dem State gelöscht
//   - kein tokenHash in irgendeinem State-Feld

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Key, Copy, CheckCircle, Trash2, Plus } from 'lucide-react';
import {
  Badge, Button, Card, CardBody, CardHeader,
  EmptyState, Spinner,
} from '../../../components/ui';
import { listTokens, createToken, revokeToken } from '../api/apiTokensApi';
import type { ApiTokenItem } from '../api/apiTokensApi';
import { useTranslation } from 'react-i18next';

// ── Props ──────────────────────────────────────────────────────────────────

type Props = {
  tokensEnabled: boolean;
};

// ── Hauptkomponente ────────────────────────────────────────────────────────

export function ApiTokensCard({ tokensEnabled }: Props) {
  if (!tokensEnabled) {
    return <PlannedCard />;
  }
  return <ActiveCard />;
}

// ── Geplant-Card ───────────────────────────────────────────────────────────

function PlannedCard() {
  const { t: tr } = useTranslation();
  return (
    <Card>
      <CardBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, opacity: 0.65 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ color: 'var(--text-dim)' }}><Key size={20} /></div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{tr('settings.personalApiTokens')}</div>
            <span style={{ marginLeft: 'auto' }}><Badge tone="muted">{tr('common.planned')}</Badge></span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.6 }}>
            Erstellen, widerrufen und verwalten persönlicher API-Tokens für externe
            Skripte und Integrationen. Aktivierbar über{' '}
            <code style={s.inlineCode}>API_TOKENS_ENABLED=true</code>.
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', fontStyle: 'italic' }}>{tr('settings.backendPresentFlagOff')}</div>
          <Button variant="ghost" size="sm" disabled>{tr('common.configure')}</Button>
        </div>
      </CardBody>
    </Card>
  );
}

// ── Aktive Card ───────────────────────────────────────────────────────────

function ActiveCard() {
  const { t: tr } = useTranslation();
  const [tokens,  setTokens]  = useState<ApiTokenItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [showModal, setShowModal] = useState(false);
  // Einmaliger Token-Wert nach Erstellung — wird nach Schließen des Modals gelöscht
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null); // id

  function loadTokens() {
    setLoading(true);
    listTokens()
      .then(setTokens)
      .catch(() => setError(tr('settings.tokensCouldNotLoaded')))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadTokens();
  }, []);  

  async function handleRevoke(id: string) {
    setRevoking(id);
    try {
      await revokeToken(id);
      await loadTokens();
    } catch (e) {
      // Sicherheitsrelevant: ein fehlgeschlagener Revoke darf NICHT still bleiben
      // (sonst glaubt der Nutzer, das Token sei widerrufen).
      setError(e instanceof Error ? e.message : tr('settings.tokenCouldNotRevoked'));
    } finally {
      setRevoking(null);
    }
  }

  function handleModalClose() {
    // Token-Wert SOFORT aus State entfernen nach Schließen
    setCreatedToken(null);
    setShowModal(false);
    loadTokens();
  }

  return (
    <Card>
      <CardHeader
        title={tr('settings.personalApiTokens')}
        actions={
          <Button
            size="sm"
            icon={<Plus size={12} />}
            onClick={() => setShowModal(true)}
          >
            Neues Token
          </Button>
        }
      />
      <CardBody>
        {loading ? (
          <Spinner />
        ) : error ? (
          <EmptyState title={tr('common.error')} message={error} />
        ) : tokens.length === 0 ? (
          <EmptyState
            title={tr('text.noTokens')}
            message={tr('settings.createTokenExternalScriptsApi')}
          />
        ) : (
          <div style={s.tableWrapper}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Name</th>
                  <th style={s.th}>Prefix</th>
                  <th style={s.th}>Erstellt</th>
                  <th style={s.th}>{tr('common.expires')}</th>
                  <th style={s.th}>Status</th>
                  <th style={s.th} />
                </tr>
              </thead>
              <tbody>
                {tokens.map((tok) => (
                  <tr key={tok.id} style={s.tr}>
                    <td style={s.td}>{tok.name}</td>
                    <td style={s.td}>
                      <code style={s.code}>{tok.prefix}</code>
                    </td>
                    <td style={s.td}>
                      {new Date(tok.createdAt).toLocaleDateString('de-DE')}
                    </td>
                    <td style={s.td}>
                      {tok.expiresAt
                        ? new Date(tok.expiresAt).toLocaleDateString('de-DE')
                        : '—'}
                    </td>
                    <td style={s.td}>
                      {tok.revoked ? (
                        <Badge tone="muted">Widerrufen</Badge>
                      ) : (
                        <Badge tone="success" dot>{tr('common.active')}</Badge>
                      )}
                    </td>
                    <td style={s.td}>
                      {!tok.revoked && (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<Trash2 size={12} />}
                          onClick={() => handleRevoke(tok.id)}
                          disabled={revoking === tok.id}
                          title="Token widerrufen"
                        >
                          Widerrufen
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 12, lineHeight: 1.6 }}>{tr('settings.tokenShownOnce')}</div>
      </CardBody>

      {showModal && (
        <CreateTokenModal
          onClose={handleModalClose}
          onCreated={(plain) => setCreatedToken(plain)}
          createdToken={createdToken}
        />
      )}
    </Card>
  );
}

// ── Create-Token-Modal ────────────────────────────────────────────────────

type CreateModalProps = {
  onClose:      () => void;
  onCreated:    (token: string) => void;
  createdToken: string | null;
};

function CreateTokenModal({ onClose, onCreated, createdToken }: CreateModalProps) {
  const { t: tr } = useTranslation();
  const [name,      setName]      = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [creating,  setCreating]  = useState(false);
  const [error,     setError]     = useState('');
  const [copied,    setCopied]    = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  async function handleCreate() {
    if (!name.trim()) {
      setError(tr('common.nameRequired'));
      return;
    }
    setCreating(true);
    setError('');
    try {
      const result = await createToken({
        name: name.trim(),
        expiresAt: expiresAt || undefined,
      });
      onCreated(result.token);
    } catch {
      setError(tr('settings.tokenCouldNotCreated'));
    } finally {
      setCreating(false);
    }
  }

  function handleCopy() {
    if (!createdToken) return;
    void navigator.clipboard.writeText(createdToken).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div role="dialog" aria-modal="true" style={s.overlay}>
      <div style={s.modal}>
        <div style={s.modalHeader}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>
            {createdToken ? tr('audit.tokenCreated') : tr('label.createNewToken')}
          </span>
          <Button variant="ghost" size="sm" onClick={onClose}>✕</Button>
        </div>

        {createdToken ? (
          // Phase 2: Token einmalig anzeigen
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6 }}>{tr('settings.copyTokenNow')}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <code style={{ ...s.code, wordBreak: 'break-all', flex: 1, padding: '6px 10px' }}>
                {createdToken}
              </code>
              <Button
                variant="ghost"
                size="sm"
                icon={copied ? <CheckCircle size={12} /> : <Copy size={12} />}
                onClick={handleCopy}
              >
                {copied ? tr('common.copied') : tr('common.copy')}
              </Button>
            </div>
            <Button onClick={onClose}>{tr('common.close')}</Button>
          </div>
        ) : (
          // Phase 1: Formular
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={s.label}>Name</label>
              <input
                ref={inputRef}
                style={s.input}
                placeholder={tr('text.nameTokenEGCi')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                maxLength={100}
              />
            </div>
            <div>
              <label style={s.label}>{tr('settings.expiryDateOptional')}</label>
              <input
                type="date"
                style={s.input}
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>
            {error && (
              <div style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button variant="ghost" onClick={onClose} disabled={creating}>
                {tr('common.cancel')}
              </Button>
              <Button onClick={handleCreate} disabled={creating}>
                {creating ? tr('common.creating') : tr('settings.createToken')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const s: Record<string, CSSProperties> = {
  tableWrapper: {
    overflowX: 'auto',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-soft)',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 12,
  },
  th: {
    padding: '8px 12px',
    textAlign: 'left',
    fontSize: 10,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: 'var(--text-dim)',
    background: 'var(--bg-card-soft)',
    borderBottom: '1px solid var(--border-soft)',
  },
  td: {
    padding: '8px 12px',
    borderBottom: '1px solid var(--border-soft)',
    verticalAlign: 'middle',
  },
  tr: {},
  code: {
    fontFamily: 'var(--font-mono, monospace)',
    fontSize: 12,
    background: 'var(--bg-input)',
    color: 'var(--accent)',
    padding: '2px 6px',
    borderRadius: 4,
  },
  inlineCode: {
    fontFamily: 'var(--font-mono, monospace)',
    fontSize: 11,
    background: 'var(--bg-input)',
    color: 'var(--text)',
    padding: '1px 4px',
    borderRadius: 3,
  },
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: 'var(--bg-card)',
    border: '1px solid var(--border-soft)',
    borderRadius: 'var(--radius)',
    padding: 24,
    minWidth: 360,
    maxWidth: 520,
    width: '90vw',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  modalHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    display: 'block',
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text-dim)',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  input: {
    width: '100%',
    padding: '8px 10px',
    fontSize: 13,
    background: 'var(--bg-input)',
    color: 'var(--text)',
    border: '1px solid var(--border-soft)',
    borderRadius: 'var(--radius-sm)',
    outline: 'none',
    boxSizing: 'border-box',
  },
};
