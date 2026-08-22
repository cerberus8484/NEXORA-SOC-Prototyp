// integrationsApi — Integrationen-Status-API + reine Hilfsfunktionen
//
// GET  /integrations/status    → Liste aller Integrationen mit Config-Status
// POST /integrations/:id/test  → Live-Erreichbarkeitstest

import { api } from '../../lib/apiClient';

// ── Typen ─────────────────────────────────────────────────────────────────────

export type IntegrationCategory = 'siem' | 'ticketing' | 'threat_intel' | 'llm' | 'email';
export type IntegrationStatusValue = 'connected' | 'configured' | 'not_configured';

/**
 * Ein Integrations-Eintrag vom Backend.
 * SICHERHEITS-INVARIANTE: Enthält KEINE Felder api_key / password / token / secret.
 */
export interface IntegrationStatus {
  id:         string;
  name:       string;
  category:   IntegrationCategory;
  configured: boolean;
  /** NUR Host[:Port] — kein Pfad, keine Credentials. '' wenn nicht konfiguriert. */
  endpoint:   string;
  status:     IntegrationStatusValue;
  testable:   boolean;
}

export interface TestResult {
  reachable:  boolean;
  testedAt:   string;
  modelAvailable?: boolean | null;
  reason?: string;
  message?:   string;
  testable?:  boolean;
}

export interface StatusCounts {
  connected:     number;
  configured:    number;
  not_configured: number;
  total:         number;
}

export interface PaginationResult<T> {
  items:      T[];
  total:      number;
  totalPages: number;
}

export interface FilterOptions {
  query:        string;
  statusFilter: IntegrationStatusValue | 'all';
}

// ── API-Funktionen ─────────────────────────────────────────────────────────────

interface StatusEnvelope {
  data: IntegrationStatus[];
}

/** Holt alle Integrationen-Status vom Backend (admin-only). */
export function getStatus(): Promise<IntegrationStatus[]> {
  return api.get<StatusEnvelope>('/integrations/status').then((env) => env.data);
}

/**
 * Führt einen Live-Erreichbarkeitstest für eine Integration aus.
 * Nicht-testbare Integrationen liefern 501 → testable:false im Body.
 */
export function testIntegration(id: string): Promise<TestResult> {
  return api.post<TestResult>(`/integrations/${encodeURIComponent(id)}/test`);
}

// ── Reine Hilfsfunktionen (getestbar ohne DOM/API) ───────────────────────────

/**
 * Zählt Integrationen nach Status.
 */
export function buildStatusCounts(items: IntegrationStatus[]): StatusCounts {
  const counts: StatusCounts = { connected: 0, configured: 0, not_configured: 0, total: 0 };
  for (const item of items) {
    counts.total += 1;
    if (item.status === 'connected')      counts.connected      += 1;
    else if (item.status === 'configured') counts.configured    += 1;
    else                                   counts.not_configured += 1;
  }
  return counts;
}

/**
 * Filtert Integrationen nach Name-Suche + Status.
 */
export function filterIntegrations(
  items: IntegrationStatus[],
  { query, statusFilter }: FilterOptions,
): IntegrationStatus[] {
  const q = query.trim().toLowerCase();
  return items.filter((item) => {
    const matchesQuery  = !q || item.name.toLowerCase().includes(q) || item.id.toLowerCase().includes(q);
    const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
    return matchesQuery && matchesStatus;
  });
}

/**
 * Seiten-basiertes Slicing.
 * @param page  1-basiert
 * @param pageSize
 */
export function paginate<T>(items: T[], page: number, pageSize: number): PaginationResult<T> {
  const total      = items.length;
  const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;
  const start      = (page - 1) * pageSize;
  const sliced     = items.slice(start, start + pageSize);
  return { items: sliced, total, totalPages };
}

/**
 * Strippt URL-Schema von einem Endpoint-String (für Anzeige).
 * Gibt '' bei leerem String zurück.
 */
export function stripHostFromEndpoint(endpoint: string): string {
  if (!endpoint) return '';
  return endpoint.replace(/^https?:\/\//i, '');
}
