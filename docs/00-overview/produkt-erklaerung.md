# Nexora SOC — Produkterklärung

> **Eine self-hosted SOC-Orchestrierungsplattform für Tier 1–3.**
> Sie reduziert Routinearbeit durch KI-gestützte Triage, Evidence-Korrelation und
> Threat-Intel-Anreicherung — damit erfahrene Analysten Zeit für Tier-3-Arbeit gewinnen.
> Kritische Aktionen bleiben Human-in-the-loop, rollenbasiert freigabepflichtig,
> auditierbar und rückrollbar.

**Stand:** 2026-06-20 · **Reifegrad:** produktiv & live (`nexora.example`, 10.99.99.75)
**Sprache der Oberfläche:** Deutsch · **Lizenzhaltung:** Open Source

---

## Inhalt

1. [Management Summary](#1-management-summary)
2. [Das Problem](#2-das-problem)
3. [Die Lösung — was Nexora tut](#3-die-lösung--was-nexora-tut)
4. [Abgrenzung — was Nexora *nicht* ist](#4-abgrenzung--was-nexora-nicht-ist)
5. [Nutzen je Rolle](#5-nutzen-je-rolle)
6. [Funktionsumfang im Detail](#6-funktionsumfang-im-detail)
7. [Der zentrale Workflow: vom Alert zum geschlossenen Ticket](#7-der-zentrale-workflow-vom-alert-zum-geschlossenen-ticket)
8. [Architektur](#8-architektur)
9. [Sicherheits- und Designprinzipien (Hardrules)](#9-sicherheits--und-designprinzipien-hardrules)
10. [Betrieb, Deployment & Datenhoheit](#10-betrieb-deployment--datenhoheit)
11. [Reifegrad, Grenzen & Roadmap](#11-reifegrad-grenzen--roadmap)
12. [Glossar](#12-glossar)

---

## 1. Management Summary

**Nexora SOC** ist eine **Orchestrierungs- und Analyse-Plattform für Security Operations
Centers**. Sie sitzt *über* den vorhandenen Sicherheitswerkzeugen — Wazuh, QRadar, Splunk —
und macht aus deren rohen Alerts nachvollziehbare, angereicherte, priorisierte Vorgänge
(„Tickets"), die ein Analyst effizient bearbeiten kann.

Der Kerngedanke: Ein SOC ertrinkt nicht in fehlenden Werkzeugen, sondern in **Alert-Volumen,
Kontextarbeit und Wiederholung**. Tier-1/2-Analysten verbringen den Großteil ihrer Zeit damit,
denselben Kontext immer wieder manuell zusammenzusuchen — wer ist der Host, was sagt die
Threat-Intel zur IP, hängt das mit einem anderen Vorfall zusammen, ist das ein bekannter
False Positive? Nexora automatisiert genau diese Vorarbeit, bereitet eine **Entscheidung vor**
und legt sie dem Menschen zur **Freigabe** vor.

Was Nexora messbar liefert:

- **Weniger manuelle Triage** — eingehende Alerts werden automatisch zu Tickets normalisiert,
  dedupliziert, mit Threat-Intelligence angereichert und einem Host-Kontext zugeordnet.
- **Schnellere Entscheidungen** — ein KI-Copilot fasst die Beweislage zusammen, schlägt eine
  Einordnung vor (eskalieren, False Positive, korrelieren, eindämmen) und begründet sie *mit
  Belegen* — nie ohne.
- **Nachweisbarkeit** — jeder Vorgang trägt eine vollständige Beweiskette (Evidence,
  Chain of Custody, Audit-Trail), exportierbar als PDF/CSV.
- **Datenhoheit** — vollständig self-hosted. Daten verlassen das eigene Netz nur dann, wenn
  ein Analyst eine Cloud-Funktion bewusst aktiviert (z. B. VirusTotal-Abfrage oder ein
  Cloud-LLM).

**Reifegrad:** Das System ist **produktiv im Einsatz**. Backend und Frontend sind durchgängig
testgetrieben entwickelt (~2.700 Backend-Tests, ~900 Frontend-Tests, alle grün). Die
Architektur ist auf Erweiterbarkeit und Auditierbarkeit ausgelegt.

**Positionierung in einem Satz:** *Nexora ist der Analyst-Copilot und die Orchestrierungs-
schicht für das SOC — kein Ersatz für SIEM oder EDR, sondern die intelligente Klammer darüber.*

---

## 2. Das Problem

Ein modernes SOC betreibt typischerweise bereits leistungsfähige Werkzeuge:

- ein **SIEM** (Wazuh, QRadar, Splunk) für Sammlung und Regel-Erkennung,
- ggf. **EDR/AV** auf den Endpunkten,
- **Threat-Intel-Quellen** für Reputationsdaten.

Trotzdem entsteht der Engpass **zwischen** diesen Werkzeugen — in der menschlichen Triage:

| Schmerzpunkt | Auswirkung |
|---|---|
| **Alert-Flut** | Tier-1 wird von Volumen erschlagen; echte Vorfälle gehen im Rauschen unter. |
| **Kontext-Suche von Hand** | Für jeden Alert dieselben Fragen: Host? IP-Reputation? Zusammenhang? — manuell, wiederholt. |
| **False-Positive-Müdigkeit** | Bekanntes Rauschen wird immer wieder neu bewertet, statt sauber und *scoped* ausgenommen. |
| **Fehlende Nachvollziehbarkeit** | Entscheidungen sind nicht durchgängig belegt → schwierig bei Audit, Übergabe, NIS2. |
| **Tier-3-Zeit verbrennt in Tier-1-Arbeit** | Die teuersten Analysten machen Routinetriage statt Threat Hunting / Detection Engineering. |

Nexora setzt **nicht** bei der Erkennung an (das macht das SIEM gut), sondern bei der
**Verarbeitung, Anreicherung und Entscheidung** danach.

---

## 3. Die Lösung — was Nexora tut {#3-die-lösung--was-nexora-tut}

Nexora bildet die **Verarbeitungskette nach dem Alert** als nachvollziehbaren Fluss ab:

```
Rohdaten        →  Adapter        →  Ticket         →  Anreicherung    →  KI-Analyse        →  Entscheidung      →  Report
(SIEM-Alert)       (Validierung +     (normalisiert,     (Threat-Intel,     (Zusammenfassung     (Mensch gibt frei,    (PDF/CSV,
                    Normalisierung)    dedupliziert)      Host-Kontext,      + Vorschlag mit       Audit, rückrollbar)   Chain of
                                                          MITRE-Mapping)     Belegen)                                    Custody)
```

Die wichtigsten Bausteine:

- **Multi-SIEM-Aufnahme über Adapter** — jede Quelle (Wazuh, QRadar, Splunk, generische
  Webhooks) wird über einen eigenen Adapter validiert und in ein einheitliches Ticket-Format
  übersetzt. Kein externer Input wird ungeprüft übernommen.
- **Automatische Anreicherung** — IOCs (IP, Domain, Hash) werden extrahiert und gegen
  VirusTotal und AbuseIPDB bewertet; Host-Inventar, Schwachstellen und Compliance-Daten
  kommen aus Wazuh; Techniken werden auf **MITRE ATT&CK** gemappt.
- **KI-Copilot mit Human-in-the-loop** — der KI-Agent erzeugt *Vorschläge*, keine
  selbsttätigen Aktionen. Jeder Vorschlag ist mit Beweisen hinterlegt (Anti-Halluzinations-
  Guardrails) und durchläuft einen Freigabe-Workflow.
- **Threat Hunting** — ein Katalog von MITRE-gemappten Hunts läuft per Knopfdruck gegen die
  Wazuh-Daten; Funde werden zu Tickets oder Evidence.
- **Detection Engineering** — aus echten Tickets entstehen Use-Case-Entwürfe; Regeln werden
  als Vorschau in mehreren Formaten (Wazuh-XML, Sigma, Splunk, QRadar) exportiert — niemals
  ohne Freigabe scharf geschaltet.
- **Compliance-Unterstützung (NIS2)** — ein Readiness-Werkzeug zur Nachweisführung (kein
  Konformitätsnachweis, siehe Abgrenzung).

---

## 4. Abgrenzung — was Nexora *nicht* ist {#4-abgrenzung--was-nexora-nicht-ist}

Ehrliche Grenzen sind Teil des Produkts. Nexora ist **kein**:

- ❌ **SIEM-Ersatz.** Nexora erkennt nicht selbst, sondern konsumiert und korreliert die
  Erkennungen vorhandener SIEMs.
- ❌ **EDR/Antivirus-Ersatz.** Es entfernt keine Malware und greift nicht selbsttätig auf
  Endpunkten ein.
- ❌ **Auto-Remediation-Engine.** Kritische Aktionen werden vorbereitet, aber von einem
  Menschen freigegeben — nie automatisch ausgeführt.
- ❌ **Konformitätsnachweis / Zertifizierung / Rechtsgutachten.** Das NIS2-Modul ist ein
  *Arbeits- und Nachweis-Werkzeug* und erzeugt bewusst keinen Compliance-Claim (per Test
  erzwungen).
- ❌ **Remote-Command-Kanal.** Der optionale Endpoint-Companion sammelt nur read-only
  Inventar und Heartbeats. In der gesamten Provisioning-Kette gibt es **keinen** Apply-,
  Remote- oder Netzwerkänderungs-Kanal — der Server sendet nie ausführbare Befehle zurück.

Diese Grenzen sind nicht nur dokumentiert, sondern **im Code durch Tests abgesichert**
(z. B. ein Safety-Scanner, der den Linux-Installer gegen Netzwerk-/Apply-Befehle prüft und
den Build rot färbt, falls jemand sie einführt).

---

## 5. Nutzen je Rolle

Nexora kennt vier Rollen mit klarer Hierarchie: **admin > engineer > analyst > viewer**.
Rechte sind serverseitig durchgesetzt, nicht nur in der UI ausgeblendet.

| Rolle | Was sie tut | Konkreter Nutzen |
|---|---|---|
| **Viewer** | Lesen | Read-only-Einblick (z. B. Audit, NIS2-Readiness) ohne Änderungsrisiko. |
| **Analyst (Tier 1–2)** | Tickets bearbeiten, Triage, Hunts starten, KI-Vorschläge anfordern | Der Kontext ist schon da — weniger Klicks, schnellere Entscheidung, belegte Einordnung. |
| **Engineer (Tier 3)** | Detection Engineering, Use-Case-Dev, Regel-Export, Top-Erkennungsquellen | Aus echten Vorfällen werden neue Erkennungen — weniger Zeit in Tier-1-Routine. |
| **Admin** | Benutzer, Sicherheits-Policies, Provisioning, FP-Apply, NIS2-Edit | Volle Kontrolle über Policies, Audit und kritische Schalter — alles default-AUS und auditiert. |

---

## 6. Funktionsumfang im Detail

### 6.1 Incident-Ticketing & Lebenszyklus

Das Ticket ist das zentrale Objekt. Jeder Vorgang ist von der Entstehung bis zum Abschluss
nachvollziehbar.

- **Erstellung** manuell oder automatisch aus SIEM-Alerts (mit voller Feldvalidierung).
- **Deduplizierung** über Quelle + Offense-ID + Hash — kein Ticket-Wildwuchs bei wiederholten
  Alerts.
- **Fortlaufende Nummerierung** (`INC000001`, PostgreSQL-Sequence).
- **Lebenszyklus**: anlegen → bearbeiten (Status, Notizen, Zuweisung) → schließen mit Grund
  (resolved / False Positive / benign / dup).
- **Host-Case-Verknüpfung**: Wazuh-Events desselben Hosts werden automatisch unter einem
  Host-Case gebündelt; verwandte Tickets werden angezeigt.
- **Audit-Trail** pro Ticket — append-only, jede Änderung protokolliert.
- **Export** als echtes PDF (Analysis-Deck + Evidence), Admin-Löschung mit Bestätigungsdialog.

### 6.2 SIEM-Integration (Adapter-Pflicht)

Jede externe Quelle wird über einen **Adapter** angebunden, der validiert und normalisiert,
bevor Daten zum Ticket werden.

- **Wazuh** (primär): Webhook-Aufnahme (HMAC-signiert, Replay-Schutz über Nonce),
  Alert-→-Ticket-Processor mit Dedup, Manager-API (Agents, Inventar, SCA), Indexer/OpenSearch
  (Aggregationen, Suchen), FP-Exception-Builder.
- **QRadar**: Inbound-Adapter (Offense → Ticket) mit Feld-Mapping.
- **Splunk**: Inbound-Adapter (Notable → Ticket) mit Feld-Mapping.
- **Generische Webhooks**: HMAC-SHA256-Signatur + Nonce-basierter Replay-Schutz (5-Minuten-
  Fenster).

### 6.3 Evidence & Threat Intelligence

- **Evidence-Modell** (roh + geparst, JSONB für Flexibilität) mit eigener Historie pro Beleg.
- **IOC-Extraktion** (IP, Domain, Hash) automatisch aus Text.
- **Anreicherung**: VirusTotal (Hash/IP/Domain-Reputation), AbuseIPDB (IP-Abuse-Score).
- **Threat-Intel-Scoring** mit klarem Verdikt: benign / suspicious / malicious.
- **IOC-Dashboard** mit Reputationsanzeige je Indikator.
- **Chain of Custody** — Belege sind exportierbar und integritätsgesichert (Hash).

### 6.4 KI-Agent (Copilot)

Der KI-Agent ist der Kern der Effizienzgewinne — und der am stärksten abgesicherte Teil.

- **Vorschlags-Generierung** in vier Typen: `fp_rule` (False-Positive-Regel),
  `escalate` (eskalieren), `correlation` (korrelieren), `mitigation` (eindämmen).
- **Provider-Flexibilität**: lokal über **Ollama** (`llama3.2:3b`) als Default; Cloud-Provider
  (Anthropic / OpenAI / Google) **opt-in**, Keys ausschließlich über ENV, zur Laufzeit in der
  UI umschaltbar. Warnung: bei Cloud-Providern verlassen Daten das eigene Netz.
- **Evidence-Bundling**: Der Agent bekommt Wazuh-Events + Threat-Intel + MITRE-Kontext als
  Beweisbasis.
- **Entity-Extraktion** (Normalizer): Host (FQDN/OS/MAC via Syscollector), Benutzer, Prozess,
  Datei, Registry, Netzwerk (Sysmon E3), DNS (Sysmon E22) — als native Entity-Karten in der UI.
- **Anti-Halluzinations-Guardrails**: `confirmed_facts` nur, wenn belegt; ein
  FP-Konsistenz-Guard verhindert widersprüchliche Aussagen; ein **Evidence-Floor** hebt das
  Verdikt anhand harter VT-Trefferzahlen an; ein **Benign-Floor** stuft Scanner-Eigenfehler
  korrekt herunter.
- **Freigabe-Workflow**: jeder Vorschlag ist `pending` → `approved`/`rejected` (mit optionalem
  Grund) → Audit. Nichts wird ohne menschliche Freigabe wirksam.
- **RAG-Wissensbasis** (Qdrant): MITRE ATT&CK (697 Techniken) + Hunt-Katalog; die Basis lernt
  aus geschlossenen High/Critical-Tickets. RAG ist optional abschaltbar.

### 6.5 Threat Hunting

- **Hunt-Katalog** mit 10 vordefinierten, MITRE-gemappten Hunts (One-Click-Start).
- **Hunt-Sessions** mit Statusverlauf (RUNNING → COMPLETED), asynchroner Runner gegen
  Wazuh-API + YARA.
- **Live-Hunt-Konsole** zeigt Funde in Echtzeit.
- **Funde → Ticket/Evidence**: ein Fund wird zum neuen Ticket, an ein bestehendes angehängt
  oder als Evidence gesichert.
- **Metadaten** je Hunt: MITRE-Technik, erwartete Laufzeit, Konfiguration.

### 6.6 Detection Engineering, Use-Case-Dev & YARA

- **YARA-Engine**: Regel-CRUD, Pattern-Validierung (inkl. ReDoS-Schutz und Input-Caps),
  Scan gegen Text, Aktiv/Inaktiv-Schalter.
- **Wazuh-Erkennungsregeln**: read-only Proxy aus der API mit Suche/Filter (Gruppe, Level,
  Keywords).
- **Eigene Erkennungsregeln**: „Neue Regel"-Modal → eigene Wazuh-Regeldatei
  (`nexora-custom-detections.xml`, ID-Bereich 100500–109999).
- **Use-Case-Development**: aus einem echten Ticket entsteht ein Draft; reviewbar; Engineer/
  Admin gibt frei.
- **Regel-Export** nur als **Vorschau** in mehreren Formaten (Wazuh-XML / Sigma / Splunk /
  QRadar / YARA) — kein Scharfschalten ohne Freigabe.

### 6.7 Hosts & Inventory

- **Wazuh-Agentenliste** mit Status, IP, OS und Heartbeat (letzter Keepalive).
- **Syscollector-Inventar**: OS, Hardware, Netzwerk, installierte Pakete.
- **SCA** (Security Configuration Assessment): fehlgeschlagene Checks + Score.
- **Schwachstellendaten** aus dem Indexer (Soft-Fail, falls Indexer offline).
- **Host-Risk-Score** auf Basis von SCA + CVE; Host-Detailseite mit Timeline und Export.

### 6.8 Control-Plane / Provisioning (Endpoint-Companion-Fundament)

Eine backend-administrierte Node-/Agent-Registry **ohne** Apply-/Remote-/Netz-Kanal.

- **Enrollment-Profile** (admin) mit Rolle + read-only-Capabilities.
- **Enrollment-Token**: Klartext (`enr_…`) wird genau **einmal** angezeigt, gespeichert wird
  nur der SHA-256-Hash; Single-Use (consume-vor-mint).
- **Node-Credential-Handoff**: nach Enrollment erhält die Node ein Betriebs-Credential
  (`ncr_…`, einmalig); Heartbeats laufen nur damit, an die Node gebunden.
- **Heartbeat**-Antwort enthält **nie** Befehle.
- **Linux-Bootstrap-Installer** (`deploy/install/`): rein bootstrap-orientiert, durch einen
  Safety-Scan gegen Netzwerk-/Apply-Befehle abgesichert.
- Persistenz in PostgreSQL mit append-only Audit-Trigger. *(Credential-Revoke/Retire/Rate-
  Limits sind lokal fertig, noch nicht deployt.)*

### 6.9 Compliance — NIS2 Readiness

> **Ehrlich: kein Konformitätsnachweis, keine Zertifizierung, kein Rechtsgutachten** — per
> Test erzwungen. Ein Arbeits- und Nachweis-Werkzeug.

- **Control-Katalog** mit 10 Maßnahmenbereichen (statisch/versioniert, stabile Keys).
- **Assessment** je Control (`not_started … addressed / not_applicable`; „n/a" braucht eine
  Begründung).
- **Evidence-Links** (8 Typen) mit hart validierter Referenz (nur http/https, keine
  Secret-Query-/Fragment-Keys).
- **Readiness-Signale**: overdue / missingEvidence / needsReview (z. B. „addressed ohne
  Evidence" ⇒ Review).
- **Registry-UI** `/compliance/nis2` mit KPIs + Detail-Panel; Admin-Edit, Viewer read-only.
- **Audit-Redaction**: nur sichere Metadaten, nie Notizen oder URLs. *(Incident-Evidence-
  Verknüpfung + Management-Readiness-Report sind lokal fertig, noch nicht deployt.)*

### 6.10 Enterprise-Security & Identität

- **Auth**: Login per JWT (24h TTL, bcrypt(12)); Logout invalidiert das Token sofort
  (JTI-Blacklist); Passwortänderung verlangt das alte Passwort.
- **Session als httpOnly-Cookie** (`soc_token`) statt JWT im localStorage (XSS-Härtung);
  Bearer bleibt für API-Clients/PAT.
- **CSRF-Schutz** (Double-Submit) für Cookie-Sessions.
- **Account-Lockout** (Postgres-persistent), **Passwort-Policy/-History/-Ablauf** mit
  Zwangswechsel-Gate, **Mehrfach-Sitzungen-Limit**, **Inaktivitäts-Timeout** — alle
  serverseitig erzwungen, default AUS.
- **TLS-Erzwingung** und **IP-Allowlist** (IPv4/CIDR, fail-safe) als App-Guards.
- **Security-Header** via Helmet (CSP, HSTS, X-Frame-Options …), **Rate-Limiting** (global +
  Webhook-spezifisch), **CORS** konfigurierbar, **Input-Validierung** (Joi) auf allen Routen.

### 6.11 Monitoring, Audit & Reporting

- **Health-Endpoint** `/health` (DB-Status, Uptime) und **Prometheus-Metriken** `/metrics`.
- **Audit-Logging** append-only über alle Aktionen, abfragbar nach Aktion/Actor/Resource,
  **CSV-Export** (RFC-4180 + CSV-Injection-Schutz, UTF-8-BOM).
- **Request-Tracing** (eindeutige Request-ID), strukturierte Fehlerbehandlung.
- **Reporting**: PDF-Export von Analysis-Deck und Evidence-Bundle (jsPDF); Report-Textmodell
  vorhanden. *(Vollständiger Incident-/Kunden-Report-Generator ist in Arbeit.)*

---

## 7. Der zentrale Workflow: vom Alert zum geschlossenen Ticket

Am Beispiel eines Wazuh-Alerts (Tier-1-Analyst):

1. **Aufnahme** — Wazuh sendet einen signierten Webhook. Der Wazuh-Adapter validiert HMAC +
   Nonce und normalisiert das Alert.
2. **Ticketisierung** — der Processor legt ein Ticket an (oder dedupliziert auf ein
   bestehendes) und ordnet es dem Host-Case zu.
3. **Anreicherung** — IOCs werden extrahiert und gegen VirusTotal/AbuseIPDB bewertet; Host-
   Inventar/SCA/CVE und MITRE-Technik kommen dazu.
4. **KI-Analyse** — der Copilot bündelt die Beweislage, erzeugt eine strukturierte Analyse
   (Entity-Karten) und einen Vorschlag mit Begründung *und Belegen*.
5. **Entscheidung (Mensch)** — der Analyst prüft, gibt frei oder lehnt ab. Bei „False
   Positive" entsteht eine **scoped** Ausnahme (Rule-ID, Agent-ID, Grund, Approval) — kein
   globales Rule-Disable.
6. **Abschluss & Nachweis** — das Ticket wird mit Grund geschlossen; Audit-Trail und Evidence
   bleiben erhalten; bei Bedarf PDF-Report. Geschlossene High/Critical-Tickets fließen in die
   RAG-Wissensbasis zurück.

Jeder Schritt ist **auditiert** und – wo es kritisch wird – **freigabepflichtig und
rückrollbar**.

---

## 8. Architektur

**Stack:** React 18 + TypeScript + Vite (`frontend/`) · Node.js/Express + PostgreSQL
(`backend/`) · Docker (Multi-Stage) · Wazuh-Integration · KI auf Ollama (Cloud-Provider
opt-in) · Qdrant (RAG).

### 8.1 Backend — geschichtet nach Typ

```
domain/         reine Domänenobjekte + Validierung (Joi-Schemas in domain/validation/)
services/       Geschäftslogik — hängt an Repository-Interfaces, nicht am Storage
repositories/   Repository-Pattern: je Domäne eine InMemory*- UND eine Postgres*-Variante,
                gewählt über eine Domänen-Factory (DB_ENABLED=true → Postgres)
routes/         Express-Router, in app.js gemountet; pro Route requireAuth + requireRole(...)
integrations/   Adapter-Pflicht: jede SIEM-Quelle validiert + normalisiert externen Input
adapters/       (Wazuh/QRadar/Splunk/Email), bevor er zum Ticket wird
middleware/ · db/migrations/ (nummeriert, laufen beim Boot) · agents/ (KI/LLM) ·
threatHunting/ · rag/ (Qdrant)
```

Das **Repository-Pattern** ist tragend: Business-Logik kennt nur das Interface. Für Tests/Dev
gibt es InMemory-Repos (flüchtig, schnell), für den Produktivbetrieb Postgres-Repos —
ausgewählt über eine Factory pro Domäne. So bleibt die Geschäftslogik vom Storage entkoppelt
und gut testbar.

### 8.2 Frontend — feature-organisiert

```
features/<domäne>/   Komponenten + *Api.ts + reine Logik-Module + *.test.ts(x) (Vitest)
pages/               Routen-Screens (orchestrieren Features)
app/                 Router / Navigation
components/ui/        geteiltes UI-Kit (Buttons, Cards, Badges, Modals)
lib/                 Auth / RBAC / Utils · hooks/
```

Logik liegt konsequent in **puren Modulen** (gut testbar). Sicherheitsdetails sind
strukturell verankert: `element.textContent` statt `innerHTML` mit User-Input; Farben über
CSS-Variablen (Dark/Light), keine hartkodierten Hex-Werte.

### 8.3 Deployment

Docker Multi-Stage; Dev-Stack `docker-compose.dev.yml` (Hot-Reload), Prod-Stack
`deploy/docker-compose.prod.yml` (nginx + TLS, mehrere Container). Postgres-Migrationen laufen
beim API-Boot automatisch.

---

## 9. Sicherheits- und Designprinzipien (Hardrules) {#9-sicherheits--und-designprinzipien-hardrules}

Diese Regeln sind nicht nur Konvention, sondern teils per Test/Build erzwungen:

- **Human-in-the-loop bei kritischen Aktionen** — KI schlägt vor, der Mensch entscheidet.
- **Neue Security-/KI-Kontrollen default-AUS und serverseitig erzwungen** — kein Fake-Toggle;
  was gespeichert wird, wird auch durchgesetzt.
- **Keine Integration ohne Adapter** — externer Input wird immer validiert und normalisiert.
- **Kein Ticket ohne Traceability** — jeder Vorgang hat eine vollständige Beweiskette.
- **Keine Funktion ohne Test** — Entwicklung ist testgetrieben (TDD), ~2.700 Backend- und
  ~900 Frontend-Tests grün.
- **`element.textContent`, nie `innerHTML` mit User-Input** — XSS-Härtung als Grundregel.
- **Kein Remote-/Apply-/Netz-Kanal** in der Provisioning-Kette — durch Safety-Scanner
  abgesichert.

---

## 10. Betrieb, Deployment & Datenhoheit {#10-betrieb-deployment--datenhoheit}

- **Self-hosted, vollständig im eigenen Netz.** Produktiv-Deployment auf `nexora.example`
  (10.99.99.75) hinter nginx + TLS.
- **Datenhoheit:** Daten verlassen das Netz nur durch bewusst aktivierte Funktionen
  (VirusTotal/AbuseIPDB-Abfragen, optionale Cloud-LLM). Der Default-KI-Provider ist lokal
  (Ollama).
- **Betriebsfähigkeit:** Health-Checks (Docker/K8s-ready), Prometheus-Metriken, strukturiertes
  JSON-Logging, automatisiertes DB-Backup (Cron 03:30) mit dokumentiertem Restore.
- **Konfiguration** über umfassende `.env` (siehe `.env.example`), Migrationen automatisch
  beim Boot.

---

## 11. Reifegrad, Grenzen & Roadmap {#11-reifegrad-grenzen--roadmap}

**Heute live & getestet** (Auszug): Auth/RBAC, Ticketing-Lebenszyklus, Wazuh-/QRadar-/Splunk-
Aufnahme, Evidence + Threat Intel, KI-Copilot mit Guardrails + RAG, Threat Hunting, YARA +
Detection-Regeln, Hosts/Inventory, Provisioning-Kern, NIS2-Readiness-Basis, Audit + CSV-Export,
PDF-Export.

**In Arbeit / lokal fertig, noch nicht deployt:** Provisioning-Credential-Lifecycle
(Revoke/Retire/Rate-Limits), NIS2 Incident-Evidence + Management-Report, vollständiger
Incident-/Kunden-Report-Generator, MFA/TOTP, SSO/SAML/OIDC + PAT live, SBOM/Dependency-Scans,
E2E-Härtung (Playwright), Wazuh Health Center.

**Bewusste Nicht-Ziele (Scope):** Remote-Command-Ausführung auf Endpunkten, automatische
Bedrohungsentfernung, Konformitäts-/Zertifizierungs-Claims. Hosts-Enrollment „via Wazuh"
(Wazuh-Agent-Registrierung) ist eine offene No-Touch-Entscheidung.

> **Open Source zuerst.** Nexora ist und bleibt Open Source. Eine spätere kommerzielle
> Verwertung ist offen und nicht Teil der Roadmap.

Kanonische Quellen für den jeweils aktuellen Stand:
- [Roadmap](../08-roadmap/README.md) — Zielbild + Phasenstand
- [`docs/00-overview/feature-status.md`](feature-status.md) — kanonische Feature-Status-Matrix
- [Release Notes](changelog.md) — Änderungen je Release
- [`docs/adr/decisions.md`](../adr/decisions.md) — Architecture Decision Records

---

## 12. Glossar

| Begriff | Bedeutung |
|---|---|
| **SOC** | Security Operations Center — das Team/die Plattform für Sicherheitsüberwachung. |
| **Tier 1–3** | Eskalationsstufen im SOC: Tier 1 (Triage) → Tier 2 (Analyse) → Tier 3 (Hunting/Engineering/IR). |
| **SIEM** | Security Information and Event Management (hier: Wazuh, QRadar, Splunk). |
| **EDR** | Endpoint Detection and Response — Endpunkt-Sicherheitsagent. |
| **IOC** | Indicator of Compromise (IP, Domain, Hash …). |
| **Threat Intel** | Reputations-/Bedrohungsdaten externer Dienste (VirusTotal, AbuseIPDB). |
| **MITRE ATT&CK** | Wissensbasis für Angreifer-Taktiken und -Techniken. |
| **False Positive (FP)** | Fehlalarm — eine Erkennung ohne tatsächliche Bedrohung. |
| **Chain of Custody** | lückenlose, nachweisbare Beweiskette zu einem Vorfall. |
| **RAG** | Retrieval-Augmented Generation — KI mit angebundener Wissensbasis (hier Qdrant). |
| **Host-Case** | Bündel aus Tickets/Events desselben Hosts. |
| **HITL** | Human-in-the-loop — der Mensch entscheidet, die KI bereitet vor. |
| **NIS2** | EU-Richtlinie zur Cybersicherheit; Nexora unterstützt die Nachweisführung. |

---

*Dieses Dokument beschreibt den Produktstand vom 2026-06-20 und richtet sich an Entscheider
und technische Evaluatoren gleichermaßen. Maßgeblich für Detailfragen sind stets die im Repo
versionierten Quellen (Feature-Status-Matrix, ROADMAP, ADRs, Code).*
