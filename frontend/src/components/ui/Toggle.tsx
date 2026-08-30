interface ToggleProps {
  checked: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
}

/** Reiner UI-Schalter (lokaler State). Persistiert nichts — kein Backend. */
export function Toggle({ checked, onChange, disabled, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      style={{
        width: 40, height: 22, borderRadius: 999, padding: 2, flexShrink: 0,
        // OFF-Track muss auch auf hellem Card-/Panel-Grund klar sichtbar sein (nicht Weiß-auf-Weiß):
        // gedecktes Grau = „aus", Akzent = „an". Rand gibt zusätzliche Kontur.
        border: '1px solid', borderColor: checked ? 'var(--accent)' : 'var(--text-dim)', boxSizing: 'border-box',
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: checked ? 'var(--accent)' : 'var(--text-dim)',
        opacity: disabled ? 0.5 : 1, transition: 'background .15s ease, border-color .15s ease',
        display: 'inline-flex', alignItems: 'center',
      }}
    >
      <span style={{
        width: 16, height: 16, borderRadius: '50%', background: '#fff',
        boxShadow: '0 1px 2px rgba(20,38,66,0.35)',
        transform: checked ? 'translateX(18px)' : 'translateX(0)', transition: 'transform .15s ease',
      }} />
    </button>
  );
}
