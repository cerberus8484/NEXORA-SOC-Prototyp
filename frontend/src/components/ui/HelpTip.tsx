import type { ReactNode } from 'react';
import { Tooltip } from './Tooltip';
import { wikiUrl } from '../../lib/wiki';
import { getWikiTopic, type WikiTopicKey } from '../../lib/wikiTopics';

// HelpTip: Ein-Zeilen-Erklärhilfe für eine konfigurierbare Funktion. Bindet einen Topic-Key
// (aus wikiTopics) an das Tooltip: kurzer Hinweis + „more"-Deep-Link ins interne Wiki, der
// GENAU erklärt, wie man es einstellt. Der Link erscheint nur, wenn ein Wiki konfiguriert ist.
//
// Nutzung:  <HelpTip topic="integrationen" />           → Info-Icon neben dem Label
//           <HelpTip topic="mfa" hint="Eigener Text" />  → Hinweis überschreiben

export interface HelpTipProps {
  /** Topic-Key aus der zentralen Registry (wikiTopics). */
  topic: WikiTopicKey;
  /** Überschreibt den Registry-Hinweis, falls kontextspezifisch nötig. */
  hint?: ReactNode;
  /** Eigener Trigger statt des Info-Icons. */
  children?: ReactNode;
}

export function HelpTip({ topic, hint, children }: HelpTipProps) {
  const t = getWikiTopic(topic);
  return (
    <Tooltip hint={hint ?? t.hint} moreHref={wikiUrl(t.slug)}>
      {children}
    </Tooltip>
  );
}
