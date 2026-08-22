import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Library, Search, ShieldAlert, Target, Hash, ChevronLeft, ChevronRight, Plus, X, BookOpen, Code } from 'lucide-react';
import { SectionHeader, StatCard, Card, CardBody, Badge, Button, EmptyState, Spinner, type Tone } from '../components/ui';
import { detectionApi, isFpRule, type DetectionRule, type CustomRulePayload, type PublishedDetection } from '../features/detections/detectionApi';
import { can } from '../lib/rbac';
import { useAuth } from '../lib/auth';

const levelTone = (l: number): Tone => l >= 12 ? 'danger' : l >= 7 ? 'warning' : l >= 4 ? 'accent' : 'muted';
const PAGE = 50;

const FIELD_EXAMPLES: Record<string, string> = {
  'data.win.eventdata.commandLine': 'powershell.*-enc',
  'data.win.eventdata.image': '\\\\temp\\\\',
  'full_log': 'failed password',
  'data.srcip': '10\\.0\\.0\\.\\d+',
};

const COMMON_FIELDS = [
  'data.win.eventdata.commandLine',
  'data.win.eventdata.image',
  'data.win.eventdata.targetFilename',
  'data.win.eventdata.description',
  'data.srcip',
  'data.dstip',
  'full_log',
  'data.title',
];

interface CreateModal {
  description: string;
  level: string;
  fieldName: string;
  fieldType: 'regex' | 'match';
  fieldValue: string;
  ifSid: string;
  groups: string;
}

const MODAL_EMPTY: CreateModal = {
  description: '', level: '5', fieldName: COMMON_FIELDS[0], fieldType: 'regex',
  fieldValue: '', ifSid: '', groups: '',
};

export function DetectionLibraryPage() {
  const { user } = useAuth();
  const canAct = can.act(user?.role);

  const [data, setData] = useState<DetectionRule[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [level, setLevel] = useState('');
  const [group, setGroup] = useState('');
  const [ruleType, setRuleType] = useState<'all' | 'detection' | 'fp'>('all');
  const [offset, setOffset] = useState(0);

  // Neue Regel Modal
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<CreateModal>(MODAL_EMPTY);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');

  // Nexora Published Detections (aus UCD-Publish)
  const [publishedDetections, setPublishedDetections] = useState<PublishedDetection[] | null>(null);
  const [publishedTotal, setPublishedTotal] = useState(0);
  const [publishedLoading, setPublishedLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      detectionApi.list({ search, level, group, limit: PAGE, offset })
        .then((r) => { if (!alive) return; setEnabled(r.enabled); setData(r.data); setTotal(r.total); })
        .catch(() => { if (alive) setError(true); })
        .finally(() => { if (alive) setLoading(false); });
    }, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [search, level, group, offset]);

  useEffect(() => { setOffset(0); }, [search, level, group]);

  useEffect(() => {
    let alive = true;
    setPublishedLoading(true);
    detectionApi.getPublishedDetections({ limit: 100 })
      .then((r) => { if (alive) { setPublishedDetections(r.data); setPublishedTotal(r.total); } })
      .catch(() => { if (alive) setPublishedDetections([]); })
      .finally(() => { if (alive) setPublishedLoading(false); });
    return () => { alive = false; };
  }, []);

  const kpis = useMemo(() => {
    const list = data || [];
    return {
      techniques: new Set(list.flatMap((r) => r.mitre)).size,
      custom: list.filter((r) => r.id >= 100000).length,
      high: list.filter((r) => r.level >= 12).length,
    };
  }, [data]);

  // Client-seitiger Typ-Filter (FP-Suppression vs. Detection) auf der aktuellen Seite.
  const rows = useMemo(() => {
    const list = data || [];
    if (ruleType === 'fp') return list.filter(isFpRule);
    if (ruleType === 'detection') return list.filter((r) => !isFpRule(r));
    return list;
  }, [data, ruleType]);

  const page = Math.floor(offset / PAGE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  function openModal() {
    setForm(MODAL_EMPTY);
    setSaveError('');
    setSaveSuccess('');
    setShowModal(true);
  }

  async function handleCreate() {
    if (!form.description.trim()) { setSaveError('Beschreibung ist Pflicht.'); return; }
    if (!form.fieldValue.trim()) { setSaveError('Feld-Wert ist Pflicht.'); return; }
    const lvl = Number(form.level);
    if (!Number.isInteger(lvl) || lvl < 1 || lvl > 15) { setSaveError('Level muss 1–15 sein.'); return; }

    setSaving(true); setSaveError('');
    const payload: CustomRulePayload = {
      description: form.description.trim(),
      level: lvl,
      fieldName: form.fieldName,
      fieldType: form.fieldType,
      fieldValue: form.fieldValue.trim(),
      ifSid: form.ifSid.trim() || undefined,
      groups: form.groups.split(',').map((g) => g.trim()).filter(Boolean),
    };
    try {
      const r = await detectionApi.createCustom(payload);
      setSaveSuccess(`Regel ${r.ruleId} erfolgreich in ${r.file} gespeichert.`);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Fehler beim Speichern.');
    } finally {
      setSaving(false);
    }
  }

  const upd = (k: keyof CreateModal) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div>
      <SectionHeader title="Detection Library" help="detection" subtitle="Geladene Wazuh-Manager-Regeln (Detection-as-Code)"
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Badge tone={enabled ? 'success' : 'muted'}>{enabled ? `${total} Rules` : 'Wazuh-API nicht verbunden'}</Badge>
            {canAct && <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={openModal} disabled={!enabled} title={!enabled ? 'Wazuh-API nicht verbunden — Regel-Erstellung deaktiviert' : undefined}>Neue Regel</Button>}
          </div>
        }
      />

      {/* Neue Regel Modal */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)', width: '100%', maxWidth: 560, maxHeight: '90vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border-soft)' }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>Neue Custom-Erkennungsregel</span>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 4 }}><X size={16} /></button>
            </div>
            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 11.5, color: 'var(--text-dim)', background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 4, padding: '8px 10px' }}>
                Die Regel wird in <code style={{ fontFamily: 'var(--font-mono)' }}>nexora-custom-detections.xml</code> auf dem Wazuh-Manager gespeichert (ID-Bereich 100500–109999).
              </div>

              <div>
                <div style={SUBLABEL}>Beschreibung *</div>
                <input style={INPUT} value={form.description} onChange={upd('description')} placeholder="Verdächtige PowerShell-Ausführung mit encoded Command" />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: 10 }}>
                <div>
                  <div style={SUBLABEL}>Level * (1–15)</div>
                  <input type="number" min={1} max={15} style={INPUT} value={form.level} onChange={upd('level')} />
                </div>
                <div>
                  <div style={SUBLABEL}>Parent-Rule-ID (if_sid, optional)</div>
                  <input style={INPUT} value={form.ifSid} onChange={upd('ifSid')} placeholder="z. B. 60000" />
                </div>
              </div>

              <div>
                <div style={SUBLABEL}>Feld-Name *</div>
                <select style={INPUT} value={form.fieldName} onChange={upd('fieldName')}>
                  {COMMON_FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: 10 }}>
                <div>
                  <div style={SUBLABEL}>Match-Typ</div>
                  <select style={INPUT} value={form.fieldType} onChange={upd('fieldType')}>
                    <option value="regex">regex (pcre2)</option>
                    <option value="match">match (osmatch)</option>
                  </select>
                </div>
                <div>
                  <div style={SUBLABEL}>Wert * {FIELD_EXAMPLES[form.fieldName] && <span style={{ color: 'var(--accent)', marginLeft: 4 }}>z. B.: {FIELD_EXAMPLES[form.fieldName]}</span>}</div>
                  <input style={{ ...INPUT, fontFamily: 'var(--font-mono)' }} value={form.fieldValue} onChange={upd('fieldValue')}
                    placeholder={FIELD_EXAMPLES[form.fieldName] ?? 'Suchbegriff oder Regex'} />
                </div>
              </div>

              <div>
                <div style={SUBLABEL}>Zusätzliche Gruppen (kommagetrennt, optional)</div>
                <input style={INPUT} value={form.groups} onChange={upd('groups')} placeholder="sysmon, windows_security" />
              </div>

              {saveError && <div style={{ fontSize: 12, color: 'var(--danger)', padding: '6px 10px', background: 'rgba(var(--danger-rgb,220,38,38),0.08)', borderRadius: 4 }}>{saveError}</div>}
              {saveSuccess && <div style={{ fontSize: 12, color: 'var(--success)', padding: '6px 10px', background: 'rgba(0,255,136,0.08)', borderRadius: 4 }}>{saveSuccess}</div>}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4 }}>
                <Button variant="ghost" onClick={() => setShowModal(false)}>Abbrechen</Button>
                {!saveSuccess
                  ? <Button variant="primary" onClick={() => void handleCreate()} disabled={saving}>{saving ? 'Speichert …' : 'Regel erstellen'}</Button>
                  : <Button variant="ghost" onClick={() => setShowModal(false)}>Schließen</Button>}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-kpi" style={{ marginBottom: 16 }}>
        <StatCard label="Rules geladen" value={enabled ? String(total) : '—'} tone="accent" icon={<Library size={18} />} hint="Manager-Ruleset" />
        <StatCard label="MITRE-Techniken" value={data ? String(kpis.techniques) : '—'} tone="accent" icon={<Target size={18} />} hint="auf dieser Seite" />
        <StatCard label="Custom (≥100000)" value={data ? String(kpis.custom) : '—'} tone="accent" icon={<Hash size={18} />} hint="auf dieser Seite" />
        <StatCard label="High (Level ≥12)" value={data ? String(kpis.high) : '—'} tone="danger" icon={<ShieldAlert size={18} />} hint="auf dieser Seite" />
      </div>

      {/* Filter */}
      <Card style={{ marginBottom: 14 }}>
        <CardBody style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', padding: '12px 14px' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={SUBLABEL}>Search</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: '0 8px' }}>
              <Search size={14} style={{ color: 'var(--text-dim)' }} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Beschreibung, Rule-ID …"
                style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--text)', fontSize: 12.5, padding: '7px 0', outline: 'none' }} />
            </div>
          </div>
          <div>
            <div style={SUBLABEL}>Min. Level</div>
            <input type="number" min={0} max={16} value={level} onChange={(e) => setLevel(e.target.value)} placeholder="—"
              style={{ width: 90, background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 12.5, padding: '7px 8px', outline: 'none' }} />
          </div>
          <div>
            <div style={SUBLABEL}>Group</div>
            <input value={group} onChange={(e) => setGroup(e.target.value)} placeholder="z. B. sysmon, windows …"
              style={{ width: 170, background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 12.5, padding: '7px 8px', outline: 'none' }} />
          </div>
          <div>
            <div style={SUBLABEL}>Typ</div>
            <select value={ruleType} onChange={(e) => setRuleType(e.target.value as 'all' | 'detection' | 'fp')}
              style={{ width: 150, background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 12.5, padding: '7px 8px', outline: 'none' }}>
              <option value="all">Alle</option>
              <option value="detection">Nur Detection</option>
              <option value="fp">Nur FP-Ausnahmen</option>
            </select>
          </div>
          <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setLevel(''); setGroup(''); setRuleType('all'); }}>Clear</Button>
        </CardBody>
      </Card>

      {error ? (
        <Card><CardBody><EmptyState icon={<Library size={28} />} title="Konnte Rules nicht laden" message="Bitte später erneut versuchen." /></CardBody></Card>
      ) : !enabled ? (
        <Card><CardBody><EmptyState icon={<Library size={28} />} title="Wazuh-API nicht verbunden" message="Sobald die Wazuh-Manager-API (Port 55000) konfiguriert ist, erscheinen hier die geladenen Detection-Rules inkl. deiner SIEM-Rules." /></CardBody></Card>
      ) : !data || (loading && !data.length) ? (
        <Card><CardBody><Spinner label="Rules werden geladen …" /></CardBody></Card>
      ) : rows.length === 0 ? (
        <Card><CardBody><EmptyState icon={<Library size={28} />} title="Keine Rules" message="Keine Treffer für die aktuellen Filter." /></CardBody></Card>
      ) : (
        <Card>
          <CardBody style={{ padding: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['ID', 'Level', 'Description', 'MITRE', 'Groups', 'File'].map((h) => <th key={h} style={TH}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...TD, fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{r.id}</td>
                    <td style={TD}><Badge tone={levelTone(r.level)}>{r.level}</Badge></td>
                    <td style={{ ...TD, maxWidth: 420 }}>
                      {isFpRule(r) && <span style={{ marginRight: 6 }}><Badge tone="warning">FP-Ausnahme</Badge></span>}
                      {r.description}
                    </td>
                    <td style={TD}>
                      <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {r.mitre.slice(0, 3).map((m) => <Badge key={m} tone="accent">{m}</Badge>)}
                        {r.mitre.length > 3 && <Badge tone="muted">+{r.mitre.length - 3}</Badge>}
                        {r.mitre.length === 0 && <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>—</span>}
                      </span>
                    </td>
                    <td style={{ ...TD, fontSize: 11, color: 'var(--text-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.groups.join(', ')}</td>
                    <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-dim)' }}>{r.filename || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderTop: '1px solid var(--border-soft)' }}>
              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{total} Rules · Seite {page}/{pages}{loading ? ' · lädt …' : ''}</span>
              <span style={{ display: 'flex', gap: 6 }}>
                <Button variant="ghost" size="sm" icon={<ChevronLeft size={14} />} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Zurück</Button>
                <Button variant="ghost" size="sm" icon={<ChevronRight size={14} />} disabled={page >= pages} onClick={() => setOffset(offset + PAGE)}>Weiter</Button>
              </span>
            </div>
          </CardBody>
        </Card>
      )}

      {/* ─── Nexora Published Detections (aus UCD-Publish) ──────────────────── */}
      <div style={{ marginTop: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <BookOpen size={16} style={{ color: 'var(--accent)' }} />
          <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>
            Nexora Published Detections
          </span>
          <Badge tone="accent">{publishedTotal}</Badge>
          <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 4 }}>
            — Snapshots aus dem Use-Case-Developer (nach Publish)
          </span>
        </div>

        {publishedLoading ? (
          <Card><CardBody><Spinner label="Nexora Detections werden geladen …" /></CardBody></Card>
        ) : !publishedDetections || publishedDetections.length === 0 ? (
          <Card>
            <CardBody>
              <EmptyState
                icon={<BookOpen size={26} />}
                title="Noch keine Published Detections"
                message="Sobald ein Use-Case-Draft den Lifecycle draft → review → approve → publish durchläuft, erscheint hier ein Detection-Library-Eintrag."
              />
            </CardBody>
          </Card>
        ) : (
          <Card>
            <CardBody style={{ padding: 0 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Title', 'Language', 'Severity', 'MITRE', 'Source', 'Rule-Vorschau'].map((h) => (
                      <th key={h} style={TH}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {publishedDetections.map((pd) => (
                    <tr key={pd.id} style={{ transition: 'background 150ms' }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = 'var(--bg-hover, rgba(255,255,255,0.03))'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = 'transparent'; }}>
                      <td style={{ ...TD, fontWeight: 600, maxWidth: 220 }}>
                        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {pd.title || '—'}
                        </span>
                        <span style={{ fontSize: 10.5, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                          {pd.publishedBy}
                        </span>
                      </td>
                      <td style={TD}>
                        <Badge tone={PUB_LANG_TONE[pd.language] ?? 'muted'}>{pd.language}</Badge>
                      </td>
                      <td style={TD}>
                        <Badge tone={SEV_TONE[pd.severity] ?? 'muted'}>{pd.severity}</Badge>
                      </td>
                      <td style={TD}>
                        <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {pd.mitre.slice(0, 3).map((m) => (
                            <Badge key={m.technique} tone="accent">{m.technique}</Badge>
                          ))}
                          {pd.mitre.length > 3 && <Badge tone="muted">+{pd.mitre.length - 3}</Badge>}
                          {pd.mitre.length === 0 && <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>—</span>}
                        </span>
                      </td>
                      <td style={{ ...TD, fontSize: 11, color: 'var(--text-dim)' }}>
                        {pd.sourceType && <span>{pd.sourceType}{pd.sourceId ? `: ${pd.sourceId}` : ''}</span>}
                      </td>
                      <td style={{ ...TD, maxWidth: 300 }}>
                        {pd.rule ? (
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                            <Code size={12} style={{ color: 'var(--text-dim)', flexShrink: 0, marginTop: 2 }} />
                            <code style={{
                              fontSize: 10.5,
                              fontFamily: 'var(--font-mono)',
                              color: 'var(--accent)',
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-all',
                            }}>
                              {pd.rule.length > 120 ? `${pd.rule.slice(0, 120)}…` : pd.rule}
                            </code>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {publishedTotal > 100 && (
                <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border-soft)', fontSize: 11, color: 'var(--text-dim)' }}>
                  {publishedTotal} Einträge total · nur erste 100 angezeigt
                </div>
              )}
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}

const SUBLABEL: CSSProperties = { fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 };
const INPUT: CSSProperties = { width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '7px 10px', fontSize: 13, outline: 'none', boxSizing: 'border-box' };
const TH: CSSProperties = { textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-dim)', padding: '8px 10px', fontWeight: 700, borderBottom: '1px solid var(--border-soft)' };
const TD: CSSProperties = { padding: '7px 10px', fontSize: 12.5, color: 'var(--text)', borderBottom: '1px solid var(--border-soft)', verticalAlign: 'top' };

const PUB_LANG_TONE: Record<string, Tone> = {
  wazuh: 'accent', sigma: 'success', splunk: 'warning', qradar: 'danger', generic: 'muted',
};
const SEV_TONE: Record<string, Tone> = {
  critical: 'danger', high: 'danger', medium: 'warning', low: 'muted',
};
