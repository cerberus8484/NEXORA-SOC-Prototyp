import { useEffect, useState, type CSSProperties } from 'react';
import { ServerCog, RotateCw, ShieldAlert, Lock, ShieldCheck, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Card, CardBody, Badge, Button, EmptyState, Spinner, ErrorCard, ConfirmDialog, HelpTip } from '../components/ui';
import { servicesApi, type ManagedService } from '../features/services/servicesApi';
import {
  restartResultMessage, restartErrorMessage, type RestartFeedback,
} from '../features/services/restartFeedback';
import { armSourceLabel, deriveArmView } from '../features/services/armPresentation';
import { ArmPasswordDialog } from '../features/services/ArmPasswordDialog';
import { ApiError } from '../lib/apiClient';
import { useAuth } from '../lib/auth';
import { can } from '../lib/rbac';

// Services — admin-only Steuerungsfläche für managed Infrastruktur-Dienste.
// Erster Dienst: Wazuh Manager (Neustart, z. B. nach validierter FP-Ausnahme).
// Der Neustart selbst läuft über den bestehenden, gegateten Endpoint
// (POST /wazuh/manager/restart) — diese Seite RUFT ihn nur, mit Bestätigung
// und ehrlichem Feedback (kein Fake-Erfolg).

const s: Record<string, CSSProperties> = {
  page:       { display: 'flex', flexDirection: 'column', gap: 20 },
  header:     { display: 'flex', alignItems: 'flex-start', gap: 12 },
  headerText: { flex: 1 },
  title:      { fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: 0 },
  subtitle:   { fontSize: 12.5, color: 'var(--text-dim)', margin: '4px 0 0', maxWidth: 720, lineHeight: 1.55 },

  grid:       { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16, alignItems: 'start' },

  // Gradient-Karte (Design-System: nie flach) mit ruhigem Akzent-Rahmen.
  svcCard:    { position: 'relative', overflow: 'hidden',
                background: 'linear-gradient(160deg, var(--bg-card) 0%, color-mix(in srgb, var(--bg-card) 88%, var(--accent)) 140%)',
                border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                display: 'flex', flexDirection: 'column', gap: 14, padding: 18 },
  svcTop:     { display: 'flex', alignItems: 'flex-start', gap: 12 },
  svcIconBox: { width: 40, height: 40, borderRadius: 10, flexShrink: 0, display: 'grid', placeItems: 'center',
                background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
                border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)' },
  svcName:    { fontSize: 15, fontWeight: 700, color: 'var(--text)', margin: 0 },
  svcMeta:    { display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' as const },
  svcDesc:    { fontSize: 12.5, color: 'var(--text-dim)', margin: 0, lineHeight: 1.6 },

  actionRow:  { display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--border-soft)', paddingTop: 14 },
  hint:       { display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.5 },

  // ELI5-Erklärbox: beantwortet „Was ist das? / Wie erstelle ich einen? / Wie starte ich einen?"
  explain:    { background: 'var(--bg-card-soft)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px 16px' },
  explainH:   { fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: '0 0 6px' },
  explainP:   { fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 10px', lineHeight: 1.6 },
  steps:      { margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.7 },

  feedback:   { display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, padding: '9px 12px',
                borderRadius: 'var(--radius-sm)', lineHeight: 1.5 },
};

const feedbackStyle: Record<RestartFeedback['tone'], CSSProperties> = {
  success: { color: 'var(--success)', background: 'color-mix(in srgb, var(--success) 10%, transparent)', border: '1px solid var(--success)' },
  warning: { color: 'var(--warning)', background: 'color-mix(in srgb, var(--warning) 10%, transparent)', border: '1px solid var(--warning)' },
  error:   { color: 'var(--danger)',  background: 'color-mix(in srgb, var(--danger) 10%, transparent)',  border: '1px solid var(--danger)' },
};

function FeedbackIcon({ tone }: { tone: RestartFeedback['tone'] }) {
  if (tone === 'success') return <CheckCircle2 size={15} style={{ flexShrink: 0, marginTop: 1 }} />;
  if (tone === 'warning') return <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />;
  return <ShieldAlert size={15} style={{ flexShrink: 0, marginTop: 1 }} />;
}

/**
 * Eine Dienst-Karte. Kapselt Scharfschalt-/Restart-Fluss lokal, damit mehrere
 * Karten unabhängig voneinander laufen. Nur der Wazuh-Manager wird aktuell
 * unterstützt — andere IDs zeigen den Restart als nicht verfügbar.
 *
 * Zwei Stufen (Defense-in-Depth):
 *   1) Scharfschalten (Passwort-Step-up) → aktiviert den Restart-Gate.
 *   2) Neustarten (Bestätigungs-Dialog) → nutzt den bestehenden gegateten Endpoint.
 * Ehrlich: bleibt die Wazuh-API unkonfiguriert, bleibt der Neustart gesperrt,
 * selbst wenn scharfgeschaltet (kein Fake-Erfolg).
 */
function ServiceCard({ service, onArmChange }: { service: ManagedService; onArmChange: () => void }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [armOpen, setArmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [armBusy, setArmBusy] = useState(false);
  const [armError, setArmError] = useState('');
  const [feedback, setFeedback] = useState<RestartFeedback | null>(null);

  const restartable = service.id === 'wazuh-manager';
  const view = deriveArmView(service);
  const canRestart = view.canRestart && restartable;

  async function doRestart() {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await servicesApi.restartWazuhManager();
      setFeedback(restartResultMessage(res));
      setConfirmOpen(false);
    } catch (err) {
      // Fehler bleibt sichtbar — ehrlich, kein Fake.
      setFeedback(restartErrorMessage(err));
      setConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function doArm(password: string) {
    setArmBusy(true);
    setArmError('');
    try {
      await servicesApi.arm(password);
      setArmOpen(false);
      onArmChange(); // Katalog neu laden → armed-Zustand + Restart-Freigabe aktualisieren.
    } catch (err) {
      // Ehrliche, nicht-leakende Meldung nur aus dem HTTP-Status.
      const status = err instanceof ApiError ? err.status : 0;
      setArmError(
        status === 403 ? 'Passwort ungültig.'
          : status === 400 ? 'Passwort erforderlich.'
            : 'Scharfschalten fehlgeschlagen.',
      );
    } finally {
      setArmBusy(false);
    }
  }

  async function doDisarm() {
    setArmBusy(true);
    setFeedback(null);
    try {
      await servicesApi.disarm();
      onArmChange();
    } catch {
      // Entschärfen ist die sichere Richtung; onArmChange() gleicht den Zustand beim
      // Reload ab. Aber: schlägt das Entschärfen fehl, ist der Dienst evtl. noch
      // scharf — das muss der Nutzer sehen (sonst stiller Fehlschlag).
      setFeedback({ tone: 'error', text: 'Entschärfen fehlgeschlagen — bitte erneut versuchen.' });
      onArmChange();
    } finally {
      setArmBusy(false);
    }
  }

  return (
    <div style={s.svcCard}>
      <div style={s.svcTop}>
        <div style={s.svcIconBox}>
          <ServerCog size={20} style={{ color: 'var(--accent)' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={s.svcName}>{service.name}</p>
          <div style={s.svcMeta}>
            <Badge tone="muted">{service.category}</Badge>
            <Badge tone={view.armBadgeTone} dot>{view.armBadge}</Badge>
            <Badge tone={service.connection.apiConfigured ? 'success' : 'muted'}>
              {service.connection.apiConfigured ? 'API verbunden' : 'API fehlt'}
            </Badge>
            <Badge tone={service.connection.indexerConfigured ? 'success' : 'muted'}>
              {service.connection.indexerConfigured ? 'Indexer verbunden' : 'Indexer fehlt'}
            </Badge>
          </div>
        </div>
      </div>

      <p style={s.svcDesc}>{service.description}</p>

      {service.connection.configured && !service.connection.apiConfigured && (
        <div style={s.hint}>
          <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1, color: 'var(--warning)' }} />
          <span>
            Die Wazuh-Integration ist teilweise hinterlegt, aber f&uuml;r den Manager-Neustart fehlt
            noch die API-Verbindung. Ein Indexer allein reicht daf&uuml;r nicht aus.
          </span>
        </div>
      )}

      {service.armed && (
        <div style={s.hint}>
          <ShieldCheck size={13} style={{ flexShrink: 0, marginTop: 1, color: 'var(--success)' }} />
          <span>{armSourceLabel(service.armSource)}.</span>
        </div>
      )}

      <div style={s.actionRow}>
        {restartable && view.showArm && (
          <Button
            variant="primary"
            icon={<ShieldCheck size={14} />}
            disabled={armBusy}
            onClick={() => { setArmError(''); setArmOpen(true); }}
          >
            Restart scharfschalten
          </Button>
        )}

        {restartable && service.armed && (
          <Button
            variant="primary"
            icon={<RotateCw size={14} />}
            disabled={!canRestart || busy}
            onClick={() => { setFeedback(null); setConfirmOpen(true); }}
          >
            Neu starten
          </Button>
        )}

        {restartable && view.showDisarm && (
          <Button
            variant="ghost"
            icon={<Lock size={14} />}
            disabled={armBusy}
            onClick={doDisarm}
          >
            Entschärfen
          </Button>
        )}

        {!canRestart && (
          <div style={s.hint}>
            <Lock size={13} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              {restartable
                ? (service.restart.disabledReason === 'Wazuh-API nicht konfiguriert'
                    ? 'Wazuh-API nicht konfiguriert — Neustart nicht möglich (auch scharfgeschaltet).'
                    : 'Restart nicht scharfgeschaltet — zum Aktivieren oben scharfschalten (Passwort) '
                      + 'oder WAZUH_MANAGER_RESTART_ENABLED=true setzen.')
                : 'Für diesen Dienst ist noch kein Neustart hinterlegt.'}
            </span>
          </div>
        )}

        {feedback && (
          <div role="status" style={{ ...s.feedback, ...feedbackStyle[feedback.tone] }}>
            <FeedbackIcon tone={feedback.tone} />
            <span>{feedback.text}</span>
          </div>
        )}
      </div>

      <ArmPasswordDialog
        open={armOpen}
        busy={armBusy}
        error={armError}
        onConfirm={doArm}
        onCancel={() => setArmOpen(false)}
      />

      <ConfirmDialog
        open={confirmOpen}
        danger
        title="Wazuh Manager neu starten?"
        message={
          'Der Wazuh-Manager geht dabei kurz offline. Die Konfiguration wird vor dem '
          + 'Neustart geprüft — bei invalider Config wird der Neustart abgebrochen. '
          + 'Die Aktion wird protokolliert.'
        }
        confirmLabel="Neu starten"
        busy={busy}
        onConfirm={doRestart}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

/**
 * Services-Control — admin-only Übersicht steuerbarer Infrastruktur-Dienste.
 * Eigener Top-Level-Sidebar-Eintrag „Services" (via navConfig; admin-only, kein Landing).
 */
export function ServicesPage() {
  const { user } = useAuth();
  const isAdmin = can.admin(user?.role);

  const [services, setServices] = useState<ManagedService[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    const ctrl = new AbortController();
    servicesApi.list({ signal: ctrl.signal })
      .then((res) => setServices(res.data))
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        setError('Dienste konnten nicht geladen werden.');
        void err;
      });
    return () => ctrl.abort();
  }, [isAdmin]);

  // Nach Scharfschalten/Entschärfen den Katalog frisch laden (armed-Zustand +
  // Restart-Freigabe kommen server-seitig — kein optimistisches Fälschen).
  function reload() {
    servicesApi.list()
      .then((res) => setServices(res.data))
      .catch(() => setError('Dienste konnten nicht geladen werden.'));
  }

  return (
    <div style={s.page}>
      <div style={s.header}>
        <ServerCog size={22} style={{ color: 'var(--accent)', marginTop: 2 }} />
        <div style={s.headerText}>
          <h1 style={{ ...s.title, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            Services
            <HelpTip topic="services" />
          </h1>
          <p style={s.subtitle}>
            Steuerung managed Infrastruktur-Dienste. Aktuell: Neustart des Wazuh-Managers —
            etwa nachdem eine False-Positive-Ausnahme validiert wurde und „restart_required"
            meldet. Der Neustart ist server-seitig gegated, validiert die Config vorab und wird
            protokolliert.
          </p>
        </div>
      </div>

      {isAdmin && (
        <div style={s.explain}>
          <p style={s.explainH}>Was ist diese Seite — in einfach</p>
          <p style={s.explainP}>
            Hier startest du wichtige Hintergrund-Programme neu (z.B. den Wazuh Manager, das
            Herzstück, das die Sicherheits-Alarme sammelt). <strong>Du legst hier keine neuen
            Dienste an</strong> — welche Dienste steuerbar sind, meldet das System selbst; sie
            erscheinen von allein als Karte. Wenn keine Karte da ist, gibt es gerade nichts zu tun.
          </p>
          <p style={{ ...s.explainH, marginTop: 4 }}>So startest du einen Dienst neu</p>
          <ol style={s.steps}>
            <li>Auf der Dienst-Karte auf <strong>„Restart scharfschalten"</strong> klicken und dein Passwort eingeben (Sicherheits-Schritt).</li>
            <li>Dann erscheint <strong>„Neu starten"</strong> — draufklicken und im Dialog bestätigen.</li>
            <li>Fertig. Das Ergebnis steht direkt auf der Karte (grün = geklappt, rot = Fehler mit Grund).</li>
          </ol>
          <p style={{ ...s.explainP, margin: '10px 0 0' }}>
            Steht „Wazuh-API nicht konfiguriert"? Dann zuerst unter <strong>Integrationen</strong>
            die Wazuh-Verbindung eintragen — vorher ist ein Neustart nicht möglich.
          </p>
        </div>
      )}

      {!isAdmin ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={<ServerCog size={28} />}
              title="Keine Berechtigung"
              message="Die Services-Steuerung ist Administratoren vorbehalten. Die Durchsetzung erfolgt serverseitig."
            />
          </CardBody>
        </Card>
      ) : error ? (
        <ErrorCard message={error} />
      ) : services === null ? (
        <Spinner />
      ) : services.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={<ServerCog size={28} />}
              title="Keine steuerbaren Dienste"
              message="Es sind aktuell keine managed Dienste registriert."
            />
          </CardBody>
        </Card>
      ) : (
        <div style={s.grid}>
          {services.map((svc) => <ServiceCard key={svc.id} service={svc} onArmChange={reload} />)}
        </div>
      )}

      {/* Wazuh-Verbindung liegt jetzt zentral unter Integrations → /integrations/config
          (Services = reine Ops: scharfschalten & neu starten). */}
    </div>
  );
}
