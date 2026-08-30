# HUNT-009 — Active Directory Enumeration Detection
<!-- T1087.002 · T1069.002 · T1018 -->

---

## Überblick

| Feld              | Inhalt                                                                                                    |
|-------------------|-----------------------------------------------------------------------------------------------------------|
| Hunt-ID           | HUNT-009                                                                                                  |
| MITRE ATT&CK      | T1087.002 (Domain Account Discovery), T1069.002 (Domain Groups), T1018 (Remote System Discovery)        |
| Taktik            | Discovery                                                                                                 |
| Daten-Quellen     | Windows Security (4662, 4624, 4769, 4776), Sysmon (1, 3), LDAP/Kerberos logs, Network (NetFlow)         |
| Konfidenz-Basis   | LDAP query patterns + net.exe arguments + BloodHound LDAP filters + Kerberos ticket anomalies           |
| Autor             | SOC Engineering                                                                                           |
| Letzte Revision   | 2026-06-03                                                                                                |

---

## Erkennungslogik / Detection Logic

### 1. BloodHound / SharpHound LDAP Enumeration

**Theory:** BloodHound uses specific LDAP queries with characteristic filters to enumerate ACLs, SPNs, and group memberships. The combination of query patterns, source (workstation not server), and volume is highly indicative.

#### QRadar AQL
```aql
-- BloodHound LDAP queries: sensitive object access Event 4662
-- Object types accessed: computer, user, group, GPO with specific attribute access
SELECT
    DATEFORMAT(starttime, 'yyyy-MM-dd HH:mm:ss') AS event_time,
    sourceip AS enum_source,
    username,
    "Object Type",
    "Object Name",
    "Properties" AS accessed_properties,
    "Access Mask",
    COUNT(*) OVER (PARTITION BY sourceip, DATE(starttime)) AS daily_query_count
FROM events
WHERE
    LOGSOURCETYPENAME(devicetype) = 'Microsoft Windows Security Event Log'
    AND "Event ID" = '4662'
    AND "Access Mask" = '0x100'   -- ReadProperty
    AND (
        -- ACL-sensitive properties (BloodHound targets)
        "Properties" LIKE '%1131f6aa-9c07-11d1-f79f-00c04fc2dcd2%'  -- DS-Replication-Get-Changes
        OR "Properties" LIKE '%1131f6ad-9c07-11d1-f79f-00c04fc2dcd2%' -- DS-Replication-Get-Changes-All
        OR "Properties" LIKE '%nTSecurityDescriptor%'
        OR "Properties" LIKE '%msDS-AllowedToActOnBehalfOfOtherIdentity%'
        OR "Properties" LIKE '%msDS-GroupMSAMembership%'
        OR "Properties" LIKE '%servicePrincipalName%'
        OR "Properties" LIKE '%member%'
        OR "Properties" LIKE '%adminCount%'
    )
    AND sourceip NOT IN (SELECT ip FROM reference set domain_controllers)
    AND sourceip NOT IN (SELECT ip FROM reference set ad_management_servers)
LAST 4 HOURS

-- Rate: >100 4662 events from single workstation in 1 hour
SELECT
    sourceip,
    COUNT(*) AS ldap_query_count,
    COUNT(DISTINCT "Object Name") AS unique_objects,
    ARRAY_AGG(DISTINCT "Object Type") AS object_types
FROM events
WHERE
    "Event ID" = '4662'
    AND sourceip NOT IN (SELECT ip FROM reference set domain_controllers)
LAST 1 HOURS
GROUP BY sourceip
HAVING ldap_query_count > 100
ORDER BY ldap_query_count DESC
```

#### Splunk SPL
```spl
-- BloodHound LDAP: characteristic sensitive attribute access
index=wineventlog EventCode=4662
| where NOT (src_ip IN (dc_ips) OR src_ip IN (ad_mgmt_ips))
| eval bloodhound_attr=case(
    match(Properties, "(1131f6aa|1131f6ad|1131f6ac|89e95b76|9923a32a|1131f6ab)"), "REPLICATION_RIGHTS",
    match(lower(Properties), "ntsecuritydescriptor"), "SECURITY_DESCRIPTOR",
    match(lower(Properties), "msds-allowedtoact"), "RBCD_DELEGATION",
    match(lower(Properties), "(member|memberof|admincount)"), "GROUP_MEMBERSHIP",
    match(lower(Properties), "serviceprincipalname"), "SPN_ENUM",
    match(lower(Properties), "msds-groupmsamembership"), "GMSA_MEMBERSHIP",
    1==1, "OTHER"
  )
| stats count AS query_count, dc(ObjectName) AS unique_objects,
         values(bloodhound_attr) AS queried_attrs, dc(bloodhound_attr) AS attr_variety,
         min(_time) AS first_query, max(_time) AS last_query
  BY SubjectUserName, SubjectLogonId, IpAddress, _time span=30m
| eval duration_min=(last_query - first_query) / 60
| eval query_rate=query_count / max(duration_min, 1)
| eval confidence=case(
    attr_variety >= 5 AND query_count >= 200, 97,
    mvcount(mvfilter(match(queried_attrs, "REPLICATION_RIGHTS"))) > 0 AND query_count >= 50, 95,
    attr_variety >= 3 AND query_count >= 100, 88,
    query_count >= 50 AND attr_variety >= 2, 78,
    query_count >= 100, 72,
    1==1, 55
  )
| where confidence >= 60
| table _time, IpAddress, SubjectUserName, query_count, unique_objects, queried_attrs, query_rate, confidence
| sort -confidence
```

---

### 2. net.exe / net1.exe AD Enumeration

#### QRadar AQL
```aql
SELECT
    DATEFORMAT(starttime, 'yyyy-MM-dd HH:mm:ss') AS event_time,
    destinationip AS host,
    username,
    "CommandLine",
    "Image",
    "ParentImage"
FROM events
WHERE
    LOGSOURCETYPENAME(devicetype) IN ('Microsoft Sysmon', 'Sysmon')
    AND "Event ID" = '1'
    AND LOWER("Image") IN ('c:\windows\system32\net.exe', 'c:\windows\system32\net1.exe')
    AND (
        LOWER("CommandLine") LIKE '%user /domain%'
        OR LOWER("CommandLine") LIKE '%group%domain admins%'
        OR LOWER("CommandLine") LIKE '%group%enterprise admins%'
        OR LOWER("CommandLine") LIKE '%group%schema admins%'
        OR LOWER("CommandLine") LIKE '%group%domain controllers%'
        OR LOWER("CommandLine") LIKE '%group%domain computers%'
        OR LOWER("CommandLine") LIKE '%localgroup administrators%'
        OR LOWER("CommandLine") LIKE '%accounts /domain%'
        OR LOWER("CommandLine") LIKE '%view /domain%'
    )
LAST 24 HOURS

-- Burst detection: same host running net.exe >10 times in 5 min
SELECT
    destinationip AS host,
    username,
    COUNT(*) AS cmd_count,
    ARRAY_AGG("CommandLine") AS commands
FROM events
WHERE
    LOGSOURCETYPENAME(devicetype) IN ('Microsoft Sysmon', 'Sysmon')
    AND "Event ID" = '1'
    AND LOWER("Image") IN ('c:\windows\system32\net.exe', 'c:\windows\system32\net1.exe')
LAST 30 MINUTES
GROUP BY destinationip, username
HAVING cmd_count > 10
```

#### Splunk SPL
```spl
-- net.exe AD enumeration: query classification + burst detection
index=sysmon EventCode=1
| where lower(Image) IN ("c:\\windows\\system32\\net.exe","c:\\windows\\system32\\net1.exe")
| eval enum_type=case(
    match(lower(CommandLine), "user\s+/domain"), "USER_ENUM",
    match(lower(CommandLine), "group.*(domain admins|enterprise admins|schema admins|domain controllers|domain computers)"), "PRIV_GROUP_ENUM",
    match(lower(CommandLine), "group.*(/domain|domain\s)"), "GROUP_ENUM",
    match(lower(CommandLine), "accounts\s+/domain"), "ACCOUNT_POLICY",
    match(lower(CommandLine), "view\s+/domain"), "COMPUTER_ENUM",
    match(lower(CommandLine), "localgroup administrators"), "LOCAL_ADMIN_CHECK",
    1==1, "OTHER"
  )
| where enum_type != "OTHER"
| stats count AS cmd_count, values(enum_type) AS enum_types, values(CommandLine) AS cmds,
         dc(enum_type) AS variety, min(_time) AS first_cmd, max(_time) AS last_cmd
  BY Computer, user, _time span=10m
| eval confidence=case(
    variety >= 4 AND cmd_count >= 5, 90,
    mvcount(mvfilter(match(enum_types,"PRIV_GROUP_ENUM"))) > 0 AND variety >= 2, 85,
    variety >= 3, 78,
    cmd_count >= 5, 72,
    mvcount(mvfilter(match(enum_types,"PRIV_GROUP_ENUM"))) > 0, 70,
    1==1, 55
  )
| where confidence >= 60
| table _time, Computer, user, cmd_count, variety, enum_types, cmds, confidence
| sort -confidence
```

---

### 3. PowerView / PowerShell AD Enumeration

#### QRadar AQL (PowerShell 4104)
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
        -- PowerView functions
        LOWER("ScriptBlockText") LIKE '%get-domainuser%'
        OR LOWER("ScriptBlockText") LIKE '%get-domaingroup%'
        OR LOWER("ScriptBlockText") LIKE '%get-domaincomputer%'
        OR LOWER("ScriptBlockText") LIKE '%get-domaingpo%'
        OR LOWER("ScriptBlockText") LIKE '%get-domaintrust%'
        OR LOWER("ScriptBlockText") LIKE '%get-objectacl%'
        OR LOWER("ScriptBlockText") LIKE '%find-interestingdomainacl%'
        OR LOWER("ScriptBlockText") LIKE '%invoke-acl%'
        OR LOWER("ScriptBlockText") LIKE '%get-netcomputer%'         -- older PowerView
        OR LOWER("ScriptBlockText") LIKE '%get-netuser%'
        -- AD module variants
        OR LOWER("ScriptBlockText") LIKE '%get-aduser%'
        OR LOWER("ScriptBlockText") LIKE '%get-adgroup%'
        OR LOWER("ScriptBlockText") LIKE '%get-adcomputer%'
        OR LOWER("ScriptBlockText") LIKE '%get-adtrust%'
        -- LDAP filter enumeration
        OR LOWER("ScriptBlockText") LIKE '%(samaccounttype=805306368)%'
        OR LOWER("ScriptBlockText") LIKE '%(useraccountcontrol:1.2.840.113549%)%'
        OR LOWER("ScriptBlockText") LIKE '%ldap://dc%'
    )
LAST 24 HOURS
```

#### Splunk SPL
```spl
index=powershell EventCode=4104
| eval powerview_func=case(
    match(lower(ScriptBlockText), "(get-domainuser|get-netuser)"), "USER_ENUM",
    match(lower(ScriptBlockText), "(get-domaingroup|get-netgroup)"), "GROUP_ENUM",
    match(lower(ScriptBlockText), "(get-domaincomputer|get-netcomputer)"), "COMPUTER_ENUM",
    match(lower(ScriptBlockText), "(get-domaingpo|get-gpo)"), "GPO_ENUM",
    match(lower(ScriptBlockText), "(get-domaintrust|get-nettrust)"), "TRUST_ENUM",
    match(lower(ScriptBlockText), "(get-objectacl|find-interestingdomainacl|invoke-acl)"), "ACL_ENUM",
    match(lower(ScriptBlockText), "(get-domaindfsshare|get-netshare)"), "SHARE_ENUM",
    match(lower(ScriptBlockText), "(find-localadminaccess|invoke-enumlocaladmin)"), "LOCAL_ADMIN_ENUM",
    match(lower(ScriptBlockText), "samaccounttype=805306368|admincount=1|msds-allowedtoactonbehalfofotheridentity"), "LDAP_FILTER",
    1==1, null()
  )
| where isnotnull(powerview_func)
| stats count AS script_count, values(powerview_func) AS functions, dc(powerview_func) AS func_variety,
         values(ScriptBlockText) AS blocks
  BY Computer, user, _time span=15m
| eval confidence=case(
    func_variety >= 5, 97,
    mvcount(mvfilter(match(functions,"ACL_ENUM"))) > 0 AND func_variety >= 3, 95,
    mvcount(mvfilter(match(functions,"(LOCAL_ADMIN_ENUM|ACL_ENUM)"))) > 0, 90,
    func_variety >= 3, 85,
    func_variety >= 2, 75,
    1==1, 65
  )
| where confidence >= 65
| table _time, Computer, user, func_variety, functions, script_count, confidence
| sort -confidence
```

---

### 4. Excessive Kerberos TGS Requests (Kerberoasting)

#### QRadar AQL
```aql
-- Kerberoasting: many TGS requests from single host for service accounts
SELECT
    sourceip AS attacking_host,
    username,
    COUNT(*) AS tgs_count,
    COUNT(DISTINCT "Service Name") AS unique_services,
    -- RC4 used for Kerberoasting
    SUM(CASE WHEN "Ticket Encryption Type" = '0x17' THEN 1 ELSE 0 END) AS rc4_tickets
FROM events
WHERE
    LOGSOURCETYPENAME(devicetype) = 'Microsoft Windows Security Event Log'
    AND "Event ID" = '4769'
    AND NOT username LIKE '%$'
    AND "Service Name" NOT IN ('krbtgt', 'kadmin')
    AND NOT "Service Name" LIKE 'ldap/%'
    AND NOT "Service Name" LIKE 'host/%'
    AND NOT "Service Name" LIKE 'cifs/%'  -- normal SMB tickets
    AND NOT "Service Name" LIKE 'dns/%'
    AND sourceip NOT IN (SELECT ip FROM reference set domain_controllers)
LAST 4 HOURS
GROUP BY sourceip, username
HAVING tgs_count >= 5 OR rc4_tickets >= 5
ORDER BY rc4_tickets DESC, tgs_count DESC
```

#### Splunk SPL
```spl
-- Kerberoasting detection: RC4 TGS requests for service SPNs
index=wineventlog EventCode=4769
| where NOT match(TargetUserName, "\$$")
| where NOT match(ServiceName, "^(krbtgt|kadmin|ldap/|host/|dns/|cifs/|rpcss/|wsman/)")
| where NOT (src_ip IN (dc_ips))
| eval is_rc4=if(TicketEncryptionType="0x17", 1, 0)
| stats count AS tgs_total, sum(is_rc4) AS rc4_count, dc(ServiceName) AS unique_svcs,
         values(ServiceName) AS services, min(_time) AS first_req, max(_time) AS last_req
  BY IpAddress, TargetUserName, _time span=30m
| eval kerberoast_score=case(
    rc4_count >= 10 AND unique_svcs >= 5, 97,
    rc4_count >= 5 AND unique_svcs >= 3, 90,
    rc4_count >= 3 AND unique_svcs >= 2, 80,
    unique_svcs >= 10, 85,
    rc4_count >= 5, 75,
    1==1, 55
  )
| where kerberoast_score >= 65
| table _time, IpAddress, TargetUserName, tgs_total, rc4_count, unique_svcs, services, kerberoast_score
| sort -kerberoast_score
```

---

### 5. DC Discovery — nltest / nslookup / dsquery

#### Splunk SPL
```spl
-- DC and domain discovery commands
index=sysmon EventCode=1
| eval dc_discovery=case(
    match(lower(Image), "nltest\.exe") AND match(lower(CommandLine), "/(dclist|domain_trusts|dsgetdc)"), "NLTEST_DCLIST",
    match(lower(Image), "nslookup\.exe") AND match(lower(CommandLine), "_ldap\._tcp|_kerberos\._tcp|_gc\._tcp"), "NSLOOKUP_DC_SRV",
    match(lower(Image), "dsquery\.exe"), "DSQUERY",
    match(lower(Image), "dsget\.exe"), "DSGET",
    match(lower(CommandLine), "nslookup.*-type=(srv|any)") AND match(lower(CommandLine), "(ldap|kerberos|_gc)"), "NSLOOKUP_SRV",
    match(lower(Image), "ping\.exe") AND match(lower(CommandLine), "(ldap\.|_gc\.|_kerberos\.)"), "PING_DC_DNS",
    1==1, null()
  )
| where isnotnull(dc_discovery)
| stats count AS cmd_count, values(dc_discovery) AS discovery_methods, values(CommandLine) AS cmds,
         dc(dc_discovery) AS method_variety, min(_time) AS first_cmd
  BY Computer, user, _time span=15m
| lookup domain_admins user AS user OUTPUT is_domain_admin
| eval confidence=case(
    method_variety >= 3 AND NOT is_domain_admin=1, 85,
    method_variety >= 2 AND NOT is_domain_admin=1, 75,
    cmd_count >= 3 AND NOT is_domain_admin=1, 70,
    is_domain_admin=1, 20,   -- domain admin doing DC enumeration = likely legitimate
    1==1, 55
  )
| where confidence >= 55
| table _time, Computer, user, cmd_count, method_variety, discovery_methods, confidence
| sort -confidence
```

---

### 6. Event 4662 — Sensitive AD Object Access (DC)

#### Splunk SPL
```spl
-- Sensitive AD object access from non-DC sources (possible DCSync or ACL abuse)
index=wineventlog EventCode=4662
| where NOT (src_ip IN (dc_ips) OR src_ip IN (ad_mgmt_ips))
| eval sensitive_access=case(
    match(Properties, "(1131f6aa|1131f6ad|1131f6ac)"), "REPLICATION_RIGHTS",    -- DCSync
    match(lower(ObjectType), "bf967aba.*|00000000-0000-0000-0000-000000000000"), "USER_OBJECT",
    match(lower(Properties), "ntsecuritydescriptor"), "ACL_READ",
    match(lower(Properties), "msds-allowedtoact"), "RBCD_PROP",
    match(lower(Properties), "serviceprincipalname"), "SPN_PROP",
    1==1, "OTHER"
  )
| where sensitive_access != "OTHER"
| stats count AS access_count, values(sensitive_access) AS access_types, dc(ObjectName) AS unique_objects,
         min(_time) AS first_access
  BY SubjectUserName, IpAddress, _time span=15m
| eval confidence=case(
    mvcount(mvfilter(match(access_types,"REPLICATION_RIGHTS"))) > 0, 97,  -- DCSync!
    mvcount(mvfilter(match(access_types,"RBCD_PROP"))) > 0 AND access_count >= 5, 88,
    unique_objects >= 50 AND access_count >= 100, 85,
    unique_objects >= 20, 75,
    1==1, 60
  )
| where confidence >= 65
| table _time, IpAddress, SubjectUserName, access_count, unique_objects, access_types, confidence
| sort -confidence
```

---

## True Positives (Echte Angriffsindikatoren)

### TP-001 — BloodHound Full Collection (SharpHound)
- **Indikatoren:** `WS-FINANCE-004` generates 2,847 Event 4662 in 8 minutes targeting DC; accessed attributes: nTSecurityDescriptor, member, servicePrincipalName, msDS-AllowedToActOnBehalfOfOtherIdentity, adminCount; object types: user, computer, group, GPO; source not an authorized management system
- **Confidence:** 97
- **MITRE:** T1087.002, T1069.002

### TP-002 — Kerberoasting via Rubeus
- **Indikatoren:** `Rubeus.exe kerberoast /outfile:hashes.txt`; 23 TGS requests (Event 4769) with RC4 encryption (0x17) from `LAPTOP-ACCT-017` within 90 seconds; target services include `MSSQLSvc`, `HTTP/webapp`, `cifs/fileserver`
- **Confidence:** 98
- **MITRE:** T1558.003

### TP-003 — PowerView AD Enumeration
- **Indikatoren:** PS 4104 blocks containing `Get-DomainUser -SPN`, `Get-ObjectAcl -Identity "Domain Admins"`, `Find-InterestingDomainAcl`; sequence over 15 min; no AMSI (suspicious); process is `powershell.exe` parent `cmd.exe` parent `excel.exe` (initial access via macro)
- **Confidence:** 95
- **MITRE:** T1087.002, T1069.002

### TP-004 — DCSync Attack
- **Indikatoren:** Event 4662 from non-DC host for replication rights GUIDs `1131f6aa` and `1131f6ad`; user `svc_backup` (compromised service account); mimikatz DCSync signature
- **Confidence:** 99
- **MITRE:** T1003.006

### TP-005 — net.exe Enumeration Chain (Manual Reconnaissance)
- **Indikatoren:** 18 `net.exe` commands in 12 min: `net user /domain`, `net group "Domain Admins" /domain`, `net group "Enterprise Admins" /domain`, `net accounts /domain`, `net view /domain`; standard user account; workstation not in IT subnet
- **Confidence:** 90
- **MITRE:** T1087.002, T1069.002

---

## False Positives (Bekannte FP-Quellen)

| FP-ID  | Quelle                         | Erkennungsmerkmal                                                     | Whitelist-Logik                                                                          |
|--------|--------------------------------|-----------------------------------------------------------------------|------------------------------------------------------------------------------------------|
| FP-001 | AD Management (ADUC, AD Admin) | High 4662 volume from management servers                              | `sourceip IN ad_management_servers` AND `user IN domain_admins`                         |
| FP-002 | Monitoring Tools (SolarWinds)  | LDAP queries for inventory/compliance                                 | `sourceip IN monitoring_servers` AND query matches known monitoring pattern              |
| FP-003 | ServiceNow / ITSM Integration  | AD user queries for ticket creation and employee lookup               | `sourceip IN itsm_servers` AND only user lookup attributes (not ACL/replication)        |
| FP-004 | AD Replication (DC to DC)      | 4662 replication rights access between DCs                            | `sourceip IN domain_controllers` AND `destinationip IN domain_controllers`              |
| FP-005 | Azure AD Connect               | High volume attribute reads for sync                                  | `sourceip IN aad_connect_servers` AND attributes match known AAD sync set               |
| FP-006 | HR Systems (LDAP lookup)       | Regular user attribute queries                                        | `sourceip IN hr_systems` AND only basic attributes (cn, mail, department)               |
| FP-007 | Legitimate net.exe by IT Admin | `net user /domain` from IT admin workstation                          | `user IN domain_admins` AND source in `it_admin_subnet` AND business hours              |

---

## Varianten / Evasion-Techniken

### VAR-001 — BloodHound with Stealth Collection (--stealth)
- `SharpHound.exe --stealth` — avoids collecting ACLs/sessions; uses only local enumeration and reduced LDAP
- **Detection:** Still generates 4662 events but lower volume; focus on characteristic object types; LDAP traffic to DC from workstation

### VAR-002 — LDAP over SSL (Port 636)
- Use LDAPS to avoid plain-text LDAP inspection on port 389
- **Detection:** Port 636 TCP connections from workstations to DCs (not AD management servers); volume analysis still works

### VAR-003 — PowerView via Obfuscated PSAmsi
- PowerView loaded after AMSI bypass, script heavily obfuscated
- **Detection:** AMSI bypass (HUNT-005) preceding AD enumeration events; LDAP network connections from PowerShell; 4769/4662 events even without scriptblock

### VAR-004 — Kerberoasting Without RC4 (AES)
- Request TGS tickets with AES256 (0x12) encryption to evade RC4 detection
- **Detection:** Volume of TGS requests for service SPNs (not RC4-specific); `Rubeus.exe kerberoast /rc4opsec` still triggers ticket requests

### VAR-005 — LDAP Paging for Large Queries
- Use LDAP paging (pageSize) to split large queries into small pages, reducing per-connection query count
- **Detection:** Multiple sequential LDAP connections with same filter; total attribute bytes over time window

### VAR-006 — Bloodhound via COM/.NET (No SharpHound.exe)
- Use pure PowerShell/.NET LDAP calls instead of SharpHound binary; no detectable binary name
- **Detection:** Same 4662 attribute patterns; LDAP traffic to DC from PowerShell process; script block content if AMSI active

---

## Confidence Scoring

```python
from dataclasses import dataclass, field
from typing import List, Set
import re

BLOODHOUND_ATTRIBUTES = {
    "ntsecuritydescriptor", "msds-allowedtoactonbehalfofotheridentity",
    "msds-groupmsamembership", "serviceprincipalname", "member",
    "memberof", "admincount", "msds-allowedtodelegateto",
    "useraccountcontrol", "sidhistory", "objectsid"
}

DCSYNC_GUIDS = {
    "1131f6aa-9c07-11d1-f79f-00c04fc2dcd2",  # DS-Replication-Get-Changes
    "1131f6ad-9c07-11d1-f79f-00c04fc2dcd2",  # DS-Replication-Get-Changes-All
    "1131f6ac-9c07-11d1-f79f-00c04fc2dcd2",  # DS-Replication-Manage-Topology
    "89e95b76-444d-4c62-991a-0facbeda640c",  # DS-Replication-Get-Changes-In-Filtered-Set
}

POWERVIEW_FUNCTIONS = {
    "get-domainuser", "get-domaingroup", "get-domaincomputer",
    "get-domaingpo", "get-domaintrust", "get-objectacl",
    "find-interestingdomainacl", "invoke-acl", "get-netcomputer",
    "get-netuser", "find-localadminaccess", "invoke-enumlocaladmin",
    "get-domaindfsshare", "get-netshare", "get-domainspn"
}

@dataclass
class ADEnumEvent:
    source_ip: str
    username: str
    # LDAP/4662 indicators
    ldap_query_count: int = 0
    unique_objects_accessed: int = 0
    accessed_attributes: Set[str] = field(default_factory=set)
    dcsync_guids_accessed: Set[str] = field(default_factory=set)
    query_duration_min: float = 0.0
    # net.exe indicators
    net_commands: List[str] = field(default_factory=list)
    # PowerView indicators
    powerview_functions: List[str] = field(default_factory=list)
    # Kerberoasting indicators
    tgs_count: int = 0
    rc4_tgs_count: int = 0
    unique_spn_services: int = 0
    # DC discovery
    dc_discovery_methods: List[str] = field(default_factory=list)
    # Context
    is_domain_controller: bool = False
    is_ad_management_server: bool = False
    is_monitoring_server: bool = False
    is_domain_admin: bool = False

def score_ad_enumeration(evt: ADEnumEvent) -> dict:
    if evt.is_domain_controller or evt.is_ad_management_server or evt.is_monitoring_server:
        return {"confidence": 5, "verdict": "WHITELISTED", "reasons": ["Authorized AD management source"], "techniques": []}

    score = 0
    reasons = []
    techniques = []

    # --- DCSync (highest severity) ---
    dcsync_hit = evt.dcsync_guids_accessed & DCSYNC_GUIDS
    if dcsync_hit:
        score += 70
        reasons.append(f"DCSync GUID accessed from non-DC: {list(dcsync_hit)[:2]}")
        techniques.append("T1003.006")

    # --- LDAP enumeration volume ---
    if evt.ldap_query_count >= 500:
        score += 45
        reasons.append(f"Massive LDAP enumeration: {evt.ldap_query_count} queries")
        techniques.append("T1087.002")
    elif evt.ldap_query_count >= 100:
        score += 30
        reasons.append(f"High LDAP query count: {evt.ldap_query_count}")

    # --- BloodHound attributes ---
    bh_attrs_hit = evt.accessed_attributes & BLOODHOUND_ATTRIBUTES
    if bh_attrs_hit:
        attr_score = min(len(bh_attrs_hit) * 8, 40)
        score += attr_score
        reasons.append(f"BloodHound-characteristic attributes accessed: {list(bh_attrs_hit)[:4]}")
        techniques.append("T1087.002")
        if len(bh_attrs_hit) >= 5:
            techniques.append("T1069.002")

    # --- PowerView functions ---
    pv_funcs = [f for f in evt.powerview_functions if f.lower() in POWERVIEW_FUNCTIONS]
    if pv_funcs:
        score += min(len(pv_funcs) * 10, 40)
        reasons.append(f"PowerView functions: {pv_funcs[:4]}")
        techniques.append("T1087.002")
        if any("acl" in f.lower() or "localadmin" in f.lower() for f in pv_funcs):
            score += 20
            reasons.append("ACL or local admin enumeration (BloodHound-level)")

    # --- net.exe enumeration ---
    net_sensitive = [c for c in evt.net_commands
                     if re.search(r"(user\s+/domain|group.*(domain admins|enterprise admins|schema admins)|accounts\s+/domain)", c, re.IGNORECASE)]
    if net_sensitive:
        score += min(len(net_sensitive) * 8, 35)
        reasons.append(f"Sensitive net.exe commands: {net_sensitive[:2]}")
        techniques.append("T1087.002")
        techniques.append("T1069.002")

    # --- Kerberoasting ---
    if evt.rc4_tgs_count >= 5:
        score += 45
        reasons.append(f"Kerberoasting: {evt.rc4_tgs_count} RC4 TGS requests for {evt.unique_spn_services} services")
        techniques.append("T1558.003")
    elif evt.unique_spn_services >= 10:
        score += 35
        reasons.append(f"High TGS volume for service SPNs: {evt.unique_spn_services} services")

    # --- DC discovery ---
    if len(evt.dc_discovery_methods) >= 3:
        score += 20
        reasons.append(f"DC discovery methods: {evt.dc_discovery_methods}")
        techniques.append("T1018")

    # --- Domain admin suppression ---
    if evt.is_domain_admin:
        score = max(0, score - 30)
        reasons.append("Domain admin account — partial suppression (still alert on DCSync/Kerberoast)")

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
| TC-001 | True Positive | SharpHound: 2000+ 4662 events, 6 BH attributes, from workstation                          | 95–100              | HIGH             |
| TC-002 | True Positive | Kerberoasting: 20 RC4 TGS requests, 15 unique SPNs, non-DC source                         | 90–100              | HIGH             |
| TC-003 | True Positive | PowerView: get-domainuser + get-objectacl + find-interestingdomainacl in 10 min           | 90–100              | HIGH             |
| TC-004 | True Positive | DCSync: 4662 with replication GUIDs from compromised workstation                           | 97–100              | HIGH             |
| TC-005 | True Positive | net.exe chain: 15 commands, user/domain + domain admins + accounts /domain                | 82–92               | HIGH             |
| TC-006 | False Positive | LDAP queries from AD management server (authorized)                                        | ≤10                 | WHITELISTED      |
| TC-007 | False Positive | `net user /domain` from domain admin workstation during business hours                    | ≤25                 | LOW              |
| TC-008 | False Positive | Azure AD Connect LDAP sync (AAD Connect server)                                            | ≤10                 | WHITELISTED      |
| TC-009 | Edge Case     | Kerberoasting without RC4 (AES TGS): 20 TGS for service SPNs, no RC4                     | 60–80               | MEDIUM           |
| TC-010 | Edge Case     | BloodHound stealth mode: low volume (50 queries) but sensitive attributes                  | 55–75               | MEDIUM           |
