# GitHub Copilot — Instructions für Nexora SOC

> Repo-weite Custom Instructions. Sie werden automatisch auf Copilot-Chat/Completions in diesem
> Repository angewendet. Halte dich daran wie an `CLAUDE.md`. Verbindlicher Kontext vor Änderungen:
> [`ROADMAP.md`](../ROADMAP.md), [`CONTRIBUTING.md`](../CONTRIBUTING.md),
> [`docs/adr/decisions.md`](../docs/adr/decisions.md), [`docs/00-overview/feature-status.md`](../docs/00-overview/feature-status.md).

## Was ist Nexora

Self-hosted SOC-Orchestrierungsplattform (Tier 1–3): Incident-Tickets, Threat Hunting (MITRE-gemappt),
Evidence/Chain-of-Custody, Threat-Intel-Anreicherung, KI-Triage mit Human-Approval, read-only Control-Plane.
**Nexora konsumiert und korreliert SIEM-Daten — kein SIEM-/EDR-Ersatz, keine automatische Bedrohungsentfernung.**

- **UI-Sprache:** Deutsch. **Code-Kommentare:** Deutsch/Englisch.
- **Stack:** React 18 + TypeScript + Vite (`frontend/`) · Node.js/Express + PostgreSQL (`backend/`) · Docker · Wazuh.
  KI auf Ollama (Cloud-Provider opt-in). Data-Plane/Korrelatoren in `dataplane/`.

## Hardrules (nicht verhandelbar)

1. **Keine Funktion ohne Test.** Test zuerst oder mindestens testbewusst. Ziel-Coverage 80 %+.
2. **Kein externer Input ohne Validierung.** Joi-Schemas in `backend/src/domain/validation/`. Externe Daten nie vertrauen.
3. **Keine Integration ohne Adapter.** Jede SIEM-/Externquelle (Wazuh/QRadar/Splunk/Email/CrowdSec) validiert
   + normalisiert in `backend/src/integrations/adapters/`, bevor daraus ein Ticket wird. Externes Modell wird **nie**
   direkt zur internen Struktur (ADR-002).
4. **Kein rohes/ungeprüftes HTML ins DOM (XSS-Kernregel).** Text immer über `element.textContent` setzen, nie über
   das HTML-Schreib-Property. In React kein ungesäubertes User-HTML injizieren. Muss es HTML sein → vorher mit einem
   Sanitizer (DOMPurify) säubern.
5. **Traceability / No-Fake (ADR-005/009):** Kein Ticket ohne Beweiskette. Fehlt ein Wert → `null` +
   `missingReason` + `provenance`, **nie** ein erfundener Wert. Keine Demo-/Fake-Daten.
6. **Neue Security-/KI-/Deploy-Kontrollen sind default-AUS** und werden **serverseitig** erzwungen
   (Kill-Switch-ENV, z. B. `DEPLOY_ENABLED`, `WAZUH_FP_APPLY_ENABLED`, `NODE_UPDATE_ENABLED`,
   `HUNT_RESPONSE_REAL_EXEC_ENABLED`). Scharfe Aktionen zusätzlich hinter Reauth + Vier-Augen + Audit.
7. **Keine Secrets im Code/Log.** `.env` pflichtig; Cloud-Keys AES-256-GCM at-rest; Credentials nur als SHA-256-Hash.
8. **Control-Plane hat keinen Steuerkanal.** Provisioning/Enrollment/Heartbeat liefern **nie** ausführbare Befehle zurück.

## Architektur-Muster (so ist der Code gebaut — halte dich daran)

**Backend — geschichtet (bewusst nach Typ, nicht nach Feature):**
- `domain/` reine Domänenobjekte + Validierung · `services/` Geschäftslogik (hängt an Repo-**Interfaces**,
  nicht am Storage) · `repositories/` · `routes/` (in `app.js` gemountet, je Route `requireAuth` + `requireRole(...)`).
- **Repository-Pattern mit Parität:** pro Domäne eine `InMemory*`- **und** eine `Postgres*`-Implementierung,
  gewählt über die **Domänen-Factory** (`DB_ENABLED=true` → Postgres). Business-Logik kennt nur das Interface.
  Beides muss funktionieren. Kein stiller InMemory-Fallback bei `DB_ENABLED`.
- **Composition Roots** (`correlationRuntime`, `collectorHubMain`) verdrahten — nicht verstreute `new`-Aufrufe.
- Migrationen: nummeriert in `backend/src/db/migrations/`, additiv (`IF NOT EXISTS`/`NOT VALID`), laufen beim Boot.
- Tests in `backend/tests/` (Jest, `--runInBand`).

**Frontend — feature-organisiert:**
- `features/<domäne>/` — Komponenten + `*Api.ts` + **reine Logik-Module** + `*.test.ts(x)` (Vitest).
- `pages/` Routen-Screens · `app/` Router/Nav · `components/ui/` geteiltes Kit · `lib/` Auth/RBAC/Utils · `hooks/`.
- Logik konsequent als pure Module (gut testbar). Server-State via TanStack Query, Client-State via Zustand — nicht duplizieren.
- Farben über **CSS-Variablen** (Dark/Light), keine hartkodierten Hex-Werte.

## Ein Feature erweitern

- **Backend-Domäne:** Test zuerst (`backend/tests/`) → `domain/` + `services/` + InMemory- **und** Postgres-Repo +
  Factory + ggf. Migration → Route in `routes/` + Mount in `app.js`.
- **Frontend-Feature:** Vitest-Test zuerst → reine Logik als Modul in `features/<domäne>/` → Komponente + `*Api.ts` → Route in `app/`.

## Qualität & CCD

- Direkt beim Schreiben auf **CCD-Grad Grün (Grad 2)** zielen: SOLID, DRY, KISS, YAGNI, IOSP, SoC, SRP.
- Kleine, nachvollziehbare Schritte — kein Big-Bang. Kein toter/auskommentierter Code. Explizites Fehler-Handling
  (nie still verschluckt). Immutable Patterns bevorzugen.
- Funktionen < 50 Zeilen, Dateien < 800 Zeilen, Verschachtelung ≤ 4 — früh mit Guard-Clauses/Extraktion gegensteuern.

## Commits & Verifikation

- Conventional Commits: `feat|fix|refactor|docs|test|chore|perf|ci: <beschreibung>`. Commit-Message begründet **warum**.
- Vor „fertig": `cd backend && npm test` grün · `cd frontend && npm test` + `tsc` + `eslint` grün.
- **Nicht automatisch pushen.** Erst nach Ansage/Freigabe. Sicherheitslücken privat melden (`SECURITY.md`), nie als Issue/PR.

## Grenzen (nicht tun)

- Keine automatische Bedrohungsentfernung, kein SOAR-Vollersatz, kein Remote-Exec ohne Approval-Gate + Audit.
- NIS2-Bausteine sind **Nachweis-Unterstützung**, kein Konformitätsnachweis — nie „DSGVO-/NIS2-konform" behaupten,
  sondern „implementiert technische Bausteine".
- Cloud-LLM nur opt-in und kennzeichnungspflichtig (Daten verlassen das Netz).
