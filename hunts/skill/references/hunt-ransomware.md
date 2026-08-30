# HUNT-007 — Ransomware Precursor & Execution Detection
<!-- T1490 · T1486 · T1489 -->

---

## Überblick

| Feld              | Inhalt                                                                                          |
|-------------------|-------------------------------------------------------------------------------------------------|
| Hunt-ID           | HUNT-007                                                                                        |
| MITRE ATT&CK      | T1490 (Inhibit System Recovery), T1486 (Data Encrypted for Impact), T1489 (Service Stop)       |
| Taktik            | Impact                                                                                          |
| Daten-Quellen     | Sysmon (1, 11, 13), Windows Security (4688, 4698), System (7036, 7045), Windows Defender       |
| Konfidenz-Basis   | Command + service patterns + file operation velocity + process context + temporal chain        |
| Autor             | SOC Engineering                                                                                 |
| Letzte Revision   | 2026-06-03                                                                                      |

---

## Erkennungslogik / Detection Logic

### 1. Volume Shadow Copy Deletion — T1490

**This is the single highest-fidelity ransomware precursor indicator. All major ransomware families delete VSS.**

#### QRadar AQL
```aql
SELECT
    DATEFORMAT(starttime, 'yyyy-MM-dd HH:mm:ss') AS event_time,
    destinationip AS host,
    username,
    "Image" AS process,
    "CommandLine",
    "ParentImage",
    "ParentCommandLine"
FROM events
WHERE
    LOGSOURCETYPENAME(devicetype) IN ('Microsoft Sysmon', 'Sysmon')
    AND "Event ID" = '1'
    AND (
        -- vssadmin variants
        (LOWER("Image") LIKE '%vssadmin.exe'
         AND LOWER("CommandLine") LIKE '%delete%shadow%')
        -- wmic shadowcopy
        OR (LOWER("Image") LIKE '%wmic.exe'
            AND LOWER("CommandLine") LIKE '%shadowcopy%delete%')
        -- wbadmin (backup catalog deletion)
        OR (LOWER("Image") LIKE '%wbadmin.exe'
            AND LOWER("CommandLine") LIKE '%delete%catalog%')
        -- bcdedit recovery disabled
        OR (LOWER("Image") LIKE '%bcdedit.exe'
            AND (LOWER("CommandLine") LIKE '%recoveryenabled%no%'
                 OR LOWER("CommandLine") LIKE '%bootstatuspolicy%ignoreallfailures%'))
        -- PowerShell VSS deletion
        OR (LOWER("Image") LIKE '%powershell.exe'
            AND LOWER("CommandLine") LIKE '%win32_shadowcopy%delete()%')
    )
LAST 24 HOURS
ORDER BY event_time DESC
```

#### Splunk SPL
```spl
-- VSS/Recovery destruction: high fidelity ransomware indicator
index=sysmon EventCode=1
| eval vss_action=case(
    match(lower(Image), "vssadmin\.exe") AND match(lower(CommandLine), "delete.{0,20}shadow"), "VSSADMIN_DELETE",
    match(lower(Image), "wmic\.exe") AND match(lower(CommandLine), "shadowcopy.{0,20}delete"), "WMIC_VSS_DELETE",
    match(lower(Image), "wbadmin\.exe") AND match(lower(CommandLine), "delete.{0,10}catalog"), "WBADMIN_DELETE",
    match(lower(Image), "bcdedit\.exe") AND match(lower(CommandLine), "(recoveryenabled.*no|bootstatuspolicy.*ignoreallfailures)"), "BCDEDIT_RECOVERY",
    match(lower(Image), "powershell\.exe") AND match(lower(CommandLine), "win32_shadowcopy.*delete\(\)"), "PS_VSS_DELETE",
    1==1, null()
  )
| where isnotnull(vss_action)
| eval confidence=case(
    vss_action IN ("VSSADMIN_DELETE","WMIC_VSS_DELETE"), 99,
    vss_action="WBADMIN_DELETE", 97,
    vss_action="BCDEDIT_RECOVERY", 95,
    vss_action="PS_VSS_DELETE", 97,
    1==1, 85
  )
| table _time, Computer, user, vss_action, CommandLine, ParentImage, confidence
| sort -_time
```

---

### 2. Backup Process Termination — T1489

#### QRadar AQL
```aql
SELECT
    DATEFORMAT(starttime, 'yyyy-MM-dd HH:mm:ss') AS event_time,
    destinationip AS host,
    username,
    "CommandLine",
    "Image"
FROM events
WHERE
    LOGSOURCETYPENAME(devicetype) IN ('Microsoft Sysmon', 'Sysmon')
    AND "Event ID" = '1'
    AND (
        LOWER("Image") IN ('c:\windows\system32\taskkill.exe', 'c:\windows\system32\net.exe', 'c:\windows\system32\sc.exe')
    )
    AND (
        -- Backup products
        LOWER("CommandLine") LIKE '%veeam%'
        OR LOWER("CommandLine") LIKE '%backup%exec%'
        OR LOWER("CommandLine") LIKE '%acronis%'
        OR LOWER("CommandLine") LIKE '%commvault%'
        OR LOWER("CommandLine") LIKE '%arcserve%'
        OR LOWER("CommandLine") LIKE '%dpmra%'          -- System Center DPM
        OR LOWER("CommandLine") LIKE '%obengine%'
        OR LOWER("CommandLine") LIKE '%agntsvc%'
        -- AV/Security products
        OR LOWER("CommandLine") LIKE '%windefend%'
        OR LOWER("CommandLine") LIKE '%wscsvc%'
        OR LOWER("CommandLine") LIKE '%wdnissvc%'
        OR LOWER("CommandLine") LIKE '%sense%'           -- Defender for Endpoint
        OR LOWER("CommandLine") LIKE '%mcafee%'
        OR LOWER("CommandLine") LIKE '%symantec%'
        OR LOWER("CommandLine") LIKE '%sophos%'
        -- Database services (often targeted for volume access)
        OR LOWER("CommandLine") LIKE '%sql%'
        OR LOWER("CommandLine") LIKE '%mysql%'
        OR LOWER("CommandLine") LIKE '%oracle%'
    )
LAST 24 HOURS
ORDER BY event_time DESC
```

#### Splunk SPL
```spl
-- Service/process termination targeting security and backup products
index=sysmon EventCode=1
| where lower(Image) IN ("c:\\windows\\system32\\taskkill.exe","c:\\windows\\system32\\net.exe","c:\\windows\\system32\\sc.exe","c:\\windows\\system32\\net1.exe")
| eval target_category=case(
    match(lower(CommandLine), "(veeam|backup exec|acronis|commvault|arcserve|dpmra|obengine|agntsvc|ntrtscan)"), "BACKUP_PRODUCT",
    match(lower(CommandLine), "(windefend|wscsvc|wdnissvc|sense|mcafee|symantec|sophos|mbamservice|avast|avg)"), "SECURITY_PRODUCT",
    match(lower(CommandLine), "(mssql|mysql|oracle|postgresql|mongodb|redis)"), "DATABASE_SERVICE",
    match(lower(CommandLine), "(eventlog|spooler|samss|lanmanserver|lanmanworkstation)"), "SYSTEM_SERVICE",
    1==1, null()
  )
| where isnotnull(target_category)
| stats count AS kill_count, values(CommandLine) AS kill_commands, values(target_category) AS categories,
         dc(target_category) AS category_count, min(_time) AS first_kill, max(_time) AS last_kill
  BY Computer, user, _time span=5m
| eval confidence=case(
    mvcount(mvfilter(match(categories,"SECURITY_PRODUCT"))) > 0 AND mvcount(mvfilter(match(categories,"BACKUP_PRODUCT"))) > 0, 98,
    mvcount(mvfilter(match(categories,"BACKUP_PRODUCT"))) > 0 AND kill_count >= 3, 95,
    mvcount(mvfilter(match(categories,"SECURITY_PRODUCT"))) > 0 AND kill_count >= 5, 93,
    kill_count >= 5, 85,
    1==1, 70
  )
| table _time, Computer, user, kill_count, category_count, categories, kill_commands, confidence
| sort -confidence
```

---

### 3. Mass File Encryption — T1486

#### QRadar AQL
```aql
-- Rapid file modification/rename velocity (Sysmon 11)
-- Ransomware modifies thousands of files per minute
SELECT
    DATEFORMAT(starttime, 'yyyy-MM-dd HH:mm:ss') AS event_time,
    destinationip AS host,
    username,
    "Image" AS process,
    COUNT(*) AS file_ops,
    COUNT(DISTINCT "TargetFilename") AS unique_files,
    -- Count known ransom extension patterns
    SUM(CASE WHEN "TargetFilename" RLIKE '\.[a-z0-9]{4,8}$'
             AND "TargetFilename" NOT RLIKE '\.(doc|docx|xls|xlsx|pdf|txt|jpg|png|exe|dll|sys)$'
        THEN 1 ELSE 0 END) AS renamed_to_unknown_ext
FROM events
WHERE
    LOGSOURCETYPENAME(devicetype) IN ('Microsoft Sysmon', 'Sysmon')
    AND "Event ID" = '11'
    AND "TargetFilename" NOT LIKE 'C:\Windows\%'
    AND "TargetFilename" NOT LIKE 'C:\Program Files\%'
GROUP BY DATEFORMAT(starttime, 'yyyy-MM-dd HH:mm'), destinationip, username, "Image"
HAVING file_ops > 200 AND unique_files > 100
ORDER BY file_ops DESC
LAST 30 MINUTES
```

#### Splunk SPL
```spl
-- Mass file modification: velocity-based ransomware detection
index=sysmon EventCode=11
| where NOT match(TargetFilename, "(?i)(C:\\\\Windows\\\\|C:\\\\Program Files)")
| eval file_ext=replace(lower(TargetFilename), ".*\\.([^.]+)$", "\1")
| eval is_known_ext=if(match(file_ext, "^(doc|docx|xls|xlsx|pdf|txt|jpg|jpeg|png|gif|mp4|mp3|zip|rar|7z|exe|dll|sys|msi|iso|vhd|vmdk|bak|sql|mdb|pst|ost)$"), 1, 0)
| stats count AS file_ops, dc(TargetFilename) AS unique_files,
         sum(eval(if(is_known_ext=0, 1, 0))) AS unknown_ext_writes,
         values(Image) AS processes, min(_time) AS first_op, max(_time) AS last_op
  BY Computer, user, _time span=1m
| eval ops_per_sec=file_ops / 60
| eval encryption_ratio=unknown_ext_writes / max(file_ops, 1)
| eval confidence=case(
    ops_per_sec > 50 AND encryption_ratio > 0.5, 97,
    ops_per_sec > 20 AND encryption_ratio > 0.3, 90,
    ops_per_sec > 50, 82,
    unique_files > 500 AND encryption_ratio > 0.3, 88,
    file_ops > 200 AND encryption_ratio > 0.5, 85,
    1==1, 60
  )
| where confidence >= 75
| table _time, Computer, user, file_ops, ops_per_sec, unique_files, encryption_ratio, processes, confidence
| sort -confidence
```

---

### 4. Recovery Mechanism Tampering — Registry + bcdedit

#### Splunk SPL
```spl
-- Recovery disablement: registry changes + bcdedit
(index=sysmon EventCode=1
| where match(lower(CommandLine), "(bcdedit.*(recoveryenabled.*no|bootstatuspolicy|safeboot)|wbadmin.*delete.*catalog|wmic.*shadowcopy.*delete|vssadmin.*delete)")
) OR (
index=sysmon EventCode=13
| where match(lower(TargetObject), "(\\\\safeboot|\\\\currentcontrolset\\\\control\\\\safeboot|\\\\currentcontrolset\\\\services\\\\.*start)")
  AND match(lower(Details), "(0x4|deleted)")  -- service disabled (start=4) or deleted
)
| eval recovery_action=case(
    match(lower(CommandLine), "recoveryenabled.*no"), "BCDEDIT_NO_RECOVERY",
    match(lower(CommandLine), "bootstatuspolicy.*ignoreallfailures"), "BCDEDIT_IGNORE_FAILURES",
    match(lower(CommandLine), "safeboot"), "SAFEBOOT_TAMPER",
    match(lower(CommandLine), "wbadmin.*delete"), "WBADMIN_CATALOG_DELETE",
    EventCode=13, "REGISTRY_SERVICE_DISABLE",
    1==1, "UNKNOWN"
  )
| eval confidence=case(
    recovery_action IN ("BCDEDIT_NO_RECOVERY","BCDEDIT_IGNORE_FAILURES"), 95,
    recovery_action="WBADMIN_CATALOG_DELETE", 97,
    recovery_action="SAFEBOOT_TAMPER", 88,
    recovery_action="REGISTRY_SERVICE_DISABLE", 75,
    1==1, 65
  )
| table _time, Computer, user, recovery_action, CommandLine, TargetObject, confidence
| sort -confidence
```

---

### 5. Ransomware Note Creation — Sysmon 11

#### Splunk SPL
```spl
-- Ransomware note file creation in multiple directories
index=sysmon EventCode=11
| eval filename_lower=lower(TargetFilename)
| where match(filename_lower, "(readme|how.to.decrypt|restore.files|your.files|encrypted|decrypt.instruction|ransom|recover.files|!!!|---decrypt---)")
  AND match(lower(TargetFilename), "\.(txt|html|htm|hta|bmp|jpg|png)$")
| stats count AS note_count, dc(TargetFilename) AS unique_note_paths,
         values(TargetFilename) AS note_files, min(_time) AS first_note
  BY Computer, Image, user, _time span=5m
| eval confidence=case(
    unique_note_paths >= 10, 99,
    unique_note_paths >= 5, 97,
    unique_note_paths >= 2, 90,
    1==1, 78
  )
| table _time, Computer, user, Image, note_count, unique_note_paths, note_files, confidence
| sort -confidence
```

---

## True Positives (Echte Angriffsindikatoren)

### TP-001 — LockBit 3.0 Full Kill Chain
- **Indikatoren (sequence):** T+0: `taskkill.exe /f /im veeam*` x8 services; T+1m: `vssadmin.exe delete shadows /all /quiet`; T+1m: `bcdedit.exe /set {default} recoveryenabled no`; T+2m: Sysmon 11 burst — 847 files/min with `.lockbit` extension; T+3m: `README.txt` created in 342 directories
- **Confidence:** 100
- **MITRE:** T1489, T1490, T1486

### TP-002 — Conti Ransomware Service Stop Script
- **Indikatoren:** PowerShell script iterating `Stop-Service` + `sc config start=disabled` for 160+ service names (known Conti target list); followed by `wmic shadowcopy delete`; file extension: `.CONTI`
- **Confidence:** 100

### TP-003 — BlackCat/ALPHV Pre-Encryption Behavior
- **Indikatoren:** `net stop windefend`; `Set-MpPreference -DisableRealtimeMonitoring $true`; VSS deletion via WMI; then ALPHV binary execution; characteristic file extensions + ransom note `RECOVER-[ID]-FILES.txt`
- **Confidence:** 100

### TP-004 — Ransomware Preparation Without Execution (Caught Early)
- **Indikatoren:** Only VSS deletion + service stops observed; encryption NOT yet started; attacker killed before payload executed
- **Confidence:** 93 (partial chain)

### TP-005 — Wiper Masquerading as Ransomware
- **Indikatoren:** Same VSS/service kill pattern; but file modification does NOT change extensions (overwrites with random bytes); no ransom note; `dd.exe` or `sdelete.exe` seen
- **Confidence:** 88 (wiper, not ransomware — but same precursor detection applies)

---

## False Positives (Bekannte FP-Quellen)

| FP-ID  | Quelle                           | Erkennungsmerkmal                                                      | Whitelist-Logik                                                                     |
|--------|----------------------------------|------------------------------------------------------------------------|-------------------------------------------------------------------------------------|
| FP-001 | Legitimate Backup (Veeam)        | VSS snapshot creation/deletion as part of backup cycle                 | `vssadmin` with `/add` or `/create`; NOT `/delete`; source = Veeam service account |
| FP-002 | Sysadmin Maintenance             | Manual VSS deletion by admin for disk space recovery                   | User in `Domain Admins` + scheduled maintenance window + change ticket exists       |
| FP-003 | Software Install/Update          | Service stop during update (e.g., AV engine update stops service)      | `sc stop` from signed installer in `%ProgramFiles%` + followed by service restart  |
| FP-004 | Bulk File Copy/Migration         | High file operation velocity (robocopy, xcopy large migrations)        | `robocopy.exe` / `xcopy.exe` as creating process; no extension changes             |
| FP-005 | Test/Dev Environments            | Security testing (tabletop exercises, ransomware simulation tools)     | Source in `lab_subnet` + change request exists                                      |
| FP-006 | Database Backup Rotation         | SQL VSS writer deletions by backup agent                               | Process is backup agent service account; DELETE has `/for=[date]` qualifier        |

---

## Varianten / Evasion-Techniken

### VAR-001 — Safe Mode Reboot for Encryption (Snatch Ransomware)
- Register as auto-run service, reboot into safe mode (AV disabled), encrypt, reboot normal
- **Detection:** Registry `HKLM\SYSTEM\CurrentControlSet\Control\SafeBoot\Minimal\` new service entry (Sysmon 12/13); bcdedit `/set {current} safeboot minimal`

### VAR-002 — WMI for VSS Deletion (No vssadmin)
- `Get-WmiObject Win32_ShadowCopy | ForEach-Object { $_.Delete() }` — no vssadmin.exe process
- **Detection:** Sysmon 1: PowerShell with `Win32_ShadowCopy` and `Delete()` in cmdline; PS 4104 script block

### VAR-003 — Ransomware Delivered via GPO (Domain-Wide)
- After domain compromise, ransomware binary deployed via GPO startup script — simultaneous execution on all hosts
- **Detection:** AD event 5136 (GPO modification) + new startup script path + file drop on SYSVOL (Sysmon 11 on DC)

### VAR-004 — Intermittent Encryption (Partial Files Only)
- Encrypts only first/last 512KB of each file to be faster and evade velocity detection
- **Detection:** File modification rate still elevated; focus on extension changes + entropy increase of modified files

### VAR-005 — LOLBin-Based Encryption (NirSoft, certutil)
- Use legitimate tools for "encryption" to confuse analysts: `certutil -encode` in batch loop
- **Detection:** `certutil.exe` spawning in rapid loop from unusual parent; mass file writes by certutil

### VAR-006 — Double Extortion Staging (Exfil First)
- Exfil data before encryption (see HUNT-006); ransomware execution comes after data theft
- **Detection:** Correlate exfiltration events (HUNT-006) with ransomware precursors as temporal chain

---

## Confidence Scoring

```python
from dataclasses import dataclass, field
from typing import List
import re

VSS_DELETE_PATTERNS = [
    re.compile(r"vssadmin\.exe.*delete.*shadow", re.IGNORECASE),
    re.compile(r"wmic\.exe.*shadowcopy.*delete", re.IGNORECASE),
    re.compile(r"wbadmin\.exe.*delete.*catalog", re.IGNORECASE),
    re.compile(r"powershell.*win32_shadowcopy.*delete\(\)", re.IGNORECASE),
]

RECOVERY_DISABLE_PATTERNS = [
    re.compile(r"bcdedit.*recoveryenabled.*no", re.IGNORECASE),
    re.compile(r"bcdedit.*bootstatuspolicy.*ignoreallfailures", re.IGNORECASE),
    re.compile(r"bcdedit.*safeboot", re.IGNORECASE),
]

BACKUP_KILL_TERMS = [
    "veeam", "backup exec", "acronis", "commvault", "arcserve", "dpmra",
    "obengine", "agntsvc", "ntrtscan", "dbsrv12", "sqlagent", "sqlbrowser",
    "msexchangemgmt", "ocssd", "oracle", "synctime"
]

AV_KILL_TERMS = [
    "windefend", "wscsvc", "wdnissvc", "sense", "mcshield", "mfewc",
    "bedbg", "sophos", "mbamservice", "avast", "avg", "kavfs",
    "klnagent", "tmlisten", "nod32", "ccevtmgr"
]

RANSOM_NOTE_PATTERNS = re.compile(
    r"(?i)(readme|how.to.decrypt|restore.files|your.files.are.encrypted|"
    r"decrypt.instruction|ransom|recover.files|!!!decrypt!!!|---decrypt---)",
    re.IGNORECASE
)

@dataclass
class RansomwareIndicators:
    host: str
    username: str
    # VSS/Recovery indicators
    vss_deletion_count: int = 0
    recovery_disable_count: int = 0
    wbadmin_delete: bool = False
    # Service kill indicators
    backup_kills: List[str] = field(default_factory=list)
    av_kills: List[str] = field(default_factory=list)
    db_kills: List[str] = field(default_factory=list)
    # File operation indicators
    file_ops_per_min: float = 0.0
    unique_files_modified: int = 0
    unknown_extension_ratio: float = 0.0
    ransom_notes_created: int = 0
    # Context
    is_backup_context: bool = False
    is_maintenance_window: bool = False
    is_lab_environment: bool = False
    commandlines: List[str] = field(default_factory=list)

def score_ransomware(evt: RansomwareIndicators) -> dict:
    if evt.is_lab_environment:
        return {"confidence": 5, "verdict": "LAB_SUPPRESSED", "reasons": ["Lab environment"], "techniques": []}

    score = 0
    reasons = []
    techniques = []

    # --- VSS deletion (highest weight) ---
    vss_matches = sum(1 for cl in evt.commandlines if any(p.search(cl) for p in VSS_DELETE_PATTERNS))
    if vss_matches > 0:
        score += 60
        reasons.append(f"VSS/shadow copy deletion: {vss_matches} command(s)")
        techniques.append("T1490")
        if evt.is_backup_context:
            score -= 30
            reasons.append("Backup context detected — reducing score")

    # --- Recovery disablement ---
    rec_matches = sum(1 for cl in evt.commandlines if any(p.search(cl) for p in RECOVERY_DISABLE_PATTERNS))
    if rec_matches > 0:
        score += 25
        reasons.append(f"Recovery mechanism disabled: {rec_matches} command(s)")
        techniques.append("T1490")

    # --- Service/process termination ---
    backup_hits = [t for t in evt.backup_kills if any(term in t.lower() for term in BACKUP_KILL_TERMS)]
    av_hits = [t for t in evt.av_kills if any(term in t.lower() for term in AV_KILL_TERMS)]

    if backup_hits:
        score += 25 + min(len(backup_hits) * 3, 15)
        reasons.append(f"Backup product processes/services killed: {backup_hits[:3]}")
        techniques.append("T1489")
    if av_hits:
        score += 20 + min(len(av_hits) * 2, 10)
        reasons.append(f"AV/security product processes killed: {av_hits[:3]}")
        techniques.append("T1562.001")
    if evt.db_kills:
        score += 10
        reasons.append("Database services stopped (volume access preparation)")

    # --- File encryption velocity ---
    if evt.file_ops_per_min > 200:
        score += 40
        reasons.append(f"Extreme file modification rate: {evt.file_ops_per_min:.0f}/min")
        techniques.append("T1486")
    elif evt.file_ops_per_min > 50:
        score += 25
        reasons.append(f"High file modification rate: {evt.file_ops_per_min:.0f}/min")

    if evt.unknown_extension_ratio > 0.5 and evt.unique_files_modified > 100:
        score += 35
        reasons.append(f"Mass file renaming to unknown extensions: {evt.unknown_extension_ratio:.0%} of {evt.unique_files_modified} files")
        techniques.append("T1486")

    # --- Ransom notes ---
    if evt.ransom_notes_created >= 10:
        score += 30
        reasons.append(f"Ransom notes created in {evt.ransom_notes_created} locations")
    elif evt.ransom_notes_created >= 2:
        score += 20

    # --- Maintenance window suppression ---
    if evt.is_maintenance_window and vss_matches > 0 and not av_hits and not backup_hits:
        score = max(0, score - 25)
        reasons.append("Maintenance window active — partial suppression")

    confidence = min(100, score)
    verdict = (
        "CRITICAL" if confidence >= 95
        else "HIGH" if confidence >= 80
        else "MEDIUM" if confidence >= 55
        else "LOW" if confidence >= 30
        else "INFORMATIONAL"
    )

    return {
        "confidence": confidence,
        "verdict": verdict,
        "reasons": reasons,
        "techniques": list(set(techniques))
    }
```

---

## Testfälle / Test Cases

| TC-ID  | Typ           | Beschreibung                                                                               | Expected Confidence | Expected Verdict |
|--------|---------------|--------------------------------------------------------------------------------------------|---------------------|------------------|
| TC-001 | True Positive | VSS delete + recovery disable + service kills (backup+AV) + >200 file ops/min             | 98–100              | CRITICAL         |
| TC-002 | True Positive | VSS delete + 10+ ransom notes created in different dirs                                    | 88–98               | HIGH/CRITICAL    |
| TC-003 | True Positive | Service kill only (backup+AV, 8 services) — no encryption yet                             | 55–75               | MEDIUM           |
| TC-004 | True Positive | Mass file modification > 100 files/min, 60% unknown extension ratio                       | 78–92               | HIGH             |
| TC-005 | True Positive | VSS deletion via PowerShell Win32_ShadowCopy.Delete()                                      | 88–98               | HIGH/CRITICAL    |
| TC-006 | False Positive | vssadmin delete in Veeam backup job context (backup_context=True)                         | ≤30                 | LOW              |
| TC-007 | False Positive | sc stop [service] during legitimate software update (from signed installer)                | ≤20                 | INFORMATIONAL    |
| TC-008 | False Positive | Large robocopy migration (high file ops, no extension changes, no VSS delete)             | ≤25                 | LOW              |
| TC-009 | Edge Case     | Safe mode reboot registration + bcdedit safeboot (Snatch variant)                         | 75–90               | HIGH             |
| TC-010 | Edge Case     | VSS deletion during maintenance window, no service kills, no file ops                     | 35–50               | LOW/MEDIUM       |
