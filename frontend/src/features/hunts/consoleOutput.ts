import type { HuntLog } from '../../lib/types';

// Formatiert Hunt-Logs zu nummerierten Console-Zeilen für die Vollansicht.
// Reine Logik (kein DOM) → testbar. Zeilennummern werden hier NICHT erzeugt
// (das macht CSS counter im Renderer), aber wir liefern die fertige Textzeile.

export interface ConsoleLine {
  id: string;
  time: string;
  level: HuntLog['level'];
  text: string;
}

function hhmmss(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString('de-DE', { hour12: false });
}

// Wandelt Logs in Console-Zeilen um (für die Vollansicht: alle Zeilen, keine Begrenzung).
export function toConsoleLines(logs: ReadonlyArray<HuntLog>): ConsoleLine[] {
  return logs.map((l) => ({
    id: l.id,
    time: hhmmss(l.timestamp),
    level: l.level,
    text: `[${hhmmss(l.timestamp)}] [${l.level.toUpperCase()}] ${l.message}`,
  }));
}

// Plain-Text-Repräsentation des gesamten Outputs (eine Zeile pro Log).
export function toPlainText(logs: ReadonlyArray<HuntLog>): string {
  return toConsoleLines(logs).map((c) => c.text).join('\n');
}
