import type { CSSProperties, ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  style?: CSSProperties;
}

export function Card({ children, className = '', hover = false, style }: CardProps) {
  return (
    <div className={`card ${hover ? 'card-hover' : ''} ${className}`} style={style}>
      {children}
    </div>
  );
}

export function CardHeader({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  return (
    <div className="card-header">
      <span className="card-title">{title}</span>
      {actions}
    </div>
  );
}

export function CardBody({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div className="card-body" style={style}>{children}</div>;
}
