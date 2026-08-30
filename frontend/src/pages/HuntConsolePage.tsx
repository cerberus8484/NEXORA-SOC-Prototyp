import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, X } from 'lucide-react';
import { huntApi, type HuntNote } from '../features/hunts/huntApi';
import { HuntConsole } from '../features/hunts/HuntConsole';
import { HuntSessionList } from '../features/hunts/HuntSessionList';
import type { HuntSession, HuntCommand, HuntArtifact, HuntFinding, HuntTicketLink } from '../lib/types';
import { SectionHeader, Spinner, ErrorCard, Button } from '../components/ui';
import { can } from '../lib/rbac';
import { useAuth } from '../lib/auth';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';

export function HuntConsolePage() {
  const { t: tr } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [sessions, setSessions] = useState<HuntSession[]>([]);
  const [session, setSession] = useState<HuntSession | null>(null);
  const [commands, setCommands] = useState<HuntCommand[]>([]);
  const [artifacts, setArtifacts] = useState<HuntArtifact[]>([]);
  const [findings, setFindings] = useState<HuntFinding[]>([]);
  const [links, setLinks] = useState<HuntTicketLink[]>([]);
  const [notes, setNotes] = useState<HuntNote[]>([]);
  const [error, setError] = useState('');

  // Neuer-Hunt-Modal-State
  const [showNewModal, setShowNewModal] = useState(false);
  const [newHostInput, setNewHostInput] = useState('');
  const [newHostError, setNewHostError] = useState('');
  const [newHostBusy, setNewHostBusy] = useState(false);
  const newHostInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [list, s, c, a, f, l, n] = await Promise.all([
        huntApi.listSessions(),
        huntApi.getSession(id), huntApi.commands(id), huntApi.artifacts(id),
        huntApi.findings(id), huntApi.ticketLinks(id), huntApi.getNotes(id),
      ]);
      setSessions(list.data ?? []);
      setSession(s.data);
      setCommands(c.data ?? []);
      setArtifacts(a.data ?? []);
      setFindings(f.data ?? []);
      setLinks(l.data ?? []);
      setNotes(n.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : i18n.t('ui.sessionNotFound'));
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function handleStart() {
    if (!id) return;
    try { await huntApi.start(id); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : tr('common.startFailed')); }
  }

  async function handleRun(command: string) {
    if (!id) return;
    await huntApi.runCommand(id, command);
    await load();
  }

  async function handleComplete() {
    if (!id) return;
    try { await huntApi.complete(id); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : tr('ui.completionFailed')); }
  }

  async function handleAddFinding(body: { title: string; severity: string; description?: string; mitreAttack?: string }) {
    if (!id) return;
    await huntApi.addFinding(id, body);
    await load();
  }

  async function handleAddArtifact(body: { type: string; value: string; description?: string }) {
    if (!id) return;
    await huntApi.addArtifact(id, body);
    await load();
  }

  async function handleSaveNotes(content: string) {
    if (!id) return;
    await huntApi.saveNotes(id, content);
    await load(); // append-only: die neue Notiz erscheint nach dem Reload
  }

  function openNewModal() {
    if (!can.act(user?.role)) return;
    setNewHostInput('');
    setNewHostError('');
    setNewHostBusy(false);
    setShowNewModal(true);
    // Fokus nach Render-Zyklus setzen
    setTimeout(() => newHostInputRef.current?.focus(), 50);
  }

  function closeNewModal() {
    setShowNewModal(false);
    setNewHostInput('');
    setNewHostError('');
  }

  async function handleNewConfirm() {
    const host = newHostInput.trim();
    if (!host) {
      setNewHostError(tr('ui.targetHostMustNotEmpty'));
      newHostInputRef.current?.focus();
      return;
    }
    setNewHostBusy(true);
    setNewHostError('');
    try {
      const res = await huntApi.createSession({ targetHost: host });
      closeNewModal();
      navigate(`/threat-hunts/${res.data.id}`);
    } catch (err) {
      setNewHostError(err instanceof Error ? err.message : tr('common.createFailed'));
      setNewHostBusy(false);
    }
  }

  function handleNewKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { void handleNewConfirm(); }
    if (e.key === 'Escape') { closeNewModal(); }
  }

  if (error && !session) return <ErrorCard message={error} />;
  if (!session) return <Spinner label={tr('ui.loadingHuntSession')} />;

  return (
    <div>
      <SectionHeader
        title={`Hunt — ${session.targetHost}`}
        help="hunts"
        subtitle="Hunt Console"
        actions={<Button variant="ghost" icon={<ArrowLeft size={15} />} onClick={() => navigate('/threat-hunts')}>{tr('common.back')}</Button>}
      />
      {error && <div style={{ marginBottom: 16 }}><ErrorCard message={error} /></div>}

      {/* Neue Hunt-Session Modal */}
      {showNewModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-hunt-modal-title"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onKeyDown={(e) => { if (e.key === 'Escape') closeNewModal(); }}
        >
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius)', width: '100%', maxWidth: 420 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border-soft)' }}>
              <span id="new-hunt-modal-title" style={{ fontWeight: 700, fontSize: 14 }}>{tr('label.newHuntSession')}</span>
              <button type="button" aria-label={tr('common.close')} onClick={closeNewModal} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 4 }}>
                <X size={16} />
              </button>
            </div>
            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label htmlFor="new-hunt-host" style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 4 }}>{tr('hunts.targetHostRequired')}</label>
                <input
                  id="new-hunt-host"
                  ref={newHostInputRef}
                  type="text"
                  value={newHostInput}
                  onChange={(e) => setNewHostInput(e.target.value)}
                  onKeyDown={handleNewKeyDown}
                  placeholder={tr('app.eG109999')}
                  style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '7px 10px', fontSize: 13, boxSizing: 'border-box' }}
                />
              </div>
              {newHostError && (
                <div style={{ fontSize: 12, color: 'var(--danger)', padding: '6px 10px', background: 'rgba(220,38,38,0.08)', borderRadius: 4 }}>
                  {newHostError}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4 }}>
                <Button variant="ghost" onClick={closeNewModal}>{tr('common.cancel2')}</Button>
                <Button variant="primary" onClick={() => void handleNewConfirm()} disabled={newHostBusy}>
                  {newHostBusy ? tr('common.creatingShort') : tr('common.create')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 20, alignItems: 'start' }}>
        <HuntSessionList
          sessions={sessions}
          activeId={id}
          onSelect={(sid) => navigate(`/threat-hunts/${sid}`)}
          onNew={openNewModal}
          canCreate={can.act(user?.role)}
        />
        <HuntConsole
          session={session}
          commands={commands}
          artifacts={artifacts}
          findings={findings}
          ticketLinks={links}
          notes={notes}
          canAct={can.act(user?.role)}
          onStart={handleStart}
          onComplete={handleComplete}
          onRunCommand={handleRun}
          onAddFinding={handleAddFinding}
          onAddArtifact={handleAddArtifact}
          onSaveNotes={handleSaveNotes}
        />
      </div>
    </div>
  );
}
