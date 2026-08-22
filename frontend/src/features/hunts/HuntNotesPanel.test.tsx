import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HuntNotesPanel } from './HuntNotesPanel';
import type { HuntNote } from './huntApi';

const notes: HuntNote[] = [
  { id: 'n1', content: 'Erste Beobachtung', createdAt: '2026-06-20T10:00:00.000Z' },
  { id: 'n2', content: 'Zweite Notiz', createdAt: '2026-06-20T11:00:00.000Z' },
];

describe('HuntNotesPanel (P_TRUST_1 A3)', () => {
  it('rendert Notiz-Inhalte lesbar — KEIN [object Object]', () => {
    render(<HuntNotesPanel notes={notes} canAct onAdd={vi.fn()} />);
    expect(screen.getByText('Erste Beobachtung')).toBeInTheDocument();
    expect(screen.getByText('Zweite Notiz')).toBeInTheDocument();
    expect(screen.queryByText(/\[object Object\]/)).not.toBeInTheDocument();
  });

  it('leere Liste → klarer Hinweis', () => {
    render(<HuntNotesPanel notes={[]} canAct onAdd={vi.fn()} />);
    expect(screen.getByText(/keine notizen/i)).toBeInTheDocument();
  });

  it('„Notiz hinzufügen" postet den Entwurf', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<HuntNotesPanel notes={[]} canAct onAdd={onAdd} />);
    fireEvent.change(screen.getByLabelText('Neue Notiz'), { target: { value: 'Neue Hypothese' } });
    fireEvent.click(screen.getByRole('button', { name: /notiz hinzufügen/i }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('Neue Hypothese'));
  });

  it('viewer (canAct=false) sieht KEIN Eingabefeld', () => {
    render(<HuntNotesPanel notes={notes} canAct={false} onAdd={vi.fn()} />);
    expect(screen.queryByLabelText('Neue Notiz')).not.toBeInTheDocument();
  });
});
