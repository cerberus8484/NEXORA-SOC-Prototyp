// PDF-Export fürs Audit-Log (P_AUDIT_EXPORT). jsPDF-Rendering + reine, testbare Helfer.
// Anders als CSV ist PDF kein Formel-Ziel → kein Injection-Prefix nötig; lange Werte
// werden für die Tabellenzelle gekürzt. jsPDF wird in der Seite dynamisch importiert,
// damit die Heavy-Lib nicht im Haupt-Bundle landet.

import { jsPDF } from 'jspdf';
import type { AuditEntry } from './auditApi';
import i18n from '../../i18n';

export const AUDIT_PDF_TITLE = 'Nexora SOC — Audit-Log';

// Spaltenbreiten in pt (A4 quer ≈ 842 pt nutzbar, abzüglich Ränder).
export const AUDIT_PDF_COLUMNS = [
  { header: 'Zeitpunkt', width: 115, max: 40 },
  { header: 'Aktion',    width: 150, max: 40 },
  { header: 'Akteur',    width: 150, max: 40 },
  { header: i18n.t('common.target'),      width: 165, max: 46 },
  { header: 'IP',        width: 80,  max: 24 },
  { header: 'Metadaten', width: 160, max: 64 },
] as const;

/** Normalisiert einen Zellenwert (null/undefined → '') und kürzt auf max Zeichen. */
export function formatPdfCell(value: unknown, max = 60): string {
  const s = value == null ? '' : String(value);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Eine Audit-Zeile → Zell-Strings in Spaltenreihenfolge (Ziel = Typ: Id). */
export function auditEntryToPdfRow(e: AuditEntry): string[] {
  const target = [e.targetType, e.targetId].filter(Boolean).join(': ');
  const meta = JSON.stringify(e.metadata ?? {});
  const values = [e.createdAt, e.action, e.actorLabel, target, e.ip, meta];
  return values.map((v, i) => formatPdfCell(v, AUDIT_PDF_COLUMNS[i].max));
}

/** Dateiname mit Zeitstempel, z. B. `nexora-audit-20260619-1645.pdf`. */
export function auditPdfFilename(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  return `nexora-audit-${ts}.pdf`;
}

/** Baut das PDF-Dokument (A4 quer): Kopf, Meta-Zeile, paginierte Tabelle. */
export function buildAuditPdfDoc(entries: AuditEntry[], now: Date = new Date()): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 32;
  let y = 40;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(AUDIT_PDF_TITLE, marginX, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  y += 16;
  doc.text(i18n.t('audit.pdfGenerated', { at: now.toISOString(), count: entries.length }), marginX, y);
  y += 18;

  const xs: number[] = [];
  let x = marginX;
  for (const col of AUDIT_PDF_COLUMNS) {
    xs.push(x);
    x += col.width;
  }

  const drawHeader = () => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    AUDIT_PDF_COLUMNS.forEach((c, i) => doc.text(c.header, xs[i], y));
    y += 4;
    doc.setLineWidth(0.5);
    doc.line(marginX, y, pageW - marginX, y);
    y += 10;
    doc.setFont('helvetica', 'normal');
  };
  drawHeader();

  const rowH = 12;
  for (const e of entries) {
    if (y > pageH - 28) {
      doc.addPage();
      y = 40;
      drawHeader();
    }
    auditEntryToPdfRow(e).forEach((cell, i) => doc.text(cell, xs[i], y));
    y += rowH;
  }

  return doc;
}
