import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

interface AccordionProps {
  title: string;
  icon?: ReactNode;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function Accordion({ title, icon, badge, defaultOpen = false, children }: AccordionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="accordion">
      <button className="acc-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {icon && <span style={{ color: 'var(--accent)', display: 'inline-flex' }}>{icon}</span>}
        <span className="acc-title">{title}</span>
        {badge}
        <ChevronDown size={16} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s ease', color: 'var(--text-dim)' }} />
      </button>
      {open && <div className="acc-body">{children}</div>}
    </div>
  );
}
