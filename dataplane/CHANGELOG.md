# Changelog — Nexora Data Plane / Kollektor-Plattform

Änderungen am vereinten Data-Plane-Paket (`dataplane/`). Format angelehnt an *Keep a Changelog*.

> **Architektur:** Quell-Systeme (Wazuh, Cowrie, Suricata, OPNsense) **bleiben**. Darüber:
> **Kollektoren = Collectors** (je System, unbegrenzt) → **EventEnvelopeV1** (kanonischer Contract)
> → **Intake** (Annahme-Grenze, validiert/authentifiziert/idempotent/persistiert)
> → **KorrelierungsEngine** (Cross-Domain-Fusion) → **Nexora**.
> Vereint gebaut (revidiert ADR-001), erst in Docker nachgebaut, dann Proxmox-Umbau.

## [Unreleased]

### Added — Contract (Modul 1)
- **EventEnvelopeV1-Contract** (`src/contract/eventEnvelopeV1.js`): `validateEnvelope(env) → {valid, errors[]}`, dependency-frei. Erzwingt `schemaVersion "1.0"`, `eventId` (UUIDv4), `observedAt` (ISO), `source.{type,vendor,instanceId}`, `raw.hash` (SHA-256) + `raw.ref` (≤2000), **kein** Roh-Payload im Envelope, `provenance.confidence ∈ [0,1]`, `warnings ≤10`, `normalized.entities ≤50`. **Sicherheits-Invariante:** server-gesetzte Felder (`tenantId`, `receivedAt`) dürfen im eingehenden Envelope **nicht** vorkommen (Tenant-Isolation, kein Spoofing). 13 node:test.

### Added — Intake (Modul 2)
- **Intake-Service** (`src/intake/intakeService.js`): `ingestEvent(envelope,{auth,repo,now})` — Ablauf Auth → `validateEnvelope` → Idempotenz-Key `collectorId:eventId` (Duplikat = idempotenter Erfolg) → server-Felder anreichern (`tenantId`, `collector{collectorId,siteId}`, `receivedAt`) → persistieren. Rejection-Codes `UNAUTHENTICATED` / `SCHEMA_INVALID`. 7 node:test.
- **Intake-HTTP-Server** (`src/intake/server.js`, Express 4): `POST /v1/intake/events` → 202 accepted / 200 duplicate / 401 unauthenticated / 400 schema-invalid · `GET /health` · Malformed-JSON → 400. `resolveAuth` injizierbar. 6 node:test.
- **InMemory-Intake-Repo** (`src/intake/inMemoryIntakeRepo.js`) für Dev/Test · **Boot** (`src/intake/main.js`, Dev-Stub-Auth via Header `x-collector-credential`) · **Dockerfile** + `.dockerignore`.

### Added — Kollektor-Contract + Registry (Modul 3)
- **Kollektor-Registry** (`src/collector/collectorRegistry.js`): Plugin-Registry mit eindeutigen Namen, Abfrage je Domäne — Grundlage für „unbegrenzt viele Kollektoren je System".
- **Envelope-Builder** (`src/collector/buildEnvelope.js`): Kollektor-`NormalizedPart` → contract-konformer `EventEnvelopeV1` (eventId via `node:crypto.randomUUID`). Erweitert um optionales **`normalized.network`** (Flow-5-Tuple + echte Bytes/Pakete).
- **Kollektor-Runner** (`src/collector/runCollectorPipeline.js`): `normalize → buildEnvelope → validate → emit`; `emit` injiziert (transport-entkoppelt); Noise → skip, Parser-Fehler → invalid, **nie** ungültig emittieren. 8 node:test (+ 1 E2E: Kollektor → Intake → persist).
- **Kollektor-Contract:** `{name, domain, source{type,vendor,instanceId}, parserVersion, normalize(rawItem) → part|null}`.

### Added — Erste echte Kollektoren
- **Firewall-Go-Collector angedockt** (`tests/firewallCollectorContract.test.js`): Konformitätsnachweis, dass der Envelope des vorhandenen Go-Collectors (mit Extras `raw.contentType` / `normalized.network` / `collector{}`) den `validateEnvelope` passiert und kein `tenantId` setzt → er spricht denselben Contract wie unser Intake. 3 node:test.
- **conntrack-Flow-Collector** (`src/collector/conntrackCollector.js`): eigener leichter Flow-Sensor (kein Suricata). `parseConntrackEvent` parst `conntrack -E -e DESTROY` (orig/reply); `createConntrackCollector({instanceId, ports})` liefert ein Kollektor-Plugin → `normalize` mit **echten Bytes** (`bytesToServer`/`bytesToClient`, `pkts*`) + 5-Tuple, Scope-Port-Filter (Eigen-Egress wird verworfen). 7 node:test. End-to-End in Docker verifiziert (Flow mit 1840/1450 Bytes → Intake → 202).

### Added — conntrack-Collector als eigenständiger Container (statt In-Process-Modul)
- **HTTP-Intake-Emitter** (`src/collector/intakeClient.js`): `createIntakeEmitter({url, credential, fetchImpl, onError})` → `emit(env)` POSTet `EventEnvelopeV1` an den Intake (Header `x-collector-credential`). 202/200 = Erfolg; non-2xx und Netzfehler → `onError` (best-effort, **wirft nicht** → der Stream bricht nicht ab). Passt direkt in `runCollectorPipeline({emit})`. 5 node:test (Fake-Fetch).
- **Runner streamfähig** (`src/collector/runCollectorPipeline.js`): `for…of` → `for await…of` — konsumiert jetzt auch **async-Iterables** (Live-stdin/Replay), Array-Pfad unverändert. +1 node:test (async-Generator).
- **Replay-Quelle** (`src/collector/replaySource.js`): `createReplaySource({filePath, loop, delayMs})` → async-Zeilen-Iterator aus Datei (getrimmt, `#`-Kommentare ignoriert, optional Endlos-Loop). Lässt denselben Collector im Lab deterministisch ohne Kernel-conntrack/Privileg laufen. 5 node:test.
- **Container-Entrypoint** (`src/collector/conntrackMain.js`, refactored): Emit-Duplikat entfernt → `createConntrackCollector` + `createIntakeEmitter` + `runCollectorPipeline`. Quelle wählbar: **stdin** (VPS, `conntrack -E`) oder **`CONNTRACK_REPLAY_FILE`** (Lab). Optionaler **Health-Server** (`HEALTH_PORT`, `GET /health` mit Live-Zählern emitted/skipped/invalid/errors) für Container-Liveness.
- **`Dockerfile.collector`** (eigenes Image `nexora-collector:lab`, gleiche Codebasis, eigener CMD + Healthcheck auf `HEALTH_PORT`).
- **Lab-Fixture** `deploy/lab/conntrack-replay.sample.log`: echte `conntrack -E -e DESTROY`-Zeilen (RFC5737-TEST-NET als Ziel, keine realen Hosts), SSH-Bruteforce auf :22/:2222 mit finalen Bytes + ein :53-Egress (out-of-scope → wird verworfen).
- **Compose-Service** `conntrack-collector` in `docker-compose.lab.yml` (`depends_on: intake`, Replay-Loop 2 s, Health :8082). **Smoke grün:** Standalone-Container postet die 4 In-Scope-Flows an den Intake (`emitted` steigt im Loop, `errors=0` → alle 202), Egress verworfen, beide Container `healthy`.

### Added — Kollektoren IDS / FIREWALL / SIEM (je eigener Container)
- **IDS — Suricata** (`src/collector/suricataCollector.js`): parst `eve.json` (event_type `alert`/`flow`) → 5-Tuple + echte Bytes + `normalized.alert` (signature/category/severity/signatureId/mitre). Pflicht-**Asset-Scope** (`assetIps`), JSON-Fehler/Noise → null. domain `ids`, vendor `suricata`. 9 node:test.
- **FIREWALL — OPNsense filterlog** (`src/collector/opnsenseCollector.js`): `parseFilterlog` parst die filterlog-CSV (IPv4 **und** IPv6, tcp/udp/icmp; Syslog-Präfix wird gestrippt) → `normalized.network` (mit `direction`) + `normalized.firewall` (action/interface). **Gleiche Envelope-Form wie der Go-Collector** (dockt an denselben Contract). Optionaler Asset-Scope. domain `firewall`, vendor `opnsense`. 9 node:test.
- **SIEM — Wazuh** (`src/collector/wazuhCollector.js`): parst Wazuh-Alert-JSON → `normalized.detection` (ruleId/level/severity/signature/groups/mitre) + `network` (nur bei echten IPs) + Entities (Angreifer/Ziel/meldender Agent). Level→Severity (0–3 info … 12–15 critical), `minLevel`-Rausch-Gate. domain `siem`, vendor `wazuh`. 9 node:test.
- **Envelope-Builder erweitert** (`buildEnvelope.js`): explizite Allowlist normalisierter Blöcke `network|alert|detection|firewall|agent` (+ `entities`) — Contract deckelt nur `entities`, die Domänen-Blöcke sind optional. Bestehende Kollektoren unverändert.
- **SIEM — Cowrie-Honeypot** (`src/collector/cowrieCollector.js`): parst `cowrie.json` (ein Objekt je Zeile); `COWRIE_EVENT_MAP` mappt detektions-würdige `eventid`s → `normalized.detection` (severity/signature/mitre: `login.failed`→medium/T1110, `login.success`/`command.input`→high/T1078·T1110·T1059, `file_download`→T1105, `direct-tcpip`→T1090). `dstIp` wird auf die bekannte `honeypotIp` verankert, damit das IP-Paar exakt dem conntrack-Flow entspricht — **dieselben Angreifer-IPs in zwei Domänen** hebt das Fusions-Verdikt von `observed` auf `suspicious`. Rausch-Gate (nur Map-Events + Pflicht-`src_ip`). domain `siem`, vendor `cowrie`. `COLLECTOR_KIND=cowrie` (ENV `HONEYPOT_IP`). 10 node:test inkl. Cross-Domain-Eskalations-Nachweis (Flow allein observed → +Cowrie suspicious).

### Added — Geteilte Collector-Runtime + generischer Entrypoint
- **`src/collector/collectorRuntime.js`** (`runCollector({collector, source, env, fetchImpl})`): bündelt Quelle (stdin/Replay) → `runCollectorPipeline` → Intake-Emitter + Health-Server + Live-Zähler. Bewusst **ohne** `process.exit`/globale Effekte → `fetchImpl`+`source` injizierbar, testbar. 2 node:test (Fake-Fetch: Emit-Zähler + Rejection→errors ohne Abbruch).
- **`src/collector/collectorMain.js`**: EIN generischer Entrypoint, `COLLECTOR_KIND` (conntrack|suricata|opnsense|wazuh) wählt das Plugin (ENV: `ASSET_IPS`/`SCOPE_PORTS`/`MIN_LEVEL`). 3 node:test (`buildCollector`). `conntrackMain.js` auf die Runtime umgestellt (dünner VPS-Pipe-Wrapper).

### Added — Persistenz: Postgres-Intake + Transactional Outbox (#3)
- **Migrationen 001–007** in den vereinten Repo geholt (`src/db/migrations/`: tenants · sites · collectors · collector_credentials · intake_events · intake_event_rejections · intake_outbox) + **Migration-Runner** `src/db/runMigrations.js` (idempotent, `IF NOT EXISTS`).
- **Postgres-Intake-Repo** (`src/intake/postgresIntakeRepo.js`): gleiches Interface wie InMemory (`has`/`save`/`get`/`count`). `save()` schreibt `intake_event` **und** zugehörigen `intake_outbox`-Eintrag **atomar in einer Transaktion** (kein Event ohne Outbox); Idempotenz via `ON CONFLICT DO NOTHING` (Race-sicher). 2 Integrationstests (`tests/postgresIntakeRepo.test.js`, skippt ohne `DATAPLANE_TEST_DB_URL`) grün gegen Lab-Postgres.
- Dependency **`pg@8`**.

### Added — Korrelierungs-Engine: Cross-Domain-Fusion + Outbox-Worker + Nexora-Naht (ADR-035)
- **ADR-035** (`docs/adr/decisions.md`): Fusionsschlüssel = ungeordnetes IP-Paar + Zeitfenster, Severity=Max, Verdikt regelbasiert; klare Abgrenzung Fusion (Data Plane) vs. Evidence-Merge (Backend); Persistenz der bounded `normalized`-Projektion.
- **Fusion-Engine** (`src/engine/crossDomainFusion.js`): `fusionKey`/`groupByFusionKey`/`fuse` — verbindet unabhängige Envelopes (ids/firewall/siem) zu einem `FusedIncident` (Domänen, maxSeverity, Verdikt, Byte-Summen, MITRE-Union, Signaturen, Entities, stabile `incidentId`=Hash(fusionKey)). 13 node:test.
- **Outbox-Worker** (`src/engine/outboxWorker.js`): claim → group → fuse → emit; Emit-Fehler → retrying mit exponentiellem Backoff, `maxAttempts` → failed; `failure_reason` nur sichere Codes. Storage-/transport-entkoppelt (Store + emit injiziert). 5 node:test.
- **Outbox-Store**: `inMemoryOutboxStore.js` (Test-Double) + `postgresOutboxStore.js` (claim via `FOR UPDATE SKIP LOCKED`, Envelope-Rekonstruktion aus `intake_events`). 2 node:test (`rowToEnvelope`).
- **Migration 008** (`intake_events`): bounded `normalized` JSONB + `observed_at`/`source_type`/`source_vendor`/`source_instance` — damit der Worker fusionieren kann (kein Raw-Payload; nur die validierte Projektion). `postgresIntakeRepo.save` persistiert sie.
- **HMAC-Incident-Emitter** (`src/engine/incidentEmitter.js`) → POST an den Nexora-Ingress (signiert wie die Backend-Webhooks). 5 node:test. **Worker-Entrypoint** `src/engine/outboxWorkerMain.js` (Pool → Store → Emitter → Loop + Health).
- **Nexora-Ingress (Backend, A4)**: `DataplaneIncidentAdapter` (validate/normalize/toTicketDraft) + `dataplaneSchemas.js` (Joi) + Route `POST /api/v1/dataplane/incidents` (HMAC, idempotent über `incidentId` via `findOpenByOffense`). **Isolierter Pfad** — die Live-Integration-Pipeline (7 Adapter) bleibt unberührt. Jest: 7 Adapter- + 4 Route-Tests (202/200/401/400).
- Damit ist die Pipeline **End-to-End geschlossen**: Quellen → Kollektoren → Intake → Outbox → **Worker/Fusion** → Nexora-Ticket.
- **Window-Re-Fusion** (behebt v1-Batch-Lokalität): der Worker fusioniert je Schlüssel die **vollständige Fenstermenge** (`store.loadWindowEnvelopes(fusionKey)` über die persistierte `normalized`-Projektion), nicht nur den Claim-Batch. Ein spät eintreffendes Signal erreicht so das korrekte Cross-Domain-Verdikt; re-emit upsertet idempotent (gleiche `incidentId`). `parseFusionKey` + InMemory-/Postgres-`loadWindowEnvelopes` (JSONB-Fensterquery + exakter `fusionKey`-Abgleich). +2 node:test. **Live verifiziert:** ein einzelner spät geclaimter Suricata-Alert → `confirmed_malicious` über Alert+Block+SIEM, ohne manuellen Outbox-Reset.
- **Session-Identität / Watermark-Anker** (Slice 4): `fuse` verankert `incidentId`/`fusionKey` am **frühesten Event der Session** (IP-Paar + Bucket des Session-Starts), NICHT am auslösenden Event → dieselbe Session erhält über getrennte Worker-Läufe dieselbe ID; ein spät eintreffendes Event ändert die ID nicht mehr. Behebt die Slice-3-Restschuld (Duplikat-Incidents bei getrennt geclaimten Grenz-Events). +2 node:test.
- **Sliding-Window-Fusion** (Slice 3, behebt Bucket-Boundary-Splitting): `groupBySlidingWindow` verkettet Events desselben IP-Paares, deren Abstand ≤ Fenster ist — UNABHÄNGIG von starren Tumbling-Grenzen (Events 5 s auseinander, aber knapp über einer 5-min-Grenze, landen jetzt in EINER Session; Lücke > Fenster = neue Episode). `loadWindowEnvelopes` lädt nun nach **IP-Paar** mit Guard-Band ±1 Fenster (Postgres) / Bucket-unabhängig (InMemory); der Worker fusioniert die Sliding-Session, die die geclaimten Events enthält. +5 node:test (Primitive + Worker-Grenzfall).

### Added — Lab (Docker-first)
- **`deploy/lab/docker-compose.lab.yml`**: `intake` (:8081) + **vier eigenständige Collector-Container** aus einem Image (`nexora-collector:lab`, `COLLECTOR_KIND` wählt das Plugin): `conntrack-collector` (:8082) · `ids-collector` (suricata, :8083) · `firewall-collector` (opnsense, :8084) · `siem-collector` (wazuh, :8085) + `intake-postgres` (:5433). Lab-Fixtures `suricata-eve.sample.log` · `opnsense-filterlog.sample.log` · `wazuh-alerts.sample.log` (echte Formate, RFC5737-Ziele, keine realen Hosts).

### Security — Data-Plane-Gates (Block B)
- **Credential-Auflösung** (`src/intake/postgresAuthResolver.js`): `x-collector-credential` → SHA-256 → Lookup gegen `collector_credentials` (nur `status='active'`, Collector aktiv) → echte **Pro-Collector-Identität** (collectorId/tenantId/siteId). Klartext wird NIE byteweise verglichen → strukturell timing-sicher. Ersetzt den Dev-Stub (ein Token für alle). 5 node:test.
- **Intake-Boot Postgres** (`src/intake/main.js`): `DATAPLANE_DB_URL` → Migrationen + Postgres-Repo (Outbox) + Credential-Resolver. Ohne DB → InMemory + Dev-Stub **mit lauter Warnung** (kein stiller Datenverlust); in `NODE_ENV=production` ohne DB → **harter Boot-Abbruch**.
- **Rate-Limit** (`src/intake/rateLimit.js`): dependency-freies Fixed-Window je IP (Default 6000/min), als optionale Middleware in `createIntakeApp` (vom Boot injiziert). 3 node:test.
- **Kein stiller Dev-Default mehr** (`collectorRuntime.js`): `COLLECTOR_CREDENTIAL` ist Pflicht — fehlend → `createIntakeEmitter` wirft (statt Fallback auf `dev-collector-token`).

### Status
- **123 node:test** (121 grün + 2 Postgres-Integration grün mit DB), 0 Fehler. Backend: +11 Jest (Dataplane-Ingress).
- Intake live in Docker (:8081), **vier Kollektoren live als eigene Container** (:8082–:8085) — Smoke grün. Postgres live (:5433). Engine (Worker/Fusion/Ingress) + Security-Gates gebaut+getestet, **lokal/nicht deployt**.

### Offen / Nächste Schritte
- **Echtes Nexora-Backend** statt Mock-Ingress in die Lab-Compose → fusionierter Vorfall wird ein echtes Ticket; Frontend für die Vorfall-/Kollektor-Welt.
- **Loop deployen:** intake-Service auf `DATAPLANE_DB_URL` (→ intake-postgres) + Worker-Compose-Service (`outboxWorkerMain`) + **FK-Seed** (tenants/sites/collectors/collector_credentials) — sonst 401 mangels Credential-Datensatz. Dann Live-Docker-Smoke der ganzen Schleife.
- **Echte Quellen statt Replay** (gated): Suricata-`eve.json`-tail · OPNsense-Syslog · Wazuh-`alerts.json`.
- **#1 conntrack-VPS-Deploy** — ✅ **LIVE bis Prod-Ticket** (2026-06-25): externer Honeypot-VPS läuft `conntrack -E` als systemd-Dienst, sendet über bestehenden WireGuard-Tunnel an einen isolierten Intake-Stack; echte Flows als `source_vendor=conntrack` in `intake_events`/`intake_outbox` verifiziert (0 emit-Fehler). Transport: wg allowed-ips + OPNsense-pf-Regel (mit Backup/Rollback). Details operator-privat (`docs/_private/vps-conntrack-rollout-log.md`). **Kette geschlossen (isoliert):** Outbox-Worker + eigene A4-Nexora-API auf nexora (getrennt von `soc_*_prod`) → echte Angreifer-Flows wurden zu `source=dataplane`-Tickets mit strukturierten Netzwerk-Feldern (Verdikt „observed", da conntrack=Telemetrie). **Offen:** Integration ins **Prod-Backend** (soc_api_prod mit A4 neu bauen) → echtes Prod-Ticket; Dienst-Härtung (User+CAP_NET_ADMIN statt root); **PAT-Rotation** (unverändert offen).
- **Restschuld (verengt):** seit Slice 4 ist die ID am Session-Start verankert → getrennt geclaimte Grenz-Events liefern dieselbe ID. Verbleibt nur der seltene Out-of-Order-Fall (ein *früheres* Event trifft NACH der ersten Fusion ein → Anker verschiebt sich, neue ID). Eine echte Stream-Watermark mit Spät-Daten-Toleranz wäre der nächste Grad.
- Fusion-Vorfälle im Analysis-Deck sichtbar machen (Frontend kennt die Kollektor-/Vorfall-Welt noch nicht).
