# Contributing zu Nexora SOC

Danke für dein Interesse. Nexora ist ein selbst-gehostetes SOC-Werkzeug (Apache-2.0)
für Tier 1–3 — Incident-Tickets, Threat Hunting, KI-Triage mit Human-Approval. Es
verarbeitet **sicherheitssensible SOC-Daten**; entsprechend hoch ist die Latte für
Tests, Nachvollziehbarkeit und Datenschutz. Bitte lies dieses Dokument, bevor du
einen Pull Request öffnest.

Verbindlicher Kontext vor dem ersten Commit:

- [`ROADMAP.md`](ROADMAP.md) — aktuelle Phase, Architektur-Regeln, Definition of Done.
- [`docs/adr/decisions.md`](docs/adr/decisions.md) — ADRs (u. a. ADR-009
  „keine Fake-Daten").
- [`SECURITY.md`](SECURITY.md) — Schwachstellen **nicht** als PR/Issue, sondern privat melden.

---

## Setup

Das ausführliche Setup steht im **Developer Guide**:
[`docs/04-developer-guide/developer-guide.html`](docs/04-developer-guide/developer-guide.html). Kurzfassung:

```bash
# Backend (Express + Postgres)
cd backend && npm install
npm run seed:admin            # Dev-Admin anlegen (nur lokal)
npm run dev

# Frontend (React + TS + Vite)
cd frontend && npm install
npm run dev

# Voller Stack lokal (Postgres + API + Frontend, Hot-Reload)
docker compose -f docker-compose.dev.yml up -d
# Frontend http://localhost:5173 · API http://localhost:3000
```

Repositories laufen ohne `DB_ENABLED=true` als **InMemory** (flüchtig, gut für Tests/Dev);
mit `DB_ENABLED=true` gegen **Postgres**. Beides muss funktionieren — siehe Repository-Muster unten.

---

## Branch- und Commit-Konventionen

- Arbeite **nie direkt auf `main`** — Feature-/Fix-Branch anlegen
  (z. B. `feat/qradar-go-live`, `fix/hmac-replay-window`).
- **Conventional Commits** sind Pflicht. Erlaubte Typen:

  | Typ        | Wofür |
  |------------|-------|
  | `feat`     | neue Funktion |
  | `fix`      | Bugfix |
  | `refactor` | Umbau ohne Verhaltensänderung |
  | `docs`     | nur Doku |
  | `test`     | nur Tests |
  | `chore`    | Build/Tooling/Abhängigkeiten |
  | `perf`     | Performance |
  | `ci`       | CI/CD |

  Format: `<typ>: <kurze Beschreibung>` — die Message beschreibt **warum**, nicht nur was.
  Beispiel: `fix(integrations): QRadar-Dedup restart-sicher gegen Tickets-Tabelle`.

---

## Test-Pflicht

> **Keine Funktion ohne Test.** (ROADMAP-Regel, nicht verhandelbar.)
> Jede neue Funktion und jeder Bugfix braucht einen Test — Bugfixes als
> Regressionstest, der vorher rot war.

**Backend** (Jest, läuft `--runInBand`):

```bash
cd backend
npm test
```

**Frontend** (Vitest + TypeScript-Build muss sauber sein):

```bash
cd frontend
npx vitest run
npx tsc -b --noEmit
```

**E2E** (Playwright, kritische User-Flows):

```bash
cd frontend
npm run test:e2e
```

Vor dem PR müssen Backend-Jest **und** Frontend-Vitest **und** `tsc -b --noEmit` grün sein.
Wenn alles grün ist: committen — keine langen manuellen Re-Checks.

---

## Coding-Standards

- **Repository-Muster:** Datenzugriff hinter einem Repo-Interface. Pro Domäne eine
  InMemory- **und** eine Postgres-Implementierung, ausgewählt über die Domänen-Factory
  (`DB_ENABLED`). Business-Logik hängt am Interface, nicht am Storage.
- **Adapter-Pflicht:** Keine Integration ohne Adapter-Layer. Externes Datenmodell ≠
  internes Modell — externer Input wird validiert, normalisiert, dann erst zum Ticket
  (siehe `backend/src/integrations/adapters/`).
- **Kein silent fail:** Fehler explizit behandeln und loggen, nie verschlucken.
  Eingehende Webhooks/Payloads immer validieren (Joi-Schemas), bevor sie verarbeitet werden.
- **Keine Secrets im Code oder in Logs.** Konfiguration über ENV / `deploy/.env.production`.
  Required Secrets beim Start prüfen (fail-fast), nicht zur Laufzeit raten.
- **Keine Fake-Daten** (ADR-009): Bereiche ohne echte Quelle zeigen ehrliche
  Leerzustände — keine erfundenen Charts/Zahlen.
- **Frontend:** XSS vermeiden — `element.textContent`, nie `innerHTML = userInput`.
  Farben über CSS-Variablen (Dark/Light), keine hartkodierten Hex-Werte für Hintergründe/Text.
- Funktionen klein (< 50 Zeilen), Dateien fokussiert (< 800 Zeilen), keine tiefe
  Verschachtelung (> 4 Ebenen).

---

## Pull-Request-Prozess

1. Branch von aktuellem `main` ziehen, Änderung klein und fokussiert halten.
2. Tests schreiben/erweitern, alle Suites lokal grün (siehe oben).
3. PR öffnen mit:
   - **Was & Warum** — Problem, Lösung, ggf. betroffene ADR/Roadmap-Phase.
   - **Test-Plan** — welche Suites liefen, was wurde manuell verifiziert.
   - bei sicherheits- oder integrationsrelevantem Code: Hinweis auf neue
     Angriffsoberfläche und wie sie abgesichert ist.
4. CI/CD muss grün sein, keine offenen Merge-Konflikte, Branch aktuell zu `main`.

## Code-Review-Erwartung

- Jeder PR wird reviewt, bevor er auf `main` landet — Selbst-Merge ohne Review nicht.
- **Security-Review verpflichtend**, wenn der PR Auth/RBAC, Audit-Log, Integrations-/
  Webhook-Pfade, Datenbank-Migrationen oder Lösch-/Export-Funktionen berührt.
- Schweregrade: **CRITICAL** blockt den Merge, **HIGH** sollte vor dem Merge gefixt sein,
  **MEDIUM/LOW** nach Ermessen.
- Reviews bewerten neben Korrektheit auch Wandelbarkeit, Testbarkeit und
  Datenschutz (verarbeitet der Code PII? neue Angriffsoberfläche?).
