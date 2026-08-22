import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';

interface EmptyStateProps {
  title?: string;
  message?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title = 'Noch keine Daten verfügbar', message, icon, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <span className="es-icon">{icon ?? <Inbox size={28} />}</span>
      <span className="es-title">{title}</span>
      {message && <span style={{ fontSize: 13 }}>{message}</span>}
      {action}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-dim)', padding: 24, fontSize: 13 }}>
      <span className="spinner" />
      {label ?? 'Lädt …'}
    </div>
  );
}

export function ErrorCard({ message }: { message: string }) {
  return (
    <div className="card card-pad" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
      {message}
    </div>
  );
}
