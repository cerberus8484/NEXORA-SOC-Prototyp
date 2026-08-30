import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus, Search, Crosshair, Square, Download, Eye, Ticket, Archive,
  ShieldAlert, FileText, Monitor, Clock, Maximize2,
} from 'lucide-react';
import { Spinner, ErrorCard, Badge, Button, HelpTip, type Tone } from '../components/ui';
import { huntApi, type CreateHuntBody, type HuntCatalogItem } from '../features/hunts/huntApi';
import { NewHuntModal, type HuntModalInitialValues } from '../features/hunts/NewHuntModal';
import { followUpInitialValues } from '../features/hunts/followUpInitialValues';
import { FindingDetailPanel } from '../features/hunts/FindingDetailPanel';
import { ResponseActionsPanel } from '../features/hunts/ResponseActionsPanel';
import { HuntSubNav, type HuntSection } from '../features/hunts/HuntSubNav';
import { ConsoleFullView } from '../features/hunts/ConsoleFullView';
import { findingsToCsv } from '../features/hunts/findingsCsv';
import { filterFromParams, filterToParams } from '../features/hunts/huntFilterParams';
import { getHuntTypeMeta } from '../features/hunts/huntTypeCatalog';
import { useHuntSession } from '../features/hunts/useHuntSession';
import { deployApi } from '../features/deploy/deployApi';
import type { HuntSession } from '../lib/types';
import { can } from '../lib/rbac';
import { useAuth } from '../lib/auth';
import { onActivateKey } from '../lib/a11y';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';

const sevTone = (sev: string): Tone =>
  sev === 'critical' || sev === 'high' ? 'danger' : sev === 'medium' ? 'warning' : 'muted';
const riskTone = sevTone;

const statusLabel = (st: string): string =>
  ({ active: 'Running', planned: 'Draft', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled' }[st] ?? st);
const statusTone = (st: string): Tone =>
  st === 'active' ? 'success' : st === 'failed' ? 'danger' : st === 'planned' ? 'warning' : 'muted';

const s: Record<string, CSSProperties> = {
  iconBtn: { background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 2, display: 'inline-flex', alignItems: 'center' },
  grid:    { display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16, alignItems: 'start' },
  panel:   { background: 'var(--bg-card)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)' },
  search:  { width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '7px 10px 7px 30px', fontSize: 13, boxSizing: 'border-box' as const },
  groupLbl:{ fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase' as const, letterSpacing: 0.6, padding: '12px 14px 4px' },
  sess:    { padding: '9px 14px', borderLeft: '2px solid transparent', cursor: 'pointer' },
  sessOn:  { borderLeftColor: 'var(--accent)', background: 'var(--bg-card-soft, rgba(255,255,255,0.03))' },
  kpiRow:  { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 16 },
  kpi:     { background: 'var(--bg-card)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)', padding: '12px 16px' },
  console: { background: 'var(--bg-terminal, #0a0e17)', border: '1px solid var(--border-soft)', borderRadius: 6, padding: 12, fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.7, height: 320, overflowY: 'auto' },
  th:      { textAlign: 'left' as const, fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase' as const, letterSpacing: 0.5, padding: '8px 10px', borderBottom: '1px solid var(--border-soft)' },
  td:      { fontSize: 12.5, padding: '8px 10px', borderBottom: '1px solid var(--border-soft)' },
  secH:    { fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 },
  kvLbl:   { fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase' as const, letterSpacing: 0.4 },
};

const LOG_COLOR: Record<string, string> = {
  info: 'var(--text-muted, #8b95a7)', warning: 'var(--warning, #f5a623)',
  error: 'var(--danger, #ff5470)', success: 'var(--success, #00ff88)',
};

const SAFE_COMMANDS = ['whoami', 'hostname', 'tasklist', 'netstat -ano', 'ipconfig /all', 'Get-Process', 'Get-Service'];

// Toast-Nachricht mit optionalem Sprung ins erzeugte Ticket (Fund #7).
interface Toast {
  text: string;
  ticketId?: string;
}

function hhmmss(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('de-DE', { hour12: false });
}
function fmtDt(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString('de-DE') : '—';
}
function downloadBlob(content: string, type: string, filename: string): void {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function KvRow({ label, value }: { label: string; value?: React.ReactNode }) {
  const empty = value === undefined || value === null || value === '';
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0', borderBottom: '1px solid var(--border-soft)', fontSize: 12 }}>
      <span style={{ color: 'var(--text-dim)', flexShrink: 0 }}>{label}</span>
      <span style={{ color: empty ? 'var(--text-dim)' : 'var(--text)', textAlign: 'right', overflowWrap: 'anywhere' }}>{empty ? '—' : value}</span>
    </div>
  );
}

export function ThreatHuntsPage() {
  const { t: tr } = useTranslation();
  const { user } = useAuth();
  const canAct = can.act(user?.role);
  const canCancel = can.admin(user?.role); // huntApi.cancel ist Backend-seitig admin-only

  const [sessions, setSessions] = useState<HuntSession[] | null>(null);
  const [error, setError] = useState('');
  const [selId, setSelId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<HuntCatalogItem[] | null>(null);
  const [catalogError, setCatalogError] = useState(false);
  const [launching, setLaunching] = useState('');
  const [cmdInput, setCmdInput] = useState('');
  const [cmdBusy, setCmdBusy] = useState(false);
  const [findingIdx, setFindingIdx] = useState(0);
  const [showPanel, setShowPanel] = useState(true);
  const [showFullConsole, setShowFullConsole] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = useMemo(() => filterFromParams(searchParams), [searchParams]);
  const updateFilter = useCallback((patch: Partial<typeof filter>) => {
    setSearchParams(filterToParams({ ...filter, ...patch }), { replace: true });
  }, [filter, setSearchParams]);
  const [section, setSection] = useState<HuntSection>('overview');
  const canApprove = user?.role === 'admin' || user?.role === 'engineer';
  const [showModal, setShowModal] = useState(false);
  // Follow-up-Vorbelegung fürs Modal (Fund #2); leer = generisches „New Hunt".
  const [modalInitial, setModalInitial] = useState<HuntModalInitialValues | undefined>(undefined);
  // Toast: optionaler klickbarer Ticket-Link (Fund #7). null = kein Toast.
  const [toast, setToast] = useState<Toast | null>(null);
  const consoleRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Kurzform für einfache Text-Toasts ohne Ticket-Sprung.
  const notify = useCallback((text: string) => setToast({ text }), []);

  const loadSessions = useCallback(async () => {
    try {
      const res = await huntApi.listSessions();
      setSessions(res.data ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : i18n.t('common.failedLoad')); }
  }, []);

  const { data: sessionData, refresh: refreshSelected, pollDegraded } = useHuntSession(selId, loadSessions);
  const { session: selSession, logs, findings, commands, actions, artifacts, ticketLinks, circuit } = sessionData;

  useEffect(() => { void loadSessions(); }, [loadSessions]);

  useEffect(() => {
    setCatalogError(false);
    huntApi.catalog()
      .then((r) => setCatalog(r.data ?? []))
      // „leer" ≠ „Fehler": Katalog-Ladefehler markieren, statt ewig „wird geladen …".
      .catch(() => setCatalogError(true));
  }, []);

  // Erste Session automatisch auswählen (bevorzugt laufende) → Console/KPIs sofort befüllt.
  useEffect(() => {
    if (selId || !sessions || sessions.length === 0) return;
    const running = sessions.find((se) => se.status === 'active');
    setSelId((running ?? sessions[0]).id);
    setFindingIdx(0);
  }, [sessions, selId]);

  // Console auto-scroll.
  useEffect(() => {
    if (consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
  }, [logs]);

  // Generisches „New Hunt" — ohne Vorbelegung.
  function openNewHunt() {
    setModalInitial(undefined);
    setShowModal(true);
  }

  // Fund #2: Follow-up-Hunt auf ein konkretes Finding — Modal mit Kontext vorbelegen.
  function openFollowUpModal(finding: typeof selFinding) {
    setModalInitial(followUpInitialValues(finding, selSession));
    setShowModal(true);
  }

  async function handleCreate(body: CreateHuntBody) {
    const created = await huntApi.createSession(body);
    await huntApi.start(created.data.id);
    setShowModal(false);
    await loadSessions();
    setSelId(created.data.id);
    setFindingIdx(0);
    setShowPanel(true);
    setSection('console');
  }

  async function quickLaunch(item: HuntCatalogItem) {
    setLaunching(item.key);
    try {
      await handleCreate({
        huntType: item.key, targetHost: item.defaultTarget || item.label,
        targetType: item.targetType, riskLevel: item.riskLevel,
        scope: 'Quick-Launch · Vorgefertigter Hunt · Safe Collectors',
      });
    } catch (e) {
      notify(e instanceof Error ? e.message : tr('common.startFailed'));
    } finally { setLaunching(''); }
  }

  async function handleCancel() {
    if (!selId) return;
    try { await huntApi.cancel(selId); await refreshSelected(); await loadSessions(); }
    catch (e) { notify(e instanceof Error ? e.message : tr('common.cancelFailed')); }
  }

  function exportLog() {
    if (!selSession) return;
    const text = logs.map((l) => `[${hhmmss(l.timestamp)}] [${l.level.toUpperCase()}] ${l.message}`).join('\n');
    downloadBlob(text, 'text/plain', `hunt-${selSession.id.slice(0, 8)}.log`);
  }

  // Findings-Report (Markdown) — Session-Kopf + alle Findings mit MITRE/Empfehlung.
  function exportFindingsReport() {
    if (!selSession) return;
    const se = selSession;
    const md = [
      `# Hunt Report — ${se.title || se.targetHost}`, '',
      `**Typ:** ${getHuntTypeMeta(se.huntType)?.label || se.huntType} · **Status:** ${statusLabel(se.status)} · **Risk:** ${se.riskLevel}`,
      `**Target:** ${se.targetHost} · **Gestartet:** ${fmtDt(se.startedAt)} · **Beendet:** ${fmtDt(se.closedAt)}`,
      se.scope ? `**Scope:** ${se.scope}` : '',
      se.hypothesis ? `**Hypothese:** ${se.hypothesis}` : '', '',
      `## Findings (${findings.length})`,
      ...findings.flatMap((f) => [
        '', `### [${f.severity.toUpperCase()}] ${f.title}`,
        f.description || tr('ui.noDescription'),
        f.mitreAttack ? `**MITRE:** ${f.mitreAttack}` : '',
        f.recommendation ? i18n.t('hunts.recommendationLine', { text: f.recommendation }) : '',
      ]),
    ].filter(Boolean).join('\n');
    downloadBlob(md, 'text/markdown', `hunt-report-${se.id.slice(0, 8)}.md`);
  }

  // Findings als CSV (id, severity, title, description, createdAt).
  function exportFindingsCsv() {
    if (!selSession) return;
    if (findings.length === 0) { notify(tr('ui.noFindingsExport')); return; }
    downloadBlob(findingsToCsv(findings), 'text/csv;charset=utf-8', `hunt-findings-${selSession.id.slice(0, 8)}.csv`);
  }

  // Evidence-Bundle (JSON) — alles, was die Session erzeugt hat, in einem Paket.
  function exportBundle() {
    if (!selSession) return;
    const bundle = { exportedAt: new Date().toISOString(), session: selSession, findings, commands, artifacts, logs, ticketLinks };
    downloadBlob(JSON.stringify(bundle, null, 2), 'application/json', `hunt-bundle-${selSession.id.slice(0, 8)}.json`);
  }

  // Fund #4: konkrete Finding-id direkt übergeben — NICHT über findingIdx (async-State-Race,
  // sonst Aktion auf dem falschen Finding). Aufrufer reichen f.id / selFinding.id durch.
  async function findingAction(kind: 'ticket' | 'evidence', fid: string) {
    if (!selId || !fid) return;
    try {
      if (kind === 'ticket') {
        const res = await huntApi.createTicket(selId, fid);
        const newTicketId = res.data.ticketId;
        // Fund #7: klickbarer Toast mit Sprung ins Ticket, statt nur 8 Zeichen der id.
        if (newTicketId) {
          setToast({ text: `Ticket erstellt: ${newTicketId.slice(0, 8)}`, ticketId: newTicketId });
        } else {
          setToast({ text: tr('ui.ticketCreationStarted') });
        }
      } else {
        const res = await huntApi.addEvidence(selId, fid);
        setToast({
          text: `Evidence angelegt${res.data.ticketId ? ` (Ticket ${res.data.ticketId.slice(0, 8)})` : ''}`,
          ticketId: res.data.ticketId,
        });
      }
      await refreshSelected(); // ticketId am Finding aktualisieren
    } catch (e) { setToast({ text: e instanceof Error ? e.message : tr('tickets.errors.action') }); }
  }

  async function requestAction(kind: string, command?: string, reason?: string) {
    if (!selId) return;
    try {
      await huntApi.requestAction(selId, { kind, command, reason });
      await refreshSelected();
      notify(tr('services.requestAwaitingApproval'));
    } catch (e) { notify(e instanceof Error ? e.message : tr('common.requestFailed')); }
  }
  // detail = bei approve die Rechtsgrundlage (Betriebsrat/Notfall), bei reject der Grund.
  async function decideAction(actionId: string, decision: 'approve' | 'reject', detail?: string) {
    if (!selId) return;
    try {
      if (decision === 'approve') await huntApi.approveAction(selId, actionId, detail ?? '');
      else await huntApi.rejectAction(selId, actionId, detail ?? '');
      await refreshSelected();
    } catch (e) { notify(e instanceof Error ? e.message : tr('analysis.decisionFailed')); }
  }
  // ADR-042 Stufe 3: echte Ausführung. Ein Step-up pro Aktion — frisches Passwort →
  // einmaliger deploy_reauth-Token → Execute (admin-only + X-Reauth-Token am Server).
  // Wirft NICHT nach oben: Fehler landen im Toast, damit das Panel keinen Erfolg zeigt.
  async function executeAction(actionId: string, reauthPassword: string) {
    if (!selId) return;
    try {
      const { data } = await deployApi.reauth(reauthPassword);
      await huntApi.executeAction(selId, actionId, data.reauthToken);
      await refreshSelected();
      notify(tr('ui.containmentExecuted'));
    } catch (e) {
      notify(e instanceof Error ? e.message : tr('ui.executionFailed'));
      throw e; // Panel zeigt den Fehler inline + hält den Erfolgs-Reset zurück
    }
  }
  // ADR-042 Circuit-Breaker: Admin entsperrt den Containment-Kanal nach Review.
  async function resetResponseCircuit() {
    try {
      await huntApi.resetResponseCircuit();
      await refreshSelected();
      notify('Containment-Kanal entsperrt.');
    } catch (e) { notify(e instanceof Error ? e.message : tr('users.unlockFailed')); }
  }

  async function runCmd(cmd?: string) {
    const c = (cmd ?? cmdInput).trim();
    if (!selId || !c) return;
    setCmdBusy(true);
    try {
      await huntApi.runCommand(selId, c);
      setCmdInput('');
      await refreshSelected();
    } catch (e) {
      notify(e instanceof Error ? e.message : tr('ui.commandNotPermitted'));
    } finally { setCmdBusy(false); }
  }

  // RDP-Datei erzeugen (kein Credential-Handling) — sichere Platzhalter-Aktion.
  function makeRdpFile(host: string, ip?: string) {
    const rdp = `full address:s:${ip || host}\nprompt for credentials:i:1\nadministrative session:i:0\n`;
    downloadBlob(rdp, 'application/x-rdp', `${host}.rdp`);
    notify(tr('ui.rdpFileCreatedNoCredential'));
  }
  function openRdp() {
    const f = findings[findingIdx];
    const host = f?.context?.host || selSession?.targetHost || 'host';
    const ip = f?.context?.sourceIp || f?.context?.destinationIp || undefined;
    makeRdpFile(host, ip);
  }

  // ── Abgeleitete Daten ──
  const filtered = useMemo(() => {
    const list = sessions ?? [];
    const needle = filter.q.trim().toLowerCase();
    return list.filter((se) => {
      const haystack = `${se.title || ''} ${se.targetHost || ''} ${se.scope || ''}`.toLowerCase();
      const matchSearch = !needle || haystack.includes(needle);
      const matchStatus = !filter.status || se.status === filter.status;
      const matchType = !filter.type || se.huntType === filter.type;
      return matchSearch && matchStatus && matchType;
    });
  }, [sessions, filter]);

  const groups = useMemo(() => ({
    ACTIVE:    filtered.filter((se) => se.status === 'active'),
    COMPLETED: filtered.filter((se) => ['completed', 'failed', 'cancelled'].includes(se.status)),
    DRAFT:     filtered.filter((se) => se.status === 'planned'),
  }), [filtered]);

  const kpis = useMemo(() => {
    const hosts = new Set(findings.map((f) => f.context?.host).filter(Boolean));
    const sources = new Set(findings.map((f) => f.context?.source).filter(Boolean));
    const high = findings.filter((f) => f.severity === 'high' || f.severity === 'critical').length;
    return [
      ['Total Events', logs.length, 'var(--text)'],
      ['Findings', findings.length, 'var(--accent)'],
      ['High Severity', high, 'var(--danger, #ff5470)'],
      ['Affected Hosts', hosts.size, 'var(--text)'],
      ['Data Sources', sources.size, 'var(--text)'],
    ] as const;
  }, [logs, findings]);

  // Ereigniskette: Logs + Findings + Commands chronologisch zusammengeführt.
  const chain = useMemo(() => {
    type ChainItem = { time: string; kind: 'log' | 'finding' | 'command'; text: string; level?: string; severity?: string; status?: string };
    const items: ChainItem[] = [
      ...logs.map((l) => ({ time: l.timestamp, kind: 'log' as const, text: l.message, level: l.level })),
      ...findings.map((f) => ({ time: f.createdAt, kind: 'finding' as const, text: f.title, severity: f.severity })),
      ...commands.map((c) => ({ time: c.createdAt, kind: 'command' as const, text: c.command, status: c.status })),
    ];
    return items.sort((a, b) => a.time.localeCompare(b.time));
  }, [logs, findings, commands]);

  const dataSources = useMemo(() => [...new Set(findings.map((f) => f.context?.source).filter(Boolean))] as string[], [findings]);
  const targetHosts = useMemo(() => {
    const hosts = new Map<string, { primary: boolean; lastSeen?: string }>();
    if (selSession?.targetHost) hosts.set(selSession.targetHost, { primary: true, lastSeen: logs.length ? logs[logs.length - 1].timestamp : undefined });
    findings.forEach((f) => {
      const h = f.context?.host;
      if (h && !hosts.has(h)) hosts.set(h, { primary: false, lastSeen: f.createdAt });
    });
    return [...hosts.entries()].map(([host, meta]) => ({ host, ...meta }));
  }, [selSession, findings, logs]);

  if (error && !sessions) return <div style={{ padding: 24 }}><ErrorCard message={error} /></div>;
  if (!sessions) return <div style={{ padding: 24 }}><Spinner /></div>;

  const sel = selSession;
  const selFinding = findings[findingIdx];
  const typeMeta = sel ? getHuntTypeMeta(sel.huntType) : null;
  // null = noch nicht geladen / Ladefehler; für Listen-Renderings als [] behandeln.
  const catalogItems = catalog ?? [];
  // MITRE/Kategorie kommen aus dem Backend-Katalog (HuntTypeMeta kennt sie nicht).
  const catalogMeta = sel ? catalogItems.find((c) => c.key === sel.huntType) : undefined;

  return (
    <div style={{ padding: '16px 20px' }}>
      <div style={s.grid}>
        {/* ── Linkes Panel: Session Selector + Subnavigation ── */}
        <div style={s.panel}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 14px 8px' }}>
            <span style={{ fontSize: 14, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}>Hunt Sessions<HelpTip topic="hunts" /></span>
            {canAct && <Button variant="primary" size="sm" icon={<Plus size={13} />} onClick={openNewHunt}>New Hunt</Button>}
          </div>
          <div style={{ padding: '0 14px 8px', position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 22, top: 8, color: 'var(--text-dim)' }} />
            <input style={s.search} placeholder="Search sessions..." value={filter.q} onChange={(e) => updateFilter({ q: e.target.value })} />
          </div>
          <div style={{ padding: '0 14px 8px' }}>
            <select style={{ ...s.search, padding: '7px 10px' }} value={filter.status} onChange={(e) => updateFilter({ status: e.target.value })}>
              <option value="">All Status</option>
              <option value="active">Running</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="planned">Draft</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div style={{ padding: '0 14px 10px' }}>
            <select style={{ ...s.search, padding: '7px 10px' }} value={filter.type} onChange={(e) => updateFilter({ type: e.target.value })}>
              <option value="">All Types</option>
              {catalogItems.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>

          {(['ACTIVE', 'COMPLETED', 'DRAFT'] as const).map((g) => (
            <div key={g}>
              <div style={s.groupLbl}>{g} <span style={{ color: 'var(--text-dim)' }}>({groups[g].length})</span></div>
              {groups[g].map((se) => (
                <div key={se.id} style={{ ...s.sess, ...(se.id === selId ? s.sessOn : {}) }}
                  role="button"
                  tabIndex={0}
                  aria-selected={se.id === selId}
                  onClick={() => { setSelId(se.id); setFindingIdx(0); }}
                  onKeyDown={onActivateKey(() => { setSelId(se.id); setFindingIdx(0); })}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {se.title || getHuntTypeMeta(se.huntType)?.label || 'Hunt'}
                    </span>
                    <Badge tone={statusTone(se.status)}>{statusLabel(se.status)}</Badge>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-dim)' }}>
                    <span>{se.targetHost}</span>
                    <span>{hhmmss(se.createdAt)}</span>
                    <Badge tone={riskTone(se.riskLevel)}>{se.riskLevel}</Badge>
                    {se.findingsCount > 0 && <span>· {se.findingsCount} findings</span>}
                  </div>
                </div>
              ))}
              {groups[g].length === 0 && <div style={{ padding: '2px 14px 8px', fontSize: 11.5, color: 'var(--text-dim)' }}>—</div>}
            </div>
          ))}

          {sel && (
            <HuntSubNav active={section} onSelect={setSection}
              counts={{ findings: findings.length, commands: commands.length, evidence: artifacts.length, tickets: ticketLinks.length, response: actions.length }} />
          )}
        </div>

        {/* ── Mitte + rechtes Panel ── */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {!sel ? (
              <div style={{ ...s.panel, padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <Crosshair size={16} style={{ color: 'var(--accent)' }} />
                  <span style={{ fontSize: 14, fontWeight: 700 }}>Hunt Library</span>
                  <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{tr('text.prebuiltHuntsOneClickStarts')}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 12 }}>{tr('ui.chooseHuntRunningSessionLeft')}</div>
                {/* „leer" ≠ „Fehler": Ladefehler ehrlich anzeigen, nicht ewig „wird geladen". */}
                {catalogError ? (
                  <div style={{ fontSize: 12.5, color: 'var(--danger)' }}>{tr('ui.huntCatalogCannotLoadedRequest')}</div>
                ) : catalog === null ? (
                  <div style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>{tr('ui.loadingCatalog')}</div>
                ) : catalog.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>{tr('ui.noHuntAvailableCatalog')}</div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
                    {catalog.map((item) => (
                      <div key={item.key} style={{ background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{item.label}</span>
                          <Badge tone={riskTone(item.riskLevel)}>{item.riskLevel}</Badge>
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.4, flex: 1 }}>{item.description}</div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {item.category && <Badge tone="muted">{item.category}</Badge>}
                          {item.mitre && <Badge tone="muted">{item.mitre}</Badge>}
                        </div>
                        {canAct && (
                          <Button variant="primary" size="sm" icon={<Crosshair size={13} />} disabled={!!launching}
                            onClick={() => void quickLaunch(item)} style={{ justifyContent: 'center' }}>
                            {launching === item.key ? 'Starte …' : `Start · ${item.defaultTarget || 'Target'}`}
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
                {/* Poll degraded: ehrlicher Fehlerhinweis — der Live-Stand ist evtl.
                    veraltet, NICHT „nichts passiert". Kein stilles Weiterpollen. */}
                {pollDegraded && (
                  <div style={{ marginBottom: 14 }}>
                    <ErrorCard message={tr('ui.liveUpdateFailedBackendUnreachable')} />
                  </div>
                )}

                {/* ── Overview ── */}
                {section === 'overview' && (
                  <>
                    <div style={s.kpiRow}>
                      {kpis.map(([label, value, color]) => (
                        <div key={label} style={s.kpi}>
                          <div style={{ fontSize: 22, fontWeight: 700, color: color as string }}>{value}</div>
                          <div style={{ fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      <div style={{ ...s.panel, padding: 16 }}>
                        <div style={s.secH}><Crosshair size={15} style={{ color: 'var(--accent)' }} /> Hunt Summary</div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                          <Badge tone={statusTone(sel.status)}>{statusLabel(sel.status)}</Badge>
                          <Badge tone={riskTone(sel.riskLevel)}>Risk: {sel.riskLevel}</Badge>
                          {catalogMeta?.mitre && <Badge tone="warning">{catalogMeta.mitre}</Badge>}
                          {catalogMeta?.category && <Badge tone="muted">{catalogMeta.category}</Badge>}
                        </div>
                        <KvRow label="Hunt" value={sel.title || typeMeta?.label || sel.huntType} />
                        <KvRow label="Target" value={sel.targetHost} />
                        <KvRow label="Analyst" value={sel.analystId.slice(0, 12)} />
                        <KvRow label="Gestartet" value={fmtDt(sel.startedAt)} />
                        <KvRow label="Beendet" value={fmtDt(sel.closedAt)} />
                        <KvRow label="Scope" value={sel.scope} />
                        <KvRow label="Hypothese" value={sel.hypothesis} />
                        {sel.summary && <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 8 }}>{sel.summary}</div>}
                      </div>
                      <div style={{ ...s.panel, padding: 16 }}>
                        <div style={s.secH}><ShieldAlert size={15} style={{ color: 'var(--danger)' }} /> Letzte Findings</div>
                        {findings.length === 0 ? <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{tr('ui.noFindingsYet')}</div> :
                          findings.slice(0, 5).map((f, i) => (
                            <div key={f.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => { setFindingIdx(i); setSection('findings'); setShowPanel(true); }}
                              onKeyDown={onActivateKey(() => { setFindingIdx(i); setSection('findings'); setShowPanel(true); })}
                              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border-soft)', cursor: 'pointer' }}>
                              <Badge tone={sevTone(f.severity)}>{f.severity}</Badge>
                              <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.title}</span>
                              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{hhmmss(f.createdAt)}</span>
                            </div>
                          ))}
                        {dataSources.length > 0 && (
                          <div style={{ marginTop: 12 }}>
                            <div style={s.kvLbl}>Data Sources</div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                              {dataSources.map((src) => <Badge key={src} tone="accent">{src}</Badge>)}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}

                {/* ── Live Console ── */}
                {section === 'console' && (
                  <div style={{ ...s.panel, padding: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>Hunt Console: {sel.title || sel.targetHost}</span>
                      {/* Fund #5: „Pause" entfernt — der Hunt-Runner unterstützt kein Pausieren.
                          Ein dauerhaft deaktivierter Button ist irreführend (kein backing feature). */}
                      <Button variant="ghost" size="sm" icon={<Square size={13} />} onClick={() => void handleCancel()} disabled={!canCancel || (sel.status !== 'active' && sel.status !== 'planned')} title={!canCancel ? tr('ui.administratorsOnly') : undefined}>Stop</Button>
                      <Button variant="ghost" size="sm" icon={<Maximize2 size={13} />} onClick={() => setShowFullConsole(true)}>Vollansicht</Button>
                      <Button variant="ghost" size="sm" icon={<Download size={13} />} onClick={exportLog}>Export Log</Button>
                    </div>
                    <div style={{ display: 'flex', gap: 12, fontSize: 11.5, color: 'var(--text-dim)', marginBottom: 10 }}>
                      <Badge tone={statusTone(sel.status)}>{statusLabel(sel.status)}</Badge>
                      <span>Started: {fmtDt(sel.startedAt)}</span>
                      <span>Analyst: {sel.analystId.slice(0, 12)}</span>
                    </div>
                    <div style={{ ...s.console, height: 420 }} ref={consoleRef}>
                      {logs.length === 0
                        ? <div style={{ color: 'var(--text-dim)' }}>{tr('ui.noLogsYet')}</div>
                        : logs.map((l) => (
                          <div key={l.id}>
                            <span style={{ color: 'var(--text-dim)' }}>[{hhmmss(l.timestamp)}]</span>{' '}
                            <span style={{ color: LOG_COLOR[l.level] }}>[{l.level.toUpperCase()}]</span>{' '}
                            <span style={{ color: 'var(--text)' }}>{l.message}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {/* ── Findings ── */}
                {section === 'findings' && (
                  <div style={s.panel}>
                    <div style={{ ...s.secH, padding: '14px 16px 0', justifyContent: 'space-between' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ShieldAlert size={15} style={{ color: 'var(--danger)' }} /> Findings ({findings.length})</span>
                      <Button variant="ghost" size="sm" icon={<Download size={13} />} onClick={exportFindingsCsv} disabled={findings.length === 0}>CSV Export</Button>
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr>
                        {['Time', 'Severity', 'Title', 'Host', 'User / IP', 'Source', 'Status', 'Actions'].map((h) => <th key={h} style={s.th}>{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {findings.map((f, i) => (
                          <tr key={f.id} style={{ cursor: 'pointer', background: i === findingIdx ? 'var(--bg-card-soft, rgba(255,255,255,0.03))' : undefined }}
                            onClick={() => { setFindingIdx(i); setShowPanel(true); }}>
                            <td style={s.td}>{hhmmss(f.createdAt)}</td>
                            <td style={s.td}><Badge tone={sevTone(f.severity)}>{f.severity}</Badge></td>
                            <td style={{ ...s.td, fontWeight: 600 }}>{f.title}</td>
                            <td style={s.td}>{f.context?.host || '—'}</td>
                            <td style={s.td}>{f.context?.user || f.context?.sourceIp || '—'}</td>
                            <td style={s.td}>{f.context?.source || '—'}</td>
                            <td style={s.td}><Badge tone="muted">{f.context?.status || 'new'}</Badge></td>
                            <td style={s.td}>
                              <span style={{ display: 'inline-flex', gap: 4, color: 'var(--text-dim)' }}>
                                <button type="button" aria-label="Finding ansehen" style={s.iconBtn}
                                  onClick={(e) => { e.stopPropagation(); setFindingIdx(i); setShowPanel(true); }}>
                                  <Eye size={14} />
                                </button>
                                {canAct && (
                                  // Fund #4: konkrete f.id direkt übergeben (kein Umweg über findingIdx →
                                  // sonst Race: Aktion liefe mit dem alten Index/Finding).
                                  <button type="button" aria-label={tr('text.createTicket')} style={s.iconBtn}
                                    onClick={(e) => { e.stopPropagation(); void findingAction('ticket', f.id); }}>
                                    <Ticket size={14} />
                                  </button>
                                )}
                                {canAct && (
                                  <button type="button" aria-label={tr('analysis.saveAsEvidence')} style={s.iconBtn}
                                    onClick={(e) => { e.stopPropagation(); void findingAction('evidence', f.id); }}>
                                    <Archive size={14} />
                                  </button>
                                )}
                              </span>
                            </td>
                          </tr>
                        ))}
                        {findings.length === 0 && <tr><td colSpan={8} style={{ ...s.td, color: 'var(--text-dim)', textAlign: 'center' }}>{tr('text.noFindings')}</td></tr>}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* ── Timeline (Ereigniskette) ── */}
                {section === 'timeline' && (
                  <div style={{ ...s.panel, padding: 16 }}>
                    <div style={s.secH}><Clock size={15} style={{ color: 'var(--purple, #a78bfa)' }} /> Ereigniskette ({chain.length})</div>
                    {chain.length === 0 ? <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{tr('ui.noEventsYet')}</div> :
                      chain.map((c, i) => {
                        const dot = c.kind === 'finding' ? (c.severity === 'critical' || c.severity === 'high' ? 'var(--danger)' : 'var(--warning)')
                          : c.kind === 'command' ? 'var(--accent)' : (LOG_COLOR[c.level || 'info'] || 'var(--text-dim)');
                        return (
                          // Statische Chain (Findings/Commands/Logs), nicht umsortierend; i wird auch für die
                          // Connector-Linie (i < chain.length-1) gebraucht → Index ist hier der korrekte Key
                          // eslint-disable-next-line react/no-array-index-key
                          <div key={i} style={{ display: 'flex', gap: 12 }}>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 12, flexShrink: 0 }}>
                              <span style={{ width: 9, height: 9, borderRadius: '50%', background: dot, marginTop: 7, flexShrink: 0 }} />
                              {i < chain.length - 1 && <span style={{ width: 1, flex: 1, background: 'var(--border-soft)' }} />}
                            </div>
                            <div style={{ paddingBottom: 12, minWidth: 0, flex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>{hhmmss(c.time)}</span>
                                <Badge tone={c.kind === 'finding' ? sevTone(c.severity || 'low') : c.kind === 'command' ? 'accent' : 'muted'}>
                                  {c.kind === 'finding' ? `Finding · ${c.severity}` : c.kind === 'command' ? `Command · ${c.status}` : c.level}
                                </Badge>
                              </div>
                              <div style={{ fontSize: 12.5, color: 'var(--text)', marginTop: 3, overflowWrap: 'anywhere', fontFamily: c.kind === 'command' ? 'var(--font-mono)' : undefined }}>{c.text}</div>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}

                {/* ── Commands (Safe Command Console) ── */}
                {section === 'commands' && (
                  <div style={{ ...s.panel, padding: 16 }}>
                    <div style={s.secH}>Safe Command Console</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginBottom: 8 }}>
                      Nur erlaubte read-only Befehle gegen <b style={{ color: 'var(--text)' }}>{sel.targetHost}</b>. Keine freie Shell, kein Remote-Exec.
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                      {SAFE_COMMANDS.map((c) => (
                        <button key={c} onClick={() => void runCmd(c)} disabled={cmdBusy || sel.status === 'cancelled'}
                          style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '4px 8px', cursor: 'pointer' }}>{c}</button>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', alignSelf: 'center' }}>$</span>
                      <input value={cmdInput} onChange={(e) => setCmdInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && canAct) void runCmd(); }}
                        disabled={!canAct}
                        placeholder={canAct ? 'Safe command eingeben (z.B. netstat -ano)…' : tr('ui.analystRoleAboveOnly')}
                        style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--bg-terminal)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '6px 10px', opacity: canAct ? 1 : 0.5 }} />
                      <Button variant="primary" size="sm" disabled={!canAct || cmdBusy || !cmdInput.trim()} onClick={() => void runCmd()}>{cmdBusy ? '…' : 'Run'}</Button>
                    </div>
                    <div style={{ ...s.console, height: 300 }}>
                      {commands.length === 0
                        ? <div style={{ color: 'var(--text-dim)' }}>{tr('ui.noCommandsRunYet')}</div>
                        : [...commands].reverse().map((c) => (
                          <div key={c.id} style={{ marginBottom: 8 }}>
                            <div><span style={{ color: 'var(--accent)' }}>$ {c.command}</span> <span style={{ color: 'var(--text-dim)' }}>[{c.status}]</span></div>
                            {c.stdout && <pre style={{ margin: '2px 0 0', whiteSpace: 'pre-wrap', color: 'var(--text-muted)' }}>{c.stdout}</pre>}
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {/* ── Targets ── */}
                {section === 'targets' && (
                  <div style={{ ...s.panel, padding: 16 }}>
                    <div style={s.secH}><Monitor size={15} style={{ color: 'var(--accent)' }} /> Targets ({targetHosts.length})</div>
                    {targetHosts.map((th) => (
                      <div key={th.host} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border-soft)' }}>
                        <Monitor size={18} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 13, fontWeight: 700 }}>{th.host}</span>
                            {th.primary && <Badge tone="accent">Primary Target</Badge>}
                          </div>
                          <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 2 }}>
                            OS: — (keine Agent-Inventardaten) · Last Seen: {th.lastSeen ? fmtDt(th.lastSeen) : '—'}
                          </div>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => makeRdpFile(th.host)}>{tr('hosts.rdpFile')}</Button>
                      </div>
                    ))}
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 10 }}>{tr('hosts.agentStatusNote')}</div>
                  </div>
                )}

                {/* ── Evidence (Artifacts) ── */}
                {section === 'evidence' && (
                  <div style={s.panel}>
                    <div style={{ ...s.secH, padding: '14px 16px 0' }}><Archive size={15} style={{ color: 'var(--success)' }} /> Hunt Evidence ({artifacts.length})</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr>{['Time', 'Type', 'Value', 'Source'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
                      <tbody>
                        {artifacts.map((a) => (
                          <tr key={a.id}>
                            <td style={s.td}>{hhmmss(a.createdAt)}</td>
                            <td style={s.td}><Badge tone="muted">{a.type}</Badge></td>
                            <td style={{ ...s.td, fontFamily: 'var(--font-mono)', fontSize: 11.5, overflowWrap: 'anywhere' }}>{a.value}</td>
                            <td style={s.td}>{a.source || '—'}</td>
                          </tr>
                        ))}
                        {artifacts.length === 0 && <tr><td colSpan={4} style={{ ...s.td, color: 'var(--text-dim)', textAlign: 'center' }}>{tr('app.noArtefactsYetAddEvidence')}</td></tr>}
                      </tbody>
                    </table>
                    <div style={{ padding: '10px 16px', fontSize: 11.5, color: 'var(--text-dim)' }}>{tr('hunts.evidenceFromFindings')}<Link to="/evidence" style={{ color: 'var(--accent)' }}>Evidence Center</Link> (append-only, SHA-256).
                    </div>
                  </div>
                )}

                {/* ── Tickets ── */}
                {section === 'tickets' && (
                  <div style={s.panel}>
                    <div style={{ ...s.secH, padding: '14px 16px 0' }}><Ticket size={15} style={{ color: 'var(--accent)' }} /> Verknüpfte Tickets ({ticketLinks.length})</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr>{['Linked At', 'Ticket', tr('common.source'), 'Summary'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
                      <tbody>
                        {ticketLinks.map((l) => (
                          <tr key={l.id}>
                            <td style={s.td}>{fmtDt(l.linkedAt)}</td>
                            <td style={s.td}><Link to={`/tickets/${l.ticketId}`} className="mono" style={{ color: 'var(--accent)' }}>{l.ticketId.slice(0, 8)}</Link></td>
                            <td style={s.td}><Badge tone="muted">{l.sourceType}</Badge></td>
                            <td style={{ ...s.td, color: 'var(--text-muted)' }}>{l.summary || '—'}</td>
                          </tr>
                        ))}
                        {ticketLinks.length === 0 && <tr><td colSpan={4} style={{ ...s.td, color: 'var(--text-dim)', textAlign: 'center' }}>{tr('ui.noTicketLinksCreateTicket')}</td></tr>}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* ── Response (Approval-Gate) ── */}
                {section === 'response' && (
                  <div style={{ ...s.panel, padding: 16 }}>
                    <ResponseActionsPanel
                      actions={actions}
                      canRequest={canAct}
                      canApprove={canApprove}
                      canExecute={can.admin(user?.role)}
                      currentUserId={user?.id ?? ''}
                      onRequest={(kind, command, reason) => requestAction(kind, command, reason)}
                      onApprove={(actionId, authorizationBasis) => decideAction(actionId, 'approve', authorizationBasis)}
                      onReject={(actionId, reason) => decideAction(actionId, 'reject', reason)}
                      onExecute={(actionId, reauthPassword) => executeAction(actionId, reauthPassword)}
                      circuitOpen={circuit?.open ?? false}
                      onResetCircuit={() => resetResponseCircuit()}
                    />
                  </div>
                )}

                {/* ── Export ── */}
                {section === 'export' && (
                  <div style={{ ...s.panel, padding: 16 }}>
                    <div style={s.secH}><Download size={15} style={{ color: 'var(--accent)' }} /> Hunt Export</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 220px))', gap: 8 }}>
                      <Button variant="primary" size="sm" icon={<FileText size={13} />} onClick={exportFindingsReport}>Findings Report (MD)</Button>
                      <Button variant="ghost" size="sm" icon={<Download size={13} />} onClick={exportFindingsCsv}>Findings (CSV)</Button>
                      <Button variant="ghost" size="sm" icon={<Download size={13} />} onClick={exportBundle}>Evidence Bundle (JSON)</Button>
                      <Button variant="ghost" size="sm" icon={<Download size={13} />} onClick={exportLog}>Console Log (TXT)</Button>
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 12, lineHeight: 1.6 }}>
                      <b style={{ color: 'var(--text-muted)' }}>Findings Report</b>{tr('ui.huntHeaderPlusAllFindings')}<br />
                      <b style={{ color: 'var(--text-muted)' }}>Evidence Bundle</b>{tr('ui.sessionFindingsCommandsArtefactsLogs')}<br />
                      <b style={{ color: 'var(--text-muted)' }}>Console Log</b>{tr('hunts.allConsoleLines')}</div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* ── Rechte Detail-Spalte (nur im Findings-Bereich) ── */}
          {sel && section === 'findings' && (
            <div style={{ width: 400, flexShrink: 0 }}>
              {showPanel && selFinding ? (
                <FindingDetailPanel
                  finding={selFinding}
                  index={findingIdx}
                  total={findings.length}
                  onPrev={() => setFindingIdx((i) => (i - 1 + findings.length) % findings.length)}
                  onNext={() => setFindingIdx((i) => (i + 1) % findings.length)}
                  onClose={() => setShowPanel(false)}
                  onCreateTicket={() => void findingAction('ticket', selFinding.id)}
                  onAddEvidence={() => void findingAction('evidence', selFinding.id)}
                  onRunFollowUp={() => openFollowUpModal(selFinding)}
                  onOpenRdp={openRdp}
                  onVerdictSet={(updated) => {
                    notify(tr('hunts.verdictSaved', { verdict: updated.verdict || '—' }));
                    void refreshSelected();
                  }}
                />
              ) : (
                <div style={{ ...s.panel, padding: 24, textAlign: 'center', color: 'var(--text-dim)' }}>
                  <ShieldAlert size={24} style={{ color: 'var(--text-dim)' }} />
                  <div style={{ fontSize: 13, fontWeight: 600, marginTop: 8, color: 'var(--text)' }}>Finding Detail</div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>{tr('ui.selectFindingTableSeeDetails')}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {showModal && (
        <NewHuntModal
          onClose={() => { setShowModal(false); setModalInitial(undefined); }}
          onCreate={handleCreate}
          initialValues={modalInitial}
        />
      )}

      {showFullConsole && sel && (
        <ConsoleFullView
          title={sel.title || sel.targetHost}
          logs={logs}
          onClose={() => setShowFullConsole(false)}
          onExport={exportLog}
        />
      )}

      {toast && (
        <div role="status" style={{ position: 'fixed', bottom: 20, right: 20, background: 'var(--bg-card)', border: '1px solid var(--border-soft)', borderRadius: 8, padding: '12px 16px', fontSize: 13, maxWidth: 360, zIndex: 1100, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ flex: 1 }}>{toast.text}</span>
          {/* Fund #7: klickbarer Sprung ins erzeugte Ticket (projekt-konvention: navigate). */}
          {toast.ticketId && (
            <button
              type="button"
              onClick={() => { const id = toast.ticketId; setToast(null); if (id) navigate(`/tickets/${id}`); }}
              style={{ background: 'none', border: '1px solid var(--accent)', borderRadius: 6, color: 'var(--accent)', cursor: 'pointer', fontSize: 12, padding: '3px 8px', whiteSpace: 'nowrap' }}
            >{tr('tickets.open')}</button>
          )}
          <button
            type="button"
            aria-label={tr('ui.dismissMessage')}
            onClick={() => setToast(null)}
            style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0 }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
