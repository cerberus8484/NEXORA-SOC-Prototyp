# Hosts (`/hosts`)

## Zweck
Asset- und System-Inventar der registrierten Wazuh-Agenten: Heartbeat-Status, Inventory-Vollständigkeit, berechnet Risk-Score basiert auf Heartbeat/Inventory/CVE-Daten. **Ehrlich:** nur echte Daten aus Wazuh (API, Indexer, syscollector, Posture).

## Rolle & Sichtbarkeit
- **Mindest-Rolle:** Keine Einschränkung (alle Rollen sehen diese Seite)
- **Nav-Gruppe:** Monitoring — Betrieb & Beobachtung

## Funktionen

- **KPI-Reihe (5 Kacheln):**
  - **Total Hosts:** absolute Zahl Agenten
  - **Online Hosts:** online + % (grün)
  - **Offline Hosts:** offline + % (rot)
  - **Heartbeat Issues:** delayed + " (gelb)
  - **Inventory Complete:** complete-Status + % (blau)

- **Filter-Bar (6 + expanded):**
  - **Customer:** Dropdown (aus Wazuh-Agent-Gruppen)
  - **Source / Platform:** wazuh (enabled), splunk/qradar/soar/manual (disabled/kommend)
  - **Operating System:** Dropdown aus Wazuh OS-Namen
  - **Host Status:** Online / Offline
  - **Heartbeat Status:** Healthy / Delayed / Offline
  - **Risk Level:** Low / Medium / High / Critical
  - **Search:** Hostname, IP, User, Domain, OS, Agent-ID — live Filter
  - **Quick Chips:** "● Online only", "⚠ With issues", "⊘ Offline only"
  - **"More Filters":** erweitert um Inventory Status
  - **"Clear Filters":** setzt alle auf Defaults

- **Hosts-Tabelle (links 2/3):**
  - Spalten: Hostname (mit Heartbeat-Dot), Customer, Source (Badge), OS, IP, Last Heartbeat, Heartbeat-Status, Inventory-Status, Risk (monospace fettgedruckt, farbcodiert), Agent-Version
  - Anklickbar → wählt Host für Detail-Ansicht
  - Gesamtzeile gefärbt wenn gewählt (success-soft-Hintergrund, linker Rand accent)
  - Footer: "X von Y Hosts"

- **Host-Detail-Panel (rechts 1/3):**
  - 5 Tabs: Overview · Inventory · Network · Security · Timeline
  
  1. **Overview Tab:**
     - KV-Blöcke: Hostname, Agent ID, OS, Kernel, CPU, RAM, Disk, Installed Software, Open Ports, Last User, Domain, MAC, IP-Adressen
     - Transparent Risk Badge (mit Tooltip) — erklärt, warum das Risiko so ist (Signale: offline, alte Heartbeat, CVEs, SCA-Fehler)
     - Heartbeat Card: Last Heartbeat, Expected Interval, Status-Badge, Sparkline (wenn 24h-Daten vorhanden, sonst Hinweis)
     - Risk Summary (wenn riskScore vorhanden): RiskRing (Visualisierung), Score/100, Risk Level, Risk Factors (Bulleted List)
     - Vulnerabilities & SCA Panel: CVE-Counts (Critical/High/Medium/Low mit Farbcodierung), Top CVEs (mit Link auf NVD), SCA-Compliance Score, Failed Checks

  2. **Inventory Tab:**
     - CPU, RAM, Disk, Installed Software, Open Ports, Asset Tags

  3. **Network Tab:**
     - IP-Adressen, MAC, Domain, Open Ports

  4. **Security Tab:**
     - Transparent Risk Badge (expanded)
     - Inventory Highlights (expanded): CPU, RAM, Installed Packages, Kernel, AV (— nicht im syscollector), Patches (— nicht im syscollector)

  5. **Timeline Tab:**
     - Alert Timeline Component (separate, zeigt Ticket-Historie für diesen Agent/Host)
     - Heartbeat Card (expanded, mit Sparkline wenn verfügbar)

- **Export-Button:** gefilterte Hosts als CSV (`hosts-YYYY-MM-DD.csv`)

- **Add Host Button:** deaktiviert, Tooltip "Coming soon — Host-Enrollment via Wazuh"

- **Refresh-Button:** Seite neu laden + Filter zurücksetzen

## Datenquellen (Backend)

**Endpunkte:**
- `GET /api/v1/wazuh/agents` → WazuhAgent[] (Basis-Daten)
- `GET /api/v1/wazuh/agents/:agentId/inventory` → WazuhInventory (syscollector: CPU, RAM, Disk, Packages, Ports)
- `GET /api/v1/wazuh/agents/:agentId/posture` → HostPosture (CVE + SCA-Daten aus Indexer)

**API-Module:**
- `frontend/src/features/wazuh/wazuhApi.ts` → `wazuhApi.agents()`, `.inventory()`, `.posture()`
- `frontend/src/features/hosts/hostsTypes.ts` → Typen
- `frontend/src/features/hosts/hostRisk.ts` → Risk-Berechnung
- `frontend/src/features/hosts/inventoryHighlights.ts` → Daten-Ableitung

**Rückgabetypen (Auswahl):**
```typescript
interface RegisteredHost {
  id: string;
  hostname: string;
  customer?: string;
  source: 'wazuh';
  agentId?: string;
  agentVersion?: string;
  os?: { name?: string; version?: string; build?: string; platform?: string };
  ipAddresses?: string[];
  lastHeartbeatAt?: string;
  expectedIntervalMin: number;
  heartbeatStatus: 'healthy' | 'delayed' | 'offline';
  inventoryStatus: 'complete' | 'partial' | 'missing';
  riskScore?: number;      // 0-100 (berechnet)
  riskLevel?: string;       // 'low' | 'medium' | 'high' | 'critical'
  inventory?: {
    cveCritical?: number;
    cveHigh?: number;
    cveMedium?: number;
    cveLow?: number;
    cveTotal?: number;
    scaScore?: number;
    scaFail?: number;
    cpu?: string;
    ram?: string;
    disk?: string;
    ...
  };
}
```

## Verknüpfungen zu anderen Seiten

- **Navigiert zu:**
  - `/wazuh` — Wazuh Dashboard (Alert-Übersicht für diese Hosts)

- **Empfängt von:**
  - Wazuh API — Agents
  - Wazuh-Indexer (OpenSearch) — syscollector Docs, Vulnerability Data, SCA Results

## Zustände

- **Lade-Zustand:** Spinner; einzelner Host-Detail nachgeladen (Inventory, Posture) → Loading-Flag

- **Nicht konfiguriert:** Hinweis "Nicht verbunden — Wazuh-API nicht konfiguriert"
  - Erläutert, dass `WAZUH_API_*` in `.env.production` gesetzt sein muss

- **Keine Hosts:** EmptyState nach Filterung oder wenn noch keine Agenten registriert sind

- **Host gewählt:** Detail-Panel geladen; einzelne Tabs lazy

## Besonderheiten

- **Risk-Score Transparenz:**
  - Tooltip auf dem Risk-Badge erklärt die Signale, die zum Score beitrugen
  - Faktoren: Heartbeat-Status, Heartbeat-Alter, SCA-Compliance-Score, CVE-Counts
  - Nur aus **real verfügbaren Daten** — wenn z.B. kein SCA, dann nur Heartbeat+CVE

- **Ehrliche Inventory-Lücken:**
  - "— (nicht im syscollector)" für AV (braucht Paketliste, die nicht einzeln exposiert wird)
  - "— (kein Patch-Endpunkt)" für Patches (nur via Vulnerability-API mit CVE-Mapping)
  - Footer-Hinweis: "Heuristik aus Heartbeat/Inventory/Ports — kein CVE-Scan."

- **Heartbeat-Sparkline:**
  - Nur wenn echte 24h-Zeitreihendaten vorhanden
  - Wazuh-API liefert nur `lastKeepAlive`, keine Reihe → "Heartbeat-Verlauf nicht verfügbar"

- **Filtering:**
  - Customer, Source, OS, Status sind Dropdowns aus echten Daten
  - Risk-Level: berechnet (low/medium/high/critical) basiert auf riskScore-Schwellwerten

- **Export:**
  - CSV mit BOM für Excel UTF-8
  - Spalten: Hostname, Customer, Source, OS, IP, Risk Score, Heartbeat Status, etc.
  - Nur gefilterte Hosts (nicht alle)

## Hinweise zur Ehrlichkeit der Daten

- **Alle Host-Daten:** Aus Wazuh API + Indexer
- **Inventory:** Nur Felder, die der syscollector-Endpunkt tatsächlich liefert; keine Fake-Paketlisten oder AV-Erkennung
- **Risk-Score:** Heuristisch berechnet aus echten Signalen (kein ML-Model, transparent)
- **CVE-Details:** Aus Wazuh Vulnerability-API (wenn konfiguriert); sonst null
- **Keine Demo-Agenten:** Nur echte Agents aus Wazuh werden angezeigt
