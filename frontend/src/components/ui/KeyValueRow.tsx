import type { ReactNode } from 'react';

interface KeyValueRowProps {
  label: ReactNode;
  value: ReactNode;
  /** Untere Trennlinie + Padding (Standard). */
  bordered?: boolean;
  /** Kompakter (12.5px, gedimmtes Label) — z. B. Detail-Listen. */
  dense?: boolean;
}

/** Label/Wert-Zeile (Space-between). Ersetzt frühere lokale InfoRow/DRow-Helfer. */
export function KeyValueRow({ label, value, bordered = false, dense = false }: KeyValueRowProps) {
  return (
    <div className={`kv-row ${bordered ? 'bordered' : ''} ${dense ? 'dense' : ''}`}>
      <span className="kv-label">{label}</span>
      <span className="kv-value">{value}</span>
    </div>
  );
}
