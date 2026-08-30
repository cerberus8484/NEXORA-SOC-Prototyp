import { describe, test, expect } from 'vitest';
import { buildPrintableHtml, sanitizeForPdf, pdfFileName } from './reportPrint';

describe('sanitizeForPdf', () => {
  test('ersetzt Box-Drawing-Zeichen durch ASCII (PDF-fontsicher)', () => {
    expect(sanitizeForPdf('┌─┐')).toBe('+-+');
    expect(sanitizeForPdf('│ x │')).toBe('| x |');
    expect(sanitizeForPdf('└┴┘')).toBe('+++');
    expect(sanitizeForPdf('├┼┤')).toBe('+++');
  });

  test('lässt normalen Text unverändert', () => {
    expect(sanitizeForPdf('Src IP: 1.2.3.4\nRule 100205')).toBe('Src IP: 1.2.3.4\nRule 100205');
  });
});

describe('pdfFileName', () => {
  test('hängt .pdf an und säubert Sonderzeichen (Groß-/Kleinschreibung bleibt)', () => {
    expect(pdfFileName('Report INC000243')).toBe('Report_INC000243.pdf');
    expect(pdfFileName('a/b:c*d')).toBe('a_b_c_d.pdf');
  });

  test('doppelte .pdf-Endung wird vermieden', () => {
    expect(pdfFileName('report.pdf')).toBe('report.pdf');
  });

  test('leerer Name → fallback', () => {
    expect(pdfFileName('')).toBe('report.pdf');
  });
});

describe('buildPrintableHtml', () => {
  test('enthält Titel und Report-Inhalt', () => {
    const html = buildPrintableHtml('Report INC000243', '# Incident\nSrc IP: 1.2.3.4');
    expect(html).toContain('<title>Report INC000243</title>');
    expect(html).toContain('Src IP: 1.2.3.4');
    expect(html).toContain('@media print');
  });

  test('escaped HTML-Sonderzeichen im Inhalt (kein Injection)', () => {
    const html = buildPrintableHtml('T', 'rule <script>alert(1)</script> & <b>x</b>');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });

  test('escaped Sonderzeichen im Titel', () => {
    const html = buildPrintableHtml('A & <B>', 'x');
    expect(html).toContain('<title>A &amp; &lt;B&gt;</title>');
  });
});
