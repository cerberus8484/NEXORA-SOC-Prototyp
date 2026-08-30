# HUNT-003 — Lateral Movement Detection
<!-- T1021.002 · T1021.006 · T1047 · T1021.001 · T1570 -->

---

## Überblick

| Feld              | Inhalt                                                                                  |
|-------------------|-----------------------------------------------------------------------------------------|
| Hunt-ID           | HUNT-003                                                                                |
| MITRE ATT&CK      | T1021.002 (SMB/PsExec), T1021.006 (WinRM), T1047 (WMI), T1021.001 (RDP), T1570        |
| Taktik            | Lateral Movement                                                                        |
| Daten-Quellen     | Windows Security (4624, 4625, 4648, 4672, 4776), Sysmon (1, 3, 7, 11, 13), System (7045) |
| Konfidenz-Basis   | Process lineage + logon type + source/dest IP + service name + ticket anomaly          |
| Autor             | SOC Engineering                                                                         |
| Letzte Revision   | 2026-06-03                                                                              |

---

## Erkennungslogik / Detection Logic

### 1. PsExec — Service Install + Logon Type 3

**Sysmon Event 1 + Windows Security 7045 + 4624**

#### QRadar AQL
```aql
-- PsExec: PSEXESVC service creation + Type-3 logon from same source within 60s
SELECT
    DATEFORMAT(starttime, 'yyyy-MM-dd HH:mm:ss') AS event_time,
    sourceip,
    destinationip,
    username,
    "Service Name",
    "Logon Type"
FROM events
WHERE
    (
        LOGSOURCETYPENAME(devicetype) = 'Microsoft Windows Security Event Log'
        AND "Event ID" = '7045'
        AND LOWER("Service Name") IN ('psexesvc', 'paexec', 'remcom', 'execsvc')
    )
    OR (
        LOGSOURCETYPENAME(devicetype) = 'Microsoft Windows Security Event Log'
        AND "Event ID" = '4624'
        AND "Logon Type" = '3'
        AND username NOT IN (SELECT username FROM reference set legitimate_service_accounts)
        AND sourceip NOT IN (SELECT ip FROM reference set sccm_servers)
        AND sourceip NOT IN (SELECT ip FROM reference set jump_hosts)
    )
LAST 24 HOURS
ORDER BY event_time DESC

-- Correlate: same sourceip appears in both 7045 and 4624 within 2-minute window
SELECT
    sourceip,
    COUNT(*) AS hop_count,
    ARRAY_AGG(DISTINCT destinationip) AS targets
FROM events
WHERE
    "Event ID" IN ('7045', '4624')
    AND "Logon Type" IN ('3', '2')
    AND LOWER("Service Name") LIKE '%exec%'
GROUP BY sourceip
HAVING hop_count >= 2
LAST 4 HOURS
```

#### Splunk SPL
```spl
-- PsExec detection: service creation + lateral logon chain
index=wineventlog (EventCode=7045 OR EventCode=4624)
| eval is_psexec=if(EventCode=7045 AND (lower(ServiceName) IN ("psexesvc","paexec","remcom","execsvc")), 1, 0)
| eval is_lateral=if(EventCode=4624 AND LogonType IN ("3","10") AND NOT (src_ip IN ("10.0.1.0/24") OR src_ip="sccm.corp.local"), 1, 0)
| eval flag=coalesce(is_psexec, is_lateral)
| where flag=1
| stats count AS event_count, values(EventCode) AS event_ids, values(ServiceName) AS svc_names,
         values(LogonType) AS logon_types, values(dest_ip) AS targets
  BY src_ip, _time span=5m
| where event_count >= 2
| eval confidence=case(
    mvcount(targets) >= 3, "HIGH",
    (mvcount(event_ids) >= 2 AND like(mvjoin(svc_names," "),"psexe%")), "HIGH",
    1==1, "MEDIUM"
  )
| table _time, src_ip, targets, svc_names, logon_types, confidence
| sort -_time
```

---

### 2. WMI Remote Execution — wmiprvse.exe Spawning Shells

#### QRadar AQL
```aql
-- WMI lateral exec: wmiprvse.exe as parent spawning cmd/powershell/wscript
SELECT
    DATEFORMAT(starttime, 'yyyy-MM-dd HH:mm:ss') AS event_time,
    destinationip AS target_host,
    username,
    "Parent Image" AS parent_proc,
    "Image" AS child_proc,
    "CommandLine" AS cmdline,
    sourceip AS initiating_host
FROM events
WHERE
    LOGSOURCETYPENAME(devicetype) IN ('Microsoft Sysmon', 'Sysmon')
    AND "Event ID" = '1'
    AND (
        LOWER("Parent Image") LIKE '%wmiprvse.exe'
        OR LOWER("Parent Image") LIKE '%wmiapsrv.exe'
    )
    AND LOWER("Image") IN (
        'c:\windows\system32\cmd.exe',
        'c:\windows\system32\windowspowershell\v1.0\powershell.exe',
        'c:\windows\syswow64\windowspowershell\v1.0\powershell.exe',
        'c:\windows\system32\wscript.exe',
        'c:\windows\system32\cscript.exe',
        'c:\windows\system32\mshta.exe',
        'c:\windows\system32\net.exe',
        'c:\windows\system32\certutil.exe'
    )
LAST 24 HOURS
ORDER BY event_time DESC
```

#### Splunk SPL
```spl
index=sysmon EventCode=1
| where (lower(ParentImage) LIKE "%wmiprvse.exe" OR lower(ParentImage) LIKE "%wmiapsrv.exe")
| where lower(Image) IN (
    "c:\\windows\\system32\\cmd.exe",
    "c:\\windows\\system32\\windowspowershell\\v1.0\\powershell.exe",
    "c:\\windows\\syswow64\\windowspowershell\\v1.0\\powershell.exe",
    "c:\\windows\\system32\\wscript.exe",
    "c:\\windows\\system32\\cscript.exe",
    "c:\\windows\\system32\\mshta.exe"
  )
| eval wmi_network_src=if(like(CommandLine, "%\\\\.\\%") OR like(CommandLine, "%-ComputerName%"), "REMOTE", "LOCAL")
| eval confidence=case(
    wmi_network_src="REMOTE", 95,
    like(lower(CommandLine), "%invoke-expression%") OR like(lower(CommandLine), "%-enc %"), 90,
    like(lower(CommandLine), "%net user%") OR like(lower(CommandLine), "%whoami%"), 85,
    1==1, 70
  )
| stats count, values(CommandLine) AS cmdlines, max(confidence) AS max_conf
  BY Computer, ParentImage, Image, _time span=10m
| sort -max_conf
```

---

### 3. RDP from Unusual Sources — Event 4624 Type 10

#### QRadar AQL
```aql
SELECT
    DATEFORMAT(starttime, 'yyyy-MM-dd HH:mm:ss') AS event_time,
    sourceip AS rdp_source,
    destinationip AS rdp_target,
    username,
    "Logon Type",
    "Source Network Address" AS src_addr,
    "Source Port" AS src_port
FROM events
WHERE
    LOGSOURCETYPENAME(devicetype) = 'Microsoft Windows Security Event Log'
    AND "Event ID" = '4624'
    AND "Logon Type" = '10'
    AND sourceip NOT IN (SELECT ip FROM reference set helpdesk_workstations)
    AND sourceip NOT IN (SELECT ip FROM reference set jump_servers)
    AND sourceip NOT IN (SELECT ip FROM reference set citrix_servers)
    AND NOT (
        sourceip LIKE '10.10.1.%'   -- IT Admin subnet
        OR sourceip LIKE '10.10.2.%' -- Helpdesk subnet
    )
LAST 24 HOURS
ORDER BY event_time DESC

-- Pivoting indicator: same host as both RDP source AND destination within 30 min
SELECT
    A.destinationip AS pivot_host,
    A.sourceip AS came_from,
    B.destinationip AS went_to,
    A.username AS user_a,
    B.username AS user_b,
    TIMESTAMPDIFF(MINUTE, A.starttime, B.starttime) AS pivot_delay_min
FROM events A
JOIN events B ON A.destinationip = B.sourceip
WHERE
    A."Event ID" = '4624' AND A."Logon Type" = '10'
    AND B."Event ID" = '4624' AND B."Logon Type" = '10'
    AND TIMESTAMPDIFF(MINUTE, A.starttime, B.starttime) BETWEEN 0 AND 30
LAST 8 HOURS
```

#### Splunk SPL
```spl
index=wineventlog EventCode=4624 LogonType=10
| lookup helpdesk_hosts src_ip AS src_ip OUTPUT is_helpdesk
| lookup jump_hosts src_ip AS src_ip OUTPUT is_jumphost
| where NOT (is_helpdesk=1 OR is_jumphost=1)
| where NOT (match(src_ip, "^10\.10\.[12]\."))
| stats count AS rdp_count, values(user) AS users, values(dest_host) AS targets,
         dc(dest_host) AS unique_targets, min(_time) AS first_seen, max(_time) AS last_seen
  BY src_ip
| eval hop_pattern=if(unique_targets >= 3, "PIVOTING", if(unique_targets >= 2, "SUSPECT", "SINGLE"))
| eval confidence=case(
    hop_pattern="PIVOTING", 90,
    hop_pattern="SUSPECT", 75,
    1==1, 60
  )
| where confidence >= 60
| table src_ip, users, targets, rdp_count, unique_targets, hop_pattern, confidence, first_seen, last_seen
```

---

### 4. Admin Share Access — \\HOST\C$ / ADMIN$

#### QRadar AQL
```aql
-- Admin share access: Event 5140 (network share access) for C$, ADMIN$, IPC$
SELECT
    DATEFORMAT(starttime, 'yyyy-MM-dd HH:mm:ss') AS event_time,
    sourceip,
    destinationip,
    username,
    "Share Name",
    "Share Path",
    "Access Mask"
FROM events
WHERE
    LOGSOURCETYPENAME(devicetype) = 'Microsoft Windows Security Event Log'
    AND "Event ID" IN ('5140', '5145')
    AND "Share Name" IN ('\\\\\*\\ADMIN$', '\\\\\*\\C$', '\\\\\*\\D$', '\\\\\*\\IPC$')
    AND username NOT LIKE '%$'                          -- exclude machine accounts
    AND sourceip NOT IN (SELECT ip FROM reference set sccm_servers)
    AND sourceip NOT IN (SELECT ip FROM reference set backup_servers)
    AND sourceip NOT IN (SELECT ip FROM reference set ad_servers)
LAST 24 HOURS
ORDER BY event_time DESC
```

#### Splunk SPL
```spl
index=wineventlog EventCode IN (5140, 5145)
| where match(ShareName, "\\\\\\\\[^\\\\]+\\\\(C\$|D\$|ADMIN\$|SYSVOL|NETLOGON)")
| where NOT match(user, "\$$")   -- machine accounts
| lookup sccm_servers dest_ip AS dest_ip OUTPUT is_sccm
| lookup backup_infra src_ip AS src_ip OUTPUT is_backup
| where NOT (is_sccm=1 OR is_backup=1)
| stats count AS access_count, values(ShareName) AS shares, dc(dest_host) AS hosts_accessed,
         values(EventCode) AS event_types, min(_time) AS first_access
  BY src_ip, user
| eval risky_share=if(mvcount(mvfilter(match(shares,"C\$|ADMIN\$"))) > 0, 1, 0)
| eval confidence=case(
    hosts_accessed >= 5 AND risky_share=1, 95,
    hosts_accessed >= 3 AND risky_share=1, 85,
    risky_share=1, 70,
    1==1, 50
  )
| where confidence >= 60
| sort -confidence
```

---

### 5. Pass-the-Ticket / Overpass-the-Hash

#### QRadar AQL
```aql
-- PtT: 4768 (TGT req) + 4769 (TGS) with RC4 encryption (0x17) from workstation
-- RC4 for Kerberos = NTLM hash used instead of AES key
SELECT
    DATEFORMAT(starttime, 'yyyy-MM-dd HH:mm:ss') AS event_time,
    sourceip,
    username,
    "Service Name",
    "Ticket Encryption Type" AS enc_type,
    "Ticket Options",
    "Failure Code"
FROM events
WHERE
    LOGSOURCETYPENAME(devicetype) = 'Microsoft Windows Security Event Log'
    AND "Event ID" IN ('4769', '4768')
    AND "Ticket Encryption Type" = '0x17'     -- RC4-HMAC (legacy, PtH indicator)
    AND NOT username LIKE '%$'
    AND NOT username LIKE 'ANONYMOUS%'
    AND sourceip NOT IN (SELECT ip FROM reference set known_rc4_hosts)  -- legacy systems
LAST 24 HOURS

-- Kerbrute / AS-REP Roasting: 4768 with preauth disabled
SELECT
    sourceip,
    COUNT(*) AS req_count,
    ARRAY_AGG(DISTINCT username) AS targeted_users
FROM events
WHERE
    "Event ID" = '4768'
    AND "Pre-Authentication Type" = '0'
    AND "Failure Code" NOT IN ('0x0', '0x17')
GROUP BY sourceip
HAVING req_count >= 5
LAST 1 HOURS
```

#### Splunk SPL
```spl
-- Pass-the-Ticket: RC4 TGS requests from domain-joined workstations
index=wineventlog EventCode=4769
| where TicketEncryptionType="0x17"
| where NOT match(TargetUserName, "\$$")
| where NOT match(TargetUserName, "ANONYMOUS")
| lookup rc4_exempt_hosts src_ip AS IpAddress OUTPUT is_exempt
| where NOT is_exempt=1
| stats count AS rc4_requests, values(ServiceName) AS services, dc(ServiceName) AS svc_count,
         min(_time) AS first_seen, max(_time) AS last_seen
  BY IpAddress, TargetUserName
| eval confidence=case(
    rc4_requests >= 10 AND svc_count >= 5, 90,   -- ticket harvesting
    rc4_requests >= 3 AND svc_count >= 2, 75,
    1==1, 55
  )
| where confidence >= 55
| sort -confidence
```

---

## True Positives (Echte Angriffsindikatoren)

### TP-001 — PsExec Lateral Movement Chain
- **Indikatoren:** Service `PSEXESVC` created on 3 hosts within 10 min from workstation `WS-FINANCE-042`; 4624 Type-3 logon with domain admin account; Sysmon 11 writing `PSEXESVC.exe` to `%TEMP%`
- **Confidence:** 97
- **MITRE:** T1021.002
- **Notes:** Service name obfuscation variants: `paexec`, `psexec64`, `remcom`, randomized names (VAR-001)

### TP-002 — WMI Remote Exec via Impacket wmiexec.py
- **Indikatoren:** `wmiprvse.exe` spawns `cmd.exe /Q /c whoami 1> \\127.0.0.1\ADMIN$\__[timestamp] 2>&1`; Sysmon 3 outbound 135/TCP + 49152-65535 (DCOM); Event 4624 Type-3 from attacker host; output redirected to ADMIN$ share
- **Confidence:** 96
- **MITRE:** T1047
- **Notes:** Impacket signature: `cmd.exe /Q /c` + `\\127.0.0.1\ADMIN$\__`

### TP-003 — RDP Pivoting via Compromised Jump Host
- **Indikatoren:** `svc_helpdesk` account (normally only on 10.10.2.0/24) authenticates via RDP from 192.168.244.55 (attacker C2 pivot); then RDP from 192.168.244.55 to 4 additional servers within 15 min; all Type-10 logons; account not in MFA group
- **Confidence:** 92
- **MITRE:** T1021.001

### TP-004 — Lateral Tool Transfer via Admin Share
- **Indikatoren:** Sysmon 11 file create: `\\TARGET\ADMIN$\mimikatz.exe`; followed by service install (7045) and 4624 Type-3; file hash matches known Mimikatz SHA256
- **Confidence:** 99 (known malware hash)
- **MITRE:** T1570

### TP-005 — Pass-the-Ticket (Silver Ticket)
- **Indikatoren:** 4769 with RC4 encryption (0x17) for service `cifs/fileserver01`; source is `WS-ACCT-007` (not DC); no corresponding 4768 (TGT request) — ticket forged locally; EventID 4771 absent
- **Confidence:** 88
- **MITRE:** T1550.003

---

## False Positives (Bekannte FP-Quellen)

| FP-ID  | Quelle                        | Erkennungsmerkmal                                        | Whitelist-Logik                                                         |
|--------|-------------------------------|----------------------------------------------------------|-------------------------------------------------------------------------|
| FP-001 | SCCM / Intune Deployment      | PSEXESVC, Type-3 logon, Admin share writes               | `sourceip IN sccm_servers` AND `username LIKE 'sccm_svc%'`             |
| FP-002 | Helpdesk RDP                  | Type-10 logon from helpdesk subnet                       | `sourceip IN helpdesk_subnet (10.10.2.0/24)` AND business hours        |
| FP-003 | Backup Agents (Veeam/Commvault)| Admin share access (C$, ADMIN$) to multiple hosts        | `sourceip IN backup_servers` AND `username IN backup_service_accounts`  |
| FP-004 | Legacy Systems RC4 Kerberos   | 4769 RC4 encryption from known legacy hosts              | `sourceip IN rc4_exempt_hosts` (XP, Server 2008 — must be documented)  |
| FP-005 | SolarWinds / Monitoring       | WMI queries generating wmiprvse child processes          | `sourceip IN monitoring_servers` AND `CommandLine NOT LIKE '%ADMIN$%'` |
| FP-006 | Domain Controller Replication | Elevated 4624 Type-3 between DCs                         | `sourceip IN domain_controllers` AND `destinationip IN domain_controllers` |
| FP-007 | Ansible / Automation          | WinRM (5985/5986) connections from automation hosts      | `sourceip IN ansible_controllers` AND port IN (5985,5986)              |

---

## Varianten / Evasion-Techniken

### VAR-001 — PsExec Service Name Obfuscation
- Attacker uses `-r <customname>` flag: `psexec \\target -r svchost32 cmd.exe`
- **Detection:** Sysmon 11 drop of executable to `%WINDIR%\` or `%TEMP%\` by `services.exe`; 7045 with any new service + binary path not in known-good list; file PE header analysis

### VAR-002 — WMI via PowerShell Remoting (WinRM T1021.006)
- `Invoke-Command -ComputerName TARGET -ScriptBlock { ... }` over port 5985/5986
- **Detection:** Sysmon 3: `wsmprovhost.exe` outbound; Sysmon 1: `wsmprovhost.exe` as parent of `cmd.exe`/`powershell.exe`; Event 4624 Type-3 with `AuthenticationPackageName=Kerberos`

### VAR-003 — DCOM Lateral Movement (ShellWindows, ShellBrowserWindow)
- `[activator]::CreateInstance([type]::GetTypeFromProgID("Excel.Application","TARGET"))` 
- **Detection:** Sysmon 3: `excel.exe` outbound DCOM; Sysmon 1: `explorer.exe` spawning unexpected child via DCOM; unusual COM server port 135 + ephemeral

### VAR-004 — SMB Relay (no credential needed)
- NTLM relay via Responder + ntlmrelayx — no explicit logon event on source
- **Detection:** 4648 (explicit credential use) on target; NTLM auth (not Kerberos) for admin share; source IP not in domain; 4624 with `AuthPackage=NTLM` for admin-level account

### VAR-005 — Over-Pass-the-Hash via Rubeus
- `Rubeus.exe asktgt /user:admin /rc4:<hash>` — requests TGT with NTLM hash, then uses Kerberos
- **Detection:** 4768 with RC4 encryption from workstation; immediately followed by 4769 for high-value services; Sysmon 1: `rubeus.exe` or renamed binary with known arg patterns

### VAR-006 — SSH Lateral Movement (T1021.004)
- OpenSSH for Windows used post-compromise for lateral movement
- **Detection:** Sysmon 3: `sshd.exe` or `ssh.exe` unusual connections; 4624 Type-3 with `AuthPackage=NTLM` to non-standard ports; new SSH authorized_keys written (Sysmon 11)

---

## Confidence Scoring

```python
from dataclasses import dataclass, field
from typing import List, Optional
import re

@dataclass
class LateralMovementEvent:
    source_ip: str
    dest_ip: str
    username: str
    event_ids: List[int]
    service_names: List[str]
    logon_types: List[int]
    parent_processes: List[str]
    child_processes: List[str]
    commandlines: List[str]
    share_names: List[str]
    kerberos_enc_types: List[str]
    hop_count: int = 0
    unique_targets: int = 0
    is_dc: bool = False
    is_in_jump_hosts: bool = False
    is_in_sccm_servers: bool = False
    is_in_backup_servers: bool = False
    is_in_helpdesk_subnet: bool = False
    is_in_monitoring_servers: bool = False

PSEXEC_SERVICE_NAMES = {"psexesvc", "paexec", "remcom", "execsvc"}
SHELL_PROCESSES = {
    "cmd.exe", "powershell.exe", "wscript.exe",
    "cscript.exe", "mshta.exe", "certutil.exe"
}
WMI_PARENTS = {"wmiprvse.exe", "wmiapsrv.exe"}
IMPACKET_WMI_PATTERN = re.compile(r"cmd\.exe\s+/Q\s+/c.*\\\\127\.0\.0\.1\\ADMIN\$\\__", re.IGNORECASE)
ADMIN_SHARES = {"c$", "d$", "admin$", "ipc$"}

def score_lateral_movement(evt: LateralMovementEvent) -> dict:
    score = 0
    reasons = []
    mitre_techniques = []

    # --- Whitelist suppressions ---
    if evt.is_in_sccm_servers and any(
        s.lower() in PSEXEC_SERVICE_NAMES for s in evt.service_names
    ):
        return {"confidence": 5, "verdict": "WHITELISTED_SCCM", "reasons": ["SCCM deployment"], "techniques": []}

    if evt.is_in_backup_servers and any(
        s.lower() in ADMIN_SHARES for s in evt.share_names
    ):
        return {"confidence": 5, "verdict": "WHITELISTED_BACKUP", "reasons": ["Backup agent admin share"], "techniques": []}

    if evt.is_in_helpdesk_subnet and 10 in evt.logon_types:
        return {"confidence": 10, "verdict": "WHITELISTED_HELPDESK", "reasons": ["Helpdesk RDP"], "techniques": []}

    # --- PsExec indicators ---
    matched_psexec = [s for s in evt.service_names if s.lower() in PSEXEC_SERVICE_NAMES]
    if matched_psexec:
        score += 45
        reasons.append(f"PsExec service name detected: {matched_psexec}")
        mitre_techniques.append("T1021.002")
        if 7045 in evt.event_ids and 3 in evt.logon_types:
            score += 20
            reasons.append("Service install (7045) + Type-3 logon confirms remote exec")

    # --- WMI exec indicators ---
    wmi_parent = any(p.lower().endswith(tuple(WMI_PARENTS)) for p in evt.parent_processes)
    wmi_shell_child = any(c.lower().endswith(tuple(SHELL_PROCESSES)) for c in evt.child_processes)
    if wmi_parent and wmi_shell_child:
        score += 50
        reasons.append("wmiprvse.exe spawning shell process")
        mitre_techniques.append("T1047")
        if any(IMPACKET_WMI_PATTERN.search(cl) for cl in evt.commandlines):
            score += 20
            reasons.append("Impacket wmiexec.py signature in commandline")

    # --- RDP lateral movement ---
    if 10 in evt.logon_types and not evt.is_in_jump_hosts:
        score += 30
        reasons.append("RDP logon (Type-10) from non-jump host")
        mitre_techniques.append("T1021.001")
        if evt.unique_targets >= 3:
            score += 25
            reasons.append(f"RDP pivoting: {evt.unique_targets} unique targets")
        elif evt.unique_targets >= 2:
            score += 15

    # --- Admin share access ---
    risky_shares = [s for s in evt.share_names if s.lower() in {"c$", "admin$"}]
    if risky_shares and not evt.is_in_backup_servers:
        score += 30
        reasons.append(f"Admin share access: {risky_shares}")
        mitre_techniques.append("T1570")

    # --- Pass-the-Ticket: RC4 encryption ---
    if "0x17" in evt.kerberos_enc_types and not evt.is_dc:
        score += 35
        reasons.append("RC4 Kerberos ticket from non-DC (PtT/OverPtH indicator)")
        mitre_techniques.append("T1550.003")

    # --- Hop count multiplier ---
    if evt.hop_count >= 3:
        score += 15
        reasons.append(f"Lateral chain of {evt.hop_count} hops")
    elif evt.hop_count >= 2:
        score += 8

    # --- Machine account exclusion ---
    if evt.username.endswith("$"):
        score = max(0, score - 20)
        reasons.append("Username is machine account — reducing score")

    confidence = min(100, score)
    verdict = (
        "HIGH" if confidence >= 80
        else "MEDIUM" if confidence >= 55
        else "LOW" if confidence >= 30
        else "INFORMATIONAL"
    )

    return {
        "confidence": confidence,
        "verdict": verdict,
        "reasons": reasons,
        "techniques": list(set(mitre_techniques))
    }
```

---

## Testfälle / Test Cases

| TC-ID  | Typ           | Beschreibung                                                                 | Expected Confidence | Expected Verdict |
|--------|---------------|------------------------------------------------------------------------------|---------------------|------------------|
| TC-001 | True Positive | PSEXESVC service + 7045 + 4624 Type-3, hop_count=3, not SCCM               | 85–100              | HIGH             |
| TC-002 | True Positive | wmiprvse.exe → cmd.exe + Impacket pattern in cmdline                        | 90–100              | HIGH             |
| TC-003 | True Positive | RDP Type-10 from workstation, unique_targets=5                              | 80–95               | HIGH             |
| TC-004 | True Positive | RC4 Kerberos (0x17) from workstation, not DC                                | 55–75               | MEDIUM           |
| TC-005 | True Positive | Admin share ADMIN$ access + service install from non-backup host            | 75–95               | HIGH             |
| TC-006 | False Positive | PSEXESVC from SCCM server + sccm_svc account                               | ≤10                 | WHITELISTED      |
| TC-007 | False Positive | Type-10 RDP from helpdesk_subnet (10.10.2.x)                               | ≤10                 | WHITELISTED      |
| TC-008 | False Positive | Admin share access from backup server (Veeam service account)              | ≤10                 | WHITELISTED      |
| TC-009 | True Positive | Pass-the-Ticket: 4769 RC4 + no prior 4768 TGT from same host               | 70–90               | HIGH/MEDIUM      |
| TC-010 | Edge Case     | wmiprvse.exe spawns cmd.exe from monitoring server (SolarWinds)             | 20–40               | LOW (after FP check) |
