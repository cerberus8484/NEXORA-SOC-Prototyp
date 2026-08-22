import { test, expect } from '@playwright/test';
import { mockApi } from './fixtures/api-mocks';

/**
 * NIS2-Readiness-Seite (/compliance/nis2).
 *
 * Flows:
 *  (a) Readiness-Registry lädt mit 10 Controls + KPIs.
 *  (b) Disclaimer sichtbar (kein Konformitätsnachweis) im Subtitle.
 *  (c) Tab-Wechsel "Management-Report" zeigt Report-Panel + Status-Verteilung + Disclaimer + Control-Tabelle.
 *  (d) Als Admin: Control-Detail öffnet Admin-Formulare (Status-Edit, Incident verknüpfen).
 *  (e) Als Analyst: Read-only-Hinweis nach Control-Klick.
 *
 * Selektor-Hinweise:
 *  - "NIS2 Readiness & Evidence" ist kein <h1>/<h2>/<h3> — SectionHeader rendert den
 *    Titel als styled <div>. getByText() ist die richtige Wahl.
 *  - Auf der Seite erscheint der Text "NIS2 Readiness & Evidence" auch im Breadcrumb.
 *    first() vermeidet strict-mode-Verletzung.
 */

test.describe('NIS2 Readiness — als Analyst (Read-only)', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, { authenticated: true, role: 'analyst' });
  });

  test('lädt die Readiness-Registry mit 10 Controls', async ({ page }) => {
    await page.goto('/compliance/nis2');

    // Header-Titel als Text (kein Heading-Element, Breadcrumb-Duplikat → first()).
    await expect(page.getByText('NIS2 Readiness & Evidence', { exact: true }).first()).toBeVisible();

    // KPI: Controls = 10 — die Zahl steht in der ersten StatCard.
    await expect(page.getByText('10').first()).toBeVisible();

    // Mindestens einer der 10 Control-Titel sichtbar in der Tabelle.
    await expect(page.getByText('Incident Handling').first()).toBeVisible();
    await expect(page.getByText('Schwachstellenmanagement').first()).toBeVisible();
  });

  test('zeigt den Disclaimer (kein Konformitätsnachweis)', async ({ page }) => {
    await page.goto('/compliance/nis2');

    // Subtitle-Text direkt unter dem Header.
    await expect(page.getByText('kein Konformitätsnachweis', { exact: false }).first()).toBeVisible();
  });

  test('wechselt zum Management-Report-Tab und zeigt Report-Inhalt', async ({ page }) => {
    await page.goto('/compliance/nis2');

    // Button "Management-Report" in der Header-Leiste klicken.
    await page.getByRole('button', { name: 'Management-Report' }).click();

    // Report-Panel-Header erscheint nach dem Tab-Wechsel.
    await expect(page.getByText('Management-Readiness-Report', { exact: false })).toBeVisible();

    // Disclaimer im Report.
    await expect(page.getByText('kein Konformitätsnachweis', { exact: false }).first()).toBeVisible();

    // Status-Verteilung: Badge "Nicht begonnen: 10".
    await expect(page.getByText('Nicht begonnen: 10', { exact: false })).toBeVisible();

    // Per-Control-Tabelle: mindestens ein Control-Titel sichtbar.
    await expect(page.getByText('Incident Handling').first()).toBeVisible();
  });

  test('zeigt Read-only-Hinweis nach Control-Klick als Analyst', async ({ page }) => {
    await page.goto('/compliance/nis2');

    // Ersten Control-Titel anklicken — öffnet Detail-Panel.
    await page.getByText('Incident Handling').first().click();

    // Analyst sieht Read-only-Hinweis im Detail-Panel.
    await expect(page.getByText('Nur-Lese-Ansicht', { exact: false })).toBeVisible();
  });
});

test.describe('NIS2 Readiness — als Admin (Schreiben)', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, { authenticated: true, role: 'admin' });
  });

  test('öffnet das Admin-Assessment-Formular nach Control-Klick', async ({ page }) => {
    await page.goto('/compliance/nis2');

    // Zeile "Incident Handling" in der Registry anklicken → Detail-Panel.
    await page.getByRole('row', { name: /Incident Handling/ }).click();

    // Admin sieht Speichern-Button im Assessment-Formular.
    await expect(page.getByRole('button', { name: 'Assessment speichern' })).toBeVisible();
  });

  test('zeigt den Incident-verknüpfen-Picker als Admin', async ({ page }) => {
    await page.goto('/compliance/nis2');
    await page.getByRole('row', { name: /Incident Handling/ }).click();

    // Incident-Link-Sektion im Detail-Panel (admin-only).
    await expect(page.getByText('Incident-Ticket verknüpfen')).toBeVisible();
  });
});
