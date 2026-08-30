import { test, expect } from '@playwright/test';
import { mockApi } from './fixtures/api-mocks';

/**
 * Correlation Operations Center (/correlators) — P_CORR_ADMIN_1.
 *
 * Flow (gemockte API, kein Backend):
 *   Registry → Detail → Jobs/Results/Audit/Config → Draft anlegen → Approval-Anzeige.
 *
 * Harte Grenze: KEINE Apply-/Restart-/Reload-/Shell-Aktion im UI.
 */

test.describe('Correlators — als Admin', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, { authenticated: true, role: 'admin' });
  });

  test('Registry lädt den realen Correlator', async ({ page }) => {
    await page.goto('/correlators');
    await expect(page.getByText('Correlation Engine').first()).toBeVisible();
    await expect(page.getByText('ce-1').first()).toBeVisible();
  });

  test('Detail zeigt Jobs, Results, Audit und superseded-Erklärung', async ({ page }) => {
    await page.goto('/correlators');
    await page.getByText('Correlation Engine').first().click();

    await expect(page.getByText(/Jobs \(/)).toBeVisible();
    await expect(page.getByText('INC000009')).toBeVisible();          // superseded-Job
    await expect(page.getByText('Ersetzt').first()).toBeVisible();     // superseded-Badge
    await expect(page.getByText(/durch eine neuere Ticket-Revision ersetzt/i)).toBeVisible();
    await expect(page.getByText(/Results \(/)).toBeVisible();
    await expect(page.getByText(/Audit \(/)).toBeVisible();
  });

  test('zeigt „genehmigt, aber nicht angewendet" für einen approved Draft', async ({ page }) => {
    await page.goto('/correlators');
    await page.getByText('Correlation Engine').first().click();
    await expect(page.getByText(/Genehmigt, aber noch nicht angewendet/i)).toBeVisible();
  });

  test('bietet KEINE Apply-/Restart-/Reload-/Shell-Aktion an', async ({ page }) => {
    await page.goto('/correlators');
    await page.getByText('Correlation Engine').first().click();
    // Exakte Ausführungs-Verben — die read-only „Apply-Plan anzeigen"-Vorschau ist KEINE Ausführung.
    await expect(page.getByRole('button', { name: /^(anwenden|apply|restart|neustart|reload|shell|ssh|ausführen|execute)$/i })).toHaveCount(0);
  });

  test('Engineer-/Admin-Aktion: Draft anlegen ist verfügbar', async ({ page }) => {
    await page.goto('/correlators');
    await page.getByText('Correlation Engine').first().click();
    await expect(page.getByRole('button', { name: /Draft anlegen & validieren/i }).first()).toBeVisible();
  });

  test('separater Validieren-Schritt zeigt das Ergebnis (P_CORR_ADMIN_2)', async ({ page }) => {
    await page.goto('/correlators');
    await page.getByText('Correlation Engine').first().click();
    await page.getByRole('button', { name: /^Validieren$/i }).first().click();
    await expect(page.getByText(/Validierung erfolgreich/i)).toBeVisible();
  });

  test('Apply-Plan-Vorschau zeigt wouldApply:false + „nichts angewendet"', async ({ page }) => {
    await page.goto('/correlators');
    await page.getByText('Correlation Engine').first().click();
    await page.getByRole('button', { name: /Apply-Plan anzeigen/i }).first().click();
    await expect(page.getByText(/wouldApply: false/i)).toBeVisible();
    await expect(page.getByText(/es wird nichts angewendet/i)).toBeVisible();
  });

  test('Worker Live-Health zeigt Heartbeat + Apply-Readiness blockiert (Stufe 3)', async ({ page }) => {
    await page.goto('/correlators');
    await page.getByText('Correlation Engine').first().click();
    await expect(page.getByText(/Worker Live-Health/i)).toBeVisible();
    await expect(page.getByText(/Heartbeat: frisch/i)).toBeVisible();
    await expect(page.getByText(/Apply blockiert/i).first()).toBeVisible();
  });
});

test.describe('Correlators — als Analyst', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, { authenticated: true, role: 'analyst' });
  });

  test('Analyst liest die Registry, sieht aber keine administrativen Aktionen', async ({ page }) => {
    await page.goto('/correlators');
    await expect(page.getByText('Correlation Engine').first()).toBeVisible();
    await page.getByText('Correlation Engine').first().click();
    await expect(page.getByRole('button', { name: /Draft anlegen|Genehmigen|Zur Genehmigung einreichen/i })).toHaveCount(0);
  });
});
