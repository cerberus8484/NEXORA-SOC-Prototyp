import type { InputHTMLAttributes, TextareaHTMLAttributes, ReactNode } from 'react';

interface FieldProps {
  label?: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
}

export function Field({ label, children, hint }: FieldProps) {
  // <label> umschließt das Control → implizite Label↔Input-Verknüpfung (A11y).
  return (
    <label className="field">
      {label && <span className="field-label">{label}</span>}
      {children}
      {hint && <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{hint}</span>}
    </label>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
}
export function Input({ mono = false, className = '', ...rest }: InputProps) {
  return <input className={`input ${mono ? 'input-mono' : ''} ${className}`} {...rest} />;
}

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;
export function Textarea({ className = '', ...rest }: TextareaProps) {
  return <textarea className={`textarea ${className}`} {...rest} />;
}
