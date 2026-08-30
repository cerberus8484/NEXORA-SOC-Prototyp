import { useEffect, useState, type CSSProperties } from 'react';
import { Brain } from 'lucide-react';
import { Card, CardHeader, CardBody, Badge, Button } from '../../components/ui';
import { ragApi, type RagStatusResponse } from '../rag/ragApi';
import { can } from '../../lib/rbac';
import { useAuth } from '../../lib/auth';
import { useAutoResetFlag } from '../../hooks/useAutoResetFlag';
import { ApiError } from '../../lib/apiClient';
import { useTranslation } from 'react-i18next';

const LABEL: CSSProperties = { fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-dim)' };

/**
 * RAG-Wissensbasis-Karte — Status (Qdrant/Collection/Vektoren) + Admin-Reindex.
 * Eigenständig (lädt Status selbst). Lebt im Settings-KI-Tab, seit die KI-Agent-Seite
 * entfernt wurde (Vorschläge liegen im Analysis-„KI Analyse"-Tab).
 */
export function RagCard() {
  const { t: tr } = useTranslation();
  const { user } = useAuth();
  const [status, setStatus] = useState<RagStatusResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reindexStarted, triggerReindexStarted] = useAutoResetFlag(3500);

  useEffect(() => {
    let active = true;
    ragApi.status()
      .then((r) => { if (active) setStatus(r); })
      .catch(() => { /* fail-safe: Status bleibt null */ });
    return () => { active = false; };
  }, []);

  const handleReindex = () => {
    setBusy(true);
    setError('');
    ragApi.reindex()
      .then(() => { triggerReindexStarted(); })
      .catch((e: unknown) => {
        const msg = e instanceof ApiError && e.status === 409
          ? tr('settings.ragNotEnabledRagEnabled')
          : e instanceof Error ? e.message : tr('settings.reindexFailed');
        setError(msg);
      })
      .finally(() => { setBusy(false); });
  };

  return (
    <Card>
      <CardHeader
        title="RAG-Wissensbasis"
        actions={status ? <Badge tone={status.enabled ? 'success' : 'muted'}>{status.enabled ? tr('common.active') : tr('common.disabled')}</Badge> : null}
      />
      <CardBody>
        {!status ? (
          <div style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>{tr('common.loadingStatus')}</div>
        ) : !status.enabled ? (
          <div style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.6 }}>{tr('settings.ragDisabledPrefix')}<code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>RAG_ENABLED=false</code>{tr('settings.ragDisabledMiddle')}<code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>RAG_ENABLED=true</code>{tr('settings.ragDisabledSuffix')}</div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              <div>
                <div style={LABEL}>Qdrant</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: status.qdrantReachable ? 'var(--success)' : 'var(--danger)', flexShrink: 0 }} />
                  {status.qdrantReachable ? 'Erreichbar' : tr('text.unreachable')}
                </div>
              </div>
              <div>
                <div style={LABEL}>Collection</div>
                <div style={{ fontSize: 12.5, fontFamily: 'var(--font-mono)' }}>{status.collection}</div>
              </div>
              <div>
                <div style={LABEL}>Vektoren</div>
                <div style={{ fontSize: 12.5 }}>
                  {status.vectorCount !== null
                    ? status.vectorCount.toLocaleString('de-DE')
                    : status.qdrantReachable && status.collectionExists === false
                      ? <span style={{ color: 'var(--warning)' }}>{tr('settings.collectionNotIndexed')}</span>
                      : '—'}
                </div>
              </div>
            </div>
            {can.admin(user?.role) && (
              <div style={{ marginLeft: 'auto' }}>
                <Button variant="ghost" size="sm" icon={<Brain size={13} />} disabled={busy || reindexStarted} onClick={handleReindex}>
                  {busy ? 'Startet …' : reindexStarted ? 'Gestartet' : tr('label.reindex')}
                </Button>
                {error && <div style={{ fontSize: 11.5, color: 'var(--danger)', marginTop: 6, maxWidth: 320 }}>{error}</div>}
                {reindexStarted && !error && <div style={{ fontSize: 11.5, color: 'var(--success)', marginTop: 6 }}>{tr('settings.reindexingRunningBackground')}</div>}
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
