import { test, expect } from '@playwright/test';
import { mockApi } from './fixtures/api-mocks';

/**
 * KI-Agent-Konfigurationsseite (/ki-agent).
 *
 * Die Seite ist admin-only — als Analyst erscheint der Permission-Gate
 * "Keine Berechtigung". Für Admin-sichtbaren Content wird role:'admin' gesetzt.
 *
 * Fixes (Drift seit 2026-06-14):
 * - Seite hat KEINE "Vorschlagstyp wählen"-Auswahl mehr — operative KI
 *   liegt im Analysis-Deck → Tab "KI Analyse". Diese Seite ist reine Konfiguration.
 * - "KI führt NICHT automatisch aus" → echter DOM-Text ist im <p>-Body:
 *   "Der KI-Agent führt keine Aktionen automatisch aus."
 * - Als Analyst: Permission-Gate mit "Keine Berechtigung" + Erklärtext.
 * - Als Admin: KI-Konfigurationsinhalt (Heading, HITL-Card) sichtbar.
 */
test.describe('KI-Agent-Seite — als Analyst (Permission-Gate)', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, { authenticated: true, role: 'analyst' });
  });

  test('zeigt den Permission-Gate für Analysten', async ({ page }) => {
    await page.goto('/ki-agent');
    await expect(page.getByText('Keine Berechtigung')).toBeVisible();
    await expect(page.getByText('KI-Agent-Konfiguration ist Administratoren vorbehalten')).toBeVisible();
  });
});

test.describe('KI-Agent-Seite — als Admin (Konfiguration)', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, { authenticated: true, role: 'admin' });
  });

  test('lädt und zeigt die KI-Konfigurationsüberschrift', async ({ page }) => {
    await page.goto('/ki-agent');
    await expect(page.getByRole('heading', { name: /KI Agent/i })).toBeVisible();
  });

  test('zeigt die HITL-Card mit Modus Manuelle Freigabe', async ({ page }) => {
    await page.goto('/ki-agent');
    await expect(page.getByText('Human-in-the-Loop & Confidence')).toBeVisible();
    await expect(page.getByText('Manuelle Freigabe aktiv')).toBeVisible();
  });

  test('weist darauf hin, dass die KI keine Aktionen automatisch ausführt', async ({ page }) => {
    await page.goto('/ki-agent');
    // Echter DOM-Text in der HITL-Card (KiAgentPage.tsx, HitlCard).
    await expect(page.getByText('führt keine Aktionen automatisch aus', { exact: false })).toBeVisible();
  });

  test('zeigt den Link zu den Autonomy-Policies', async ({ page }) => {
    await page.goto('/ki-agent');
    await expect(page.getByRole('link', { name: /Autonomy-Policies/i })).toBeVisible();
  });
});
