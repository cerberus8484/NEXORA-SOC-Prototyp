import { test, expect } from '@playwright/test';
import { mockApi, VALID_EMAIL, VALID_PASSWORD } from './fixtures/api-mocks';

test.describe('Authentifizierung (JWT-Login-Flow)', () => {
  test('zeigt das Login-Formular bei nicht authentifizierter Navigation', async ({ page }) => {
    await mockApi(page);
    await page.goto('/dashboard');

    // RequireAuth → Navigate('/login')
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('button', { name: 'Anmelden' })).toBeVisible();
    await expect(page.getByLabel('E-Mail')).toBeVisible();
    await expect(page.getByLabel('Passwort')).toBeVisible();
  });

  test('meldet gültige Zugangsdaten an und leitet zum Dashboard weiter', async ({ page }) => {
    await mockApi(page);
    await page.goto('/login');

    await page.getByLabel('E-Mail').fill(VALID_EMAIL);
    await page.getByLabel('Passwort').fill(VALID_PASSWORD);
    await page.getByRole('button', { name: 'Anmelden' }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('zeigt bei ungültigen Zugangsdaten eine Fehlermeldung und bleibt auf /login', async ({ page }) => {
    await mockApi(page);
    await page.goto('/login');

    await page.getByLabel('E-Mail').fill(VALID_EMAIL);
    await page.getByLabel('Passwort').fill('falsches-passwort');
    await page.getByRole('button', { name: 'Anmelden' }).click();

    // apiClient bildet jeden 401 auf die feste Meldung "Nicht authentifiziert" ab.
    await expect(page.getByText('Nicht authentifiziert')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });
});
