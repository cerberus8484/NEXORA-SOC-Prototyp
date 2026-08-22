import { useEffect, useState, type CSSProperties } from 'react';
import { ShieldCheck, ShieldAlert, ShieldX, CheckCircle2, XCircle } from 'lucide-react';
import { Card, CardHeader, CardBody, Badge, Button, Spinner, ErrorCard } from '../../components/ui';
import { ArmPasswordDialog } from '../services/ArmPasswordDialog';
import { deployApi, type DeployPreflight } from './deployApi';
import { preflightStatus, primaryAction } from './deployPreflightView';
import { ApiError } from '../../lib/apiClient';

const s: Record<string, CSSProperties> = {
  head:    { display: 'flex', alignItems: 'center', gap: 10 },
  desc:    { fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.5, marginBottom: 12 },
  checks:  { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 },
  check:   { display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13 },
  hint:    { fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.4 },
  blocker: { fontSize: 12, color: 'var(--warning)', lineHeight: 1.5, marginBottom: 10 },
};

const TONE_ICON = {
  success: <ShieldCheck size={18} aria-hidden />,
  warning: <ShieldAlert size={18} aria-hidden />,
  danger: <ShieldX size={18} aria-hidden />,
};

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message}${e.code ? ` (${e.code})` : ''}`;
  return e instanceof Error ? e.message : 'Unbekannter Fehler';
}

/**
 * Deployment Center — „Systemstatus"-Panel (Zwei-Schlüssel-Gate).
 * Zeigt armed/inert + jede Boot-Bedingung (grün/rot) und bietet den betrieblichen
 * Arm/Disarm-Toggle mit Passwort-Step-up. Der env-Boden (Kommissionierung) bleibt
 * beim Operator — dann ist kein Button da, nur der Hinweis.
 */
export function DeploySystemStatusPanel() {
  const [pf, setPf] = useState<DeployPreflight | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    const ctrl = new AbortController();
    deployApi.getPreflight({ signal: ctrl.signal })
      .then((r) => setPf(r.data))
      .catch((e) => { if (!(e instanceof Error && e.name === 'AbortError')) setLoadError(errMsg(e)); })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, []);

  if (loading) return <Card><CardBody><Spinner /></CardBody></Card>;
  if (loadError || !pf) return <ErrorCard message={loadError || 'Kein Status'} />;

  const status = preflightStatus(pf);
  const action = primaryAction(pf);

  async function handleConfirm(password: string) {
    setBusy(true); setActionError('');
    try {
      const { data: reauth } = await deployApi.reauth(password);
      const call = action.kind === 'disarm' ? deployApi.disarm : deployApi.arm;
      const { data } = await call(reauth.reauthToken);
      setPf(data);
      setDialogOpen(false);
    } catch (err) { setActionError(errMsg(err)); }
    finally { setBusy(false); }
  }

  return (
    <Card style={{ marginBottom: 12 }}>
      <CardHeader
        title={<span style={s.head}>{TONE_ICON[status.tone]}<span>Systemstatus — Deploy-Gate</span></span>}
        actions={<Badge tone={status.tone} dot>{status.label}</Badge>}
      />
      <CardBody>
        <p style={s.desc}>{status.description}</p>

        <div style={s.checks}>
          {pf.checks.map((c) => (
            <div key={c.id} style={s.check}>
              {c.ok
                ? <CheckCircle2 size={15} color="var(--success)" aria-hidden style={{ flexShrink: 0, marginTop: 1 }} />
                : <XCircle size={15} color="var(--warning)" aria-hidden style={{ flexShrink: 0, marginTop: 1 }} />}
              <span>
                {c.label}
                {!c.ok && c.hint ? <><br /><span style={s.hint}>{c.hint}</span></> : null}
              </span>
            </div>
          ))}
        </div>

        {action.kind === 'none' && action.disabledReason
          ? <p style={s.blocker}>{action.disabledReason}</p>
          : null}

        {action.kind === 'arm'
          ? <Button onClick={() => { setActionError(''); setDialogOpen(true); }}>Scharfschalten</Button>
          : null}
        {action.kind === 'disarm'
          ? <Button variant="ghost" onClick={() => { setActionError(''); setDialogOpen(true); }}>Entwaffnen</Button>
          : null}

        <ArmPasswordDialog
          open={dialogOpen}
          busy={busy}
          error={actionError}
          title={action.kind === 'disarm' ? 'Deploy entwaffnen' : 'Deploy scharfschalten'}
          description={action.kind === 'disarm'
            ? 'Zum Entwaffnen dein Passwort bestätigen. Danach ist Apply wieder inert (die Aktion wird protokolliert).'
            : 'Zum betrieblichen Scharfschalten dein Passwort bestätigen. Der env-Boden bleibt Voraussetzung; die Aktion wird protokolliert.'}
          confirmLabel={action.kind === 'disarm' ? 'Entwaffnen' : 'Scharfschalten'}
          onConfirm={handleConfirm}
          onCancel={() => { if (!busy) setDialogOpen(false); }}
        />
      </CardBody>
    </Card>
  );
}
