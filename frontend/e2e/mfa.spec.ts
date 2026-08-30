import { test, expect, type Page, type Route } from '@playwright/test';
import { mockApi, VALID_EMAIL, VALID_PASSWORD, MOCK_USER } from './fixtures/api-mocks';

/**
 * E2E-Tests für MFA-Flows.
 *
 * Deckung:
 *   1. Settings → Sicherheit → MFA einrichten (Enroll-Flow: idle → showSecret → done)
 *   2. Settings → Sicherheit → MFA deaktivieren (Disable-Flow)
 *   3. Login-Challenge: MFA-User → Code-Eingabe → falscher Code bleibt → richtiger Code → Dashboard
 *
 * Mocking-Strategie: mockApi() für das Basis-Scaffolding (Auth, Nav, Settings-Platform);
 * gezielte page.route()-Overrides für die MFA-spezifischen Endpunkte pro Test.
 * Alle Overrides werden VOR dem Navigieren registriert — Playwright matcht die
 * spezifischere Route zuerst (LIFO innerhalb desselben Musters).
 */

// ── Mock-Helfer ───────────────────────────────────────────────────────────────

function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

const MFA_EMAIL = 'mfa@nexora.example';
const MFA_PASSWORD = 'DevMfa123!';
const CHALLENGE_TOKEN = 'chal-e2e-test';

const MOCK_SECRET = 'JBSWY3DPEHPK3PXP';
const MOCK_OTPAUTH = 'otpauth://totp/Nexora%20SOC:mfa%40nexora.example?secret=JBSWY3DPEHPK3PXP&issuer=Nexora%20SOC';
const MOCK_RECOVERY_CODES = ['aaaaa-bbbbb', 'ccccc-ddddd', 'eeeee-fffff', 'ggggg-hhhhh'];

/** Navigiert als Admin zur Settings-Seite und klickt auf den „Sicherheit"-Tab. */
async function gotoSecurityTab(page: Page): Promise<void> {
  await page.goto('/settings');
  // Der „Sicherheit"-Tab ist nur für Admins sichtbar.
  // Die Tab-Leiste rendert role="tab" (tablist + tab), nicht role="button".
  await page.getByRole('tab', { name: 'Sicherheit' }).click();
}

// ── Suite 1: MFA Settings-Flows ──────────────────────────────────────────────

test.describe('MFA Settings — Enroll-Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Admin-Session: Sicherheit-Tab ist für Admin-Rolle sichtbar.
    await mockApi(page, { authenticated: true, role: 'admin' });

    // Platform/Settings-Endpunkte die SecurityTab braucht
    await page.route('**/api/v1/settings/platform', (route) =>
      fulfillJson(route, {
        data: {
          passwordMinLength: 8,
          passwordComplexity: 'medium',
          sessionMaxHours: 8,
          lockoutMaxAttempts: 0,
          lockoutMinutes: 15,
          passwordHistoryCount: 0,
          passwordExpiryDays: 0,
          maxConcurrentSessions: 0,
          inactivityTimeoutMinutes: 0,
          tlsEnforce: false,
          ipAllowlistEnabled: false,
          ipAllowlistCidrs: '',
        },
      })
    );

    // System-Stats für die Settings-Seite
    await page.route('**/api/v1/system/stats', (route) =>
      fulfillJson(route, { data: { counts: { users: 1, tickets: 0, hunts: 0, evidence: 0, events: 0, findings: 0 }, storage: { dbBytes: 1024 } } })
    );
  });

  test('zeigt MFA-Status „Nicht eingerichtet" auf der Sicherheit-Seite', async ({ page }) => {
    await page.route('**/api/v1/mfa/status', (route) =>
      fulfillJson(route, { status: 'none' })
    );

    await gotoSecurityTab(page);

    // MFA-Card Titel sichtbar
    await expect(page.getByText('Zwei-Faktor-Authentifizierung (TOTP)')).toBeVisible();
    // „MFA einrichten"-Button zeigt Idle-Zustand
    await expect(page.getByRole('button', { name: 'MFA einrichten' })).toBeVisible();
  });

  test('vollständiger Enroll-Flow: Secret sichtbar → Code eingeben → Recovery-Codes → Aktiv', async ({ page }) => {
    // Startstatus: keine MFA
    await page.route('**/api/v1/mfa/status', (route) =>
      fulfillJson(route, { status: 'none' })
    );
    await page.route('**/api/v1/mfa/enroll', (route) =>
      fulfillJson(route, {
        secret: MOCK_SECRET,
        otpauthUri: MOCK_OTPAUTH,
        enrollment: { status: 'pending' },
      })
    );
    await page.route('**/api/v1/mfa/verify', (route) =>
      fulfillJson(route, {
        recoveryCodes: MOCK_RECOVERY_CODES,
        enrollment: { status: 'active' },
      })
    );

    await gotoSecurityTab(page);

    // Schritt 1: MFA einrichten starten
    await page.getByRole('button', { name: 'MFA einrichten' }).click();

    // Schritt 2: Secret-Ansicht — geheimer Schlüssel sichtbar (exact:true wegen otpauth-URI)
    await expect(page.getByText(MOCK_SECRET, { exact: true })).toBeVisible();
    await expect(page.getByText('Code aus der App (6 Ziffern)')).toBeVisible();

    // Schritt 3: 6-stelligen Code eingeben
    await page.getByLabel('Code aus der App (6 Ziffern)').fill('123456');

    // Schritt 4: Bestätigen & aktivieren klicken
    await page.getByRole('button', { name: 'Bestätigen & aktivieren' }).click();

    // Schritt 5: Recovery-Codes werden genau einmal angezeigt
    await expect(page.getByText(MOCK_RECOVERY_CODES[0])).toBeVisible();
    await expect(page.getByText('Jetzt sicher speichern.')).toBeVisible();

    // Schritt 6: „Habe ich gespeichert" beendet den Flow
    // Nach finishEnroll() wird getStatus() neu geladen → active
    await page.route('**/api/v1/mfa/status', (route) =>
      fulfillJson(route, { status: 'active', recoveryCodesRemaining: 4, recoveryCodesTotal: 4 })
    );
    await page.getByRole('button', { name: 'Habe ich gespeichert' }).click();

    // MFA ist jetzt aktiv: Deaktivieren-Button erscheint
    await expect(page.getByRole('button', { name: 'MFA deaktivieren' })).toBeVisible();
  });

  test('Abbrechen im Enroll-Flow kehrt zur Idle-Ansicht zurück', async ({ page }) => {
    await page.route('**/api/v1/mfa/status', (route) =>
      fulfillJson(route, { status: 'none' })
    );
    await page.route('**/api/v1/mfa/enroll', (route) =>
      fulfillJson(route, {
        secret: MOCK_SECRET,
        otpauthUri: MOCK_OTPAUTH,
        enrollment: { status: 'pending' },
      })
    );

    await gotoSecurityTab(page);
    await page.getByRole('button', { name: 'MFA einrichten' }).click();

    // Secret-Ansicht ist aktiv (exact:true wegen otpauth-URI, die den Schlüssel enthält)
    await expect(page.getByText(MOCK_SECRET, { exact: true })).toBeVisible();

    // Abbrechen → zurück zur Idle-Ansicht
    await page.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(page.getByRole('button', { name: 'MFA einrichten' })).toBeVisible();
    await expect(page.getByText(MOCK_SECRET, { exact: true })).not.toBeVisible();
  });
});

test.describe('MFA Settings — Disable-Flow', () => {
  test('MFA deaktivieren: Code eingeben → Status wechselt zu „Deaktiviert"', async ({ page }) => {
    await mockApi(page, { authenticated: true, role: 'admin' });

    // Platform-Endpunkte
    await page.route('**/api/v1/settings/platform', (route) =>
      fulfillJson(route, { data: { passwordMinLength: 8, passwordComplexity: 'medium', sessionMaxHours: 8, lockoutMaxAttempts: 0, lockoutMinutes: 15, passwordHistoryCount: 0, passwordExpiryDays: 0, maxConcurrentSessions: 0, inactivityTimeoutMinutes: 0, tlsEnforce: false, ipAllowlistEnabled: false, ipAllowlistCidrs: '' } })
    );
    await page.route('**/api/v1/system/stats', (route) =>
      fulfillJson(route, { data: { counts: { users: 1, tickets: 0, hunts: 0, evidence: 0, events: 0, findings: 0 }, storage: { dbBytes: 1024 } } })
    );

    // MFA initial aktiv
    await page.route('**/api/v1/mfa/status', (route) =>
      fulfillJson(route, { status: 'active', recoveryCodesRemaining: 4, recoveryCodesTotal: 4 })
    );
    await page.route('**/api/v1/mfa/disable', (route) =>
      fulfillJson(route, { status: 'disabled' })
    );

    await gotoSecurityTab(page);

    // MFA ist aktiv → Deaktivieren-Button sichtbar
    await expect(page.getByRole('button', { name: 'MFA deaktivieren' })).toBeVisible();

    // Disable-Flow starten
    await page.getByRole('button', { name: 'MFA deaktivieren' }).click();

    // Disable-Formular erscheint
    await expect(page.getByText('TOTP- oder Recovery-Code')).toBeVisible();

    // Code eingeben (6-stelliger TOTP ist gültig nach isValidDisableCode)
    await page.getByLabel('TOTP- oder Recovery-Code').fill('654321');

    // Nach Deaktivierung: getStatus liefert 'disabled' → MFA einrichten-Button erscheint wieder
    await page.route('**/api/v1/mfa/status', (route) =>
      fulfillJson(route, { status: 'disabled' })
    );

    await page.getByRole('button', { name: 'MFA deaktivieren' }).last().click();

    // Status ist jetzt deaktiviert → Enroll-Button erscheint wieder
    await expect(page.getByRole('button', { name: 'MFA einrichten' })).toBeVisible();
  });
});

// ── Suite 2: Login-Challenge-Flow ─────────────────────────────────────────────

test.describe('Login — MFA-Challenge-Flow', () => {
  test('MFA-User sieht Code-Eingabe statt Dashboard nach Passwort-Login', async ({ page }) => {
    // Basis-Mock ohne authenticated=true — der MFA-User ist anfangs NICHT eingeloggt
    await mockApi(page);

    // Login liefert mfaRequired: true statt direktem Token
    await page.route('**/api/v1/auth/login', (route) => {
      const payload = route.request().postDataJSON() as { email?: string; password?: string };
      if (payload?.email === MFA_EMAIL && payload?.password === MFA_PASSWORD) {
        return fulfillJson(route, { mfaRequired: true, challengeToken: CHALLENGE_TOKEN });
      }
      return fulfillJson(route, { error: 'INVALID_CREDENTIALS', message: 'E-Mail oder Passwort ungültig' }, 401);
    });

    await page.goto('/login');
    await page.getByLabel('Email').fill(MFA_EMAIL);
    await page.getByLabel('Password').fill(MFA_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Dashboard wird NICHT angezeigt — stattdessen MFA-Challenge
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText('Two-factor confirmation required')).toBeVisible();
    await expect(page.getByLabel('Confirmation code')).toBeVisible();
  });

  test('falscher MFA-Code: Fehler sichtbar, bleibt auf Login', async ({ page }) => {
    await mockApi(page);

    await page.route('**/api/v1/auth/login', (route) =>
      fulfillJson(route, { mfaRequired: true, challengeToken: CHALLENGE_TOKEN })
    );
    await page.route('**/api/v1/auth/mfa', (route) =>
      fulfillJson(route, { error: 'INVALID_CODE', message: 'Code ungültig oder abgelaufen' }, 401)
    );

    await page.goto('/login');
    await page.getByLabel('Email').fill(MFA_EMAIL);
    await page.getByLabel('Password').fill(MFA_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // MFA-Challenge sichtbar
    await expect(page.getByText('Two-factor confirmation required')).toBeVisible();

    // Falschen Code eingeben und absenden
    await page.getByLabel('Confirmation code').fill('000000');
    await page.getByRole('button', { name: 'Confirm' }).click();

    // Fehler-Anzeige — bleibt auf /login
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('richtiger MFA-Code führt zum Dashboard', async ({ page }) => {
    // Reihenfolge: mockApi() zuerst (fängt alle /api/v1/** ab), dann spezifische
    // Overrides danach — Playwright nutzt LIFO, die spezielleren gewinnen.
    //
    // Stateful Mock: /auth/me liefert 401 bis MFA abgeschlossen ist, dann User.
    // Das Dashboard prüft /auth/me (RequireAuth) nach der Navigation.
    let mfaCompleted = false;

    // 1. Basis-Scaffolding (fängt alles, was kein Override hat)
    await mockApi(page);

    // 2. Spezifische Overrides (LIFO → gewinnen gegen mockApi's catch-all)
    await page.route('**/api/v1/auth/me', (route) => {
      if (mfaCompleted) return fulfillJson(route, { data: MOCK_USER });
      return fulfillJson(route, { error: 'UNAUTHORIZED', message: 'Nicht authentifiziert' }, 401);
    });

    await page.route('**/api/v1/auth/login', (route) => {
      const payload = route.request().postDataJSON() as { email?: string; password?: string };
      if (payload?.email === MFA_EMAIL && payload?.password === MFA_PASSWORD) {
        return fulfillJson(route, { mfaRequired: true, challengeToken: CHALLENGE_TOKEN });
      }
      return fulfillJson(route, { error: 'INVALID_CREDENTIALS', message: 'E-Mail oder Passwort ungültig' }, 401);
    });

    await page.route('**/api/v1/auth/mfa', async (route) => {
      mfaCompleted = true;
      return fulfillJson(route, { token: 'e2e-mfa-token', user: MOCK_USER });
    });

    await page.goto('/login');
    await page.getByLabel('Email').fill(MFA_EMAIL);
    await page.getByLabel('Password').fill(MFA_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // MFA-Challenge erscheint
    await expect(page.getByText('Two-factor confirmation required')).toBeVisible();

    // Richtigen Code eingeben
    await page.getByLabel('Confirmation code').fill('123456');
    await page.getByRole('button', { name: 'Confirm' }).click();

    // Weiterleitung zum Dashboard
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('„Zurück"-Button im MFA-Schritt kehrt zur Passwort-Eingabe zurück', async ({ page }) => {
    await mockApi(page);

    await page.route('**/api/v1/auth/login', (route) =>
      fulfillJson(route, { mfaRequired: true, challengeToken: CHALLENGE_TOKEN })
    );

    await page.goto('/login');
    await page.getByLabel('Email').fill(MFA_EMAIL);
    await page.getByLabel('Password').fill(MFA_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // MFA-Challenge aktiv
    await expect(page.getByText('Two-factor confirmation required')).toBeVisible();

    // Zurück-Button → Passwort-Eingabe erscheint wieder
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByText('Two-factor confirmation required')).not.toBeVisible();
  });
});
