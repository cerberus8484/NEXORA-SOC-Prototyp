// Strukturierter JSON-Export für Reports (P_REPORTS_3).
// EIN ReportDoc ist die Single Source — JSON leitet (wie Text/Print/PDF) verlustfrei
// daraus ab, keine eigene Mapping-Logik. Rein (keine DOM-/API-Zugriffe) → testbar.
// Zweck: maschinenlesbarer Export für SOAR/Ticket-Ingestion. ADR-009 bleibt gültig
// (nichts erfunden) — der Envelope serialisiert nur, was der Report bereits enthält.
import type { ReportDoc } from './reportModel';

/** Stabiler Schema-Marker — Konsumenten prüfen darauf, nicht auf Feldreihenfolge. */
export const REPORT_JSON_SCHEMA = 'nexora.report.v1' as const;

export interface ReportJsonEnvelope {
  schema: typeof REPORT_JSON_SCHEMA;
  kind: ReportDoc['kind'];
  title: string;
  subtitle: string;
  sections: ReportDoc['sections'];
}

export function reportJsonFilename(kind: ReportDoc['kind'], now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  return `nexora-${kind}-report-${ts}.json`;
}

/** Verlustfreier, deterministischer Envelope um das ReportDoc (Schema + Inhalt). */
export function buildReportJsonEnvelope(doc: ReportDoc): ReportJsonEnvelope {
  return {
    schema: REPORT_JSON_SCHEMA,
    kind: doc.kind,
    title: doc.title,
    subtitle: doc.subtitle,
    sections: doc.sections,
  };
}

/** Rendert den Envelope als eingerücktes JSON (Copy/Download). */
export function renderReportJson(doc: ReportDoc): string {
  return JSON.stringify(buildReportJsonEnvelope(doc), null, 2);
}
