# HUNT-008 — Privilege Escalation Detection
<!-- T1134 · T1548.002 · T1574 -->

---

## Überblick

| Feld              | Inhalt                                                                                                  |
|-------------------|---------------------------------------------------------------------------------------------------------|
| Hunt-ID           | HUNT-008                                                                                                |
| MITRE ATT&CK      | T1134 (Token Impersonation), T1548.002 (UAC Bypass), T1574 (DLL Hijacking)                            |
| Taktik            | Privilege Escalation, Defense Evasion                                                                   |
| Daten-Quellen     | Sysmon (1, 7, 12, 13), Windows Security (4624, 4672, 4688, 4697), Windows System (7045)               |
| Konfidenz-Basis   | Token impersonation privileges + UAC auto-elevation + DLL load from non-standard path                 |
| Autor             | SOC Engineering                                                                                         |
| Letzte Revision   | 2026-06-03                                                                                              |

---

## Erkennungslogik / Detection Logic

### 1. Token Impersonation — SeImpersonatePrivilege Abuse (JuicyPotato / PrintSpoofer)

**Theory:** `SeImpersonatePrivilege` held by service accounts (IIS, SQL, WCF) can be abused to escalate to SYSTEM. JuicyPotato uses DCOM; PrintSpoofer exploits the printer spooler named pipe.

#### QRadar AQL
```aql
-- Token impersonation: new process with elevated token, parent = service account
SELECT
    DATEFORMAT(starttime, 'yyyy-MM-dd HH:mm:ss') AS event_time,
    destinationip AS host,
    "SubjectUserName" AS subject_user,
    "NewProcessName" AS new_proc,
    "CommandLine",
    "ParentProcessName" AS parent_proc,
    "TokenElevationType" AS token_type,
    "PrivilegeList"
FROM events
WHERE
    LOGSOURCETYPENAME(devicetype) = 'Microsoft Windows Security Event Log'
    AND "Event ID" = '4688'
    AND (
        "PrivilegeList" LIKE '%SeImpersonatePrivilege%'
        OR "PrivilegeList" LIKE '%SeAssignPrimaryTokenPrivilege%'
        OR "PrivilegeList" LIKE '%SeTcbPrivilege%'
    )
    AND "SubjectUserName" IN (
        -- Service accounts typically holding SeImpersonate
        'IIS APPPOOL\*', 'NT SERVICE\*', 'MSSQL*', 'LocalService', 'NetworkService'
    )
    AND "TokenElevationType" = '%%1937'   -- TokenElevationTypeFull (elevated token)
LAST 24 HOURS

-- PrintSpoofer signature: spoolsv.exe spawning unexpected child
SELECT
    DATEFORMAT(starttime, 'yyyy-MM-dd HH:mm:ss') AS event_time,
    destinationip AS host,
    username,
    "Image",
    "CommandLine",
    "ParentImage",
    "IntegrityLevel"
FROM events
WHERE
    LOGSOURCETYPENAME(devicetype) IN ('Microsoft Sysmon', 'Sysmon')
    AND "Event ID" = '1'
    AND (
        -- PrintSpoofer: spoolsv as parent of cmd/powershell with high integrity
        (LOWER("ParentImage") LIKE '%spoolsv.exe'
         AND LOWER("Image") IN ('c:\windows\system32\cmd.exe', 'c:\windows\system32\windowspowershell\v1.0\powershell.exe')
         AND "IntegrityLevel" = 'System')
        -- JuicyPotato signature: COM server activation triggering SYSTEM shell
        OR (LOWER("CommandLine") LIKE '%-t *%' AND LOWER("CommandLine") LIKE '%-l %'
            AND (LOWER("Image") LIKE '%juicy%' OR LOWER("Image") LIKE '%potato%'))
        -- RoguePotato / SweetPotato
        OR LOWER("CommandLine") LIKE '%roguepotato%'
        OR LOWER("CommandLine") LIKE '%sweetpotato%'
    )
LAST 24 HOURS
```

#### Splunk SPL
```spl
-- Impersonation tool detection + privilege escalation patterns
index=sysmon EventCode=1
| eval potato_attack=case(
    match(lower(CommandLine), "(juicypotato|roguepotato|sweetpotato|printspoofer|godpotato|efspotato)"), "KNOWN_TOOL",
    match(lower(ParentImage), "spoolsv\.exe") AND lower(IntegrityLevel)="system"
      AND match(lower(Image), "(cmd\.exe|powershell\.exe)"), "PRINT_SPOOFER_SPAWN",
    match(lower(ParentImage), "dllhost\.exe") AND lower(IntegrityLevel)="system"
      AND match(lower(Image), "(cmd\.exe|powershell\.exe)"), "COM_IMPERSONATION",
    match(lower(CommandLine), "-t \* -p .* -l \d+"), "JUICYPOTATO_ARGS",
    1==1, null()
  )
| where isnotnull(potato_attack)
| eval confidence=case(
    potato_attack="KNOWN_TOOL", 99,
    potato_attack="PRINT_SPOOFER_SPAWN", 97,
    potato_attack="JUICYPOTATO_ARGS", 96,
    potato_attack="COM_IMPERSONATION", 88,
    1==1, 75
  )
| table _time, Computer, user, potato_attack, Image, CommandLine, ParentImage, IntegrityLevel, confidence
| sort -confidence
```

---

### 2. UAC Bypass — fodhelper.exe, eventvwr.exe, sdclt.exe (Registry Hijack)

**Theory:** Several Windows auto-elevating binaries read registry keys in HKCU before executing. An attacker can write a malicious command to these HKCU paths; when the auto-elevating binary runs, it executes attacker code at High integrity without a UAC prompt.

#### QRadar AQL
```aql
-- UAC bypass via registry hijack: write to HKCU auto-elevating key paths
SELECT
    DATEFORMAT(starttime, 'yyyy-MM-dd HH:mm:ss') AS event_time,
    destinationip AS host,
    username,
    "Image" AS writing_process,
    "TargetObject" AS reg_path,
    "Details" AS reg_value
FROM events
WHERE
    LOGSOURCETYPENAME(devicetype) IN ('Microsoft Sysmon', 'Sysmon')
    AND "Event ID" = '13'
    AND (
        -- fodhelper UAC bypass
        "TargetObject" LIKE '%\SOFTWARE\Classes\ms-settings\shell\open\command%'
        OR "TargetObject" LIKE '%\SOFTWARE\Classes\ms-settings\shell\open\command\DelegateExecute%'
        -- eventvwr bypass
        OR "TargetObject" LIKE '%\SOFTWARE\Classes\mscfile\shell\open\command%'
        -- sdclt bypass
        OR "TargetObject" LIKE '%\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\control.exe%'
        OR "TargetObject" LIKE '%\SOFTWARE\Classes\Folder\shell\open\command%'
        -- ComputerDefaults / WSReset bypass
        OR "TargetObject" LIKE '%\SOFTWARE\Classes\AppX82a6gwre4fdg3ha4eto8qpf55d0ka2ea\Shell\open\command%'
        -- Cmstp bypass
        OR "TargetObject" LIKE '%\Software\Microsoft\CMSTP\%'
    )
    AND LOWER("Image") NOT IN (
        'c:\windows\system32\msiexec.exe',
        'c:\windows\regedit.exe'
    )
LAST 24 HOURS
```

#### Splunk SPL
```spl
-- UAC bypass: registry write + auto-elevating binary execution
(index=sysmon EventCode=13
| eval uac_bypass_reg=case(
    match(TargetObject, "(?i)(\\\\SOFTWARE\\\\Classes\\\\ms-settings\\\\shell\\\\open\\\\command|\\\\SOFTWARE\\\\Classes\\\\mscfile\\\\shell\\\\open\\\\command|\\\\SOFTWARE\\\\Classes\\\\Folder\\\\shell\\\\open\\\\command|AppX82a6gwre4fdg3ha4eto8qpf55d0ka2ea\\\\Shell\\\\open\\\\command|\\\\CMSTP)"), "UAC_BYPASS_REG",
    1==1, null()
  )
| where isnotnull(uac_bypass_reg))

UNION

(index=sysmon EventCode=1
| eval uac_auto_elevate=case(
    lower(Image) IN ("c:\\windows\\system32\\fodhelper.exe","c:\\windows\\system32\\eventvwr.exe","c:\\windows\\system32\\sdclt.exe","c:\\windows\\system32\\computerdefaults.exe","c:\\windows\\system32\\wsreset.exe")
      AND lower(IntegrityLevel)="high" AND NOT (lower(ParentImage) LIKE "%explorer.exe" AND lower(CommandLine) = lower(Image)), "AUTO_ELEVATE_UNUSUAL",
    1==1, null()
  )
| where isnotnull(uac_auto_elevate))

| eval confidence=case(
    isnotnull(uac_bypass_reg), 95,
    isnotnull(uac_auto_elevate), 88,
    1==1, 70
  )
| table _time, Computer, user, uac_bypass_reg, uac_auto_elevate, TargetObject, Details, Image, IntegrityLevel, confidence
| sort -confidence
```

---

### 3. AlwaysInstallElevated — Registry Check + MSI Execution

#### Splunk SPL
```spl
-- AlwaysInstallElevated: both HKLM and HKCU must be set to 1
index=sysmon EventCode=13
| where match(TargetObject, "(?i)(HKLM|HKCU)\\\\SOFTWARE\\\\Policies\\\\Microsoft\\\\Windows\\\\Installer\\\\AlwaysInstallElevated")
  AND Details="DWORD (0x00000001)"
| stats count AS key_count, values(TargetObject) AS keys, values(Image) AS processes, min(_time) AS first_seen
  BY Computer, user
| where key_count >= 2   -- both HKLM + HKCU set
| eval confidence=97
| join type=left Computer [
    search index=sysmon EventCode=1 Image="*\\msiexec.exe" CommandLine="*.msi*"
    | stats min(_time) AS msi_exec_time, values(CommandLine) AS msi_cmdlines BY Computer
  ]
| eval confidence=if(isnotnull(msi_exec_time), 99, 97)
| eval reasoning=if(isnotnull(msi_exec_time), "AIE keys set + MSI execution detected", "AIE keys set — MSI execution pending")
| table Computer, user, keys, processes, reasoning, confidence, first_seen, msi_exec_time
```

---

### 4. DLL Hijacking — DLL in Writable Path Before System32

#### QRadar AQL
```aql
-- DLL loaded from suspicious path (Sysmon 7)
SELECT
    DATEFORMAT(starttime, 'yyyy-MM-dd HH:mm:ss') AS event_time,
    destinationip AS host,
    username,
    "Image" AS loading_process,
    "ImageLoaded" AS dll_path,
    "Company",
    "Description",
    "Signed",
    "Signature",
    "Hashes"
FROM events
WHERE
    LOGSOURCETYPENAME(devicetype) IN ('Microsoft Sysmon', 'Sysmon')
    AND "Event ID" = '7'
    AND "Signed" = 'false'
    AND (
        -- DLL in user-writable locations
        "ImageLoaded" LIKE 'C:\Users\%'
        OR "ImageLoaded" LIKE 'C:\Temp\%'
        OR "ImageLoaded" LIKE 'C:\ProgramData\%'
        OR "ImageLoaded" LIKE 'C:\Windows\Temp\%'
    )
    AND LOWER("Image") NOT IN (
        'c:\windows\system32\regsvr32.exe'   -- ignore regsvr32 normal use
    )
    -- Exclude known development paths
    AND "ImageLoaded" NOT LIKE 'C:\Users\%\Documents\Visual Studio%'
    AND "ImageLoaded" NOT LIKE 'C:\Users\%\AppData\Local\JetBrains%'
LAST 24 HOURS

-- Phantom DLL hijacking: known DLL name in non-standard path
SELECT
    DATEFORMAT(starttime, 'yyyy-MM-dd HH:mm:ss') AS event_time,
    destinationip AS host,
    "Image",
    "ImageLoaded",
    "Signed"
FROM events
WHERE
    LOGSOURCETYPENAME(devicetype) IN ('Microsoft Sysmon', 'Sysmon')
    AND "Event ID" = '7'
    AND "Signed" = 'false'
    AND (
        -- Known DLLs that are commonly phantomed
        "ImageLoaded" RLIKE '.*(wbemcomn|cryptsp|version|rasapi32|winmm|dwrite|ntwdblib|sfc|sfc_os|sysprep|cabinet)\.dll$'
    )
    AND "ImageLoaded" NOT LIKE 'C:\Windows\System32\%'
    AND "ImageLoaded" NOT LIKE 'C:\Windows\SysWOW64\%'
LAST 24 HOURS
```

#### Splunk SPL
```spl
-- DLL hijacking: unsigned DLL loaded from user-writable path by privileged process
index=sysmon EventCode=7
| where Signed="false"
| where match(lower(ImageLoaded), "^c:\\\\(users\\\\|temp\\\\|programdata\\\\|windows\\\\temp\\\\)")
| where NOT match(lower(ImageLoaded), "visual studio|jetbrains|nodejs|python|ruby")
| eval loading_proc_name=lower(replace(Image, ".*\\\\([^\\\\]+)$", "\1"))
| eval is_privileged_loader=if(match(loading_proc_name, "(lsass|services|svchost|spoolsv|dllhost|taskhost|wmiprvse)\.exe"), 1, 0)
| eval dll_name=lower(replace(ImageLoaded, ".*\\\\([^\\\\]+)$", "\1"))
| eval known_dll_phantom=if(match(dll_name, "^(wbemcomn|cryptsp|version|rasapi32|winmm|dwrite|ntwdblib|sfc_os|cabinet|sysprep)\.dll$"), 1, 0)
| eval confidence=case(
    is_privileged_loader=1 AND known_dll_phantom=1, 97,
    is_privileged_loader=1, 90,
    known_dll_phantom=1, 85,
    match(lower(ImageLoaded), "^c:\\\\users\\\\[^\\\\]+\\\\appdata\\\\"), 80,
    1==1, 65
  )
| where confidence >= 65
| table _time, Computer, user, Image, ImageLoaded, Signed, Company, confidence
| sort -confidence
```

---

## True Positives (Echte Angriffsindikatoren)

### TP-001 — PrintSpoofer SYSTEM Shell via IIS AppPool
- **Indikatoren:** `iis apppool\defaultapppool` executes `PrintSpoofer64.exe -i -c cmd.exe`; Sysmon 1: `spoolsv.exe` (IntegrityLevel=System) → `cmd.exe` (IntegrityLevel=System); followed by `whoami /priv` showing `SeImpersonatePrivilege`
- **Confidence:** 99
- **MITRE:** T1134.001

### TP-002 — fodhelper UAC Bypass
- **Indikatoren:** Sysmon 13: `HKCU\Software\Classes\ms-settings\shell\open\command` = `cmd.exe /c powershell.exe -nop -e <b64>`; then Sysmon 1: `fodhelper.exe` executes (auto-elevates); child `cmd.exe` at High integrity without UAC prompt
- **Confidence:** 97
- **MITRE:** T1548.002

### TP-003 — AlwaysInstallElevated Exploitation
- **Indikatoren:** Both `HKLM` and `HKCU` `AlwaysInstallElevated` = 1; `msiexec.exe /i C:\Users\attacker\payload.msi /quiet`; MSI creates new admin account; Event 4697 service install as SYSTEM
- **Confidence:** 99
- **MITRE:** T1548.002

### TP-004 — DLL Hijacking via Phantom DLL (Privilege Escalation)
- **Indikatoren:** Sysmon 7: `dwrite.dll` loaded by `dccw.exe` from `C:\Users\attacker\AppData\Local\` (not System32); unsigned; `dccw.exe` auto-elevates without UAC → payload runs at High integrity
- **Confidence:** 96
- **MITRE:** T1574.001

### TP-005 — JuicyPotato (Renamed) + CLSID Enumeration
- **Indikatoren:** Process named `svchost32.exe` with args `-t * -p C:\Windows\System32\cmd.exe -l 9001`; DCOM activation on port 9001; parent is `mssql$instance` (NetworkService account)
- **Confidence:** 95
- **MITRE:** T1134.001

---

## False Positives (Bekannte FP-Quellen)

| FP-ID  | Quelle                       | Erkennungsmerkmal                                                        | Whitelist-Logik                                                                     |
|--------|------------------------------|--------------------------------------------------------------------------|-------------------------------------------------------------------------------------|
| FP-001 | Software Installers          | AlwaysInstallElevated set by enterprise software deployment              | Both keys set during approved deployment window; reverted after install             |
| FP-002 | Developer Workstations       | Unsigned DLLs loaded from project build directories                     | Source in `developer_workstations` subnet + path matches known VS/IDE pattern      |
| FP-003 | UAC-aware admin actions      | fodhelper/eventvwr used legitimately by admin (normal elevation)         | User is local admin + UAC elevation dialog preceded the process (no registry write) |
| FP-004 | Application Virtualization   | DLLs loaded from VirtualStore or compatibility paths                    | Path contains `VirtualStore` or `CompatCache`; AppCompat telemetry confirms        |
| FP-005 | Vulnerability Scanners       | SeImpersonatePrivilege token check by Nessus/Tenable                   | Source IP in `scanner_ips`; process is known scanner agent                         |

---

## Varianten / Evasion-Techniken

### VAR-001 — Indirect CLSID Substitution (JuicyPotato Variants)
- Use less-detected CLSIDs; different DCOM port; rename binary to match legitimate service
- **Detection:** DCOM ephemeral port + renamed binary (Sysmon `OriginalFileName` field mismatch); elevated token from service account

### VAR-002 — Environmental Variable UAC Bypass (ProgramData)
- Abuse `%SystemRoot%` or `%WINDIR%` variables if writable; drop DLL at resolved path before auto-elevating binary
- **Detection:** Environment variable tampering (Sysmon 13 on environment keys); DLL load order

### VAR-003 — Token Manipulation via CreateProcessWithToken
- Steal token from SYSTEM process using OpenProcessToken + DuplicateTokenEx + CreateProcessWithToken without using known Potato tools
- **Detection:** 4688 with TokenElevationTypeFull for unexpected process; parent-child token level mismatch

### VAR-004 — Scheduled Task Elevation (T1053.005 + T1548)
- Create scheduled task running as SYSTEM to bypass UAC entirely
- **Detection:** Event 4698: task creator is non-admin user, task runs as SYSTEM; see HUNT-004

### VAR-005 — DLL Side-Loading via Trusted Binary
- Copy signed legitimate EXE (with side-loading vulnerability) to writable path along with malicious DLL
- **Detection:** Sysmon 11: signed EXE copied to unusual path; Sysmon 7: DLL loaded by that EXE from same unusual path

---

## Confidence Scoring

```python
from dataclasses import dataclass, field
from typing import List, Optional
import re

POTATO_TOOLS = re.compile(
    r"(?i)(juicypotato|roguepotato|sweetpotato|printspoofer|godpotato|efspotato|"
    r"genericpotato|badpotato|hotpotato|multipotato)",
    re.IGNORECASE
)

JUICYPOTATO_ARGS = re.compile(r"-t\s+\*\s+-p\s+\S+\s+-l\s+\d+", re.IGNORECASE)

UAC_BYPASS_REG_PATHS = [
    r"SOFTWARE\Classes\ms-settings\shell\open\command",
    r"SOFTWARE\Classes\mscfile\shell\open\command",
    r"SOFTWARE\Classes\Folder\shell\open\command",
    r"SOFTWARE\Classes\AppX82a6gwre4fdg3ha4eto8qpf55d0ka2ea\Shell\open\command",
    r"SOFTWARE\Microsoft\CMSTP",
]

UAC_AUTO_ELEVATE_BINARIES = {
    "fodhelper.exe", "eventvwr.exe", "sdclt.exe",
    "computerdefaults.exe", "wsreset.exe", "dccw.exe"
}

PHANTOM_DLLS = {
    "wbemcomn.dll", "cryptsp.dll", "version.dll", "rasapi32.dll",
    "winmm.dll", "dwrite.dll", "ntwdblib.dll", "sfc_os.dll",
    "cabinet.dll", "sysprep.dll"
}

PRIVILEGED_PROCS = {
    "lsass.exe", "services.exe", "svchost.exe", "spoolsv.exe",
    "dllhost.exe", "taskhost.exe", "wmiprvse.exe"
}

@dataclass
class PrivescEvent:
    host: str
    username: str
    # Token impersonation
    commandline: str = ""
    parent_image: str = ""
    image: str = ""
    integrity_level: str = ""
    privileges: List[str] = field(default_factory=list)
    is_service_account: bool = False
    # UAC bypass
    reg_path_written: str = ""
    reg_value_written: str = ""
    auto_elevate_binary_spawned: str = ""
    # DLL hijacking
    dll_path_loaded: str = ""
    dll_signed: bool = True
    dll_name: str = ""
    loading_process: str = ""
    # AlwaysInstallElevated
    aie_hklm_set: bool = False
    aie_hkcu_set: bool = False
    msi_executed: bool = False
    # Context
    is_developer_workstation: bool = False
    is_scanner: bool = False
    is_approved_action: bool = False

def score_privesc(evt: PrivescEvent) -> dict:
    if evt.is_approved_action or evt.is_scanner:
        return {"confidence": 5, "verdict": "WHITELISTED", "reasons": ["Approved/scanner context"], "techniques": []}

    score = 0
    reasons = []
    techniques = []

    # --- Potato-type attacks ---
    if POTATO_TOOLS.search(evt.commandline) or POTATO_TOOLS.search(evt.image):
        score += 70
        reasons.append("Known Potato-type tool detected in commandline or binary name")
        techniques.append("T1134.001")
    elif JUICYPOTATO_ARGS.search(evt.commandline):
        score += 65
        reasons.append("JuicyPotato argument pattern (-t * -p ... -l ...)")
        techniques.append("T1134.001")
    elif (evt.parent_image.lower().endswith("spoolsv.exe")
          and evt.image.lower().endswith(("cmd.exe", "powershell.exe"))
          and evt.integrity_level.lower() == "system"):
        score += 60
        reasons.append("spoolsv.exe spawning shell at SYSTEM integrity (PrintSpoofer)")
        techniques.append("T1134.001")

    if "SeImpersonatePrivilege" in evt.privileges and evt.is_service_account:
        score += 25
        reasons.append("SeImpersonatePrivilege held by service account")

    # --- UAC bypass ---
    if evt.reg_path_written and any(p.lower() in evt.reg_path_written.lower() for p in UAC_BYPASS_REG_PATHS):
        score += 55
        reasons.append(f"UAC bypass registry key written: {evt.reg_path_written}")
        techniques.append("T1548.002")
        if evt.auto_elevate_binary_spawned.lower() in UAC_AUTO_ELEVATE_BINARIES:
            score += 25
            reasons.append(f"Auto-elevating binary spawned after registry write: {evt.auto_elevate_binary_spawned}")

    # --- AlwaysInstallElevated ---
    if evt.aie_hklm_set and evt.aie_hkcu_set:
        score += 55
        reasons.append("Both HKLM and HKCU AlwaysInstallElevated = 1")
        techniques.append("T1548.002")
        if evt.msi_executed:
            score += 25
            reasons.append("MSI execution followed AlwaysInstallElevated configuration")

    # --- DLL hijacking ---
    if not evt.dll_signed and evt.dll_path_loaded:
        dll_in_user_path = re.match(r"(?i)C:\\(Users|Temp|ProgramData|Windows\\Temp)", evt.dll_path_loaded)
        loading_proc_name = evt.loading_process.lower().split("\\")[-1] if evt.loading_process else ""

        if dll_in_user_path:
            score += 30
            reasons.append(f"Unsigned DLL loaded from user-writable path: {evt.dll_path_loaded}")
            techniques.append("T1574.001")

            if evt.dll_name.lower() in PHANTOM_DLLS:
                score += 30
                reasons.append(f"Phantom DLL hijack: known DLL name {evt.dll_name} from non-System32 path")

            if loading_proc_name in PRIVILEGED_PROCS:
                score += 25
                reasons.append(f"Loaded by privileged process: {loading_proc_name}")

        if evt.is_developer_workstation and not evt.dll_name.lower() in PHANTOM_DLLS:
            score = max(0, score - 20)
            reasons.append("Developer workstation — partial suppression")

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
        "techniques": list(set(techniques))
    }
```

---

## Testfälle / Test Cases

| TC-ID  | Typ           | Beschreibung                                                                               | Expected Confidence | Expected Verdict |
|--------|---------------|--------------------------------------------------------------------------------------------|---------------------|------------------|
| TC-001 | True Positive | PrintSpoofer.exe from IIS AppPool → spoolsv.exe → cmd.exe (System integrity)              | 90–100              | HIGH             |
| TC-002 | True Positive | JuicyPotato args `-t * -p cmd.exe -l 9001` from NetworkService account                   | 88–100              | HIGH             |
| TC-003 | True Positive | fodhelper UAC bypass: HKCU ms-settings key written then fodhelper spawns High integrity shell | 88–100           | HIGH             |
| TC-004 | True Positive | AlwaysInstallElevated: both keys=1 + msiexec /i payload.msi /quiet                       | 92–100              | HIGH             |
| TC-005 | True Positive | Phantom DLL hijack: `dwrite.dll` unsigned, in AppData, loaded by `dccw.exe` (auto-elevates) | 88–97            | HIGH             |
| TC-006 | False Positive | Unsigned DLL in developer project path (Visual Studio build output) on dev workstation    | ≤20                 | INFORMATIONAL    |
| TC-007 | False Positive | Nessus scanner checking SeImpersonatePrivilege (scanner IP in whitelist)                  | ≤10                 | WHITELISTED      |
| TC-008 | False Positive | fodhelper opened by admin user directly (no prior registry write)                         | ≤25                 | LOW              |
| TC-009 | Edge Case     | Renamed JuicyPotato (svchost32.exe) — name mismatch detected by OriginalFileName          | 80–95               | HIGH             |
| TC-010 | Edge Case     | SeImpersonatePrivilege held by MSSQL service account, no Potato tool (monitoring only)    | 25–45               | LOW/MEDIUM       |
