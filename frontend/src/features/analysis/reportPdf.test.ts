import { describe, it, expect } from 'vitest';
import { buildReportPdfDoc, reportPdfFilename } from './reportPdf';
import type { ReportDoc } from './reportModel';

const DOC: ReportDoc = {
  kind: 'incident',
  title: 'Incident-Report',
  subtitle: 'INC000042 · Test',
  sections: [
    { heading: 'Übersicht', fields: [{ label: 'Ticket', value: 'INC000042' }, { label: 'Priorität', value: 'high' }] },
    { heading: 'Zusammenfassung', bullets: ['Punkt A', 'Punkt B'] },
    { heading: 'Empfehlung', paragraphs: ['Endpoint isolieren.'] },
  ],
};

describe('buildReportPdfDoc', () => {
  it('erzeugt ein PDF mit mindestens einer Seite', () => {
    const doc = buildReportPdfDoc(DOC, new Date('2026-06-20T08:00:00Z'));
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it('rendert gradierte items inkl. Quellen-Referenz ohne Wurf', () => {
    const graded: ReportDoc = {
      kind: 'incident', title: 'Incident-Report', subtitle: 'INC1 · X',
      sections: [
        { category: 'facts', heading: 'Bestätigte Fakten', items: [{ text: 'powershell.exe ausgeführt', source: 'Evidence' }] },
        { category: 'traceability', heading: 'Traceability / Quellen', items: [{ text: 'Ticket: INC1', source: 'Ticket' }] },
      ],
    };
    const doc = buildReportPdfDoc(graded);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it('paginiert bei vielen Sektionen', () => {
    const big: ReportDoc = {
      ...DOC,
      sections: Array.from({ length: 60 }, (_, i) => ({ heading: `Sektion ${i}`, paragraphs: ['Lorem ipsum '.repeat(20)] })),
    };
    const doc = buildReportPdfDoc(big);
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
  });
});

describe('reportPdfFilename', () => {
  it('enthält kind + Zeitstempel', () => {
    const name = reportPdfFilename('customer', new Date('2026-06-20T08:05:00'));
    expect(name).toBe('nexora-customer-report-20260620-0805.pdf');
  });
});
