# Wazuh Dashboard (`/wazuh`)

## Zweck
Echtzeitübersicht der Wazuh-SIEM-Aktivität: Alerts, Agenten, Regeln, MITRE-Taktiken und Threat-Intelligence-Treffer (24h-Fenster). Alle Daten beziehen sich vom Wazuh-Indexer (OpenSearch :9200) und der Manager-API.

## Rolle & Sichtbarkeit
- **Mindest-Rolle:** Keine Einschränkung (alle Rollen sehen diese Seite in der Sidebar)
- **Nav-Gruppe:** Integrations — SIEM-Quellen

## Funktionen

- **KPI-Reihe:** 6 Kennzahlen auf einen Blick
  - Total Alerts Today (Delta vs. gestern)
  - Critical Alerts (Delta vs. gestern)
  - Active Agents (Online/Offline/Pending)
  - Open Incidents
  - Rule Matches
  - Threat Intel Matches

- **Alerts over Time:** Linien-Flächenchart der letzten 24h (stündlich aggregiert), zeigt Alert-Verlauf in der Nähe des Indexer-Formats

- **Severity Distribution:** Donut-Diagramm (Critical/High/Medium/Low), mit Legende und absoluten Zählern

- **Active Agents Tabelle:** Agent-Name, IP-Adresse, Status (Online/Offline), Zeitpunkt des letzten Keepalive
  - Farbcodierung: grün = online, rot = offline, gelb = pending
  - Footer zeigt Zähler: `Online xx · Offline xx · Pending xx`
  - Link "View all" verweist auf die `/hosts`-Seite

- **Recent Alerts / Events Tabelle:** Zeitstempel, Regel-ID, Level, Beschreibung, Host, Source IP, Severity-Badge
  - Sortierung nach Zeitstempel (neueste zuerst)
  - Max. ~20 Events angezeigt (Seiten-Limit vom Backend)

- **MITRE ATT&CK (Top Tactics):** Tabelle der häufigsten MITRE-Taktiken
  - Spalten: Tactic, Techniques (komma-getrennt), Alert-Count mit Balkenvisualisierung und %
  - Link "Analyse" in der Kopfzeile verweist auf `/analysis`

- **Top Offending Hosts:** Hosts mit den meisten Alerts, horizontal balkendiagramm nach Count sortiert

- **Source IP Reputation:** Top-Source-IPs, Reputation-Status (aktuell alle "Unknown", P17-Feature), Alert-Count
  - Hinweis: "Reputation folgt mit dem Threat-Intel-Service (P17)"

- **Threat Intel Matches:** Große Zahl (gesamt 24h), Hinweis auf Heuristik aus `rule.groups` (virustotal/threat_intel)
  - Footer: "Aufschlüsselung nach IP/Domain/URL/Hash folgt mit dem Threat-Intel-Service (P17)"

- **Wazuh Rule Health:** Donut-Diagramm (% Enabled vs. Disabled), Zähler: Total/Enabled/Disabled
  - Nur verfügbar wenn Manager-API konfiguriert

- **Map Overview:** PlatzhalterCard (EmptyState) mit Hinweis auf Geo-IP-Service (P17)

- **Refresh-Button:** Manuelle Daten-Neulade
  - "Last 24 hours" Badge zeigt das aktuelle Fenster

## Datenquellen (Backend)

**Endpunkt:** `GET /api/v1/siem/wazuh/dashboard`  
**API-Modul:** `frontend/src/features/siem/siemApi.ts` → `siemApi.dashboard('wazuh')`

**Rückgabetyp:**
```typescript
interface SiemDashboard {
  enabled: boolean;
  data?: {
    generatedAt: string;
    kpis: {
      alertsToday: number | null;
      alertsTodayDeltaPct: number | null;
      critical: number | null;
      criticalDeltaPct: number | null;
      activeAgents: number | null;
      agentsTotal: number | null;
      openIncidents: number | null;
      ruleMatches: number | null;
      threatIntelMatches: number | null;
    };
    alerts: {
      timeSeries: Array<{ t: string; count: number }>;
      severity: { critical: number; high: number; medium: number; low: number };
      recent: SiemRecentAlert[];
      topHosts: Array<{ host: string; count: number }>;
      topSourceIps: Array<{ ip: string; count: number }>;
      topTactics: Array<{ tactic: string; techniques: string[]; count: number; pct: string }>;
    };
    agents: {
      total: number;
      online: number;
      offline: number;
      pending: number;
      list: Array<{ id: string; name: string; ip?: string; status: 'active' | 'disconnected' | 'pending'; lastKeepAlive?: string }>;
    };
    ruleHealth?: { total: number; enabled: number; disabled: number };
    sources: { indexer: boolean; api: boolean };
  };
}
```

## Verknüpfungen zu anderen Seiten

- **Navigiert zu:**
  - `/hosts` — "View all" Link in der Active Agents Card (für vollständige Host-Übersicht)
  - `/analysis` — "Analyse" Link in der MITRE Tactics Card (für detaillierte MITRE-Analyse)

- **Empfängt von:**
  - Wazuh-Indexer (OpenSearch :9200) — Alert-Dokumente, Aggregationen
  - Wazuh-Manager-API (typisch :55000) — Agent-Status, Rule-Health

## Zustände

- **Lade-Zustand:** Spinner mit "Wazuh-Daten werden geladen …"

- **Fehler:** ErrorCard mit Meldung (z.B. "Laden fehlgeschlagen")

- **Nicht konfiguriert:** EmptyState
  - Titel: "Wazuh nicht verbunden"
  - Nachricht: "Setze WAZUH_INDEXER_* (OpenSearch :9200) und/oder WAZUH_API_* in .env.production. Sobald konfiguriert, erscheinen hier die echten Alerts, Agents und Aggregationen."

- **Keine Daten im Indexer:** Soft-Fail mit leeren oder Teil-Panels
  - z.B. "Keine Agents (Manager-API nicht verbunden)" wenn agent.list leer ist
  - Hinweise auf fehlende Datenquellen im Footer: "Quellen: Indexer ✓ · Manager-API —"

- **Erfolgreiche Ladung:** Alle Panels mit echten Daten gefüllt

## Hinweise zur Ehrlichkeit der Daten

- **Heartbeat-Verlauf (Sparklines):** Linien-Chart nutzt nur `alertTimeSeries` vom Backend — keine erfundenen Zwischenwerte
- **Severity-Distro:** Summiert nur echte Alert-Counts vom Indexer
- **Top Tactics:** Aus Wazuh-Rule-Groups abgeleitet; technische Beschreibung im Footer ("Heuristik aus rule.groups")
- **Threat Intel Matches:** Heuristik erklärt ("virustotal/threat_intel"), keine automatischen Verdikts
