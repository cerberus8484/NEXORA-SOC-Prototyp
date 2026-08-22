import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright-Konfig für E2E gegen ein ECHTES Backend (kein Mock).
 *
 * Startet zwei Server: das Express-Backend im InMemory-Modus (kein Postgres nötig)
 * mit per ENV geseedetem Admin, und den Vite-Dev-Server, dessen /api-Proxy auf das
 * Backend zeigt. Deckt die sicherheitskritischen Auth-/RBAC-Flows real ab.
 */
const FE_PORT = Number(process.env.E2E_REAL_PORT ?? 5174);
const BE_PORT = Number(process.env.E2E_REAL_API_PORT ?? 3001);
const BASE_URL = `http://localhost:${FE_PORT}`;

export default defineConfig({
  testDir: './e2e-real',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,           // geteiltes echtes Backend → seriell
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: { baseURL: BASE_URL, trace: 'on-first-retry', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      command: 'node ../backend/src/server.js',
      url: `http://localhost:${BE_PORT}/api/v1/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
      env: {
        NODE_ENV:       'test',
        PORT:           String(BE_PORT),
        // JWT_SECRET muss >= 32 Zeichen sein (AuthService-Guard); kein echtes Secret.
        JWT_SECRET:     'e2e-test-secret-min-32-chars-0123456789',
        ADMIN_EMAIL:    'e2e-admin@nexora.example',
        ADMIN_PASSWORD: 'E2eAdmin123!',
        // E2E-Fixture: kein Erstanmeldungs-Passwortwechsel — der Auth-Smoke prüft den
        // Login→Dashboard-Rand, nicht den Passwort-Lifecycle.
        ADMIN_MUST_CHANGE_PASSWORD: 'false',
        LOG_LEVEL:      'warn',
        // DB_ENABLED unset → InMemory · MFA_ENABLED unset → kein MFA-Zwang im Auth-Smoke.
      },
    },
    {
      command: `npm run dev -- --port ${FE_PORT} --strictPort`,
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
      env: { VITE_API_TARGET: `http://localhost:${BE_PORT}` },
    },
  ],
});
