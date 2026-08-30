import { test, expect } from '@playwright/test';
import { mockApi } from './fixtures/api-mocks';

/**
 * App-Shell-Navigation: Sidebar erreicht die kritischen Analyst-Seiten.
 *
 * Nach dem Nav-Umbau (entschlankt): die Kategorien Hunting/Detection/Integrations/
 * Monitoring/Administration sind je EIN Sidebar-Eintrag (Kategorie-Landing); ihre
 * Unterseiten liegen als Kacheln auf der Übersichtsseite, nicht mehr in der Sidebar.
 * Direkte Sidebar-Einträge bleiben: Dashboard, Operations (Analysis/Tickets/Evidence),
 * Settings, Compliance, Account.
 */
test.describe('App-Shell-Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, { authenticated: true });
  });

  test('rendert die Sidebar mit den Kern-Navigationspunkten', async ({ page }) => {
    await page.goto('/dashboard');
    const nav = page.getByRole('navigation', { name: 'Hauptnavigation' });

    // exact:true — sonst kollidiert "Dashboard" mit "Wazuh Dashboard".
    await expect(nav.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Tickets', exact: true })).toBeVisible();
    // Kategorie-Einträge (nur die Kategorie, nicht die Unterseiten):
    await expect(nav.getByRole('link', { name: 'Hunting', exact: true })).toBeVisible();
    // Monitoring statt Administration: Administration hält jetzt nur noch die admin-only
    // Services-Seite → für den (Nicht-Admin-)Mock-User nicht sichtbar. Monitoring (Hosts,
    // ungegated) ist rollenunabhängig sichtbar und damit ein stabiler Kategorie-Check.
    await expect(nav.getByRole('link', { name: 'Monitoring', exact: true })).toBeVisible();
    // Die Unterseite "Threat Hunts" ist NICHT mehr direkt in der Sidebar.
    await expect(nav.getByRole('link', { name: 'Threat Hunts', exact: true })).toHaveCount(0);
  });

  test('navigiert über die Sidebar zu Tickets', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Tickets', exact: true }).click();

    await expect(page).toHaveURL(/\/tickets$/);
    // SectionHeader rendert <h2>Tickets</h2> — getByRole(heading) vermeidet Ambiguität
    // mit Nav-Link, Breadcrumb-Span und Pagination-Text.
    await expect(page.getByRole('heading', { name: 'Tickets', exact: true })).toBeVisible();
  });

  test('erreicht Threat Hunts über Hunting-Kategorie → Übersicht → Kachel', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Hunting', exact: true }).click();
    await expect(page).toHaveURL(/\/hunting$/);

    // Auf der Kategorie-Übersicht die Threat-Hunts-Kachel öffnen (aria-label "<Label> öffnen").
    await page.getByRole('link', { name: /Threat Hunts öffnen/i }).click();
    await expect(page).toHaveURL(/\/threat-hunts$/);
  });

  test('erreicht KI Agent über KI-/Automation-Kategorie → Übersicht → Kachel', async ({ page }) => {
    await page.goto('/dashboard');
    // KI Agent liegt jetzt in der eigenen Gruppe „KI / Automation" (aus Administration gelöst).
    await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'KI / Automation', exact: true }).click();
    await expect(page).toHaveURL(/\/ki$/);

    await page.getByRole('link', { name: /KI Agent öffnen/i }).click();
    await expect(page).toHaveURL(/\/ki-agent$/);
    // Als Analyst: Permission-Gate "Keine Berechtigung" sichtbar.
    await expect(page.getByText('Keine Berechtigung')).toBeVisible();
  });
});
