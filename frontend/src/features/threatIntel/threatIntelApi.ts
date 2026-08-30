import { api } from '../../lib/apiClient';
import type { IocType, ThreatIntelResult } from '../analysis/analysisModel';

export const threatIntelApi = {
  /** Normalisiertes Enrichment für einen Indikator (P17.1: Mock-first, keine echten Calls). */
  enrich: (indicatorType: IocType, indicatorValue: string) =>
    api.post<{ data: ThreatIntelResult }>('/threat-intel/enrich', { indicatorType, indicatorValue }),
};
