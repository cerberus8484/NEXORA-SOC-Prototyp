import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from './Button';
import { HelpTip } from './HelpTip';
import type { WikiTopicKey } from '../../lib/wikiTopics';

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /** Wenn gesetzt: „Zurück"-Button links neben den Actions. Router-agnostisch (Caller navigiert). */
  onBack?: () => void;
  /** Wenn gesetzt: Erklär-Tooltip (Hinweis + „more"→Wiki) neben dem Titel. */
  help?: WikiTopicKey;
}

/** Seiten-Kopf mit Akzent-Strich (wie Referenz-Design). */
export function SectionHeader({ title, subtitle, actions, onBack, help }: SectionHeaderProps) {
  return (
    <div className="page-header">
      <div className="section-header">
        <span className="sh-accent" />
        <div>
          <h2 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {title}
            {help && <HelpTip topic={help} />}
          </h2>
          {subtitle && <div className="sh-sub">{subtitle}</div>}
        </div>
      </div>
      {(onBack || actions) && (
        <div className="page-actions">
          {onBack && (
            <Button variant="ghost" size="sm" icon={<ArrowLeft size={15} />} onClick={onBack}>Zurück</Button>
          )}
          {actions}
        </div>
      )}
    </div>
  );
}
