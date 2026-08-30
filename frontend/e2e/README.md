# E2E-Tests (Playwright)

Deterministische End-to-End-Tests für die kritischen Analyst-Flows des Nexora SOC Orchestrator Frontends.

## Was wird getestet

| Spec | Flow |
|------|------|
| `auth.spec.ts` | JWT-Login: gültig → Dashboard, ungültig → Fehlermeldung, Guard-Redirect auf `/login` |
| `navigation.spec.ts` | App-Shell: Sidebar erreicht Dashboard / Tickets / Threat Hunts / KI Agent |
| `tickets.spec.ts` | Tickets-Liste lädt, Prioritätsfilter, Leer-Zustand |
| `ki-agent.spec.ts` | KI-Agent-Seite lädt, Vorschlagstyp wählbar, Human-in-the-loop-Hinweis |

## Kein Backend nötig

Alle Netzwerk-Requests werden über `page.route()` gemockt — siehe `fixtures/api-mocks.ts`.
Die Mock-Antworten spiegeln die Shapes aus `src/features/*/...Api.ts` und `src/lib/types.ts`.
Authentifizierung läuft über ein vorab in `sessionStorage` gesetztes Bearer-Token
(`seedToken`), exakt wie `lib/apiClient.ts` es erwartet (`soc_token`).

Der `webServer` in `playwright.config.ts` startet nur den Vite-Dev-Server
(Port 5173), damit das React-Bundle ausgeliefert wird.

## Ausführen

```bash
cd frontend

# Browser-Binaries einmalig installieren (nur Chromium nötig):
npx playwright install chromium

# Suite ausführen:
npm run test:e2e

# Interaktiver UI-Modus:
npm run test:e2e:ui

# Nur Test-Plan anzeigen (kein Browser nötig):
npx playwright test --list
```

Der Vite-Server wird automatisch gestartet/gestoppt. Läuft lokal bereits ein Dev-Server
auf Port 5173, wird dieser wiederverwendet (`reuseExistingServer`).

## Konventionen

- Rollen-/Label-basierte Selektoren (`getByRole`, `getByLabel`, `getByText`) — keine brüchigen CSS-Selektoren.
- Web-first Assertions (`expect(locator).toBeVisible()`) mit Auto-Retry — keine festen `waitForTimeout`-Waits.
- Die bestehenden Vitest-Unit-Tests (`*.test.ts(x)`) bleiben unberührt; Playwright nutzt ausschließlich `e2e/`.

## Hinweis zur Typprüfung

Die Specs liegen außerhalb des App-`tsconfig.json` (das nur `src` einschließt) und
werden daher nicht vom `tsc -b`-Build des Frontends erfasst. `e2e/tsconfig.json`
prüft die Specs eigenständig mit den Playwright-Typen.
