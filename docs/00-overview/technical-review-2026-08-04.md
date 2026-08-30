# Technischer Review — Nexora SOC Orchestrator

**Datum:** 2026-08-04
**Branch:** `p-phase0-close` (28 Commits vor `main`)
**Prüfer:** Technischer Review (CCD-/Security-/Architektur-Fokus)
**Zweck:** Vollständige Ist-Aufnahme des Systems für Handoff/Weiterentwicklung (u. a. ATOS-Evaluierung).

> **Methodik.** Dieser Review beruht auf direkter Code-Inspektion, verifizierten Struktur-
> und Testzahlen (`jest --listTests`, Dateizählung) sowie den kanonischen Projektquellen
> (`ROADMAP.md`, `feature-status.md`, `arc42.md`, `decisions.md`). Wo die vorhandene Doku
> vom Code abweicht, gilt der Code — abweichende Stellen sind unten als **Doku-Drift** markiert.

---

## 1. Executive Summary

Nexora ist eine self-hosted SOC-Orchestrierungsplattform (Tier 1–3): Incident-Ticketing,
Evidence/Chain-of-Custody, asynchrone Korrelation, Threat-Intel-Anreicherung, KI-Triage mit
Human-in-the-loop und eine read-only Control-Plane. Das System ist **produktiv** (live auf
`nexora.example`, 10.99.99.75) und in Umfang und Disziplin deutlich über Prototyp-Niveau.

**Gesamturteil: 🟢 Grün — produktionsreifer Kern, enterprise-taugliche Substanz.**

| Dimension | Bewertung | Kurzbegründung |
|---|---|---|
| Architektur | 🟢 stark | Konsequentes Repository- + Adapter-Pattern, Composition Roots, geschichtete Trennung |
| Sicherheit | 🟢 stark | Cookie-only+CSRF, HMAC-Webhooks, SSRF-Allowlists, at-rest-Verschlüsselung, default-AUS-Gates |
| Testabdeckung | 🟢 stark | 426 Backend-Suiten, 200 Frontend-Test-Dateien, 38 Data-Plane, 12 E2E-Specs |
| Wandelbarkeit | 🟢 stark | Feature-/Schicht-Trennung, InMemory-Parität, Migrations-Kette (058) |
| Betrieb/Ops | 🔶 solide, Lücken | Prometheus + Backups live; **echter Postgres-Lasttest fehlt**, Grafana/Alerting offen |
| Dokumentation | 🟠 gut, aber Drift | Arc42/ADR/Feature-Matrix vorhanden, aber Zahlen/Migrationsstand veraltet |

**Die drei wichtigsten Handlungspunkte:**

1. **Doku-Drift schließen** (LOW-Aufwand, hoher Vertrauenswert): Feature-Matrix/Arc42 nennen
   278 Backend-Suiten / Migrationen bis 045 — real sind es **426 Suiten** und **Migrationen
   bis 058**. Für einen Enterprise-Handoff muss die Zahl stimmen.
2. **Produktiver Postgres-Lasttest** (MEDIUM): Der referenzierte Hauptlasttest läuft weiter auf
   InMemory. Für „Production"-Claim unter Last fehlt der Nachweis (Pool-Sättigung, Query-Timeouts,
   Dataplane-Rückstau).
3. **Release-Schuld auflösen** (MEDIUM): `p-phase0-close` ist 28 Commits vor `main`. Die Divergenz
   zwischen Live-Branch und `main` ist ein Governance-Risiko.

---

## 2. System-Kennzahlen (verifiziert 2026-08-04)

| Kennzahl | Wert | Quelle |
|---|---|---|
| Backend-Test-Suiten | **426** | `jest --listTests` |
| Frontend-Test-Dateien | **200** | `find frontend/src -name *.test.ts*` |
| Data-Plane-Test-Dateien | **38** | `find dataplane -name *.test.*` |
| E2E-Specs (Playwright) | **12** | `frontend/e2e/*.spec.ts` |
| Backend-Services | **61** | `backend/src/services/` |
| Backend-Routen (Router-Dateien) | **45** | `backend/src/routes/` |
| DB-Migrationen | **058** | `backend/src/db/migrations/` |
| ADRs | **~43** (bis ADR-043) | `docs/adr/decisions.md` |
| Frontend-Feature-Domänen | **~35** | `frontend/src/features/` |
| Frontend-Screens | **~50** | `frontend/src/pages/` |
| Frontend-LOC (ts/tsx, src) | **~21.600** | `wc -l` |

> **Doku-Drift.** `feature-status.md` (Testing Coverage) und `arc42.md` (§1.3) nennen
> 278 Backend-Suiten / 3562 Tests bzw. „~2720 BE / ~912 FE" und Migrationsstand 045.
> Der reale Stand ist erheblich höher. **Empfehlung:** Zahlen aus einem CI-Lauf generieren,
> nicht von Hand pflegen.

---

## 3. Architektur — Bewertung

### 3.1 Backend (Node.js/Express + PostgreSQL)

Geschichtete Architektur, bewusst nach Typ organisiert (`domain/` · `services/` ·
`repositories/` · `routes/` · `integrations/adapters/` · `middleware/`). Die tragenden
Muster sind konsequent durchgehalten:

- **Repository-Pattern mit Parität.** Jede Domäne hat eine `InMemory*`- **und** eine
  `Postgres*`-Implementierung hinter einer per-Domänen-Factory (`DB_ENABLED`). Business-Logik
  kennt nur das Interface. → **Wandelbarkeit ★★★**, hervorragende Testbarkeit (Tests laufen
  gegen InMemory, Prod gegen Postgres).
- **Adapter-Pflicht.** Jede externe Quelle (Wazuh/QRadar/Splunk/Email/CrowdSec) validiert und
  normalisiert externen Input, bevor er zum internen Ticket wird (ADR-002). Externe Modelle
  werden nie direkt zur internen Struktur.
- **Composition Roots** (`correlationRuntime`, `collectorHubMain`) statt verstreuter
  `new`-Aufrufe — geteilte Queue-/Repo-Instanzen, kein stiller InMemory-Fallback bei
  `DB_ENABLED`. → sauberer IoC-Ansatz (Grüner-Grad-Niveau).
- **Asynchrone Korrelation** (P_CORR_1): materialisierte Jobs + Worker + Status-Machine
  (`pending→running→completed`), Idempotenz via `input_hash` + Partial-Unique-Index. Der
  GET-Read-Pfad berechnet **nicht** synchron (per Test erzwungen). → saubere CQS-Trennung
  Read/Write.
- **Data Plane** als eigenständige Pipeline (EventEnvelopeV1 → Intake+Outbox → Cross-Domain-
  Fusion → A4-Ingress), Transactional-Outbox mit `SKIP LOCKED`. Lehrbuchhafte Umsetzung.

**Stärke:** Die „No-Fake"-Invariante ist strukturell verankert — fehlt ein Wert, gibt es
`null` + `missingReason` + `provenance` statt erfundener Daten. Das ist für ein SOC-Werkzeug
korrektheitskritisch und selten so diszipliniert umgesetzt.

**Risiko:** 61 Services / 45 Router bei geschichteter (nicht modular-vertikaler) Organisation
erhöhen mit weiterem Wachstum die Kopplung über die Schichtgrenzen. Kein akutes Problem,
aber ein Kandidat für spätere Modul-/Bounded-Context-Schnitte (siehe §7).

### 3.2 Frontend (React 18 + TS + Vite)

Feature-organisiert (`features/<domäne>/` mit Komponenten + `*Api.ts` + reinen Logik-Modulen +
Tests), ~35 Domänen, ~50 Screens. Logik konsequent als pure Module (gut testbar), State-
Trennung Server-State (TanStack Query) / Client-State (Zustand). Security-Disziplin sichtbar:
`textContent` statt `innerHTML`, Farben via CSS-Variablen (Dark/Light), keine Hex-Hardcodes.

**Stärke:** 200 Test-Dateien auf ~21.600 LOC ist ein sehr gutes Verhältnis; die pure-Module-
Strategie zahlt direkt auf Testbarkeit ein.

**Lücke:** Accessibility ist nur teilweise (🔶) — Keyboard-Shortcuts fehlen, ARIA partiell.
Für Enterprise-Abnahme (BITV/WCAG) relevant.

### 3.3 Datenmodell & Migrationen

58 nummerierte Migrationen, additiv (`IF NOT EXISTS` / `NOT VALID`), laufen beim API-Boot.
Append-only Audit-Trigger auf Postgres-Ebene. Idempotenz-/Single-flight-/Replay-Indizes für
Deploy- und Korrelations-Domänen. → solide, forward-only, migrationssicher.

---

## 4. Sicherheit — Bewertung

Der Security-Reifegrad ist der stärkste Einzelaspekt des Systems.

| Kontrolle | Status | Bewertung |
|---|---|---|
| Session: httpOnly-Cookie `soc_token` + CSRF-Double-Submit (ADR-017) | ✅ | XSS-Token-Diebstahl adressiert |
| Passwort: bcrypt(12 prod / 4 test), History, Ablauf, Lockout (Postgres) | ✅ | serverseitig erzwungen |
| MFA/TOTP (RFC 6238, ohne externe Lib) | ✅ live | |
| SSO/OIDC (PKCE/S256, `jose`) | ✅ Backend + Login-UI | In-UI-Admin-Konfig teils offen |
| Webhook-Intake: HMAC-SHA256 + Replay-Schutz (Nonce) | ✅ | |
| Secrets: AES-256-GCM at-rest, `enr_`/`ncr_` nur als SHA-256-Hash | ✅ | Klartext genau einmal |
| SSRF-Allowlist (IPv4-only) + Metadata-deny (Proxmox-Connector) | ✅ | |
| TLS-Fingerprint-Pinning Proxmox-Connector (ADR-043) | ✅ live | Socket-Pin, kein accept-all |
| Gefährliche Kanäle default-AUS, serverseitig erzwungen | ✅ | `DEPLOY_ENABLED`, `WAZUH_FP_APPLY_ENABLED`, `NODE_UPDATE_ENABLED`, `HUNT_RESPONSE_REAL_EXEC_ENABLED` |
| Control-Plane ohne Steuerkanal (per Test erzwungen) | ✅ | Server sendet nie ausführbare Befehle |
| SBOM (CycloneDX) + npm-audit-Gate in CI (`security.yml`) | ✅ | wöchentlich |
| Audit append-only + Redaction (nie notes/URL/PII) | ✅ | |
| Frontend-CSP via nginx | 🔶 | Header im Repo-Stand, **Live-Verifikation offen** |

**Architekturprinzip „scharfe Aktionen sind default-inert und gated".** Alle Kanäle, die
schreiben oder ausführen könnten (Deploy, FP-Apply, Node-Update, Containment/Host-Isolation),
sind hinter Kill-Switches + Reauth + Vier-Augen + Circuit-Breaker + Host-Key-Pinning verriegelt
und wurden security-reviewed (kein CRIT/HIGH). Das ist genau die richtige Haltung für ein
Werkzeug mit potenziell destruktiver Reichweite.

**Offene Security-Punkte (nicht kritisch, aber vor breitem Rollout zu schließen):**

1. **Frontend-CSP live verifizieren** (🔶) — Header gegen Frontend, Wiki-Seiten und eingebettete
   Doku-Ansichten prüfen; erst dann als „bestanden" führen.
2. **Credential-Rotation** (❌) — bewusst zurückgestellt; für langlebige Nodes mittelfristig nötig.
3. **Verteilter Lock (M-2)** vor Multi-Instanz-Betrieb der Containment-Aktion.

---

## 5. Testabdeckung & Qualitätssicherung

- **Backend (Jest):** 426 Suiten, `--runInBand`. Test-only bcrypt-Rounds (4) für Laufzeit;
  Prod bleibt ≥12. **Runtime-Vollsuite in diesem Review ausgeführt → grün (Exit 0).** Die
  `ECONNREFUSED`-Meldungen im Log sind erwartet (Ollama/Qdrant offline im Testlauf, fail-soft).
- **Frontend (Vitest):** 200 Test-Dateien; `tsc` 0, `eslint` 0 Errors, Vite-Build grün.
- **Data Plane:** 38 Dateien (176 pass / 2 skip lokal ohne `DATAPLANE_TEST_DB_URL`).
- **E2E (Playwright):** 12 Specs, in CI als `e2e` (mocked) **und** `e2e-real` (echtes Backend,
  InMemory).

**Stärke:** Die Hardrule „keine Funktion ohne Test" ist real gelebt, nicht nur behauptet.
Integrations- und E2E-Ebene sind vorhanden — nicht nur Unit-Tests.

**Lücke (wichtig):** Der referenzierte **Haupt-Lasttest basiert auf InMemory**, nicht auf
Postgres. Damit ist die Behauptung „produktionsreif unter Last" formal ungedeckt. Ein echter
Postgres-Go-Live-Lasttest (Pool-Sättigung, Query-Timeouts, Dataplane-Rückstau) ist der größte
verbleibende Qualitäts-Gap.

---

## 6. Betrieb & Deployment

- Docker Multi-Stage (dev/prod), nginx + TLS, Postgres-Migrationen beim Boot, Health-Checks,
  strukturierte Logs, Prometheus-`/metrics`, DB-Backup-Cron (03:30) mit dokumentiertem Restore.
- **Offen:** Grafana-Dashboards, Alerting, Provider-Latenz/Health-Sidebar (Phase 8 nur teils).

**Governance-Befund:** Live-Branch `p-phase0-close` divergiert 28 Commits von `main`. Die
Feature-Matrix warnt selbst davor, den Abstand aus Notizen zu übernehmen. **Empfehlung:**
PR-Merge nach `main` als nächster Governance-Schritt, damit `main` wieder die Wahrheit ist.

---

## 7. Empfehlungen (priorisiert)

**Sofort (LOW Aufwand, hoher Wert):**
- [ ] Doku-Drift schließen: Test-/Migrationszahlen in `feature-status.md` + `arc42.md` aus CI
      generieren; Arc42-Version/Datum aktualisieren.
- [ ] `p-phase0-close` → `main` mergen (Release-Schuld auflösen).

**Kurzfristig (MEDIUM):**
- [ ] Echter Postgres-Lasttest mit dokumentiertem Nachweis.
- [ ] Frontend-CSP live verifizieren und als bestanden führen.
- [ ] Accessibility-Pass (ARIA-Vollständigkeit, Keyboard-Navigation) für Enterprise-Abnahme.

**Mittelfristig:**
- [ ] Grafana + Alerting (Phase 8 abschließen).
- [ ] Credential-Rotation.
- [ ] Modul-/Bounded-Context-Schnitte prüfen, sobald Service-Zahl weiter wächst.

---

## 8. Fazit

Nexora ist ein **überdurchschnittlich diszipliniert gebautes** System: die Kernmuster
(Repository, Adapter, Composition Root, No-Fake-Korrelation, default-AUS-Gates) sind nicht nur
vorhanden, sondern per Test **erzwungen**. Security ist der stärkste Aspekt. Die verbleibenden
Lücken sind **keine strukturellen Mängel**, sondern Nachweis- und Betriebsthemen: echter
Lasttest, Live-CSP-Verifikation, Monitoring-Ausbau, und — organisatorisch am wichtigsten — das
Schließen der Doku-Drift und der `main`-Release-Schuld, damit die dokumentierte Wahrheit wieder
mit dem Code übereinstimmt.

Für einen Enterprise-Handoff ist die Substanz da; was fehlt, ist primär die **Nachweisführung**,
nicht die Technik.
