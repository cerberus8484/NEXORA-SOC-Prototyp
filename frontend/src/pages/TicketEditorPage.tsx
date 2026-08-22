import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ticketApi } from '../features/tickets/ticketApi';
import { TicketEditor, type TicketForm, type TicketSaveData } from '../features/tickets/TicketEditor';
import { Spinner, ErrorCard } from '../components/ui';
import { can } from '../lib/rbac';
import { useAuth } from '../lib/auth';

export function TicketEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isNew = !id;

  const [initial, setInitial] = useState<TicketForm | null>(isNew ? {} : null);
  const [error, setError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isNew) return;
    if (!can.act(user?.role)) return; // kein Fetch für Rollen ohne Schreibrecht (Gate leitet eh um)
    let active = true;
    ticketApi.get(id!)
      .then((res) => { if (active) setInitial(res.data as unknown as TicketForm); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : 'Ticket nicht gefunden'); });
    return () => { active = false; };
  }, [id, isNew, user?.role]);

  // RBAC-Gate nach allen Hooks: Nur analyst+ darf Tickets anlegen oder bearbeiten.
  // Das Backend erzwingt dies ebenfalls — hier ist es Defense-in-Depth + ehrliche UX.
  if (!can.act(user?.role)) {
    return <Navigate to="/tickets" replace />;
  }

  async function handleSave(data: TicketSaveData) {
    setSaving(true);
    setError('');
    setSaveSuccess(false);
    try {
      if (isNew) {
        const res = await ticketApi.create(data);
        navigate(`/tickets/${res.data.id}`, { replace: true });
      } else {
        const res = await ticketApi.update(id!, data);
        setInitial(res.data as unknown as TicketForm);
        setSaveSuccess(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  }

  if (error && !initial) return <ErrorCard message={error} />;
  if (!initial) return <Spinner label="Ticket wird geladen …" />;

  return (
    <>
      {error && <div style={{ marginBottom: 16 }}><ErrorCard message={error} /></div>}
      {saveSuccess && (
        <div style={{ marginBottom: 16, padding: '10px 14px', background: 'rgba(0,255,136,0.08)', border: '1px solid var(--success)', borderRadius: 'var(--radius-sm)', fontSize: 13, color: 'var(--success)' }}>
          Ticket gespeichert.
        </div>
      )}
      <TicketEditor initial={initial} ticketId={isNew ? undefined : id} saving={saving} onSave={handleSave} />
    </>
  );
}
