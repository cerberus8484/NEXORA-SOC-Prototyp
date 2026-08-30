# Server-seitige Implementierung — Umsetzungsplan

> Dieses Dokument beschreibt was für den produktiven Betrieb des  
> SOC Analyst Notebook / Enterprise Ticket Orchestration Systems  
> in einer Unternehmensumgebung benötigt wird.

---

## 1. Was du intern klären / beantragen musst

### 1.1 Mit IT-Infrastruktur / Systemadministration

| Was | Warum | Wer |
|---|---|---|
| **Server / VM** (Linux, min. 4 vCPU / 8 GB RAM) | Backend + Datenbank | IT-Infra |
| **Internes DNS** (z.B. `soc.example.com`) | Erreichbarkeit im Netz | IT-Infra |
| **TLS-Zertifikat** (intern oder Let's Encrypt via ACME) | HTTPS Pflicht | IT-Infra / PKI |
| **Firewall-Freigabe** (Port 443 intern, keine externe Exposition) | Netzwerk-Zugang | IT-Sec / Infra |
| **Datenbankserver** oder freigegebene PostgreSQL-Instanz | Persistenz | IT-Infra |
| **Container-Plattform** (Docker auf VM) oder vorhandenes Kubernetes | Deployment | IT-Infra |
| **Backup-Konzept** für PostgreSQL-Daten | BCDR | IT-Infra |
| **Log-Forwarding** (Syslog / SIEM) | Monitoring / Audit | IT-Sec |

### 1.2 Mit IT-Security / CISO

| Was | Warum |
|---|---|
| **Security Review** des Deployments | Pflicht vor Produktivbetrieb |
| **Netzwerksegmentierung** — in welches Segment kommt der Server? | SOC-Netz vs. allgemeines Netz |
| **Secrets Management** — wie werden Passwörter/API-Keys gespeichert? | Vault, Ansible Vault, Env-Secrets |
| **Vulnerability Scanning** auf dem Docker-Image | Trivy, Grype oder vorhandenes Tool |
| **Penetration Test / Code Review** bei Enterprise-Rollout | Je nach internem Prozess |
| **DSGVO-Check** — welche Personendaten werden gespeichert? | Analystennames, Benutzernamen aus Incidents |

### 1.3 Mit dem Management / Projektverantwortlichem

| Was | Warum |
|---|---|
| **Budget** für Server, ggf. externe Dienste | Planung |
| **Verantwortlichkeit** — wer ist Owner dieses Systems? | Betrieb, Updates, Incidents |
| **Change-Management-Prozess** — wie werden Updates eingespielt? | CAB-Prozess, Wartungsfenster |
| **SLA-Erwartungen** — wie kritisch ist das System? | Ausfallzeiten, RTO/RPO |
| **Genehmigung für externe API-Calls** (VirusTotal, AbuseIPDB) | Evtl. Proxy-Freigabe nötig |

---

## 2. Technischer Stack

### Backend
```
Node.js 20 LTS (LTS = stabiler, Long-Term-Support)
├── Express.js      — HTTP-Server / REST API
├── Helmet.js       — Security-Header (CSP, HSTS, etc.)
├── express-validator — Input-Validierung
├── winston         — Structured Logging
├── dotenv          — Environment-Konfiguration
└── node-postgres (pg) — PostgreSQL Client
```

### Datenbank
```
PostgreSQL 16
├── Für Produktion: dedizierte Instanz oder Managed Service
└── Für Entwicklung: Docker-Container
```

### Authentifizierung
```
Stufe 1 (schnell): JWT + lokale User-Tabelle
Stufe 2 (Enterprise): LDAP / Active Directory via ldapjs
Stufe 3 (Ideal): SSO / SAML / OAuth2 (Azure AD, Keycloak)
```

### Deployment
```
Docker + Docker Compose
└── nginx (Reverse Proxy + TLS-Termination)
    └── Node.js App (Container)
        └── PostgreSQL (Container oder extern)
```

### Optionales (ab Phase 8)
```
Redis oder pgmq    — Job-Queue für Adapter
Prometheus + Grafana — Metrics / Monitoring
```

---

## 3. Server-Anforderungen

### Minimum (Pilotbetrieb / kleines Team)
```
CPU:  2 vCPU
RAM:  4 GB
HDD:  50 GB SSD
OS:   Ubuntu 22.04 LTS oder RHEL 8+
```

### Empfohlen (Produktiv, bis 20 Analysten)
```
CPU:  4 vCPU
RAM:  8 GB
HDD:  100 GB SSD
OS:   Ubuntu 22.04 LTS oder RHEL 8+
```

### Netzwerk
```
Intern erreichbar:   Port 443 (HTTPS via nginx)
Nicht extern:        Kein direkter Internetzugang auf den App-Port
Datenbankport:       5432 nur intern / localhost
```

---

## 4. Verzeichnisstruktur (Ziel-Repository)

```
soc-notebook/
├── frontend/
│   └── index.html              ← Bestehende App (angepasst für Backend)
│
├── backend/
│   ├── src/
│   │   ├── api/                ← REST-Endpunkte
│   │   │   ├── tickets.js
│   │   │   ├── payloads.js
│   │   │   ├── usecases.js
│   │   │   └── health.js
│   │   ├── services/           ← Business Logic
│   │   │   ├── ticketService.js
│   │   │   └── templateService.js
│   │   ├── db/                 ← Datenbank
│   │   │   ├── migrations/
│   │   │   └── repositories/
│   │   ├── adapters/           ← Externe Systeme (Phase 7+)
│   │   │   ├── base/
│   │   │   ├── servicenow/
│   │   │   ├── qradar/
│   │   │   └── splunk/
│   │   ├── auth/               ← Authentifizierung (Phase 6)
│   │   └── middleware/         ← Validation, Auth, Logging
│   ├── tests/
│   ├── .env.example
│   └── package.json
│
├── docker/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── nginx.conf
│
├── docs/
│   └── architecture/
│
├── ROADMAP.md
└── README.md
```

---

## 5. Schritt-für-Schritt Umsetzung (nach Phasen)

### Phase S1 — Frontend Security (jetzt, kein Server nötig)
```
1. innerHTML-Stellen inventarisieren und ersetzen
2. XSS-Testpayloads dokumentieren und testen
3. Input-Längen-Limits einführen
4. CSP als Meta-Tag vorbereiten
→ Ergebnis: Sicheres Frontend, bereit für Backend-Anbindung
```

### Phase 2 — Testbasis (kein Server nötig)
```
1. Jest einrichten
2. Security-Tests für XSS-Payloads schreiben
3. Rendering-Tests schreiben
→ Ergebnis: Automatisierte Regression-Tests
```

### Phase 3 — Backend Skeleton (Server benötigt)
```
Benötigt: VM / Server, Node.js, Docker
1. Express.js App aufsetzen
2. /health Endpunkt
3. Structured Logging (winston)
4. Env-Konfiguration (.env)
5. Docker-Image bauen
6. nginx + TLS konfigurieren
→ Ergebnis: Erreichbarer Server mit HTTPS
```

### Phase 4 — Domain Model
```
1. Internes Ticket-Schema definieren
2. Payload-Schema definieren
3. External-Links-Tabelle definieren (Traceability)
4. Validierungs-Schemas (express-validator)
```

### Phase 5 — PostgreSQL
```
Benötigt: PostgreSQL-Instanz
1. Migrationen schreiben (db-migrate oder Flyway)
2. Repositories implementieren (CRUD)
3. Transaktionen für kritische Operationen
4. Indexe für Suche / Performance
```

### Phase 6 — Auth / RBAC / Audit
```
1. User-Tabelle + bcrypt-Passwörter
2. JWT-Login / Refresh-Token
3. Rollen: Analyst, Teamlead, Viewer
4. Middleware für Rechteprüfung
5. Audit-Log-Tabelle (wer hat was wann geändert)
→ Optional: LDAP/AD-Integration
```

---

## 6. Was du für das erste Gespräch mit IT brauchst

### Zusammenfassung für IT-Infrastruktur (1 Seite):
```
Wir betreiben ein internes Web-Tool für SOC-Analysten.
Es läuft auf einem Linux-Server als Docker-Container.
Benötigt wird:
- 1 VM (Ubuntu 22.04, 4 vCPU, 8 GB RAM, 100 GB SSD)
- Internes DNS: soc.example.com
- TLS-Zertifikat (intern)
- Firewall: Port 443 intern erreichbar
- PostgreSQL-Datenbank (lokal auf VM oder vorhandene Instanz)
- Backup der /var/lib/postgresql Daten
- Kein Internetzugang für den App-Port
```

### Sicherheitsrelevante Punkte für IT-Security:
```
- Alle Daten bleiben intern (kein Cloud-Speicher)
- Externe API-Calls (VirusTotal, AbuseIPDB) nur durch Analysten manuell
- Auth via JWT, später LDAP/AD
- Audit-Log für alle Änderungen
- Security-Header via Helmet.js
- CSP aktiv
- kein Inline-JavaScript
- Dependency-Scanning via npm audit
- Docker-Image via Trivy scannen
```

---

## 7. Offene Fragen (intern klären)

- [ ] Welche AD-Gruppe soll Zugang haben?
- [ ] Gibt es eine bestehende PostgreSQL-Instanz die wir nutzen können?
- [ ] Gibt es eine interne Docker-Registry?
- [ ] Wie läuft das Change-Management für Updates?
- [ ] Welche Monitoring-Lösung ist vorhanden? (Grafana, Zabbix, ...)
- [ ] Gibt es eine interne CA für TLS-Zertifikate?
- [ ] Ist ein Proxy für externe API-Calls (VT, AbuseIPDB) nötig?
- [ ] DSGVO: Welche Daten dürfen gespeichert werden? (Analystenname, Benutzernamen aus Incidents)
- [ ] Wer ist technischer Owner / Ansprechpartner für den Server?

---

## 8. Zeitschätzung (Einzelperson, nebenbei)

| Phase | Aufwand | Kumuliert |
|---|---|---|
| S1 Security Frontend | 1–2 Tage | 2 Tage |
| Tests | 1 Tag | 3 Tage |
| Backend Skeleton + Docker | 2–3 Tage | 6 Tage |
| Domain Model + DB | 2–3 Tage | 9 Tage |
| Auth / RBAC / Audit | 3–4 Tage | 13 Tage |
| 1. Adapter (z.B. QRadar) | 3–5 Tage | 18 Tage |
| Deployment + TLS + Monitoring | 2 Tage | 20 Tage |

> Realistisch als Nebenprojekt: **2–4 Monate bis produktiver Pilotbetrieb** (Phase 1–6)  
> Vollständige Integration aller Adapter: **6–12 Monate**
