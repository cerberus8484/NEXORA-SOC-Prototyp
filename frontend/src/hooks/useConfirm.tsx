import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import i18n from '../i18n';

// useConfirm — imperativer Ersatz für window.confirm():
//   const { confirm, confirmDialog } = useConfirm();
//   if (!(await confirm({ title, message, danger: true }))) return;
//   {confirmDialog}  // einmal im JSX rendern
//
// confirm() liefert ein Promise<boolean> — true bei Bestätigung, false bei Abbruch/ESC/Backdrop.
//
// Async-Action-Modus: wird `action` übergeben, läuft sie NACH der Bestätigung,
// während der Dialog offen + busy bleibt. Wirft sie, wird der Fehler im Dialog
// gezeigt (Dialog bleibt offen, Promise bleibt pending bis Erfolg oder Abbruch).

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  action?: () => Promise<void>;
}

interface ConfirmState extends ConfirmOptions {
  open: boolean;
  busy: boolean;
  error: string;
}

const CLOSED: ConfirmState = { open: false, title: '', message: '', busy: false, error: '' };

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : i18n.t('tickets.errors.action');
}

export function useConfirm() {
  const [state, setState] = useState<ConfirmState>(CLOSED);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);
  const actionRef = useRef<(() => Promise<void>) | null>(null);
  const busyRef = useRef(false);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    actionRef.current = options.action ?? null;
    busyRef.current = false;
    setState({ ...options, open: true, busy: false, error: '' });
    return new Promise<boolean>((resolve) => { resolverRef.current = resolve; });
  }, []);

  const settle = useCallback((result: boolean): void => {
    actionRef.current = null;
    busyRef.current = false;
    setState((prev) => ({ ...prev, open: false, busy: false, error: '' }));
    const resolve = resolverRef.current;
    resolverRef.current = null;
    resolve?.(result);
  }, []);

  // Unmount mit offenem Dialog: ein noch wartendes confirm()-Promise würde sonst
  // ewig hängen (der await im Handler kommt nie zurück). Mit false auflösen.
  useEffect(() => () => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    resolve?.(false);
  }, []);

  const handleConfirm = useCallback(async () => {
    const action = actionRef.current;
    if (!action) { settle(true); return; } // einfacher Modus: sofort schließen
    busyRef.current = true;
    setState((prev) => ({ ...prev, busy: true, error: '' }));
    try {
      await action();
      settle(true);
    } catch (err) {
      busyRef.current = false;
      setState((prev) => ({ ...prev, busy: false, error: errorText(err) })); // Dialog offen lassen
    }
  }, [settle]);

  const handleCancel = useCallback(() => {
    if (busyRef.current) return; // läuft gerade eine Aktion → kein Abbruch
    settle(false);
  }, [settle]);

  // Memoisiert: stabile Element-Referenz, damit der Fokus-Trap in ConfirmDialog
  // nicht bei jedem Eltern-Render neu auf-/abgebaut wird (sonst Trap-Stack-Churn).
  const confirmDialog = useMemo<ReactElement>(() => (
    <ConfirmDialog
      open={state.open}
      title={state.title}
      message={state.message}
      confirmLabel={state.confirmLabel}
      cancelLabel={state.cancelLabel}
      danger={state.danger}
      busy={state.busy}
      error={state.error}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  ), [state, handleConfirm, handleCancel]);

  return { confirm, confirmDialog };
}
