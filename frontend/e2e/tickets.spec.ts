import { test, expect } from '@playwright/test';
import { mockApi, MOCK_TICKETS } from './fixtures/api-mocks';

/**
 * Tickets-Liste (/tickets).
 *
 * Fixes (Drift seit 2026-06-14):
 * - Auth: Cookie-Modell — kein seedToken mehr, authenticated-Flag steuert /auth/me.
 * - Heading-Selektor: SectionHeader rendert keinen <h1>, verwendet 'Tickets' als Text
 *   in der Komponente — toBeVisible() auf getByText() statt getByRole('heading').
 * - Filter-Comboboxen: State (index 0) · Status (index 1) · Priorität (index 2).
 *   Der Mock filtert auf state=OPEN (Default), priority kommt über Query-Param.
 */
test.describe('Tickets-Liste', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, { authenticated: true });
  });

  test('lädt die Ticket-Liste mit den gemockten Incidents', async ({ page }) => {
    await page.goto('/tickets');

    // SectionHeader rendert den Titel; auf jeden Fall als sichtbaren Text vorhanden.
    await expect(page.getByText('Tickets', { exact: true }).first()).toBeVisible();

    for (const t of MOCK_TICKETS) {
      // Ticket-Nr in der Nr.-Spalte (td-Zelle).
      await expect(page.getByRole('cell', { name: t.ticketNr, exact: true })).toBeVisible();
      // Titel als Link in der Titel-Spalte.
      await expect(page.getByRole('link', { name: t.title })).toBeVisible();
    }
  });

  test('filtert nach Priorität (Server-Roundtrip via Query-Param)', async ({ page }) => {
    await page.goto('/tickets');

    // Sicherstellen, dass beide Tickets initial sichtbar sind.
    await expect(page.getByRole('cell', { name: 'INC000001', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'INC000002', exact: true })).toBeVisible();

    // Priorität "High" wählen — dritter <select> (index 2: State, Status, Priorität).
    await page.getByRole('combobox').nth(2).selectOption('high');

    // INC000001 (high) bleibt, INC000002 (medium) verschwindet.
    await expect(page.getByRole('cell', { name: 'INC000001', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'INC000002', exact: true })).toHaveCount(0);
  });

  test('zeigt einen Leer-Zustand, wenn der Filter nichts trifft', async ({ page }) => {
    await page.goto('/tickets');

    // "low" liefert kein gemocktes Ticket.
    await page.getByRole('combobox').nth(2).selectOption('low');

    await expect(page.getByText('Keine Tickets')).toBeVisible();
  });
});
