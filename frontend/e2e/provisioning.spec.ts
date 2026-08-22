import { test, expect } from '@playwright/test';
import { mockApi } from './fixtures/api-mocks';

/**
 * Provisioning-Seite (/provisioning) — admin-gegated.
 *
 * Flows:
 *  (a) Als Admin → Registry lädt: Enrollment-Profile-Tabelle + Nodes-Tabelle.
 *  (b) Mock-Profil und Mock-Node "lab-sensor-01" sichtbar.
 *  (c) Admin sieht "Profil anlegen"-Button.
 *  (d) Als Analyst → Admin-only-Button NICHT vorhanden.
 *
 * Selektor-Strategie:
 *  ProvisioningPage rendert Panel-Header als <span>Enrollment-Profile (1)</span>
 *  und <span>Nodes (1)</span> (keine Heading-Elemente).
 *  Strict-mode-Verletzung mit { exact: false } vermeiden: exact-Text nutzen
 *  oder first() wo nötig.
 */
test.describe('Provisioning — als Admin', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, { authenticated: true, role: 'admin' });
  });

  test('lädt die Enrollment-Profile-Tabelle', async ({ page }) => {
    await page.goto('/provisioning');

    // Panel-Header-Text "Enrollment-Profile (1)" ist eindeutig im DOM.
    await expect(page.getByText('Enrollment-Profile (1)', { exact: true })).toBeVisible();

    // Mock-Profil "lab-sensor-01" in der Tabelle.
    await expect(page.getByText('lab-sensor-01').first()).toBeVisible();
  });

  test('lädt die Node-Tabelle', async ({ page }) => {
    await page.goto('/provisioning');

    // Panel-Header-Text "Nodes (1)" ist eindeutig im DOM.
    await expect(page.getByText('Nodes (1)', { exact: true })).toBeVisible();

    // Mock-Node "lab-sensor-01" sichtbar (erscheint in beiden Tabellen — first() reicht).
    await expect(page.getByText('lab-sensor-01').first()).toBeVisible();
  });

  test('zeigt den Button zum Anlegen eines Enrollment-Profils', async ({ page }) => {
    await page.goto('/provisioning');

    // Admin sieht "Profil anlegen"-Button (ProvisioningPage).
    await expect(page.getByRole('button', { name: /Profil anlegen|Anlegen|Neu/i }).first()).toBeVisible();
  });
});

test.describe('Provisioning — als Analyst', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, { authenticated: true, role: 'analyst' });
  });

  test('Analyst sieht keinen Admin-only-Content', async ({ page }) => {
    await page.goto('/provisioning');

    // Weder "Token minten" noch "Profil anlegen" darf sichtbar sein.
    await expect(page.getByRole('button', { name: /Token minten|Profil anlegen/i })).toHaveCount(0);
  });
});
