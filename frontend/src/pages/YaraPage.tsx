import { useEffect, useState, type CSSProperties } from 'react';
import { useConfirm } from '../hooks/useConfirm';
import { ShieldAlert, Plus, Play, Trash2, ToggleLeft, ToggleRight, ChevronDown, ChevronRight } from 'lucide-react';
import { SectionHeader, Card, CardBody, Badge, Button, EmptyState, Spinner, ErrorCard, type Tone } from '../components/ui';
import { yaraApi, type YaraRule, type ScanMatch } from '../features/yara/yaraApi';
import { can } from '../lib/rbac';
import { useAuth } from '../lib/auth';
import { onActivateKey } from '../lib/a11y';

const s: Record<string, CSSProperties> = {
  page:    { padding: '24px 28px' },
  grid:    { display: 'grid', gridTemplateColumns: '1fr 420px', gap: 20, alignItems: 'start' },
  row:     { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--border-soft)', cursor: 'pointer' },
  name:    { flex: 1, fontSize: 13.5, fontWeight: 600, color: 'var(--text)' },
  dim:     { fontSize: 11.5, color: 'var(--text-dim)' },
  input:   { width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '7px 10px', fontSize: 13, boxSizing: 'border-box' as const },
  textarea:{ width: '100%', minHeight: 120, background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '8px 10px', fontSize: 12.5, fontFamily: 'var(--font-mono)', resize: 'vertical' as const, boxSizing: 'border-box' as const },
  label:   { fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 4 },
  hit:     { fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--warning)', padding: '2px 0' },
};

const sevTone = (s: string): Tone => s === 'critical' || s === 'high' ? 'danger' : s === 'medium' ? 'warning' : 'muted';

export function YaraPage() {
  const { user } = useAuth();
  const canAct = can.act(user?.role);
  const isAdmin = user?.role === 'admin';

  const [rules, setRules] = useState<YaraRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  // Scan
  const [scanInput, setScanInput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ matches: ScanMatch[]; scannedRules: number } | null>(null);
  const [scanError, setScanError] = useState('');

  // New rule form
  const [showForm, setShowForm] = useState(false);
  const [fName, setFName] = useState('');
  const [fDesc, setFDesc] = useState('');
  const [fSev, setFSev] = useState('medium');
  const [fMitre, setFMitre] = useState('');
  const [fTags, setFTags] = useState('');
  const [fPatternVal, setFPatternVal] = useState('');
  const [fPatternType, setFPatternType] = useState<'text' | 'regex' | 'hex'>('text');
  const [fCondition, setFCondition] = useState('any');
  const [fNocase, setFNocase] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = () => {
    setLoading(true);
    yaraApi.list()
      .then((r) => setRules(r.data ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : 'Laden fehlgeschlagen'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  async function handleScan() {
    if (!scanInput.trim()) return;
    setScanning(true); setScanError(''); setScanResult(null);
    try {
      const r = await yaraApi.scan(scanInput.trim());
      setScanResult(r.data);
    } catch (e) { setScanError(e instanceof Error ? e.message : 'Scan fehlgeschlagen'); }
    finally { setScanning(false); }
  }

  async function handleToggle(rule: YaraRule) {
    setActionError('');
    try { await yaraApi.update(rule.id, { enabled: !rule.enabled }); load(); }
    catch (e) { setActionError(e instanceof Error ? e.message : 'Regel konnte nicht aktualisiert werden'); }
  }

  async function handleDelete(id: string) {
    setActionError('');
    if (!(await confirm({
      title: 'YARA-Regel löschen?',
      message: 'Diese Aktion kann nicht rückgängig gemacht werden.',
      confirmLabel: 'Löschen',
      danger: true,
    }))) return;
    try { await yaraApi.delete(id); load(); }
    catch (e) { setActionError(e instanceof Error ? e.message : 'Regel konnte nicht gelöscht werden'); }
  }

  async function handleCreate() {
    if (!fName.trim() || !fPatternVal.trim()) { setFormError('Name und Pattern sind Pflicht'); return; }
    setSaving(true); setFormError('');
    try {
      await yaraApi.create({
        name: fName.trim(), description: fDesc.trim(), severity: fSev,
        mitreAttack: fMitre.trim(),
        tags: fTags.split(',').map((t) => t.trim()).filter(Boolean),
        patterns: [{ id: crypto.randomUUID(), type: fPatternType, value: fPatternVal.trim(), modifiers: fNocase ? ['nocase'] : [] }],
        condition: fCondition,
      });
      setShowForm(false); setFName(''); setFDesc(''); setFPatternVal(''); setFMitre(''); setFTags('');
      load();
    } catch (e) { setFormError(e instanceof Error ? e.message : 'Fehler'); }
    finally { setSaving(false); }
  }

  if (loading) return <div style={s.page}><Spinner /></div>;
  // Nur der initiale Ladefehler ersetzt die ganze Seite — Aktion-Fehler werden inline angezeigt.
  if (error && rules.length === 0) return <div style={s.page}><ErrorCard message={error} /></div>;

  const active = rules.filter((r) => r.enabled).length;

  return (
    <div style={s.page}>
      <SectionHeader
        title="YARA Engine"
        subtitle="Pattern-Matching-Regeln für Logs, Payloads und Artefakte"
        help="yara"
        actions={canAct && <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setShowForm((v) => !v)}>Neue Regel</Button>}
      />

      {/* Lösch-Bestätigung — zentrale ConfirmDialog via useConfirm */}
      {confirmDialog}

      {/* Inline-Fehler für Toggle/Delete — Seite bleibt erhalten */}
      {actionError && (
        <div style={{ marginBottom: 12, padding: '8px 12px', background: 'color-mix(in srgb, var(--danger) 12%, transparent)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-sm)', fontSize: 12.5, color: 'var(--danger)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span>{actionError}</span>
          <button onClick={() => setActionError('')} style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: 2 }}><Plus size={14} style={{ transform: 'rotate(45deg)' }} /></button>
        </div>
      )}

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        {[['Regeln gesamt', rules.length, 'var(--text)'], ['Aktiv', active, 'var(--accent)'], ['Inaktiv', rules.length - active, 'var(--text-dim)']].map(([l, v, c]) => (
          <div key={String(l)} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)', padding: '12px 18px', minWidth: 110 }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: String(c) }}>{String(v)}</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{String(l)}</div>
          </div>
        ))}
      </div>

      <div style={s.grid}>
        {/* ── Regelliste ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Neue Regel Form */}
          {showForm && (
            <Card>
              <CardBody>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: 'var(--text)' }}>Neue Regel</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div><div style={s.label}>Name *</div><input style={s.input} value={fName} onChange={(e) => setFName(e.target.value)} placeholder="detect_mimikatz" /></div>
                  <div><div style={s.label}>Beschreibung</div><input style={s.input} value={fDesc} onChange={(e) => setFDesc(e.target.value)} placeholder="Optional" /></div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                    <div><div style={s.label}>Severity</div>
                      <select style={s.input} value={fSev} onChange={(e) => setFSev(e.target.value)}>
                        {['critical','high','medium','low','info'].map((s) => <option key={s}>{s}</option>)}
                      </select>
                    </div>
                    <div><div style={s.label}>Condition</div>
                      <select style={s.input} value={fCondition} onChange={(e) => setFCondition(e.target.value)}>
                        <option value="any">any</option><option value="all">all</option>
                      </select>
                    </div>
                    <div><div style={s.label}>MITRE</div><input style={s.input} value={fMitre} onChange={(e) => setFMitre(e.target.value)} placeholder="T1059" /></div>
                  </div>
                  <div><div style={s.label}>Tags (kommagetrennt)</div><input style={s.input} value={fTags} onChange={(e) => setFTags(e.target.value)} placeholder="malware, credential" /></div>
                  <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8 }}>
                    <div><div style={s.label}>Pattern-Typ</div>
                      <select style={s.input} value={fPatternType} onChange={(e) => setFPatternType(e.target.value as 'text' | 'regex' | 'hex')}>
                        <option value="text">text</option><option value="regex">regex</option><option value="hex">hex</option>
                      </select>
                    </div>
                    <div><div style={s.label}>Pattern *</div><input style={{ ...s.input, fontFamily: 'var(--font-mono)' }} value={fPatternVal} onChange={(e) => setFPatternVal(e.target.value)} placeholder={fPatternType === 'regex' ? '\\bpassword\\b' : fPatternType === 'hex' ? '4D 5A' : 'mimikatz'} /></div>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={fNocase} onChange={(e) => setFNocase(e.target.checked)} />
                    Groß-/Kleinschreibung ignorieren (nocase)
                  </label>
                  {formError && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{formError}</div>}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button variant="primary" onClick={() => void handleCreate()} disabled={saving}>{saving ? '…' : 'Speichern'}</Button>
                    <Button variant="ghost" onClick={() => setShowForm(false)}>Abbrechen</Button>
                  </div>
                </div>
              </CardBody>
            </Card>
          )}

          {rules.length === 0
            ? <EmptyState title="Keine Regeln" />
            : rules.map((rule) => (
              <Card key={rule.id}>
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={expanded === rule.id}
                  style={s.row}
                  onClick={() => setExpanded(expanded === rule.id ? null : rule.id)}
                  onKeyDown={onActivateKey(() => setExpanded(expanded === rule.id ? null : rule.id))}
                >
                  {expanded === rule.id ? <ChevronDown size={14} style={{ color: 'var(--text-dim)', flexShrink: 0 }} /> : <ChevronRight size={14} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />}
                  <span style={{ ...s.name, color: rule.enabled ? 'var(--text)' : 'var(--text-dim)' }}>{rule.name}</span>
                  {rule.mitreAttack && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>{rule.mitreAttack}</span>}
                  <Badge tone={sevTone(rule.severity)}>{rule.severity}</Badge>
                  <Badge tone={rule.enabled ? 'success' : 'muted'}>{rule.enabled ? 'aktiv' : 'inaktiv'}</Badge>
                  {canAct && <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', display: 'inline-flex' }} onClick={(e) => { e.stopPropagation(); void handleToggle(rule); }} title={rule.enabled ? 'Deaktivieren' : 'Aktivieren'}>
                    {rule.enabled ? <ToggleRight size={16} style={{ color: 'var(--accent)' }} /> : <ToggleLeft size={16} />}
                  </button>}
                  {isAdmin && <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', display: 'inline-flex' }} onClick={(e) => { e.stopPropagation(); void handleDelete(rule.id); }} title="Löschen">
                    <Trash2 size={14} />
                  </button>}
                </div>
                {expanded === rule.id && (
                  <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border-soft)', fontSize: 12.5 }}>
                    {rule.description && <div style={{ color: 'var(--text-muted)', marginBottom: 8 }}>{rule.description}</div>}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                      {rule.tags.map((t) => <Badge key={t} tone="muted">{t}</Badge>)}
                    </div>
                    <div style={{ color: 'var(--text-dim)', marginBottom: 6 }}>Condition: <strong style={{ color: 'var(--text)' }}>{JSON.stringify(rule.condition)}</strong> · {rule.patterns.length} Pattern(s)</div>
                    {rule.patterns.map((p) => (
                      <div key={p.id} style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--bg-terminal)', padding: '4px 8px', borderRadius: 4, marginBottom: 4, color: 'var(--success)' }}>
                        [{p.type}] {p.value}{p.modifiers.length ? ` (${p.modifiers.join(',')})` : ''}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            ))}
        </div>

        {/* ── Scan-Panel ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Card>
            <CardBody>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Play size={14} style={{ color: 'var(--accent)' }} /> Live-Scan
              </div>
              <div style={s.label}>Input (Log-Zeile, Payload, Commandline …)</div>
              <textarea style={{ ...s.textarea, marginBottom: 10 }} value={scanInput} onChange={(e) => setScanInput(e.target.value)} placeholder="cmd.exe /c powershell -enc ..." />
              <Button variant="primary" icon={<Play size={13} />} onClick={() => void handleScan()} disabled={!scanInput.trim() || scanning} style={{ width: '100%', justifyContent: 'center' }}>
                {scanning ? 'Scanne …' : `Gegen ${rules.filter(r => r.enabled).length} aktive Regeln scannen`}
              </Button>

              {scanError && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--danger)' }}>{scanError}</div>}

              {scanResult && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
                    {scanResult.scannedRules} Regel(n) geprüft — {scanResult.matches.length === 0
                      ? <span style={{ color: 'var(--success)' }}>✓ kein Match</span>
                      : <span style={{ color: 'var(--danger)' }}>⚠ {scanResult.matches.length} Treffer</span>}
                  </div>
                  {scanResult.matches.map((m) => (
                    <div key={m.ruleId} style={{ background: 'var(--bg-card-soft)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <ShieldAlert size={13} style={{ color: 'var(--danger)' }} />
                        <span style={{ fontWeight: 700, fontSize: 13 }}>{m.name}</span>
                        <Badge tone={sevTone(m.severity)}>{m.severity}</Badge>
                        {m.mitreAttack && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>{m.mitreAttack}</span>}
                      </div>
                      {m.hits.map((h, i) => (
                        // Statische Scan-Treffer; derselbe Pattern-Wert kann mehrfach auftreten → Index ist hier korrekt
                        // eslint-disable-next-line react/no-array-index-key
                        <div key={i} style={s.hit}>↳ Pattern: {h.value}</div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
