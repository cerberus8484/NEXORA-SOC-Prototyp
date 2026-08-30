# HUNT-001: C2 Beaconing Detection

## Überblick

| Feld | Wert |
|---|---|
| ID | HUNT-001 |
| MITRE | T1071.001, T1071.004, T1095, T1571, T1090 |
| Taktik | Command and Control |
| Quellen | Firewall, Proxy, DNS, Sysmon (Event 3, 22) |
| Konfidenz-Basis | 40 |

## Was erkannt wird

Periodische, regelmäßige ausgehende Verbindungen eines Endpoints zu einer externen IP/Domain.
Charakteristisch für: Cobalt Strike, Metasploit Meterpreter, Empire, Covenant, Sliver,
und Custom RATs. Ohne Beaconing kann ein Angreifer den Endpoint nicht steuern.

---

## Detection Logic

### QRadar AQL — Beacon-Pattern (HTTPS)
```sql
SELECT sourceip, destinationip, destinationport,
       COUNT(*) as connection_count,
       STDDEV(DATEDIFF('second', lag(starttime) OVER (PARTITION BY sourceip, destinationip ORDER BY starttime), starttime)) as interval_stddev,
       AVG(DATEDIFF('second', lag(starttime) OVER (PARTITION BY sourceip, destinationip ORDER BY starttime), starttime)) as avg_interval,
       SUM(bytessent) as total_sent,
       SUM(bytesreceived) as total_recv
FROM events
WHERE starttime BETWEEN NOW() - 3600000 AND NOW()
  AND category = 'Firewall Permit'
  AND destinationport IN (80, 443, 8080, 8443, 4444, 4445)
  AND destinationip NOT INCIDR '10.0.0.0/8'
  AND destinationip NOT INCIDR '172.16.0.0/12'
  AND destinationip NOT INCIDR '192.168.240.0/16'
GROUP BY sourceip, destinationip, destinationport
HAVING connection_count >= 10
  AND interval_stddev < 15        -- Jitter < 15 Sekunden = verdächtig regelmäßig
  AND avg_interval BETWEEN 30 AND 600  -- 30s bis 10min Beaconing
```

### Splunk SPL — Cobalt Strike Default Profile
```spl
index=firewall action=allow
| eval dst_is_private=if(match(dest_ip,"^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)"),1,0)
| where dst_is_private=0
| bucket span=1h _time
| stats count as connections, avg(bytes_out) as avg_bytes,
        stdev(eval(tonumber(strftime(_time,"%s")))) as time_stdev
  by src_ip, dest_ip, dest_port, _time
| where connections >= 10 AND time_stdev < 15
| eval beacon_score=case(
    time_stdev < 5, 90,
    time_stdev < 10, 75,
    time_stdev < 15, 60,
    true(), 40)
| sort -beacon_score
```

### Sysmon — Netzwerkverbindung durch verdächtige Prozesse
```spl
index=sysmon EventCode=3
| where NOT match(dest_ip,"^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)")
| eval suspicious_process=if(match(Image,
    "(powershell|cmd|wscript|cscript|mshta|regsvr32|rundll32|certutil|bitsadmin)\.exe"),1,0)
| where suspicious_process=1
| stats count, values(Image) as processes, values(dest_ip) as destinations
  by ComputerName, User, _time span=1h
| where count >= 5
```

---

## True Positives

### TP-001: Cobalt Strike Default Profile
**Erkennungsmerkmale:**
- Beacon-Interval: 60 Sekunden ± Jitter
- Default User-Agent: `Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; Trident/5.0; 1813)`
- TLS-Zertifikat: Self-signed, CN=`Major Cobalt Strike` (Default)
- Bytes per Beacon: ~200-400 Bytes (Check-In), größer bei Tasking
- Named Pipes: `\PIPE\MSSE-<zufällig>-server` (Standardname)
- Prozess: Meist `rundll32.exe`, `powershell.exe`, `svchost.exe` (injiziert)

**Konfidenz-Faktoren:**
- + 30: Known C2-IP (AbuseIPDB >70%)
- + 25: Sysmon Event 8 (CreateRemoteThread) kurz vorher
- + 20: Prozess spawned aus Office/Browser
- + 15: Commandline enthält -enc oder -nop

### TP-002: Cobalt Strike Malleable C2 (angepasstes Profil)
**Erkennungsmerkmale:**
- Interval variiert (Profil-abhängig: 5s bis 120s)
- User-Agent imitiert legitime Software (Chrome, Windows Update)
- URI-Muster imitiert legitime Dienste (`/jquery-3.3.1.min.js`, `/updates/`)
- Kommunikation über CDN oder Domain Fronting
- HTTP GET (Check-In) + HTTP POST (Rückkanal) Pattern

**Warum trotzdem erkennbar:**
- Regelmäßigkeit des Musters (Jitter ≠ menschliches Verhalten)
- Kein passender DNS-Eintrag zum URI
- Ungewöhnliche TLS-Parameter

**Konfidenz:** 65–80 (schwerer zu erkennen als Default)

### TP-003: Metasploit Meterpreter HTTPS
- Interval: Kein festes Beacon, aber regelmäßige Keep-Alives
- TLS: Custom Cert, spezifische Cipher Suites
- Typische Ports: 443, 4444, 8443
- Prozess-Injektion in `explorer.exe`, `svchost.exe`

### TP-004: DNS-basiertes C2 (DNScat2, Cobalt Strike DNS)
- Sehr häufige DNS-Abfragen (>100/min) an eine Domain
- Subdomain-Länge > 30 Zeichen
- TXT/NULL Record Queries (ungewöhnlich für normale Clients)
- Entropy der Subdomains > 3.5 (Shannon)
- Kein Browser-Kontext der die Queries erklären würde

### TP-005: HTTP Beaconing mit Jitter
- Verbindungen im Bereich 50-70 Sekunden (±20s Jitter)
- Immer dieselbe Ziel-IP und Port
- Payload-Größe konsistent (±50 Bytes)
- Kein entsprechender Browser-Traffic (reiner HTTP ohne zugehörige Ressourcen)

---

## False Positives

### FP-001: Windows Update / WSUS
- `wuauclt.exe`, `svchost.exe` mit Service `wuauserv`
- Destination: Microsoft IP-Ranges
- **Whitelist:** Microsoft IP-Ranges + bekannte Update-Domains

### FP-002: Antivirus / EDR Cloud-Verbindungen
- CrowdStrike: `ts01-b.cloudsink.net`, reguläre Intervalle
- Carbon Black: `*.carbonblack.io`
- Defender ATP: `*.microsoft.com`, `*.windows.com`
- **Whitelist:** EDR-Vendor IP-Ranges + bekannte Domains

### FP-003: Monitoring-Agents (Nagios, Zabbix, SCOM)
- Regelmäßige Verbindungen zu internen Monitoring-Servern
- Interval sehr regelmäßig (kein Jitter = legitim!)
- **Whitelist:** Monitoring-Server-IPs, bekannte Monitoring-Ports

### FP-004: Backup-Software
- Veeam, Backup Exec — regelmäßige Check-Ins
- **Whitelist:** Backup-Server-IPs, Backup-Software-Prozesse

### FP-005: Browser-Telemetrie
- Chrome/Edge Update-Checks, Telemetrie-Endpoints
- Erkennbar: Prozess ist `chrome.exe`, `msedge.exe`
- **Whitelist:** Browser-Prozesse zu bekannten Vendor-Domains

### FP-006: NTP-Synchronisation
- Regelmäßig UDP 123 an Zeitserver
- **Whitelist:** UDP 123 generell für NTP

---

## Varianten / Evasion-Techniken

### VAR-001: Domain Fronting
- C2-Traffic läuft über CDN (Cloudflare, Azure CDN, AWS CloudFront)
- Host-Header: Legitime Domain → tatsächlich C2
- TLS-Zertifikat gehört dem CDN-Provider (vertrauenswürdig!)
- **Erkennung:** JA-3/JA-3S Fingerprinting, Diskrepanz zwischen SNI und tatsächlichem Ziel
- **Confidence Modifier:** -15 (schwerer zu erkennen)

### VAR-002: Sleep Obfuscation
- Beacon schläft im Speicher verschlüsselt (Gargoyle, Ekko, Foliage)
- Kein kontinuierliches Beacon-Muster — Verbindungen in größeren Abständen
- **Erkennung:** Längere Zeitfenster analysieren, ungewöhnliche Verbindungen alle 5-30min
- **Confidence Modifier:** -20

### VAR-003: Peer-to-Peer C2 (SMB Beacon)
- Beacon kommuniziert nicht direkt mit C2 sondern über anderen infizierten Host
- Named Pipes: `\PIPE\postex_*`, `\PIPE\msagent_*`
- **Erkennung:** Sysmon Event 17/18, SMB Named Pipe Traffic zwischen Workstations
- **Confidence Modifier:** +10 (wenn SMB Pipe + Lateral Movement kombiniert)

### VAR-004: Umgehung via IPv6
- C2-Verbindung über IPv6 statt IPv4
- IPv6 oft nicht im gleichen Monitoring-Scope
- **Erkennung:** IPv6 Firewall-Logs einbeziehen, IPv6-Traffic zu neuen Zielen

### VAR-005: ICMP-Tunneling
- C2-Daten in ICMP Echo Request/Reply Payloads versteckt
- Normale Ping-Größe: 32-64 Bytes. C2: >100 Bytes pro ICMP
- Hohe ICMP-Frequenz zu einer Ziel-IP
- **Erkennung:** ICMP mit Payload > 100 Bytes, >10/min zur selben IP

### VAR-006: Cobalt Strike Beacon über DNS (externe Nameserver)
- DNS-Queries gehen NICHT an internen Resolver
- DNS an externe IPs (z.B. 8.8.8.8) für C2-Domain
- **Erkennung:** DNS-Traffic zu nicht-autorisierten DNS-Servern

---

## Confidence Scoring Berechnung

```python
def score_c2_beacon(indicators: dict) -> int:
    score = 40  # Basis

    # Netzwerk-Indikatoren
    if indicators.get('known_bad_ip'):        score += 30
    if indicators.get('jitter_under_5s'):     score += 25
    if indicators.get('beacon_interval_60s'): score += 15
    if indicators.get('cs_default_ua'):       score += 20
    if indicators.get('self_signed_cert'):    score += 10
    if indicators.get('suspicious_process'):  score += 20

    # Prozess-Indikatoren
    if indicators.get('process_injection'):   score += 25  # Sysmon Event 8
    if indicators.get('encoded_commandline'): score += 15
    if indicators.get('from_office_app'):     score += 20
    if indicators.get('from_temp_dir'):       score += 15
    if indicators.get('hidden_window'):       score += 10

    # Kontext-Modifikatoren
    if indicators.get('known_admin_host'):    score -= 35
    if indicators.get('in_whitelist'):        score -= 100  # direkt ausschließen
    if indicators.get('domain_fronting'):     score -= 15
    if indicators.get('signed_binary'):       score -= 10

    return max(0, min(100, score))
```

---

## Evidence Requirements

```
Pflicht:
- Quell-IP + Hostname
- Ziel-IP + Port + Domain (wenn auflösbar)
- Prozess-Name + PID + Commandline
- Parent-Prozess
- Zeitstempel (erste + letzte Verbindung)
- Anzahl der Verbindungen
- Bytes Sent / Received
- Interval-Statistiken (AVG, STDDEV)

Optional aber wertvoll:
- TLS-Zertifikat-Fingerprint (JA3/JA3S)
- User-Agent String
- HTTP-Header (falls unverschlüsselt)
- Sysmon Event 8 (Prozess-Injektion) wenn vorhanden
- Named Pipe Namen (Sysmon 17/18)
- Memory-Artefakte (falls forensisch)
```

---

## Test Cases

| ID | Typ | Beschreibung | Erwartetes Ergebnis | Min. Confidence |
|---|---|---|---|---|
| TP-001 | True Positive | CS Default Profil, 60s Beacon | Erkannt | 85 |
| TP-002 | True Positive | CS Malleable C2, 30s Jitter | Erkannt | 70 |
| TP-003 | True Positive | Meterpreter HTTPS | Erkannt | 75 |
| TP-004 | True Positive | DNS C2, TXT Records | Erkannt | 80 |
| TP-005 | True Positive | Beacon mit 20s Jitter | Erkannt | 65 |
| FP-001 | False Positive | Windows Update | NICHT erkannt | — |
| FP-002 | False Positive | CrowdStrike Agent | NICHT erkannt | — |
| FP-003 | False Positive | Zabbix Monitoring | NICHT erkannt | — |
| VAR-001 | Variant | Domain Fronting via Cloudflare | Erkannt | 55 |
| VAR-003 | Variant | SMB Peer-to-Peer Beacon | Erkannt | 70 |
| VAR-005 | Variant | ICMP-Tunneling | Erkannt | 60 |
| EDGE-001 | Edge Case | Browser-Update alle 60min | NICHT erkannt | — |
| EDGE-002 | Edge Case | VPN Keep-Alive | NICHT erkannt | — |
