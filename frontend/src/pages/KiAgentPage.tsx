import { useState, useEffect } from 'react';
import { Bot, ShieldCheck, Wrench, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardHeader, CardBody, Badge, EmptyState, HelpTip } from '../components/ui';
import { autonomyApi } from '../features/autonomy/autonomyApi';
import { KiSettingsCard } from '../features/settings/KiSettingsCard';
import { RagCard } from '../features/settings/RagCard';
import { KI_ANALYSIS_FUNCTIONS } from '../features/analysis/deck/kiAnalysisFunctions';
import { KI_ACTION_RBAC } from '../features/aiAgent/kiAgentRbac';
import { useAuth } from '../lib/auth';
import { can } from '../lib/rbac';
import { useTranslation } from 'react-i18next';

// ── Styles ─────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page:         { display: 'flex', flexDirection: 'column', gap: 20 },
  header:       { display: 'flex', alignItems: 'flex-start', gap: 12 },
  headerText:   { flex: 1 },
  title:        { fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: 0 },
  subtitle:     { fontSize: 12.5, color: 'var(--text-dim)', margin: '4px 0 0' },

  grid2:        { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' },

  fnRow:        { display: 'flex', alignItems: 'baseline', gap: 10, padding: '7px 0',
                  borderBottom: '1px solid var(--border)' },
  fnLabel:      { fontSize: 13, fontWeight: 600, color: 'var(--text)', minWidth: 180 },
  fnDesc:       { fontSize: 12, color: 'var(--text-dim)', flex: 1 },

  rbacRow:      { display: 'flex', alignItems: 'flex-start', gap: 10, padding: '7px 0',
                  borderBottom: '1px solid var(--border)' },
  rbacAction:   { fontSize: 13, fontWeight: 600, color: 'var(--text)', minWidth: 180 },
  rbacDesc:     { fontSize: 12, color: 'var(--text-dim)', flex: 1 },
  rbacRole:     { flexShrink: 0 },

  hitlBox:      { display: 'flex', flexDirection: 'column', gap: 10 },
  hitlStatus:   { display: 'flex', alignItems: 'center', gap: 10 },
  hitlLabel:    { fontSize: 13.5, fontWeight: 600, color: 'var(--text)' },
  hitlBody:     { fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.6 },
  linkRow:      { display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 },
  link:         { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5,
                  color: 'var(--accent)', textDecoration: 'none' },

  plannedBox:   { display: 'flex', flexDirection: 'column', gap: 8 },
  plannedNote:  { fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.6,
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 6, padding: '10px 14px' },
  plannedLabel: { fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: 0.5,
                  color: 'var(--text-dim)', fontWeight: 600 },
  dimLabel:     { fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: 0.4,
                  color: 'var(--text-dim)' },
};

// ── Hilfsfunktion: Badge-Ton nach Rolle ────────────────────────────────────

function roleBadgeTone(role: string): 'warning' | 'muted' | 'accent' {
  if (role === 'admin') return 'warning';
  if (role === 'engineer') return 'accent';
  return 'muted';
}

// ── Teilkomponenten ────────────────────────────────────────────────────────

/**
 * Übersicht aller 9 KI-Analysefunktionen — DRY-Import aus kiAnalysisFunctions.ts.
 * Rein informativer Katalog; operative Nutzung im Analysis-„KI Analyse"-Tab.
 */
function KiFunctionsCard() {
  const { t: tr } = useTranslation();
  return (
    <Card>
      <CardHeader title={tr('app.aiAnalysisFunctionsOverview')} />
      <CardBody>
        <div style={{ marginBottom: 8 }}>
          <span style={s.dimLabel}>{tr('ki.nineFunctionsActive')}</span>
        </div>
        <div>
          {KI_ANALYSIS_FUNCTIONS.map((fn) => (
            <div key={fn.kind ?? fn.label} style={s.fnRow}>
              <span style={s.fnLabel}>{fn.label}</span>
              <span style={s.fnDesc}>{fn.description}</span>
              {fn.kind && (
                <Badge tone="muted">
                  <code style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>{fn.kind}</code>
                </Badge>
              )}
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

/**
 * Human-in-the-Loop Status + Link zu Autonomy-Policies.
 * Kein eigener Schwellen-Editor — Konfiguration liegt in /autonomy-policies.
 */
function HitlCard() {
  const { t: tr } = useTranslation();
  // Badge spiegelt den echten Autonomy-Status statt einer statischen Behauptung.
  // null/Fehler (z. B. 403 für Nicht-Admins) → konservativ HITL anzeigen.
  const [autonomyOn, setAutonomyOn] = useState<boolean | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    autonomyApi.getStatus({ signal: ctrl.signal })
      .then((st) => setAutonomyOn(!!st.data.enabled))
      .catch(() => { /* unbekannt → HITL (sicherer Default) */ });
    return () => ctrl.abort();
  }, []);
  const hitl = autonomyOn !== true;
  return (
    <Card>
      <CardHeader
        title="Human-in-the-Loop & Confidence"
        actions={<Badge tone={hitl ? 'success' : 'warning'} dot>{hitl ? tr('text.manualApprovalActive') : tr('text.autonomyActive')}</Badge>}
      />
      <CardBody>
        <div style={s.hitlBox}>
          <div style={s.hitlStatus}>
            <ShieldCheck size={18} style={{ color: hitl ? 'var(--success)' : 'var(--warning)', flexShrink: 0 }} />
            <span style={s.hitlLabel}>Modus: {hitl ? tr('deploy.manualApproval') : tr('text.autonomyActiveSeePolicies')}</span>
          </div>
          <p style={s.hitlBody}>{tr('ki.humanInLoopLong')}</p>
          <div style={s.linkRow}>
            <ExternalLink size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <Link to="/autonomy-policies" style={s.link}>{tr('ki.configureAutonomy')}</Link>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

/**
 * RBAC-Matrix für KI-Aktionen — read-only Anzeige.
 * Durchsetzung liegt serverseitig (authenticate.js + Route-Middleware).
 */
function KiRbacCard() {
  const { t: tr } = useTranslation();
  return (
    <Card>
      <CardHeader title="Rollenrechte — KI-Aktionen" />
      <CardBody>
        <div style={{ marginBottom: 8 }}>
          <span style={s.dimLabel}>{tr('ki.readOnlyEnforcement')}</span>
        </div>
        <div>
          {KI_ACTION_RBAC.map((row) => (
            <div key={row.action} style={s.rbacRow}>
              <span style={s.rbacAction}>{row.label}</span>
              <span style={s.rbacDesc}>{row.description}</span>
              <span style={s.rbacRole}>
                <Badge tone={roleBadgeTone(row.minRole)}>{row.minRole}+</Badge>
              </span>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

/**
 * Prompt-Templates — ehrliche „geplant"-Karte.
 * Prompts liegen aktuell serverseitig im OllamaLlmProvider._buildPromptFromBundle().
 * Kein Pseudo-Editor, kein Fake-Store.
 */
function PromptTemplatesCard() {
  const { t: tr } = useTranslation();
  return (
    <Card>
      <CardHeader
        title="Prompt-Templates"
        actions={<Badge tone="muted">{tr('common.planned')}</Badge>}
      />
      <CardBody>
        <div style={s.plannedBox}>
          <div style={s.plannedNote}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Wrench size={14} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
              <span style={s.plannedLabel}>{tr('app.notAvailableYet')}</span>
            </div>
            Prompts liegen aktuell serverseitig im{' '}
            <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>OllamaLlmProvider._buildPromptFromBundle()</code>{tr('ki.templatesPlanned')}</div>
          <div style={{ marginTop: 4 }}>
            <span style={s.dimLabel}>{tr('app.availableFunctionsKinds')}</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {KI_ANALYSIS_FUNCTIONS.filter((f) => f.kind).map((f) => (
                <Badge key={f.kind} tone="muted">
                  <code style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>{f.kind}</code>
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

// ── Hauptseite ─────────────────────────────────────────────────────────────

/**
 * KI Agent — Konfigurationsseite (admin-only).
 *
 * NICHT die operative KI: Vorschläge/Triage/Approve-Reject laufen im
 * Analysis-Deck → Tab „KI Analyse" (am aktiven Ticket). Hier nur Konfiguration:
 * Provider/Modell/Base-URL/RAG sowie Übersichten (Funktionen, HITL, Rollen).
 *
 * Confidence-Schwellen + Autonomie-Modi → /autonomy-policies (kein Duplikat hier).
 * Prompt-Templates → ehrlich als „geplant" markiert (kein Pseudo-Editor).
 */
export function KiAgentPage() {
  const { t: tr } = useTranslation();
  const { user } = useAuth();
  const isAdmin = can.admin(user?.role);

  return (
    <div style={s.page}>
      <div style={s.header}>
        <Bot size={22} style={{ color: 'var(--accent)', marginTop: 2 }} />
        <div style={s.headerText}>
          <h1 style={{ ...s.title, display: 'flex', alignItems: 'center', gap: 6 }}>{tr('ki.pageTitle')}<HelpTip topic="ki-agent" />
          </h1>
          <p style={s.subtitle}>{tr('ki.pageSubtitle')}</p>
        </div>
      </div>

      {!isAdmin ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={<Bot size={28} />}
              title={tr('text.noPermission')}
              message={tr('app.aiAgentConfigurationReservedAdministrators')}
            />
          </CardBody>
        </Card>
      ) : (
        <>
          {/* Reihe 1: Provider/Modell + RAG */}
          <div style={s.grid2}>
            <KiSettingsCard isAdmin={isAdmin} />
            <RagCard />
          </div>

          {/* Reihe 2: Funktions-Übersicht + HITL/Autonomy-Link */}
          <div style={s.grid2}>
            <KiFunctionsCard />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <HitlCard />
              <KiRbacCard />
            </div>
          </div>

          {/* Reihe 3: Prompt-Templates (ehrlich geplant) */}
          <PromptTemplatesCard />
        </>
      )}
    </div>
  );
}
