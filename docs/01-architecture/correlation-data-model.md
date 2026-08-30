# Correlation Engine — Datenmodell & Abnahme-Spezifikation

> **Status:** Verbindliche Architektur- + Abnahme-Spezifikation (Draft 1, 2026-06-16)
> **Scope:** Nexora SOC — Analysis-Seite (`frontend/src/pages/AnalysisPage.tsx`) + Backend-Correlation (`backend/src/correlation/`)
> **Gilt als:** Single Source of Truth dafür, *welcher Tab welche Felder aus welcher Quelle braucht*. Diese Datei ist die Checkliste, gegen die wir abnehmen.

---

## 0. Kernprinzip (der wichtigste Satz)

> **Die Analysis-Seite darf nicht pro Tab einzeln Daten zusammensuchen.
> Sie liest aus EINEM zentralen `CorrelationResult`-Objekt.**

**Falsch (heute teilweise):**
```
Overview  → fragt selbst Wazuh
Network   → fragt selbst Indexer
KI        → fragt selbst Evidence
Report    → fragt selbst Tickets
```

**Richtig (Ziel):**
```
GET /v1/tickets/:id/correlation
  → Correlation Engine sammelt aus allen Quellen (Q1–Q10)
  → liefert EIN CorrelationResult mit Provenance + Gaps
  → alle Tabs rendern nur verschiedene Ausschnitte
```

Begründung: Wartbarkeit, Testbarkeit, einheitliche Provenance, keine Race-/Cache-Divergenz zwischen Tabs.

---

## 1. Ziel der Correlation Engine

1. Pro Incident/Ticket **alle verfügbaren Daten** aus den Quellen Q1–Q10 einsammeln und **entitätszentriert korrelieren** (Host/IP/User/Hash/Domain/Prozess/Datei).
2. Jedes Feld trägt **Provenance** (woher, welcher Pfad, wie sicher, wann geholt).
3. Fehlende Felder sind **fachlich erklärt** (`missingReason`), nicht stumm `—`.
4. Output = ein typisiertes `CorrelationResult`, aus dem alle Tabs lesen.
5. Der KI-Agent arbeitet **nur noch auf dem `CorrelationResult`**, nicht mehr auf Roh-Quellen.

---

## 2. Provenance-Konzept (pro Feld)

Jedes Leaf-Feld ist kein nackter Wert, sondern ein `Field<T>`:

```ts
type Confidence = 'high' | 'medium' | 'low';

type FieldSource =
  | 'wazuh_alert'      // Q1 Roh-Event (ticket.logs)
  | 'wazuh_api'        // Q2 Syscollector/Inventory
  | 'wazuh_indexer'    // Q3 Alerts/Flows
  | 'threat_intel'     // Q4 VT/AbuseIPDB
  | 'mitre_rag'        // Q5 Qdrant
  | 'ki_agent'         // Q6 LLM
  | 'analyst'          // Q7 Ticket-Eingaben
  | 'audit_log'        // Q8
  | 'cross_reference'  // Q9
  | 'evidence_store';  // Q10

interface Field<T> {
  value: T | null;
  source: FieldSource | null;   // null = nirgends gefunden
  fieldPath: string | null;     // z. B. "data.srcip", "syscollector.netiface[].mac"
  confidence: Confidence | null;
  collectedAt: string | null;   // ISO
  missingReason?: MissingReason; // gesetzt, wenn value === null
}
```

**Regel:** `value === null` ⇒ `missingReason` MUSS gesetzt sein.

---

## 3. Missing-Reason-Konzept

Leer ist nie nur „—". Es ist erklärbar:

```ts
type MissingReason =
  | 'telemetry_not_enabled'   // z. B. Sysmon Event 3 nicht aktiv
  | 'source_provides_none'    // Quelle liefert das Feld grundsätzlich nicht (z. B. NAT bei Sysmon)
  | 'not_collected_yet'       // z. B. Threat Intel noch nicht abgefragt
  | 'not_applicable'          // Feld für diesen Event-Typ sinnlos (Host-Case = kein Flow)
  | 'source_unreachable'      // API/Indexer down
  | 'no_match';               // abgefragt, aber kein Treffer
```

UI-Beispiele:
- „Nicht vorhanden, weil **Sysmon Event 3 nicht aktiv** ist." (`telemetry_not_enabled`)
- „Nicht vorhanden, weil **die Quelle keine NAT-Daten** liefert." (`source_provides_none`)
- „**Threat Intel noch nicht abgefragt** — jetzt anreichern." (`not_collected_yet`)

Das ist bewusst ein **Vertrauens-Feature**: der Analyst sieht, dass nichts vergessen wurde.

---

## 4. Datenquellen Q1–Q10

| # | Quelle | Code-Anker | Liefert |
|---|---|---|---|
| **Q1** | Wazuh-Alert Roh-Event | `ticket.logs` → `wazuhEvidenceNormalizer.extractRaw` | `rule.*`, `agent.*`, `data.*`, `data.win.eventdata.*` (Sysmon 1/3/11/22, Security 4688/4624), `data.win.system.*` (EventChannel), `full_log`, `location`, `decoder`, `manager` |
| **Q2** | Wazuh-API / Syscollector | `WazuhApiClient` (`getAgent`, `getAgentInventory`, `getNetInterfaces`, `getProcesses`, `getListeningPorts`, `getAgentSca`, Vuln) | OS, OS-Version, FQDN, MAC, Interfaces, IPs, Hardware, Pakete, Ports, Prozesse, SCA, CVEs, Agent-Status, Last-Seen |
| **Q3** | Wazuh-Indexer | `WazuhIndexerClient` (`_search`, `ticketFlows`, Telemetrie) | Flows/Verbindungen, Top-Conversations, dst-Ports, Actions, verwandte Events im Zeitfenster, Zeitreihe, Severity, Event-Count |
| **Q4** | Threat Intel | `ThreatIntelService` (VirusTotal/AbuseIPDB + Cache) | Reputation/Verdict, Score, malicious/suspicious-Counts, ASN, Country, Org, Kategorien — pro IP/Hash/Domain/URL |
| **Q5** | MITRE / RAG (Qdrant) | `rag/` | Taktik, Technik(name), Beschreibung, Detection-Hinweise, verwandte Hunts, Referenzen |
| **Q6** | KI-Agent (LLM) | `AgentService` / `agents/` | Verdict, Confidence, Summary, Recommendation, FP-Assessment, strukturierte Entities |
| **Q7** | Analyst / Ticket | Ticket-Felder, `analystState` | Decision, Confidence, Recommendation, Notes, Kunden-Notes, Playbook/Checkliste, IoCs |
| **Q8** | Audit-Log | `AuditService` | Actor, Action, Zeit, geänderte Felder, Approval/Decision, IP-Hash |
| **Q9** | Cross-References | `findByIndicator`, `findChildren`, `findByHost` | Related Cases (gleiche IoC/Host/Agent), Parent/Child-Offenses |
| **Q10** | Evidence-Store | `EvidenceService`, `wazuhEvidenceCollector` | Endpoint-Artefakte, Snapshots, Chain of Custody, Hash/Integrität |

---

## 5. `CorrelationResult` — Typ-Skizze (Ziel-Output)

```ts
interface CorrelationResult {
  ticket:      TicketContext;          // Stammdaten + Case-Beziehungen
  detection:   DetectionContext;       // Rule/MITRE/Decoder
  host:        HostContext;            // Q2 Inventory + Asset
  identity:    IdentityContext;        // User/Logon
  process:     ProcessContext;         // Command/Process (Q1)
  file:        FileRegistryContext;    // File/Registry (Q1)
  network:     NetworkContext;         // Source/Dest/NAT/Connection (Q1/Q3)
  payload:     PayloadContext;         // DNS/Web/Payload (Q1)
  timeline:    TimelineContext;        // Q3 Flows/Events über Zeit
  entities:    EntityCorrelation[];    // CE-2 (live): entitätszentriert + Provenance
  threatIntel: ThreatIntelContext;     // Q4
  mitre:       MitreContext;           // Q5
  evidence:    EvidenceContext;        // Q10
  ai:          AiContext;              // Q6 (liest CorrelationResult)
  risk:        RiskContext;            // abgeleitet
  audit:       AuditContext;           // Q8
  report:      ReportContext;          // abgeleitet

  provenance:  Field<unknown>[];       // flache Liste aller Feld-Provenances (Audit/Debug)
  sources:     { source: FieldSource; eventCount: number }[];
  gaps:        CorrelationGap[];       // alle missingReason-Felder, gruppiert
  generatedAt: string;
}

interface CorrelationGap {
  area: keyof CorrelationResult;   // z. B. 'network'
  field: string;                   // z. B. 'destination.ip'
  missingReason: MissingReason;
  hint?: string;                   // Handlungsempfehlung ("Sysmon Event 3 aktivieren")
}
```

> Jeder Context-Block besteht aus `Field<T>`-Leaves (Provenance pro Feld), nicht aus nackten Werten.

---

## 6. Feldliste pro Analysis-Tab (Abnahme-Matrix)

Legende Status: ✅ fließt · 🟡 teilweise/nicht verdrahtet · ❌ fehlt (Wiring) · ⛔ Quelle erzeugt aktuell keine Daten
Pflicht: **P** = Pflicht (Tab ist ohne wertlos) · O = optional

### Header / Stammdaten
| Feld | Quelle | Pflicht | Status | missingReason wenn leer |
|---|---|---|---|---|
| Ticket-Nr, Titel, Priorität, State/Status | Q7 | P | ✅ | — |
| Analyst, Kunde, Source, Category | Q7 | O | ✅ | — |
| First/Last Seen, Event-Count, OffenseID | Q1/Q3 | P | ✅ | — |
| Related/Parent/Child Cases | Q9 | O | ✅ | `no_match` |

### Tab „Overview"
| Feld | Quelle | Pflicht | Status |
|---|---|---|---|
| Top Conversations | Q3 | P | 🟡 (Query auf Ticket-Regel statt Host-Netz) |
| Communication Map (Source/Dest) | Q1/Q2 | P | 🟡 |
| Event Timeline Preview | Q3 | P | 🟡 |
| Payload Preview (normalized/parsed/raw) | Q1 | O | ✅ |
| Commands Executed | Q1 (Sysmon 1/4688) | P | ✅ |
| Windows Event (Provider/EventID/Channel/Message) | Q1 win.system | P | ✅ (live) |
| Provenance-Banner | Engine | O | ✅ (live) |

### Tab „Network & NAT"
| Feld | Quelle | Pflicht | Status | missingReason |
|---|---|---|---|---|
| Source: Host, User, IP | Q1/Q2 | P | ✅ | — |
| Source: MAC | Q2 netiface | P | 🟡 | `not_collected_yet` (Backfill) |
| Source: Interface | Q2 netiface | O | ❌ | `source_provides_none` (nicht verdrahtet) |
| Source: Zone | — | O | ❌ | `source_provides_none` (Wazuh kennt keine Zone) |
| Destination: IP/Port/FQDN/SNI/HTTP-Host | Q1 Sysmon 3 | P | ⛔ | `telemetry_not_enabled` |
| Destination: Country/ASN/Org/Reputation | Q4 | P | ❌ | `not_collected_yet` |
| NAT (Pre/Post/Type/Rule) | Q1 Firewall | O | ⛔ | `source_provides_none` |
| Connection (Proto/Transport/Dir/Action/State/Bytes/Packets/Duration) | Q1 Sysmon 3 / FW | P | ⛔ | `telemetry_not_enabled` |
| Flow-Tabelle | Q3 | P | 🟡 (braucht Host-Netz-Query) |

### Tab „Payloads"
| Feld | Quelle | Pflicht | Status | missingReason |
|---|---|---|---|---|
| Method/URL/Host-Header/User-Agent/Content-Type/Status/Length | Q1 (Web/Proxy) | O | ⛔ | `telemetry_not_enabled` |
| containsCredentials/Token/Script/Base64, Keywords | Q1 Smart-Parser | O | 🟡 (heute „unknown") |
| Decoded Command | lokal | O | ✅ |

### Tab „Commands"
| Image/Parent/CommandLine/User/LogonId/ProcessId/IntegrityLevel/Hashes/CurrentDir | Q1 eventdata | P | ✅ (Sysmon 1/4688) |

### Tab „Entities"
| User/Host/IP/MAC/Domain/URL/Process/File/Hash + Provenance + Event-Count | Engine (Q1+Q3+Q9) | P | ✅ (CE-2 live) |

### Tab „IOCs / Analyse"
| IoC-Liste + Reputation | Q7+Q4 | P | 🟡 (on-demand) |
| Cross-Ref / Related Cases | Q9 | O | ✅ |
| Decision/Confidence/Recommendation | Q7 | P | ✅ |
| Risk & Impact | abgeleitet | O | ✅ |

### Tab „Timeline"
| Flow-/Event-Verlauf | Q3 | P | 🟡 |

### Tab „KI-Analyse"
| Verdict/Summary/Recommendation/Entities | Q6 (auf CorrelationResult) | P | ✅ (heute auf Roh-Bundle) |

### Tabs „Evidence / Export / Report"
| Evidence-Bundle, Chain of Custody, Hash | Q10 | P | ✅ |
| Markdown/JSON/PDF | abgeleitet | O | ✅ |

### Tabs „History / Notes / Playbooks"
| Audit-Verlauf | Q8 | O | ✅ |
| Notes/Kunden-Notes, Checkliste/Playbook | Q7 | O | ✅ |

### Host-Kontext (Q2) — gehört ins CorrelationResult.host, heute nur Host-Seite
| OS, OS-Version, FQDN, Hardware, Pakete, offene Ports, laufende Prozesse, CVEs, SCA, Agent-Status, Last-Seen | Q2 | P (für Source/Risk/Report) | 🟡 (nicht ins Ticket-Deck korreliert) |

---

## 7. Vollständige Feld-Sammlung nach Domäne

> Ziel-Inventar je Context-Block. Jedes Feld als `Field<T>` mit Provenance.

**Ticket / Case:** Ticket-ID/INC, Title, Priority, Severity, State, Status, Source, Category, Customer, Assigned Analyst, Created/Updated At, First/Last Seen, Offense ID, Related Tickets, Parent/Child Cases.

**Wazuh Rule / Detection:** Rule ID, Level, Description, Groups, MITRE IDs, Decoder, Location, Manager, Agent ID, Agent Name, Cluster Node, Original Alert Timestamp.

**Host / Asset (Q2):** Hostname, FQDN, Agent ID, OS, OS-Version, Kernel/Build, IP-Adressen, MAC-Adressen, Interfaces, Domain, Last Seen, Agent Status, Installed Software, Open Ports, Running Processes, SCA Score, Open CVEs, Critical/High CVE Count.

**User / Identity:** Username, Domain, SID, Logon ID, Logon Type, Privilege Level, Session, Source Workstation, Authentication Package.

**Process / Command:** Process Name, Image Path, Command Line, Decoded Command, Parent Process, Parent Command Line, Process ID, Parent PID, Process GUID, Parent GUID, Current Directory, Integrity Level, Hashes, Signer, User, Start Time, MITRE Mapping.

**File / Registry:** File Path/Name/Extension/Directory, Hash, Size, Signature, Creation/Modification Time, Registry Key/Value/Data, Operation.

**Network / NAT:** Source IP/Port/Host/MAC/Interface/Zone, Destination IP/Port/FQDN/MAC/Interface, Protocol, Transport, Direction, Action, State, Bytes Sent/Received, Packets, Duration, Original/Post-NAT Source/Destination, NAT Type, Firewall Rule.

**DNS / Web / Payload:** DNS Query, Resolved IP, Record Type, TTL, SNI, HTTP Host, URL, Method, User-Agent, Content-Type, Status Code, Payload Length/Preview, Base64/Decoded Content, Suspicious Keywords, Credential/Script Indicators.

**Threat Intel (Q4):** Indicator, Indicator Type, Provider, Verdict, Score, Confidence, Malicious/Suspicious Count, ASN, Country, Organization, Tags, Categories, References, Last Checked, Cache Status.

**MITRE / Detection Context (Q5):** Tactic, Technique, Sub-Technique, Technique Name, Description, Detection Advice, Related Rules, Related Hunts, Coverage Status.

**Evidence (Q10):** Evidence ID, Type, Source, Title, Summary, Raw Reference, Hash, Chain of Custody, Collected By/At, Linked Ticket/Finding, Integrity Status.

**KI-Analyse (Q6):** Verdict, Confidence, Summary, What/How/Where/Why, Risk, FP-Assessment, Recommended Actions, Missing Evidence, Evidence Used, MITRE Mapping, Follow-up Hunts, Report Draft.

**Audit / History (Q8):** Actor, Action, Timestamp, Changed Fields, Approval Status, Decision, Reason, Previous/New State, Source IP Hash.

---

## 8. Telemetrie-Abhängigkeiten (was zuerst an der Quelle existieren muss)

| Feldgruppe | Hängt an | Aktueller Befund |
|---|---|---|
| Destination/Connection/Flow (Network-Tab) | **Sysmon Event 3** (Network Connection) | ⛔ **Agenten 001/004/009 = 0 Events mit `data.dstip`** im Indexer. Sysmon Event 3 nicht aktiv/zu stark gedrosselt. |
| Payload/Web | Web-Proxy/HTTP-Telemetrie | ⛔ nicht vorhanden |
| NAT | Firewall-Quelle (OPNsense/pfSense) | 🟡 nur an Firewall-Tickets |
| CVE/SCA/Inventory | Q2 Wazuh-API | ✅ verfügbar, nicht verdrahtet |

> **Konsequenz:** Network-/Payload-Tabs können bei host-basierten Windows-Events erst vollständig werden, wenn die jeweilige Telemetrie an der Quelle aktiviert ist. Bis dahin: `missingReason: 'telemetry_not_enabled'` mit Hinweis.

---

## 9. Priorisierte Bau-Reihenfolge (CE-1 … CE-7)

> **Nicht alles auf einmal.** Kleine Schritte, je Schritt Live-Test pro betroffenem Tab.

| Schritt | Inhalt | Quelle | Füllt |
|---|---|---|---|
| **CE-1** | Spec (dieses Dokument) + `CorrelationResult`-Skeleton + Endpoint `GET /v1/tickets/:id/correlation` | — | Gerüst |
| **CE-2** | Q1 Roh-Event sauber normalisieren (eventdata + win.system + data.* + rule/agent) in Context-Blöcke mit Provenance | Q1 | Overview, Payloads, Commands, Entities, Evidence-Input, KI-Input |
| **CE-3** | Q3 Indexer korrekt anbinden (Host/Agent/Zeitfenster statt nur Ticket-Regel; Netz-Events mit `data.dstip`) | Q3 | Timeline, Top Conversations, Related Events, Network-Preview, Event-Count, Severity-Verlauf |
| **CE-4** | Q2 Syscollector/Inventory ins Ticket ziehen | Q2 | Source-Card, Host-Context, Entities, Risk, Report, KI |
| **CE-5** | Q4 Threat Intel automatisch je Entity (Cache zuerst) | Q4 | Destination-Card, IoC-Tab, Risk-Score, KI, Report |
| **CE-6** | Q5 MITRE/RAG-Kontext anreichern | Q5 | Tactic/Technique/Detection/Hunts/References |
| **CE-7** | Q6 KI-Agent nur noch auf `CorrelationResult` (Prompt-Builder liest CorrelationResult, sucht nicht selbst) | Q6 | KI-Analyse sauber & deterministisch |

### Ist-Stand (bereits live, Stand `main`)
- **evidenceNormalizer** (Registry: Wazuh-Rich + generisch alle Quellen) — Teil von **CE-2**.
- **entityCorrelation** (Entity-Merge + Provenance) — die **Entities**-Sektion (CE-2/Entities) ist umgesetzt.
- **CorrelationEngine.correlate/mergeEvidence** — Vorläufer des `CorrelationResult` (heute noch `ParsedEvidence`-geformt + `correlation`-Meta).
- **win.system-Extraktion** + „Windows Event"-Karte — Teil von **CE-2**.
- **Route** `GET /tickets/:id/evidence` liefert gemergte Evidence + `correlation`-Meta (eventCount/sources/entities).
- **CE-3 Flow-Modell** (`flowNormalizer` + `networkCorrelation`) live: einheitliches Network/NAT-Flow-Modell (Firewall + Sysmon Event 3) mit `provenance`+`missingReason` pro Feld; „Korrelierte Flows"-Tabelle, Top-Conversations, Timeline-NetworkConnect.
- **CE-4.2/4.3 live** (deployt `efa6d63`, 2026-06-17): Flows werden über `inventoryLookupCache` (TTL 5 min, soft-fail → `null`) mit **Host/MAC/Host-Interface** aus dem Wazuh-Syscollector angereichert (`buildNetworkCorrelation({ inventoryLookup })` in der Timeline-Route). **Interface-Semantik getrennt:** Host-NIC = `sourceHostInterface`/`destinationHostInterface` (aus `netiface.name`) ≠ Firewall-Interface = `firewallInterface`/`firewallIngressInterface`/`firewallEgressInterface` (aus `data.srcintf`/`dstintf`). `setIfEmpty` → Host-Anreicherung überschreibt das Firewall-Interface nie. Live-Smoke: DC01 + CERBERUS zeigen MAC/Host-IF; FritzBox-Ziel `not_in_inventory`.
  - **Quell-Lücke (kein App-Bug):** die realen OPNsense-Events im Indexer führen nur `protocol/srcip/dstport/action/srcport/dstip` — **kein** `srcintf`/`rulenum`. Darum bleibt `firewallInterface`/`firewallRule` live `null` (korrektes „no-fake"). Befüllung braucht OPNsense-Logformat/Wazuh-Decoder (Quell-/Decoder-Arbeit), nicht die App.
  - **FQDN (CE-4.4 + CE-4.4.1, LIVE — Sysmon-Kette geschlossen):** `sourceFqdn` kommt aus dem Event-Computer (`data.win.system.computer`) — nur source-seitig (`initiated=true`) und nur bei echtem FQDN (`isRealFqdn`), sonst aus Inventory-FQDN (nur echter), sonst `null`+`field_missing` (kein Fake). Reihenfolge via `setIfEmpty`: Event-Computer > Inventory > (später DNS/AD). **CE-4.4.1:** `ticketFlows`-`_source`-Projektion fordert `data.win.system.computer`+`data.win.eventdata.initiated` an (sonst erreichte der Computer den Normalizer nie). **Live bewiesen (`6c013fa`, 2026-06-17):** INC000283 `sourceFqdn = DC01.nexora.example`. Vollständige Kette: Sysmon E3 → Wazuh-Alert → ticketFlows-Projektion → flowNormalizer → `network.flows` → Network-Tab. **CE-5.2/5.3 DNS Forward-Confirm (LIVE, aktiv `d8d698a`, 2026-06-17):** pure `fqdnResolver` (`resolveFqdn({ip, candidateName})` → Name zu A-Record + IP-Bestätigung = high-confidence FQDN, sonst kein Fake) + verdrahtete `flowFqdnEnrichment.js` (async, nach Inventory-Anreicherung, ENV-gated `FQDN_RESOLVER_ENABLED`/`FQDN_DNS_SERVER`/`FQDN_DOMAIN`, read-only, soft-fail). Füllt nur leere `sourceFqdn`/`destinationFqdn`; Kandidat = Host-Kurzname + `FQDN_DOMAIN`. **Live-Smoke:** WEC01 (10.99.99.11) → `WEC01.nexora.example` (Provenance `dns_forward_confirm`, nur weil A == Flow-IP); falsche IP → `dns_unconfirmed`; INC000283 behält `DC01.nexora.example` (Event-Computer gewinnt); `opensourcebackup`/`CERBERUS` (nicht AD-gejoint) → `dns_no_record`, ehrlich leer. **FQDN-Reihenfolge der Wahrheit (final):** Event-Computer → Inventory → DNS-forward-confirm (A==IP) → sonst ehrlicher `missingReason`. Spec: `docs/01-architecture/ce5-fqdn-source-discovery.md`. **Deploy-Lektion:** prod-Compose reicht ENV über expliziten `environment:`-Block durch (kein `env_file`) → neue prod-ENV muss dort deklariert werden (`d8d698a`). **Offen:** Reverse PTR geparkt (keine Zone), LDAP `dNSHostName` optional später (read-only Bind-Account), weitere Quellen (WMI, DHCP-Lease).
- **Migrationspfad:** `correlate()` schrittweise von `ParsedEvidence` auf das sektionierte `CorrelationResult` heben; alten Endpoint additiv lassen, neuen `…/correlation` daneben einführen, Tabs nacheinander umstellen.

---

## 10. Live-Test-Kriterien pro Tab (Definition of Done)

Jeder Schritt gilt erst als fertig, wenn an **echten Live-Tickets** geprüft:

- **Overview:** Sysmon-1-Ticket zeigt Commands (Image+CmdLine+Hash); EventChannel-Ticket zeigt „Windows Event"-Karte mit Message; Provenance-Banner zeigt Event-/Quellen-Zahl.
- **Network & NAT:** Bei aktivem Sysmon 3 erscheinen Destination/Connection + Flow-Tabelle mit echten dst-IPs; bei host-basiertem Event steht statt „—" der `missingReason`. **Host-Case flow-only Query (fixed `f2705b3`):** Host-Case-`ticketFlows` holt gezielt nur flow-relevante Events (Firewall src/dst-IP oder Sysmon E3) — sonst verdrängen Nicht-Flow-Events eines busy Hosts (DC01) die älteren Flows aus dem `size`-Fenster (INC000283 war „blind"/0 Flows). Rule-scoped Query unverändert.
- **Entities:** Host/IP/User/Process/File/Hash aggregiert über alle Events, jede mit „Quelle ×N".
- **IoC/Analyse:** Reputation je IoC nach „Anreichern"; Cross-Ref zeigt Related Cases.
- **Timeline:** Events im Zeitfenster des Hosts (nicht nur die Ticket-Regel).
- **KI-Analyse:** Prompt nachweislich aus `CorrelationResult` gebaut (kein Eigen-Fetch).
- **Report/Evidence:** Felder stimmen mit Deck überein; Chain of Custody + Hash vorhanden.
- **Jedes leere Feld:** trägt einen `missingReason` — nie stumm `—`.

---

## 11. Sysmon Event 3 — kontrollierte Aktivierung (separater Schritt, NACH der Spec)

**Hosts (Start):** DC01, WEC01, WindowsClient.
**Ausspielung:** über GPO `Nexora-Sysmon-Deploy` (NETLOGON `sysmonconfig.xml`).

**Filter (nicht unlimitiert — Agent-Buffer schonen):**
```
include:
  - powershell.exe, cmd.exe, wscript.exe, cscript.exe, mshta.exe,
    rundll32.exe, regsvr32.exe, certutil.exe
  - Prozesse aus User-/Temp-Pfaden
  - externe Ziele (non-RFC1918)
exclude/reduce:
  - Browser-Massentraffic, Windows Update, Defender
  - bekannte interne Server, DC-Replikationsrauschen
```

**24h-Monitoring nach Rollout:** Event-Volumen, Indexer-Last, Wazuh-Agent-Buffer, Rule 202/203, Dashboard-Rauschen, Top-Destination-Ports, Top-Prozesse-mit-Netzwerk.

> Begründung für die Dosierung: Es gab bereits Agent-Buffer-Probleme (OPNsense-Flood). Event 3 unlimitiert = Wiederholungsgefahr.

---

## 12. Offene Entscheidungen / Nicht jetzt

- **Zone/Interface** für Source: Interface aus Q2 verdrahtbar; „Zone" hat in Wazuh keine native Quelle → bewusst leer (`source_provides_none`).
- **Payload/Web-Telemetrie:** braucht Proxy-/HTTP-Logging — eigenes Thema, nicht Teil dieser Engine.
- **Persistenz von `CorrelationResult`:** zunächst on-the-fly berechnet; spätere Cache-/Snapshot-Strategie offen.
- **`.html`-Variante** dieser Spec: auf Wunsch parallel generierbar (Projekt-Konvention `.md`+`.html`).
