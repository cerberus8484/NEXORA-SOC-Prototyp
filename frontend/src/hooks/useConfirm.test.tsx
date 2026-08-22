import { useRef } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useConfirm } from './useConfirm';
import { useFocusTrap } from './useFocusTrap';

// Test-Harness: ruft confirm() und schreibt das aufgelöste Ergebnis in ein data-Attribut.
function Harness() {
  const { confirm, confirmDialog } = useConfirm();
  return (
    <div>
      <button
        onClick={async () => {
          const result = await confirm({
            title: 'Ticket löschen',
            message: 'Diese Aktion kann nicht rückgängig gemacht werden.',
            confirmLabel: 'Löschen',
            danger: true,
          });
          document.body.setAttribute('data-result', String(result));
        }}
      >
        open
      </button>
      {confirmDialog}
    </div>
  );
}

describe('useConfirm', () => {
  it('zeigt erst nach Aufruf den Dialog mit Titel und Nachricht', () => {
    render(<Harness />);
    expect(screen.queryByRole('alertdialog')).toBeNull();

    fireEvent.click(screen.getByText('open'));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toBeTruthy();
    expect(screen.getByText('Ticket löschen')).toBeTruthy();
    expect(screen.getByText('Diese Aktion kann nicht rückgängig gemacht werden.')).toBeTruthy();
  });

  it('löst mit true auf und schließt bei Bestätigung', async () => {
    document.body.removeAttribute('data-result');
    render(<Harness />);
    fireEvent.click(screen.getByText('open'));

    fireEvent.click(screen.getByText('Löschen'));

    await waitFor(() => expect(document.body.getAttribute('data-result')).toBe('true'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('löst mit false auf bei Abbruch', async () => {
    document.body.removeAttribute('data-result');
    render(<Harness />);
    fireEvent.click(screen.getByText('open'));

    fireEvent.click(screen.getByText('Abbrechen'));

    await waitFor(() => expect(document.body.getAttribute('data-result')).toBe('false'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('löst mit false auf bei ESC', async () => {
    document.body.removeAttribute('data-result');
    render(<Harness />);
    fireEvent.click(screen.getByText('open'));

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(document.body.getAttribute('data-result')).toBe('false'));
  });

  it('löst ein offenes Promise mit false auf, wenn die Komponente unmountet', async () => {
    document.body.removeAttribute('data-result');
    const { unmount } = render(<Harness />);
    fireEvent.click(screen.getByText('open'));
    expect(screen.getByRole('alertdialog')).toBeTruthy();

    unmount(); // kein hängendes await — Cleanup muss das Promise mit false auflösen

    await waitFor(() => expect(document.body.getAttribute('data-result')).toBe('false'));
  });
});

// Verschachtelte Fokus-Traps: ESC darf nur den obersten (zuletzt geöffneten) schliessen,
// nicht zusätzlich das Eltern-Modal (Regression aus dem ConfirmDialog-im-Modal-Fall).
describe('useFocusTrap — verschachtelt', () => {
  function Trap({ onClose }: { onClose: () => void }) {
    const ref = useRef<HTMLDivElement>(null);
    useFocusTrap(ref, true, onClose);
    return <div ref={ref}><button>x</button></div>;
  }

  it('nur der zuletzt geöffnete Trap reagiert auf ESC', () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    render(<><Trap onClose={outerClose} /><Trap onClose={innerClose} /></>);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();
  });
});

// Async-Action-Modus: Dialog bleibt offen+busy während der Aktion, Fehler inline.
describe('useConfirm — Async-Action-Modus', () => {
  function ActionHarness({ action }: { action: () => Promise<void> }) {
    const { confirm, confirmDialog } = useConfirm();
    return (
      <div>
        <button onClick={async () => {
          const r = await confirm({ title: 'Aktion', message: 'Sicher?', confirmLabel: 'Los', danger: true, action });
          document.body.setAttribute('data-result', String(r));
        }}>open</button>
        {confirmDialog}
      </div>
    );
  }

  it('Erfolg: Aktion läuft, Dialog schließt, Promise löst true', async () => {
    document.body.removeAttribute('data-result');
    const action = vi.fn().mockResolvedValue(undefined);
    render(<ActionHarness action={action} />);
    fireEvent.click(screen.getByText('open'));
    fireEvent.click(screen.getByText('Los'));

    await waitFor(() => expect(document.body.getAttribute('data-result')).toBe('true'));
    expect(action).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('Fehler: Dialog bleibt offen + zeigt Fehler, Promise bleibt pending', async () => {
    document.body.removeAttribute('data-result');
    const action = vi.fn().mockRejectedValue(new Error('Server kaputt'));
    render(<ActionHarness action={action} />);
    fireEvent.click(screen.getByText('open'));
    fireEvent.click(screen.getByText('Los'));

    await waitFor(() => expect(screen.getByText('Server kaputt')).toBeTruthy());
    expect(screen.getByRole('alertdialog')).toBeTruthy();        // Dialog noch offen
    expect(document.body.getAttribute('data-result')).toBeNull(); // nicht aufgelöst
  });
});
