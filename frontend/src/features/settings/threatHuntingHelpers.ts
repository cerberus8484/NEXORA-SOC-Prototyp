/**
 * Reine Helfer für ThreatHuntingPanel — kein React, keine API-Calls, testbar.
 *
 * ADR-009 Ehrlichkeits-Regel:
 *   ECHT: Hunt-Katalog read-only (GET /hunts/catalog), Links zu Hunt-Library.
 *   EHRLICH GEPLANT: Scheduling, Automatisierung, Auto-Trigger — keine Fake-Daten.
 */

import type { HuntCatalogItem } from '../hunts/huntApi';
import i18n from '../../i18n';

// ── Typen ─────────────────────────────────────────────────────────────────────

export type RiskTone = 'success' | 'accent' | 'warning' | 'danger' | 'muted';

export interface CatalogItemDisplay extends HuntCatalogItem {
  riskLabel: string;
  riskTone: RiskTone;
}

// ── riskLevelLabel ─────────────────────────────────────────────────────────────

const RISK_LABEL_KEYS: Record<string, string> = {
  low:      'tickets.priorities.low',
  medium:   'tickets.priorities.medium',
  high:     'tickets.priorities.high',
  critical: 'common.critical',
};

/** Menschenlesbares Label für ein riskLevel aus der Katalog-API. */
export function riskLevelLabel(level: string): string {
  const key = RISK_LABEL_KEYS[level];
  return key ? i18n.t(key) : level;
}

// ── riskLevelTone ──────────────────────────────────────────────────────────────

const RISK_TONES: Record<string, RiskTone> = {
  low:      'success',
  medium:   'accent',
  high:     'warning',
  critical: 'danger',
};

/** Badge-Tone für ein riskLevel (passend zu Badge-Komponente). */
export function riskLevelTone(level: string): RiskTone {
  return RISK_TONES[level] ?? 'muted';
}

// ── catalogApiPath ─────────────────────────────────────────────────────────────

/**
 * Kanonischer API-Pfad des Hunt-Katalogs.
 * Vertrag: huntApi.catalog() ruft genau diesen Pfad auf.
 */
export function catalogApiPath(): string {
  return '/hunts/catalog';
}

// ── formatCatalogItem ──────────────────────────────────────────────────────────

/**
 * Reichert ein rohe HuntCatalogItem mit Anzeige-Feldern an.
 * Keine Mutation — gibt immer ein neues Objekt zurück.
 */
export function formatCatalogItem(item: HuntCatalogItem): CatalogItemDisplay {
  return {
    ...item,
    riskLabel: riskLevelLabel(item.riskLevel),
    riskTone:  riskLevelTone(item.riskLevel),
  };
}
