/**
 * importHelpers.ts — Hilfsfunktionen für den Smart-Import-Assistenten.
 * Reiner Mapper: ThreatIntelResult → EnrichmentData.
 * Keine Seiteneffekte, keine API-Calls.
 */

import type { ThreatIntelResult, EnrichmentData } from '../analysis/analysisModel';
import { EMPTY_ENRICHMENT } from '../analysis/analysisModel';

/**
 * Mappt ein ThreatIntelResult auf eine EnrichmentData-Instanz.
 *
 * Regeln:
 * - null  → EMPTY_ENRICHMENT (kein Ergebnis vorhanden)
 * - source === 'mock' → alle Status auf 'none' (Demo-Daten ignorieren)
 * - Provider 'virustotal' mit status 'ok' → virusTotal.status = 'completed'
 * - Provider 'abuseipdb' mit status 'ok' → abuseIpDb.status = 'completed'
 * - alles andere → status 'none'
 * - indicatorValue → whois.ip (Basis-Kontext für das UI)
 */
export function tiResultToEnrichment(result: ThreatIntelResult | null): EnrichmentData {
  if (!result || result.source === 'mock') {
    return { ...EMPTY_ENRICHMENT };
  }

  const vtProvider = result.providers.find((p) => p.provider === 'virustotal');
  const abuseProvider = result.providers.find((p) => p.provider === 'abuseipdb');

  const vtDetails = vtProvider?.details as { malicious?: number; suspicious?: number; harmless?: number; undetected?: number; total?: number } | undefined;

  const virusTotal: EnrichmentData['virusTotal'] =
    vtProvider?.status === 'ok'
      ? {
          status    : 'completed',
          malicious : vtDetails?.malicious  ?? vtProvider.score ?? 0,
          suspicious: vtDetails?.suspicious ?? 0,
          harmless  : vtDetails?.harmless   ?? 0,
          undetected: vtDetails?.undetected ?? 0,
          total     : vtDetails?.total      ?? 0,
        }
      : { ...EMPTY_ENRICHMENT.virusTotal, status: 'none' };

  const abuseDetails = abuseProvider?.details as { reports?: number; lastReport?: string; country?: string; isp?: string; usageType?: string; domainCount?: number } | undefined;

  const abuseIpDb: EnrichmentData['abuseIpDb'] =
    abuseProvider?.status === 'ok'
      ? {
          status    : 'completed',
          confidence: abuseProvider.confidence ?? 0,
          reports   : abuseDetails?.reports    ?? 0,
          lastReport: abuseDetails?.lastReport ?? '',
          country   : abuseDetails?.country    ?? '',
          isp       : abuseDetails?.isp        ?? '',
          usageType : abuseDetails?.usageType  ?? '',
          domainCount: abuseDetails?.domainCount ?? 0,
        }
      : { ...EMPTY_ENRICHMENT.abuseIpDb, status: 'none' };

  return {
    virusTotal,
    abuseIpDb,
    whois: {
      ...EMPTY_ENRICHMENT.whois,
      ip: result.indicatorValue ?? '',
    },
    wazuhEvents: [],
  };
}
