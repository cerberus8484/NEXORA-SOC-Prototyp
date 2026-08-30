import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E-Konfiguration — Nexora SOC Orchestrator (Frontend).
 *
 * Die Specs mocken alle Netzwerk-Requests via page.route() (siehe e2e/fixtures),
 * d. h. die Suite läuft OHNE laufendes Backend grün. Der webServer startet nur
 * den Vite-Dev-Server, damit das React-Bundle ausgeliefert wird.
 *
 * baseURL: Vite-Default-Port 5173 (siehe package.json "dev": "vite").
 */
const PORT = Number(process.env.E2E_PORT ?? 5173);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  // Deterministische Tests: keine versteckten Auto-Waits über das Default-Limit hinaus.
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Firefox/WebKit optional — bei Bedarf einkommentieren:
    // { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],

  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
