// Pure Display-Logik für die Integrations-Übersicht. KEINE React-Importe —
// nur Ableitung der Anzeige-Zeile + ehrliches Mapping des Verbindungstest-Ergebnisses.
// Damit unabhängig von Komponenten testbar (TDD).

import type { Tone } from '../../components/ui';
import type { IntegrationStatusValue } from '../settings/integrationsApi';
import i18n from '../../i18n';

/** Eine Integration wie sie GET /integrations/status liefert (kein Secret enthalten). */
export interface IntegrationStatus {
  id: string;
  name: string;
  category: string;
  configured: boolean;
  endpoint: string;
  status: 'configured' | 'not_configured' | string;
  testable: boolean;
}

/** Antwort von POST /integrations/:id/test — entweder Erreichbarkeit oder „nicht testbar" (501). */
export interface IntegrationTestResponse {
  reachable?: boolean;
  modelAvailable?: boolean | null;
  reason?: string;
  testable?: boolean;
  message?: string;
  testedAt?: string;
}

/**
 * Ein erfolgreicher Live-Test darf den Anzeige-Status lokal auf "connected" anheben.
 * Ein fehlgeschlagener Test degradiert den gespeicherten Konfigurationsstatus nicht.
 */
export function deriveDisplayedStatus(
  status: IntegrationStatusValue,
  testResult?: IntegrationTestResponse | null,
) : IntegrationStatusValue {
  return testResult?.reachable && testResult?.modelAvailable !== false ? 'connected' : status;
}

const CATEGORY_LABELS: Record<string, string> = {
  siem: 'SIEM',
  threat_intel: 'Threat Intel',
  llm: 'KI / LLM',
  ticketing: 'Ticketing',
  email: 'E-Mail',
};

/** Lesbares Kategorie-Label; unbekannte Kategorien werden unverändert durchgereicht. */
export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

export function configuredTone(configured: boolean): Tone {
  return configured ? 'success' : 'muted';
}

export function configuredLabel(configured: boolean): string {
  return configured ? i18n.t('common.configured') : i18n.t('text.notConfigured');
}

/** Ableitbare Anzeige-Zeile einer Integration — reines Modell, keine UI. */
export interface IntegrationRow {
  id: string;
  name: string;
  category: string;
  categoryLabel: string;
  configured: boolean;
  endpoint: string;
  endpointDisplay: string;
  testable: boolean;
  /** Darf ein Live-Test ausgelöst werden? Nur testbar UND konfiguriert. */
  canTest: boolean;
  /** Ehrlicher Grund, warum kein Test möglich ist (null wenn Test erlaubt). */
  testDisabledReason: string | null;
}

/**
 * Leitet die Anzeige-Zeile aus dem rohen Status ab.
 * Ein Live-Test ist nur erlaubt, wenn die Integration testbar UND konfiguriert ist —
 * sonst ehrlicher Grund statt eines Buttons, der ins Leere läuft.
 */
export function buildIntegrationRow(status: IntegrationStatus): IntegrationRow {
  let canTest = false;
  let testDisabledReason: string | null = null;

  if (!status.testable) {
    testDisabledReason = i18n.t('text.noLiveTestIntegrationOnly');
  } else if (!status.configured) {
    testDisabledReason = i18n.t('text.notConfiguredNothingTest');
  } else {
    canTest = true;
  }

  return {
    id: status.id,
    name: status.name,
    category: status.category,
    categoryLabel: categoryLabel(status.category),
    configured: status.configured,
    endpoint: status.endpoint,
    endpointDisplay: status.endpoint || '—',
    testable: status.testable,
    canTest,
    testDisabledReason,
  };
}

/** Ehrliches Ergebnis eines Verbindungstests fürs UI. */
export interface TestResultView {
  tone: Tone;
  label: string;
  message: string;
}

/**
 * Bildet die Test-Antwort auf ein UI-Ergebnis ab — ehrlich (erreichbar / nicht /
 * kein Live-Test) und ohne leere Meldung.
 */
export function mapTestResult(res: IntegrationTestResponse): TestResultView {
  if (res.testable === false) {
    return { tone: 'muted', label: i18n.t('text.noLiveTest'), message: res.message || i18n.t('app.noLiveTestAvailable') };
  }
  if (res.reason === 'model_missing' || res.modelAvailable === false) {
    return { tone: 'warning', label: i18n.t('settings.modelMissing'), message: res.message || i18n.t('app.selectedModelNotLoaded') };
  }
  if (res.reachable) {
    return { tone: 'success', label: 'Erreichbar', message: res.message || 'Erreichbar' };
  }
  return { tone: 'danger', label: i18n.t('text.unreachable'), message: res.message || i18n.t('text.unreachable') };
}
