import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotesTabView } from './NotesTabView';

// P_TRUST_1 — Speicherfehler dürfen NICHT verschluckt werden (kein Fake-Erfolg).
const base = {
  notes: '', currentUser: 'Analyst', onAddNote: () => {},
  analystState: { checklist: [], playbook: {} },
  onSaveAnalystState: () => {},
};

describe('NotesTabView', () => {
  it('zeigt KEINEN Fehler, solange saveError leer ist', () => {
    render(<NotesTabView {...base} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('macht einen Speicherfehler sichtbar (role=alert) — kein stiller catch', () => {
    render(<NotesTabView {...base} saveError="Netzwerkfehler 500" />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Netzwerkfehler 500');
    expect(alert).toHaveTextContent(/nicht gespeichert/i);
  });

  it('„Save Note" hängt die Notiz als Block an und ruft onAddNote', async () => {
    const user = userEvent.setup();
    const onAddNote = vi.fn();
    render(<NotesTabView {...base} onAddNote={onAddNote} />);
    await user.type(screen.getByPlaceholderText(/Notiz hier eingeben/i), 'Neue Beobachtung');
    await user.click(screen.getByRole('button', { name: /Save Note/i }));
    expect(onAddNote).toHaveBeenCalledTimes(1);
    expect(onAddNote.mock.calls[0][0]).toContain('Neue Beobachtung');
    expect(onAddNote.mock.calls[0][0]).toContain('--- NOTE | investigation |');
  });

  it('rendert vorhandene Notizen als Timeline (aus dem notes-Feld geparst)', () => {
    const raw = '--- NOTE | triage | Alex | 2025-05-02T09:57:00Z | phishing ---\nErsttriage erledigt.';
    render(<NotesTabView {...base} notes={raw} />);
    expect(screen.getByText('Notes Timeline')).toBeInTheDocument();
    expect(screen.getAllByText(/Ersttriage erledigt/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Alex').length).toBeGreaterThan(0);
  });
});
