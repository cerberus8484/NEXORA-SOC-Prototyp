import { useEffect, useState, type CSSProperties } from 'react';
import { Brain } from 'lucide-react';
import { Card, CardHeader, CardBody, Badge, Button } from '../../components/ui';
import { ragApi, type RagStatusResponse } from '../rag/ragApi';
import { can } from '../../lib/rbac';
import { useAuth } from '../../lib/auth';
import { useAutoResetFlag } from '../../hooks/useAutoResetFlag';
import { ApiError } from '../../lib/apiClient';

const LABEL: CSSProperties = { fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-dim)' };

/**
 * RAG-Wissensbasis-Karte — Status (Qdrant/Collection/Vektoren) + Admin-Reindex.
 * Eigenständig (lädt Status selbst). Lebt im Settings-KI-Tab, seit die KI-Agent-Seite
 * entfernt wurde (Vorschläge liegen im Analysis-„KI Analyse"-Tab).
 */
export function RagCard() {
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
          ? 'RAG ist nicht aktiviert (RAG_ENABLED=false) — Reindex nicht möglich.'
          : e instanceof Error ? e.message : 'Reindex fehlgeschlagen.';
        setError(msg);
      })
      .finally(() => { setBusy(false); });
  };

  return (
    <Card>
      <CardHeader
        title="RAG-Wissensbasis"
        actions={status ? <Badge tone={status.enabled ? 'success' : 'muted'}>{status.enabled ? 'Aktiv' : 'Deaktiviert'}</Badge> : null}
      />
      <CardBody>
        {!status ? (
          <div style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>Status wird geladen …</div>
        ) : !status.enabled ? (
          <div style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.6 }}>
            RAG ist deaktiviert (<code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>RAG_ENABLED=false</code>).
            Der KI-Agent arbeitet ohne Vektorsuche. Zum Aktivieren <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>RAG_ENABLED=true</code> setzen und Server neu starten.
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              <div>
                <div style={LABEL}>Qdrant</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: status.qdrantReachable ? 'var(--success)' : 'var(--danger)', flexShrink: 0 }} />
                  {status.qdrantReachable ? 'Erreichbar' : 'Nicht erreichbar'}
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
                      ? <span style={{ color: 'var(--warning)' }}>Collection nicht indexiert</span>
                      : '—'}
                </div>
              </div>
            </div>
            {can.admin(user?.role) && (
              <div style={{ marginLeft: 'auto' }}>
                <Button variant="ghost" size="sm" icon={<Brain size={13} />} disabled={busy || reindexStarted} onClick={handleReindex}>
                  {busy ? 'Startet …' : reindexStarted ? 'Gestartet' : 'Neu indexieren'}
                </Button>
                {error && <div style={{ fontSize: 11.5, color: 'var(--danger)', marginTop: 6, maxWidth: 320 }}>{error}</div>}
                {reindexStarted && !error && <div style={{ fontSize: 11.5, color: 'var(--success)', marginTop: 6 }}>Reindex läuft im Hintergrund.</div>}
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
