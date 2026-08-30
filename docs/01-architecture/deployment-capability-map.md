# Deployment Capability Map — Bauplan des Modulkatalogs

> **Zweck.** Diese Karte definiert, welche IT-Security-Bausteine das **Deployment Center** von
> Nexora **selbst ausrollen** (`DEPLOY`), welche es nur **anbindet/onboardet** (`INTEGRATE`) und
> welche **bereits vorhanden** sind (`HAVE`). Sie ist der Bauplan für den Modulkatalog (jede
> `DEPLOY`-Zeile wird ein Modul mit Control-Adapter + Verbindung).
>
> **Kontext (Vision, 5 Säulen):** Greenfield (nacktes Netz → alles selbst bauen) · Brownfield
> (in Bestandsnetze flexibel einklinken) · Unify (OSS **und** kommerziell unter einem Dach) ·
> Lifecycle/Day-2 (Update-Feeds + Knopfdruck-Update, gestuft Dev→Prod) · Dev-Umgebung (isoliert).
>
> **Status:** v1 (2026-07-03) — aus Domänenwissen + Lab-Bestand. Tool-Versionen/Marktzahlen bei
> Bedarf gegen aktuelle Quellen validieren. Zum Diskutieren/Erweitern gedacht.

## Legende

| Marker | Bedeutung |
|---|---|
| **HAVE** | im Lab bereits live (Nexora bindet es schon an) |
| **DEPLOY** | Ziel: Nexora rollt es aus (Modul im Deployment Center) |
| **INTEGRATE** | Nexora bindet ein bestehendes System an (kein Deploy) |
| **Adapter** | Control-Mechanik für Deploy/Ops: `api` · `ssh-systemd` · `docker` · `proxmox` · `ansible` |

---

## 1. Detection & Analyse (das Herz des SOC)

| Kategorie | Rolle | Kommerziell (Referenz) | Open Source (reif) | Nexora |
|---|---|---|---|---|
| **SIEM / Log** | Sammeln, Suchen, Alarmieren | Splunk, IBM QRadar, MS Sentinel, Elastic Sec | **Wazuh**, Graylog, OpenSearch/Elastic, Security Onion | **HAVE** Wazuh · **INTEGRATE** QRadar/Splunk · *DEPLOY-Kandidat: Wazuh-Manager* |
| **Log-Collection / Shipping** | Events von Hosts einsammeln | Splunk UF, Cribl | **Wazuh-Agent**, Winlogbeat/Filebeat, **Fluent Bit**, Vector, NXLog | **HAVE** Wazuh-Agent · **DEPLOY** Windows/Linux-Client (Agent-Enrollment) |
| **Windows Event Collection** | zentrale Win-Event-Sammlung | — | **WEC/WEF** (nativ), Winlogbeat | **HAVE** WEC01 · **DEPLOY** WEC-Rolle auf Win-Host |
| **EDR / Endpoint** | Endpoint-Telemetrie & Response | CrowdStrike, MS Defender, SentinelOne | **Wazuh** (FIM/Rootcheck), **Velociraptor**, OSSEC, ClamAV | **HAVE** Wazuh+ClamAV · **INTEGRATE** Defender · *DEPLOY: Velociraptor* |
| **Netzwerk-IDS/IPS** | Netzwerk-Angriffe erkennen | Palo Alto, Cisco Firepower, Darktrace | **Suricata**, **Zeek**, Snort | **HAVE** Suricata (Sensor + OPNsense-IPS) · **DEPLOY** Suricata/Zeek-Sensor |
| **Korrelation / Detection-Engine** | Events → Findings verknüpfen | (SIEM-intern) | **Sigma**, eigene Engine, Correlation-Rules | **HAVE** eigener Korrelator + Sigma-Mapping · **DEPLOY** Korrelator-Node |

## 2. Netzwerk & Perimeter

| Kategorie | Rolle | Kommerziell | Open Source | Nexora |
|---|---|---|---|---|
| **Firewall / NGFW** | Perimeter, Segmentierung | Palo Alto, Fortinet, Check Point | **OPNsense**, pfSense, VyOS | **HAVE** OPNsense · **DEPLOY** OPNsense-VM (Schnitt #1 existiert!) |
| **WAF** | L7-App-Schutz | F5, Imperva, Cloudflare | **BunkerWeb**, ModSecurity+CRS, Coraza | **HAVE** BunkerWeb · **DEPLOY** WAF-Container |
| **Reverse-Proxy / Ingress** | TLS-Termination, Routing | — | nginx, Traefik, Caddy | **HAVE** nginx (prod) · *DEPLOY optional* |

## 3. Identity, PKI & Secrets

| Kategorie | Rolle | Kommerziell | Open Source | Nexora |
|---|---|---|---|---|
| **Directory / DC** | AD, Auth-Quelle | Microsoft AD, Okta | **Samba-AD**, FreeIPA | **HAVE** DC01 (Win-AD) · **DEPLOY** DC-Rolle (Win) / Samba-AD (Linux) |
| **IdP / SSO** | OIDC/SAML | Okta, Entra ID | **Keycloak**, Authentik, Authelia | **HAVE** OIDC-Client-Support · **DEPLOY** Keycloak |
| **PKI / CA** | interne Zertifikate, ACME | Venafi, DigiCert | **step-ca**, EJBCA, cfssl | **HAVE** step-ca · **DEPLOY** step-ca-Node |
| **Secrets** | zentrale Geheimnisse | CyberArk, HashiCorp Vault (ent) | **Vault** (OSS), OpenBao, Infisical | *DEPLOY-Kandidat: Vault/OpenBao* |

## 4. Intel, Response & Deception

| Kategorie | Rolle | Kommerziell | Open Source | Nexora |
|---|---|---|---|---|
| **Threat Intelligence** | IOC-Anreicherung, Feeds | Recorded Future, Mandiant | **MISP**, **OpenCTI**, VirusTotal/AbuseIPDB (API) | **HAVE** VT+AbuseIPDB · *DEPLOY: MISP/OpenCTI* |
| **SOAR / Playbooks** | Automatisierung | Splunk SOAR, Palo XSOAR | **Shuffle**, **Tines** (free tier), n8n | *DEPLOY-Kandidat: Shuffle* |
| **Case-Mgmt / IR** | Incident-Bearbeitung | ServiceNow SIR | **TheHive** + **Cortex** | **HAVE** eigenes Ticketing · **INTEGRATE** ServiceNow/OTRS |
| **Deception / Honeypot** | Angreifer ködern | TrapX, Illusive | **Cowrie**, **T-Pot**, OpenCanary | **HAVE** Cowrie (intern + VPS) · **DEPLOY** Honeypot-Node |

## 5. Vuln, Assets & Compliance

| Kategorie | Rolle | Kommerziell | Open Source | Nexora |
|---|---|---|---|---|
| **Vulnerability-Mgmt** | Schwachstellen-Scan | Tenable, Qualys, Rapid7 | **OpenVAS/Greenbone**, Trivy (Container), Nuclei | *DEPLOY-Kandidat: Greenbone/Nuclei* |
| **Asset-Inventar** | CMDB, Sichtbarkeit | ServiceNow CMDB | **NetBox**, GLPI, (Wazuh-Inventory) | **HAVE** Host-Inventar (Wazuh+manuell) · *DEPLOY: NetBox* |
| **Compliance** | Readiness/Nachweis (NIS2 …) | (GRC-Suites) | eigene Checks, OpenSCAP | **HAVE** NIS2-Readiness-Seite |

## 6. Plattform-Backbone (macht Nexora zur Control-Plane)

| Kategorie | Rolle | Kommerziell | Open Source | Nexora |
|---|---|---|---|---|
| **Data-Plane / Event-Bus** | Ingest→Korrelation-Pipeline | Kafka (Confluent) | **Data-Plane-Knoten** (eigen), Kafka, NATS, Redpanda | **HAVE** Collector-Hub + Intake · **DEPLOY** Data-Plane-Node |
| **LLM / KI** | Triage-Assistent, RAG | Anthropic, OpenAI, Google | **Ollama** (+ llama3.2), lokale Modelle | **HAVE** Ollama · **INTEGRATE** Cloud-Provider (opt-in) |
| **Vektor-DB (RAG)** | MITRE/Hunt-Wissen | Pinecone | **Qdrant**, Weaviate, pgvector | **HAVE** Qdrant · **DEPLOY** Qdrant-Node |
| **Metriken / Dashboards** | Betriebssicht | Datadog | **Grafana** + Prometheus | **HAVE** Grafana · **DEPLOY** Grafana/Prometheus |
| **Backup / Recovery** | Wiederherstellbarkeit | Veeam, Rubrik | **OpenSourceBackup** (eigen), Restic/Borg, Proxmox-vzdump | **HAVE** Proxmox-Backups · *INTEGRATE/DEPLOY: OSB* |
| **Provisioning / IaC** | Nodes ausrollen | — | **Ansible**, Terraform, cloud-init, Proxmox-API | **HAVE** Node-Enrollment · **DEPLOY-Basis** (Golden-Templates) |

---

## Deploy-vs-Integrate — Entscheidungslogik

Ein Baustein wird **DEPLOY**, wenn er (a) selbst-hostbar (OSS/Appliance), (b) im Lab/Netz ausrollbar
(VM/Container/Agent) und (c) über einen **Control-Adapter** steuerbar ist. Er bleibt **INTEGRATE**,
wenn er (a) extern/kommerziell/gemanagt ist oder (b) bereits im Bestandsnetz existiert (Brownfield).

**Jeder DEPLOY = Modul mit drei Teilen** (deckt sich mit der Service-Restart-Architektur):
`Modul-Definition` + `Control-Adapter` (api/ssh-systemd/docker/proxmox/ansible) + `Ziel + Verbindung`.
Beim erfolgreichen Deploy registriert sich der Dienst automatisch als **verwaltbar** (Status, Restart,
Update) → Ops & Lifecycle „for free".

## Ziel-Node-Auswahl (Brownfield-tauglich)

Jeder Deploy braucht ein **Ziel**: `proxmox-node` (pve/.100) · `existing-host` (SSH) · `container-host`
(Docker/LXC) · `k8s` (später). Auswahl in der Deploy-Konfig → Adapter passend.

## Lab-realistische Reihenfolge (erste Deploy-Module)

1. **OPNsense-VM** (Firewall) — *Schnitt #1 existiert bereits*, nur Golden-Template + Live-Smoke.
2. **Linux-Client** (Wazuh-Agent-Enroll, `ssh-systemd`/`ansible`) — kleinster echter Deploy, Brownfield-tauglich.
3. **Windows-Client** (Agent + WEC, auf Cluster-Partner `.100`) — der vom User genannte Testfall.
4. **Kollektor / Sensor** (Suricata/Zeek als Container/LXC) — Detection-Fläche.
5. **Korrelator-Node** + **Data-Plane-Node** — Backbone (bereits in-repo, „nur" deploybar machen).
6. Danach Breite: MISP/OpenCTI, Shuffle, Keycloak, Qdrant, Grafana …

## Lifecycle / Day-2 (Säule 4) — pro Modul

Jedes deployte Modul bekommt: **Versions-/Update-Feed** (GitHub-Releases/RSS je Tool) · **Update-
Knopf** · **gestuftes Rollout** (erst Dev-Umgebung, dann Prod) · Restart/Stop/Start über denselben
Control-Adapter. → Deploy + Betrieb + Update aus einem Fluss.

---

## Nächste Schritte (Phase 3)

- [ ] Diese Map mit dem User schärfen (Prioritäten, fehlende Tools).
- [ ] `DEPLOY`-Zeilen in eine **Modul-Katalog-Datenstruktur** gießen (id, kategorie, adapter, targets, connectionRef).
- [ ] **Ziel-Node-Auswahl** ins Deploy-UI (Konfig).
- [ ] Erst-Deploy **Linux-Client** (kleinstes echtes Modul) end-to-end.
