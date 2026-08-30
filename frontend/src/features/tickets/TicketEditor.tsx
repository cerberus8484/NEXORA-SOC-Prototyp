import { useRef, useState, type ReactNode } from 'react';
import {
  Shield, Target, UserRound, Network, Server, Radar, FileArchive,
  Save, FileCode2, Upload, Download, Sun, BookMarked, Plus, Zap,
} from 'lucide-react';
import {
  Card, CardHeader, CardBody, Button, Field, Input, Textarea, Select, Accordion, Badge, SectionHeader,
} from '../../components/ui';
import { RichTextToolbar } from './RichTextToolbar';
import { ChecklistField } from './ChecklistField';
import { generateTemplate } from './templateModel';
import { TemplateModal } from './TemplateModal';
import { VorlagenModal } from './VorlagenModal';
import { UseCaseModal } from './UseCaseModal';
import { parseTicketImport } from './ticketImport';
import { ImportRawModal, type ImportRawResult } from './ImportRawModal';
import { TiEntryEditor } from './TiEntryEditor';
import { emptyTiEntry, type TiEntry } from './tiEntry';
import { PayloadEditor } from './PayloadEditor';
import { payloadToTemplateFields, type TicketPayloadItem } from './payloadSchema';
import { useTranslation } from 'react-i18next';

export type TicketForm = Record<string, string>;
/** Save-Payload: flache Formfelder + eingebettete Payload-Artefakte + TI-Einträge. */
export interface TicketSaveData extends Record<string, unknown> {
  payloads: TicketPayloadItem[];
  tiEntries: TiEntry[];
}

interface TicketEditorProps {
  initial?: TicketForm;
  /** Ticket-ID für Smart-Parser-Import (POST /tickets/:id/import). Optional — Import deaktiviert wenn leer. */
  ticketId?: string;
  readOnly?: boolean;
  saving?: boolean;
  onSave?: (data: TicketSaveData) => void;
}

const MAX_DESC = 20000;

const opt = (...vals: string[]) => [{ value: '', label: '— wählen —' }, ...vals.map((v) => ({ value: v, label: v }))];
const PRIORITY_OPTS = [
  { value: 'critical', label: 'Critical' }, { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }, { value: 'info', label: 'Info' },
];
const STATE_OPTS = [
  { value: 'OPEN', label: 'Open' }, { value: 'CLOSED', label: 'Closed' },
];
const STATUS_OPTS = [
  { value: 'assigned', label: 'Assigned' }, { value: 'in_progress', label: 'In Progress' },
  { value: 'on_hold', label: 'On Hold' }, { value: 'awaiting_customer', label: 'Awaiting Customer' },
];
const CLOSE_REASON_OPTS = [
  { value: '', label: '— kein —' },
  { value: 'resolved', label: 'Resolved' }, { value: 'false_positive', label: 'False Positive' },
  { value: 'duplicate', label: 'Duplicate' }, { value: 'benign', label: 'Benign' }, { value: 'other', label: 'Other' },
];
const USERTYPE_OPTS    = opt('Standard User', 'Privileged User', 'Service Account', 'Administrator');
const ACCSTATUS_OPTS   = opt('Active', 'Disabled', 'Locked', 'Unknown');
const CRITICALITY_OPTS = opt('Low', 'Medium', 'High', 'Critical');
const PROTOCOL_OPTS    = opt('TCP', 'UDP', 'ICMP', 'Other');
const DEVICETYPE_OPTS  = opt('Workstation', 'Server', 'VM', 'Mobile', 'Network Device');

/** Zählt befüllte Felder einer Sektion → "x/y" Completion-Badge. */
function completion(form: TicketForm, keys: string[]): ReactNode {
  const filled = keys.filter((k) => (form[k] ?? '').trim().length > 0).length;
  const tone = filled === keys.length ? 'success' : filled === 0 ? 'muted' : 'accent';
  return <Badge tone={tone}>{filled}/{keys.length}</Badge>;
}

export function TicketEditor({ initial = {}, ticketId, readOnly = false, saving = false, onSave }: TicketEditorProps) {
  const { t: tr } = useTranslation();
  const [form, setForm] = useState<TicketForm>(initial);
  // Payload-Artefakte kommen vom Backend als Array (kein String) — separat halten.
  const [payloads, setPayloads] = useState<TicketPayloadItem[]>(
    () => ((initial as Record<string, unknown>).payloads as TicketPayloadItem[] | undefined) ?? [],
  );
  // Threat-Intel-Einträge — wie Payloads als Array vom Backend, separat halten.
  const [tiEntries, setTiEntries] = useState<TiEntry[]>(
    () => ((initial as Record<string, unknown>).tiEntries as TiEntry[] | undefined) ?? [],
  );
  const [tplText, setTplText] = useState<string | null>(null);
  const [showVorlagen, setShowVorlagen] = useState(false);
  const [showUseCases, setShowUseCases] = useState(false);
  const [showImportRaw, setShowImportRaw] = useState(false);
  const [importError, setImportError] = useState('');
  const descRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setVal = (k: string, value: string) => setForm((f) => ({ ...f, [k]: value }));
  const ro = readOnly;
  const desc = form.description ?? '';

  // Smart-Parser-Import: formPatch in Form mergen, neue Payloads anhängen.
  function applyRawImport({ formPatch, payloads: newPayloads }: ImportRawResult) {
    if (Object.keys(formPatch).length > 0) setForm((f) => ({ ...f, ...formPatch }));
    if (newPayloads.length > 0) setPayloads((p) => [...p, ...newPayloads]);
  }

  // Export: echter Client-seitiger JSON-Download (kein Backend nötig) — inkl. Payloads für Round-Trip.
  function exportJson() {
    const blob = new Blob([JSON.stringify({ ...form, payloads, tiEntries }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ticket-${form.ticketNr || 'neu'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Import: exportierte Ticket-JSON einlesen, Felder ins Formular mergen, Payloads anhängen.
  async function importJson(file: File) {
    setImportError('');
    try {
      const { form: imported, payloads: importedPayloads, tiEntries: importedTi } = parseTicketImport(JSON.parse(await file.text()));
      setForm((f) => ({ ...f, ...imported }));
      if (importedPayloads.length > 0) setPayloads((p) => [...p, ...importedPayloads]);
      if (importedTi.length > 0) setTiEntries((t) => [...t, ...importedTi]);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : tr('common.importFailed'));
    }
  }

  return (
    <div>
      <SectionHeader
        title={initial.ticketNr ? `Ticket ${initial.ticketNr}` : tr('label.newTicket')}
        subtitle={tr('tickets.documentIncident')}
        actions={!ro && (
          <>
            <Button variant="ghost" icon={<Sun size={15} />} disabled title="Theme – Coming soon" />
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importJson(file);
                e.target.value = ''; // erlaubt erneuten Import derselben Datei
              }}
            />
            <Button variant="ghost" icon={<Upload size={15} />} onClick={() => fileRef.current?.click()}>JSON</Button>
            {ticketId && (
              <Button variant="ghost" icon={<Zap size={15} />} onClick={() => setShowImportRaw(true)} title={tr('tickets.smartParserImportLong')}>
                Smart-Import
              </Button>
            )}
            <Button variant="ghost" icon={<Download size={15} />} onClick={exportJson}>Export</Button>
            <Button
              variant="purple"
              icon={<FileCode2 size={15} />}
              onClick={() => setTplText(generateTemplate(form, {
                payloads: payloads.map((p) => ({ type: p.type, fields: payloadToTemplateFields(p) })),
                tiEntries,
              }))}
            >{tr('useCase.generateTemplate')}</Button>
            <Button variant="success" icon={<Save size={15} />} disabled={saving} onClick={() => onSave?.({ ...form, payloads, tiEntries })}>
              {saving ? tr('common.saving') : tr('common.save')}
            </Button>
          </>
        )}
      />

      {importError && (
        <div style={{ color: 'var(--danger)', fontSize: 13, margin: '8px 0', padding: '8px 12px', background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)' }}>
          Import: {importError}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '45fr 55fr', gap: 20, alignItems: 'start' }}>
        {/* ── LINKS: Analyse & Befunde (große Freitextfläche bleibt groß) ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <CardHeader
              title={<span style={{ color: 'var(--accent)' }}>{tr('analysis.analysisFindings')}</span>}
              actions={!ro && <Button size="sm" variant="ghost" icon={<BookMarked size={14} />} onClick={() => setShowVorlagen(true)}>{tr('ui.loadSaveTemplate')}</Button>}
            />
            <CardBody>
              <Field label={tr('ui.descriptionWhatHappened')}>
                <div>
                  <RichTextToolbar targetRef={descRef} value={desc} onChange={(v) => setVal('description', v)} disabled={ro} />
                  <textarea
                    ref={descRef}
                    className="textarea textarea-rtb"
                    value={desc}
                    onChange={set('description')}
                    readOnly={ro}
                    maxLength={MAX_DESC}
                    style={{ minHeight: 460 }}
                    placeholder={tr('ui.detailedDescriptionIncidentWhatObserved')}
                  />
                  <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }} className="mono">
                    {desc.length} / {MAX_DESC}
                  </div>
                </div>
              </Field>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 8 }}>
                <Field label="IOCs (Indicators of Compromise)">
                  <Textarea value={form.iocs ?? ''} onChange={set('iocs')} readOnly={ro} style={{ minHeight: 110 }} className="input-mono" placeholder={tr('text.ipAddressesDomainsHashesOne')} />
                </Field>
                <Field label={tr('tickets.logSourcesEvidence')}>
                  <Textarea value={form.logs ?? ''} onChange={set('logs')} readOnly={ro} style={{ minHeight: 110 }} placeholder="SIEM Rule, Event ID, Firewall-Log, EDR-Alert …" />
                </Field>
                <Field label={tr('analysis.actionsTaken')}>
                  <ChecklistField value={form.actions ?? ''} onChange={(v) => setVal('actions', v)} readOnly={ro} placeholder={tr('ui.addAction')} />
                </Field>
                <Field label={tr('analysis.recommendationNextSteps')}>
                  <ChecklistField value={form.recommendation ?? ''} onChange={(v) => setVal('recommendation', v)} readOnly={ro} placeholder={tr('ui.addNextStep')} />
                </Field>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={tr('ui.internalNotesNotReport')} />
            <CardBody>
              <Textarea value={form.notes ?? ''} onChange={set('notes')} readOnly={ro} style={{ minHeight: 90 }} placeholder={tr('ui.personalNotesOpenQuestionsFollow')} />
            </CardBody>
          </Card>
        </div>

        {/* ── RECHTS: Accordion-Sektionen ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Accordion title="Ticket & Offense" icon={<Shield size={16} />} badge={completion(form, ['ticketNr', 'offenseId', 'datetime', 'priority', 'state', 'status', 'analyst', 'customer'])} defaultOpen>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="Ticket-Nr."><Input mono value={form.ticketNr ?? ''} onChange={set('ticketNr')} readOnly={ro} placeholder="NXC-2025-000123" /></Field>
              <Field label="Offense-ID (SIEM)"><Input mono value={form.offenseId ?? ''} onChange={set('offenseId')} readOnly={ro} placeholder="OFF-00456" /></Field>
              <Field label={tr('common.dateTimeUtc')}><Input type="datetime-local" value={form.datetime ?? ''} onChange={set('datetime')} readOnly={ro} /></Field>
              <Field label={tr('common.priority')}><Select options={PRIORITY_OPTS} value={form.priority ?? 'medium'} onChange={set('priority')} disabled={ro} /></Field>
              <Field label="State"><Select options={STATE_OPTS} value={form.state ?? 'OPEN'} onChange={set('state')} disabled={ro} /></Field>
              <Field label="Status"><Select options={STATUS_OPTS} value={form.status ?? 'assigned'} onChange={set('status')} disabled={ro} /></Field>
              {(form.state ?? 'OPEN') === 'CLOSED' && (
                <Field label={tr('analysis.closingReason')}><Select options={CLOSE_REASON_OPTS} value={form.closeReason ?? ''} onChange={set('closeReason')} disabled={ro} /></Field>
              )}
              <Field label="Analyst"><Input value={form.analyst ?? ''} onChange={set('analyst')} readOnly={ro} placeholder={tr('ui.selectAnalyst')} /></Field>
              <Field label="Kunde / Mandant"><Input value={form.customer ?? ''} onChange={set('customer')} readOnly={ro} placeholder="z.B. ATOS AG" /></Field>
            </div>
          </Accordion>

          <Accordion title="Offense / Titel" icon={<Target size={16} />} badge={completion(form, ['title', 'category', 'useCase'])} defaultOpen>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Field label="Offense Name / Titel"><Input value={form.title ?? ''} onChange={set('title')} readOnly={ro} placeholder="z.B. Brute Force Attempt – RDP" /></Field>
              <Field label="Offense Kategorie / Rule"><Input value={form.category ?? ''} onChange={set('category')} readOnly={ro} placeholder="z.B. Authentication Failure, C2 Beacon" /></Field>
              <Field label="Use Case">
                <div style={{ display: 'flex', gap: 8 }}>
                  <Input value={form.useCase ?? ''} onChange={set('useCase')} readOnly={ro} placeholder="z.B. UC-042 – Lateral Movement Detection" />
                  <Button variant="ghost" size="sm" icon={<BookMarked size={14} />} disabled={ro} onClick={() => setShowUseCases(true)}>UC</Button>
                </div>
              </Field>
            </div>
          </Accordion>

          <Accordion title={tr('analysis.userIdentity')} icon={<UserRound size={16} />} badge={completion(form, ['user', 'email', 'dept', 'manager', 'userType', 'accStatus'])} defaultOpen>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="Username"><Input mono value={form.user ?? ''} onChange={set('user')} readOnly={ro} placeholder="jdoe / DOMAIN\jdoe" /></Field>
              <Field label="E-Mail"><Input value={form.email ?? ''} onChange={set('email')} readOnly={ro} placeholder="jdoe@firma.de" /></Field>
              <Field label={tr('profile.department')}><Input value={form.dept ?? ''} onChange={set('dept')} readOnly={ro} placeholder="IT / Finance / HR" /></Field>
              <Field label="Manager"><Input value={form.manager ?? ''} onChange={set('manager')} readOnly={ro} placeholder={tr('text.nameSupervisor')} /></Field>
              <Field label="User-Typ"><Select options={USERTYPE_OPTS} value={form.userType ?? ''} onChange={set('userType')} disabled={ro} /></Field>
              <Field label="Account Status"><Select options={ACCSTATUS_OPTS} value={form.accStatus ?? ''} onChange={set('accStatus')} disabled={ro} /></Field>
            </div>
          </Accordion>

          <Accordion title={tr('ui.networkDevices')} icon={<Network size={16} />} badge={completion(form, ['srcIp', 'srcFqdn', 'dstIp', 'dstFqdn', 'port', 'protocol', 'vpn'])} defaultOpen>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="Source IP"><Input mono value={form.srcIp ?? ''} onChange={set('srcIp')} readOnly={ro} placeholder="192.168.241.100" /></Field>
              <Field label="Source FQDN"><Input mono value={form.srcFqdn ?? ''} onChange={set('srcFqdn')} readOnly={ro} placeholder="pc01.domain.local" /></Field>
              <Field label="Destination IP"><Input mono value={form.dstIp ?? ''} onChange={set('dstIp')} readOnly={ro} placeholder="10.0.0.5" /></Field>
              <Field label="Destination FQDN"><Input mono value={form.dstFqdn ?? ''} onChange={set('dstFqdn')} readOnly={ro} placeholder="srv-web01.domain.local" /></Field>
              <Field label="Port(s)"><Input mono value={form.port ?? ''} onChange={set('port')} readOnly={ro} placeholder="3389 / 445 / 443" /></Field>
              <Field label="Protokoll"><Select options={PROTOCOL_OPTS} value={form.protocol ?? ''} onChange={set('protocol')} disabled={ro} /></Field>
              <Field label="VPN / Standort"><Input value={form.vpn ?? ''} onChange={set('vpn')} readOnly={ro} placeholder="VPN-DE-01 / Berlin Office" /></Field>
              <Field label={tr('ui.deviceType')}><Select options={DEVICETYPE_OPTS} value={form.deviceType ?? ''} onChange={set('deviceType')} disabled={ro} /></Field>
            </div>
          </Accordion>

          <Accordion title="System & Asset" icon={<Server size={16} />} badge={completion(form, ['os', 'assetTag', 'criticality', 'process', 'hash', 'mitre'])}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="OS / Version"><Input value={form.os ?? ''} onChange={set('os')} readOnly={ro} placeholder="Windows 10 22H2 / Ubuntu 22.04" /></Field>
              <Field label="Asset-Tag / CMDB-ID"><Input mono value={form.assetTag ?? ''} onChange={set('assetTag')} readOnly={ro} placeholder="ASSET-07890" /></Field>
              <Field label="Criticality"><Select options={CRITICALITY_OPTS} value={form.criticality ?? ''} onChange={set('criticality')} disabled={ro} /></Field>
              <Field label="Prozess / Binary"><Input mono value={form.process ?? ''} onChange={set('process')} readOnly={ro} placeholder="cmd.exe / powershell.exe" /></Field>
              <Field label="Hash (MD5 / SHA256)"><Input mono value={form.hash ?? ''} onChange={set('hash')} readOnly={ro} /></Field>
              <Field label="MITRE ATT&CK Technique"><Input mono value={form.mitre ?? ''} onChange={set('mitre')} readOnly={ro} placeholder="T1110.001 / T1059.001" /></Field>
            </div>
          </Accordion>

          <Accordion
            title="Threat Intel"
            icon={<Radar size={16} />}
            badge={!ro && <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={() => setTiEntries((t) => [...t, emptyTiEntry()])}>{tr('ui.addThreatIntelEntry')}</Button>}
          >
            <TiEntryEditor value={tiEntries} onChange={setTiEntries} readOnly={ro} />
          </Accordion>

          <Accordion
            title="Payloads / Artifacts"
            icon={<FileArchive size={16} />}
            badge={<Badge tone={payloads.length ? 'accent' : 'muted'}>{payloads.length}</Badge>}
            defaultOpen={payloads.length > 0}
          >
            <PayloadEditor value={payloads} onChange={setPayloads} readOnly={ro} />
          </Accordion>
        </div>
      </div>

      {tplText !== null && <TemplateModal text={tplText} onClose={() => setTplText(null)} />}
      {showImportRaw && ticketId && (
        <ImportRawModal
          ticketId={ticketId}
          onApply={applyRawImport}
          onClose={() => setShowImportRaw(false)}
        />
      )}
      {showVorlagen && (
        <VorlagenModal
          currentForm={form}
          onLoad={(patch) => setForm((f) => ({ ...f, ...patch }))}
          onClose={() => setShowVorlagen(false)}
        />
      )}
      {showUseCases && (
        <UseCaseModal
          currentValue={form.useCase ?? ''}
          onPick={(value) => setVal('useCase', value)}
          onClose={() => setShowUseCases(false)}
        />
      )}
    </div>
  );
}
