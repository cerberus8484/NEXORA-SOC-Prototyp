# Architecture Decision Records

## ADR-001 — Schrittweise Enterprise-Migration

**Datum:** 2026-06-03  
**Status:** Accepted

**Kontext:**  
Das SOC Analyst Notebook soll in eine produktive Enterprise-Umgebung überführt werden. Externe Systeme (QRadar, Splunk, ServiceNow, SOAR) sollen Daten liefern und empfangen.

**Entscheidung:**  
Schrittweise Migration nach definierter Roadmap. Keine Phase überspringen.  
Reihenfolge: Security → Tests → Backend → DB → Auth → Adapter.

**Begründung:**  
Externe Systeme liefern beliebige, potenziell gefährliche Inhalte. Ein unsicheres Frontend ist kein akzeptabler Ausgangspunkt für Enterprise-Integration.

---

## ADR-002 — Eigenes internes Ticketmodell

**Datum:** 2026-06-03  
**Status:** Accepted

**Kontext:**  
Jedes externe System hat ein eigenes Datenmodell:  
QRadar → Offense, ServiceNow → Incident, OTRS → Ticket, Splunk → Notable.

**Entscheidung:**  
Wir definieren ein eigenes internes Ticketmodell. Externe Modelle werden **niemals** direkt zur internen Struktur.

**Mapping-Prinzip:**  
`Extern → Adapter → Validierung → Normalisierung → Internal Ticket`

---

## ADR-003 — PostgreSQL als Zieldatenbank

**Datum:** 2026-06-03  
**Status:** Accepted

SQLite nur für lokale Entwicklung/Tests. Produktiv: PostgreSQL.

---

## ADR-004 — Queue/Worker für Integrationen

**Datum:** 2026-06-03  
**Status:** Accepted

Keine schweren Integrations-Jobs synchron im API-Request.  
Incoming Events → Queue → Worker → Verarbeitung.  
Retries, Rate Limits und Fehler werden im Worker behandelt.

---

## ADR-005 — Traceability als Pflicht

**Datum:** 2026-06-03  
**Status:** Accepted

Jedes Ticket muss rückverfolgbar sein:  
Quelle, externe ID, Rohdaten-Hash, Normalisierungsschritte, Änderungen, Sync-Status.

Tabelle `external_ticket_links` als Verbindung zwischen internen Tickets und externen Systemen.

---

## ADR-006 — Idempotente Webhook-Verarbeitung

**Datum:** 2026-06-03  
**Status:** Accepted

Deduplication Key: `source_system + external_id + event_hash`  
Doppelte Webhooks dürfen keine doppelten Tickets erzeugen.

---

## ADR-007 — Zwei-Feld-Modell: State + Status

**Datum:** 2026-06-06  
**Status:** Accepted

**Kontext:**  
Das ursprüngliche Ticket hatte ein einzelnes Feld `status` mit den Werten
`open | progress | closed | fp`. Damit vermischten sich zwei Dimensionen: der
Lebenszyklus (offen vs. geschlossen) und der Bearbeitungs-Workflow (zugewiesen,
in Arbeit, wartend …). Die zentrale Triage-Ansicht (Analysis-Seite) braucht beide
getrennt — „alle offenen Cases" ist ein anderer Filter als „alle wartenden Cases".

**Entscheidung:**  
Trennung in zwei Felder:

- `state` ∈ `{OPEN, CLOSED}` — Lifecycle, eigenes Dropdown, indexiert.
- `status` ∈ `{assigned, in_progress, on_hold, awaiting_customer}` — Workflow innerhalb OPEN.
- `close_reason` ∈ `{'', resolved, false_positive, duplicate, benign, other}` — Schließgrund bei CLOSED.

**„False Positive" ist jetzt ein Schließgrund, kein Status** — ein FP-Case ist ein
geschlossener Case mit `close_reason = false_positive`.

**Migration (004, idempotent):**  
`closed`/`fp` → `state=CLOSED` (+ `close_reason` resolved/false_positive),
`open` → `state=OPEN, status=assigned`, `progress` → `status=in_progress`.
CHECK-Constraint auf `status` neu gesetzt; läuft bei jedem API-Start, schreibt
Bestandsdaten nur beim ersten Mal um.

**Begründung:**  
Saubere Filterbarkeit (state vs. status getrennt indexierbar), zukunftsfest für
SLA-/Reporting-Anforderungen, und das interne Modell bleibt unabhängig von den
Status-Werten externer Systeme (ADR-002).

---

## ADR-008 — `/analysis` als zentrale SOC-Workbench (Analysis-Deck)

**Datum:** 2026-06-07  
**Status:** Accepted

**Kontext:**  
Die Analysis-Seite war eine reine Ticket-Tabelle. Ein Analyst kann darin Cases
zwar finden, aber nicht wirklich *analysieren* (IoCs, Evidence, Enrichment,
Timeline, Empfehlung, Entscheidung, Report).

**Entscheidung:**  
`/analysis` wird zur zentralen **Workbench** mit 3-Spalten-Layout
(Ticket-Queue · Analysis-Tabs · Enrichment-Sidebar), Active-Ticket-Header und
6 Tabs (ANALYSIS, EVIDENCE, TIMELINE, NOTES, PLAYBOOKS, REPORT). Evidence wird
**korrelationsorientiert** dargestellt (Flow Source → NAT → Destination →
Reputation → Detection) statt als Raw-JSON. Header, Evidence und Sidebar lesen
**dieselbe Quelle** (`buildEvidence(ticket)`), um Daten-Drift zu vermeiden.
Komponenten unter `components/analysis/*`, Datenmodell in
`features/analysis/analysisModel.ts` (`ParsedEvidence`, `EnrichmentData` …).

**Grenzen (bewusst):**  
- **Kein Remote-Exec** — Command-Deck nur Safe-Lookup-Templates + Copy + Output-Feld.
- **Keine API-Keys im Frontend** — VirusTotal/AbuseIPDB laufen serverseitig.
- Raw-Event nur im aufklappbaren Drawer (Advanced), nie als Hauptansicht.

**Begründung:**  
Triage-Geschwindigkeit und Nachvollziehbarkeit; eine konsistente Evidence-Quelle
verhindert widersprüchliche Werte zwischen Header und Detailkarten.

---

## ADR-009 — Keine Demo-/Fake-Daten im Frontend: ehrliche Leerzustände

**Datum:** 2026-06-07  
**Status:** Accepted

**Kontext:**  
Mehrere Seiten (Dashboard, Evidence-Center, KI-Agent, Settings, Profile, Hosts,
Analysis-Deck) zeigten Platzhalter-/Demo-Daten, um die Ziel-UI zu skizzieren.
Solche erfundenen Werte dürfen niemals in Produktion erscheinen und können
einen falschen Eindruck von Funktionsfähigkeit erzeugen.

**Entscheidung:**  
Alle `*Demo.ts`-Dateien werden entfernt. Wo (noch) kein Backend existiert, zeigt
die UI **ehrliche Leerzustände** — `EmptyState`/„Nicht verbunden" auf Panel-Ebene,
„Not provided by source log" auf Feld-Ebene. Datenmodelle/Logik/statische Templates
(Command-Lookups, Investigation-Checklist, Playbook-Vorlagen) bleiben erhalten;
`analysisDemo.ts` → `analysisModel.ts`, Host-Typen → `hostsTypes.ts`.

**Konsequenz / Invariante:**  
`grep -rni "DEMO_" frontend/src` muss leer sein. „Nicht verbunden" / „Coming soon"
ist der **gewollte** Zustand, bis der jeweilige Endpunkt existiert (siehe
`frontend/TODO.md`). Backend-Anbindung ist damit ein reiner Abarbeitungsschritt.

**Begründung:**  
Keine Fake-Vollständigkeit (globaler Entwicklungsstandard); Vertrauen in die
angezeigten Daten; klar erkennbar, was real ist und was noch fehlt.

---

## ADR-010 — SIEM-Dashboard-Provider-Naht (pro SIEM ein Dashboard)

**Datum:** 2026-06-07  
**Status:** Accepted

**Kontext:**  
Das Wazuh-Dashboard (`/wazuh`) soll echte Daten zeigen — und später soll man pro
SIEM (Wazuh, Splunk, QRadar …) ein passendes Dashboard auswählen können, sofern
die Quelle konfiguriert ist und der Nutzer berechtigt ist. Ein hart auf Wazuh
verdrahtetes Dashboard würde das verbauen.

**Entscheidung:**  
Eine **Provider-Naht** mit einheitlichem DTO:
- Backend: `SiemDashboardProvider`-Form (`getDashboard()`), je Quelle ein Provider
  (`WazuhDashboardProvider`), registriert in `siemDashboards`. Route
  `GET /v1/siem/:siem/dashboard` (RBAC `requireAuth` + Capability-Gate: Provider
  existiert **und** ist konfiguriert), plus `GET /v1/siem` (verfügbare Quellen).
- Wazuh-Provider komponiert **drei Quellen**: `WazuhIndexerClient` (OpenSearch
  `wazuh-alerts-*` Aggregationen, :9200, User `admin`), `WazuhApiClient`
  (Agents/Rule-Health, :55000, User `wazuh-wui`) und unsere Tickets (Open Incidents).
  Best-effort: fehlende Quelle → `null`/leer statt Fehler.
- Frontend: `siemApi.dashboard(siem)` + dashboard-spezifische Seite; künftige SIEMs
  = neuer Provider + Layout, Route/Client bleiben.

**Trennung der Wazuh-Zugänge (bewusst, zwei Logins):**  
Manager-API (`wazuh-wui`, :55000) liefert **keine** Alert-Indizes — die kommen nur
aus dem Indexer (`admin`, :9200). Daher zwei getrennte Cred-Blöcke
(`WAZUH_API_*` / `WAZUH_INDEXER_*`), beide nur in `deploy/.env.production` (nie in Git).

**Grenzen:** read-only; keine API-Keys im Frontend; Reputation/Threat-Intel-Matches/
Geo-Map bleiben Leerzustand bis **P17 Threat Intel Service** (ADR-009).

**Begründung:**  
Erweiterbarkeit ohne Core-Änderung (neue SIEMs als Plugin), klare Capability-/RBAC-
Gates, und das interne Dashboard-DTO bleibt unabhängig vom SIEM-spezifischen Schema.

---

## ADR-011 — Wazuh False-Positive: scoped Exception, Preview-before-Write, Guardrails

**Datum:** 2026-06-07  
**Status:** Accepted (Stage 1–4 umgesetzt — **nicht scharfgeschaltet/nicht deployed**; Stage 5 offen)

**Kontext:**  
Markiert ein Analyst eine Offense als False Positive, soll Wazuh den FP nicht nur
„kennen", sondern künftig **nicht wieder** alarmieren. Wazuh hat dafür **keinen
Per-Alert-FP-Status** — der richtige Weg ist eine **Custom-Rule-Ausnahme** (Level 0).
Das ist ein Eingriff in die Detection-Config und damit produktiv heikel.

**Entscheidung:**  
1. **Evidence zuerst** — strukturierte Felder (rule/agent/src/dst/protocol/MITRE) werden
   server-seitig aus dem Roh-Event normalisiert (`wazuhEvidenceNormalizer`), damit der
   Exception-Builder verlässlich vorbefüllt werden kann (kein Raten).
2. **Ausnahme immer SCOPED** — `if_sid` (Parent-Rule) **plus** `srcip` **und** `dstip`
   (IP/CIDR/Liste), optional Port/Protokoll. **Niemals** eine Ausnahme nur mit `if_sid`
   (das würde die ganze Regel global stummschalten).
3. **Preview-before-Write** — XML wird erzeugt und angezeigt/heruntergeladen, aber in
   Stage 1–3 **nicht** geschrieben. „Apply" ist deaktiviert; kein Manager-Restart,
   kein Indexer-Tagging.
4. **Server-seitige Guardrails** (`wazuhRuleExceptionBuilder`, getestet): Source+Destination
   Pflicht, Reason Pflicht, IP/CIDR/Port-Validierung, Rule-ID nur **900000–920000**.
   Ungültige Eingaben → `ok:false` + Fehlerliste, kein XML.
5. **„Close as FP" wirkt nur intern** — schließt unser Ticket (`closeReason=false_positive`),
   ändert **nichts** in Wazuh. Der Wazuh-Eingriff ist ein getrennter, bewusster Schritt.

**Stage 4 (umgesetzt, Commit `9f3c72c`):** `WazuhApiClient` um `getRuleFile/putRuleFile/
restartManager/validateConfiguration/managerStatus` erweitert; `WazuhFpException` (Domain +
InMemory/Postgres-Repo + Migration 008); `WazuhFpExceptionService` mit `apply/restart/revert`.
Konkrete Sicherheits-Umsetzung:
- **apply** schreibt die Regel + `validateConfiguration` → bei KO **Rollback** auf den
  Vorzustand, `status=failed`, **kein** Restart; bei OK `status=restart_required`.
- **restart** ist ein **separater, expliziter** Endpoint (kein Auto-Restart) → `status=active`.
- **revert** entfernt die Regel per ID **plus Marker-Quergegencheck** (`[soc-fp scope=<hash>]`).
- **Idempotenz**: `scopeHash` (Repo) **und** File-Scan; zweites Apply gleichen Scopes schreibt nichts.
- **RBAC**: apply/restart/revert **admin-only**; Preview/Suggest analyst+.
- Alles auditiert (before/after-Hash, scope, IDs).

**Stage 4 NICHT scharfgeschaltet:** Code committet + getestet (mocked-first, 592 Backend-Tests),
aber **nicht deployed**. Da `WAZUH_API_*` auf Prod konfiguriert ist, aktiviert erst ein Deploy
den echten Admin-Schreibpfad — Live-Aktivierung nur nach explizitem Go.

**Offen (Stage 5):** ähnliche Offenses schließen, Indexer-Alert-Tagging (`update_by_query`),
optional `senior_analyst`/Capability-RBAC, Audit-/Reporting-Ansichten, Betriebsdoku.

**Begründung:**  
Rausch-Reduktion ohne gefährliche globale Abschaltung; derselbe Builder erzeugt die
Vorschau **und** den echten Write (eine Quelle der Wahrheit); Schreibrechte Richtung Wazuh
werden erst durch ein bewusstes Deploy + Admin-Aktion scharf.

---

## ADR-012 — Evidence-Store mit append-only Chain of Custody & SHA-256-Integrität

**Status:** akzeptiert (2026-06-07)

**Kontext:** Beweismittel müssen für Forensik/Compliance/Eskalation **nachvollziehbar und
manipulationssicher** sein (DSGVO Art. 32 / Beweiskette).

**Entscheidung:**
- **Append-only:** `Evidence` hat **kein** update/delete. Inhalt unveränderlich.
- **Integrität:** je Item ein **SHA-256** über den unveränderlichen Inhalt (`verifyIntegrity()`),
  beim Lesen aus Postgres wird der **gespeicherte** Hash erhalten (nicht neu berechnet) → Manipulationserkennung.
- **Chain of Custody:** Zustände (reviewed/verified/flagged) werden **nicht** am Item mutiert,
  sondern als **`evidence_custody`-Events** angehängt; der Review-Status wird daraus **abgeleitet**.
- **Repository-Muster:** InMemory (Tests/Dev) ↔ Postgres (`DB_ENABLED`), Migrationen 009–011 idempotent.
- **Export:** ein Ticket → JSON-Bundle inkl. Integritätsprüfung pro Item (Handover an Tier-3/IR/extern).
- **Quellen:** Threat-Intel-Enrichment, normalisierte Evidence-Snapshots (Sysmon/Firewall), künftig weitere.

**Begründung:** Eine belastbare, prüf- und exportierbare Beweiskette — ohne mutierbaren Status,
der die Custody untergraben würde.

---

## ADR-013 — Detection Library: read-only Sicht auf das Wazuh-Manager-Ruleset

**Status:** akzeptiert (2026-06-07)

**Kontext:** Eingespielte Detection-/Hunt-Rulesets (z. B. SIEM-Rules) sollen **im Tool** sichtbar
sein (welche Detections geladen, welche MITRE-Techniken abgedeckt), ohne Schreibzugriff.

**Entscheidung:**
- `WazuhApiClient.listRules()` + `GET /v1/detections` (requireAuth) — **read-only** über die Wazuh-Manager-API.
- Normalisiert (id/level/description/groups/mitre/filename), MITRE robust (Array **oder** `{id:[...]}`).
- Ohne Wazuh-API → ehrlicher „nicht verbunden"-Zustand (ADR-009), **kein Mock**.
- **Kein** Rule-Write/Restart aus dieser Sicht; Rule-Deployment bleibt manueller, `wazuh-logtest`-validierter Schritt.
- FP-Exception-IDs liegen bewusst bei **900000–920000**, damit Hunt-/Detection-Rulesets (100000+) konfliktfrei daneben liegen.

**Begründung:** Detection-as-Code sichtbar machen + MITRE-Coverage, ohne den Manager fernzusteuern.

---

## ADR-014 — KI-Agent: strukturierte Analyse + deterministische Verdict-Floors

**Status:** akzeptiert (2026-06-14)

**Kontext:** Der lokale KI-Agent (Ollama, llama3.2:3b, on-prem nach ADR-009/local-llm-architecture)
lieferte bislang nur Freitext (proposal/rationale). Ein schwaches 3B-Modell **halluziniert** dabei
(z. B. „Malware-Update installiert" als bestätigte Tatsache bei einem reinen ClamAV-Lesefehler) und
trifft Verdicts unzuverlässig. Gleichzeitig brauchen Analysten eine **prüfbare Entity-/IOC-Tabelle**
statt Prosa.

**Entscheidung:**
- **Evidence-First:** `WazuhAlertNormalizer` extrahiert vor dem LLM-Call alle Entities aus dem Roh-Alert
  (Host, User inkl. SID/Domain/Privilege, Process inkl. SHA256/Signatur/Publisher, File aus FIM **und**
  Sysmon FileCreate, Registry, Network). Das LLM bewertet ein **EvidenceBundle**, kein Rohtext.
- **Strukturiertes `analysis`-Objekt:** Das Modell liefert JSON (entities/iocs/assessment/verdict/
  recommended_actions/mitre …). `OllamaLlmProvider._buildAnalysis` mappt es **einmalig snake_case → camelCase**
  (Daten-Vertrag mit den Frontend-Karten) und persistiert es als `analysis JSONB` (Migration 021).
  Frontend rendert native Karten (`AnalysisCards.tsx`), Fallback auf Freitext-`rationale`.
- **Server-autoritative Entities:** Leere Modell-Felder werden aus dem normalisierten Alert
  (`applyAuthoritativeEntities`) und aus dem Wazuh-Syscollector-Inventory (OS/MAC/FQDN) nachgefüllt —
  das Modell darf Fakten nicht „vergessen".
- **Deterministische Verdict-Floors** (Modell ist Erzähler, Evidence entscheidet):
  - **Evidence-Floor** (anhebend): VirusTotal ≥1 Engine bösartig → mind. „suspicious", ≥5 → „confirmed_incident".
  - **Benign-Floor** (herabstufend): AV/Scanner-**Selbstfehler** ohne Fund (clamd „Can't access file",
    Permission denied …) → „false_positive/low". Eng gefasst (Scanner-Kontext + Fehlermuster + kein Fund-Signal).
  - Reihenfolge: Benign-Floor **vor** Evidence-Floor → ein echter VT-/FOUND-Fund hebt eine fälschliche
    Benign-Einstufung wieder an.
  - **FP-Konsistenz-Guard:** `false_positive_possibility.possible=false` nur bei verdict=confirmed_incident.
- **Prompt-Guardrails:** confirmed_facts nur wörtlich belegt; Tool-/Scanner-Fehler ≠ Incident;
  SIEM-Severity ≠ eigene Risk-Bewertung.
- **Mensch-im-Loop bleibt:** Vorschläge sind `pending` → manuelles approve/reject (ADR P19), keine Auto-Aktion.

**Modell-Wahl:** Empirischer Vergleich (gleicher ClamAV-Fall) ergab: **llama3.2:3b** schlägt **llama3.1:8b**
hier (8b über-eskalierte zu „suspicious" und war ~2× langsamer auf CPU). → 3b bleibt Default; die Floors
kompensieren die Modellschwäche deterministisch. Kostenpunkt: `num_predict=2000` für reiches JSON → ~180 s
Generierung auf CPU.

**Begründung:** Prüfbare, halluzinations-resistente Analyse — die KI liefert Struktur + Erzählung, harte
Signale (VT / Tool-Fehler) entscheiden das Verdict deterministisch, der Mensch genehmigt.

---

## ADR-015 — Ein-Klick-FP-Regel aus dem Ticket + Sichtbarkeit im Detection Board

**Status:** akzeptiert (2026-06-14)

**Kontext:** Erkennt ein Analyst bei der Ticket-Analyse einen False Positive, war der Weg zur
Wazuh-Ausnahme bisher mehrstufig (Scope-Editor → Vorschau → Weiterleiten → Apply). Gewünscht ist
**ein Knopfdruck**, und die erzeugte Regel soll im **Detection Board** sichtbar sein. Beides darf das
bestehende Sicherheitsmodell (Vier-Augen, Safety-Gate, Guardrails aus ADR-011) **nicht** aushebeln.

**Entscheidung:**
- **`quick()`-Pfad, rollenabhängig** (kein neuer Wazuh-Code — delegiert an die geprüften Pfade aus ADR-011):
  - **Analyst** → `forward` (erzeugt + leitet zur Freigabe weiter, **kein** Wazuh-Write).
  - **Engineer/Admin** bei scharfem `WAZUH_FP_APPLY_ENABLED` → `apply` (schreibt + validiert, **kein** Auto-Restart).
  - **Engineer/Admin bei Gate AUS** → fällt bewusst auf `forward` zurück (kein 403-Dead-End, kein stiller Fehler).
- **Scope kommt aus der Evidence:** `/fp-exception/quick` baut den Scope server-seitig via `scopeFromEvidence`
  (wie `/suggest`); der Body darf Felder ergänzen (mind. `reason`). Alle Guardrails aus ADR-011 gelten weiter —
  unvollständiger Scope (dünne Evidence) → `ok:false`, das Frontend öffnet dann den vollständigen Editor zum Nachschärfen.
- **RBAC:** Route `requireRole('analyst')`; die Write-Entscheidung trifft `quick()` anhand der Rolle **und** des Gates.
- **Detection Board zeigt FP-Regeln:** FP-Suppression-Regeln (ID-Range 900000–920000 **oder** Gruppe
  `soc_false_positive`/`soc_fp_exceptions`, Helper `isFpRule`) erscheinen in der Detection Library mit Badge
  **„FP-Ausnahme"** und einem Typ-Filter (Alle / Detection / FP). Reine Anzeige — keine Aufweichung von ADR-013.
- **KI-Verdict proaktiv (Schritt 1 des Strangs):** Im Analyse-Deck zieht das Deck den jüngsten KI-Vorschlag
  zum Ticket (`agentApi.forTicket`, `deriveKiFp`). Ist das Verdict `false_positive`, zeigt der Decision-Block
  ein Banner „KI-Einschätzung: False Positive (Confidence)"; „Übernehmen" setzt Decision=fp + füllt die
  Begründung (nur wenn leer). **Human-in-the-loop bleibt** (ADR P19/ADR-014) — die KI entscheidet nichts selbst.

**Begründung:** Ein Klick beschleunigt den Alltag, ohne die Sicherheits-Naht zu verletzen: der Analyst schreibt
nie selbst, der Write bleibt hinter Rolle + Safety-Gate, und die scoped-Guardrails (kein globales Stummschalten)
bleiben die eine Quelle der Wahrheit. Die Board-Sichtbarkeit macht erzeugte Ausnahmen nachvollziehbar.

**Härtung aus dem Live-Betrieb (2026-06-14, „richtig bauen statt pflastern"):** Ein echter mDNS-Multicast-FP
deckte drei Schwächen auf, die als Produkt-Features behoben wurden:
1. **Restart-422-Fix:** Der Manager-Restart killt die eigene API mitten in der Antwort (ECONNRESET) — das ist
   erwartet, kein Fehler. `WazuhApiClient.restartManager` bestätigt den Erfolg jetzt per `managerStatus`-Polling
   (analysisd `running`) statt 422 zu melden; echte HTTP-Fehler (403) bleiben Fehler.
2. **Quell-agnostische Ziel-Ausnahmen:** mDNS/SSDP-Multicast kommt von *vielen* Quellen — eine srcip-gebundene
   Ausnahme ist Whack-a-Mole. `validateScope` erlaubt jetzt `dstip`-only, **wenn alle Ziele Multicast (224.0.0.0/4)/
   Broadcast sind oder ein Port das Scope einengt** (sonst weiter verboten — kein Quell-Global).
3. **Basis-Regel-Targeting für Frequency-Regeln:** `getRuleDetail` liest `if_matched_sid`/`frequency`;
   `recommendExceptionTarget` empfiehlt, die Ausnahme auf die **Basis-Regel** (z.B. 87702→87701) zu legen, damit
   das Rauschen gar nicht erst aggregiert. `/suggest` liefert `ruleTarget`, das Modal bietet einen Ein-Klick-Wechsel.

---

## ADR-016 — Autonomie-Fundament: AutonomyPolicy auf den Evidence-Floors (Default-Advisory)

**Datum:** 2026-06-15
**Status:** **Accepted** (2026-06-15) — Schritt 2 freigegeben: Modell + Repo + Migration + reiner `AutonomyEvaluator` + Admin-UI werden gebaut, aber **vollständig inert** (`AUTONOMY_ENABLED=false`, Default-Deny, **nicht** in `AgentService` verdrahtet — das Gate schaltet nichts). Erste autonomie-fähige Aktionsklasse für späteres L2: **`enrichment`** (rein additiv, reversibel, nicht personenwirksam). L2-Scharfschaltung bleibt ein separater, eigens freizugebender Schritt (Rollout-Punkt 4).

**Kontext:**
Das Produkt ist seit P19 bewusst **strikt Human-in-the-Loop**: Die KI *schlägt vor* (`AgentSuggestion` `pending` → `approve`/`reject`), ein Mensch *entscheidet* (ADR-014, ADR-015). Das schafft Vertrauen, ist DSGVO-anschlussfähig (Art. 22 — keine ausschließlich automatisierte Entscheidung mit erheblicher Wirkung) und war richtig für den Aufbau.

Mit wachsender Abdeckung (100+ Systeme, 327+ Tickets, deterministische Evidence-Floors) entsteht aber echter Bedarf: **hochsichere, risikoarme, reversible** Routinefälle (z. B. Enrichment anhängen, einen evidenzgestützten internen FP schließen, einen Report-Entwurf erzeugen) binden Analysten-Zeit, obwohl die Entscheidung deterministisch belegt ist. Die Frage ist **nicht** „autonom ja/nein", sondern: **welche Aktionsklasse darf, für welchen Mandanten, ab welcher belegten Schwelle, in welchem Autonomie-Grad ohne Vorab-Freigabe laufen — und wie bleibt das jederzeit nachvollziehbar und umkehrbar.**

**Entscheidung (Modell, noch nicht aktiviert):**
Ein **`AutonomyPolicy`**-Modell als *Gate* vor jeder potenziell autonomen Aktion. Kernform (Vorschlag):

```
AutonomyPolicy {
  id, customer,            // Mandant (= Ticket.customer); '*' = Default für alle
  actionClass,             // siehe Taxonomie unten
  mode,                    // 'advisory' | 'assisted' | 'autonomous'  (Default 'advisory')
  minVerdict,              // z.B. 'false_positive' | 'suspicious' | 'confirmed_incident'
  minConfidence,           // 0..1, ergänzend — NIE allein ausreichend
  requireEvidenceFloor,    // bool, Default true: nur deterministisch belegte Verdicts zählen
  maxPerHour,              // Rate-Limit / Circuit-Breaker
  enabled,                 // Default false
  createdBy, updatedAt
}
```

**Harte Invarianten (nicht verhandelbar, gelten über jede Policy hinweg):**

1. **Default-Deny / Opt-in.** Ohne explizite, aktivierte Policy für `(customer × actionClass)` → `advisory` (heutiges Verhalten). Kein impliziter Autonomie-Zustand.
2. **Globaler Kill-Switch.** ENV `AUTONOMY_ENABLED` (Default `false`). Aus = jede Policy ist wirkungslos, alles bleibt Vorschlag. Wie `WAZUH_FP_APPLY_ENABLED` (ADR-015).
3. **Autonomie sitzt auf den Evidence-Floors, nicht auf LLM-Confidence.** Eine Schwelle gilt nur als erfüllt, wenn das Verdict **deterministisch** (ADR-014: VT-Engines / Benign-Floor) abgesichert ist, nicht durch rohe Modell-Confidence allein. `requireEvidenceFloor=true` ist Default und für schreibende Klassen erzwungen.
4. **Blast-Radius-Decke.** Aktionsklassen sind nach Umkehrbarkeit/Reichweite gestaffelt; irreversible/externe/personenwirksame Aktionen sind **per Definition human-only**, egal welche Policy (siehe Taxonomie). Policy kann eine Decke nie überschreiben.
5. **Post-hoc-Vier-Augen statt Vorab-Vier-Augen.** Jede autonome Aktion landet im Audit-Log (Policy-ID, Schwelle, Verdict, Evidence-Refs, Vorher/Nachher) **und** in einer Review-Queue; ein Mensch kann sie nachträglich prüfen und **rückgängig** machen (Undo-Pfad ist Pflicht für jede autonomie-fähige Klasse).
6. **Circuit-Breaker.** Eine menschliche Korrektur einer autonomen Aktion **oder** N Fehlschläge → Policy fällt automatisch auf `advisory` zurück (fail-safe, kein stilles Weiterlaufen).
7. **DSGVO Art. 22 / Art. 5.** Keine ausschließlich automatisierte Entscheidung mit erheblicher Wirkung auf Personen ohne Safeguard. Personenwirksame Klassen (Host-Isolation, Kunden-Kommunikation) bleiben human-only. Audit ist append-only (ADR-012).

**Aktionsklassen-Taxonomie + Decke (Vorschlag):**

| Klasse | Beispiel | Umkehrbar? | Höchster zulässiger Modus |
|---|---|---|---|
| `enrichment` | TI-Lookup anhängen, Entities normalisieren | ja, additiv | **autonomous** (Kandidat L2 zuerst) |
| `internal_state` | evidenzgestützter FP intern schließen, Tag setzen | ja (intern) | assisted → später autonomous |
| `draft_generation` | Report-/Kundenantwort-**Entwurf** (kein Versand) | ja (nur Text) | autonomous (Entwurf bleibt pending zum Senden) |
| `detection_write` | Wazuh-FP-Regel schreiben + Restart | bedingt (revert) | **assisted-only** (Decke — ADR-011/015 bleiben) |
| `host_response` | Host-Isolation, Block | personenwirksam | **human-only** (Decke) |
| `external_comms` | Mail/Ticket an Kunden senden | nein | **human-only** (Decke) |

**Autonomie-Grade:**
- **L0 advisory** — heute. KI schlägt vor, Mensch entscheidet.
- **L1 assisted** — Ein-Klick-Ausführung mit vorausgefüllter, evidenzgestützter Aktion (wie ADR-015 `quick()`).
- **L2 autonomous-with-post-review** — Aktion läuft automatisch **bei erfüllter, belegter Schwelle**, landet sofort in der Review-Queue mit Undo + Circuit-Breaker. **Nur** für reversible, interne, nicht-personenwirksame Klassen.
- **L3 silent-autonomous** — **nicht geplant**, bewusst ausgeschlossen.

**Rollout (streng gestaffelt, jeder Schritt einzeln freizugeben):**
1. **Dieser ADR** (Richtungsentscheidung) → Freigabe.
2. `AutonomyPolicy`-Domain + Repo (InMemory/Postgres) + Migration + **reiner `AutonomyEvaluator`** (`decide(policy, suggestion, evidence) → 'advise' | 'act'`), **Default-Deny**, voll getestet. **Noch als reines Gate, das nichts schaltet** (`AUTONOMY_ENABLED=false`).
3. Admin-only UI zur Policy-Pflege pro Mandant (analog Settings-RBAC).
4. **Erst danach, separat freizugeben:** L2 für **genau eine** risikoarme Klasse (Vorschlag: `enrichment`) im Lab, mit Post-Review + Circuit-Breaker, beobachtet.

**Begründung:**
Autonomie wird ein **konfigurierbares, default-ausgeschaltetes, evidenz-gebundenes** Gate — kein Architektur-Bruch des Human-in-the-Loop-Versprechens. Dieselbe deterministische Evidenz, die heute das Verdict absichert (ADR-014), wird zur Bedingung fürs Handeln; Reichweiten-Decken, Post-hoc-Review, Undo und Circuit-Breaker halten das Risiko reversibel und prüfbar. Das Produkt kann „mitwachsen", ohne je in einen unkontrollierten Auto-Pilot zu kippen.

**Offene Entscheidungen für die Freigabe:** (1) erste autonomie-fähige Aktionsklasse, (2) Start-Grad (Empfehlung: Modell+Evaluator bauen, aber bei `AUTONOMY_ENABLED=false` belassen — also faktisch L0/L1, L2 erst später), (3) Mandanten-Granularität jetzt schon (`customer`) oder vorerst nur global `*`.

---

## ADR-017 — Auth: Cookie-only + CSRF Double-Submit (kein Token im sessionStorage)

**Status:** Akzeptiert · umgesetzt 2026-06-16 (live)

**Kontext:** Der JWT lag im `sessionStorage` und wurde als Bearer-Header gesendet. Das httpOnly-`soc_token`-Cookie existierte zwar, war aber durch den Bearer-Pfad faktisch wirkungslos — jeder XSS konnte den Token lesen (Audit-Top-Fund, von 3 Review-Agenten bestätigt).

**Entscheidung:**
- Frontend speichert **keinen Token mehr**. Auth läuft über das httpOnly-`soc_token`-Cookie (`credentials:'include'`); `/auth/me` restauriert die Session ohne Token-Gate.
- **CSRF Double-Submit:** Server setzt bei login + /me ein JS-lesbares `csrf_token`-Cookie (sameSite=strict); das Frontend schickt es bei state-changing Methoden als `X-CSRF-Token`-Header. `csrfGuard` (am v1-Prefix) prüft Gleichheit — **nur** für echte Cookie-Sessions (soc_token vorhanden, kein Bearer). Ausgenommen: Bearer/PAT (CSRF-immun), Webhooks (HMAC), `/auth/login`, Safe-Methods.
- Bearer wird weiterhin akzeptiert (API-Clients/PAT + sanfter Übergang).

**Konsequenz:** XSS kann den Token nicht mehr stehlen. CSRF-Guard reicht unauthentifizierte Requests an `requireAuth` durch (401, nicht 403). Bestehende Tabs laufen via Bearer bis zum Reload weiter.

---

## ADR-018 — Mehr-LLM-Provider (lokal + Cloud) mit At-Rest-verschlüsselten Keys

**Status:** Akzeptiert · umgesetzt 2026-06-16 (live)

**Kontext:** Bisher nur Ollama/Stub, Provider-Wahl per ENV. Wunsch: Anthropic/OpenAI/Google nutzbar **und** alles im UI/Backend konfigurierbar (ENV zu umständlich).

**Entscheidung:**
- Cloud-Provider erben die gesamte Prompt-/Parse-/Evidence-Floor-Logik (`PromptAnalysisLlmProvider`) und überschreiben nur `_complete()`.
- Provider/Modell/Parameter zur Laufzeit aus den Settings (UI wirkt live); **Primär + Fallback-Kette** (`FallbackLlmProvider`) weicht bei Ausfall/Timeout/Auth-Fehler auf Fallback 1/2 aus.
- **API-Keys im Backend einstellbar**, AES-256-GCM-**verschlüsselt at-rest** (`secretsCrypto`, Schlüssel `SETTINGS_ENC_KEY`||`JWT_SECRET`, Dev-Fallback nur non-prod). GET gibt Keys **nie** im Klartext zurück (nur Status `configured`/`keySource`). ENV hat Vorrang.

**⚠ Datenschutz:** Cloud-Provider sind **opt-in** (Default `stub`/lokal). Bei Aktivierung verlassen Ticket-/Alert-Daten (ggf. PII) das interne Netz → vorher DSGVO-seitig absichern (AVV). In UI + `.env.example` gekennzeichnet. Bricht bewusst mit dem ursprünglichen „nur lokal"-Prinzip — Nutzer-Entscheidung.

---

## ADR-019 — Security-Policy-Härtung: alles serverseitig erzwungen, default-AUS

**Status:** Akzeptiert · umgesetzt 2026-06-16 (live)

**Kontext:** Settings zeigten zuvor teils nicht-erzwungene „geplant"-Toggles. Härtung sollte echt sein (ADR-009: keine Fake-Toggles).

**Entscheidung:** Folgende Kontrollen sind serverseitig erzwungen und **default deaktiviert/0** (kein Verhaltenswechsel ohne Admin-Aktivierung → sicher deploybar):
- **Account-Lockout** (`login_lockouts`, Postgres-persistent, restart-/multi-instanz-fest)
- **Passwort-History** (Wiederverwendungssperre, `users.password_history` JSONB)
- **Passwort-Ablauf** (Flag an login/me + Frontend-Zwangswechsel-Gate)
- **Mehrfach-Sitzungen** (`user_sessions`, älteste über Limit → Blocklist)
- **Inaktivitäts-Timeout** (clientseitig)
- **TLS-erzwingen** + **IP-Allowlist** (App-Guards, `/health` immer frei, fail-safe)

**Konsequenz:** Migration 031 (password_aging). Auth-Tabellen (jwt_blocklist/login_lockouts/user_sessions) bewusst Lazy-Init statt Migration (einheitlich; Tech-Debt: später migrieren). MFA/TOTP + SSO/OIDC bleiben ehrlich „geplant".

---

## ADR-020 — Provisioning / Control-Plane: No-Apply-Sicherheitsmodell (per Test erzwungen)

**Datum:** 2026-06-20
**Status:** Accepted — Fundament umgesetzt (Phase-6); LIVE: P_PROVISION_SECURITY_1 (`3370fcc`)

**Kontext:**
Nexora soll 100+ Nodes (Sensoren/Agents) verwalten: registrieren, inventarisieren, ihren Zustand überwachen. Eine klassische „Control-Plane" verleitet dazu, Nodes auch **fernzusteuern** (Pakete installieren, Netzwerk/Firewall ändern, Befehle ausführen). Genau das ist für ein SOC-Tool ein inakzeptabler Blast-Radius: ein kompromittierter Server würde damit zur Waffe gegen die gesamte Flotte (vgl. CLAUDE.md: „kein SIEM-/EDR-Ersatz, keine automatische Bedrohungsentfernung").

**Entscheidung:**
Die Control-Plane hat **keinen** Remote-Command-, Apply- oder Netzwerk-Konfigurations-Kanal. Sie inventarisiert und überwacht — sie steuert nicht fern.
- **Domain (6 Entities):** ProvisioningProfile · EnrollmentProfile · InstalledNode · NodeCapability (read-only allow-list) · NodeHeartbeat · ProvisioningAuditEvent (append-only, redacted). Postgres-Persistenz (Migrationen 033–035, FK 037), InMemory/Postgres-Parität via Factory.
- **No-Apply per Test erzwungen:** `provisioningDomain.test.js` scannt alle Domain-Methoden gegen eine Forbidden-Regex (`apply|exec|ssh|remote|shell|spawn|network|nat|route|firewall|dhcp|sniff`) → CI rot bei Verstoß. Der Linux-Installer (`deploy/install/`) hat ein eigenes Safety-Gate, das jede ausführbare Zeile gegen Netz-/Firewall-Kommandos prüft.
- **Server-Antwort enthält nie Befehle:** Heartbeat-Antwort = `{ accepted, serverTime, desiredProfileId }` — deklarativer Zielzustand, kein Code, kein Apply-Trigger.
- **Secrets Hash-only, Klartext einmalig:** Enrollment-Token (`enr_`+64hex) und Node-Credential (`ncr_`, 256-bit) werden nur als SHA-256-Hash gespeichert; Klartext nur einmalig bei Mint/Enroll. Enroll single-use (consume-vor-mint, CAS). Heartbeat nur per Node-Credential (Enrollment-Token → 401) + Node-Bindung (`auth.nodeId == :id`, sonst 403). Credential-Revoke (CAS-idempotent) + Node-Retire (revoke-on-retire).
- **Rate-Limits (P_PROVISION_SECURITY_1):** `/enroll` pro-IP (nur Fehlversuche), `/heartbeat` pro-nodeId (NAT-transparent).
- **RBAC:** admin für Verwaltung (Enrollment-Profile, Token-Mint, Node-Liste/-Detail, Audit, Credential-Revoke, Retire); node-facing nur `/enroll` (Token im Body) + `/heartbeat` (Bearer Node-Credential).

**Konsequenzen:**
- Kein Fernsteuerungs-Missbrauch möglich, selbst bei kompromittiertem Server — die fehlende Fähigkeit ist die Sicherheit, nicht eine Konfiguration.
- Node-seitige Aktionen (echte Installation) bleiben bewusst Sache des lokalen, read-only Installers; spätere Lab-VM-Tests nur nach explizitem Go.
- Tech-Debt/Follow-ups: Credential-Rotation, optionale Defense-in-Depth-Limits.

---

## ADR-021 — NIS2 Readiness & Evidence: Selbsteinschätzung, KEIN Konformitätsnachweis

**Datum:** 2026-06-20
**Status:** Accepted · LIVE: P_NIS2_1/P_NIS2_2 (`5e009c3`/`3370fcc`); P_NIS2_3 (Review-Kadenz) lokal

**Kontext:**
NIS2 erzeugt Compliance-Druck bei Betreibern. Ein Tool, das „NIS2-Konformität" verspricht, wäre rechtlich riskant und unehrlich — Konformität stellen Auditoren/Behörden fest, nicht eine Software. Gleichzeitig hilft eine strukturierte Readiness-Sicht mit Evidenz-Verknüpfung dem SOC real weiter.

**Entscheidung:**
Nexora liefert eine **NIS2-Readiness-Sicht** (Selbsteinschätzung + Evidenz), **kein** Konformitätsnachweis, **keine** Zertifizierung, **kein** Rechtsgutachten — per Test erzwungen (kein Compliance-Claim im Code/UI/Report).
- Statischer, versionierter 10-Control-Katalog (stabile Keys, deutsche Titel).
- `Nis2Assessment` (Status `not_started…addressed/not_applicable`; n/a braucht Begründung) + `Nis2EvidenceLink` (8 Typen). Migration 036_nis2.
- Readiness-Signale `overdue` / `missingEvidence` / `needsReview`; **addressed ohne Evidence ⇒ needsReview**. Review-Kadenz `reviewDue` (Stale-Evidence, Default 365 T — P_NIS2_3, lokal).
- **Evidence-`ref` hart validiert:** nur http/https, kein `user:password@`, keine Secret-Query-/Fragment-Keys, kein `javascript:`/`data:`, keine Steuerzeichen.
- Routen `/v1/nis2` (Lesen viewer+, Schreiben admin) + Incident-Evidence (nur sichere Snapshot-Felder, **kein PII**) + Management-Readiness-Report (`/v1/nis2/report`) mit sichtbarem **Disclaimer**.
- Audit trägt **nur sichere Metadaten** — nie notes/URL/Inhalt.

**Konsequenzen:**
- Ehrliche Positionierung schützt Anbieter und Betreiber; deckt sich mit ADR-009 (keine Fake-Vollständigkeit).
- Datenminimierung (DSGVO Art. 5) durch PII-freie Incident-Snapshots und Audit-Redaction.
- Der Report ist Entscheidungs-/Vorbereitungshilfe, kein Nachweisdokument.

---

## ADR-022 — MFA/TOTP eigenständig (RFC 6238, ohne externe Lib) + org-weite Pflicht

**Datum:** 2026-06-20
**Status:** Accepted · umgesetzt + LIVE (`41d8d92`)

**Kontext:**
Passwort-allein-Login ist für ein SOC-Tool unzureichend (OWASP A07). Ein zweiter Faktor ist Pflicht-Niveau (ASVS L2). Eine schwere externe MFA-Lib würde Angriffsfläche und Supply-Chain-Risiko erhöhen; TOTP (RFC 6238) ist mit Node-Crypto trivial selbst umsetzbar.

**Entscheidung:**
- **TOTP** (RFC 6238) als zweiter Faktor, **ohne** externe Lib (Node-Crypto). Enrollment-Domäne + Login-Challenge + einmalige **Recovery-Codes** (Geräteverlust). Migration 038_mfa_enrollments.
- **Org-weite Pflicht** via Setting `mfaRequired`: erzwingt MFA-Enrollment beim Login (Setup-Token-Flow), bevor die Session voll nutzbar ist.
- Routen `/v1/mfa/*`, `/v1/auth/mfa`, `/v1/auth/mfa-setup/{begin,complete}`. ENV `MFA_ENABLED` (default AUS).
- **Self-Service für alle Rollen** über ProfilePage (per-User-Flag `mfaEnabled` via `GET /v1/profile`).

**Konsequenzen:**
- Phishing-/Credential-Stuffing-Widerstand für Bestands-Accounts ohne Fremd-Abhängigkeit.
- Recovery-Codes müssen sicher verwahrt werden (Nutzer-Hinweis im UI).
- TOTP bleibt anfällig für Echtzeit-Phishing — deshalb ergänzend WebAuthn/Passkey (ADR-024).

---

## ADR-023 — SSO/OIDC (Authorization Code + PKCE S256, default AUS, nur Account-Linking)

**Datum:** 2026-06-20
**Status:** Accepted · Slice 2 umgesetzt, **LOKAL** (noch nicht deployt)

**Kontext:**
Unternehmen wollen ihren IdP (Entra ID, Keycloak …) anbinden. SSO darf aber nicht zum unkontrollierten Auto-Provisioning werden (Fremde, die sich beim IdP registrieren, dürfen nicht automatisch SOC-Zugang erhalten). Auch hier soll keine schwere Lib das Risiko erhöhen.

**Entscheidung:**
- **OIDC Authorization Code Flow + PKCE (RFC 7636, Methode S256)** + `state` + `nonce`, umgesetzt über Node-Crypto (`backend/src/auth/oidc/`), **keine** externe OIDC-Lib.
- **default AUS** (ENV `OIDC_*`). `allowSignup` AUS → **nur Verknüpfung bestehender Accounts**, kein Auto-Provisioning. Default-Rolle für verknüpfte Accounts: `viewer` (least privilege).
- **Open-Redirect-Schutz:** Redirect-Ziele sind fest + intern, nie aus Request-Parametern. Discovery/Token-Fetches mit `redirect:'error'` (SSRF-Härtung, ADR-025).
- Migration 039_user_oidc_link. Passwort-Login bleibt parallel verfügbar.

**Konsequenzen:**
- Enterprise-IdP-Anbindung ohne Kontrollverlust über die Account-Basis.
- Geringe Supply-Chain-Fläche (kein Fremd-OIDC-Stack).
- Live-Aktivierung erfordert IdP-Konfiguration + bewussten Deploy.

---

## ADR-024 — WebAuthn / Passkey (FIDO2) als phishing-resistente Anmeldung

**Datum:** 2026-06-20
**Status:** Accepted · umgesetzt, **LOKAL** (noch nicht deployt)

**Kontext:**
TOTP (ADR-022) schützt vor Credential-Reuse, ist aber gegen Echtzeit-Phishing nicht immun. FIDO2/WebAuthn bindet die Anmeldung kryptografisch an die Origin und ist damit **phishing-resistent** — der Goldstandard für Authentifizierung.

**Entscheidung:**
- **WebAuthn/Passkey (FIDO2)** über die etablierte, fokussierte Bibliothek `@simplewebauthn` (bewusste Ausnahme von „keine externe Lib": die WebAuthn-Ceremony selbst zu implementieren wäre fehleranfällig und sicherheitskritisch).
- `backend/src/auth/webauthn/`, Routen `/v1/auth/webauthn/*`, ENV `WEBAUTHN_*` (default AUS). Migration 040_webauthn_credentials.
- **Ergänzt** TOTP-MFA, **ersetzt** es nicht. Self-Gating-Card auf ProfilePage + Passkey-Button auf LoginPage. Passwort-Login bleibt parallel.

**Konsequenzen:**
- Stärkster verfügbarer Login-Faktor; reduziert Phishing-Risiko gegenüber TOTP.
- Eine (gut gepflegte) Fremd-Abhängigkeit — durch das Dependency-Gate (ADR-029) überwacht.
- Geräte-/Authenticator-Verlust muss über alternative Faktoren (TOTP/Recovery, Passwort) abgefangen bleiben.

---

## ADR-025 — Ausgehende HTTP-Aufrufe folgen keinen 3xx-Redirects (SSRF-Härtung)

**Datum:** 2026-06-20
**Status:** Accepted · umgesetzt (Review-Härtung)

**Kontext:**
Der zentrale HTTP-Client (`RealHttpClient`) und der OIDC-Flow sprechen externe Systeme an, oft mit einem `Authorization`-Header. `node-fetch` folgt 3xx-Redirects standardmäßig **und** reicht dabei den Auth-Header an das vom Server gewählte Ziel weiter → ein bösartiges/kompromittiertes Ziel könnte Credentials abgreifen oder den Client zu internen Ressourcen umlenken (SSRF). Ein Review-Agent stufte dies als Härtungsbedarf ein.

**Entscheidung:**
Alle ausgehenden Fetches setzen `redirect: 'error'` — ein 3xx wird **nicht** automatisch verfolgt, sondern als Fehler behandelt. Gilt für `backend/src/integrations/http/RealHttpClient.js` sowie für OIDC-Discovery- und Token-Fetches.

**Konsequenzen:**
- Kein transparenter Credential-Leak über umgeleitete Auth-Header; kein Redirect-getriebenes SSRF.
- Integrationen, die legitim auf Redirects angewiesen sind, müssten das Endziel explizit konfigurieren (bewusster Trade-off zugunsten Sicherheit).

---

## ADR-026 — CrowdSec-WAN-Integration über die Adapter-Pflicht (kein CTI-Sonderweg)

**Datum:** 2026-06-20
**Status:** Accepted · Pipeline end-to-end **lokal**; Live-ENV-Anbindung offen

**Kontext:**
Der Webserver-CrowdSec liefert externe Angriffssignale (HTTP-Bruteforce, Scanner, CVE-Probes, Bad Bots). Diese sollen in Nexora als Tickets korreliert werden. Verlockung wäre ein eigener Sonderpfad — das würde aber die Adapter-Naht (ADR-002) umgehen und externen, unvalidierten Input direkt ins interne Modell lassen.

**Entscheidung:**
CrowdSec wird wie jede andere SIEM-Quelle über die **Adapter-Pflicht** angebunden: Adapter + LAPI-Client (Machine-JWT → `/v1/alerts`) + Poller + Processor validieren und normalisieren, **bevor** ein Ticket entsteht. Damit erbt CrowdSec die bestehende Pipeline (Dedup/Normalize/Queue, ADR-002/004/006). ENV `CROWDSEC_*` (LAPI-URL + Machine-Creds), default inaktiv.

**Konsequenzen:**
- Externer Angriffsdruck wird sichtbar/korrelierbar, ohne das interne Ticketmodell aufzuweichen.
- Kein Adapter-Bypass → konsistente Traceability (ADR-005) auch für WAN-Signale.
- Es bleibt eine Korrelations-Quelle, **kein** CTI-/Reputations-Feed.

---

## ADR-027 — Notification-Outbound: mehrere Kanäle, default AUS, ohne Secret-Leak

**Datum:** 2026-06-20
**Status:** Accepted · Slack/Webhook/Teams + E-Mail/SMTP umgesetzt (E-Mail lokal)

**Kontext:**
SOC-Ereignisse (Eskalation, ausstehende Freigabe) sollen Analysten erreichen. Ausgehender Traffic ist aber eine neue Angriffs-/Leak-Fläche: falsch konfiguriert verlassen Daten das Netz; Webhook-URLs/SMTP-Creds sind selbst Secrets.

**Entscheidung:**
- Kanäle: **Slack**, generischer **Webhook**, **Microsoft Teams**, **E-Mail/SMTP** (nodemailer, **lazy** geladen). E-Mail-Kanal = lokal (nach `41d8d92`).
- **default AUS** via `NOTIFICATIONS_OUTBOUND_ENABLED` — kein ausgehender Traffic ohne explizite Aktivierung. ENV `NOTIFY_*` für URLs/SMTP.
- `GET /v1/notifications/channels` meldet **nur** `.configured`-Booleans (keine URLs/Secrets). Best-effort-Versand: Fehler werden geloggt **ohne** URL/SMTP-Daten — nur Channel-ID + anonyme Meldung.

**Konsequenzen:**
- Erreichbarkeit ohne Standard-Datenabfluss; Secrets bleiben unsichtbar in API/Logs.
- nodemailer lädt erst beim ersten Versand → kein Modul-Overhead bei deaktiviertem Kanal.
- Dieser Outbound-Kanal ist der reale Versandpfad für E-Mail-Benachrichtigungen; ein früher angedachter separater Mail-Server-Plan ist damit hinfällig.

---

## ADR-028 — Correlation Engine + FQDN-Resolver: nie erfundene Werte (no-fake + Provenance)

**Datum:** 2026-06-20
**Status:** Accepted · CE-1…CE-5 live (CE-5.3 FQDN-Resolver LIVE)

**Kontext:**
Korrelierte Evidence (Host, MAC, Interface, FQDN, Flow) ist Grundlage für Triage-Entscheidungen und ggf. Beweiskette. Geratene/erfundene Werte zerstören Vertrauen und können zu Fehlentscheidungen führen — ein FQDN, der nicht wirklich zur IP gehört, ist gefährlicher als ein leeres Feld.

**Entscheidung:**
- **Quellen-Normalizer-Registry** (alle Quellen, nicht nur Wazuh), Host-Case-Aggregation, **entitätszentrierte Korrelation mit Provenance** (jede Aussage trägt ihre Quelle ×N).
- Network/NAT-Flow-Modell aus **Firewall und Sysmon Event 3** (Wazuh-Regel 100951); Inventory-Anreicherung trennt **Host-NIC vs. Firewall-Interface** (MAC, Host).
- **FQDN-Resolver (CE-5.3, LIVE):** Reihenfolge Event-Computer > Inventory > **DNS-forward-confirm** (read-only; A-Record muss == Flow-IP, sonst kein Wert). ENV `FQDN_RESOLVER_ENABLED`, `FQDN_DNS_SERVER`, `FQDN_DOMAIN`.
- **Invariante:** fehlt etwas → `null` + `missingReason` + `provenance`, **nie** ein erfundener Wert.

**Konsequenzen:**
- Prüfbare, ehrliche Evidence; deckt sich mit ADR-009 (keine Fake-Daten) und dem HuntingThreats-Traceability-Prinzip.
- Spezifikationen: `docs/01-architecture/correlation-data-model.md`, `ce5-fqdn-source-discovery.md`.
- Reverse-PTR/LDAP-Quellen bleiben bewusst geparkt (lieber `null` als unsicher).

---

## ADR-029 — Dependency-Security-Gate: npm-audit (Prod-only) + CycloneDX-SBOM

**Datum:** 2026-06-20
**Status:** Accepted · CI-Workflow `security.yml` aktiv

**Kontext:**
Supply-Chain-Risiken (OWASP A03) wachsen mit jeder Abhängigkeit. Verwundbare Prod-Dependencies dürfen nicht unbemerkt live gehen; eine maschinenlesbare Stückliste ist für Audits/Reaktion nötig.

**Entscheidung:**
- CI-Workflow `.github/workflows/security.yml`:
  - `npm audit --omit=dev --audit-level=high` → **Prod-Dependency-Gate** (CI rot bei High/Critical; dev-only Funde blockieren nicht).
  - **CycloneDX-SBOM**-Generierung als Artefakt.
  - Trigger: push + PR + **wöchentlicher Cron** (neue CVEs gegen bestehenden Code).
- Im Zuge der Einführung wurden 2 produktive High-Vulns gefixt.

**Konsequenzen:**
- Kontinuierliche, automatisierte Überwachung statt punktueller Prüfung.
- Bewusster Fokus auf Prod-Dependencies (dev-Tooling-Funde nicht release-blockierend).
- SBOM unterstützt Incident-Reaktion und NIS2-Readiness (ADR-021).

---

## ADR-030 — Persistenter Postgres-Cache für Threat-Intel-Reputation

**Datum:** 2026-06-20
**Status:** Accepted · umgesetzt

**Kontext:**
Threat-Intel-Lookups (VirusTotal/AbuseIPDB) sind quota- und latenzbehaftet. Ein nur prozess-interner Cache geht bei jedem Neustart/Deploy verloren → unnötige API-Calls, Quota-Verbrauch, langsamere Triage.

**Entscheidung:**
TI-Reputation wird in einem **persistenten Postgres-Cache** (`threat_intel_cache`) abgelegt, gewählt über die Domänen-Factory (`DB_ENABLED`). Damit überlebt die Reputation Neustarts; InMemory bleibt für Tests/Dev (Repository-Muster, vgl. CLAUDE.md).

**Konsequenzen:**
- Weniger externe Calls (Quota/Kosten geschont), schnellere wiederholte Lookups.
- Cache-Aktualität vs. Quota muss über TTL ausbalanciert bleiben.
- Konsistent mit dem projektweiten InMemory/Postgres-Factory-Muster.

---

## ADR-031 — Reports: technischer Incident-Report vs. Kunden-Report ohne sensible Leaks

**Datum:** 2026-06-20
**Status:** Accepted · Reports-MVP umgesetzt

**Kontext:**
Ein Bericht für Analysten/Tier-3 braucht volle technische Tiefe (IP, MITRE, IOC, Raw). Ein Bericht für Kunden darf diese internen Details **nicht** enthalten — sonst Datenabfluss interner Topologie/Detection-Logik und ggf. Drittdaten.

**Entscheidung:**
Zwei getrennte Report-Typen:
- **Incident-Report (technisch)** — vollständige Triage-/Evidence-Tiefe für interne Adressaten.
- **Kunden-Report (nicht-technisch)** — **ohne** IP / MITRE / IOC / Raw-Leak, **per Test erzwungen**.
- PDF-Erzeugung via jsPDF (dynamisch geladen). Zwei Buttons im Report-Tab.

**Konsequenzen:**
- Klare Trennung interner vs. externer Informationstiefe (Datenminimierung, DSGVO Art. 5).
- Der Test als Leitplanke verhindert versehentliches Durchsickern technischer Felder in den Kunden-Report.
- Erweiterbar um weitere Felder, solange der Kunden-Report-Test grün bleibt.

---

## ADR-032 — Materialisierte asynchrone Korrelation (P_CORR_1)

**Datum:** 2026-06-21
**Status:** Accepted · implementiert auf Branch `p-corr-1`, Pre-Deploy-Gates offen

**Kontext:**
Bis P_CORR_0 lief die Korrelation synchron auf dem Evidence-GET-Read-Pfad: Jede Anfrage an `GET /tickets/:id/evidence` rief `CorrelationEngine.correlate()` inline auf. Das blockierte den Response-Pfad, lieferte kein persistentes Ergebnis und ermöglichte keine saubere Status-Kommunikation an den Analysten. Komplexere Cases (Host-Case + N Child-Tickets) trieben die Response-Zeit in den Sekunden-Bereich.

**Entscheidung:**
Vollständige Trennung von Trigger, Ausführung und Lesen in drei klar abgegrenzte Subsysteme:

```
relevante Mutation (Ticket-Update / Evidence-Add)
  → transaktional: Ticket/Evidence persist + CorrelationJob persist (pending)
  → Queue-Benachrichtigung (pg-boss singletonKey = inputHash, best-effort)
  → Worker (CorrelationWorker, asynchron)
      → bounded Input laden (max 200 Children)
      → pure CorrelationEngine (unverändert, kein Side-Effect)
      → source_revision re-check (Änderung → kontrollierter Abort statt Stale-Result)
      → atomares saveResult
      → job.complete(resultId) ERST nach erfolgreichem Save
  → materialisierter Read-Pfad (GET /tickets/:id/evidence liest nur Repo)
  → CorrelationStatusBanner + OverviewSection (Analyst Deck, Polling)
```

**Warum der persistente Job die Wahrheit ist:**
Die Queue ist ausschließlich Ausführungsmechanismus. Scheitert `notifyQueue`, bleibt der Job persistent `pending` — kein Rollback, kein Fake-Erfolg. `reconcile()` reiht ihn bei nächstem Aufruf erneut ein. Die Wahrheit über den Korrelationsstand liegt immer in der DB, nie nur im Queue-State.

**Transaktionale Mutation:**
`CorrelationMutationService` führt `ticket.update` (oder `evidence.create` + `ticket.touch`) und `ensurePersistentJob` in **einer einzigen Postgres-Transaktion** aus (`BEGIN/COMMIT`). `notifyQueue` läuft bewusst nach dem Commit — so existiert der Job vor der Queue-Benachrichtigung.

**Idempotenz:**
- Job-Ebene: `input_hash` (SHA-256 aus `ticketId + sourceRevision + engineVersion`) als partial-unique-Index → kein Doppeljob bei parallelen Mutationen.
- Worker-Ebene: Existiert ein Resultat für den `inputHash` bereits, wird es direkt gelinkt (kein Recompute).
- Queue-Ebene: `pg-boss singletonKey = inputHash` dedupliziert redundante Enqueue-Aufrufe.

**Superseded-Status:**
Ändert sich `source_revision` zwischen Job-Anlage und Worker-Ausführung, bricht der Worker den Job kontrolliert ab (`fail("superseded: ...")`). Es wird kein veraltetes Resultat gespeichert. Das Frontend zeigt `superseded`-Status mit klarem Hinweis.

**Worker-Retry und Dead Letter:**
`_maxRetries = 3` (konfigurierbar). Auf jedem Fehler: `retry`-Status im Domain-Modell + Fehler re-throw an pg-boss (eigene Retry-/DLQ-Konfiguration des Queue-Adapters). Nach max. Retries: `failed`.

**Bounded Input:**
`DEFAULT_MAX_CHILDREN = 200` (< `MAX_RESULT_EVIDENCE` im Domain-Modell). Kein unbounded Evidence-/Flow-Laden im Worker.

**UI-Status, Polling und kein Recompute beim Lesen:**
- `GET /tickets/:id/evidence` ist reiner Read-Pfad: liest `activeJob` + `latestResult`, berechnet daraus `status` (`current | superseded | pending | running | retrying | failed | unavailable`).
- `useCorrelationPolling` (Frontend): nur GET, AbortController bei Unmount/Ticket-Wechsel, exponentieller Backoff (2 s → max 30 s), kein POST/Scheduler-Aufruf.
- `OverviewSection` rendert exklusiv aus `correlationStatus.result` (nicht aus `ev.correlation`). `extractCorrMeta(result: unknown)` prüft die echte Result-Form defensiv.
- `CorrelationStatusBanner` zeigt Status und stale-Warnung; `OverviewSection` zeigt das materialisierte Resultat — keine zweite parallele Korrelationsanzeige.

**Control Plane, kein Data-Plane-Code:**
P_CORR_1 ist Control-Plane-Kern des SOC-Orchestrators (Korrelation von SIEM-Ergebnissen). Kein High-Volume-Collector, kein Ingestion-Code. Data-Plane-Logik (zukünftig P_DATA_1/P_FIREWALL_COLLECTOR_1) wird in einem separaten privaten Repo entwickelt.

**Konsequenzen:**
- Der Analyst sieht immer den ehrlichen Zustand: berechnet / lädt / fehlgeschlagen / veraltet / nicht verfügbar — kein stiller Leerzustand statt eines echten Fehlers.
- Kein blocking im API-Request-Pfad durch Korrelationsberechnung.
- Neustart/Deploy verliert keinen Job (persistiert, reconcile re-enqueued).
- `DB_ENABLED=true`: Fehler beim Queue-Start propagieren sichtbar — kein stiller Fallback auf InMemory.

**Offene Pre-Deploy-Gates (kein Push, kein Merge, kein Deploy bis GO):**
1. SQL-EXPLAIN / Parität InMemory ↔ Postgres: `findSchedulableJobs`, `findActiveJobByInputHash`, `findLatestResultByTicket` unter realer DB-Last prüfen.
2. DB-Pool-Last: Transaktions-Overhead beim kombinierten Ticket+Job-Pfad unter Last messen.
3. Produktives PgBoss-Wiring: Readiness-Check im echten Deploy (pg-boss `start()` Timing, `LISTEN/NOTIFY` Cross-Container).
4. Live-pg-Queue-Gate: `npm run test:queue:integration` gegen echtes Postgres-16 (Docker) abschließend grün.

> **Update 2026-06-23:** P_CORR_1 ist **deployt** (`5b3042c`). pg-boss + Korrelations-Worker starten sauber gegen die Prod-Postgres (16.14); Pre-Deploy-Gates praktisch erfüllt (read-only verifiziert).

---

## ADR-033 — Evidence-Datenfluss: Korrelation ist die Deck-Primärquelle, lazy on read

**Status:** Akzeptiert · deployt 2026-06-23 (`a772a2e` / `4afe2af` / `4a96c01`)

**Kontext:** Der Analysis-Deck zeigte bei Wazuh-Tickets leere Commands/Payloads/Entities, obwohl der Roh-Alert die Daten enthält. Der Deck bezieht `ParsedEvidence` über `importedEvidence ?? polledEvidence(Korrelation) ?? buildEvidence(ticket-flach)`. Die **Korrelations-Engine** (`normalizeWazuhEvidence`) parst den vollen Roh-Alert aus `ticket.logs` und ist damit die reiche Primärquelle; der Frontend-`buildEvidence`-Fallback liest nur flache Felder.

**Entscheidung:**
1. **Lazy Schedule-on-Read:** `GET /tickets/:id/evidence` plant bei Status `unavailable`/`superseded` selbst einen Korrelations-Job (idempotent über `input_hash`, defensiv — ein Scheduling-Fehler darf den Read nie brechen) und liefert `pending`. Grund: Ticket-Erstellung löst (bewusst) kein Scheduling aus; ohne diesen Trigger liefe die Engine für frische Tickets nie an.
2. **Normalizer kennt alle relevanten Feldtypen:** `buildProcess` extrahiert `commandLine` aus `win.commandLine || win.processCommandLine || win.scriptBlockText` (PowerShell Event 4104). Jeder Wazuh-Incident-Typ braucht sein Quellfeld; fehlt es → Feld bleibt leer (ADR-009, keine Fake-Daten).
3. **Engine-Version invalidiert Cache:** Bei fachlicher Änderung der Normalizer-/Engine-Logik wird `CORRELATION_ENGINE_VERSION` erhöht (`ce-1 → ce-2`). Da `input_hash = hash(ticketId + sourceRevision + engineVersion)`, werden alte Results `superseded` → über (1) neu berechnet.

**Konsequenzen:**
- Öffnen eines Tickets genügt, damit die reiche Evidence im Deck erscheint — kein manueller Mutations-Trigger nötig.
- Cache-Invalidation bei Engine-Änderungen ist deterministisch und greift automatisch beim nächsten Read.
- Komplementär (kein Ersatz): `WazuhProcessor.buildEventFields` füllt dedizierte Ticketfelder (inkl. neues `commandLine` in der `asset`-JSONB-Gruppe, **migrationsfrei**) für den Fallback + Liste/Suche.

**Offen:** FIM/syscheck (Registry/Datei, Daten in `data.syscheck` + `full_log`) ist noch nicht strukturiert abgedeckt — nächster Coverage-Slice analog scriptBlock.

---

## ADR-034 — Honeypot-Exposure: korrelierte Ableitung, keine behauptete NAT-Translation

**Status:** Akzeptiert (2026-06-24) · Engine-Slice (P_HONEYPOT_3a) folgt

**Kontext:** Read-only-Prüfung des Wazuh-Indexers (2386 OPNsense-Firewall-Events / 30 d): die `pfsense`-Decoder-Events tragen **ausschließlich** das 5-Tuple (`srcip/dstip/srcport/dstport/protocol/action`). `nat_*`, `post_nat_*`, `nat_rule`, `rulenum`, `srcintf/dstintf`, `bytes_in/out` haben **doc_count 0** — sie existieren in dieser Umgebung nicht. Cowrie wiederum liefert oft keine Ziel-IP/Ports (Slice 2b.4: session-derived partielle Flows). Eine vollständige NAT-/5-Tuple-Kette ist aus den vorhandenen Events also **nicht belegbar**.

**Entscheidung:**
1. **NAT wird aus OPNsense-Events NIEMALS behauptet.** `flowNormalizer` lässt die NAT-Felder ehrlich leer (`field_missing`); kein Code leitet `preNat`/`postNat` aus dem 5-Tuple ab.
2. **Exposure-Stitching ist eine GETRENNTE, korrelierte Ableitung** — nicht Teil des Flow-Modells. Eine Honeypot-Session/ein partieller Cowrie-Flow wird mit einem OPNsense-Firewall-Event verbunden, wenn externe Source-IP + Protokoll + (Port bzw. bekanntes Service-Mapping) + enges Zeitfenster eindeutig zusammenpassen. Ergebnis heißt **„correlated exposure path"**, nicht „NAT erkannt".
3. **`natVerified` ist immer `false`; `provenance: "correlated"`; `correlationType: "firewall_to_honeypot"`.** Eigener additiver Block `network.exposureCorrelations`, getrennt von `flows`/`honeypotSessions`.
4. **Mehrdeutigkeit wird nicht geraten:** genau ein Kandidat → `high`/`medium`; mehrere gleich gute Kandidaten → ein transparenter Eintrag `confidence:"none"` + `missingReason:"no_unique_firewall_match"` ohne Firewall-Ziel/Port; kein Kandidat → **kein Eintrag** (keine künstliche Kette).
5. **Confidence ≠ Severity.** Confidence beschreibt nur die Korrelationsgüte.

**Konsequenzen:**
- Begriffe bleiben sauber: *NAT belegt* nur mit echter NAT-Telemetrie; *Exposure korreliert* = Firewall+Honeypot passen plausibel zusammen; sonst keine sichtbare Kette.
- Der Online-VPS-Honeypot ist über OPNsense nicht korrelierbar (sein DNAT liegt auf VPS-iptables, nicht im Indexer) — das liefert ehrlich „kein Match" statt einer Scheinkette. Echte NAT-Telemetrie (NetFlow/conntrack) bliebe ein separater, künftiger Quellen-Slice.
- Wird je echte NAT-Telemetrie verfügbar, ist sie ein **anderer** Pfad (`natVerified:true`) — dieser ADR ändert sich dadurch nicht.

---

## ADR-035 — Cross-Domain-Fusion (Data Plane Korrelierungs-Engine)

**Datum:** 2026-06-25
**Status:** Accepted (Engine-Slice A)

**Kontext:**
Die neue Data Plane sammelt über vier Kollektoren (conntrack/ids · suricata/ids · opnsense/firewall · wazuh/siem) → `EventEnvelopeV1` → Intake → Transactional Outbox. Die Outbox wird befüllt, aber **von niemandem gelesen**. Es fehlt die Stufe, die aus den Domänen-Envelopes EINEN Vorfall macht und ihn nach Nexora überträgt. Achtung Begriffskollision: die bestehende `backend/src/correlation/CorrelationEngine.js` ist ein **Evidence-Merger** (Parent+Child EINES Tickets) — **nicht** der gesuchte Cross-Domain-Fusionierer.

**Entscheidung:**

1. **Fusion ≠ Evidence-Merge.** „Fusion" (Data Plane) verbindet *unabhängige* Envelopes verschiedener Kollektoren/Domänen zu einem Cross-Domain-Vorfall. „Evidence-Merge" (Backend) bleibt unverändert und unberührt. Zwei verschiedene Engines, zwei verschiedene Aufgaben.

2. **Fusionsschlüssel = ungeordnetes IP-Paar + Zeitfenster**, NICHT das volle 5-Tuple.
   - Schlüssel = `sort(ipA, ipB) + Fenster-Bucket`. Die IPs kommen aus `normalized.network.{srcIp,dstIp}`, ersatzweise aus `normalized.entities[type=ip]`.
   - Begründung: ein Angreifer↔Asset-Interaktion erzeugt Signale über viele Ports (Scan) und mehrere Domänen — der korrekte Korrelationsgrad ist das **IP-Paar**, nicht Port-genau. `dstPort`/Protokoll bleiben als Service-Kontext im Vorfall, sind aber **nicht** Teil des Schlüssels.
   - Nur eine IP vorhanden (z.B. Wazuh-Alert ohne dstip) → Schlüssel = `einzelne IP + Bucket` (Single-Sided-Vorfall).

3. **Zeitfenster (tumbling), Default 5 min**, konfigurierbar (`FUSION_WINDOW_MS`). Bucket = `floor(observedAt / windowMs)`. Envelopes mit gleichem IP-Paar im selben Bucket → ein Vorfall. `observedAt` ist maßgeblich (nicht `receivedAt`).

4. **Severity = Maximum über die Quellen**, auf eine gemeinsame Skala normalisiert (`info<low<medium<high<critical`):
   - Suricata `alert.severity` 1/2/3 → high/medium/low; Suricata-`flow` ohne Alert → info.
   - Wazuh `detection.severity` (info/medium/high/critical) wird direkt übernommen.
   - OPNsense `block` → medium, `pass` → info.
   - conntrack-Flow → info (reine Telemetrie; Bytes liefern Kontext, kein eigenes Verdikt).

5. **Verdikt (deterministisch, v1):**
   - `confirmed_malicious` — IDS-Alert **und** Firewall-`block` im selben Vorfall, ODER SIEM-Severity ≥ high zusammen mit einem IDS-Alert.
   - `suspicious` — mindestens ein Alert/Block, aber Kombi-Bedingung nicht erfüllt.
   - `observed` — nur Telemetrie (Flows/pass), kein Alert/Block.
   - Verdikt ist **regelbasiert und tunbar**; keine geratenen Werte (ADR-009-Disziplin: nur aus vorhandenen Signalen ableiten).

6. **Persistenz der `normalized`-Projektion (Migration 008).** Damit der Worker fusionieren kann, braucht er 5-Tuple/Severity/Bytes — diese liegen heute NICHT in `intake_events` (nur Metadaten + `raw_ref`). Entscheidung: die bereits **validierte, größen-gedeckelte** `normalized`-Projektion als `JSONB`-Spalte in `intake_events` persistieren. Das ist **kein** Raw-Payload (Raw bleibt ausschließlich `raw_ref`) — es ist die normalisierte, contract-begrenzte Sicht. Konsistent mit ADR „kein unbounded Blob": `entities ≤50`, feste Sub-Blöcke.

7. **Idempotenz des Vorfalls:** Vorfall-ID = Hash(`fusionKey`). Re-Runs/Spät-Eintreffer upserten denselben Vorfall (kein Duplikat). Die Übertragung nach Nexora ist damit wiederholbar.

8. **Übergabe nach Nexora** erfolgt über einen **Ingress-Adapter** im Backend (analog `backend/src/integrations/adapters/`): `FusedIncident → Validierung → Normalisierung → internes Ticket`. Der Worker emittiert transport-entkoppelt (injizierter Emitter, wie die Kollektoren).

**Konsequenzen:**
- Die Outbox bekommt endlich einen Consumer; die Pipeline ist End-to-End geschlossen.
- Fusion ist eine reine, testbare Funktion (`crossDomainFusion.js`); der Worker orchestriert nur (claim → group → fuse → emit → ack/backoff).
- Kein Doppelpfad-Zwang: der bestehende Adapter-Pfad bleibt, der Data-Plane-Pfad wird parallel real; eine spätere Konsolidierung ist eine eigene Entscheidung.
- Fenster/Verdikt sind v1-Heuristiken — bewusst einfach, mit klarer Tuning-Achse.

## ADR-036 — Internal Pull-Collector-Hub (ein System, automatischer Pull)

**Datum:** 2026-06-25
**Status:** Proposed

**Kontext:**
Heute laufen die Kollektoren **auf den Quell-Hosts** (Push: lokal lesen → an den Intake senden) — inkl. dem **exponierten Honeypot-VPS**, auf dem damit Collector-Code, ein Intake-Credential und ggf. ein Steuer-Agent liegen. Das ist unnötige Angriffsfläche auf der Internet-Box und ein verstreutes Deployment. Gewünscht: **alles als EIN internes System**; die Kollektoren laufen **intern** und **holen** die Daten von außen; **automatisch**, dauerhaft, ohne manuellen Trigger; beliebig um weitere Quellen erweiterbar.

**Entscheidung:**

1. **Pull statt Push.** Alle Kollektoren laufen **intern** (Proxmox/Docker). Jeder Kollektor **zieht** von sich aus von seiner Quelle. Auf den Quellen — insbesondere dem exponierten Honeypot — läuft **kein Collector-Code, kein Intake-Credential, kein Agent**. Die Quelle hält nur ihre Daten (Logs).

2. **Ein gebündeltes System (Collector-Hub).** Ein Container/Deploy fährt über die `collectorRegistry` **N Collector-Plugins**. Hub + Engine (Intake/Fusion/Outbox) + Nexora bilden **eine** integrierte Einheit (eine Compose/Config). **Neue Quelle = Plugin + Fetcher-Eintrag in der Config — keine neue Infrastruktur.**

3. **Automatischer Pull (self-scheduling).** Jeder Kollektor hat einen **Fetcher** mit eigenem Lauf-Modus: **Stream** („remote tail" für laufende Logs wie `cowrie.json`/`eve.json`) oder **Intervall-Poll mit Cursor** (Firewall-/SIEM-APIs: nur Neues seit `last-seen`). Läuft **dauerhaft**, kein Mensch triggert; **Retry/Backoff** bei Quelle-down; **persistenter Cursor** (kein Doppel-Ingest, kein Verlust).

4. **Trust-Richtung dreht sich — zu unseren Gunsten.** Der interne Hub verbindet sich **outbound** zur (potenziell feindlichen) Quelle, **read-only**, über den Tunnel. **Credential/Key liegen intern.** Quelldaten gelten unverändert als **untrusted** (validate/normalize, nie `eval`, bounded). Der Pull-Client (SSH/SFTP/HTTP) wird **sandboxed + ressourcenbegrenzt** (eine feindliche Quelle darf den Client nicht aushebeln).

5. **conntrack entfällt zugunsten Suricata-`flow`.** conntrack ist kernel-/host-lokal und nicht „von außen" ziehbar. Suricata-`flow`-Events (5-Tuple + echte Bytes/Pakete) liefern den Ersatz → **nichts Flow-bezogenes von uns auf der Box**. (Falls echte conntrack-Telemetrie je zwingend wird, ist ein minimaler conntrack-Shipper auf dem Host die einzige Ausnahme — separate Entscheidung.)

6. **Einzige Code-Änderung = Quelle-Abstraktion.** `runCollectorPipeline` konsumiert bereits ein **async-Iterable**. Neu ist nur eine **Pull-Quelle** (`remoteTailSource` / `pollSource`), die Zeilen/Records liefert; die `normalize`-Logik der bestehenden Kollektoren (conntrack/suricata/opnsense/wazuh/cowrie) bleibt **unverändert**.

7. **Erweiterbarkeit per Config.** Der Hub liest eine Kollektor-Liste: je Eintrag `{kind, source/fetcher, scope, schedule, credentialRef}`, registriert über `collectorRegistry`. Beliebig viele Kollektoren, **ein** Container.

**Konsequenzen:**
- Die exponierte Box trägt **kein Geheimnis und keinen Code mehr** → deutlich kleinere Angriffsfläche; ein Honeypot-Kompromiss liefert **kein internes Credential**.
- **Ein Deploy/eine Config** statt verstreuter systemd-Dienste; zentrale Verwaltung von Nexora aus wird einfach (alles intern, vertrauenswürdig).
- Der Hub braucht **read-only Quell-Zugänge** (SSH-Key zum Honeypot-Log, API-Token für Firewall/SIEM) — intern, eng, rotierbar.
- **Migration parallel:** interne Pull-Kollektoren hochziehen, verifizieren, **dann** die VPS-Push-Kollektoren abbauen (kein Big-Bang).
- Offen (bewusst im Slice/später): genaue Pull-Mechanik je Quelle (SSH `tail -F` vs SFTP-Inkrement vs syslog), Credential-Rotation der Quell-Zugänge, exaktes Bündel-Deploy (Hub als Service im bestehenden Stack vs eigene Compose).

**Zielbild (Folgephasen — durch dieselbe Pull-Mechanik ermöglicht, YAGNI: jetzt nur die Daten-Pull-Quelle):**
- **Update-Pull (Desired-State).** Dasselbe Pull-Prinzip aufs Management angewandt: jedes System holt seinen **Soll-Zustand** (welche Kollektoren · welche Version/Image · welche Config) **direkt aus Nexora** und konvergiert darauf — **pro System einzeln**, **signiert**, auditiert, **nichts inbound**. Baut auf dem vorhandenen **Apply-Channel (Approval + Audit)** + `installed_nodes`/`node_credentials`/Enrollment. So wird „von Nexora bis OS-Ebene administrieren" **sicher** (Pull statt stehendem Fernzugriff).
- **Horizontale Skalierung.** Pull-Kollektoren sind zustandslos (Cursor in der DB) → beliebig viele Hubs/Quellen; Intake + Transactional-Outbox + `SKIP LOCKED`-Worker skalieren über mehrere Worker-Instanzen; Mandanten/Sites stecken bereits im Contract. „Aufblasen, wie man will, wenn Hardware da ist."
- **Enterprise-Pillars (Horizont).** Signierte Updates · RBAC/Approval (vorhanden) · durchgehendes Audit · HA (mehrere Worker/Intake-Replicas) · per-Node Health/Observability · Backpressure/Rate-Limit (vorhanden). Bewusst **nicht jetzt** — der Horizont, an dem sich die Slices ausrichten.

## ADR-037 — Self-hosted Mailserver (Stalwart) + Smarthost-Relay für Notification-Outbound & Phishing-Ingest

**Kontext:** ADR-027 baute den **Notification-Outbound** (SMTP via `nodemailer`, default AUS, kein Secret-Leak). Der **Phishing-Ingest** (`imapPoller` + `phishingParser`) erwartet ein **IMAP-Postfach**. Beide Wege sind **fertig gebaut**, aber bisher fehlte ein eigener Mailserver, an den sie sich hängen. Das Lab läuft self-hosted auf Proxmox (LXC/Docker). Gewünscht: ein quelloffener Mailserver als Container, der genau diese zwei Schnittstellen liefert — **SMTP-Submission (raus)** + **IMAP-Postfach (rein)**.

**Entscheidung:**

1. **Stalwart als EIN Container** (eigener LXC auf Proxmox, Docker mit nesting). SMTP (587/465) + IMAP (993) + JMAP + Web-Admin + Auto-TLS + DKIM in einem Binary — leichtester Fit für „ein Container im Lab" statt eines vielteiligen Stacks (Mailcow wäre eigene VM).
2. **Ausgehende Zustellung über Smarthost-Relay.** Stalwart authentifiziert sich beim Smarthost; **keine Lab-IP-Reputation**, **kein offener ausgehender Port 25** nötig. Deliverability (SPF/DKIM/DMARC am Versanddomain) liegt beim Smarthost; Stalwart signiert zusätzlich **DKIM lokal**.
3. **Zwei dedizierte Konten (Least-Privilege):** `notify@` (nur Versand — Nexora-Outbound) und `phishing@` (IMAP-Postfach — Nexora-Ingest). Getrennte Creds, getrennte Rechte.
4. **Keine Nexora-Code-Änderung.** `notificationOutbound.js` (ADR-027) und `imapPoller.js` sind gebaut; es braucht nur **ENV-Verdrahtung** (`NOTIFY_SMTP_*` / `IMAP_*`) + das Gate `NOTIFICATIONS_OUTBOUND_ENABLED=true`. „Einbauen" = Container + ENV, nicht Code.
5. **Secrets nur in ENV / Stalwart-Config** (operator-privat, gitignored), nie im Repo. Deploy-Artefakte (`deploy/mailserver/`) enthalten nur Beispiele/Platzhalter.

**Konsequenzen:**
- **C3 (Notification-Kanal E-Mail) geht scharf**, sobald `NOTIFY_*` gesetzt + Gate an — ohne weiteren Code.
- **Phishing→Ticket-Pipeline** wird erreichbar: internes Weiterleiten an `phishing@` genügt; **externer Empfang** (echte Außen-Mails direkt ans Postfach) bräuchte **MX + offenen inbound-25** → bewusst **separate Entscheidung**, nicht jetzt.
- **Betrieb:** ein Container, Web-Admin, Auto-TLS. **Backup von `./data`** (Konten + DKIM-Keys) ist Pflicht (eigener Cron, vgl. `deploy/backup-db.sh`).
- Web-Admin/JMAP-Port (8080) bleibt **intern** (nicht öffentlich; ggf. hinter nginx).
- **Offen/bewusst später:** externer Inbound (MX), DMARC-Reporting, Webmail (Stalwart bringt keins — Roundcube optional), HA/Replikation.
- Setup-Anleitung + Compose: `deploy/mailserver/`.

**Revision 2026-06-27 — Stalwart → docker-mailserver:** Stalwart wurde deployt, erwies sich aber als
**nicht headless automatisierbar** (v0.16.11-Release enthält **kein `stalwart-cli`**, die Management-API
ist im Bootstrap-Modus nicht gemountet, Setup geht nur über den interaktiven Web-Wizard — verifiziert).
Da das Ziel „voll autonom durch Claude aufsetzbar" ist, **Wechsel auf `docker-mailserver`** (Postfix+Dovecot+
OpenDKIM, vollständig über `setup`-CLI + Config-Dateien steuerbar). Auf demselben CT 108 ausgerollt, Konten
`notify@`/`phishing@`/`soc@` per CLI angelegt, **intern ohne TLS/Smarthost** betrieben (Port 25 lokale
Zustellung). **End-to-end verifiziert:** Prod-`soc_api_prod` → SMTP → `soc@`-Postfach. Prod-`.env.production`
(VM 120) gesetzt + API recreated. Die übrigen Entscheidungen (Stalwart-Wahl, Smarthost-Relay, zwei Konten,
keine Code-Änderung) bleiben gültig; nur die Server-Software ändert sich. Der IMAP-Phishing-Passthrough
ist im Prod-Compose vorhanden; offen bleibt das Setzen der produktiven `IMAP_*`-ENV und der API-Recreate.
Externe Zustellung (Smarthost + SSL) bleibt ein separater Operator-Schritt.

---

## ADR-038 — Zero-Trust-Access: Identitaetszentrierter Zugang statt pauschalem Netz-Zutritt

**Datum:** 2026-06-29
**Status:** Proposed

**Kontext:**
`Zero-trust access` steht in der Roadmap als Langfrist-Thema. Gleichzeitig hat das Projekt bereits
starke Bausteine dafuer: Cookie-only-Auth + CSRF (ADR-017), serverseitig erzwungene Security-Policies
(ADR-019), MFA/TOTP (ADR-022), OIDC-SSO (ADR-023), WebAuthn/Passkey (ADR-024), Audit-Export und eine
read-only Control-Plane ohne Remote-Exec (ADR-020). Offen ist die Frage, wie Operator- und Admin-Zugriff
auf Nexora selbst, auf Management-Oberflaechen und spaeter auf Node-nahe Funktionen nach einem
Zero-Trust-Modell zusammengedacht werden sollen.

Wichtig: Im Homelab wurde Twingate bereits evaluiert und fuer den damaligen Zweck verworfen
(`docs/07-operations/network/vpn-setup.md`). Daraus folgt: Zero Trust darf hier **kein
produktfixierter Reflextitel** sein, sondern muss als Architekturprinzip formuliert werden.

**Entscheidung:**

1. **Zero Trust wird als Zugriffsmodell, nicht als Produkt, behandelt.**
   Ziel ist nicht "Twingate oder Tailscale einfuehren", sondern:
   - Identitaet vor Netzlage
   - explizite Freigabe pro Zielsystem/Funktion
   - kurzlebige, attestierbare Sessions
   - vollstaendige Auditierbarkeit
   - kein implizites Vertrauen durch VPN-/LAN-Mitgliedschaft allein

2. **Drei Zugriffsebenen werden getrennt modelliert.**
   - **Ebene A - Nexora App Access:** Browser-Zugang zu Frontend/API.
   - **Ebene B - Operator Access:** Admin-/Wartungszugang zu Host, DB, Reverse Proxy, Mail, Qdrant, Wazuh.
   - **Ebene C - Future Managed Node Access:** spaetere, hochkontrollierte Node-/Agent-Funktionen.
   Jede Ebene hat andere Risiken, andere Controls und darf nicht in einer "ein ZTNA fuer alles"-Idee
   verschwimmen.

3. **Fuer Ebene A gilt "Identity first" mit bestehendem Auth-Stack.**
   Zero Trust auf App-Ebene baut zuerst auf:
   - OIDC als zentralem Identity-Anker
   - MFA/Passkey fuer privilegierte Rollen
   - Session-Haertung, Re-Auth fuer High-Risk-Aktionen, Audit
   - optional Device/Network Claims vom IdP oder Access-Proxy
   Das App-Backend bleibt dabei autoritativ fuer Rollen, Capabilities und Guardrails.

4. **Fuer Ebene B gilt "Brokered Access statt Flat Network Reachability".**
   Management-Zugriff auf Infrastruktur soll langfristig ueber einen identitaetsgebundenen
   Access-Broker oder einen eng segmentierten, policy-gesteuerten Overlay-Zugang laufen.
   Anforderungen:
   - MFA-/SSO-gebunden
   - Ressource statt Subnetz freigeben
   - getrennte Admin-/Operator-/Break-Glass-Pfade
   - kurze Session-Laufzeiten
   - Audit-Logs ausserhalb des Zielsystems
   Ob das spaeter ein ZTNA-Broker, WireGuard-Mesh mit zentraler Policy oder eine andere Loesung wird,
   bleibt offen; das Architekturziel ist wichtiger als der Hersteller.

5. **Fuer Ebene C bleibt die bestehende No-Apply-Grenze bestehen.**
   Zero Trust ist **kein Vorwand**, die read-only Control-Plane in einen freien Remote-Exec-Kanal
   umzudeuten. Kuenftige Node-nahen Aktionen brauchen weiterhin:
   - signierte Queue / Pull-Modell
   - enge Command-Templates
   - Approval-Gate / Vier-Augen
   - Audit und Rollback
   - default AUS

6. **Provider-Auswahl erfolgt spaeter gegen harte Kriterien.**
   Ein Kandidat darf erst in die engere Wahl, wenn er mindestens diese Punkte erfuellt:
   - self-hosting-kompatibel oder klar begruendete Cloud-Abhaengigkeit
   - saubere Rollen-/Policy-Integration
   - Linux/Windows/Admin-Zugriffe praktikabel
   - Audit / Session-Trace / Revocation
   - tragfaehig fuer Homelab + spaeter professionell
   - kein Zwang, grosse Netzbereiche pauschal freizugeben

7. **Break-Glass bleibt explizit erlaubt, aber separiert.**
   Es wird einen bewusst dokumentierten Notfallpfad fuer IdP-/Broker-Ausfall brauchen
   (z. B. lokale Konsole / Proxmox / physischer Zugang / separater Recovery-Account).
   Dieser Pfad ist Ausnahmebetrieb, nicht Alltagszugang.

**Konsequenzen:**
- `Zero-trust access` wird vom diffusen Zukunftspunkt zu einem konkreten Security-Track.
- SSO/OIDC, MFA, Passkey und Re-Auth werden als Vorstufe der App-seitigen Zero-Trust-Ebene gelesen,
  nicht als isolierte Features.
- Infrastrukturzugriff und App-Zugriff werden sauber getrennt; dadurch sinkt das Risiko, spaeter
  eine vermeintlich "bequeme" VPN-Loesung als Sicherheitsabkuerzung zu akzeptieren.
- Die bestehende Sicherheitsgrenze "keine freie Remote-Ausfuehrung" bleibt unberuehrt.

**Naechste Schritte (nicht Teil dieser ADR-Entscheidung, aber vorbereitet):**
1. Zielsysteme und Admin-Pfade inventarisieren (API, DB, Reverse Proxy, Wazuh, Mail, Qdrant, Proxmox).
2. Rollen und privilegierte Workflows in Zugriffsklassen schneiden.
3. Re-Auth-/Step-up-Matrix fuer High-Risk-Aktionen definieren.
4. Zwei bis drei technische Zieloptionen gegen die Kriterien vergleichen.
5. Danach erst einen Implementierungs-ADR fuer den gewaehlten Broker/Overlay schreiben.

---

## ADR-039 — ML-Training: Lernschleife und Eval-Harness vor echtem Fine-Tuning

**Datum:** 2026-06-29
**Status:** Proposed

**Kontext:**
`Machine learning model training` steht in der Roadmap als Long-term-Thema. Gleichzeitig ist Nexora
heute bereits stark auf eine andere KI-Strategie optimiert:
- lokale/optionale LLM-Provider
- RAG mit MITRE + Hunt-Katalog + `past_incidents`
- Human-in-the-loop fuer Agent-Vorschlaege
- Guardrails, Confidence-Floors und Autonomy-Gates
- Auditierbarkeit und No-Fake-Disziplin

Das ist wichtig, weil "ML-Training" hier nicht automatisch bedeutet, sofort ein Modell
nachzutrainieren oder zu fine-tunen. Fuer ein SOC-Produkt waeren unklare Labels, PII-Risiken,
Label Leakage und schwer erklaerbare Fehlklassifikationen gefaehrlicher als ein spaeterer
Modellgewinn nuetzlich waere.

**Entscheidung:**

1. **Der erste ML-Track ist ein Lern- und Evaluationssystem, kein sofortiges Fine-Tuning.**
   Vor echtem Training braucht Nexora:
   - einen Datenvertrag
   - ein Label-Schema
   - reproduzierbare Offline-Evals
   - Slice-/Fehleranalysen
   - eine sichere Feedback-Schleife aus menschlichen Entscheidungen

2. **RAG bleibt die primaere Wissensstrategie.**
   Statische Fachkenntnis (MITRE, Hunts, Playbooks, fruehere Incidents) wird weiter zuerst
   ueber RAG eingebracht, nicht ueber Modellgewichte. Training ist nur fuer Muster sinnvoll,
   die durch Retrieval allein nicht gut genug adressiert werden.

3. **Menschliche Entscheidungen sind Rohmaterial, nicht automatisch Ground Truth.**
   Quellen fuer kuenftige Labels koennen sein:
   - genehmigte/abgelehnte AgentSuggestion
   - Ticket-Abschluss mit Begruendung
   - False-Positive-Entscheidungen
   - Use-Case-/Detection-Reviews
   - spaeter qualitaetsgesicherte Hunt-Ergebnisse
   Diese Signale muessen aber kuratiert, versioniert und auf Ambiguitaet geprueft werden.

4. **Der erste produktive Nutzen kommt aus Eval + Threshold + Routing, nicht aus einem neuen Modell.**
   Bevor ein eigenes Modell trainiert wird, soll Nexora messen koennen:
   - welche Fehlertypen heute haeufig sind
   - welche Provider/Prompts/Guardrails besser abschneiden
   - welche Confidence-Schwellen sinnvoll sind
   - welche Ticket-/Use-Case-/Verdict-Slices problematisch sind
   - wann ein Fallback oder menschlicher Review greifen muss

5. **Trainingsdaten brauchen einen engen Privacy- und Security-Rahmen.**
   Trainings- und Eval-Artefakte duerfen:
   - keine Secrets enthalten
   - PII/innere Hostnamen/Incident-Rohtexte nicht blind duplizieren
   - nicht unkontrolliert aus Tickets/Logs in externe Dienste fliessen
   - nur mit dokumentierter Redaktion/Anonymisierung weiterverarbeitet werden

6. **Falls spaeter echtes Training kommt, dann reproduzierbar und reversibel.**
   Ein spaeterer Trainingspfad braucht mindestens:
   - versionierte Dataset-Snapshots
   - nachvollziehbare Features / Inputs
   - Baseline-Vergleich gegen den Status quo
   - Promotion-Gates
   - Rollback auf Prompt-/Provider-/RAG-only-Betrieb

7. **ML-Training ist vorerst auf eng begrenzte Ziele zulaessig.**
   Potenziell passende erste Zielprobleme:
   - Priorisierungs-/Ranking-Hilfen fuer Vorschlaege
   - Abstention-/Review-Routing
   - False-Positive-Warnhinweise
   - Aehnlichkeits-/Retrieval-Verbesserungen
   Nicht passend als erster Schritt:
   - vollautonome Incident-Entscheidungen
   - Black-Box-Klassifikation ohne Quellen und ohne Review

**Konsequenzen:**
- `ML-Training` wird vom Schlagwort zu einem MLE-Track mit sauberer Reihenfolge.
- Der naechste wertvolle Bau ist ein Eval-/Feedback-Harness, nicht ein Trainingscluster.
- RAG, Guardrails und Human-Approval bleiben die Hauptsicherungen.
- Spaeteres Modelltraining wird an Beweisen fuer Nutzen und Beherrschbarkeit gebunden.

**Naechste Schritte (vorbereitet, aber noch nicht umgesetzt):**
1. Label-Quellen und Datenvertrag fuer Agent-/Ticket-/Verdict-Feedback festlegen.
2. Offline-Eval-Schema mit Baseline, Slices und Fehlertypen definieren.
3. Reviewfaehige Dataset-Redaktion fuer Trainings-/Eval-Snapshots beschreiben.
4. Erst danach ueber konkrete Trainingsziele oder Fine-Tuning entscheiden.

## ADR-040 — Routing-Policy: belegter Threshold als advisory KI-Triage-Empfehlung

**Datum:** 2026-06-29
**Status:** Accepted

**Kontext:**
ADR-039 (Punkt 4 + 7) nennt als ersten produktiven ML-Nutzen ausdruecklich
`Abstention-/Review-Routing` ueber Eval + Threshold — nicht ein neues Modell. Die
Eval-Harness liefert pro Lauf einen belegten, reproduzierbaren Threshold (Gold-Eval,
fail-closed Routing-Gate, Threshold-/Policy-Vergleich). Bisher war dieser Threshold
nur ein Artefakt auf der Platte und wirkte nirgends im Produkt. Gleichzeitig gilt im
gesamten KI-Pfad: der Agent SCHLAEGT VOR, ein Mensch ENTSCHEIDET (Human-in-the-loop),
und Autonomie ist per Default-Deny inert (ADR-016).

**Entscheidung:**

1. **Der belegte Threshold wird zu einem deploybaren Policy-Artefakt.**
   `npm run ml:policy-export` erzeugt aus Policy-Vergleich + Run-Manifest ein einzelnes,
   versioniertes `recommended-routing-policy.json` (Schema `nexora.ml.routing-policy.v1`):
   genau eine gewaehlte Policy, ein Accept-Threshold, vollstaendige Provenance
   (Dataset-/Split-SHA, Routing-Gate) und die belegenden Validation/Test-Metriken.
   Default-Policy ist `conservative_review_bias` — im Zweifel an die menschliche Review.

2. **Die Policy wirkt ausschliesslich advisory, nie handelnd.**
   Ist `ML_ROUTING_POLICY_PATH` gesetzt und die Policy `status=ready`, erhalten
   Agent-Suggestion-Responses ein `routing`-Feld: `auto_accept_eligible`
   (confidence >= Threshold) bzw. `route_to_review` (darunter). Es ist ein Triage-Hinweis
   fuer den Analysten — kein Auto-Approve, kein Auto-Execute. Der Human-in-the-loop und
   die Autonomy-Gates (ADR-016) bleiben unangetastet.

3. **Default-AUS und fail-safe.**
   Ohne ENV-Variable, bei blockierter Policy, Schema-Mismatch oder Ladefehler gibt es
   kein `routing`-Feld und kein Verhaltenswechsel. Eine fehlende confidence wird nicht
   geraten (`unknown`). Die Policy kann das System also nie haerter ODER lockerer machen,
   ohne dass ein belegtes, gueltiges Artefakt aktiv hinterlegt wurde.

4. **Sichtbarkeit ohne Pfad-Leak.**
   Die Admin-Seite `/ml-eval` + `GET /api/v1/ml/eval/status` zeigen, ob eine Policy aktiv
   ist (Name + Threshold), ohne den Dateipfad zu offenbaren.

**Konsequenzen:**
- Der erste produktive ML-Nutzen (Review-Routing aus ADR-039) ist umgesetzt — fail-closed,
  advisory, auditierbar — ohne Modelltraining.
- Eine Policy ist nur so gut wie ihr Gold-Dataset; das fail-closed Routing-Gate
  (min. 20 Gold-Records, min. Agreement/Coverage) bleibt die Schranke davor.
- Spaeteres echtes Training (ADR-039) kann denselben Artefakt-/Provenance-Pfad nutzen.
- Naechster moeglicher Schritt: die Empfehlung als Sortier-/Priorisierungshilfe in der
  Suggestion-Liste nutzen (weiterhin advisory).

---

## ADR-041 — Deployment Center: Network as Code (VM-Deploy via Hypervisor-Connector)

**Datum:** 2026-07-01
**Status:** Proposed (Plan — noch kein Code; erster vertikaler Schnitt „OPNsense → Proxmox")

**Kontext:**
Nexora soll vorkonfigurierte Open-Source-Appliances (zuerst OPNsense) **deklarativ als VM
auf einem Hypervisor** (Proxmox) hochziehen — parametrisiert (statische IP, CIDR, VLAN,
DNS, Ressourcen). Das ist ein Eingriff, der **echte Infrastruktur schreibt** (klont, startet,
löscht VMs) und damit die heikelste Schreib-Operation der Plattform — deutlich riskanter als
der bestehende Wazuh-FP-Write (ADR-011) oder der Config-Apply-Kanal (ADR-036/P_CORR_ADMIN_2).
Design-Grundlage: `docs/01-architecture/deployment-center-architecture.md` +
`-concept.md` + `-module-authoring.md`.

**Scope-Entscheidung (Nutzer, 2026-07-01):** Das Deployment Center **deployt neue Systeme
als VMs** (Richtung B). Das reine Onboarding bestehender Datenquellen (Richtung A) ist
**nicht** dieser Schnitt. Der Name „Deploy Center" ist ein Label, kein Funktions-Contract.

**Entscheidung:**
1. **Drei austauschbare Teile** (Erweiterung = ein Modul *oder* ein Connector nach Vertrag):
   - **System-Modul** (WAS) — Code-Allowlist `deployModuleCatalog` (analog
     `correlatorRegistryCatalog`): `identity`, `source` (Template-Ref), `resourceDefaults`,
     `paramSchema` (deklarative Vorgaben), `configApplier`. Erstes Modul: OPNsense.
   - **Hypervisor-Connector** (WOHIN) — einheitlicher Vertrag
     (`cloneFromTemplate·setResources·attachNetwork·start·status·destroy·snapshot·checkPreconditions`).
     Erster Connector: Proxmox (REST-API). ESXi/vSphere später, gleicher Vertrag.
   - **Deploy-Orchestrator** (WIE) — `validate → plan(Dry-Run) → approve(4-Augen) →
     apply(clone→resources→net/VLAN→start→configApplier→status) → rollback(destroy)`.
2. **Kein direktes Exec.** Der Orchestrator wiederverwendet strikt das bestehende
   **Apply-Kanal-Muster** (ADR-036: Draft → 4-Augen → Reauth → Plan → Apply, fail-closed
   Gates, redigiertes append-only Audit). Kein neuer Shell-/Exec-Pfad.
3. **`DEPLOY_ENABLED`-Kill-Switch** (ENV, default AUS, nicht UI-schaltbar) analog
   `CONFIG_APPLY_ENABLED`. Ohne Flag: Read/Plan möglich, **Apply hart geblockt**.
4. **Secrets verschlüsselt at-rest** — Hypervisor-API-Token via `secretsCrypto`
   (AES-256-GCM, `enc:v1:`), OPNsense `adminPassword` write-only und **aus dem Spec-Hash
   ausgeschlossen**; Token/Passwort nie in Return/Log/Plan/Audit (nur `prefix`/`ref`).
5. **Idempotenz + Rollback + Safe-Stop** — kanonischer Spec-Hash (unique) → kein
   Doppel-Deploy; jeder Fehlerschritt ab `clone` → `destroy`; scheitert der Rollback →
   `failed_safe_stop` + globale Deploy-Sperre (analog `apply_safety_lock`), kein weiterer Apply.
6. **SSRF-Guard** — der Proxmox-REST-Client validiert `host` gegen eine Mgmt-Netz-Allowlist
   (`DEPLOY_HYPERVISOR_ALLOWED_HOSTS`, Prod-fail-fast wenn leer bei `DEPLOY_ENABLED=true`);
   Metadata-/öffentliche IPs deny (OWASP A10).
7. **XML-Injection-Schutz** — der OPNsense-`config.xml`-Renderer escaped alle dynamischen
   Werte (OWASP A03); kein String-Concat ungeprüfter Eingaben.
8. **Repository-Pattern + RBAC** — InMemory (Tests/CI, deterministischer Fake-Connector)
   ↔ Postgres (`DB_ENABLED`) über Factory; alle Routen `requireRole('admin')` + `deploy_reauth`
   vor Apply + Rate-Limit. Migration `051` (idempotent, append-only Audit-Trigger).

**Testbarkeit ohne Proxmox:** `InMemoryProxmoxConnector` ist CI-Default (`DEPLOY_ENABLED!=true`),
mit Fehler-Injektion je Schritt → Rollback-/Safe-Stop-Pfade voll testbar. Live-Aktivierung nur
per Operator-Smoke (Lab-Proxmox, Golden-Template, Runbook), nie in CI.

**Begründung:**
Dieselbe fail-closed Sicherheits-Naht wie Config-Apply/Wazuh-FP wird auf die riskanteste
Operation (echte Infra) angewendet — gegated, reauth-geschützt, idempotent, mit lückenlosem
Rollback und Audit. Die Modul-/Connector-Trennung macht „jede Firewall / jeder Hypervisor"
später zu einer additiven Erweiterung nach Vertrag, ohne Core-Änderung.

**Bewusst NICHT in Schnitt #1 (YAGNI):** ESXi-Connector, weitere Module (Wazuh/IDS/Honeypot) +
generischer cloud-init-Applier, ISO-Erstinstallation, Snapshot-Nutzung im Lifecycle,
Multi-Node-Scheduling, Connector-Verwaltungs-UI. Umsetzungsplan:
`docs/01-architecture/deployment-center-implementation-plan.md`.

**Konsequenzen:**
- Erster produktiver Infra-Schreibpfad der Plattform — bleibt bis Operator-Go inert (Gate AUS).
- Voraussetzungen liegen beim Operator: gepflegtes OPNsense-Golden-Template, Proxmox-API-Token
  (minimale Rechte), existierende VLAN-Bridge — der Connector prüft sie im Plan (`checkPreconditions`).
- Erweiterung Richtung „jede Firewall/jeder Hypervisor" ist danach reine Modul-/Connector-Arbeit
  (Autoren-Doku vorhanden).

---

## ADR-042 — Response/Containment-Execution: menschlich ausgelöste, gated Endpoint-Exec (KEIN Auto-Response)

**Datum:** 2026-07-04
**Status:** Accepted (Nutzer-Go 2026-07-04) — Umsetzung in vertikalen Schnitten; erster Schnitt „isolate_host / release_isolation", Real-SSH-Kanal in eigener Slice. Gate default AUS, alles inert.

**Kontext:**
Der Response-Workflow existiert bis **Stufe 2**: `ResponseAction` (`threatHunting/domain/ResponseAction.js`)
mit Vier-Augen (`approvedBy ≠ requestedBy`) und **Pflicht-`authorizationBasis`** (Governance-Beleg), plus
optionalem **Mock-Auto-Exec** (`HUNT_RESPONSE_AUTO_EXECUTE_MOCK`, nur `isolate_host`/`release_isolation`,
Audit `mode:'mock'`). **Stufe 3 — echte Endpoint-Ausführung — fehlt bewusst.** Genehmigte Aktionen bleiben
`approved` mit Hinweis „pending agent".

**Spannungsfeld (explizit):** Nexora ist positioniert als **„kein EDR-Ersatz, keine automatische
Bedrohungsentfernung"** (CLAUDE.md). ADR-016 stuft die Aktionsklasse `host_response` (Isolation/Block) als
**personenwirksam → human-only (Decke)** ein (DSGVO Art. 22/Art. 5) — eine Policy-Decke, die keine Automatik
überschreiben darf. ADR-020 (No-Apply) verbietet einen Remote-Exec-/Shell-Kanal **in der Provisioning-Domäne**
(per Regex-Test auf `provisioningDomain`).

**Auflösung (warum das konsistent ist):** Dieser ADR fügt **keine Automatik** hinzu. Ein Mensch *beantragt*,
ein zweiter *genehmigt* (Vier-Augen), und ein Mensch *löst die Ausführung explizit aus* (frische Reauth) —
Nexora handelt nie von selbst. Das liegt **innerhalb** der ADR-016-Decke (human-only ≠ verboten; verboten ist
nur die *automatische* personenwirksame Aktion) und **außerhalb** der ADR-020-Provisioning-Grenze. Es ist der
**Geschwister-ADR zu ADR-041**: wie dort ein gated VM-Deploy-Exec-Kanal auf dem gehärteten `sshExecRunner`
etabliert wurde, etabliert ADR-042 einen gated **Containment-Exec-Kanal** auf demselben Runner — dieselbe
fail-closed Naht. Der Mock-Flag bleibt **Mock-only** (Demo); echte Exec ist ein getrennter, manueller Schritt.

**Entscheidung:**
1. **Kein „Auto"-Response.** Genehmigung löst **keine** echte Ausführung aus (auch nicht mit einem Flag). Real-Exec
   ist eine **eigene, manuell angestoßene Transition** (`approved → executing → completed/failed`, Domäne vorhanden).
   Der bestehende `HUNT_RESPONSE_AUTO_EXECUTE_MOCK` bleibt ausdrücklich **nur Mock** und triggert nie den Real-Pfad.
2. **Kill-Switch `HUNT_RESPONSE_REAL_EXEC_ENABLED`** (ENV, default AUS, nicht UI-schaltbar) analog `DEPLOY_ENABLED`.
   Ohne Flag: Request/Approve möglich, **Execute hart geblockt** (`E_REAL_EXEC_DISABLED`, 503).
3. **Frische Reauth beim Execute** — `X-Reauth-Token` (One-Shot, an actor.id gebunden, wie `deploy_reauth`),
   verbraucht im Execute-Request. Execute-Route **admin-only**.
4. **Drei-Parteien-Trennung** (Ideal): `requestedBy ≠ approvedBy ≠ executedBy`; Minimum sind zwei verschiedene
   Menschen (Vier-Augen bleibt erzwungen). `executedBy` wird auditiert.
5. **Transport = `sshExecRunner`** (ADR-041-Härtung wiederverwendet): **Host-Key-Pinning ohne TOFU**, Host **aus der
   Node-Registry** (`installed_nodes.host_key_pin`, nie aus dem Request), **scriptId-Allowlist**, **ENV_VAL_RE**-Härtung,
   **SSRF-Guard**, In-Memory-Key. Neue Allowlist-Skripte `isolate-host` / `release-isolation` (bash **+** ps1),
   idempotent, self-verifizierend.
6. **Nur umkehrbare Aktionen im ersten Schnitt.** Jede Containment-Aktion MUSS einen definierten **Undo-Pfad** haben.
   Schnitt #1 = das reversible Paar **`isolate_host` ↔ `release_isolation`**. `privileged_command`, `block-ip`,
   `kill-process`, `disable-user` bleiben **draußen** (kein Real-Exec), bis je Aktion ein Undo + eigener Review steht.
7. **Circuit-Breaker.** Real-Exec-Fehler → `failed`, **kein Auto-Retry**; erneute Ausführung erfordert eine frische
   menschliche Aktion (neue Reauth). Wiederholte Fehler → Kanal-Sperre (analog `apply_safety_lock`).
8. **Append-only Audit** — `RESPONSE_EXECUTED` (`mode:'ssh'`) + `executedBy` + Ziel-Host + Ergebnis (redigiert, nie
   Roh-Fehler/Secret), zusätzlich zu den bestehenden Request/Approve-Events.
9. **DSGVO/Governance bleibt.** `authorizationBasis` bleibt Pflicht (bereits erzwungen); personenwirksame Klasse
   bleibt human-only (ADR-016-Decke unverändert).

**Testbarkeit ohne Endpoint:** Der Runner wird injiziert (Fake-SSH wie im Deploy-/Agent-Install-Pfad); Real-Exec
läuft **nie in CI**, Gate default AUS. Fehler-Injektion je Schritt → Circuit-Breaker-/fail-closed-Pfade voll testbar.
Live-Aktivierung nur per Operator-Smoke (Lab-Host, gepinnter Key, Runbook).

**Bewusst NICHT in Schnitt #1 (YAGNI):** `privileged_command`-Real-Exec, `block-ip`/`kill-process`/`disable-user`,
Wazuh-Active-Response als zweiter Transport-Kanal, KI-vorgeschlagene Containment-Aktionen. Additiv nach demselben
Vertrag erweiterbar.

**Konsequenzen:**
- Erster menschlich ausgelöster Endpoint-Containment-Pfad — bleibt bis Operator-Go **inert** (Gate AUS).
- Positionierung gewahrt: „keine **automatische** Bedrohungsentfernung" bleibt wahr — ausgeschlossen ist die
  *Automatik*, nicht die von zwei/drei Menschen getragene, auditierte Einzelaktion.
- Voraussetzungen beim Operator: verwalteter Ziel-Host mit gepinntem Host-Key + Deploy-Pubkey in `authorized_keys`
  (via Deploy-Keypair, ADR-041-Infrastruktur), Isolations-Skript auf einem echten Host smoke-getestet.
- Sicherheitskritisch (RCE-Klasse) → TDD + security-review je Slice, kein Merge/Deploy ohne Reviewer-Freigabe.

**Slice 3a — Umsetzung (Linux/nftables, inert):**
`containmentRunner.buildContainmentRunner` bildet `action.targetHost → findNodeByIp → gepinnter host_key_pin` ab
und fährt die nftables-Isolation über den gehärteten `sshExecRunner`. Fail-closed-Kette (VOR jedem Kanalaufbau):
Kind → Node-Existenz → OS(Linux) → IP → Host-Key-Pin → **Mgmt-Preservation-CIDR** (nur `isolate_host`) → Deploy-Key.
`deploy/isolate-host.sh` erhält den Control-Channel **primär aus `$SSH_CONNECTION`** (echte Peer-IP + realer
Server-Port — damit kein Config-Drift-/Port-Mismatch-Lockout) und **ergänzend** aus `NEXORA_MGMT_CIDR`; enge
Isolation (kein breiter Output-Accept), self-verifizierend. `release-isolation.sh` löscht die dedizierte Tabelle
(idempotent). Alles inert: Kill-Switch `HUNT_RESPONSE_REAL_EXEC_ENABLED` AUS + kein Deploy-Keypair + kein `mgmtCidr`.

**Slice 3c — Windows-Containment (Windows-Firewall, inert):**
OS-Routing im `containmentRunner`: Windows-Nodes → `isolate-host-windows`/`release-isolation-windows`
(powershell) + SSH-User `Administrator` (statt `root`); Linux unverändert. `deploy/isolate-host.ps1`
setzt eine eigene Regel-Gruppe `NexoraContainment` (Allow für Mgmt-CIDR **und** Live-`$env:SSH_CONNECTION`-Peer
ZUERST), DANN Default beidseitig Block; der VORHERIGE Default wird für die exakte Freigabe in eine State-
Datei gesichert. `release-isolation.ps1` ist **fail-closed**: fehlt die State-Datei trotz aktiver Isolation,
wird NICHT geraten (Lockout-Schutz) — die Isolation bleibt bis manueller Wiederherstellung. PowerShell-
Struktur-Test `deploy/tests/containment-scripts.windows.test.ps1` (16 Checks, fakt die Firewall-Cmdlets).
Security-Review durchlaufen (C-2 Lockout-Fallback + H-1 SSH-User gefixt). **`ssh_user`-Registry-Feld**
ergänzt (Migration 056; Node-Feld `sshUser`, validiert im Runner, sonst OS-Default root/Administrator) —
Nicht-Standard-Admin-Konten (z.B. `DOMAIN\svc-ir`) werden unterstützt. **Windows-Arming offen:** nur noch der
eigene Windows-Lab-Smoke.

**Arming-Blocker (MÜSSEN vor `HUNT_RESPONSE_REAL_EXEC_ENABLED=true` erledigt sein — aus Security-Review Slice 3a):**
1. **Mgmt-Kanal.** ✅ Startup-Healthcheck (`containmentReadiness.checkContainmentReadiness`, im Boot):
   loggt `containment_real_exec_misconfig`, wenn Real-Exec scharf ist, aber `HUNT_RESPONSE_MGMT_CIDR`
   fehlt/ungültig (kein Boot-Abbruch — Runtime ist fail-closed). OFFEN (operativ): die CIDR muss die
   tatsächliche(n) Backend-Egress-IP(s) abdecken und bei jeder Netz-Änderung nachgezogen werden — der
   `$SSH_CONNECTION`-Fallback entschärft das, ersetzt aber die operative Verifikation nicht.
2. **Script-Level-Test.** ✅ STRUKTUR-Test vorhanden (`deploy/tests/containment-scripts.test.sh`, mockt `nft`
   zustandsbehaftet, prüft Ruleset-Aufbau + Mgmt-/Control-Channel-Preservation + Fail-closed; fand einen echten
   Self-Verify-Bug). OFFEN: **semantischer netns/Container-Test** (echte SSH-Session in-/out-of-CIDR) auf Linux.
3. **IP-Ambiguität.** ✅ `E_AMBIGUOUS_NODE` fail-closed im Containment-Runner (`findNodesByIp` liefert ALLE
   Records je IP; > 1 → verweigert). ✅ **M-1 (holistischer Security-Review) geschlossen:** der Runner filtert
   vor Leere/Ambiguität auf `CONTAINABLE_STATUS` (enrolled/active/stale) — 'retired'/'pending' Alt-Records mit
   stalem `host_key_pin` können das Targeting nicht mehr verwässern. OFFEN als optionale DB-Härtung: zusätzlicher
   `UNIQUE`-Constraint/Index auf aktive Nodes je IP (Defense-in-Depth auf DB-Ebene).
4. **Concurrency-Lock.** ✅ In-Process-Lock je `targetHost` in `HuntService.executeResponseAction`
   (paralleler zweiter Exec → `E_EXEC_IN_PROGRESS` 409). OFFEN bei Multi-Instanz: verteilter Lock (DB/Advisory).
5. **Lab-Smoke** auf echtem Host (gepinnter Key) — Ablauf im
   [Containment-Runbook](../01-architecture/adr-042-containment-runbook.md).

**Operator-Runbook:** Scharfschalten, Lab-Smoke, Rollback/Recovery (Self-Lockout) und die
Fehlercode-Tabelle stehen in `docs/01-architecture/adr-042-containment-runbook.md`.

