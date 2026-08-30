import { test, expect } from '@playwright/test';
import { mockApi } from './fixtures/api-mocks';

/**
 * Threat-Hunts-Seite (/threat-hunts) — Happy-Path.
 *
 * Die Seite zeigt links eine Session-Liste mit Gruppen (ACTIVE / COMPLETED / DRAFT),
 * rechts einen Overview-Bereich mit Hunt Summary.
 *
 * Mock liefert einen completed Hunt ("PowerShell Lateral Movement") mit findings:[],
 * commands:[], events:[], ticketIds:[] als Arrays — wichtig, sonst crash bei .map().
 */
test.describe('Threat Hunts', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, { authenticated: true });
  });

  test('lädt die Hunt-Sessions-Liste', async ({ page }) => {
    await page.goto('/threat-hunts');

    // Linkes Panel-Header "Hunt Sessions" sichtbar.
    await expect(page.getByText('Hunt Sessions')).toBeVisible();
  });

  test('zeigt Gruppen-Labels in der Session-Liste', async ({ page }) => {
    await page.goto('/threat-hunts');

    // Der Mock-Hunt hat status='completed' → Gruppe "COMPLETED (1)" im linken Panel.
    // exact:true vermeidet Kollision mit dem Badge-Text "Completed" und der <option>.
    await expect(page.getByText('COMPLETED (1)', { exact: true })).toBeVisible();
  });

  test('zeigt den gemockten Hunt in der COMPLETED-Gruppe', async ({ page }) => {
    await page.goto('/threat-hunts');

    // Hunt-Titel sichtbar. .first() ist bewusst: nach der Auto-Selektion (useEffect +
    // 2s-Polling) erscheint der Titel auch im Overview rechts → ohne .first() würde der
    // Locator zeitabhängig mal 1, mal 2 Treffer liefern (Strict-Mode-Flake).
    await expect(page.getByText('PowerShell Lateral Movement').first()).toBeVisible();
  });

  test('zeigt Hunt Summary nach automatischer Auswahl des ersten Hunts', async ({ page }) => {
    await page.goto('/threat-hunts');

    // Nach Auto-Selektion (useEffect) wird der Overview-Bereich gerendert.
    // Der Panel-Header oder KPI-Label "Hunt Summary" erscheint im rechten Bereich.
    await expect(page.getByText('Hunt Summary')).toBeVisible();
  });

  test('zeigt den New-Hunt-Button für Analysten', async ({ page }) => {
    await page.goto('/threat-hunts');

    // Analyst sieht "New Hunt"-Button (canAct = true für Analysten).
    await expect(page.getByRole('button', { name: 'New Hunt' })).toBeVisible();
  });
});
