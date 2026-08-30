import { test, expect } from '@playwright/test';
import { mockApi } from './fixtures/api-mocks';

/**
 * Zentraler Incident-Report-Flow (P_REPORTS Phase 3).
 *
 *   Ticket (auto-selektiert) → Evidence + Correlation-Provenance → Report-Preview
 *   (sechs gradierte Bereiche) → Export-Start (Incident-Report-PDF).
 *
 * Deterministisch: alle Requests gemockt, keine Prod-API, keine Sleeps.
 * Die spezifische /tickets/:id/evidence-Route wird NACH mockApi registriert und
 * gewinnt dadurch (Playwright: zuletzt registrierte passende Route zuerst).
 */

// ParsedEvidence-Shape (src/features/analysis/analysisModel.ts) — genug Felder,
// damit Summary/IOCs/Indikatoren entstehen.
const PARSED_EVIDENCE = {
  id: 'ev-1',
  type: 'network',
  detection: { sourceSystem: 'wazuh', ruleName: 'PowerShell EncodedCommand', timestamp: '2026-06-14T08:30:00.000Z' },
  source: { host: 'WEC01', user: 'svc-backup', ip: '10.99.99.11' },
  destination: { ip: '185.220.101.47', port: 443 },
  nat: {},
  network: { protocol: 'tcp', bytesSent: 4096, bytesReceived: 512 },
  payload: { containsBase64: true },
  metadata: { mitreTactic: 'Execution', mitreTechnique: 'T1059.001', agentName: 'WEC01' },
  process: { image: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', commandLine: 'powershell.exe -enc QQBBAA==', user: 'svc-backup' },
  firstSeen: '2026-06-14T08:30:00.000Z',
  lastSeen: '2026-06-14T08:35:00.000Z',
};

const CORRELATION = {
  status: 'current',
  result: { correlation: { eventCount: 5, sources: [{ source: 'wazuh', count: 5 }] } },
  resultCreatedAt: '2026-06-14T09:01:00.000Z',
  sourceRevision: '2026-06-14T09:00:00.000Z',
  lastFailureReason: null,
};

test.describe('Incident-Report-Flow', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, { authenticated: true });
    // Spezifischer als der mockApi-Catch-all → gewinnt für Evidence+Correlation.
    await page.route('**/api/v1/tickets/*/evidence', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: PARSED_EVIDENCE, source: 'wazuh', correlation: CORRELATION }),
      });
    });
    // Timeline mit korrektem TicketTimeline-Shape (Fallback {data:[]} würde crashen)
    // + network.gaps → exerziert den Bereich „Fehlende Evidence".
    await page.route('**/api/v1/tickets/*/timeline', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          enabled: true,
          data: {
            count: 1, first: '2026-06-14T08:30:00.000Z', last: '2026-06-14T08:35:00.000Z',
            actions: [{ action: 'block', count: 2 }], dstPorts: [443],
            events: [{ time: '2026-06-14T08:30:00.000Z', action: 'connect', srcIp: '10.99.99.11', srcPort: 49888, dstIp: '185.220.101.47', dstPort: 443, protocol: 'tcp' }],
          },
          network: {
            flows: [{ sourceIp: '10.99.99.11', destinationIp: '185.220.101.47', sourceType: 'firewall' }],
            gaps: [{ field: 'fqdn', missingReason: 'dns_no_record', count: 1 }],
          },
        }),
      });
    });
  });

  test('Ticket → Evidence/Correlation → Report-Preview → Export', async ({ page }) => {
    await page.goto('/analysis');

    // Erstes Ticket wird automatisch selektiert.
    await expect(page.getByText('INC000001').first()).toBeVisible();

    // Auf stabilen Zustand warten: Correlation-Polling stoppt bei 'current' (terminal),
    // danach kein Re-Render mehr → DOM stabil (kein Sleep, deterministisches Signal).
    await page.waitForLoadState('networkidle');

    // Report-Bereich öffnen (Top-Nav-Button „Report").
    await page.getByRole('button', { name: 'Report', exact: true }).first().click();

    // Strukturierte Preview mit den gradierten Bereichen.
    const preview = page.getByTestId('incident-report-preview');
    await expect(preview).toBeVisible();
    await expect(preview.getByText('Bestätigte Fakten')).toBeVisible();
    await expect(preview.getByText('Auffällige Indikatoren')).toBeVisible();
    await expect(preview.getByText('Traceability / Quellen')).toBeVisible();
    // Correlation-Provenance ist in den Report durchgereicht.
    await expect(preview.getByText(/Korrelation/).first()).toBeVisible();
    // MITRE erscheint als Indikator, nicht als Fakt.
    await expect(preview.getByText(/T1059\.001/).first()).toBeVisible();

    // Export-Start: Incident-Report-PDF löst einen Download aus (stabiles Signal, kein Sleep).
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Incident-Report (PDF)' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/nexora-incident-report-.*\.pdf/);
  });
});
