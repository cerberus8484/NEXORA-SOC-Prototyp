# Nexora SOC Roadmap

## Zielbild

Eine self-hosted SOC-Orchestrierungsplattform, die Tier-1/2-Routinearbeit **reduziert** —
KI-gestützte Analyse, Evidence-Korrelation, Threat-Intel-Anreicherung und FP-Bewertung —,
damit erfahrene Analysten Zeit für Tier-3 gewinnen (Threat Hunting, Detection Engineering,
Incident Response, Use-Case-Entwicklung). Die KI erkennt Muster, bereitet Entscheidungen
vor und kann risikoarme Workflows nach klar definierten Policies unterstützen — ohne
Kontrolle oder Verantwortung aus der Hand zu geben. Kritische Aktionen bleiben
Human-in-the-loop, rollenbasiert freigabepflichtig, auditierbar und rückrollbar.

> **Hardrules** (Details `CONTRIBUTING.md`): keine Funktion ohne Test · kein externer Input
> ohne Validierung · keine Integration ohne Adapter · kein Ticket ohne Traceability ·
> `element.textContent`, nie `innerHTML` mit User-Input · neue Security-/KI-Kontrollen
> default-AUS, serverseitig erzwungen (ADR-009/017–019).

---

## Stand — 2026-06-28

> Live auf nexora.example (10.99.99.75). Backend **278 Test-Dateien / 3562 Tests** grün ·
> Frontend **126 Vitest-Dateien / 1333 Tests** grün · Data-Plane **176 Tests** (174 pass / 2 skip) ·
> E2E **12 Playwright-Specs** in CI · `tsc` 0 · `eslint` 0 Errors. KI-Agent live (Ollama mit
> 512-Token-Limit; Cloud-Provider opt-in). **Aktiver Branch:** `p-phase0-close` (164 Commits vor
> `main`; PR-Merge ausstehend). **Mailserver LIVE** (intern, CT 108, docker-mailserver;
> E-Mail-Notifications end-to-end verifiziert). **Data-Plane-Kette LIVE** (VPS-Kollektoren
> → WireGuard → Intake → Cross-Domain-Fusion → soc_api_prod → Prod-Tickets).
> Detail-Status: [`docs/00-overview/feature-status.md`](docs/00-overview/feature-status.md) ·
> ADRs: [`docs/adr/decisions.md`](docs/adr/decisions.md) · Verlauf: [`CHANGELOG.md`](CHANGELOG.md).

| Phase | Stand | Kern (offen *kursiv*) |
|---|---|---|
| **0** Stabilisierung | 🟢 fertig | Deploys live + verifiziert; KI-FP-Preview-Bug gefixt (2026-06-21); Wazuh-Rauschen (Rule 67027/87702) analysiert + dokumentiert (`docs/detection/rules-catalog.md §14`); Engineer-User-Flow: Backend vollständig, UI-Gap (Rolle nur via DB vergaben — kein Blocker) |
| **1** UI/UX-Produktisierung | 🟢 fertig | Sidebar-Gruppierung (6 Gruppen) + Analysis→KI-Analyse-Tab live; KI-Settings W1+**W2** done (Guardrails/Confidence/HITL-Transparenz + Metrik-Sidebar) |
| **2** Reports/Host-Detail | 🔶 begonnen | Host-Seite (Risk-Score/Timeline/Inventory/CVE/Export) + Report-Textmodell + echter PDF-Export (jsPDF) da; *Incident-/Kunden-Report-Generator* |
| **3** Detection Eng./Use-Case-Dev | 🟢 verdrahtet | UCD voll verdrahtet (Routes + Frontend-Modal + Regel-Export-Vorschau Wazuh/Sigma/Splunk/QRadar); findAll-Pagination erledigt; *E2E-Härtung* |
| **4** Enterprise-Security | 🟢 stark | Settings V1, Passwort-Policy/Ablauf/History, Session-Timeout/Lockout/Mehrfach-Sessions, TLS/IP-Allowlist, Cookie-only+CSRF, Audit; *MFA/TOTP, SSO/SAML, PAT live, Audit-Export, SBOM/Dep-Scans, Install/Upgrade-Guide* |
| **5** Wazuh Companion/FP | 🔶 teilweise | FP-Preview/Workflow + Scoped Exceptions live; *Rausch-Tuning, Wazuh Health Center, FP-Stage-5-Apply-UI* |
| **6** Endpoint Companion Agent | 🔶 Fundament gebaut | **Control-Plane/Provisioning live:** Enrollment-Registry + Token + Node-Credential-Handoff + Heartbeats + Linux-Bootstrap-Installer (read-only, **kein** Apply-/Remote-/Netz-Kanal). Lifecycle (Revoke/Retire/Rate-Limits) lokal (P_PROVISION_SECURITY_1). *Offen: kontrollierter Lab-VM-Test, weiter nur read-only Inventory+Heartbeat* |
| **C** Compliance/NIS2 | 🟢 Basis live | NIS2 Readiness & Evidence (10-Control-Katalog, Assessment, Evidence, Signale) live `5e009c3` — **kein Konformitätsnachweis**. P_NIS2_2 (Incident-Evidence-Verknüpfung + Management-Readiness-Report) **lokal fertig, noch nicht deployt**. *Nächster Block: P_NIS2_3 (vertiefte Nachweisführung)* |
| **7** RAG/Qdrant | 🟢 Basis live | MITRE (697) + Hunt-Katalog in Qdrant, Lernschleife aus geschlossenen Tickets; *weitere Wissensquellen + Quellenanzeige in UI* |
| **8** Monitoring/Ops | 🔶 teils | Prometheus-Metrics + DB-Backup-Cron; *Grafana, Alerting, Provider-Latenz/Health-Sidebar* |
| **9** Produktisierung | 🔶 begonnen | README als Produktseite + Repo aufgeräumt (W1); *Screenshots, Demo-Video, Release `v0.1.0-pilot`* |

---

## Was als Nächstes (Top 5)

1. **Reports MVP (Phase 2)** — Incident-/Kunden-Report-Generator aus Ticket/Evidence/Timeline/
   KI-Analyse (echter PDF-Export ist erledigt).
4. **Enterprise-Security-Lücken (Phase 4)** — MFA/TOTP, Audit-Export, SBOM/Dependency-Scans,
   Install/Upgrade-Guide.
5. **Produktisierung (Phase 9)** — Screenshots, Demo-Video, Install-Guide, Release
   `v0.1.0-pilot`.

---

## Phasen-Detail (Definition of Done je Phase)

Kompakte Ziel- und Abnahmekriterien. Was bereits umgesetzt wurde, steht nicht hier,
sondern in [`CHANGELOG.md`](CHANGELOG.md).

- **Phase 0 — Stabilisierung:** Aktueller Commit deployed; Login/Tickets/Analysis/
  Evidence/Hunts/KI funktionieren; Rollenworkflow geprüft; KI-FP-Preview erzeugt
  zuverlässig Vorschläge; keine Wazuh-Regel wird automatisch geschrieben
  (`WAZUH_FP_APPLY_ENABLED=false`); Tests grün.
- **Phase 1 — UI/UX:** Navigation gruppiert; Analysis hat Analysebereich + KI-Analyse-Tab;
  KI-Agent-Seite klar als Konfiguration (keine operativen KI-Funktionen isoliert im
  KI-Menü); Rollenrechte sichtbar + durchgesetzt; Enterprise-Optik.
- **Phase 2 — Reports/Host-Detail:** Analyst erzeugt aus einem Ticket einen brauchbaren
  Report (Markdown/JSON/PDF, Customer- & Internal-Version); Host-Kontext aus
  Analysis/Hunts/Evidence erreichbar; Evidence exportierbar + nachvollziehbar (Bundle,
  Chain of Custody, Hash/Integrity).
- **Phase 3 — Detection Eng./Use-Case-Dev:** KI erzeugt aus echtem Ticket einen
  Use-Case-Draft; Drafts reviewbar; Engineer/Admin gibt frei; Regel-Export nur als
  Vorschau (Wazuh-XML/Sigma/Splunk/QRadar/YARA); kein Apply ohne Freigabe.
- **Phase 4 — Enterprise-Security:** Keine Fake-Security-Toggles; alles Gespeicherte
  wird erzwungen; Rollen klar; Security-Doku sauber. **Erledigt:** MFA/TOTP, PAT live,
  Audit-Export (CSV+PDF), SBOM/Dependency-Scans (CI `security.yml`), OIDC-Backend.
  **Offen:** OIDC-Login-UI/Vollständigkeit, SAML, Install/Upgrade-Guide.
- **Phase 5 — Wazuh Companion/FP:** Rauschen sichtbar + steuerbar; FP-Ausnahmen nur
  scoped (Rule ID, Agent ID, Reason, Approval); kein globales Rule-Disable; kein Apply
  ohne bewusste Aktivierung; Wazuh Health Center (Manager/Agent/Indexer-Status, noisy
  rules, FP-Kandidaten).
- **Phase 6 — Endpoint Companion Agent:** Eigener Nexora Companion ergänzt Wazuh auf
  Windows (Wazuh-Agent wird **nicht** geforkt): `NexoraAgentService.exe` (Telemetrie) +
  `NexoraTray.exe` (Status/CVE-Benachrichtigungen). Remote Actions nur über signierte
  Queue mit Command-Templates (keine freie Shell), Approval-Gate, Audit.
- **Phase 7 — RAG/Qdrant:** Qdrant läuft; Dokumente indexiert (MITRE, Detection Library,
  Use Cases, Playbooks, vergangene Incidents, FP-Entscheidungen); KI-Antworten zeigen
  Quellen; keine Halluzination ohne Evidence; RAG optional abschaltbar.
- **Phase 8 — Monitoring/Ops:** Betreiber sehen Systemzustand sofort (API/DB-Health,
  Queue-/Webhook-Metrics, KI-Provider-Latency, Integration-Health, Backup-Status);
  Alerts bei Ausfällen; Metriken dokumentiert.
- **Phase 9 — Produktisierung:** README professionell · Screenshots · Demo-Video ·
  Release `v0.1.0-pilot` · Install-Guide · klare Grenzen (kein SIEM/EDR-Ersatz,
  sondern SOC-Orchestrierung & Analyst-Copilot).

> **Open Source zuerst.** Nexora ist und bleibt Open Source. Was später kommerziell
> daraus wird, ist offen („mal sehen") und **nicht Teil dieser Roadmap**.

---

## Historie

Umgesetzte Wellen und Detailänderungen je Release stehen in [`CHANGELOG.md`](CHANGELOG.md)
(Format angelehnt an *Keep a Changelog*). Dieses Dokument hält nur das Zielbild, den
aktuellen Phasenstand und die nächsten Schritte.
