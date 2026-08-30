import { test, expect } from '@playwright/test';
import { mockApi } from './fixtures/api-mocks';

/**
 * Evidence Center (/evidence) — Happy-Path.
 *
 * Mock liefert ein Evidence-Item (Sysmon Netzwerkverbindung) über GET /evidence
 * und das zugehörige Detail über GET /evidence/:id (mit custody:[]).
 *
 * EvidenceCenterPage rendert:
 *  - StatCards (Evidence Items, Sources, Linked Tickets, Verified Items, Last 24h)
 *  - Filter-Leiste (5x <select> + 1x <input>)
 *  - Tabelle mit den Items
 *  - Detail-Panel (auto-ausgewählt beim ersten Item)
 *
 * Das Item "Sysmon Netzwerkverbindung" erscheint mehrfach im DOM
 * (Tabellenzelle + Detail-Panel-Header + Overview-Card) — first() nutzen.
 *
 * Der Suche-Input hat KEINE searchbox-Rolle — er ist ein plain <input> mit
 * placeholder="title, indicator, hash, ticket, IP …".
 */
test.describe('Evidence Center', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, { authenticated: true });
  });

  test('lädt und zeigt den Evidence-Center-Titel', async ({ page }) => {
    await page.goto('/evidence');

    // SectionHeader title="Evidence Center" — erscheint im Breadcrumb und im Header.
    await expect(page.getByText('Evidence Center', { exact: false }).first()).toBeVisible();
  });

  test('zeigt die Filter-UI mit Dropdowns', async ({ page }) => {
    await page.goto('/evidence');

    // Filter-Leiste enthält 5 <select>-Elemente (Type, Source, Verdict, Status, Time Range).
    await expect(page.getByRole('combobox').first()).toBeVisible();
  });

  test('zeigt das gemockte Evidence-Item in der Tabelle', async ({ page }) => {
    await page.goto('/evidence');

    // Der Titel erscheint in der Tabelle (td), im Detail-Panel-Header und in Overview.
    // first() — nimmt die erste Instanz (Tabellenzelle).
    await expect(page.getByText('Sysmon Netzwerkverbindung').first()).toBeVisible();
  });

  test('zeigt die Suche-Input-Box', async ({ page }) => {
    await page.goto('/evidence');

    // EvidenceCenterPage: plain <input> ohne type="search".
    // Selektor über den exakten Placeholder-Text aus dem Quellcode.
    await expect(page.getByPlaceholder('title, indicator, hash, ticket, IP …')).toBeVisible();
  });
});
