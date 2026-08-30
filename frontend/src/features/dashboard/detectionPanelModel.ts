import type { DetectionSourceRow } from './detectionSourcesModel';
import type { SourceActivityRow } from './sourceActivityModel';
import i18n from '../../i18n';

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
      description: i18n.t('app.mostFrequentRuleOffenseKeys'),
      ruleRows,
      sourceRows: [],
    };
  }

  if (sourceRows.length > 0) {
    return {
      mode: 'sources',
      badge: input.canViewRules ? 'Ingestion-Fallback' : 'Ingestion · 24h',
      title: i18n.t('collectors.activeTicketSources'),
      description: input.ruleError
        ? i18n.t('app.socMetricsCannotLoadedRight')
        : i18n.t('app.ruleStatisticsNotVisibleHere'),
      ruleRows: [],
      sourceRows: sourceRows.slice(0, 4),
    };
  }

  if (input.canViewRules && input.ruleError) {
    return {
      mode: 'empty',
      badge: 'SOC-Metriken',
      title: i18n.t('app.sourceStatisticsCannotLoaded'),
      description: i18n.t('app.neitherSocMetricsNorTicket'),
      ruleRows: [],
      sourceRows: [],
    };
  }

  if (input.sourceError) {
    return {
      mode: 'empty',
      badge: input.canViewRules ? 'SOC-Metriken' : 'Ingestion',
      title: i18n.t('app.sourcesNotVisibleRightNow'),
      description: input.canViewRules
        ? i18n.t('app.soonSocMetricsTicketSources')
        : i18n.t('app.soonTicketSourcesAvailableAgain'),
      ruleRows: [],
      sourceRows: [],
    };
  }

  return {
    mode: 'empty',
    badge: input.canViewRules ? 'SOC-Metriken' : 'Ingestion',
    title: i18n.t('app.noDetectionSourcesYet'),
    description: input.canViewRules
      ? i18n.t('app.soonTicketsOffenseRuleReference')
      : i18n.t('app.soonSourcesDeliverTicketsHonest'),
    ruleRows: [],
    sourceRows: [],
  };
}
