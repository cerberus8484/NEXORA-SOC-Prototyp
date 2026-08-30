# Offene Punkte — was noch zu tun ist (Stand 2026-06-26)

Konsolidierte „TODO/Changelog"-Liste aller **noch offenen** Arbeiten — zusammengeführt aus
`master-roadmap-2026-06-26.md`, `hardening-und-collector-plan-2026-06-26.md`, dem Session-Handoff
und dem Agent-gestützten Security-/Seiten-Audit. Erledigtes steht im `CHANGELOG.md`.

**Stand:** Branch `p-phase0-close` HEAD `6ac15fe1` (gepusht). Prod läuft live vom Branch (nexora-VM).
**Legende:** 🧑‍💻 Operator/Ops (außerhalb Code) · 🤖 von mir baubar · ⏳ in Arbeit/teilweise.

---

## P0 — Hygiene / sofort (billig, hoher Risikowert)
- [ ] 🧑‍💻 **PR #2 mergen** (`p-phase0-close → main`, ~150 Commits) → `main` einholen + **Branch-Schutz** reaktivieren. Prod läuft vom Feature-Branch, `main` weit hinterher.
- [ ] 🧑‍💻 **PAT `ghp_…` widerrufen** (GitHub-Web) — geleaktes Token im Prod-Git-Remote.
- [ ] 🧑‍💻 **Session-Backup off-machine** kopieren (gitignored = sonst weg: SSH-Keys, alle `.env`, `docs/_private/`).
- [ ] 🧑‍💻 **`AUDIT_IP_SALT`** (≥32 zufällig) in Prod-ENV setzen → danach 🤖 eskaliere ich die Warnung in `validateEnv.js` zum Fail-fast (wie `JWT_SECRET`). *(Code-Warnung ist live, `e9b7b737`.)*

## Security-Backlog (Rest aus dem Audit)
- [ ] 🧑‍💻 **S4 final scharf:** Host-Keys von OPNsense/Cowrie/Wazuh fingerprinten → `known_hosts` in den `collector-hub`-Container mounten → `COLLECTOR_SSH_STRICT_HOST_KEY=yes`. *(Code-Option ist da, `a2faedca`; Default bleibt `accept-new`.)*
- [ ] 🤖🧑‍💻 **S6 Vite-Major-Migration** (`vite@8`, breaking, kaskadiert auf vitest) — eigener Branch, eigene Session. Kurzfristig Dev-Server nie auf `0.0.0.0`.
- [ ] 🤖 **`WAZUH_TLS_REJECT_UNAUTHORIZED`** in Prod zum Fehler eskalieren (heute nur Warnung).
- [x] ~~S1 Ollama-TLS · S2 Login-Audit · S5 document.write · Helmet-CSP · OIDC-Discovery-TTL · S3-Warnung · S4-ENV-Option · /metrics-Token · CSRF /dataplane · Ollama-Allowlist geteilt · Wazuh-Deploy-SSH~~ ✅ erledigt.

## P1 — abgegrenzte Features
- [ ] 🤖 **#6 OIDC: SAML** (separater Block: `node-saml`, SP-Zertifikat, ACS-Endpoint, IdP-Metadata). *(OIDC-In-UI-Admin Backend+Frontend ist fertig.)*
- [ ] 🤖🧑‍💻 **Kollektoren: Hub↔Backend-Live-Status-Brücke** — echter Prozessstatus (running/failed/throughput). Der Hub hat `status()`, läuft aber als eigener Container → Status-HTTP-Endpoint am Hub (Backend proxyt, SSRF-Guard) **oder** DB-Heartbeat. Deploy-/Netz-Entscheidung. *(Read-only Ingestion-Aktivität `/collectors` ist gebaut.)*
- [ ] 🤖 **Kollektoren-Tuning** (enable/disable je Quelle, nicht-geheime Tuning-Werte) — braucht Hub-Reload-Pfad. SSH-Secrets bleiben Datei/ENV.
- [ ] 🤖 **Korrelatoren-Edit-UI** — Backend-Admin (Registry + Apply-Channel, gated) existiert; nur Frontend-Edit/Approval-UI + ggf. produktives `CONFIG_APPLY_ENABLED=true` (Sicherheitsentscheidung) fehlen.
- [ ] 🤖 **#7 OPNsense-WAN-Scope** — Pull-Quelle pausiert (= LAN-Broadcast-Rauschen). Braucht extern-eingehende-Blocks-Filter + Broadcast/Multicast-Ausschluss. `sshTail`-Filter-Capability steht.
- [ ] 🤖 **#8 Update-Pull / Desired-State (ADR zuerst)** — jedes System holt Config/Version aus Nexora; baut auf Apply-Channel + Enrollment. Strategischer „von Nexora bis OS-Ebene"-Schritt.
- [ ] 🤖 **Keyboard-Shortcuts** — erledigt (`f199cf0e`), nur noch Browser-Verifikation offen.

## P2 — größere Blöcke (eigene Pläne)
- [ ] 🤖 **Hunt-Pause** → async/resumable Runner-Re-Architektur (heute ehrlich `501`).
- [ ] 🤖🧑‍💻 **Hosts-Enrollment** (Wazuh-write-Entscheidung) + **Agent-Commands** (Remote-Command-Kanal, Scope-Entscheidung).
- [ ] 🤖 **QRadar echter API-Client** (heute Inbound real, kein Outbound) · **ExternalTicketAdapter** (nur Vertrag) · **Credential-Rotation** (Provisioning) · **NIS2 P_NIS2_3**.
- [ ] ⏳ 🤖 **Analyst-Workflow-Bündel** — ehrliche „disabled"-Buttons mit gleicher Wurzel. **Erledigt (2026-06-27):** „Add as Note" (KI-Einschätzung → Ticket-Notizen) · „Create Follow-up Ticket" (verknüpft via `parentId`) · „Mark as Important" (`priority='high'`) · „Needs More Context" (Re-Propose mit Analyst-Hinweis), alle TDD. **Offen (brauchen neues Subsystem):** „Assign Playbook" · Evidence-Export Redaction/Save-Template/Schedule · Notification-Kanal-Einstellungen · Audit-Report-Export. Siehe [abarbeitungsplan-2026-06-27.md](abarbeitungsplan-2026-06-27.md).
- [ ] 🤖 **KI P19c/d** — lokales Modell + kontinuierliches Lernen (Vollausbau, ~40 %).
- [ ] 🤖🧑‍💻 **Horizontale Skalierung / HA** — mehrere Outbox-Worker/Hubs + Intake-Replicas (`SKIP LOCKED` vorbereitet) + Redis-Rate-Limit + signierte Updates.

## P3 — Horizont
- [ ] Auto-Response-Actions (isolate host) · Multi-SIEM-Unified-Dashboard · Mobile-App · SOAR (bidirektional) · Multi-Tenancy · Zero-Trust-Access (Track vorbereitet: ADR-038) · ML-Model-Training (MLE-Track vorbereitet: ADR-039).

## Doku- & Verifikations-Schuld
- [ ] 🤖 **`feature-status.md` entstauben** — unterschätzt systematisch den Ist-Stand (stale Deploy-Flags, OIDC fälschlich „offen", Data-Plane fehlt in den Tabellen).
- [x] ~~**`conntrackCollector.js` entfernen**~~ — **NICHT entfernen** (verifiziert 2026-06-27): ist ein wählbarer `COLLECTOR_KIND` (`collectorMain.js:33 case 'conntrack'`) neben suricata/opnsense/wazuh/cowrie, inkl. Test. Entfernen würde den `conntrack`-Kind brechen. „Abgelöst durch Suricata-flow" ist eine Betriebs-Präferenz, kein Dead-Code.
- [ ] 🧑‍💻 **Browser-Verifikation** von OIDC-Admin-UI, Keyboard-Shortcuts, Kollektoren-Seite — bräuchte den Docker-Dev-Stack mit Login (keine Preview-Config im Projekt).
- [ ] **Doku-Pflege:** bei jedem Feature Status gegen den Code prüfen (nicht gegen alte Flags).

---

## Operator-Aktionen kompakt (was nur du tun kannst)
1. PR #2 mergen + Branch-Schutz · PAT widerrufen · Off-box-Backup.
2. `AUDIT_IP_SALT` setzen → mir Bescheid (dann Fail-fast).
3. `known_hosts`-Rollout für die Collector-SSH → `COLLECTOR_SSH_STRICT_HOST_KEY=yes`.
4. Entscheidungen: Hub-Status-Brücke (HTTP vs DB-Heartbeat) · Hosts-Enrollment (Wazuh-write) · Agent-Commands-Scope · Apply-Channel scharfschalten.

## Mein Vorschlag für die nächste Bau-Session (prerequisite-frei, 🤖)
1. **Korrelatoren-Edit-UI** oder **Analyst-Workflow-Bündel** (sichtbarer Nutzen, kein Ops-Block).
2. **SAML** (eigener, klar abgegrenzter Block).
3. **Doku-Schuld** (feature-status + conntrackCollector) als schneller Aufräum-Durchlauf.
