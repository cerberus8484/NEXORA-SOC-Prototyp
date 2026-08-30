import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from './Button';
import { HelpTip } from './HelpTip';
import type { WikiTopicKey } from '../../lib/wikiTopics';
import { useTranslation } from 'react-i18next';

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
  const { t: tr } = useTranslation();
  return (
    <div className="page-header">
      <div className="section-header">
        <span className="sh-accent" />
        <div>
          {/* HelpTip als Geschwister NEBEN dem <h2>, nicht darin — sonst zieht der Tooltip-Trigger
              in den Accessible Name der Überschrift (getByRole('heading', {name}) bräche) und ein
              interaktives Control im Heading ist a11y-widrig. Layout bleibt identisch (inline-flex). */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <h2 style={{ margin: 0 }}>{title}</h2>
            {help && <HelpTip topic={help} />}
          </div>
          {subtitle && <div className="sh-sub">{subtitle}</div>}
        </div>
      </div>
      {(onBack || actions) && (
        <div className="page-actions">
          {onBack && (
            <Button variant="ghost" size="sm" icon={<ArrowLeft size={15} />} onClick={onBack}>{tr('common.back')}</Button>
          )}
          {actions}
        </div>
      )}
    </div>
  );
}
