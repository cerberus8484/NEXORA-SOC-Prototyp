import { test, expect } from '@playwright/test';

// ── E2E gegen ein ECHTES Backend (InMemory, kein Mock) ───────────────────────
// Der seeded Admin kommt aus ADMIN_EMAIL/ADMIN_PASSWORD (ensureAdminFromEnv beim Boot,
// gesetzt in playwright.real.config.ts). Beweist den Auth-/RBAC-Sicherheitsrand
// end-to-end: echter Login, echte 401, echte RequireAuth-Umleitung, echte Cookie-Session.

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'e2e-admin@nexora.example';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'E2eAdmin123!';

test.describe('Auth gegen echtes Backend', () => {
  test('unauthentifiziert → RequireAuth leitet auf /login', async ({ page }) => {
    await page.goto('/tickets');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('button', { name: 'Anmelden' })).toBeVisible();
  });

  test('korrekte Admin-Credentials → echte Session → Dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill(ADMIN_EMAIL);
    await page.getByLabel('Passwort').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Anmelden' }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('falsches Passwort → echte 401, bleibt auf /login', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill(ADMIN_EMAIL);
    await page.getByLabel('Passwort').fill('definitiv-falsch');
    await page.getByRole('button', { name: 'Anmelden' }).click();

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('Session überlebt Reload (httpOnly-Cookie, echtes /auth/me)', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill(ADMIN_EMAIL);
    await page.getByLabel('Passwort').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.reload();
    await expect(page).toHaveURL(/\/dashboard$/); // nicht zurück auf /login
  });
});
