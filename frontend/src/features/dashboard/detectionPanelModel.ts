import type { DetectionSourceRow } from './detectionSourcesModel';
import type { SourceActivityRow } from './sourceActivityModel';

export interface DetectionPanelState {
  mode: 'rules' | 'sources' | 'empty';
  badge: string;
  title: string;
  description: string;
  ruleRows: DetectionSourceRow[];
  sourceRows: SourceActivityRow[];
}

export function buildDetectionPanelState(input: {
  canViewRules: boolean;
  ruleRows: readonly DetectionSourceRow[];
  ruleError: boolean;
  sourceRows: readonly SourceActivityRow[];
  sourceError: boolean;
}): DetectionPanelState {
  const ruleRows = [...input.ruleRows];
  const sourceRows = [...input.sourceRows];

  if (input.canViewRules && ruleRows.length > 0) {
    return {
      mode: 'rules',
      badge: 'SOC-Metriken',
      title: 'Top Erkennungsquellen',
      description: 'Hauefigste Regel- oder Offense-Schluessel aus den aktuellen Tickets.',
      ruleRows,
      sourceRows: [],
    };
  }

  if (sourceRows.length > 0) {
    return {
      mode: 'sources',
      badge: input.canViewRules ? 'Ingestion-Fallback' : 'Ingestion · 24h',
      title: 'Aktive Ticket-Quellen',
      description: input.ruleError
        ? 'SOC-Metriken sind gerade nicht ladbar. Deshalb zeigen wir die realen Ticket-Quellen als Fallback.'
        : 'Rule-Statistiken sind hier nicht sichtbar. Deshalb zeigen wir die realen Ticket-Quellen der letzten 24h.',
      ruleRows: [],
      sourceRows: sourceRows.slice(0, 4),
    };
  }

  if (input.canViewRules && input.ruleError) {
    return {
      mode: 'empty',
      badge: 'SOC-Metriken',
      title: 'Quell-Statistik nicht ladbar',
      description: 'Weder SOC-Metriken noch Ticket-Quellen konnten geladen werden. Bitte spaeter erneut versuchen.',
      ruleRows: [],
      sourceRows: [],
    };
  }

  if (input.sourceError) {
    return {
      mode: 'empty',
      badge: input.canViewRules ? 'SOC-Metriken' : 'Ingestion',
      title: 'Quellen derzeit nicht sichtbar',
      description: input.canViewRules
        ? 'Sobald SOC-Metriken oder Ticket-Quellen wieder verfuegbar sind, erscheint hier die Herkunft der Erkennungen.'
        : 'Sobald Ticket-Quellen wieder verfuegbar sind, erscheint hier eine ehrliche Quellenuebersicht.',
      ruleRows: [],
      sourceRows: [],
    };
  }

  return {
    mode: 'empty',
    badge: input.canViewRules ? 'SOC-Metriken' : 'Ingestion',
    title: 'Noch keine Erkennungsquellen',
    description: input.canViewRules
      ? 'Sobald Tickets mit Offense- oder Regel-Bezug entstehen, erscheinen hier die haeufigsten Quellen.'
      : 'Sobald Quellen Tickets liefern, erscheint hier eine ehrliche Uebersicht der aktiven Ticket-Quellen.',
    ruleRows: [],
    sourceRows: [],
  };
}
