import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useHeaderSlot } from '../app/HeaderSlot';
import { ActiveTicketSwitcher } from '../features/analysis/ActiveTicketSwitcher';
import { OverviewWorkbench } from '../features/analysis/overview/OverviewWorkbench';
import { CaseHeader } from '../features/analysis/overview/CaseHeader';
import { EvidenceView } from '../features/analysis/evidence/EvidenceView';
import { buildEvidence } from '../features/analysis/ticketEvidence';
import { useAutoResetFlag } from '../hooks/useAutoResetFlag';
import { useConfirm } from '../hooks/useConfirm';
import {
  Globe, ShieldCheck, Copy, Plus, Terminal,
  AlertTriangle, FileText, ListChecks, XCircle, CheckCircle2, ShieldAlert, GitBranch, Check,
} from 'lucide-react';
import { Card, Badge, Button, EmptyState, Spinner, ErrorCard, HelpTip, type Tone } from '../components/ui';
import { AnalysisTopNav, type DeckSection } from '../features/analysis/deck/AnalysisSubNav';
import { AnalysisSummaryHeader } from '../features/analysis/deck/AnalysisSummaryHeader';
import { AnalystSummaryPanel } from '../features/analysis/deck/AnalystSummaryPanel';
import { NetworkNatView } from '../features/analysis/network/NetworkNatView';
import { PayloadsView } from '../features/analysis/payloads/PayloadsView';
import { CommandsView } from '../features/analysis/commands/CommandsView';
import { EntitiesView } from '../features/analysis/entities/EntitiesView';
import { TimelineView } from '../features/analysis/timeline/TimelineView';
import { NotesTabView } from '../features/analysis/notes/NotesTabView';
import { HistoryTabView } from '../features/analysis/history/HistoryTabView';
import { PlaybooksTabView } from '../features/analysis/playbooks/PlaybooksTabView';
import { EvidenceExportSection } from '../features/analysis/deck/EvidenceExportSection';
import { EnrichmentSidebar } from '../features/analysis/deck/EnrichmentSidebar';
import { buildAnalystSummary, deriveRisk, deriveEntities, correlatedEntitiesToItems, flowsToEntities, type SummaryBullet, type EntityItem, type RiskModel } from '../features/analysis/deckModel';
import { iocCounts, iocConfidence, recommendedBlocks } from '../features/analysis/iocs/iocsModel';
import { tiSourceBadge } from '../features/analysis/tiSourceBadge';
import { ticketApi } from '../features/tickets/ticketApi';
import { collectEvidenceFeedback, collectEvidenceErrorFeedback, type CollectEvidenceFeedback } from '../features/evidence/collectEvidenceFeedback';
import type { Ticket, AnalystState } from '../lib/types';
import { badge } from '../lib/badges';
import { can } from '../lib/rbac';
import { useAuth } from '../lib/auth';
import { myTickets } from '../features/analysis/assignedTickets';
import { apiErrorText } from '../lib/apiErrorText';
import { ApiError } from '../lib/apiClient';
import { ImportDataModal, type ImportMode } from '../features/analysis/components/ImportDataModal';
import { WazuhExceptionBuilderModal } from '../features/analysis/components/WazuhExceptionBuilderModal';
import {
  EMPTY_EVIDENCE,
  COMMAND_TEMPLATES, iocsFromParsed, classifyIoc, type Ioc, type ParsedEvidence, type ThreatIntelResult, type TicketTimeline, type NetworkCorrelation, type CorrelationStatusInfo,
} from '../features/analysis/analysisModel';
import { threatIntelApi } from '../features/threatIntel/threatIntelApi';
import { evidenceApi } from '../features/evidence/evidenceApi';
import { downloadReportPdf } from '../features/analysis/reportPrint';
import { buildIncidentReport, buildCustomerReport } from '../features/analysis/reportModel';
import { renderReportText } from '../features/analysis/reportTextModel';
import { renderReportJson, reportJsonFilename } from '../features/analysis/reportJson';
import { agentApi, deriveKiFp, latestSuggestion, type KiFpSignal } from '../features/aiAgent/agentApi';
import { KiAnalysisView } from '../features/analysis/ki/KiAnalysisView';
import { buildFollowUpTicket } from '../features/tickets/followUpModel';
import { markImportantPriority } from '../features/tickets/priorityModel';
import { appendNote } from '../features/analysis/ki/kiNote';
import { useCorrelationPolling } from '../features/analysis/useCorrelationPolling';

const DECISIONS = [
  { key: 'benign', label: 'Benign', tone: 'success' as Tone },
  { key: 'suspicious', label: 'Suspicious', tone: 'warning' as Tone },
  { key: 'incident', label: 'Confirmed Incident', tone: 'danger' as Tone },
  { key: 'fp', label: 'False Positive', tone: 'muted' as Tone },
];
const DEC_ICON: Record<string, ReactNode> = {
  benign: <CheckCircle2 size={17} />, suspicious: <AlertTriangle size={17} />,
  incident: <ShieldAlert size={17} />, fp: <XCircle size={17} />,
};
const RECO_ACTIONS = ['Isolate Host', 'Block IP', 'Reset Password', 'Notify Customer', 'Escalate'];


// IoCs aus einem echten Ticket ableiten (real, soweit vorhanden)
function iocsFromTicket(t: Ticket): Ioc[] {
  const out: Ioc[] = [];
  (t.iocs ?? '').split(/[\n,]/).map((s) => s.trim()).filter(Boolean).forEach((v) => {
    out.push({ type: classifyIoc(v), value: v, reputation: 'unknown' });   // Dateipfade → 'file', nicht 'domain'
  });
  if (t.srcIp) out.push({ type: 'ip', value: t.srcIp, reputation: 'unknown' });
  if (t.dstIp) out.push({ type: 'ip', value: t.dstIp, reputation: 'suspicious' });
  const seen = new Set<string>();
  const dedup = out.filter((i) => (seen.has(i.value) ? false : (seen.add(i.value), true)));
  return dedup.length ? dedup : iocsFromParsed(EMPTY_EVIDENCE);
}

// Eine konsistente Evidence-Ansicht: echte Ticket-Felder in eine leere Vorlage mergen,
// (Evidence-Ableitung aus dem Ticket liegt jetzt im reinen, getesteten Modul `ticketEvidence.ts`.)

const LABEL: CSSProperties = { fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.4 };
const PANEL_H: CSSProperties = { fontSize: 12.5, fontWeight: 700, color: 'var(--text)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 7 };

export function AnalysisPage() {
  const { user } = useAuth();
  const canAct = can.act(user?.role);
  const canAdmin = can.admin(user?.role);
  const myName = user?.displayName || user?.email || '';
  const navigate = useNavigate();

  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState('');
  const { confirm, confirmDialog } = useConfirm();
  // Aktives Ticket lebt im URL-Param ?ticket= — synchron mit dem Header-Ticket-Switcher.
  const [params, setParams] = useSearchParams();
  const selId = params.get('ticket');
  const setSelId = useCallback((id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('ticket', id); else next.delete('ticket');
    setParams(next, { replace: true });
  }, [params, setParams]);
  // Ticket-Switcher in den globalen Header einklinken (Slot, stabiler Node).
  useHeaderSlot(useMemo(() => <ActiveTicketSwitcher />, []));
  const [section, setSection] = useState<DeckSection>('overview');
  const [importOpen, setImportOpen] = useState(false);
  const [exceptionOpen, setExceptionOpen] = useState(false);
  const [fpReason, setFpReason] = useState('');
  const [fpQuickBusy, setFpQuickBusy] = useState(false);
  const [fpQuickMsg, setFpQuickMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [kiFp, setKiFp] = useState<KiFpSignal | null>(null);

  // Analyst-Arbeitsstand (lokal gehalten, beim Speichern via PUT /v1/tickets/:id persistiert)
  const [reco, setReco] = useState('');
  const [decision, setDecision] = useState('');
  const [confidence, setConfidence] = useState(80);
  const [notes, setNotes] = useState('');
  const [savingAnalysis, setSavingAnalysis] = useState(false);
  const [analysisSaved, triggerAnalysisSaved] = useAutoResetFlag(2500);
  const [cmdOut, setCmdOut] = useState('');
  const [importedEvidence, setImportedEvidence] = useState<ParsedEvidence | null>(null);
  const { evidence: polledEvidence, correlationStatus } = useCorrelationPolling(selId);
  const [tiResult, setTiResult] = useState<ThreatIntelResult | null>(null);
  const [tiBusy, setTiBusy] = useState(false);
  const [iocReps, setIocReps] = useState<Record<string, Ioc['reputation']>>({});
  const [iocBusy, setIocBusy] = useState(false);
  const [crossRefs, setCrossRefs] = useState<Record<string, { id: string; ticketNr: string; title: string; priority: string }[]>>({});
  const [xrefBusy, setXrefBusy] = useState(false);
  const [tiSaved, setTiSaved] = useState(false);
  const [evSaved, setEvSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [followUpBusy, setFollowUpBusy] = useState(false);
  const [timeline, setTimeline] = useState<TicketTimeline | null>(null);
  const [networkCorr, setNetworkCorr] = useState<NetworkCorrelation | null>(null);
  const [tlLoading, setTlLoading] = useState(false);
  const [caseNoteSaved, setCaseNoteSaved] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [collectFb, setCollectFb] = useState<CollectEvidenceFeedback | null>(null);

  // Analyst-Workflow-Zustand: persistierter Checklisten- und Playbook-Zustand
  const [analystState, setAnalystState] = useState<AnalystState>({ checklist: [], playbook: {} });
  // P_TRUST_1: Speicherfehler werden NICHT mehr verschluckt — sichtbar im Notes/Playbook-Deck.
  const [saveError, setSaveError] = useState('');
  // P_TRUST_1 Sweep: sichtbarer Fehlerkanal für Aktionen (Enrich/Export/Snapshot) über alle Tabs.
  const [actionError, setActionError] = useState('');

  const load = () => {
    setError('');
    ticketApi.list({ limit: 100, sort: 'updatedAt', order: 'desc' })
      .then((r) => { setTickets(r.data ?? []); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Laden fehlgeschlagen'));
  };
  useEffect(() => { load(); }, []);

  // Analyse-Workbench-Scoping (RBAC): ein Analyst analysiert seine EIGENEN Fälle → nur
  // die ihm zugewiesenen Tickets (Match robust über Anzeigename ODER E-Mail, getestet).
  // Admins sehen zur Lead-/Oversight-Arbeit ALLE Tickets. Ohne Zuweisung bleibt das Deck
  // für Analysten leer (Tickets zieht man sich auf der Tickets-Seite ins eigene Deck).
  const all = useMemo(
    () => (canAdmin ? (tickets ?? []) : myTickets(tickets ?? [], user)),
    [tickets, user, canAdmin],
  );
  useEffect(() => { if (!selId && all.length) setSelId(all[0].id); }, [all, selId, setSelId]);

  const active = all.find((t) => t.id === selId) ?? null;
  // Related Cases: Tickets, die dieselben IoCs referenzieren (aus Cross-Ref, dedupliziert).
  const relatedCases = useMemo(() => {
    const seen = new Set<string>();
    const out: { id: string; ticketNr: string; title: string; priority: string }[] = [];
    Object.values(crossRefs).flat().forEach((r) => { if (!seen.has(r.id)) { seen.add(r.id); out.push(r); } });
    return out.slice(0, 6);
  }, [crossRefs]);
  const iocs = useMemo(() => {
    const base = active ? iocsFromTicket(active) : [];
    return base.map((i) => (iocReps[i.value] ? { ...i, reputation: iocReps[i.value] } : i));
  }, [active, iocReps]);

  // Seiteneffekte beim Ticketwechsel: TI/IoC-State zurücksetzen + KI-Vorschlag laden.
  // Evidence kommt jetzt aus useCorrelationPolling (polling-fähig, kein manueller Fetch).
  useEffect(() => {
    setTiResult(null);
    setIocReps({});
    setCrossRefs({});
    setTiSaved(false);
    setEvSaved(false);
    setCollectFb(null);
    setKiFp(null);
    if (!selId) return;
    let alive = true;
    // Jüngsten KI-Vorschlag zum Ticket holen → FP-Signal fürs Deck (best-effort, weicher Fehler).
    agentApi.forTicket(selId)
      .then((r) => { if (alive) setKiFp(deriveKiFp(latestSuggestion(r.data))); })
      .catch(() => { if (alive) setKiFp(null); });
    return () => { alive = false; };
  }, [selId]);

  // Flow-/Event-Timeline einmal pro Ticket laden — Overview, Network & NAT und Timeline teilen sich die Daten.
  useEffect(() => {
    setTimeline(null);
    setNetworkCorr(null);
    setCaseNoteSaved(false);
    if (!selId) return;
    setTlLoading(true);
    let alive = true;
    ticketApi.timeline(selId)
      // Robust: nur ein echtes Timeline-Objekt akzeptieren; count + Array-Felder garantieren (Cards/Model lesen sie gefahrlos).
      .then((r) => {
        if (!alive) return;
        const td = r.data;
        const tl = td && typeof td === 'object' && !Array.isArray(td)
          ? { ...td, count: td.count ?? 0, events: td.events ?? [], actions: td.actions ?? [], dstPorts: td.dstPorts ?? [] }
          : null;
        setTimeline(tl);
        setNetworkCorr(r.network ?? null);
      })
      .catch(() => { if (alive) { setTimeline(null); setNetworkCorr(null); } })
      .finally(() => { if (alive) setTlLoading(false); });
    return () => { alive = false; };
  }, [selId]);

  // Priorität: importiert > polling (useCorrelationPolling) > aus Ticketfeldern abgeleitet.
  // Robust: garantiert vorhandene Unterobjekte (auch bei partieller Server-Antwort) →
  // Cards lesen gefahrlos ev.source/destination/… und zeigen sonst ehrlich „—". Keine Fake-Werte.
  const evidence: ParsedEvidence = useMemo(() => {
    const rawEvidence = importedEvidence ?? polledEvidence ?? (active ? buildEvidence(active) : EMPTY_EVIDENCE);
    return {
      ...EMPTY_EVIDENCE, ...rawEvidence,
      detection: { ...EMPTY_EVIDENCE.detection, ...rawEvidence.detection },
      source: { ...EMPTY_EVIDENCE.source, ...rawEvidence.source },
      destination: { ...EMPTY_EVIDENCE.destination, ...rawEvidence.destination },
      nat: { ...EMPTY_EVIDENCE.nat, ...rawEvidence.nat },
      network: { ...EMPTY_EVIDENCE.network, ...rawEvidence.network },
      payload: { ...EMPTY_EVIDENCE.payload, ...rawEvidence.payload },
      metadata: { ...EMPTY_EVIDENCE.metadata, ...rawEvidence.metadata },
    };
  }, [importedEvidence, polledEvidence, active]);

  // Abgeleitete Deck-Daten — deterministisch aus echten Quellen (keine Fake-Werte).
  const bullets = useMemo(() => buildAnalystSummary(evidence, timeline), [evidence, timeline]);
  const risk = useMemo(() => (active ? deriveRisk(active, evidence) : null), [active, evidence]);
  // Server-korrelierte Entitäten (CE-2) bevorzugen; sonst lokal ableiten. CE-3 Flow-Entities ergänzen.
  const entities = useMemo(() => {
    const correlated = correlatedEntitiesToItems(evidence.correlation);
    const base = correlated.length > 0 ? correlated : (active ? deriveEntities(active, evidence, timeline) : []);
    const seen = new Set(base.map((e) => `${e.kind}|${e.value.toLowerCase()}`));
    const extra = flowsToEntities(networkCorr).filter((e) => !seen.has(`${e.kind}|${e.value.toLowerCase()}`));
    return [...base, ...extra];
  }, [active, evidence, timeline, networkCorr]);

  async function mutate(body: Partial<Ticket>) {
    if (!active) return;
    setBusy(true);
    try { await ticketApi.update(active.id, body); load(); } catch (e) { setError(e instanceof Error ? e.message : 'Aktion fehlgeschlagen'); } finally { setBusy(false); }
  }

  // Follow-up: verknüpftes Kind-Ticket aus dem aktiven Fall anlegen (parentId) und öffnen.
  async function createFollowUp() {
    if (!active) return;
    setFollowUpBusy(true);
    setActionError('');
    try {
      const r = await ticketApi.create(buildFollowUpTicket(active));
      navigate(`/tickets/${r.data.id}`);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Follow-up-Ticket konnte nicht erstellt werden.');
    } finally {
      setFollowUpBusy(false);
    }
  }

  // KI-Einschätzung in die Ticket-Notizen übernehmen (auditierbar, mit Herkunftszeile).
  async function addKiNote(text: string) {
    if (!active) return;
    await mutate({ notes: appendNote(active.notes ?? '', text, { label: 'KI-Einschätzung übernommen', at: new Date() }) });
  }

  // P16: Endpoint-Artefakte manuell sammeln. Server-Antwort → benutzerfreundliche Rückmeldung.
  async function collectEvidence() {
    if (!active) return;
    setCollecting(true);
    setCollectFb(null);
    try {
      const res = await ticketApi.collectEvidence(active.id);
      setCollectFb(collectEvidenceFeedback(res));
    } catch (e) {
      setCollectFb(collectEvidenceErrorFeedback(e));
    } finally {
      setCollecting(false);
    }
  }

  // Admin-only: Ticket dauerhaft löschen. Bestätigung erzwingen, Auswahl danach zurücksetzen.
  async function deleteTicket() {
    if (!active || !canAdmin) return;
    const label = active.ticketNr || active.id.slice(0, 8);
    if (!(await confirm({
      title: `Ticket ${label} löschen?`,
      message: 'Das Ticket wird dauerhaft gelöscht. Diese Aktion kann nicht rückgängig gemacht werden.',
      confirmLabel: 'Dauerhaft löschen',
      danger: true,
    }))) return;
    setBusy(true);
    setError('');
    try {
      await ticketApi.delete(active.id);
      setSelId(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Löschen fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }
  // Analyse-Felder beim Ticketwechsel aus dem Ticket laden (persistiert).
  useEffect(() => {
    if (!active) return;
    setReco(active.recommendation || '');
    setNotes(active.notes || '');
    setDecision(active.decision || '');
    setConfidence(typeof active.confidence === 'number' ? active.confidence : 80);
    // analystState aus Ticket laden (persistierter Checklisten-/Playbook-Stand)
    const loaded = active.analystState;
    setAnalystState(
      loaded && (Array.isArray(loaded.checklist) || loaded.playbook != null)
        ? { checklist: loaded.checklist ?? [], playbook: loaded.playbook ?? {} }
        : { checklist: [], playbook: {} }
    );
    // analysisSaved resets automatically via useAutoResetFlag
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);
  // Analyse (Decision/Confidence/Recommendation/Notes) am Ticket speichern.
  async function saveAnalysis() {
    if (!active) return;
    setSavingAnalysis(true);
    setSaveError('');
    try {
      await ticketApi.update(active.id, { decision, confidence, recommendation: reco, notes } as Partial<Ticket>);
      triggerAnalysisSaved();
      load();
    } catch (e) {
      // Sichtbar machen — KEIN Fake-Erfolg: der Analyst weiß, dass NICHT gespeichert wurde.
      setSaveError(e instanceof Error ? e.message : 'Analyse konnte nicht gespeichert werden');
    } finally { setSavingAnalysis(false); }
  }
  // Analyst-Workflow-Zustand (Checkliste/Playbook) persistieren — feuert bei jeder Änderung.
  async function saveAnalystState(nextState: AnalystState) {
    if (!active) return;
    setAnalystState(nextState);
    setSaveError('');
    try {
      await ticketApi.update(active.id, { analystState: nextState } as Partial<Ticket>);
    } catch (e) {
      // Fehler sichtbar — der lokale Zustand bleibt zwar erhalten, ist aber NICHT persistiert.
      setSaveError(e instanceof Error ? e.message : 'Checkliste/Playbook konnte nicht gespeichert werden');
    }
  }

  // Related Cases automatisch füllen — Cross-Ref über die Ticket-IoCs.
  useEffect(() => {
    if (!active) return;
    void loadCrossRefs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);
  // Case Note: Export-Report an die Ticket-Notizen anhängen (persistiert am Ticket).
  async function createCaseNote(text: string) {
    if (!active) return;
    const merged = `${active.notes ? `${active.notes}\n\n` : ''}--- Case Note (${new Date().toLocaleString('de-DE')}) ---\n${text}`;
    await mutate({ notes: merged });
    setNotes(merged);
    setCaseNoteSaved(true);
  }
  // Cross-Reference: dieselben IoCs in anderen Tickets finden (Wiederholungstäter/Kampagnen).
  async function loadCrossRefs() {
    if (!active) return;
    const values = [...new Set(iocs.map((i) => i.value))].slice(0, 20);
    if (!values.length) return;
    setXrefBusy(true); setActionError('');
    try { const r = await ticketApi.crossRef(values, active.id); setCrossRefs(r.data); }
    catch (e) { setActionError(e instanceof Error ? e.message : 'Cross-Reference-Suche fehlgeschlagen'); } finally { setXrefBusy(false); }
  }
  // Reputation aller Ticket-IPs (IoC-Panel) — Kontext, kein Auto-Verdict.
  async function enrichIocs() {
    if (!active) return;
    setIocBusy(true); setActionError('');
    try {
      const r = await ticketApi.enrichIocs(active.id);
      const vToRep = (v: string): Ioc['reputation'] => v === 'malicious' ? 'malicious' : v === 'suspicious' ? 'suspicious' : v === 'clean' ? 'harmless' : 'unknown';
      const m: Record<string, Ioc['reputation']> = {};
      r.data.forEach((x) => { m[x.indicatorValue] = vToRep(x.verdict); });
      setIocReps(m);
    } catch (e) { setActionError(e instanceof Error ? e.message : 'IoC-Reputation konnte nicht geladen werden'); } finally { setIocBusy(false); }
  }
  // IoC-Verdict lokal markieren (Analyst-Einschätzung; kein Auto-Verdict aufs Ticket).
  function markIoc(value: string, rep: NonNullable<Ioc['reputation']>) {
    setIocReps((prev) => ({ ...prev, [value]: rep }));
  }
  // Threat-Intel-Enrichment für die Destination-IP (Fallback Source-IP). Mock-first, kein Auto-Verdict.
  async function enrichTi() {
    const ip = evidence.destination.ip || evidence.source.ip;
    if (!ip) return;
    setTiBusy(true); setTiSaved(false); setActionError('');
    try { const r = await threatIntelApi.enrich('ip', ip); setTiResult(r.data); }
    catch (e) { setActionError(e instanceof Error ? e.message : 'Threat-Intel-Abfrage fehlgeschlagen'); } finally { setTiBusy(false); }
  }
  // Evidence-Paket des Tickets exportieren (JSON, inkl. Integritätsprüfung).
  async function exportEvidence() {
    if (!active) return;
    setActionError('');
    try {
      const r = await evidenceApi.exportTicket(active.id);
      const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `evidence-${active.ticketNr || active.id}.json`;
      a.click();
    } catch (e) { setActionError(e instanceof Error ? e.message : 'Evidence-Export fehlgeschlagen'); }
  }
  // Snapshot der normalisierten Evidence (Process/Network/DNS/File) als Evidence-Item sichern.
  async function saveEvidenceSnapshot() {
    if (!active) return;
    const ev = evidence;
    const type = ev.file ? 'file' : ev.dns ? 'dns' : ev.process ? 'process' : ev.type === 'network' ? 'network' : 'other';
    const source = (ev.process || ev.dns || ev.file) ? 'sysmon' : ev.network.action ? 'firewall' : 'manual';
    const title = ev.detection.ruleName || ev.file?.name || ev.dns?.query
      || (ev.source.ip || ev.destination.ip ? `${ev.source.ip || '?'} → ${ev.destination.ip || '?'}` : '')
      || 'Evidence Snapshot';
    try {
      await evidenceApi.add({
        ticketId: active.id, type, source, title,
        logSource: ev.detection.sourceSystem, eventId: ev.detection.ruleId || '',
        eventTimestamp: ev.detection.timestamp || null,
        rawText: JSON.stringify(ev, null, 2), comment: ev.detection.description || '',
      });
      setEvSaved(true);
    } catch (e) { setActionError(e instanceof Error ? e.message : 'Evidence-Snapshot konnte nicht gespeichert werden'); }
  }
  // Threat-Intel-Ergebnis als Evidence am Ticket speichern (Chain of Custody).
  async function saveTiEvidence() {
    if (!active || !tiResult) return;
    try {
      await evidenceApi.add({
        ticketId: active.id, type: 'other', source: 'threatIntel',
        title: `Threat Intel: ${tiResult.indicatorValue} (${tiResult.verdict})`,
        logSource: 'ThreatIntel', rawText: JSON.stringify(tiResult, null, 2),
        confidence: tiResult.confidence, comment: tiResult.summary,
      });
      setTiSaved(true);
    } catch (e) { setActionError(e instanceof Error ? e.message : 'Threat-Intel-Evidence konnte nicht gespeichert werden'); }
  }
  // FP-Close wirkt real auf UNSER Ticket (Schließgrund false_positive); Wazuh-Write bleibt Stage 4.
  async function closeFp() {
    if (!active || !fpReason.trim()) return;
    const note = `${active.notes ? `${active.notes}\n` : ''}[False Positive] ${fpReason.trim()}`;
    await mutate({ state: 'CLOSED', closeReason: 'false_positive', notes: note });
  }
  // Ein-Klick FP-Regel: Server baut den Scope aus der Evidence, rollenabhängig
  // forward/apply. Bei unvollständigem Scope (dünne Evidence) öffnet sich der
  // vollständige Editor zum Nachschärfen statt still zu scheitern.
  async function quickFp() {
    if (!active || !fpReason.trim()) return;
    setFpQuickBusy(true); setFpQuickMsg(null);
    try {
      const r = await ticketApi.fpQuick(active.id, { reason: fpReason.trim() });
      if (!r.ok) {
        setFpQuickMsg({ ok: false, text: (r.errors?.length ? r.errors.join(' · ') : 'Scope unvollständig') + ' — bitte im Editor ergänzen.' });
        setExceptionOpen(true);
        return;
      }
      const text = r.action === 'applied'
        ? (r.restartRequired ? 'FP-Regel geschrieben & validiert — Manager-Restart nötig (Admin).' : 'FP-Regel angewendet.')
        : r.idempotent
          ? 'FP-Regel existiert bereits (idempotent) — nichts Neues geschrieben.'
          : 'FP-Regel erzeugt & zur Freigabe weitergeleitet (kein Wazuh-Write).';
      setFpQuickMsg({ ok: true, text });
    } catch (e) {
      // Echten Grund zeigen (z.B. Guardrail „…ohne verifizierbaren Selector…") statt „HTTP 422".
      // Bei Validierungs-/Guardrail-Fehlern (4xx, nicht 401) zum Editor führen, um einen Selector zu ergänzen.
      const text = apiErrorText(e, 'FP-Regel fehlgeschlagen.');
      const isValidation = e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 401;
      setFpQuickMsg({ ok: false, text: isValidation ? `${text} — im Editor einen Selector (Hostname/IP) ergänzen.` : text });
      if (isValidation) setExceptionOpen(true);
    } finally {
      setFpQuickBusy(false);
    }
  }
  function onImported(mode: ImportMode, parsed: ParsedEvidence) {
    setImportedEvidence(parsed);
    setImportOpen(false);
    setSection('evidence');
    if (mode === 'fields' && active) {
      // Vorläufig: nur IOCs lokal anreichern (echtes Feld-Mapping folgt im Backend)
      void mutate({ iocs: iocsFromParsed(parsed).map((i) => i.value).join('\n') });
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      {confirmDialog}
      {/* Horizontale Analysis-Navigation (volle Breite). Ticket-Auswahl + Suche
          liegen jetzt im globalen Header-Ticket-Switcher — keine linke Ticketliste. */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14, borderBottom: '1px solid var(--border-soft)' }}>
        <AnalysisTopNav active={section} onSelect={setSection} />
        <HelpTip topic="ki-agent" />
      </div>

      {error && <div style={{ marginBottom: 14 }}><ErrorCard message={error} /></div>}
      {!tickets && !error && <Spinner label="Tickets werden geladen …" />}

      {/* Overview — exaktes 78/22-Workbench-Layout (Case Header + 3×3 Grid + Decision Rail) */}
      {tickets && active && section === 'overview' && (
        <OverviewWorkbench
          t={active} ev={evidence} tl={timeline} network={networkCorr} tlLoading={tlLoading}
          risk={risk} bullets={bullets} entities={entities} correlationStatus={correlationStatus ?? undefined}
          tiResult={tiResult} confidence={typeof active.confidence === 'number' ? active.confidence : confidence}
          canAct={canAct} canAdmin={canAdmin} busy={busy} collecting={collecting} collectFeedback={collectFb}
          onOpenSection={setSection} onMitre={() => navigate('/mitre')}
          onCollect={() => void collectEvidence()} onClose={() => mutate({ state: 'CLOSED' })} onDelete={() => void deleteTicket()}
          rail={{
            canAct,
            onSaveSnapshot: () => void saveEvidenceSnapshot(), snapshotSaved: evSaved,
            onEnrichTi: () => void enrichTi(), tiBusy,
            onOpenThreatIntel: () => setSection('evidence'),
            onCreateFollowUp: () => void createFollowUp(), followUpBusy,
            onMarkImportant: () => void mutate({ priority: markImportantPriority(active.priority) }),
            isImportant: active.priority === 'high' || active.priority === 'critical',
          }}
        />
      )}

      {/* Timeline + Network + Commands + Payloads + Entities — Workbench: Case Header über volle Breite, breiter Hauptinhalt + Context-Rail, Notes darunter */}
      {tickets && active && (section === 'timeline' || section === 'network' || section === 'commands' || section === 'payloads' || section === 'entities') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
          <CaseHeader t={active} ev={evidence} tl={timeline} canAct={canAct} canAdmin={canAdmin} busy={busy}
            collecting={collecting} collectFeedback={collectFb}
            onCollect={() => void collectEvidence()} onClose={() => mutate({ state: 'CLOSED' })} onDelete={() => void deleteTicket()} />

          {actionError && (
            <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--danger)', background: 'var(--danger-soft)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-sm)', padding: '8px 10px' }}>
              <span style={{ flex: 1 }}>{actionError}</span>
              <button onClick={() => setActionError('')} aria-label="Fehler schließen" style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>✕</button>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: 18, alignItems: 'start' }}>
            {/* Hauptinhalt (Timeline bzw. Network & NAT) + Analyst Notes */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
              {section === 'timeline' && <TimelineView t={active} ev={evidence} tl={timeline} network={networkCorr} loading={tlLoading} />}
              {section === 'network' && <NetworkNatView t={active} ev={evidence} tl={timeline} network={networkCorr} />}
              {section === 'commands' && <CommandsView t={active} ev={evidence} network={networkCorr} />}
              {section === 'payloads' && <PayloadsView t={active} ev={evidence} />}
              {section === 'entities' && <EntitiesView t={active} ev={evidence} entities={entities} />}

              <Card style={{ padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>Analyst Notes</span>
                  <Button variant="ghost" size="sm" disabled={savingAnalysis || !canAct} onClick={() => void saveAnalysis()}>{analysisSaved ? 'Gespeichert ✓' : 'Speichern'}</Button>
                </div>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={5}
                  placeholder="Beobachtungen, Hypothesen, nächste Schritte … (wird am Ticket gespeichert)"
                  style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 13, padding: '10px 12px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} />
              </Card>
            </div>

            {/* Right Context Rail (~300px) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {risk && <AnalystSummaryPanel bullets={bullets} risk={risk} />}
              <EnrichmentSidebar evidence={evidence} tiResult={tiResult} busy={tiBusy} onEnrich={enrichTi} onSaveEvidence={saveTiEvidence} saved={tiSaved} />

              <Card style={{ padding: '12px 14px' }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>Quick Actions</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Button variant="ghost" size="sm" disabled={busy || collecting || !canAct} onClick={() => void collectEvidence()}>{collecting ? 'Sammelt …' : 'Collect Artifacts'}</Button>
                  <Button variant="ghost" size="sm" disabled={!canAct || evSaved} onClick={() => void saveEvidenceSnapshot()}>{evSaved ? 'Als Evidence gespeichert ✓' : 'Add as Evidence'}</Button>
                  <Button variant="ghost" size="sm" onClick={() => void exportEvidence()}>Evidence exportieren (JSON)</Button>
                </div>
              </Card>

              <Card style={{ padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>Related Cases</span>
                  {relatedCases.length === 0 && <Button variant="ghost" size="sm" disabled={xrefBusy} onClick={() => void loadCrossRefs()}>{xrefBusy ? 'Suche …' : 'Suchen'}</Button>}
                </div>
                {relatedCases.length === 0 ? (
                  <div style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>Keine Tickets mit denselben IoCs gefunden.</div>
                ) : relatedCases.map((r) => (
                  <button key={r.id} onClick={() => setSelId(r.id)} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', padding: '6px 0', cursor: 'pointer', borderBottom: '1px solid var(--border-soft)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="mono" style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700 }}>{r.ticketNr || r.id.slice(0, 8)}</span>
                      <Badge tone={badge.severity(r.priority).tone}>{badge.severity(r.priority).label}</Badge>
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>{r.title}</div>
                  </button>
                ))}
              </Card>
            </div>
          </div>
        </div>
      )}

      {/* KI Analyse — Workbench: Case Header über volle Breite, operative KI-Ansicht mit eigener Rail */}
      {tickets && active && section === 'ki_analysis' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
          <CaseHeader t={active} ev={evidence} tl={timeline} canAct={canAct} canAdmin={canAdmin} busy={busy}
            collecting={collecting} collectFeedback={collectFb}
            onCollect={() => void collectEvidence()} onClose={() => mutate({ state: 'CLOSED' })} onDelete={() => void deleteTicket()} />
          <KiAnalysisView ev={evidence} tl={timeline} ticketId={active.id} canAct={canAct} onAddNote={addKiNote} />
        </div>
      )}

      {/* Evidence — Workbench: Case Header über volle Breite, Master-Detail-Records-Browser + Context-Rail */}
      {tickets && active && section === 'evidence' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
          <CaseHeader t={active} ev={evidence} tl={timeline} canAct={canAct} canAdmin={canAdmin} busy={busy}
            collecting={collecting} collectFeedback={collectFb}
            onCollect={() => void collectEvidence()} onClose={() => mutate({ state: 'CLOSED' })} onDelete={() => void deleteTicket()} />
          <EvidenceView t={active} ev={evidence} tl={timeline} ticketId={active.id} risk={risk} refreshKey={`${evSaved}-${tiSaved}`} onOpenSection={setSection} />
        </div>
      )}

      {/* Übrige Sektionen — zweispaltig (Inhalt + Enrichment-Sidebar), ohne linke Ticketliste */}
      {tickets && active && section !== 'overview' && section !== 'timeline' && section !== 'network' && section !== 'ki_analysis' && section !== 'commands' && section !== 'payloads' && section !== 'entities' && section !== 'evidence' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 14, flex: 1, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
            <AnalysisSummaryHeader t={active} ev={evidence} tl={timeline} canAct={canAct} canAdmin={canAdmin} busy={busy}
              collecting={collecting} collectFeedback={collectFb}
              onAssign={() => mutate({ analyst: myName, status: 'in_progress' })} onClose={() => mutate({ state: 'CLOSED' })}
              onCollectEvidence={() => void collectEvidence()} onDelete={() => void deleteTicket()} />

            {actionError && (
              <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--danger)', background: 'var(--danger-soft)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-sm)', padding: '8px 10px' }}>
                <span style={{ flex: 1 }}>{actionError}</span>
                <button onClick={() => setActionError('')} aria-label="Fehler schließen" style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>✕</button>
              </div>
            )}

            <>
                {section === 'iocs' &&<AnalysisTabView t={active} iocs={iocs} onEnrichIocs={enrichIocs} iocBusy={iocBusy} crossRefs={crossRefs} onCrossRef={loadCrossRefs} xrefBusy={xrefBusy} reco={reco} setReco={setReco} decision={decision} setDecision={setDecision} confidence={confidence} setConfidence={setConfidence} onSaveAnalysis={saveAnalysis} savingAnalysis={savingAnalysis} analysisSaved={analysisSaved} cmdOut={cmdOut} setCmdOut={setCmdOut} fpReason={fpReason} setFpReason={setFpReason} onCloseFp={closeFp} onPrepareException={() => setExceptionOpen(true)} onQuickFp={quickFp} fpQuickBusy={fpQuickBusy} fpQuickMsg={fpQuickMsg} kiFp={kiFp} canAct={canAct} busy={busy} onSelectTicket={setSelId} onMarkIoc={markIoc} onAppendNote={(text) => { const merged = `${notes ? `${notes}\n` : ''}${text}`; setNotes(merged); void ticketApi.update(active.id, { notes: merged } as Partial<Ticket>).then(() => load()); }} entities={entities} evidence={evidence} bullets={bullets} risk={risk} />}
                {section === 'export' && <EvidenceExportSection t={active} bullets={bullets} iocs={iocs} entities={entities} tl={timeline} currentUser={myName} onExportJson={exportEvidence} onCreateCaseNote={(text) => void createCaseNote(text)} caseNoteSaved={caseNoteSaved} />}
                {section === 'notes' && <NotesTabView notes={notes} currentUser={myName} onAddNote={(merged) => { setNotes(merged); return ticketApi.update(active.id, { notes: merged } as Partial<Ticket>).then(() => load()); }} analystState={analystState} onSaveAnalystState={saveAnalystState} saveError={saveError} />}
                {section === 'history' && <HistoryTabView ticketId={active.id} />}
                {section === 'playbooks' && <PlaybooksTabView analystState={analystState} onSaveAnalystState={saveAnalystState} saveError={saveError} entities={entities} />}
                {section === 'report' && <ReportTabView t={active} iocs={iocs} bullets={bullets} entities={entities} tl={timeline} network={networkCorr} correlation={correlationStatus ?? null} onSendToTicket={(rmd) => void createCaseNote(rmd)} />}
            </>
          </div>

          {/* ── Rechte Spalte: Analyst Summary · Enrichment ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {risk && <AnalystSummaryPanel bullets={bullets} risk={risk} />}
            <EnrichmentSidebar evidence={evidence} tiResult={tiResult} busy={tiBusy} onEnrich={enrichTi} onSaveEvidence={saveTiEvidence} saved={tiSaved} />
          </div>
        </div>
      )}

      {tickets && all.length === 0 && (canAdmin
        ? <EmptyState title="Keine Tickets vorhanden" message="Es sind derzeit keine Tickets im System." />
        : <EmptyState title="Keine dir zugewiesenen Tickets" message="Die Analyse-Workbench zeigt nur deine eigenen Fälle. Weise dir auf der Tickets-Seite ein Ticket zu, um es hier zu analysieren." />)}
      {tickets && all.length > 0 && !active && <EmptyState title="Kein Ticket ausgewählt" message="Wähle oben im Header ein Ticket aus dem Switcher." />}

      {importOpen && active && <ImportDataModal ticketId={active.ticketNr || active.id} onClose={() => setImportOpen(false)} onImported={onImported} />}
      {exceptionOpen && active && <WazuhExceptionBuilderModal ticketId={active.id} evidence={evidence} initialReason={fpReason} onClose={() => setExceptionOpen(false)} />}
    </div>
  );
}

// ── ANALYSIS Tab ──────────────────────────────────────────────────────────
// Interaktive IoC-Zeile: Enrich (Threat Intel), Copy, Add-as-Evidence, Mark verdict.
function IocRow({ ioc, ticketId, crossRefs, onSelectTicket, onMark }: {
  ioc: Ioc; ticketId?: string;
  crossRefs: { id: string; ticketNr: string; title: string; priority: string }[];
  onSelectTicket: (id: string) => void;
  onMark: (value: string, rep: NonNullable<Ioc['reputation']>) => void;
}) {
  const [res, setRes] = useState<ThreatIntelResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState(false);
  const [saveErr, setSaveErr] = useState(false);
  const repTone = (r?: string): Tone => r === 'malicious' ? 'danger' : r === 'suspicious' ? 'warning' : r === 'harmless' ? 'success' : 'muted';
  const btn: CSSProperties = { background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 2, display: 'inline-flex' };

  async function enrich() {
    setBusy(true); setErr(false);
    try { const r = await threatIntelApi.enrich(ioc.type, ioc.value); setRes(r.data); }
    catch { setErr(true); } finally { setBusy(false); }
  }
  async function addEvidence() {
    if (!ticketId) return;
    setSaveErr(false);
    try {
      await evidenceApi.add({
        ticketId, type: 'threat_intel', source: res?.source || 'threatIntel',
        title: `Threat Intel: ${ioc.value}${res ? ` (${res.verdict})` : ''}`,
        logSource: 'ThreatIntel', rawText: res ? JSON.stringify(res, null, 2) : ioc.value,
        confidence: res?.confidence ?? null, comment: res?.summary || '',
      });
      setSaved(true);
    } catch { setSaveErr(true); }
  }

  return (
    <div style={{ padding: '6px 0', borderBottom: '1px solid var(--border-soft)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Badge tone="muted">{ioc.type}</Badge>
        <span style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ioc.value}</span>
        <CrossRefBadge refs={crossRefs} onSelect={onSelectTicket} />
        <Badge tone={repTone(res?.verdict === 'clean' ? 'harmless' : res?.verdict ?? ioc.reputation)}>{res ? res.verdict : ioc.reputation}</Badge>
        <span style={{ display: 'flex', gap: 3 }}>
          <button style={{ ...btn, color: 'var(--accent)' }} title="Enrich (Threat Intel)" disabled={busy} onClick={() => void enrich()}><Globe size={14} /></button>
          <button style={btn} title="Copy" onClick={() => navigator.clipboard?.writeText(ioc.value)}><Copy size={14} /></button>
          <button style={btn} title={saved ? 'Als Evidence gespeichert' : 'Add as Evidence'} disabled={!ticketId || saved} onClick={() => void addEvidence()}>{saved ? <Check size={14} style={{ color: 'var(--success)' }} /> : <Plus size={14} />}</button>
          <button style={btn} title="Mark Benign" onClick={() => onMark(ioc.value, 'harmless')}><ShieldCheck size={14} /></button>
          <button style={btn} title="Mark Suspicious" onClick={() => onMark(ioc.value, 'suspicious')}><AlertTriangle size={14} /></button>
        </span>
      </div>
      {busy && <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>Enriching …</div>}
      {err && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4 }}>Enrichment fehlgeschlagen.</div>}
      {saveErr && <div role="alert" style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4 }}>Als Evidence speichern fehlgeschlagen.</div>}
      {res && (
        <div style={{ marginTop: 6, padding: '6px 8px', background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)', fontSize: 11 }}>
          <div style={{ display: 'flex', gap: 12, color: 'var(--text-muted)', marginBottom: 3 }}>
            <span>Score <b style={{ color: 'var(--text)' }}>{res.score}</b></span>
            <span>Confidence <b style={{ color: 'var(--text)' }}>{res.confidence}%</b></span>
            {(() => { const b = tiSourceBadge(res.source); return <Badge tone={b.tone}>{b.label}</Badge>; })()}
          </div>
          <div style={{ color: 'var(--text-muted)', lineHeight: 1.4 }}>{res.summary}</div>
          {res.tags.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>{res.tags.map((tg) => <Badge key={tg} tone="muted">{tg}</Badge>)}</div>}
        </div>
      )}
    </div>
  );
}
function Sec({ title, icon, children, style }: { title: string; icon: ReactNode; children: ReactNode; style?: CSSProperties }) {
  return <Card style={{ padding: '14px 16px', ...style }}><div style={PANEL_H}>{icon}{title}</div>{children}</Card>;
}
function CrossRefBadge({ refs, onSelect }: { refs: { id: string; ticketNr: string; title: string; priority: string }[]; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!refs.length) return null;
  if (refs.length === 1) {
    return (
      <button onClick={() => onSelect(refs[0].id)} title={`Zu ${refs[0].ticketNr || refs[0].title} springen`}
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, display: 'inline-flex' }}>
        <Badge tone="warning"><GitBranch size={10} /> {refs.length}</Badge>
      </button>
    );
  }
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button onClick={() => setOpen((v) => !v)} title="Querverweise anzeigen"
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, display: 'inline-flex' }}>
        <Badge tone="warning"><GitBranch size={10} /> {refs.length}</Badge>
      </button>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: '100%', zIndex: 50, background: 'var(--bg-card)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)', boxShadow: '0 4px 16px rgba(0,0,0,.4)', minWidth: 220, padding: '4px 0' }}>
          {refs.map((x) => (
            <button key={x.id} onClick={() => { onSelect(x.id); setOpen(false); }}
              style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', padding: '7px 14px', cursor: 'pointer', color: 'var(--text)', fontSize: 12.5 }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-hover)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}>
              <span style={{ fontWeight: 600, color: 'var(--accent)', marginRight: 8 }}>{x.ticketNr || '—'}</span>
              <span style={{ color: 'var(--text-dim)', fontSize: 11.5 }}>{x.title.length > 40 ? x.title.slice(0, 40) + '…' : x.title}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

function AnalysisTabView(p: { t: Ticket; iocs: Ioc[]; onEnrichIocs: () => void; iocBusy: boolean; crossRefs: Record<string, { id: string; ticketNr: string; title: string; priority: string }[]>; onCrossRef: () => void; xrefBusy: boolean; reco: string; setReco: (s: string) => void; decision: string; setDecision: (s: string) => void; confidence: number; setConfidence: (n: number) => void; onSaveAnalysis: () => void; savingAnalysis: boolean; analysisSaved: boolean; cmdOut: string; setCmdOut: (s: string) => void; fpReason: string; setFpReason: (s: string) => void; onCloseFp: () => void; onPrepareException: () => void; onQuickFp: () => void; fpQuickBusy: boolean; fpQuickMsg: { ok: boolean; text: string } | null; kiFp: KiFpSignal | null; canAct: boolean; busy: boolean; onSelectTicket: (id: string) => void; onMarkIoc: (value: string, rep: NonNullable<Ioc['reputation']>) => void; onAppendNote: (text: string) => void; entities: EntityItem[]; evidence: ParsedEvidence; bullets: SummaryBullet[]; risk: RiskModel | null }) {
  const { t, iocs } = p;
  const hasIp = iocs.some((i) => i.type === 'ip');
  const [iocTab, setIocTab] = useState<string>('all');
  const counts = iocCounts(iocs, p.entities, p.evidence);
  const iocTabKinds = (['ip', 'domain', 'hash', 'file', 'url'] as const).filter((k) => iocs.some((i) => i.type === k));
  const shownIocs = iocTab === 'all' ? iocs : iocs.filter((i) => i.type === iocTab);
  const blocks = recommendedBlocks(iocs);
  const confColor = (rep?: string) => { const c = iocConfidence(rep); return c === 'high' ? 'var(--danger)' : c === 'medium' ? 'var(--warning)' : c === 'low' ? 'var(--success)' : 'var(--text-dim)'; };
  const confLabel = (rep?: string) => { const c = iocConfidence(rep); return c ? c.charAt(0).toUpperCase() + c.slice(1) : '—'; };
  const [cmdSaved, triggerCmdSaved] = useAutoResetFlag(2500);
  const [wazuhTag, setWazuhTag] = useState('');
  const [tagSaved, setTagSaved] = useState('');
  const [cmdErr, setCmdErr] = useState(false);
  async function applyWazuhTag() {
    if (!wazuhTag.trim()) return;
    const tag = wazuhTag.trim();
    const datum = new Date().toLocaleString('de-DE');
    const notizZeile = `[Wazuh-Tag: ${tag}] ${datum}`;
    p.onAppendNote(notizZeile);
    setTagSaved(tag);
    setWazuhTag('');
    setTimeout(() => setTagSaved(''), 2500);
  }
  async function addCmdEvidence() {
    if (!p.cmdOut.trim()) return;
    setCmdErr(false);
    try {
      await evidenceApi.add({
        ticketId: t.id, type: 'log_entry', source: 'manual',
        title: 'Command Output', logSource: 'Command Deck', rawText: p.cmdOut,
      });
      triggerCmdSaved();
    } catch { setCmdErr(true); }
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
      <Card style={{ gridColumn: '1 / -1', padding: '14px 16px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 22, alignItems: 'center' }}>
          {([['Total IoCs', counts.total], ['IPs', counts.ip], ['Domains', counts.domain], ['Hashes', counts.hash], ['Files', counts.file], ['Processes', counts.process], ['Users', counts.user], ['MITRE', counts.mitre]] as [string, number][]).map(([label, value]) => (
            <div key={label} style={{ minWidth: 60 }}>
              <div style={LABEL}>{label}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', marginTop: 2 }}>{value}</div>
            </div>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ textAlign: 'right' }}><div style={LABEL}>Risk Score</div><div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{p.risk?.businessImpact ? `${p.risk.businessImpact} Risk` : '—'}</div></div>
            <div style={{ width: 56, height: 56, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0, border: `3px solid ${(p.risk?.score ?? 0) >= 80 ? 'var(--danger)' : (p.risk?.score ?? 0) >= 50 ? 'var(--warning)' : 'var(--success)'}` }}>
              <span style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)' }}>{p.risk?.score ?? '—'}</span>
            </div>
          </div>
        </div>
      </Card>
      <Sec title="Summary" icon={<FileText size={15} style={{ color: 'var(--accent)' }} />} style={{ gridColumn: '1 / -1' }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{t.description || t.category || 'Keine Beschreibung im Ticket hinterlegt.'}</p>
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-dim)' }}>Quelle: <strong style={{ color: 'var(--text-muted)' }}>{t.source || 'manual'}</strong>{t.offenseId ? ` · Offense ${t.offenseId}` : ''}</div>
      </Sec>

      <Sec title="Extracted IoCs" icon={<AlertTriangle size={15} style={{ color: 'var(--warning)' }} />} style={{ gridColumn: '1 / -1' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, flex: 1, minWidth: 0 }}>
            {(['all', ...iocTabKinds] as string[]).map((k) => {
              const on = iocTab === k; const n = k === 'all' ? iocs.length : iocs.filter((i) => i.type === k).length;
              return <button key={k} type="button" onClick={() => setIocTab(k)} style={{ background: on ? 'var(--accent-soft)' : 'transparent', border: `1px solid ${on ? 'var(--accent)' : 'var(--border-soft)'}`, color: on ? 'var(--accent)' : 'var(--text-muted)', borderRadius: 'var(--radius-pill)', fontSize: 11, fontWeight: 600, cursor: 'pointer', padding: '3px 10px' }}>{k === 'all' ? 'Alle' : k.toUpperCase()} ({n})</button>;
            })}
          </div>
          {iocs.length > 0 && <Button variant="ghost" size="sm" icon={<GitBranch size={13} />} disabled={p.xrefBusy} onClick={p.onCrossRef}>{p.xrefBusy ? '…' : 'Querverweise'}</Button>}
          {hasIp && <Button variant="ghost" size="sm" icon={<Globe size={13} />} disabled={p.iocBusy} onClick={p.onEnrichIocs}>{p.iocBusy ? 'Prüfe …' : 'Reputation prüfen'}</Button>}
        </div>
        {iocs.length === 0 ? <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Keine IoCs am Ticket.</span>
          : shownIocs.length === 0 ? <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Keine IoCs dieses Typs.</span>
          : shownIocs.slice(0, 12).map((i) => (
            <IocRow key={i.value} ioc={i} ticketId={t.id} crossRefs={p.crossRefs[i.value] ?? []} onSelectTicket={p.onSelectTicket} onMark={p.onMarkIoc} />
          ))}
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8 }}>{Math.min(12, shownIocs.length)} von {shownIocs.length} · Reputation/Confidence aus Threat-Intel-Enrichment (real); Source/First/Last pro IoC nicht im Datenmodell.</div>
      </Sec>

      <Sec title="Command Deck" icon={<Terminal size={15} style={{ color: 'var(--success)' }} />}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <Badge tone="success">Safe Lookups</Badge><Badge tone="muted">Agent Commands · Coming Soon</Badge>
        </div>
        {COMMAND_TEMPLATES(t.dstIp ?? undefined, t.srcIp ?? undefined).map((c) => (
          <div key={c} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-card-soft)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: '6px 10px', marginBottom: 4 }}>
            <code className="mono" style={{ fontSize: 11.5, color: 'var(--text)' }}>{c}</code>
            <button style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer' }} title="Copy" onClick={() => navigator.clipboard?.writeText(c)}><Copy size={13} /></button>
          </div>
        ))}
        <textarea value={p.cmdOut} onChange={(e) => p.setCmdOut(e.target.value)} placeholder="Output hier einfügen (keine echte Remote-Execution)…" style={{ width: '100%', minHeight: 60, marginTop: 6, background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: 8, fontSize: 11.5, fontFamily: 'var(--font-mono)' }} />
        <Button variant="ghost" size="sm" icon={cmdSaved ? <Check size={13} /> : <Plus size={13} />} disabled={!p.cmdOut.trim() || cmdSaved} onClick={() => void addCmdEvidence()} style={{ marginTop: 6 }}>{cmdSaved ? 'Als Evidence gespeichert' : 'Add Output as Evidence'}</Button>
        {cmdErr && <div role="alert" style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4 }}>Command-Output konnte nicht als Evidence gespeichert werden.</div>}
      </Sec>

      <Sec title="Evidence-backed Rationale" icon={<ListChecks size={15} style={{ color: 'var(--accent)' }} />}>
        {p.bullets.length === 0 ? <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Keine belegten Fakten abgeleitet.</span> :
          p.bullets.filter((b) => b.kind !== 'recommend').slice(0, 6).map((b) => (
            <div key={b.text} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '5px 0', borderBottom: '1px solid var(--border-soft)' }}>
              <Check size={14} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.45 }}>{b.text}</span>
            </div>
          ))}
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>Aus Evidence/Timeline abgeleitet — vollständige Felder im Tab „Evidence".</div>
      </Sec>

      <Sec title="Recommended Blocks / Watchlist" icon={<ShieldAlert size={15} style={{ color: 'var(--danger)' }} />}>
        {blocks.length === 0 ? <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Keine malicious/suspicious IoCs zum Blocken.</span> :
          blocks.slice(0, 6).map((b) => (
            <div key={b.value} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--border-soft)' }}>
              <span className="mono" style={{ fontSize: 11.5, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.value}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: confColor(b.reputation) }}>{confLabel(b.reputation)}</span>
              <Button variant="ghost" size="sm" onClick={() => p.onAppendNote(`[Watchlist] ${b.value} (${b.reputation})`)}>Watchlist</Button>
            </div>
          ))}
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>„Watchlist" vermerkt den IoC in den Notizen. Aktives Blocken läuft über die FP-/Detection-Pipeline unten.</div>
      </Sec>

      <Sec title="Recommendation" icon={<ShieldCheck size={15} style={{ color: 'var(--danger)' }} />}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {RECO_ACTIONS.map((a) => <button key={a} disabled title="Aktion folgt (kein Remote-Exec)" style={{ fontSize: 11, padding: '5px 10px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--border-soft)', background: 'transparent', color: 'var(--text-muted)' }}>{a}</button>)}
        </div>
        <textarea value={p.reco} onChange={(e) => p.setReco(e.target.value)} placeholder="Empfehlung / Begründung…" style={{ width: '100%', minHeight: 56, background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: 8, fontSize: 12 }} />
        <Button variant="primary" size="sm" style={{ marginTop: 6 }} disabled={p.savingAnalysis} onClick={p.onSaveAnalysis}>{p.analysisSaved ? '✓ Gespeichert' : p.savingAnalysis ? 'Speichern …' : 'Save Recommendation'}</Button>
      </Sec>

      <Sec title="Decision" icon={<ShieldCheck size={15} style={{ color: 'var(--accent)' }} />} style={{ gridColumn: '1 / -1' }}>
        {p.kiFp?.isFp && p.decision !== 'fp' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14, padding: '9px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--accent-soft)', border: '1px solid var(--accent)' }}>
            <ShieldCheck size={15} style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: 12.5, color: 'var(--text)' }}>
              <strong>KI-Einschätzung: False Positive</strong> ({p.kiFp.confidence}% Confidence){p.kiFp.reason ? ` — ${p.kiFp.reason}` : ''}
            </span>
            <Button variant="ghost" size="sm" style={{ marginLeft: 'auto' }}
              onClick={() => { p.setDecision('fp'); if (!p.fpReason.trim() && p.kiFp?.reason) p.setFpReason(p.kiFp.reason); }}>
              Übernehmen
            </Button>
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
          {DECISIONS.map((d) => {
            const active = p.decision === d.key;
            const color = d.tone === 'muted' ? 'var(--text-muted)' : `var(--${d.tone})`;
            return (
              <button key={d.key} onClick={() => p.setDecision(d.key)} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, padding: '14px 8px',
                borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontWeight: 600, fontSize: 12.5, transition: 'all .12s',
                border: `1px solid ${active ? color : 'var(--border-soft)'}`,
                background: active ? `color-mix(in srgb, ${color} 13%, transparent)` : 'var(--bg-card-soft)',
                color: active ? color : 'var(--text-muted)',
                boxShadow: active ? `inset 0 -2px 0 0 ${color}` : 'none',
              }}>
                {DEC_ICON[d.key]} {d.label}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={LABEL}>Confidence</span>
          <input type="range" min={0} max={100} value={p.confidence} onChange={(e) => p.setConfidence(Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--accent)' }} />
          <span className="mono" style={{ color: 'var(--text)', fontSize: 12.5, fontWeight: 700, minWidth: 46, textAlign: 'right' }}>{p.confidence}%</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
          <Button variant="primary" size="sm" icon={<FileText size={13} />} disabled={p.savingAnalysis} onClick={p.onSaveAnalysis}>{p.savingAnalysis ? 'Speichert …' : 'Analyse speichern'}</Button>
          {p.analysisSaved && <span style={{ fontSize: 12, color: 'var(--success)' }}>✓ gespeichert</span>}
          <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 'auto' }}>Decision · Confidence · Recommendation · Notes werden am Ticket persistiert.</span>
        </div>

        {p.decision === 'fp' && (
          <div style={{ marginTop: 14, padding: 14, borderRadius: 'var(--radius-sm)', background: 'var(--bg-card-soft)', border: '1px solid var(--danger)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ display: 'grid', placeItems: 'center', width: 26, height: 26, borderRadius: 7, background: 'var(--danger-soft)', color: 'var(--danger)' }}><XCircle size={15} /></span>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>False Positive — Begründung &amp; Aktionen</span>
            </div>
            <label style={{ ...LABEL, display: 'block', marginBottom: 5 }}>Begründung (Pflicht)</label>
            <textarea value={p.fpReason} onChange={(e) => p.setFpReason(e.target.value)} placeholder="Warum ist das ein False Positive? (z. B. lokaler Multicast-Traffic, erwartetes Verhalten)"
              style={{ width: '100%', minHeight: 64, background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '8px 10px', fontSize: 12.5, lineHeight: 1.5 }} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              <Button variant="danger" icon={<XCircle size={14} />} disabled={!p.canAct || p.busy || !p.fpReason.trim()} title={!p.fpReason.trim() ? 'Begründung erforderlich' : ''} onClick={p.onCloseFp}>Als False Positive schließen</Button>
              <Button variant="primary" icon={<ShieldCheck size={14} />} disabled={!p.canAct || p.fpQuickBusy || !p.fpReason.trim()} title={!p.fpReason.trim() ? 'Begründung erforderlich' : 'Ein Klick: Regel aus Evidence erzeugen (Analyst→Freigabe, Engineer/Admin→schreiben)'} onClick={p.onQuickFp}>{p.fpQuickBusy ? 'Erzeuge …' : 'FP-Regel erstellen'}</Button>
              <Button variant="ghost" icon={<ShieldCheck size={14} />} onClick={p.onPrepareException}>Ausnahme im Editor verfeinern</Button>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    value={wazuhTag}
                    onChange={(e) => setWazuhTag(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void applyWazuhTag(); }}
                    placeholder="Tag (z.B. reviewed, escalated)"
                    style={{ fontSize: 12, padding: '4px 8px', background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', width: 200 }}
                  />
                  <Button variant="ghost" size="sm" disabled={!wazuhTag.trim()} onClick={() => void applyWazuhTag()}>Alert taggen</Button>
                  {tagSaved && <span style={{ fontSize: 11, color: 'var(--success)' }}>✓ Tag &apos;{tagSaved}&apos; gesetzt</span>}
                </span>
            </div>
            {p.fpQuickMsg && (
              <div style={{ marginTop: 10, fontSize: 12, color: p.fpQuickMsg.ok ? 'var(--success)' : 'var(--danger)', background: p.fpQuickMsg.ok ? 'var(--success-soft)' : 'var(--danger-soft)', border: `1px solid ${p.fpQuickMsg.ok ? 'var(--success)' : 'var(--danger)'}`, borderRadius: 'var(--radius-sm)', padding: '7px 10px' }}>{p.fpQuickMsg.text}</div>
            )}
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 10 }}>„Schließen" wirkt sofort (unser Ticket, Schließgrund <code>false_positive</code>). <strong>FP-Regel erstellen</strong> erzeugt die scoped Wazuh-Regel aus der Evidence — Analyst leitet zur Freigabe weiter, Engineer/Admin schreibt direkt (hinter dem Safety-Gate). Sie erscheint danach im <strong>Detection Board</strong>.</div>
          </div>
        )}
      </Sec>
    </div>
  );
}

// ── REPORT Tab ────────────────────────────────────────────────────────────
// Evidence-Gradierung → Ton: Fakt (bestätigt) vs. Indikator vs. Lücke klar trennen.
const CATEGORY_TONE: Record<string, { label: string; color: string }> = {
  facts: { label: 'Bestätigt', color: 'var(--success)' },
  indicators: { label: 'Indikator', color: 'var(--warning)' },
  gaps: { label: 'Lücke', color: 'var(--danger)' },
  assessment: { label: 'Bewertung', color: 'var(--purple)' },
  actions: { label: 'Maßnahme', color: 'var(--accent)' },
  traceability: { label: 'Quelle', color: 'var(--text-muted)' },
  meta: { label: '', color: 'var(--accent)' },
};

function ReportTabView({ t, iocs, bullets, entities, tl, network, correlation, onSendToTicket }: { t: Ticket; iocs: Ioc[]; bullets: SummaryBullet[]; entities: EntityItem[]; tl: TicketTimeline | null; network: NetworkCorrelation | null; correlation: CorrelationStatusInfo | null; onSendToTicket: (md: string) => void }) {
  const [sent, triggerSent] = useAutoResetFlag(2500);

  // Evidence-gradierter Incident-Report — Single Source (reportModel) für Preview + PDF.
  const incident = useMemo(
    () => buildIncidentReport({ ticket: t, summary: bullets, entities, timeline: tl, iocs, network, correlation }),
    [t, bullets, entities, tl, iocs, network, correlation],
  );

  // jsPDF lädt dynamisch (Bundle-Split); die reinen Modelle sind statisch importiert.
  async function downloadStructured(kind: 'incident' | 'customer') {
    const { buildReportPdfDoc, reportPdfFilename } = await import('../features/analysis/reportPdf');
    const model = kind === 'incident' ? incident : buildCustomerReport(t, bullets);
    buildReportPdfDoc(model).save(reportPdfFilename(kind));
  }
  // EIN ReportDoc → Text (Copy/Markdown/Print/PDF) — keine separate Mapping-Logik.
  const md = useMemo(() => renderReportText(incident), [incident]);
  // ReportDoc → strukturiertes JSON (maschinenlesbar, für SOAR/Ticket-Ingestion).
  function downloadJson() {
    const blob = new Blob([renderReportJson(incident)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = reportJsonFilename('incident');
    a.click();
  }
  return (
    <Card style={{ padding: '14px 16px' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <Button variant="primary" size="sm" onClick={() => void downloadStructured('incident')}>Incident-Report (PDF)</Button>
        <Button variant="success" size="sm" onClick={() => void downloadStructured('customer')}>Kunden-Report (PDF)</Button>
        <Button variant="ghost" size="sm" onClick={() => navigator.clipboard?.writeText(md)}>Copy Markdown</Button>
        <Button variant="ghost" size="sm" onClick={() => { const b = new Blob([md], { type: 'text/markdown' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `report-${t.ticketNr || t.id}.md`; a.click(); }}>Export Markdown</Button>
        <Button variant="ghost" size="sm" onClick={() => downloadReportPdf(`report-${t.ticketNr || t.id}`, md)}>Export PDF</Button>
        <Button variant="ghost" size="sm" onClick={downloadJson}>Export JSON</Button>
        <Button variant="ghost" size="sm" onClick={() => { onSendToTicket(md); triggerSent(); }}>{sent ? '✓ An Ticket gehängt' : 'Send to Ticket System'}</Button>
      </div>
      <div data-testid="incident-report-preview" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {incident.sections.map((s) => {
          const tone = CATEGORY_TONE[s.category ?? 'meta'] ?? CATEGORY_TONE.meta;
          return (
            <div key={s.heading} style={{ background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderLeft: `3px solid ${tone.color}`, borderRadius: 'var(--radius-sm)', padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                {tone.label && <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: tone.color, fontWeight: 700 }}>{tone.label}</span>}
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{s.heading}</span>
              </div>
              {s.fields?.map((f) => (
                <div key={f.label} style={{ fontSize: 12, color: 'var(--text)', display: 'flex', gap: 6, padding: '1px 0' }}>
                  <span style={{ color: 'var(--text-muted)', minWidth: 90 }}>{f.label}:</span><span>{f.value}</span>
                </div>
              ))}
              {s.paragraphs?.map((p) => (
                <div key={`${s.heading}-p-${p}`} style={{ fontSize: 12, color: 'var(--text-dim)', fontStyle: 'italic', margin: '2px 0' }}>{p}</div>
              ))}
              {s.items?.map((it) => (
                <div key={`${s.heading}-i-${it.text}`} style={{ fontSize: 12, color: 'var(--text)', display: 'flex', justifyContent: 'space-between', gap: 8, padding: '1px 0' }}>
                  <span>• {it.text}</span>
                  {it.source && <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>↳ {it.source}</span>}
                </div>
              ))}
              {s.bullets?.map((b) => (
                <div key={`${s.heading}-b-${b}`} style={{ fontSize: 12, color: 'var(--text)', padding: '1px 0' }}>• {b}</div>
              ))}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
