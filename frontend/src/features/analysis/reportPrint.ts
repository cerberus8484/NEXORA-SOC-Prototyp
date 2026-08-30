// Export des Incident-Reports:
//  - downloadReportPdf(): echter PDF-Download via jsPDF (Monospace, A4, Seitenumbruch)
//  - openPrintWindow(): Druckfenster als Fallback (Browser „Als PDF speichern")
import { jsPDF } from 'jspdf';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Box-Drawing-Zeichen (┌─┐│ …) fehlen in den PDF-Standardfonts → ASCII-Ersatz,
// damit der PDF-Report sauber rendert statt mit Leerglyphen.
const BOX_TO_ASCII: Record<string, string> = {
  '┌': '+', '┐': '+', '└': '+', '┘': '+',
  '├': '+', '┤': '+', '┬': '+', '┴': '+', '┼': '+',
  '─': '-', '│': '|',
};

/** Ersetzt Box-Drawing-Unicode durch ASCII (PDF-fontsicher). Reine Funktion. */
export function sanitizeForPdf(text: string): string {
  return text.replace(/[┌┐└┘├┤┬┴┼─│]/g, (ch) => BOX_TO_ASCII[ch] ?? ch);
}

/** Normalisiert einen Dateinamen und stellt die `.pdf`-Endung sicher. Reine Funktion. */
export function pdfFileName(base: string): string {
  const clean = (base || 'report')
    .replace(/[^\w.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  const safe = clean || 'report';
  return safe.toLowerCase().endsWith('.pdf') ? safe : `${safe}.pdf`;
}

/** Baut ein eigenständiges, druckfertiges HTML-Dokument aus dem Markdown-Report. */
export function buildPrintableHtml(title: string, markdown: string): string {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>`
    + '<style>'
    + 'body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;max-width:820px;margin:32px auto;padding:0 24px;line-height:1.55}'
    + 'pre{white-space:pre-wrap;word-wrap:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}'
    + '@media print{body{margin:0}}'
    + '</style></head><body><pre>'
    + escapeHtml(markdown)
    + '</pre></body></html>';
}

/** Erzeugt und lädt einen echten PDF-Report (jsPDF), Monospace mit Seitenumbruch. */
export function downloadReportPdf(baseName: string, markdown: string): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  doc.setFont('courier', 'normal');
  doc.setFontSize(8);

  const marginX = 32;
  const marginY = 40;
  const lineHeight = 10;
  const pageHeight = doc.internal.pageSize.getHeight();
  const usableWidth = doc.internal.pageSize.getWidth() - marginX * 2;

  const lines = doc.splitTextToSize(sanitizeForPdf(markdown), usableWidth) as string[];

  let y = marginY;
  for (const line of lines) {
    if (y > pageHeight - marginY) {
      doc.addPage();
      y = marginY;
    }
    doc.text(line, marginX, y);
    y += lineHeight;
  }

  doc.save(pdfFileName(baseName));
}

/** Öffnet ein Druckfenster mit dem Report (Fallback). Gibt false zurück, wenn der Popup-Blocker greift. */
export function openPrintWindow(title: string, markdown: string): boolean {
  const html = buildPrintableHtml(title, markdown);
  // Blob-URL statt document.write: kein dynamisches HTML-Schreiben ins neue Fenster
  // (XSS-Härtung; das HTML ist via escapeHtml bereits escaped, Blob hält die Invariante stabil).
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const win = window.open(url, '_blank');
  if (!win) { URL.revokeObjectURL(url); return false; }
  win.addEventListener('load', () => { win.focus(); win.print(); URL.revokeObjectURL(url); }, { once: true });
  return true;
}
