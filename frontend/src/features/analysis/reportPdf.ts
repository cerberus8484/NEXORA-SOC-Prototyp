// PDF-Renderer für strukturierte Reports (ReportDoc → A4 hoch, paginiert).
// jsPDF wird statisch importiert; die aufrufende Seite lädt dieses Modul dynamisch,
// damit die Heavy-Lib nicht im Haupt-Bundle landet (gleiches Muster wie auditPdf).

import { jsPDF } from 'jspdf';
import type { ReportDoc } from './reportModel';

const MARGIN_X = 48;
const LINE_H = 13;

export function reportPdfFilename(kind: 'incident' | 'customer', now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  return `nexora-${kind}-report-${ts}.pdf`;
}

/** Baut das Report-PDF: Kopf, Untertitel, Generiert-Zeile, paginierte Sektionen. */
export function buildReportPdfDoc(report: ReportDoc, now: Date = new Date()): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const contentW = pageW - MARGIN_X * 2;
  let y = 56;

  const ensure = (need: number) => {
    if (y + need > pageH - 40) { doc.addPage(); y = 56; }
  };
  const write = (text: string, x: number, maxW: number): number => {
    const wrapped = doc.splitTextToSize(text, maxW) as string[];
    ensure(wrapped.length * LINE_H);
    doc.text(wrapped, x, y);
    return wrapped.length;
  };

  // Kopf
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(report.title, MARGIN_X, y);
  y += 22;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(90);
  if (report.subtitle) { doc.text(report.subtitle, MARGIN_X, y); y += 14; }
  doc.text(`Generiert: ${now.toISOString()}`, MARGIN_X, y);
  y += 10;
  doc.setTextColor(0);
  doc.setLineWidth(0.7);
  doc.line(MARGIN_X, y, pageW - MARGIN_X, y);
  y += 22;

  for (const section of report.sections) {
    ensure(40);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(section.heading, MARGIN_X, y);
    y += 16;

    doc.setFontSize(10);
    for (const f of section.fields ?? []) {
      doc.setFont('helvetica', 'bold');
      ensure(LINE_H);
      doc.text(`${f.label}:`, MARGIN_X, y);
      doc.setFont('helvetica', 'normal');
      const n = write(f.value, MARGIN_X + 110, contentW - 110);
      y += n * LINE_H + 2;
    }
    doc.setFont('helvetica', 'normal');
    for (const b of section.bullets ?? []) {
      const n = write(`• ${b}`, MARGIN_X + 8, contentW - 8);
      y += n * LINE_H + 1;
    }
    // Gradierte Items (P_REPORTS_2): Text + optionale Quellen-Referenz (Traceability).
    for (const it of section.items ?? []) {
      const line = it.source ? `• ${it.text}  (${it.source})` : `• ${it.text}`;
      const n = write(line, MARGIN_X + 8, contentW - 8);
      y += n * LINE_H + 1;
    }
    for (const p of section.paragraphs ?? []) {
      const n = write(p, MARGIN_X, contentW);
      y += n * LINE_H + 4;
    }
    y += 10;
  }

  return doc;
}
