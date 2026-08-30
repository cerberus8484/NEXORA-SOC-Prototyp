import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResponseActionsPanel } from './ResponseActionsPanel';
import type { HuntResponseAction } from '../../lib/types';

function action(over: Partial<HuntResponseAction> = {}): HuntResponseAction {
  return {
    id: 'a1', huntSessionId: 's1', targetHost: '10.0.10.80',
    kind: 'isolate_host', command: '', reason: '', riskTier: 'containment',
    status: 'approved',
    requestedBy: 'analyst-1', requestedAt: '2026-07-04T10:00:00.000Z',
    approvedBy: 'admin-1', approvedAt: '2026-07-04T10:05:00.000Z',
    authorizationBasis: 'Notfall-Freigabe', rejectionReason: '', note: '',
    ...over,
  };
}

const decideNoop = { onRequest: vi.fn(), onApprove: vi.fn(), onReject: vi.fn() };
const base = { canRequest: false, canApprove: false, currentUserId: 'admin-1', circuitOpen: false, onResetCircuit: vi.fn(), ...decideNoop };

describe('ResponseActionsPanel — Execute (ADR-042 Stufe 3, menschlich ausgelöst + Reauth)', () => {
  it('genehmigte Containment-Aktion: Execute-Button + Reauth-Feld; onExecute mit (id, Passwort)', async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn().mockResolvedValue(undefined);
    render(<ResponseActionsPanel actions={[action()]} canExecute onExecute={onExecute} {...base} />);

    await user.type(screen.getByLabelText(/reauth|passwort/i), 'geheim123');
    await user.click(screen.getByRole('button', { name: /ausführen/i }));
    expect(onExecute).toHaveBeenCalledWith('a1', 'geheim123');
  });

  it('Drei-Parteien: eigene Anfrage → kein Execute (Ausführender ≠ Anforderer)', () => {
    render(<ResponseActionsPanel actions={[action({ requestedBy: 'admin-1' })]}
      canExecute onExecute={vi.fn()} {...base} />);
    expect(screen.queryByRole('button', { name: /ausführen/i })).not.toBeInTheDocument();
  });

  it('ohne canExecute (nicht-Admin) → kein Execute-Button', () => {
    render(<ResponseActionsPanel actions={[action()]} canExecute={false} onExecute={vi.fn()} {...base} />);
    expect(screen.queryByRole('button', { name: /ausführen/i })).not.toBeInTheDocument();
  });

  it('genehmigter privileged_command → kein Execute (nicht umkehrbar, kein Real-Exec)', () => {
    render(<ResponseActionsPanel actions={[action({ kind: 'privileged_command', command: 'net user', riskTier: 'privileged' })]}
      canExecute onExecute={vi.fn()} {...base} />);
    expect(screen.queryByRole('button', { name: /ausführen/i })).not.toBeInTheDocument();
  });

  it('Execute-Button ist ohne Passwort deaktiviert (frische Reauth erzwungen)', () => {
    render(<ResponseActionsPanel actions={[action()]} canExecute onExecute={vi.fn()} {...base} />);
    expect(screen.getByRole('button', { name: /ausführen/i })).toBeDisabled();
  });

  it('offener Circuit (Admin) → Warnbanner + Entsperren-Button; onResetCircuit wird gerufen', async () => {
    const user = userEvent.setup();
    const onResetCircuit = vi.fn().mockResolvedValue(undefined);
    render(<ResponseActionsPanel actions={[]} canExecute onExecute={vi.fn()} {...base} circuitOpen onResetCircuit={onResetCircuit} />);
    expect(screen.getByText(/kanal gesperrt/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /entsperren/i }));
    expect(onResetCircuit).toHaveBeenCalled();
  });

  it('geschlossener Circuit → kein Warnbanner', () => {
    render(<ResponseActionsPanel actions={[]} canExecute onExecute={vi.fn()} {...base} circuitOpen={false} />);
    expect(screen.queryByText(/kanal gesperrt/i)).not.toBeInTheDocument();
  });
});
