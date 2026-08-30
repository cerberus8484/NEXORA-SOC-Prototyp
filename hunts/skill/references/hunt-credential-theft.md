# HUNT-002: Credential Theft

## Überblick

| Feld | Wert |
|---|---|
| ID | HUNT-002 |
| MITRE | T1003.001 (LSASS), T1558.003 (Kerberoasting), T1558.004 (AS-REP), T1550.002 (Pass-the-Hash) |
| Taktik | Credential Access |
| Quellen | Sysmon (Event 10), Windows Security (4624, 4625, 4768, 4769, 5136) |
| Konfidenz-Basis | 50 |

---

## HUNT-002A: LSASS Memory Access (T1003.001)

### Was erkannt wird
Zugriff auf den LSASS-Prozess (lsass.exe) um Credentials aus dem Speicher zu extrahieren.
Tools: Mimikatz, ProcDump, Task Manager, comsvcs.dll MiniDump, Nanodump, PPLdump.

### Detection Logic

#### Sysmon Event 10 — ProcessAccess auf LSASS
```spl
index=sysmon EventCode=10 TargetImage="*lsass.exe"
| eval suspicious_access=if(
    match(GrantedAccess,"0x1010|0x1410|0x1438|0x143a|0x1fffff|0x1f3fff"),1,0)
| where suspicious_access=1
| eval tool_hint=case(
    match(SourceImage,"procdump"),      "ProcDump",
    match(CommandLine,"comsvcs"),       "comsvcs.dll MiniDump",
    match(SourceImage,"taskmanager"),   "Task Manager",
    match(SourceImage,"mimikatz"),      "Mimikatz direkt",
    true(),                             "Unbekanntes Tool")
| table _time, ComputerName, SourceImage, GrantedAccess, tool_hint, CallTrace
```

#### QRadar — Windows Security Event 4656 (Handle-Anfrage)
```sql
SELECT sourceip, username, ProcessName, ObjectName,
       AccessMask, LogonId
FROM events
WHERE EventID = 4656
  AND ObjectType = 'Process'
  AND ObjectName LIKE '%lsass%'
  AND AccessMask IN ('0x1010', '0x1410', '0x1438', '0x143a', '0x1fffff')
  AND username NOT IN ('SYSTEM', 'LOCAL SERVICE', 'NETWORK SERVICE')
  AND ProcessName NOT IN (
    'C:\Windows\System32\svchost.exe',
    'C:\Windows\System32\werfault.exe',
    'C:\Program Files\Windows Defender\MsMpEng.exe'
  )
```

### GrantedAccess Werte (kritisch)

| AccessMask | Bedeutung | Risiko |
|---|---|---|
| `0x1010` | PROCESS_VM_READ + PROCESS_QUERY_INFORMATION | Hoch |
| `0x1410` | + PROCESS_DUP_HANDLE | Sehr hoch |
| `0x1438` | Typischer Mimikatz-Wert | Kritisch |
| `0x143a` | Variante von Mimikatz | Kritisch |
| `0x1fffff` | PROCESS_ALL_ACCESS | Kritisch |
| `0x0010` | PROCESS_VM_READ (nur lesen) | Mittel |

### True Positives LSASS

**TP-001: Mimikatz sekurlsa::logonpasswords**
- Sysmon 10: SourceImage = `mimikatz.exe` oder umbenannte Kopie
- GrantedAccess: `0x1438` oder `0x143a`
- CallTrace enthält: `ntdll.dll`, `UNKNOWN` (kein legitimer Modul-Pfad)
- Confidence: 98

**TP-002: ProcDump auf LSASS**
- Prozess: `procdump.exe` oder `procdump64.exe`
- Commandline: `-ma lsass.exe` oder `-ma <PID von lsass>`
- Sysmon 10 mit ProcDump als Source
- Output-Datei erstellt: `.dmp` in ungewöhnlichem Pfad
- Confidence: 95

**TP-003: comsvcs.dll MiniDump (LOLBin)**
```
C:\Windows\System32\rundll32.exe C:\Windows\System32\comsvcs.dll, MiniDump <PID> C:\temp\lsass.dmp full
```
- Sysmon 1: rundll32.exe mit `comsvcs.dll` + MiniDump in Commandline
- Sysmon 11: .dmp-Datei erstellt
- Confidence: 97

**TP-004: Task Manager LSASS Dump (T1003.001)**
- Taskmgr.exe greift auf LSASS zu (eigentlich normale Funktion)
- Kontext: User führt Task Manager NICHT als SYSTEM aus
- Sysmon 11: `.dmp`-Datei in `C:\Users\*\AppData\Local\Temp\`
- Confidence: 75 (legitimer Task Manager Dump ist möglich)

**TP-005: Nanodump / PPLdump (AV-Umgehung)**
- Kein bekannter Prozess-Name, aber GrantedAccess-Muster
- CallTrace zeigt unbeschriebene Speicherbereiche (suspicious)
- Oft kombiniert mit Treiber-Load (Sysmon 6)
- Confidence: 80

### False Positives LSASS
- **AV/EDR-Software**: MsMpEng.exe, CrowdStrike, SentinelOne — immer LSASS-Zugriff
- **WER (Windows Error Reporting)**: werfault.exe nach Absturz
- **Debugger**: Visual Studio, WinDbg — nur auf Dev-Maschinen
- **Sysinternals Process Explorer**: procdump.exe für legitime Diagnose
- **Whitelist:** EDR-Prozesse, WER, bekannte Diagnose-Tools auf definierten Hosts

---

## HUNT-002B: Kerberoasting (T1558.003)

### Was erkannt wird
Angreifer fordert Service Tickets (TGS) für Service Accounts mit SPNs an,
um sie offline zu cracken. Erkennbar durch ungewöhnlich viele TGS-Requests.

### Detection Logic

#### Windows Security Event 4769 — Kerberos Service Ticket
```spl
index=wineventlog EventCode=4769
| where TicketEncryptionType="0x17" OR TicketEncryptionType="0x18"
```
**Kritisch:** `0x17` = RC4-HMAC — Kerberoasting ist nur mit RC4 möglich (kein AES)

```spl
index=wineventlog EventCode=4769 TicketEncryptionType="0x17"
| where ServiceName!="krbtgt" AND ServiceName!="*$"
| stats count as ticket_count, values(ServiceName) as targets
  by src_ip, Account_Name, _time span=1h
| where ticket_count > 5
| eval kerberoasting_score=case(
    ticket_count > 20, 90,
    ticket_count > 10, 75,
    ticket_count > 5,  60,
    true(), 40)
```

### True Positives Kerberoasting
- Event 4769, TicketEncryptionType = `0x17` (RC4)
- Viele verschiedene SPNs in kurzer Zeit von einem Host
- Source-IP ist normale Workstation (kein DC, kein Server)
- Werkzeuge: Rubeus, Impacket GetUserSPNs, PowerView

### False Positives Kerberoasting
- Legitime Dienste die regelmäßig Tickets anfordern (SQL Server, Exchange)
- Automatisierte Skripte die Dienste überwachen
- **Unterschied:** Legitime Anfragen kommen von definierten Service-Hosts, nicht von Workstations

---

## HUNT-002C: AS-REP Roasting (T1558.004)

### Was erkannt wird
Accounts ohne Kerberos Pre-Authentication können ohne Passwort AS-REP Hashes
angefordert werden. Tool: Rubeus, Impacket GetNPUsers.

### Detection Logic
```spl
index=wineventlog EventCode=4768
| where PreAuthType="0" AND TargetUserName!="*$"
| eval asrep_roasting="verdächtig"
```
`PreAuthType=0` = kein Pre-Auth = AS-REP Roasting möglich

**Event 4768 ohne** entsprechenden TGT-Vorgang von bekannter Maschine → verdächtig.

---

## HUNT-002D: Pass-the-Hash (T1550.002)

### Was erkannt wird
Angreifer nutzt NTLM-Hash statt Passwort für Authentifizierung.
Kennzeichen: Logon Type 3 + NTLM-Auth + ungewöhnliche Quelle.

### Detection Logic
```spl
index=wineventlog EventCode=4624
| where Logon_Type="3" AND Authentication_Package="NTLM"
| where SubjectUserName="-" AND TargetUserName!="ANONYMOUS LOGON"
| where NOT match(WorkstationName, "^(DC|SERVER)")
| stats count by src_ip, TargetUserName, WorkstationName, _time span=1h
| where count > 3
```

### True Positives PtH
- Logon Type 3 + NTLM + SubjectUserSID = S-1-0-0 (null SID) → starker Indikator
- Quelle: Workstation die normalerweise keine Adminzugriffe macht
- Ziel: Domain Controller oder Server
- Mimikatz: `sekurlsa::pth /user:... /ntlm:...`

### False Positives PtH
- Legitime NTLM-Authentifizierung in alten Umgebungen
- Service-Accounts die NTLM verwenden müssen
- **Whitelist:** Bekannte Legacy-Systeme, definierte NTLM-Quellen

---

## HUNT-002E: DCSync (T1003.006)

### Was erkannt wird
Angreifer repliziert AD-Passwort-Hashes direkt vom DC.
Benötigt: DS-Replication-Get-Changes + DS-Replication-Get-Changes-All Rechte.
Erkennbar durch Replikations-Anfragen von Nicht-DC-Maschinen.

### Detection Logic

#### Windows Security Event 4662 — Replications
```spl
index=wineventlog EventCode=4662
| where Properties="{1131f6aa-9c07-11d1-f79f-00c04fc2dcd2}" OR
        Properties="{1131f6ad-9c07-11d1-f79f-00c04fc2dcd2}"
| where SubjectUserName!="*$"
| where NOT match(SubjectUserName, "^(MSOL_|AAD_|AzureAD)")
```

GUIDs: `1131f6aa` = DS-Replication-Get-Changes, `1131f6ad` = DS-Replication-Get-Changes-All

**Kritisch:** Diese Events kommen von DC-Maschinen. Wenn SubjectUserName kein Computer-Account ($) ist, sondern ein User-Account → DCSync!

### True Positives DCSync
- Impacket secretsdump.py von Linux-Host gegen DC
- Mimikatz: `lsadump::dcsync /domain:... /user:krbtgt`
- Event 4662 von Nicht-DC-Quelle, Non-Computer-Account
- Confidence: 98

---

## Confidence Scoring

```python
def score_credential_theft(hunt_type: str, indicators: dict) -> int:
    scores = {
        'lsass_mimikatz':      98,
        'lsass_procdump':      95,
        'lsass_comsvcs':       97,
        'lsass_taskmanager':   70,
        'lsass_unknown':       80,
        'kerberoasting':       85,
        'asrep_roasting':      80,
        'pass_the_hash':       75,
        'dcsync':              98,
    }
    base = scores.get(hunt_type, 50)

    if indicators.get('from_admin_host'):   base -= 30
    if indicators.get('in_maintenance'):    base -= 40
    if indicators.get('edr_process'):       base = 0  # direkt ausschließen

    return max(0, min(100, base))
```

---

## Test Cases

| ID | Typ | Beschreibung | Confidence |
|---|---|---|---|
| TP-001 | TP | Mimikatz direkt (0x1438) | 98 |
| TP-002 | TP | ProcDump auf lsass.exe | 95 |
| TP-003 | TP | comsvcs.dll MiniDump | 97 |
| TP-004 | TP | Kerberoasting (RC4, 20 SPNs) | 90 |
| TP-005 | TP | DCSync von Workstation | 98 |
| TP-006 | TP | Pass-the-Hash, Logon Type 3 NTLM | 80 |
| FP-001 | FP | CrowdStrike LSASS-Zugriff | NICHT erkannt |
| FP-002 | FP | WER-Dump nach Absturz | NICHT erkannt |
| FP-003 | FP | Legitime NTLM-Auth (Legacy-System) | NICHT erkannt |
| VAR-001 | Var | Nanodump (Kernel-Treiber) | 85 |
| VAR-002 | Var | AS-REP Roasting | 80 |
| EDGE-001 | Edge | ProcDump von sysadmin mit Ticket | 40 |
