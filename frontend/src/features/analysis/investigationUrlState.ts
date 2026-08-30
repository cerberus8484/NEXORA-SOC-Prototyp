import type { DeckSection } from './deck/AnalysisSubNav';

const INVESTIGATION_TABS: readonly DeckSection[] = [
  'overview', 'iocs', 'timeline', 'network', 'payloads', 'commands', 'entities',
  'evidence', 'ki_analysis', 'export', 'notes', 'history', 'playbooks', 'report',
];

export function readInvestigationTab(params: URLSearchParams): DeckSection {
  const tab = params.get('tab');
  return INVESTIGATION_TABS.includes(tab as DeckSection) ? tab as DeckSection : 'overview';
}

export function writeInvestigationTab(params: URLSearchParams, tab: DeckSection): URLSearchParams {
  const next = new URLSearchParams(params);
  next.set('tab', tab);
  return next;
}

export function readInvestigationEvent(params: URLSearchParams): string | null {
  return params.get('event');
}

export function writeInvestigationEvent(params: URLSearchParams, eventId: string | null): URLSearchParams {
  const next = new URLSearchParams(params);
  if (eventId) next.set('event', eventId);
  else next.delete('event');
  return next;
}
