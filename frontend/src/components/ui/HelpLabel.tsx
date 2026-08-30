import type { CSSProperties, ReactNode } from 'react';
import { Lightbulb } from 'lucide-react';
import { HelpTip } from './HelpTip';
import type { HelpTipProps } from './HelpTip';

const s: Record<string, CSSProperties> = {
  wrap: { display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  bulb: { display: 'inline-flex', alignItems: 'center', color: 'var(--warning)' },
};

interface HelpLabelProps {
  text: string;
  topic: HelpTipProps['topic'];
  hint: ReactNode;
}

export function HelpLabel({ text, topic, hint }: HelpLabelProps) {
  return (
    <span style={s.wrap}>
      <span>{text}</span>
      <HelpTip topic={topic} hint={hint}>
        <span style={s.bulb} aria-label={`${text} erklaeren`}>
          <Lightbulb size={13} aria-hidden />
        </span>
      </HelpTip>
    </span>
  );
}
