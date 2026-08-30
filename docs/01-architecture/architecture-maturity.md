# Architektur-Reifegrad — Nexora SOC Orchestrator

**Datum:** 2026-08-04
**Bezug:** [`arc42.md`](arc42.md) · [`decisions.md`](../adr/decisions.md) · [`feature-status.md`](../00-overview/feature-status.md)
**Zweck:** „Wie weit ist die Architektur?" — belastbarer Reifegrad je Baustein, nicht nur Feature-Häkchen.

---

## 1. Einordnung in einem Satz

Die **tragende Architektur ist fertig und produktiv**; offen ist im Wesentlichen der
Ausbau einzelner Kanäle (Deploy/Update/Containment bewusst inert), der Betriebs-/Monitoring-
Layer und die Nachweisführung unter Last — **keine** strukturellen Grundfragen mehr.

**Architektur-Reifegrad gesamt: 🟢 „Etabliert / Produktiv" (Stufe 4 von 5).**

```
Stufe 1  Prototyp        — abgelöst (Single-File-Vanilla-JS, nicht mehr im Repo)
Stufe 2  Strukturiert    — ✔ überschritten
Stufe 3  Konsolidiert    — ✔ überschritten
Stufe 4  Etabliert/Prod  — ◀ HIER (produktiv, Muster erzwungen, CI/E2E/SBOM)
Stufe 5  Optimiert/Skaliert — offen (Lasttest, HA/Multi-Instanz, Monitoring-Vollausbau)
```

---

## 2. Reifegrad je Architektur-Baustein

| Baustein | Reifegrad | Belege / Muster | Offen bis Stufe 5 |
|---|---|---|---|
| **Schichtung Backend** (domain/services/repositories/routes) | 🟢 Etabliert | Konsequent getrennt; Business kennt nur Interfaces | Bounded-Context-Schnitte bei weiterem Wachstum |
| **Repository-Pattern** (InMemory ‖ Postgres + Factory) | 🟢 Etabliert | Parität per Test; kein stiller Fallback bei `DB_ENABLED` | — |
| **Adapter-Layer** (Wazuh/QRadar/Splunk/Email/CrowdSec) | 🟢 Etabliert | ADR-002; extern→Adapter→Validierung→Normalisierung | Weitere Quellen nach Vertrag (YAGNI) |
| **Async-Korrelation** (P_CORR_1, CE-1…CE-5) | 🟢 Etabliert | Jobs+Worker+Status-Machine, Idempotenz, kein sync im GET | Pre-Deploy-Gates (EXPLAIN/Pool-Last) |
| **Data Plane** (EventEnvelopeV1 → Intake+Outbox → Fusion → A4) | 🟢 Etabliert/Live | Transactional Outbox, SKIP LOCKED, HMAC-Ingress | OPNsense-Quelle pausiert; Desired-State ❌ |
| **Control-Plane / Provisioning** | 🟢 Etabliert | Enrollment/Token/Heartbeat, **kein** Steuerkanal (per Test) | Credential-Rotation ❌ |
| **KI-Layer** (Ollama lokal, Cloud opt-in, RAG/Qdrant) | 🟢 Etabliert | DynamicLlmProvider, Anti-Halluzination-Floors, MITRE-RAG | Lokales Modell + kont. Lernen (P19c/d 55 %) |
| **Deployment Center** (Network-as-Code, ADR-041) | 🔶 Gebaut, inert | Domäne/Gates/Connector/Applier vollständig | Live-Smoke; `deliver`-Kanal in Gast fehlt |
| **Containment / Response** (ADR-042) | 🔶 Gebaut, inert | Real-Exec Linux+Windows, security-reviewed | Lab-Smoke, verteilter Lock (M-2) |
| **Auth / Enterprise-Security** | 🟢 Etabliert | Cookie+CSRF, MFA, OIDC, Lockout/History/Timeout | SAML; OIDC-In-UI-Konfig teils |
| **Persistenz / Migrationen** | 🟢 Etabliert | 58 additive Migrationen, append-only Audit-Trigger | Postgres-Lasttest-Nachweis |
| **Frontend-Architektur** (feature-org, pure Module) | 🟢 Etabliert | Server-/Client-State getrennt, ~200 Tests | Accessibility-Vollausbau 🔶 |
| **Monitoring / Ops** | 🔶 Teilweise | Prometheus + Backups live | Grafana, Alerting, Health-Sidebar |
| **CI / Supply-Chain** | 🟢 Etabliert | `ci.yml` (4 Jobs), E2E mocked+real, SBOM+audit (`security.yml`) | — |

---

## 3. Architektur-Prinzipien: wie tief verankert?

Die Stärke liegt nicht in einzelnen Features, sondern darin, dass die Leitplanken
**strukturell erzwungen** sind (nicht nur konventionell empfohlen):

1. **No-Fake / Traceability (ADR-005).** Fehlt ein Wert → `null` + `missingReason` +
   `provenance`. Kein Ticket ohne Beweiskette. *Erzwungen durch Korrelations-Tests.*
2. **Kein Steuerkanal in der Control-Plane.** Server sendet nie ausführbare Befehle zurück.
   *Erzwungen durch dedizierte Tests gegen Apply-/Remote-/Netz-Befehle.*
3. **Scharfe Aktionen default-inert.** `DEPLOY_ENABLED`, `WAZUH_FP_APPLY_ENABLED`,
   `NODE_UPDATE_ENABLED`, `HUNT_RESPONSE_REAL_EXEC_ENABLED` — alle default AUS, serverseitig
   erzwungen, hinter Reauth + Vier-Augen + Kill-Switch.
4. **Repository-Parität.** Kein stiller InMemory-Fallback bei `DB_ENABLED` — Composition Root
   verweigert den Start statt still falsch zu laufen.
5. **NIS2 = Nachweis-Unterstützung, kein Konformitätsclaim.** *Per Test erzwungen.*

Dieses „Prinzip → Test → Invariante"-Muster ist der eigentliche Reife-Indikator: die
Architektur schützt sich selbst gegen Erosion.

---

## 4. Was Stufe 5 („Optimiert / Skaliert") noch verlangt

| Thema | Warum offen | Aufwand |
|---|---|---|
| **Echter Postgres-Lasttest** | Haupt-Lasttest läuft auf InMemory → „unter Last produktionsreif" ungedeckt | MEDIUM |
| **HA / Multi-Instanz** | Backend stateless, aber Containment/Correlation brauchen verteilten Lock (M-2) | MEDIUM–HIGH |
| **Monitoring-Vollausbau** | Grafana/Alerting/Provider-Health fehlen → Betrieb sieht Ausfälle spät | MEDIUM |
| **Frontend-CSP live** | nur im Repo-Stand, Live-Header + Doku-Rendering unverifiziert | LOW |
| **Deploy/Containment-Live** | bewusst inert; braucht Golden-Template + Operator-GO + Lab-Smoke | Operator |
| **Bounded-Context-Schnitte** | 61 Services geschichtet — bei weiterem Wachstum Kopplungsrisiko | HIGH (später, YAGNI) |

---

## 5. Fazit

Die Architektur ist **inhaltlich fertig**: alle tragenden Muster stehen, sind produktiv und
per Test gegen Erosion abgesichert. Der Weg zu Stufe 5 ist **kein Umbau**, sondern
Nachweis (Lasttest), Betrieb (Monitoring) und das kontrollierte Scharfschalten bewusst
inerter Kanäle. Es gibt aktuell **keine offene architektonische Grundsatzfrage** — ein
seltener und wertvoller Zustand für ein System dieser Reichweite.
