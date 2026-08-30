# Detection Rules Catalog — Nexora SOC Lab

**Dokumentiert:** 2026-06-11  
**Version:** 1.0  
**Quelle:** Wazuh Manager 4.14.5 (lokal) + Sysmon Enterprise Config + Windows Event Forwarding Pipeline  
**Scope:** VLAN10 (Servers), VLAN30 (Lab Clients), OPNsense-Firewall

---

## Inhaltsübersicht

1. **Übersicht** — Detection-Abdeckung, Quellen, Statistiken
2. **Sysmon Event-basierte Regeln** — FileCreate, Registry, Named Pipes, DNS
3. **Integrationen & AV-Layer** — VirusTotal, Windows Defender, FIM, WEF
4. **Threat-Hunt-Katalog** — 10 vorgefertigte Hunts mit MITRE-Techniken
5. **MITRE ATT&CK Coverage Matrix** — Taktiken × Techniken
6. **Wartung & Erweiterung** — Konventionen, ID-Bereiche, Best Practices

---

## 1. Übersicht

### Gesamtstatistik

| Metrik | Wert |
|--------|------|
| **Lokale Detection-Regeln** | 60 (Wazuh local_rules.xml) |
| **davon Alert-Regeln** | ~49 (Level 1+) |
| **davon Basis-/FP-Regeln** | ~11 (Level 0, keine Alerts) |
| **Sysmon-basierte Regeln** | 23 (Events 11, 12/13, 17/18, 22) |
| **Process-Injection-Regeln** | 3 (svchost.exe Anomalien + Code-Injection) |
| **AD/WEF-Detection-Regeln** | 13 (Kerberos, Account-Mgmt, GPO, Brute Force) |
| **Threat-Hunts** | 10 (Live-Katalog, vorgefertigt) |
| **MITRE ATT&CK Taktiken** | 10+ (Execution, Persistence, C&C, Credential Access, etc.) |

### Quellen der Detection-Logik

| Quelle | Anteil | Beschreibung |
|--------|--------|-------------|
| **Sysmon Agent** | 55% | Event 11 (FileCreate), 12/13 (Registry), 17/18 (Pipes), 22 (DNS) |
| **Windows Security Log** | 25% | EventID 4625 (failures), 4624 (success), 4768/4769 (Kerberos) |
| **Wazuh Manager** | 15% | Aggregation, Correlation, QRadar-Offense-Mimicry |
| **OPNsense Firewall** | 5% | Rule 87702 (Multicast-Rauschen), FIM auf Web-Root |

### Architektur der Detection-Pipeline

```
┌─────────────────────┐
│   Windows Host      │
│  (Sysmon Agent,     │
│   WEF Client)       │
└──────────┬──────────┘
           │
           ├─→ Wazuh Agent ──┐
           │                 │
           └──→ Windows Event│ (ForwardedEvents)
               Collector 01   │
                              ↓
                      ┌───────────────┐
                      │ Wazuh Manager │ (192.168.240.77)
                      ├───────────────┤
                      │ local_rules   │ (100001–101399)
                      │ Decoder       │ (windows_eventchannel)
                      │ Aggregation   │ (Frequency, Timeframe)
                      └───────┬───────┘
                              │
                      ┌───────┴────────┐
                      │                │
                  Alert (Level N)   Ticket (Incident)
                      │                │
                      ├→ VirusTotal    ├→ Analyst Review
                      │   (Hash lookup)│   Integration → Ticket
                      │                │
                      ├→ AbuseIPDB     ├→ Approval-Gate
                      │   (IP intel)   │   (Hunt-Findings)
                      │                │
                      └→ Zeek DNS      ├→ Response Console
                                       │   (Safe Commands)
```

---

## 2. Basis- & FP-Suppression-Regeln (Level 0)

Diese Regeln werden NICHT als Alerts ausgegeben (Level 0). Sie dienen zur:
- **FP-Suppression:** Unterdrückung bekannter False Positives von legitimen Prozessen (svchost, lsass, csrss, etc. beim normalen Systemstart)
- **Parent-Rule-Definition:** Sie definieren Basis-Events, die von spezialisierteren Regeln (`if_sid`) referenziert werden

| Rule ID | **Beschreibung / Zweck** | Parent-Prozess |
|---------|--------------------------|----------------|
| **100001** | FP: svchost.exe von wininit.exe (Systemstart — legitim) | wininit.exe |
| **100002** | FP: svchost.exe mit bekanntem legitimen Windows-Service-Parameter | services.exe |
| **100003** | FP: svchost.exe mit bekanntem -k Parameter von services.exe | services.exe |
| **100004** | FP: svchost.exe Scan-Aktivität durch Windows Defender | MsMpEng.exe |
| **100010** | FP: lsm.exe von wininit.exe (Systemstart — legitim) | wininit.exe |
| **100020** | FP: csrss.exe von smss.exe (Systemstart — legitim) | smss.exe |
| **100030** | FP: lsass.exe von wininit.exe (Systemstart — legitim) | wininit.exe |
| **100040** | FP: winlogon.exe von smss.exe (legitim) | smss.exe |
| **100050** | FP: services.exe von wininit.exe (Systemstart — legitim) | wininit.exe |
| **101312** | Basis: Kerberos TGT/TGS angefordert (Event 4768/4769 — parent rule) | — |
| **101313** | Basis: Directory Service Access (Event 4662 — parent rule) | — |

---

## 3. svchost.exe & Process-Injection Detection (Rules 100401–100403)

| Rule ID | Level | **Erkennt / Bedingung** | MITRE | Erklärung |
|---------|-------|------------------------|-------|-----------|
| **100401** | 14 | svchost.exe gestartet von Script/Shell-Prozess (PowerShell, cmd, VBScript) | T1055 | **KRITISCH: Process Injection:** svchost sollte NICHT von PowerShell/cmd gestartet werden — starker Indikator für `T1055.001` (CreateRemoteThread) oder `T1217` (Browser-basierte Injection) |
| **100402** | 12 | svchost.exe **ohne** -k Parameter (sollte immer -k haben) | T1055.012 | **HOCH: Process Hollowing:** svchost ohne -k Parameter ist anomal — Zeichen für Process Hollowing / Malware-Verschleierung. Legit svchost: `svchost -k netsvcs` |
| **100403** | 14 | svchost.exe nicht aus System32/SysWOW64 (False ImagePath) | T1036.005 | **KRITISCH: Masquerading:** svchost.exe mit falschem Pfad (z.B. `C:\Users\svchost.exe`) — direktes Masquerading-Zeichen |

---

## 4. Sysmon Event-basierte Regeln

### 4.1 Event 11 — FileCreate Detection (Rules 100610–100616)

Sysmon Event 11 wird ausgelöst, wenn eine Datei geschrieben wird. Basis: `if_sid 61613` (Level 0).

| Rule ID | Level | **Erkennt / Bedingung** | MITRE | Erklärung |
|---------|-------|------------------------|-------|-----------|
| **100610** | 12 | Datei in `Startup\` Ordner | T1547 | **Autostart-Persistence:** Datei in `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\` erstellt. Analysator startet beim Logon automatisch. |
| **100611** | 10 | `.exe`, `.dll`, `.ps1`, `.bat` in `\Temp\` | T1105 | **Dropper/Staging:** Ausführbare Dateien im Windows Temp-Ordner — typisches Muster für Stage-1-Loader. |
| **100612** | 10 | `.exe`, `.dll`, `.ps1` in `AppData\` (ohne Installer) | T1105 | **Staging:** Binary in `%APPDATA%\Roaming\` oder `Local\` ohne Ausnahmen für Chrome/Firefox/Teams/OneDrive (d.h. nicht die üblichen Installer). |
| **100613** | 14 | Office-Prozess (`WINWORD.EXE`, `EXCEL.EXE` etc.) erzeugt `.exe`, `.dll`, `.ps1` | T1566 | **Kritisch — Makro/Phishing:** Office-Dokument-Prozess erstellt ausführbare Datei — starker Indikator für aktiviertes Makro oder Exploit. |
| **100614** | 14 | Datei in Web-Root (`inetpub\wwwroot\`, `htdocs\`) mit `.asp`, `.aspx`, `.php`, `.jsp` | T1505 | **Kritisch — Webshell:** ASP/PHP-Datei in Web-Directory — unmittelbare RCE-Bedrohung (Web-Shell-Upload). |
| **100615** | 10 | Datei in `\Windows\System32\Tasks\` von **nicht** `svchost`, `taskeng`, `msiexec` | T1053 | **Scheduled Task Abuse:** Task XML in Standard-Task-Ordner von unerwarteter Binary (z.B. cmd.exe) — Persistence-Versuch. |
| **100616** | 14 | `.sys` Datei **außerhalb** `System32\drivers\` | T1014 | **Kritisch — Rootkit:** Kernel-Treiber außerhalb des Standard-Ordners — Zeichen für Rootkit-Installation oder Windows-Protection-Bypass. |

**Technische Kontext-Felder (aus Sysmon EventData):**
- `win.eventdata.targetFilename` — Zieldatei-Pfad
- `win.eventdata.image` — Prozess, der die Datei erstellt
- `win.eventdata.creationUtcTime` — Timestamp

**Beispiel-Alert (Regel 100613):**
```
Rule: 100613 (Level 14)
Process: C:\Program Files\Microsoft Office\WINWORD.EXE (PID 4856)
Target File: C:\Users\user\AppData\Roaming\payload.exe
Message: KRITISCH: Office-Prozess erstellt ausführbare Datei — Makro/Phishing (T1566.001)
```

---

### 4.2 Event 12/13 — Registry Persistence Detection (Rules 100701–100708)

Sysmon Events 12 & 13 tracken Registry-Modifikationen. Basis: `if_sid 61614, 61615` (Level 0).

| Rule ID | Level | **Erkennt / Bedingung** | MITRE | Erklärung |
|---------|-------|------------------------|-------|-----------|
| **100701** | 12 | `HKLM\Software\...\CurrentVersion\Run` oder `RunOnce` geändert (kein Installer) | T1547 | **Run-Key Persistence:** Registry-Auto-Start-Key (inkl. HKCU) — eine der häufigsten Persistenzmethoden. Ausnahme: Installer, OneDrive, Teams (legitim). |
| **100702** | 14 | `AppInit_DLLs` Wert geändert | T1546 | **Kritisch — DLL Injection:** AppInit_DLLs werden von JEDER ausführbaren Datei beim Start geladen — perfekt für privilegierte Injection (TSC, rundll32 etc.). |
| **100703** | 14 | `Lsa\*` Keys (`Authentication Packages`, `Security Packages`, `Notification Packages`) geändert | T1547 | **Kritisch — Credential Provider Hijack:** LSA lädt diese DLLs beim Boot — Attacker kann dort Passwort-Hashes abfangen (Pass-the-Hash-Quelle). |
| **100704** | 12 | `Image File Execution Options\` mit Debugger geändert | T1546 | **Hoch — Debugger Hijack:** IFEO kann ein alternatives Programm ausführen, wenn das Target-Programm startet → UAC-Bypass oder Persistence. |
| **100705** | 14 | `Winlogon\Shell`, `Winlogon\Userinit`, `Winlogon\GinaDLL` geändert | T1547 | **Kritisch — Logon Persistence:** Diese Keys steuern, was beim Windows-Logon lädt (Shell = Explorer, Userinit = Sicherheits-Init). Manipuliert = Pre-Shell Code Execution. |
| **100706** | 10 | `HKCU\Software\Classes\CLSID\` unter User-HIVE manipuliert | T1546 | **MITTEL — COM Hijacking:** COM-Interfaces können hijackt werden, um Shells/Tools zu starten. Üblicherweise HKCU-bezogen (User-Kontext). |
| **100707** | 14 | `DisableAntiSpyware`, `DisableRealtimeMonitoring`, `DisableAntiVirus` etc. | T1562 | **Kritisch — Defense Evasion:** Windows Defender über Registry deaktiviert. Zeichen für aktiven Angriff. |
| **100708** | 10 | `ProxyServer`, `AutoConfigURL`, `ProxyEnable` von **nicht** Browser-Prozess geändert | T1090 | **Mittel — Proxy Hijacking:** Proxy-Einstellung vom kein-Browser-Prozess (z.B. rundll32) modifiziert → Traffic-Interception-Versuch. |

**Technische Felder (aus Sysmon EventData):**
- `win.eventdata.targetObject` — Registry-Pfad / Wert-Name
- `win.eventdata.details` — Neuer Wert (masked für Binary-Daten)
- `win.eventdata.image` — Prozess, der Registry ändert

**Beispiel-Alert (Regel 100703):**
```
Rule: 100703 (Level 14)
Process: C:\Windows\System32\cmd.exe (PID 5224)
Registry: HKLM\System\CurrentControlSet\Control\Lsa\Authentication Packages
Details: Added "C:\malware\lsa.dll"
Message: KRITISCH: LSA Packages geändert — Credential Provider Hijack (T1547.002)
```

---

### 4.3 Event 17/18 — Named Pipe Detection (Rules 100801–100804)

Sysmon Events 17 & 18 protokollieren Named-Pipe-Erstellung und -Verbindung. Named Pipes sind **Top-Indikator** für Lateral Movement und C2.

Basis: `if_sid 61645, 61646` (Level 0).

| Rule ID | Level | **Erkennt / Bedingung** | MITRE | Erklärung |
|---------|-------|------------------------|-------|-----------|
| **100801** | 14 | Pipe Name enthält `psexesvc` oder `PSEXESVC` | T1569 | **Kritisch — PsExec:** PsExec-Rahmenwerk nutzt diese Pipe für Remote-Befehlsausführung über SMB (administratives Werkzeug, aber auch Attacker-Standard). |
| **100802** | 14 | Pipe Name passt CobaltStrike-Patterns: `postex_*`, `msagent_*`, `isapi_*`, `status_*`, `mojo.*`, `wkssvc_*`, `ntsvcs*`, `scerpc_*`, `mypipe-f`, `SearchTextHarvester` | T1055 | **Kritisch — CobaltStrike Beacon:** Diese Pipes sind statische/charakteristische Named Pipes des CobaltStrike-Malware-Rahmenwerks (Post-Exploitation). |
| **100803** | 14 | Pipe Name enthält `meterpreter`, `metasploit` oder `stdapi_` | T1055 | **Kritisch — Metasploit/Meterpreter:** Charakteristische Pipes des Metasploit-Frameworks. Indikator für active Metasploit-Session. |
| **100804** | 12 | Admin-Pipes (`\svcctl`, `\atsvc`, `\samr`, `\lsarpc`, `\netlogon`, `\epmapper`, `\srvsvc`) von **nicht** `svchost`, `lsass`, `services`, `spoolsv` | T1021 | **Hoch — Impacket/Lateral Movement:** Admin-Pipes sollten nur von System-Prozessen genutzt werden. Non-System-Prozess = Impacket-Tool (PSExec-Ersatz) oder Attacker-WMI/DCOM-Exploitation. |

**Technische Felder (aus Sysmon EventData):**
- `win.eventdata.pipeName` — Name der Pipe
- `win.eventdata.image` — Prozess, der Pipe erstellt/verbindet
- `win.eventdata.eventType` — `CreateRemoteThread` (Event 17) oder `ConnectPipe` (Event 18)

**Beispiel-Alert (Regel 100802):**
```
Rule: 100802 (Level 14)
Process: C:\Windows\System32\rundll32.exe (PID 2488)
Pipe Name: \\.\pipe\postex_4828_1a2b
Message: KRITISCH: CobaltStrike Default Named Pipe — C2 Beacon (T1055)
```

---

### 4.4 Event 22 — DNS Query Detection (Rules 100901–100906)

Sysmon Event 22 wird ausgelöst, wenn ein Prozess einen DNS-Namen auflöst. Ungewöhnliche DNS-Anfragen von Shell-Prozessen oder Dateilose Malware sind starke Indikatoren.

Basis: `if_sid 61650` (Level 0).

| Rule ID | Level | **Erkennt / Bedingung** | MITRE | Erklärung |
|---------|-------|------------------------|-------|-----------|
| **100901** | 12 | `powershell.exe` oder `pwsh.exe` stellt DNS-Anfrage | T1071 | **Hoch — PowerShell C2:** PowerShell sollte normalerweise keine DNS-Anfragen direkt stellen (nur Netzwerk-Tools). Direkte DNS-Anfrage = Staging oder C2-Kommunikation. |
| **100902** | 12 | LOLBins (`wscript.exe`, `cscript.exe`, `mshta.exe`, `rundll32.exe`, `regsvr32.exe`) stellen DNS-Anfrage | T1059 | **Hoch — LOLBin C2:** Diese (für VBScript gedachten) Dateien nutzen Netzwerk-APIs nicht normalerweise. DNS-Anfrage = verdächtig. |
| **100903** | 10 | DNS-Query zu verdächtiger TLD (`.xyz`, `.top`, `.tk`, `.ml`, `.ga`, `.cf`, `.gq`, `.pw`, `.cc`, `.su`, `.bit`, `.onion`) | T1568 | **Mittel — DGA/C2:** Diese TLDs werden vermehrt für Malware-Domains / Phishing genutzt. `.onion` = Tor. |
| **100904** | 12 | DNS-Query mit **100+ Zeichen** im Hostname | T1071 | **Hoch — DNS Tunneling:** DNS Tunneling versteckt Daten in lange Subdomains (z.B. `exfil.base64data.attacker.com`). 100+ Zeichen ist extrem selten in legitimer DNS. |
| **100905** | 12 | `certutil.exe` stellt DNS-Anfrage | T1218 | **Hoch — certutil Downloader:** certutil ist ein LOLBin für Remote-Datei-Download. DNS = Staging oder C2. |
| **100906** | 8 | Office-Prozess (`WINWORD.EXE`, `EXCEL.EXE` etc.) stellt DNS an **nicht**-Microsoft-Domain | T1566 | **Mittel — Phishing/Makro:** Office sollte nur zu Microsoft-Domains für Updates/Online-Features zugreifen. Query zu anderen = verdächtiges Makro. |

**Technische Felder (aus Sysmon EventData):**
- `win.eventdata.image` — Prozess der DNS auflöst
- `win.eventdata.queryName` — Aufgelöster Hostname
- `win.eventdata.queryStatus` — Erfolg/Fehler (0 = Success)
- `win.eventdata.sourcePort` — Source-Port

**Beispiel-Alert (Regel 100904):**
```
Rule: 100904 (Level 12)
Process: C:\Windows\System32\cmd.exe (PID 3784)
Query Name: a8f3k2m1o9p2q5r8t1u3v6w9x2y5z8a0b3c6d9e2f5g8h.exfil.example.com (128 zeichen)
Message: HOCH: DNS-Query mit 100+ Zeichen Hostname — DNS Tunneling (T1071.004)
```

---

## 5. SSH & FP-Spezial-Regeln (Rule 100500)

| Rule ID | Level | **Beschreibung** | MITRE | Erklärung |
|---------|-------|-----------------|-------|-----------|
| **100500** | 3 | FP (bekannt): SSH MAC-Konfiguration auf Wazuh-Server — als akzeptiert markiert | — | **Spezial-FP:** SSH-Key-Exchange auf Wazuh-Manager selbst (192.168.240.77). Wird als akzeptierter False Positive kategorisiert — kein Alert notwendig. |

---

## 6. Integrationen & AV-Layer

### 6.1 VirusTotal Integration (Rules 87101–87105)

**Ablauf:**
1. Wazuh FIM monitort `C:\fim-test\` auf neue `.exe` / `.dll` Dateien
2. File-Hash (MD5/SHA256) extrahiert
3. VirusTotal-API abgefragt (API-Key in `/var/ossec/integrations/custom-soc-tool`)
4. Result wird als neuer Alert eskaliert

| Rule ID | Level | **Bedingung** | Beschreibung |
|---------|-------|---------------|-------------|
| **87101** | 3 | VT-API Error / No-Response | VT-Integration konnte nicht abgefragt werden (Rate-Limit, API-Down, Key-Fehler) |
| **87102** | 0 | VT Response: 0 Detektionen (sauber) | File in VT bekannt, aber von keinem Hersteller als Malware flagged |
| **87103** | 5 | VT Response: File unbekannt | VT hat diese Hash noch nie gesehen |
| **87104** | — | (Reserviert) | |
| **87105** | 14 | VT Response: 1+ Detektionen / Malicious | **File flagged malware** (z.B. "Trojan.Win32.Emotet" von Kaspersky, "PUA.Win32.SuspiciousBrowser" von Avast) → Eskalation zu Level 14 (kritisch) |

**Integrationsendpoint:** `/var/ossec/integrations/custom-soc-tool` (Script) ruft VT-API auf Wazuh-Manager

**Beispiel (Level 14 Alert):**
```
Original Event: FIM File Created (C:\fim-test\suspicious.exe, Hash SHA256: a1b2c3...)
Integration Call: POST https://www.virustotal.com/api/v3/files/{hash}
Response: { "data": { "attributes": { "last_analysis_stats": { "malicious": 5 } } } }
Alert: VT detects suspicious.exe as MALICIOUS (5 vendors) — Auto-Escalation to Level 14
```

---

### 6.2 Windows Defender — Windows Event 1116, 1117

**Integration:** Windows Defender lädt Security-Events in `Windows-System32-Schannel` Kanal.

| Event ID | Level | **Beschreibung** |
|----------|-------|-----------------|
| **1116** | 13 | Malware erkannt (Detection-Event) — z.B. "Trojan:Win32/Emotet.C!MTB" |
| **1117** | 14 | Malware-Aktion durchgeführt (z.B. in Quarantäne verschoben, Prozess beendet) |
| **1010** (Defender-Start) | 3 | Windows Defender gestartet / Scan begonnen |

**Kontext (aus Event XML):**
- `Threat Name` — Detected-Malware-Name
- `Threat ID` — VT-interne Threat-ID
- `Severity` — Wichtigkeit
- `Action Taken` — Was Defender gemacht hat (Quarantine, Remove, Allow etc.)

---

### 6.3 FIM — File Integrity Monitoring

**Scope:** `realtime` auf `C:\fim-test\` eingerichtet.

| Änderung | Alert | MITRE | Aktion |
|----------|-------|-------|--------|
| Datei erstellt (`.exe`, `.dll`) | Ja (+VT-Check) | T1105 | FIM-Rule 550xx (Wazuh) + VT-Integration |
| Datei geändert (z.B. Größe) | Ja | T1565 | Audit-Log-Eintrag |
| Datei gelöscht | Ja (abhängig Konfiguration) | T1485 (Data Destruction) | Warning-Level |
| Berechtigung geändert (z.B. Permissions) | Ja | T1222 | Alert, falls verdächtig |

**Konfiguration (agent.conf):**
```xml
<localfile>
  <log_format>sysmon</log_format>
  <location>C:\fim-test\</location>
  <realtime>yes</realtime>
</localfile>
```

---

### 6.4 WEF Pipeline — Windows Event Forwarding (Domain Controller Events)

**Architektur:**

```
DC01 (nexora.example, 10.99.99.10)
  ↓ WEF Client (Windows Event Forwarding)
     ├→ Security Channel (Local: Event ID 4768, 4769, 4720–4768)
     └→ PowerShell Operational Channel
        ↓
WEC01 (10.99.99.11) — Windows Event Collector
  ├→ ForwardedEvents Channel
  ├→ Wazuh Agent (lokal auf WEC01)
  └→ Wazuh Manager (192.168.240.77)
        ↓
    local_rules 101200–101399 (AD Detection)
        ├→ Kerberoasting (101200)
        ├→ AS-REP Roasting (101201)
        ├→ Golden Ticket (101202)
        ├→ DCSync (101203)
        ├→ Silver Ticket (101204)
        └→ Account-Mgmt (101301–101305)
```

**Event Sources auf DC01 (konfig via Group Policy oder direkt):**

```
<Subscription>
  <SubscriptionId>NEXORA_Threat_Hunt</SubscriptionId>
  <SubscriptionType>SourceInitiated</SubscriptionType>
  <Content>
    <Query>
      <Select Path="Security">
        *[System[(EventID=4768 or EventID=4769 or EventID=4720 or EventID=4624 or EventID=4625 or EventID=4662 or EventID=4719)]]
      </Select>
    </Query>
  </Content>
</Subscription>
```

---

## 7. QRadar-äquivalente & Brute-Force-Detection (Rules 101000–101004)

Diese Regeln mimic QRadar-Offensive-Syntax und detektieren **Brute-Force** sowie **Password-Spray**-Angriffe durch Aggregation von Authentifizierungs-Fehlern.

| Rule ID | Level | **Erkennt** | MITRE | Beschreibung |
|---------|-------|-----------|-------|-------------|
| **101000** | 10 | **Brute Force:** 8+ Logon Failures in 120s von gleicher IP auf **gleichen Account** | T1110.001 | Zyklische Passwort-Attacke auf einen einzelnen Account. Schwellenwert: 8+ Fehlversuche innerhalb von 120 Sekunden (Frequenz-Aggregation). |
| **101001** | 12 | **Password Spray:** Failures gegen **mehrere Accounts** von einer IP (keine Beschränkung auf einen Account) | T1110.003 | Horizontal-Angriff: Attacker probiert wenige Passwörter gegen viele Accounts. Detektiert wenn >5 verschiedene Accounts in kurzer Zeit fehlschlagen. |
| **101002** | 10 | **Account Lockout:** Konto nach Failure-Flood gesperrt (Windows Event 4740) | T1110 | Nach zu vielen Fehlversuchen wird das Konto vom System selbst gesperrt. Deutet auf erfolgreiche Brute-Force hin, auch wenn Angreifer nicht authentifiziert wurde. |
| **101003** | 8 | **Remote Logon Failure (Netzwerk):** Fehlgeschlagener Logon von Remote-Host (Event 4625 mit Logon Type 3/10) | T1110 | Passwort-Fehler von Netzwerk-Login (RDP, SSH, Kerberos). Level 8 = Informativ, muss kumulativ ausgewertet werden. |

---

## 8. NTLM Downgrade & Pass-the-Hash Detection (Rules 101100–101102)

| Rule ID | Level | **Erkennt** | MITRE | Beschreibung |
|---------|-------|-----------|-------|-------------|
| **101100** | 12 | **NTLMv1 Authentication:** Downgrade zu NTLMv1 oder Legacy-System-Nutzung | T1557.002 | NTLMv1 ist kryptographisch schwach und kann leicht offline-gebrochen werden. Indikator für Downgrade-Angriff (`T1557`) oder Zeichen eines nicht-gepatchten Legacy-Systems. |
| **101101** | 14 | **Pass-the-Hash:** NTLM Netzwerk-Logon mit KeyLength=0 (Hash-Nutzung statt Passwort) | T1550.002 | KeyLength=0 bei Network-Logon bedeutet direkte Hash-Authentifizierung (PTH). Sehr verdächtig — legit sollte KeyLength > 0 sein. |
| **101102** | 10 | **Anonymous NTLM Login:** Null-Session / Unauthenticated Recon (Event 4624 mit UserName "ANONYMOUS" oder leerer Session) | T1135 | Unbenutzter Logon für Netzwerk-Recon. Kann legitim sein für File-Shares mit öffentlichem Zugriff, aber starker Indikator für Enumeration. |

---

## 9. Kerberos Attack Detection (Rules 101200–101204)

Diese Regeln erfordern **DC01 & WEC01** — Windows Event Forwarding mit Kerberos-Events (4768, 4769, 4672, etc.)

| Rule ID | Level | **Erkennt** | MITRE | Beschreibung |
|---------|-------|-----------|-------|-------------|
| **101200** | 14 | **Kerberoasting:** RC4-verschlüsselte Service-Ticket für Service-Account (Event 4769, EncryptionType 0x17) | T1558.003 | Attacker fordert TGS für Nicht-Admin-Service-Account an. RC4 (0x17) ist einfach zu cracken. Legitimate Requests nutzen üblicherweise AES. |
| **101201** | 14 | **AS-REP Roasting:** Pre-Authentication deaktiviert auf User, TGT crackbar (Event 4768, PreAuthType=0) | T1558.004 | User mit `DONT_REQUIRE_PREAUTHENTICATION`-Flag: TGT kann offline-gebrochen werden. Extrem verdächtig für eine Nicht-Legacy-Umgebung. |
| **101202** | 15 | **Golden Ticket:** Alte krbtgt RC4-Ticket-Anfrage (Event 4768 mit RC4-Encryption für krbtgt) | T1558.001 | Attacker mit krbtgt-Hash kann beliebig signierte Tickets erzeugen. RC4 + krbtgt = höchste Eskalation im Netzwerk. KRITISCH. |
| **101203** | 15 | **DCSync / Credential Dump:** Replikationsrechte (DsGetNCChanges) von Nicht-DC-Host (Event 4662 + Directory-Service-Access) | T1003.006 | Non-DC versucht Directory-Datenbank zu synchronisieren (alle Hashes). Zeichen für `secretsdump` oder ähnliche Credential-Dumping-Tools. |
| **101204** | 14 | **Silver Ticket:** RC4 Service-Ticket ohne Standard-TGT-Flow (Event 4769 mit verdächtigem Ticket-Alter / -Typ) | T1558.002 | Attacker mit Service-Account-Hash kann forged Tickets für Services ausstellen. Häufig nicht erkannt, aber immer noch Privilege-Escalation. |

---

## 10. Active Directory & Domain Account Management (Rules 101301–101308)

Diese Regeln überwachen **Veränderungen** an AD-Objekten und erfordern WEC01 mit Event-Forwarding von DC01.

| Rule ID | Level | **Erkennt** | MITRE | Beschreibung |
|---------|-------|-----------|-------|-------------|
| **101301** | 8 | **Benutzerkonto erstellt:** Neuer User in AD hinzugefügt (Event 4720 oder 5137 im Directory Service) | T1136.001 | Neue Accounts sind häufig legitim (IT-Onboarding), aber sollten auditiert werden. Level 8 = Informativ, wird mit Context wichtig. |
| **101302** | 5 | **Konto-Änderung:** User aktiviert/deaktiviert, Passwort zurückgesetzt, Account gelöscht oder entsperrt (Event 4722/4723/4725) | T1098.002 | Häufige AD-Admin-Operationen. Level 5 = sehr niedrig, aber archiviert für Audit-Trail (DSGVO-Konformität). |
| **101303** | 10 | **Mitglied zu Sicherheitsgruppe hinzugefügt:** User einem Security-Group hinzugefügt (Event 4728, 4732, 4756) | T1098.004 | Normale Operationen, aber verdächtig wenn zu Admin-Gruppen hinzugefügt. Archivierung für Privilege-Escalation-Analyse. |
| **101304** | 13 | **Mitglied zu PRIVILEGIERTER Gruppe hinzugefügt:** User zu Admin/Domain Admins/Enterprise Admins (Event 4728 mit Group="Domain Admins") | T1098.004 | Direkte Privilege-Escalation. Level 13 = High. Sollte sofort reviewt werden, wenn nicht erwartet. |
| **101305** | 8 | **Konto gesperrt (Lockout):** User-Account gesperrt nach zu vielen Fehlversuchen (Event 4740) | T1110 | Kann auf Brute-Force oder legitimen Passwort-Fehler hindeuten. Genutzt zur Korrelation mit 101000–101003. |
| **101306** | 13 | **Security-Audit-Log GELÖSCHT:** Admin löscht Einträge aus Security-Event-Log (Event 1102 in Security / Audit Log Cleared) | T1070.001 | **Spurenbeseitigung (Log Wipe):** Sehr verdächtig. Zeichen für aktiven Angriff oder Incident-Response-Versuch. |
| **101307** | 12 | **Audit-Policy geändert:** Admin ändert Audit-Einstellungen (Event 4719 Audit Policy Change) | T1562.002 | **Impair Defenses:** Attacker könnte Audit für bestimmte Events ausschalten. Level 12 = High. Sollte mit Incident korreliert werden. |
| **101308** | 12 | **Group-Policy-Objekt (GPO) geändert:** Admin/Attacker ändert GPO (Event 5136 Directory Service Change mit ObjectClass=groupPolicyContainer) | T1484.001 | **Domain Policy Manipulation:** GPO-Änderungen können Netzwerk-Sicherheit umgehen. Hohe Auswirkung auf alle betroffenen Computer. |

---

## 11. Threat-Hunt-Katalog (10 Live Hunts)

Alle Hunts sind **Safe** — keine Remote-Execution, nur Read-Only Daten-Sammlung + Pattern-Matching.

### Hunt-Übersicht

| Hunt Name | MITRE Tactic | Kategorie | Ziel | Risk |
|-----------|--------------|-----------|------|------|
| **1. Suspicious PowerShell Hunt** | Execution | Command-Injection | Windows Host | HIGH |
| **2. OPNsense Multicast Review** | (FP-Review) | Network Noise | OPNsense FW | LOW |
| **3. RDP Exposure Hunt** | Lateral Movement | Exposure | Host-Port 3389 | MEDIUM |
| **4. Persistence Hunt** | Persistence | Autoruns/Services | Windows Host | MEDIUM |
| **5. Failed Logon Hunt** | Credential Access | Brute Force | Linux/Windows | MEDIUM |
| **6. DNS Tunneling Hunt** | Command & Control | Exfiltration | DNS Logs | MEDIUM |
| **7. Scheduled Tasks Hunt** | Persistence | Task Abuse | Windows Host | MEDIUM |
| **8. Services Hunt** | Persistence | Service Abuse | Windows Host | MEDIUM |
| **9. Autoruns Hunt** | Persistence | Autostart | Windows Host | MEDIUM |
| **10. Remote Access Tools Hunt** | Command & Control | RAT/RMM | Windows Host | MEDIUM |

---

### 1. Suspicious PowerShell Hunt

**MITRE:** T1059.001 (PowerShell Obfuscation)

**Beschreibung:** Erkennt verschleierte/encoded PowerShell-Ausführung (z.B. `-EncodedCommand`, `-enc`) und verdächtige Parent-Prozesse.

**Was es macht:**
1. Sammelt laufende Prozesse (`tasklist /v`) und Prozess-Kommandozeilen
2. Sucht nach `-EncodedCommand` oder `-enc` Parametern
3. Prüft Parent-Prozess (sollte nie `WINWORD.EXE`, `EXCEL.EXE`, `OUTLOOK.EXE` sein)
4. Entscheidet: Encoded + verdächtiger Parent = HIGH Confidence Finding

**Expected Output:**
```
Process: powershell.exe -EncodedCommand SQBFAFgA...
Parent: WINWORD.EXE (PID 3896)
Confidence: HIGH (91%)
MITRE: T1059.001
```

**Einsatz:** Täglich oder nach Verdacht auf Phishing-E-Mail mit Makro.

---

### 2. OPNsense Multicast Review

**MITRE:** (Keine — FP-Review Hunt)

**Beschreibung:** Prüft OPNsense-Firewall-Events auf lokales Multicast-Rauschen (224.0.0.0/24) und markiert False-Positive-Kandidaten.

**Was es macht:**
1. Lädt OPNsense-Firewall-Block-Events (Rule 87702)
2. Filtert nach Ziel-IP im Multicast-Range (224.0.0.0/24)
3. Wenn Ziel = mDNS (224.0.0.251), Bonjour (224.0.0.251), SSDP (239.255.255.250) → **Low-Risk-Finding**
4. Empfehlung: Scoped FP-Exception (nicht globale Regel-Suppression)

**Expected Output:**
```
Destination: 224.0.0.7 (mDNS)
Port: 5353 (UDP)
Protocol: UDP
Verdict: BENIGN (Local Multicast Noise)
Confidence: MEDIUM (86%)
```

**Einsatz:** Wöchentlich zur FP-Basis-Reduktion; insbes. nach OPNsense-Netzwerk-Änderungen.

---

### 3. RDP Exposure Hunt

**MITRE:** T1021.001 (RDP Lateral Movement)

**Beschreibung:** Prüft, ob RDP (TCP 3389) auf einem Host exponiert/erreichbar ist — häufiger Initial-Access-Vektor.

**Was es macht:**
1. Nmap-Scan oder Host-Inventory abfragen
2. Port 3389 auf Ziel-Host prüfen
3. Falls offen: Finding erstellen mit Severity MEDIUM
4. Empfehlung: VPN/MFA Requirement, IP-Whitelisting

**Expected Output:**
```
Host: Server-01
Port: 3389 (TCP)
Service: RDP / ms-wbt-server
Status: OPEN
Confidence: HIGH (78%)
MITRE: T1021.001
Risk: Brute-Force-Einstiegspunkt
```

**Einsatz:** Monthly Exposure-Scan; vor Pentest oder nach kritischem RDP-Vulnbericht.

---

### 4. Persistence Hunt

**MITRE:** T1547.001 (Registry Run-Key Persistence)

**Beschreibung:** Sucht nach Persistenz-Mechanismen: Run-Keys, Scheduled Tasks, Services und Autoruns.

**Was es macht:**
1. Enumerer Run-Keys: `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
2. Query Scheduled Tasks: `schtasks /query /fo LIST /v`
3. Enumerate Services: `Get-Service`, `Get-CimInstance Win32_Service`
4. Enumerate Autoruns: Startup-Ordner + Autoruns-Registrykeys
5. Flaggt verdächtige Einträge: unerwartete Binary-Pfade, %TEMP%, %APPDATA%

**Expected Output:**
```
Type: Registry Run-Key
Path: HKCU\Software\Microsoft\Windows\CurrentVersion\Run
Name: Updater
Value: %APPDATA%\svc.exe
Confidence: MEDIUM (72%)
MITRE: T1547.001
Recommendation: Validate binary hash, check Threat Intel
```

**Einsatz:** Nach initiatem Infektions-Verdacht oder täglich auf kritischen Hosts.

---

### 5. Failed Logon Hunt

**MITRE:** T1110 (Brute Force / Password Spray)

**Beschreibung:** Erkennt Brute-Force-/Password-Spraying-Muster über gehäufte fehlgeschlagene Logons.

**Was es macht:**
1. Query Wazuh für Event 4625 (Logon Failure) — Regeln 5710/5716
2. Aggregiert Failures per Source-IP + Timeframe (letzte 4 Minuten)
3. Flaggt: >8 Failures in 4 Min von einer IP = Brute Force
4. Flaggt: >5 Failures gegen verschiedene Accounts von einer IP = Password Spray

**Expected Output:**
```
Source IP: 203.0.113.55
Failed Logons: 38 (in 4 min)
Target Accounts: root, admin, user1, ...
Verdict: POSSIBLE BRUTE FORCE
Confidence: MEDIUM (70%)
MITRE: T1110
Recommendation: Block IP, enforce rate limiting, monitor account lockouts
```

**Einsatz:** Kontinuierliche Überwachung; Realtime-Alert bei >10 Failures.

---

### 6. DNS Tunneling Hunt

**MITRE:** T1071.004 (Application Layer Protocol: DNS)

**Beschreibung:** Sucht nach DNS-Exfiltration/-Tunneling: ungewöhnlich lange/häufige Queries zu seltenen Domains.

**Was es macht:**
1. Query Zeek DNS logs (`dns.log`)
2. Berechnet Entropy und Länge jedes Query-Names
3. Filtert seltene Domains (wenig Traffic-Volumen)
4. Flaggt: Hostname >100 Zeichen oder Entropy >3.8 mit seltener Domain = DNS Tunneling

**Expected Output:**
```
Domain: a8f3k2.exfil.example.com
Entropy: 4.1 (high)
Frequency: 18 times in 1 hour (unusual for this domain)
Source Host: 192.168.240.55
Verdict: POSSIBLE DNS TUNNELING
Confidence: MEDIUM (68%)
MITRE: T1071.004
Recommendation: Check source process, implement DNS sinkhole
```

**Einsatz:** Täglich oder bei Verdacht auf Data-Exfiltration.

---

### 7. Scheduled Tasks Hunt

**MITRE:** T1053.005 (Scheduled Task/Job Abuse)

**Beschreibung:** Sucht nach verdächtigen geplanten Aufgaben (schtasks) als Persistenz-/Ausführungsmechanismus.

**Was es macht:**
1. Ruft `schtasks /query /fo LIST /v` auf Target-Host auf
2. Filtert Tasks außerhalb Standard-Pfade (`\Microsoft\Windows\`)
3. Flaggt Tasks mit PowerShell/cmd `-w hidden` oder `-enc` Parametern
4. Prüft Task-Author auf verdächtige Konten

**Expected Output:**
```
Task: \Microsoft\Windows\Updater
Action: powershell -w hidden -enc ...
Author: Unknown
Status: Enabled
Confidence: MEDIUM (74%)
MITRE: T1053.005
Recommendation: Decode PowerShell command, validate binary
```

**Einsatz:** Nach verdächtigem schtasks-Command-Audit.

---

### 8. Services Hunt

**MITRE:** T1543.003 (Create or Modify System Process: Windows Service)

**Beschreibung:** Prüft Windows-Dienste auf ungewöhnliche Binärpfade / unsignierte Service-Binaries.

**Was es macht:**
1. Enumerer alle Services: `Get-Service` + `Get-CimInstance Win32_Service`
2. Extrahiert Service Binary Path
3. Flaggt: Binary in `C:\Users`, `%APPDATA%`, `%ProgramData%` (nicht Standard)
4. Flaggt: Unsignierte Binaries
5. Flaggt: Unquoted Service Paths (können zu Pfad-Injection führen)

**Expected Output:**
```
Service: WinHelpSvc
Binary: C:\ProgramData\whelp.exe
Signed: NO
Path Quoted: NO
Confidence: MEDIUM (71%)
MITRE: T1543.003
Recommendation: Verify binary hash, check digital signature
```

**Einsatz:** Nach Verdacht auf neuer Service oder verdächtigem Service-Start.

---

### 9. Autoruns Hunt

**MITRE:** T1547.001 (Boot or Logon Autostart Execution)

**Beschreibung:** Autostart-Persistenz-Analyse: Run-/RunOnce-Registry-Keys, Startup-Ordner, neue Einträge mit verdächtigen Pfaden.

**Was es macht:**
1. Enumerer Run-Keys (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run[Once]`)
2. Enumerer Startup-Ordner (`C:\Users\{User}\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\`)
3. Filtert neu hinzugefügte Einträge (creationtime <7 Tage)
4. Flaggt: Einträge mit verdächtigen Pfaden (%APPDATA%, %TEMP%)

**Expected Output:**
```
Type: Startup Folder Shortcut
File: C:\Users\user\AppData\Roaming\...\Startup\updater.lnk
Target: %APPDATA%\u.exe
Signed: NO
Confidence: MEDIUM (69%)
MITRE: T1547.001
Recommendation: Validate file hash, review .lnk target
```

**Einsatz:** Tägliche Überprüfung neuerer Einträge; monatlicher vollständiger Scan.

---

### 10. Remote Access Tools Hunt

**MITRE:** T1219 (Remote Access Software)

**Beschreibung:** Sucht nach RMM-/Remote-Access-Tools (AnyDesk, TeamViewer, ngrok …) — legitim oder Angreifer-Tooling.

**Was es macht:**
1. Query laufende Prozesse (`tasklist`) + Services (`Get-Service`)
2. Query Netzwerk-Ports (`netstat -ano`)
3. Matched gegen bekannte RAT/RMM-Signaturen: AnyDesk, TeamViewer, ScreenConnect, Atera, NinjaRMM, ngrok, etc.
4. Flaggt gefundene Tools mit MEDIUM-Schweregrad (muss validiert werden — kann legitim sein)

**Expected Output:**
```
Tool: AnyDesk
Process: AnyDesk.exe (PID 2188)
Outbound Connections: Port 443 (TLS) → 35.x.x.x (AnyDesk-Server)
Installed: YES
Verdict: SUSPICIOUS (unexpected in this context)
Confidence: MEDIUM (73%)
MITRE: T1219
Recommendation: Verify business authorization, check connection logs
```

**Einsatz:** Monatlich oder nach Verdacht auf Hands-on-Keyboard-Angriff.

---

## 12. MITRE ATT&CK Coverage Matrix

### Abdeckung nach Taktik

| Taktik | Techniken | Rules | Hunts | Status |
|--------|-----------|-------|-------|--------|
| **Reconnaissance** | T1592, T1598 | (OPNsense FW Logs) | — | Limited (Firewall-only) |
| **Resource Development** | T1583, T1586, T1587 | (External TI) | — | N/A (External) |
| **Initial Access** | T1566 (Phishing), T1091 (Replication) | 100613 (Office FileCreate), 100906 (DNS) | RDP-Exposure | Partial |
| **Execution** | T1059 (Command Shell), T1059.001 (PS), T1218 (LOLBin) | 100901–100905, 100613 | PowerShell-Hunt | Full |
| **Persistence** | T1547 (Autostart), T1053 (Scheduled Task), T1547.004 (Winlogon), T1546 (Event Triggered), T1543 (System Process) | 100610–100616 (FileCreate), 100701–100708 (Registry) | Persistence, Scheduled-Tasks, Services, Autoruns | Full |
| **Privilege Escalation** | T1134 (Token), T1547 (Autostart), T1546 (Event Triggered) | 100704–100705 (IFEO/Winlogon), 100702 (AppInit) | Services | Partial |
| **Defense Evasion** | T1036 (Masquerading), T1562 (Impair Defenses), T1070 (Indicator Removal), T1197 (Traffic Signaling) | 100403 (Masquerade), 100707 (Defender Disable), 101306 (Log Clear), 100708 (Proxy) | Remote-Access-Tools | Full |
| **Credential Access** | T1110 (Brute Force), T1555 (Credentials), T1557 (NTLM Downgrade), T1558 (Kerberoasting) | 101000–101004 (Brute Force), 101100–101102 (NTLM), 101200–101204 (Kerberos), 101305 (Lockout) | Failed-Logon | Full |
| **Persistence** | T1136 (Account Creation), T1098 (Account Manipulation), T1484 (GPO) | 101301–101304 (Account Mgmt), 101308 (GPO) | — | Full |
| **Discovery** | T1135 (Network Share), T1087 (Account Discovery) | 101102 (Null-Session) | — | Limited |
| **Lateral Movement** | T1021 (Remote Service), T1550 (Use Alternate Auth) | 100801–100804 (Named Pipes), 101101 (PtH) | RDP-Exposure | Partial |
| **Collection** | T1123 (Audio), T1113 (Screen Capture) | (Agent-based on endpoints) | — | Limited (Endpoint-focused) |
| **Command & Control** | T1071 (Application Layer), T1071.004 (DNS), T1568 (DGA) | 100801–100803 (Named Pipes), 100901–100906 (DNS), 100903–100904 (DGA) | DNS-Tunneling, Remote-Access-Tools | Full |
| **Exfiltration** | T1020 (Data Transfer Restrictions), T1048 (Exfil Over), T1041 (Exfil Over C2) | 100904 (DNS Tunneling), 100903 (Suspicious TLD) | DNS-Tunneling | Partial |
| **Impact** | T1485 (Data Destruction), T1561 (Disk Wipe), T1070 (Indicator Removal) | 101306 (Log Delete), 101307 (Audit Policy) | — | Partial |

### Top-Abdeckung (nach Rule-Count)

1. **Persistence** — 22 Regeln (100610–100616, 100701–100708, 101301–101308) — Kernfähigkeit + AD-fokus
2. **Credential Access** — 13 Regeln (101000–101004, 101100–101102, 101200–101204, 101305) — Brute Force + Kerberos
3. **Execution** — 9 Regeln (100401–100403, 100901–100906) — Process Injection + Command-Injection
4. **Command & Control** — 6 Regeln (100801–100804, 100901–100906) — Malware-Detection
5. **Defense Evasion** — 7 Regeln (100403, 100707, 101306, 101307, 100708 + others)

---

## 13. Wartung & Erweiterung

### 13.1 ID-Bereiche (Konvention)

```
100001–100099   svchost.exe FP-Ausnahmen
100100–100199   Critical Process FP (lsass, csrss, winlogon, smss)
100200–100299   PowerShell / Scripting FP
100300–100399   Netzwerk-FP
100400–100499   Eskalations-/Anreicherungsregeln

100610–100699   Event 11 (FileCreate) Detection
100700–100799   Event 12/13 (Registry) Detection
100800–100899   Event 17/18 (Named Pipe) Detection
100900–100999   Event 22 (DNS) Detection

101000–101099   QRadar-äquivalent: Brute Force / Password Spray
101100–101199   QRadar-äquivalent: NTLM Downgrade / PtH
101200–101299   QRadar-äquivalent: Kerberos Attacks (DC-required)
101300–101399   AD / WEF Detection (Domain Controller Events)
```

### 13.2 Neue Regel hinzufügen

**Schritt 1:** Identifiziere den **Einsatzort** und **Rule-Bereich**

```
Beispiel: "Verdächtige PowerShell-Argument-Kombination"
→ Bereich: 100901–100999 (Event 22 DNS) / 100050–100150 (PowerShell FP)?
→ Nächste verfügbare ID: 101307 (unter AD/WEF für PowerShell-Anomaly)
```

**Schritt 2:** Schreibe die Wazuh-Rule im XML-Format

```xml
<rule id="101307" level="10">
  <if_sid>61618</if_sid>
  <field name="win.eventdata.commandLine" type="pcre2">(?i)-NoP.*-Exec.*Bypass</field>
  <description>MITTEL: PowerShell mit verdächtigen Parametern (NoProfile + ExecutionPolicy Bypass)</description>
  <mitre><id>T1059.001</id></mitre>
  <group>powershell,execution,suspicious_parameters</group>
</rule>
```

**Schritt 3:** Teste die Regel lokal

```bash
# SSH auf Wazuh Manager
ssh wazuh "sudo wazuh-control restart"

# Generiere Test-Alert mit matching Event
# (z.B. manueller PowerShell-Befehl auf Test-Host)

# Überprüfe Rule-Match im Wazuh Manager Web-UI
```

**Schritt 4:** Dokumentiere im CHANGELOG + Commit

```markdown
## 2026-06-12
- Added Rule 101307: PowerShell NoProfile + ExecutionPolicy Bypass (T1059.001)
- Level: 10 (Medium)
- Severity: Execution obfuscation pattern
```

---

### 13.3 Hunt hinzufügen

**Schritt 1:** Neue Hunt-Typ-Definition in `HuntType.js`

```javascript
dns_exfil_analysis_hunt: {
  label: 'DNS Exfil Analysis Hunt',
  description: 'Advanced DNS traffic analysis mit Entropy-Scoring und Zeitreihen-Anomaly-Detection.',
  category: 'Exfiltration / C2',
  mitre: 'T1041',
  dataSources: ['Zeek', 'Suricata', 'Wazuh'],
  targetType: 'network',
  defaultTarget: 'DNS-Resolver-01',
  defaultIp: '10.99.99.53',
  riskLevel: 'high',
  build(session) {
    // Mock implementation
    return { logs: [...], findings: [...] };
  }
}
```

**Schritt 2:** UI-Integration (Hunt-Katalog wird automatisch über `getCatalog()` aktualisiert)

**Schritt 3:** Test + Dokumentation

---

## 14. Bekannte Rausch-Quellen — Analysiert (Phase 0)

**Analysiert:** 2026-06-21 | **Status:** Dokumentiert, kein Code-Change erforderlich

Beide Quellen erzeugen einen „Webhook-Sturm" — sie feuern häufig und mit echter Alarmierungsfrequenz, ohne SOC-relevante Bedrohung darzustellen. Kein automatisches Wazuh-Write. Keine Regeln wurden verändert.

---

### 14.1 Rule 67027 — Wazuh Agent-Level Systemnachricht

| Attribut | Wert |
|----------|------|
| **Rule ID** | 67027 |
| **Quelle** | Wazuh Manager — Standard-Ruleset (`syslog_rules.xml` o. Ä.) |
| **Typ** | Informational / Agent-Verbindungsstatus |
| **Schwellenwert im Lab** | Feuert auf Level 5–6 (knapp über dem aktuellen `WAZUH_MIN_LEVEL=5`) |
| **Häufigkeit** | Hoch (mehrfach täglich, besonders nach Wazuh-Manager-Restarts und Agent-Reconnects) |
| **SOC-Relevanz** | **Keine** — reine Infrastruktur-Statusmeldungen der Wazuh-VM selbst |

**Beobachtung aus Lab-Betrieb:**
Die Wazuh-VM (192.168.240.77) erzeugt bei Agent-Reconnects, Log-Rotation und Dienststarts kontinuierlich Events der Kategorie 67027. Diese passieren den `WAZUH_MIN_LEVEL=5`-Filter, weil sie auf Level 5 oder 6 gefeuert werden. Inhaltlich handelt es sich um Wazuh-interne Statusmeldungen ohne Bedrohungscharakter.

**Empfohlene Operator-Aktion (kein Code-Change):**

Option A — Minimallevel erhöhen (empfohlen für Lab):
```bash
# In deploy/.env.production (operator-privat):
WAZUH_MIN_LEVEL=7
```
→ Filtert 67027 vollständig aus, bevor ein Ticket erstellt wird (`WazuhProcessor.js:97`).

Option B — Scoped FP-Exception in `local_rules.xml`:
```xml
<rule id="100099" level="0">
  <if_sid>67027</if_sid>
  <description>FP-Suppress: Wazuh Agent Reconnect/Status Noise</description>
</rule>
```
→ Unterdrückt ausschließlich diese Rule, Level-Schwelle bleibt unverändert.

**Entscheidung ausstehend:** Option A ist für das Lab ausreichend. Option B ist gezielter. Beide sind Operator-Konfigurationen — kein Deployment-Blocke.

---

### 14.2 Rule 87702 — OPNsense Multicast-Rauschen

| Attribut | Wert |
|----------|------|
| **Rule ID** | 87702 |
| **Quelle** | OPNsense Firewall (`/var/log/filter.log`) — Wazuh OPNsense-Decoder |
| **Typ** | Firewall Block — lokale Multicast-Pakete (224.0.0.0/24, 239.255.x.x) |
| **Häufigkeit** | Hoch (mehrfach pro Minute — SSDP/mDNS/Bonjour-Broadcasts normaler Endgeräte) |
| **SOC-Relevanz** | **Keine** — RFC-konforme Link-Local-Multicasts, kein Angriffsindikator |

**Beobachtung aus Lab-Betrieb:**
OPNsense blockt standardmäßig ausgehende Multicast-Pakete an 224.0.0.x (mDNS, IGMP) und 239.255.255.250 (SSDP/uPnP). Der Wazuh OPNsense-Decoder forwarded diese Block-Events mit Rule 87702. Im Lab-Netz erzeugen normale Windows-Hosts ständig SSDP/mDNS-Broadcasts → Ticket-Sturm ohne Bedrohungswert.

**Bereits vorhandene Analyse:** Hunt `2. OPNsense Multicast Review` (Abschnitt 8.2).

**Empfohlene Operator-Aktion (kein Code-Change):**

Option A — Scoped FP-Exception via Nexora KI-FP-Workflow (bevorzugt):
1. Ticket für ein 87702-Multicast-Event öffnen
2. KI → False-Positive-Review → Genehmigen
3. Erzeugte FP-Exception-Vorschau in `local_rules.xml` eintragen:
```xml
<rule id="100300" level="0">
  <if_sid>87702</if_sid>
  <dstip>224.0.0.0/8</dstip>
  <description>FP-Suppress: OPNsense local multicast block (mDNS/SSDP)</description>
</rule>
<rule id="100301" level="0">
  <if_sid>87702</if_sid>
  <dstip>239.255.255.250</dstip>
  <description>FP-Suppress: OPNsense SSDP block</description>
</rule>
```

Option B — Firewall-seitig erlauben (kein Wazuh-Event):
→ In OPNsense Multicast-Ausgabe auf VLAN10/VLAN30 erlauben. **Benötigt separates explizites GO** (Firewall-Regeländerung).

**Entscheidung:** Option A wird empfohlen (Nexora-intern, kein Firewall-Write, kein Deploy). Option B erfordert separates GO.

---

### 14.3 Zusammenfassung

| Rule | Typ | Häufigkeit | Empfohlene Maßnahme | Status |
|------|-----|-----------|---------------------|--------|
| **67027** | Wazuh Agent-Status | Täglich/mehrfach | `WAZUH_MIN_LEVEL=7` oder FP-Rule 100099 | Operator-Config, kein Blocker |
| **87702** | OPNsense Multicast | Minütlich | Scoped FP-Exception via KI-FP-Workflow | Umsetzungsbereit |

**Wichtig:** Keine Wazuh-Regel wird automatisch geschrieben. Keine globale Suppression. Alle Optionen sind scoped und auditierbar.

---

### 13.4 False Positive Handling

**Wenn eine Regel zu viele FP erzeugt:**

1. **Anaylisiere die Root-Cause**
   - Sysmon zeigt legitime `svchost.exe` von `wininit.exe`? → Regel 100001 einschalten
   - Firewall zeigt mDNS-Rauschen? → OPNsense-Multicast-Hunt ausführen

2. **Schreibe eine FP-Suppression-Regel** (not-rules, negate-fields)

```xml
<rule id="100005" level="0">
  <if_sid>61618</if_sid>
  <field name="win.eventdata.parentImage" type="pcre2">(?i)\\Known.ParentProcess\.exe$</field>
  <description>FP: svchost.exe von legitimem Parent</description>
  <group>sysmon,fp_suppression</group>
</rule>
```

3. **Niemals** ein Parent-Prozess **global** supprimieren (z.B. `-i_sid 61618` auf Services). Stattdessen:
   - **Scoped FP-Exception** (nur für diesen Host / diese User)
   - **Aggregated Alert** (sammle 10 Vorkommen, flagge erst dann)

---

### 13.5 Regelmäßige Audits

| Frequenz | Aktion | Owner |
|----------|--------|-------|
| **Wöchentlich** | Review Alert Volume + Top-10 Rules by Count | SOC-Analyst |
| **Monatlich** | False Positive Analysis + Rule Tuning | SOC-Lead |
| **Quartalsweise** | MITRE-Coverage-Review + New-Technique-Assessment | Security-Architect |
| **Jährlich** | Full Rule-Set-Audit + Vulnerability-Assessment | CISO / Infra-Team |

---

## Anhang: Literatur & Referenzen

- **MITRE ATT&CK Framework:** https://attack.mitre.org/
- **Wazuh Ruleset (4.14.5):** `/var/ossec/etc/rules/`
- **Sysmon Config (Enterprise):** https://github.com/SwiftOnSecurity/sysmon-config/tree/master/sysmonconfig-export.xml
- **Windows Event Forwarding (WEF):** Microsoft Docs — Event Forwarding & Subscriptions
- **OPNsense Firewall:** https://docs.opnsense.org/
- **VirusTotal API:** https://developers.virustotal.com/reference/
- **Zeek DNS Logs:** https://docs.zeek.org/en/master/scripts/base/frameworks/intel/seen.zeek.html

---

**Dokument-Version:** 1.0  
**Letzte Aktualisierung:** 2026-06-11  
**Status:** Production (v1.0) / Community Review  
**Feedback:** Senden Sie Bugs/Verbesserungen an SOC-Team oder Security-Architect

