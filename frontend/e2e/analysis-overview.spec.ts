import { test, expect } from '@playwright/test';
import { mockApi } from './fixtures/api-mocks';

// Analysis → Overview (P_UX_3 Workbench): Header-Ticket-Switcher, horizontale Top-Nav,
// Case Header, 2-spaltiges Preview-Grid, rechte Decision Rail. Gemockte API (kein Backend).

test.describe('Analysis Overview', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, { authenticated: true, role: 'admin' });
  });

  test('zeigt Header-Switcher, Top-Nav, Case Header, Grid und Decision Rail', async ({ page }) => {
    await page.goto('/analysis?ticket=tkt-1');

    // Ticket-Switcher im globalen Header
    await expect(page.getByRole('button', { name: /Aktives Ticket wechseln/i })).toBeVisible();

    // Horizontale Analysis-Navigation, Overview aktiv (aria-current)
    const nav = page.getByRole('navigation', { name: /Analysis-Bereiche/i });
    await expect(nav).toBeVisible();
    await expect(nav.locator('button[aria-current="page"]')).toHaveText(/Overview/);

    // Case Header (Titel aus dem Mock-Ticket)
    await expect(page.getByText('Verdächtige PowerShell-Ausführung auf WEC01')).toBeVisible();

    // Preview-Grid: echte Workbench-Karten (P_UX_3)
    await expect(page.getByText('Evidence Preview').first()).toBeVisible();
    await expect(page.getByText('Top Conversations').first()).toBeVisible();
    await expect(page.getByText('Communication Map').first()).toBeVisible();

    // Rechte Decision Rail
    await expect(page.getByText('Analyst Summary').first()).toBeVisible();
    await expect(page.getByText('Risk & Impact').first()).toBeVisible();
    await expect(page.getByText('Evidence Actions').first()).toBeVisible();

    await page.screenshot({ path: 'test-results/analysis-overview.png', fullPage: true });
  });

  test('Ticket-Switcher öffnet ein Dropdown mit Suche', async ({ page }) => {
    await page.goto('/analysis?ticket=tkt-1');
    await page.getByRole('button', { name: /Aktives Ticket wechseln/i }).click();
    await expect(page.getByPlaceholder(/Tickets suchen/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Alle Tickets öffnen/i })).toBeVisible();
  });

  test('persists the selected investigation tab in the ticket URL', async ({ page }) => {
    await page.goto('/analysis?ticket=tkt-1&tab=timeline');

    const nav = page.getByRole('navigation', { name: /Analysis-Bereiche/i });
    await expect(nav.locator('button[aria-current="page"]')).toHaveText(/Timeline/);

    await nav.getByRole('button', { name: /Network & NAT/i }).click();
    await expect(page).toHaveURL(/\/analysis\?ticket=tkt-1&tab=network/);
  });
});
