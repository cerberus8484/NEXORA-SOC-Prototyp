# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

**Nexora SOC** — eine self-hosted SOC-Orchestrierungsplattform für Tier 1–3: Incident-Tickets, Threat Hunting (MITRE-gemappt), Evidence/Chain-of-Custody, Threat-Intel-Anreicherung (VirusTotal/AbuseIPDB), KI-Triage mit Human-Approval und Live-Telemetrie aus dem Wazuh-Indexer. Nexora konsumiert und korreliert SIEM-Daten — **kein** SIEM-/EDR-Ersatz, keine automatische Bedrohungsentfernung.

**Target users:** SOC-Analysten (Tier 1–3)
**Language:** German UI, German/English code comments
**Stack:** React 18 + TypeScript + Vite (`frontend/`) · Node.js/Express + PostgreSQL (`backend/`) · Docker · Wazuh-Integration. KI-Agent auf Ollama (Cloud-Provider opt-in).

> Der ursprüngliche Single-File-Prototyp (`index.html`, Vanilla JS) ist **abgelöst und nicht mehr Teil des Repos**. Produktiver Client ist die React-App unter `frontend/`.

---

## Running Locally

```bash
# Backend (Express + Postgres; ohne DB_ENABLED → InMemory-Repos, flüchtig)
cd backend && npm install && npm run dev      # http://localhost:3000
npm test

# Frontend (React + TS + Vite, zweites Terminal)
cd frontend && npm install && npm run dev     # http://localhost:5173 (Proxy /api → :3000)
npm test
```

**Full-Stack lokal in Docker (Postgres + API + React-Frontend, Hot-Reload):**

```bash
docker compose -f docker-compose.dev.yml up -d
# Frontend: http://localhost:5173 · API: http://localhost:3000
# Login: admin@nexora.example / DevAdmin123! (Dev-Seed)
# Erster Start: langsam (npm install in Containern) — danach schnell.
```

Production-Stack (nginx + TLS) liegt separat unter `deploy/docker-compose.prod.yml`.

---

## Architecture

Zwei Anwendungen plus geteilte Konventionen. Details + Diagramme in `docs/01-architecture/` (arc42, UML).

### Backend (`backend/src/`) — Node.js + Express + PostgreSQL

Geschichtete Architektur (bewusst nach Typ, nicht nach Feature-Modul):

- `domain/` — reine Domänenobjekte + Validierung (`domain/validation/` Joi-Schemas)
- `services/` — Geschäftslogik, hängt an Repo-Interfaces, nicht am Storage
- `repositories/` — **Repository-Pattern**: pro Domäne eine `InMemory*`- **und** eine `Postgres*`-Implementierung, gewählt über die Domänen-Factory (`DB_ENABLED=true` → Postgres). Business-Logik kennt nur das Interface.
- `routes/` — Express-Router, in `app.js` gemountet; pro Route `requireAuth` + `requireRole(...)`
- `integrations/adapters/` — **Adapter-Pflicht**: jede SIEM-Quelle (Wazuh/QRadar/Splunk/Email) validiert + normalisiert externen Input, bevor er zum Ticket wird
- `middleware/` · `db/migrations/` (nummeriert, laufen beim Boot) · `agents/` (KI/LLM-Provider) · `threatHunting/` · `rag/` (Qdrant)
- Tests in `backend/tests/` (Jest, `--runInBand`)

### Frontend (`frontend/src/`) — React 18 + TypeScript + Vite

Feature-organisiert:

- `features/<domäne>/` — pro Domäne Komponenten + `*Api.ts` + reine Logik-Module + `*.test.ts(x)` (Vitest)
- `pages/` — Routen-Screens (orchestrieren Features) · `app/` — Router/Nav · `components/ui/` — geteiltes UI-Kit · `lib/` — Auth/RBAC/Utils · `hooks/`
- Logik konsequent als pure Module (gut testbar); `element.textContent`, nie `innerHTML` mit User-Input; Farben über CSS-Variablen (Dark/Light), keine hartkodierten Hex-Werte

### Deployment

Docker Multi-Stage; Dev `docker-compose.dev.yml`, Prod `deploy/docker-compose.prod.yml` (nginx + TLS). Postgres-Migrationen laufen beim API-Boot automatisch.

---

## Ein Feature erweitern

- **Backend-Domäne:** Test zuerst (`backend/tests/`) → `domain/` + `services/` + InMemory- **und** Postgres-Repo + Factory + ggf. Migration → Route in `routes/` + Mount in `app.js`.
- **Frontend-Feature:** Vitest-Test zuerst → reine Logik als Modul in `features/<domäne>/` → Komponente + `*Api.ts` → Route in `app/`.

Hardrules siehe unten: keine Funktion ohne Test · kein externer Input ohne Validierung · keine Integration ohne Adapter.

---

## Enterprise Roadmap

**Read `ROADMAP.md` before making any changes.**

**Status: Productive & live** on nexora.example (10.99.99.75). (Stand: 2026-06-16)
- Backend: Express + Postgres, ~146 Test-Suiten / ~2279 Tests green. Ticket/User/Audit/Hunt persistent (DB_ENABLED).
- Frontend: React + TS + Vite under `frontend/` (App-Shell, Auth, Dashboard, Tickets/Hunts/Hosts/Analysis/Settings), ~70 Vitest-Suiten / ~766 Tests green.
- ThreatHunting built in-repo under `backend/src/threatHunting/` (Domain · Session-API · Command-Console · Ticket-Links · Postgres).
- KI-Agent live auf Ollama (llama3.2:3b, LXC 10.99.99.78). RAG-Basis (MITRE + Hunt-Katalog) in Qdrant.
- **Open:** P19c/d (lokales Modell + kontinuierliches Lernen) · KI-Settings W2 · E2E (Playwright) · Frontend-Lücken (PDF-Export/Ticket-Delete-UI/Dashboard-Detection-Sources). (P16 Evidence Collector + Passwort-Reset-UI sind erledigt.) See `docs/00-overview/feature-status.md` (aktuellste Quelle) + `ROADMAP.md`.

**Hard rules:**
- `element.textContent = value` — never `element.innerHTML = userInput`
- Every new function needs a test
- No external input without validation
- No integration without an adapter layer
- Repository pattern: InMemory for tests/dev, Postgres for `DB_ENABLED=true` (via per-domain factory)
- CCD applied directly while writing — aim for green (Grad 2+)

**Architecture decisions:** `docs/adr/decisions.md`

---

## Session-Regeln (gelernt aus Fehlern)

- **Kontext-Limit:** Sobald eine Konversation sehr lang wird → Status in Memory (`project_status_p14.md`) speichern und neue Session starten. Niemals warten bis das Limit erreicht ist.
- **Nach jedem Feature:** aktuellen Stand + nächste Schritte in Memory aktualisieren, damit neue Sessions sofort weitermachen können.
- **Keine langen Re-Checks:** Wenn tsc + Jest grün sind, direkt committen — kein erneutes Lesen von Dateien zur Verifikation.
- **Sub-Agent-Pipeline (Tip #4):** Für Deploy-Zyklen: Writer baut Code/Skripte, Reviewer prüft Security (CCD-Grad + Findings), Deployer committet nur wenn DEPLOY FREIGEGEBEN. Nie deployen ohne Reviewer-Freigabe.

---

## Schnell-Modus (Speed-Regeln)

> Geschwindigkeit kommt aus Parallelität + richtiger Phase, nicht aus mehr Tool-Aufrufen.

**3 Hebel:**
1. **Parallelität** — unabhängige Arbeit gleichzeitig starten (mehrere Agents in EINEM Block). Sequenziell nur wenn B das Ergebnis von A braucht. Parallele Features → `git worktree`.
2. **Richtige Phase** — pro Phase genau ein Tool, nicht alle auf jedes Edit:
   - Planen → `planner` / `architect` (nur bei komplexem Feature)
   - Bauen → `/tdd` (Test zuerst)
   - Review → `security-reviewer` ‖ `typescript-reviewer` ‖ `database-reviewer` **parallel**
   - Build rot → `build-error-resolver` · verschluckte Fehler → `silent-failure-hunter`
   - Tiefer Security-Audit → `/security-review --max` (vor Release)
3. **Pipeline** — `/ship <Feature>` fährt Plan→TDD→Parallel-Review→Test→Commit als Kette. Eine Ansage statt vieler Runden.

**Automatik aktiv:**
- **Auto-Review-Hook** (`.Codex/hooks/auto-review.js`, PostToolUse): prüft jede geänderte Datei sofort — Backend `node --check`, Frontend `tsc`. Fehler erscheinen ohne manuellen Lauf.

**Anti-Patterns (machen langsamer):**
- Alle Skills auf jedes kleine Edit werfen → Single-File-Edit einfach direkt machen.
- Lange Re-Checks wenn tsc + jest grün → direkt committen.
- Sequenziell reviewen was parallel laufen kann.

---

## Docs

- `ROADMAP.md` — Phasenplan 0–9, Architektur-Regeln, Zielbild
- `CHANGELOG.md` — was sich Release für Release ändert
- `docs/00-overview/feature-status.md` — kanonische Feature-Status-Matrix
- `docs/adr/decisions.md` — Architecture Decision Records (ADRs)
- `docs/02-user-guide/user-guide.html` — User-facing documentation (German), covers all features
- `docs/04-developer-guide/developer-guide.html` — Technical documentation (German)
