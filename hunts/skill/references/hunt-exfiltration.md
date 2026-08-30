# HUNT-006 — Data Exfiltration Detection
<!-- T1048.003 · T1041 · T1567 · T1071.004 -->

---

## Überblick

| Feld              | Inhalt                                                                                              |
|-------------------|-----------------------------------------------------------------------------------------------------|
| Hunt-ID           | HUNT-006                                                                                            |
| MITRE ATT&CK      | T1048.003 (DNS Exfil), T1041 (C2 channel exfil), T1567 (Cloud storage), T1071.004 (DNS)           |
| Taktik            | Exfiltration                                                                                        |
| Daten-Quellen     | DNS logs (Sysmon 22, internal resolver), Firewall/Proxy logs, NetFlow, Windows Security/Sysmon     |
| Konfidenz-Basis   | Entropy scoring + subdomain length + query rate + upload volume + destination reputation            |
| Autor             | SOC Engineering                                                                                     |
| Letzte Revision   | 2026-06-03                                                                                          |

---

## Erkennungslogik / Detection Logic

### 1. DNS Tunneling — High-Entropy Subdomains (DNScat2, Iodine)

**Theory:** Data encoded in subdomain labels. Shannon entropy of legitimate labels < 3.5 bits/char; tunnel labels typically > 4.0 bits/char. Label length > 50 chars unusual for legitimate traffic.

#### QRadar AQL
```aql
-- High-volume DNS queries with long/high-entropy subdomains
-- Note: entropy must be computed in enrichment layer or via QRadar custom property
SELECT
    DATEFORMAT(starttime, 'yyyy-MM-dd HH:mm:ss') AS event_time,
    sourceip AS client,
    "DNS Query Name" AS query,
    "DNS Query Type" AS qtype,
    "DNS Response" AS response,
    LENGTH("DNS Query Name") AS qname_len,
    CUSTOMFLOAT("entropy_score") AS entropy
FROM events
WHERE
    LOGSOURCETYPENAME(devicetype) IN ('DNS', 'Windows DNS Server', 'Sysmon')
    AND "Event ID" IN ('22', '5')
    AND (
        LENGTH("DNS Query Name") > 50
        OR "DNS Query Type" IN ('TXT', 'NULL', 'PRIVATE', 'MX', 'CNAME')
        OR CUSTOMFLOAT("entropy_score") > 4.0
    )
    AND "DNS Query Name" NOT LIKE '%.microsoft.com'
    AND "DNS Query Name" NOT LIKE '%.windows.com'
    AND "DNS Query Name" NOT LIKE '%.windowsupdate.com'
    AND "DNS Query Name" NOT LIKE '%.office.com'
    AND "DNS Query Name" NOT LIKE '%.office365.com'
LAST 4 HOURS
ORDER BY qname_len DESC

-- Rate-based: same client, same base domain, high query count
SELECT
    sourceip AS client,
    -- Extract base domain (last 2 labels)
    REGEXP_EXTRACT("DNS Query Name", '([^.]+\.[^.]+)$', 1) AS base_domain,
    COUNT(*) AS query_count,
    COUNT(DISTINCT "DNS Query Name") AS unique_subdomains,
    AVG(LENGTH("DNS Query Name")) AS avg_qname_len,
    MAX(LENGTH("DNS Query Name")) AS max_qname_len
FROM events
WHERE
    LOGSOURCETYPENAME(devicetype) IN ('DNS', 'Windows DNS Server', 'Sysmon')
    AND "Event ID" IN ('22', '5')
    AND "DNS Query Name" NOT LIKE '%.microsoft.com'
LAST 1 HOURS
GROUP BY client, base_domain
HAVING query_count > 100 AND avg_qname_len > 40
ORDER BY query_count DESC
```

#### Splunk SPL
```spl
-- DNS Tunneling: rate + entropy + length analysis
index=dns OR (index=sysmon EventCode=22)
| eval query=lower(coalesce(QueryName, query, dns_query))
| eval base_domain=replace(query, "^(?:[^.]+\.)+([^.]+\.[^.]+)$", "\1")
| eval subdomain=replace(query, "^(.+)\.[^.]+\.[^.]+$", "\1")
| eval subdomain_len=len(subdomain)
| eval label_count=mvcount(split(query, "."))
-- Approximate Shannon entropy via character variety as proxy
| eval unique_chars=len(replace(subdomain, "(.)\1*", "\1"))
| eval char_variety_ratio=unique_chars / max(subdomain_len, 1)
| eval entropy_proxy=case(
    char_variety_ratio > 0.75, "HIGH",
    char_variety_ratio > 0.55, "MEDIUM",
    1==1, "LOW"
  )
| where NOT match(base_domain, "(microsoft|windows|office|office365|akamai|cloudflare|google|amazonaws|azure)\.(com|net|org|io)")
| stats count AS query_count, dc(query) AS unique_queries, avg(subdomain_len) AS avg_len,
         max(subdomain_len) AS max_len, values(QueryType) AS qtypes, values(entropy_proxy) AS entropy_levels
  BY src_ip, base_domain, _time span=15m
| eval txt_null_queries=if(mvcount(mvfilter(match(qtypes, "TXT|NULL|PRIVATE"))) > 0, 1, 0)
| eval confidence=case(
    query_count > 200 AND avg_len > 50, 95,
    query_count > 100 AND avg_len > 40 AND txt_null_queries=1, 93,
    query_count > 50 AND avg_len > 40, 82,
    max_len > 63 AND txt_null_queries=1, 88,  -- max label length RFC 1035
    avg_len > 45, 75,
    txt_null_queries=1 AND query_count > 20, 72,
    1==1, 50
  )
| where confidence >= 65
| table _time, src_ip, base_domain, query_count, unique_queries, avg_len, max_len, qtypes, confidence
| sort -confidence
```

---

### 2. Large DNS Payload — TXT Record Responses

#### Splunk SPL
```spl
-- Large TXT record responses (data in DNS response — receiving exfil or C2 instruction)
index=dns QueryType=TXT
| eval resp_len=len(coalesce(QueryResults, response_data, ""))
| where resp_len > 200
| where NOT match(lower(coalesce(QueryName, query)), "(microsoft|google|amazon|spf|dkim|dmarc|_domainkey)")
| stats count, avg(resp_len) AS avg_resp_len, max(resp_len) AS max_resp_len,
         values(QueryName) AS domains
  BY src_ip, _time span=10m
| eval confidence=case(
    max_resp_len > 500 AND count > 10, 90,
    max_resp_len > 300 AND count > 5, 80,
    max_resp_len > 200, 65,
    1==1, 50
  )
| where confidence >= 65
| sort -confidence
```

---

### 3. C2 Channel Exfiltration — Large Uploads to New Destinations

#### QRadar AQL
```aql
-- Hosts uploading large amounts of data to destinations first seen in last 7 days
SELECT
    DATEFORMAT(starttime, 'yyyy-MM-dd HH:mm:ss') AS event_time,
    sourceip AS host,
    destinationip AS dest,
    destinationport AS port,
    SUM("Bytes Sent") AS total_uploaded_bytes,
    COUNT(*) AS session_count,
    MIN(starttime) AS first_seen_dest
FROM events
WHERE
    LOGSOURCETYPENAME(devicetype) IN ('Firewall', 'Proxy', 'Palo Alto Networks', 'Fortinet')
    AND "Bytes Sent" > 1048576   -- sessions > 1MB
    AND destinationip NOT IN (SELECT ip FROM reference set known_cloud_infra)
    AND destinationip NOT IN (SELECT ip FROM reference set approved_external)
    AND destinationport NOT IN (53, 123, 443)    -- exclude DNS/NTP; 443 handled separately
LAST 24 HOURS
GROUP BY sourceip, destinationip, destinationport
HAVING total_uploaded_bytes > 52428800   -- 50MB total per dest
ORDER BY total_uploaded_bytes DESC

-- HTTPS exfil: large uploads on 443 to new/low-reputation destinations
SELECT
    sourceip AS host,
    destinationip AS dest,
    "Destination Hostname" AS fqdn,
    SUM("Bytes Sent") AS total_bytes_out,
    SUM("Bytes Received") AS total_bytes_in,
    CAST(SUM("Bytes Sent") AS FLOAT) / NULLIF(SUM("Bytes Received"), 0) AS upload_ratio
FROM events
WHERE
    LOGSOURCETYPENAME(devicetype) IN ('Proxy', 'Palo Alto Networks', 'Fortinet')
    AND destinationport = 443
    AND "Bytes Sent" > 5242880   -- 5MB per session
    AND CUSTOMINTEGER("domain_age_days") < 30  -- new domain
    AND CUSTOMFLOAT("reputation_score") < 30   -- low reputation
LAST 24 HOURS
GROUP BY sourceip, destinationip, "Destination Hostname"
HAVING upload_ratio > 3.0     -- sending 3x more than receiving = exfil pattern
ORDER BY total_bytes_out DESC
```

#### Splunk SPL
```spl
-- HTTPS exfil: upload ratio anomaly to new destinations
index=proxy OR index=firewall
| where bytes_out > 1048576
| eval upload_ratio=bytes_out / max(bytes_in, 1)
| lookup domain_age_db dest_host AS dest_host OUTPUT domain_age_days
| lookup threat_intel dest_ip AS dest_ip OUTPUT reputation_score, is_known_cdn
| where NOT is_known_cdn=1
| where isnull(domain_age_days) OR domain_age_days < 30
| stats sum(bytes_out) AS total_out, sum(bytes_in) AS total_in, count AS sessions,
         avg(upload_ratio) AS avg_ratio, min(_time) AS first_seen, max(_time) AS last_seen,
         values(dest_host) AS domains
  BY src_ip, dest_ip, _time span=1h
| eval total_out_mb=round(total_out/1048576, 2)
| eval confidence=case(
    total_out_mb > 500 AND avg_ratio > 10, 95,
    total_out_mb > 100 AND avg_ratio > 5, 88,
    total_out_mb > 50 AND avg_ratio > 3, 78,
    total_out_mb > 10 AND avg_ratio > 5, 72,
    1==1, 50
  )
| where confidence >= 65
| table _time, src_ip, dest_ip, domains, total_out_mb, avg_ratio, sessions, confidence
| sort -confidence
```

---

### 4. Cloud Storage Exfiltration — OneDrive / Dropbox to Unusual IPs

#### QRadar AQL
```aql
-- Cloud storage uploads: large transfers to cloud storage APIs
SELECT
    sourceip AS host,
    username,
    "Destination Hostname" AS cloud_dest,
    SUM("Bytes Sent") AS upload_bytes,
    COUNT(*) AS upload_sessions,
    MIN(starttime) AS first_upload,
    MAX(starttime) AS last_upload
FROM events
WHERE
    LOGSOURCETYPENAME(devicetype) IN ('Proxy', 'Palo Alto Networks')
    AND (
        "Destination Hostname" LIKE '%-my.sharepoint.com'
        OR "Destination Hostname" LIKE '%api.dropboxapi.com'
        OR "Destination Hostname" LIKE '%content.dropboxapi.com'
        OR "Destination Hostname" LIKE '%.blob.core.windows.net'
        OR "Destination Hostname" LIKE '%drive.google.com'
        OR "Destination Hostname" LIKE '%api.box.com'
        OR "Destination Hostname" LIKE '%s3.amazonaws.com'
    )
    AND "Bytes Sent" > 10485760   -- 10MB per session
    AND username NOT IN (SELECT username FROM reference set approved_cloud_users)
LAST 24 HOURS
GROUP BY sourceip, username, "Destination Hostname"
HAVING upload_bytes > 104857600   -- 100MB total
ORDER BY upload_bytes DESC
```

#### Splunk SPL
```spl
-- Cloud storage exfil: abnormal upload volume + after-hours pattern
index=proxy
| where match(dest_host, "(?i)(sharepoint\.com|dropboxapi\.com|blob\.core\.windows\.net|drive\.google\.com|api\.box\.com|s3\.amazonaws\.com|wetransfer\.com|mega\.nz|anonfiles)")
| eval is_after_hours=if(tonumber(strftime("%H", _time)) < 8 OR tonumber(strftime("%H", _time)) > 19, 1, 0)
| eval is_weekend=if(strftime("%u", _time) IN ("6","7"), 1, 0)
| lookup cloud_upload_baseline src_ip AS src_ip OUTPUT avg_daily_upload_mb AS baseline_mb
| stats sum(bytes_out) AS total_out, count AS sessions, max(is_after_hours) AS after_hours_activity,
         max(is_weekend) AS weekend_activity, values(dest_host) AS cloud_services
  BY src_ip, user, _time span=4h
| eval total_out_mb=round(total_out/1048576, 2)
| eval deviation=if(isnotnull(baseline_mb) AND baseline_mb > 0, total_out_mb / baseline_mb, 999)
| eval confidence=case(
    total_out_mb > 500 AND (after_hours_activity=1 OR weekend_activity=1), 93,
    deviation > 10 AND total_out_mb > 100, 90,
    total_out_mb > 200 AND after_hours_activity=1, 85,
    deviation > 5 AND total_out_mb > 50, 78,
    total_out_mb > 100, 70,
    1==1, 45
  )
| where confidence >= 65
| table _time, src_ip, user, cloud_services, total_out_mb, deviation, after_hours_activity, weekend_activity, confidence
| sort -confidence
```

---

## True Positives (Echte Angriffsindikatoren)

### TP-001 — DNScat2 Tunnel (TXT Record C2 + Exfil)
- **Indikatoren:** `WORKSTATION-042` sending 847 DNS queries to `*.evil-c2.xyz` in 15 min; avg subdomain label length = 58 chars; high char variety ratio; TXT and NULL record types; base domain registered 2 days ago; no business justification
- **Confidence:** 96
- **MITRE:** T1071.004, T1048.003

### TP-002 — Iodine DNS Tunnel (IP-over-DNS)
- **Indikatoren:** NULL and PRIVATE record queries; subdomain starts with base32-encoded chunks; response contains binary data (non-printable chars); average 35 queries/min sustained; destination UDP 53 to single external resolver
- **Confidence:** 94
- **MITRE:** T1071.004

### TP-003 — HTTPS Exfil to Fresh C2 Domain
- **Indikatoren:** `FINANCE-PC-003` uploads 2.3GB over HTTPS (port 443) to `update-svc.analysis-cdn.com` (domain age: 4 days) within 45 min; upload/download ratio = 47:1; certificate issued by Let's Encrypt; no corresponding business process
- **Confidence:** 95
- **MITRE:** T1041

### TP-004 — Dropbox API Exfil After Ransomware Precursor
- **Indikatoren:** `svc_backup` account uploads 18GB to `api.dropboxapi.com` at 02:30 AM Saturday; baseline for this account: 0 MB/day; not in approved cloud users list; preceded by `rar.exe` archiving events (Sysmon 11)
- **Confidence:** 97
- **MITRE:** T1567.002

### TP-005 — Staging + Archive then DNS Exfil
- **Indikatoren:** `7z.exe a C:\ProgramData\archive.rar \\fileserver\sensitive\` → base64 encoding → DNS TXT queries with base64 chunks to `*.tunnel-relay.ru`
- **Confidence:** 98
- **MITRE:** T1560.001, T1048.003

---

## False Positives (Bekannte FP-Quellen)

| FP-ID  | Quelle                        | Erkennungsmerkmal                                             | Whitelist-Logik                                                                |
|--------|-------------------------------|---------------------------------------------------------------|--------------------------------------------------------------------------------|
| FP-001 | CDN Traffic (Akamai, CF)      | High query volume, long CNAME chains                          | Destination in CDN IP ranges + domain in approved CDN list                    |
| FP-002 | Software Updates              | Large HTTPS uploads (telemetry) to vendor domains             | Destination matches vendor update domain + User-Agent = known update agent    |
| FP-003 | Backup Agents (cloud backup)  | Large uploads to cloud storage                                | Source in backup_servers list + cloud destination in approved_cloud list      |
| FP-004 | DKIM/SPF/DMARC TXT records    | Large TXT record DNS responses                                | Query domain matches `_domainkey`, `_dmarc`, `v=spf1` patterns               |
| FP-005 | Legitimate OneDrive sync      | High upload to SharePoint/OneDrive                            | User in approved_cloud_users + source is managed endpoint + during business hours |
| FP-006 | Security Scanning Tools       | High DNS query rate (Nessus, Qualys)                          | Source in scanner_ips reference set                                           |
| FP-007 | Encrypted DNS (DoH/DoT)       | Large DNS-like traffic to 8.8.8.8:443, 1.1.1.1:443           | Destination is known DoH resolver + enterprise DoH policy permits             |

---

## Varianten / Evasion-Techniken

### VAR-001 — Low-and-Slow DNS Exfil (Rate Limiting)
- Attacker limits to 1 query per 30s to avoid rate-based detection; uses short labels
- **Detection:** Extend analysis window to 24h; focus on entropy + destination reputation + domain age rather than rate

### VAR-002 — CNAME Chain Exfil
- Data in CNAME records instead of TXT/NULL — harder to detect via record type filtering
- **Detection:** Monitor CNAME response length; entropy of CNAME labels; same base domain concentration

### VAR-003 — HTTPS to Legitimate Sharing Sites (Alternate Exfil)
- Use legitimate paste sites (pastebin.com, github.com Gists) as exfil channel — traffic blends with normal
- **Detection:** Volume anomaly to these sites; POST request sizes; behavioral baseline deviation

### VAR-004 — HTTP Chunked Transfer Encoding Exfil
- Split data into small chunks; each chunk looks benign; total volume triggers only if summed
- **Detection:** Aggregate bytes per destination over time window; session count + total bytes

### VAR-005 — Time-Based DNS Exfil (Timing Channel)
- No data in query content; timing between queries encodes bits (e.g., 100ms = 0, 500ms = 1)
- **Detection:** Extremely difficult; requires precise timing analysis; look for periodic patterns in inter-query intervals

### VAR-006 — ICMP Tunnel (T1095)
- Data encoded in ICMP echo request/reply payload; `ptunnel`, `icmptunnel`
- **Detection:** ICMP payload size > 64 bytes consistently; high ICMP rate; entropy of ICMP data

---

## Confidence Scoring

```python
import math
import re
from collections import Counter
from dataclasses import dataclass, field
from typing import List, Optional

KNOWN_CDN_DOMAINS = re.compile(
    r"(?i)(akamai|cloudflare|amazonaws|azure|googleapis|office365|microsoft|"
    r"windows|office|akamaiedge|fastly|cdn77|cloudfront)\.(com|net|org|io|co)",
    re.IGNORECASE
)

CLOUD_STORAGE = re.compile(
    r"(?i)(sharepoint|dropboxapi|blob\.core\.windows|drive\.google|api\.box|"
    r"s3\.amazonaws|wetransfer|mega\.nz|anonfiles)",
    re.IGNORECASE
)

SUSPICIOUS_DNS_TYPES = {"TXT", "NULL", "PRIVATE", "MX"}

def shannon_entropy(s: str) -> float:
    """Calculate Shannon entropy in bits per character."""
    if not s:
        return 0.0
    counts = Counter(s.lower())
    length = len(s)
    return -sum((c / length) * math.log2(c / length) for c in counts.values())

def score_dns_label(label: str) -> dict:
    """Score a single DNS label for tunneling indicators."""
    entropy = shannon_entropy(label)
    length = len(label)
    unique_ratio = len(set(label.lower())) / max(length, 1)
    score = 0
    reasons = []
    if length > 50:
        score += 30
        reasons.append(f"Label length {length} > 50 (RFC 1035 max=63)")
    elif length > 35:
        score += 15
    if entropy > 4.5:
        score += 40
        reasons.append(f"High Shannon entropy: {entropy:.2f} bits/char")
    elif entropy > 4.0:
        score += 25
    if unique_ratio > 0.75:
        score += 20
        reasons.append(f"High character variety: {unique_ratio:.2f}")
    return {"score": min(100, score), "entropy": entropy, "length": length, "reasons": reasons}

@dataclass
class ExfilEvent:
    source_ip: str
    dest_ip: str
    dest_hostname: str
    protocol: str               # "dns", "https", "http", "cloud"
    # DNS fields
    dns_queries: List[str] = field(default_factory=list)
    dns_query_types: List[str] = field(default_factory=list)
    query_rate_per_min: float = 0.0
    # Volume fields
    bytes_out: int = 0
    bytes_in: int = 0
    session_count: int = 0
    # Context
    domain_age_days: Optional[int] = None
    reputation_score: Optional[float] = None  # 0-100, lower = worse
    is_after_hours: bool = False
    is_weekend: bool = False
    baseline_daily_mb: float = 0.0
    is_approved_destination: bool = False
    is_cdn: bool = False
    is_backup_agent: bool = False
    is_scanner: bool = False

def score_exfiltration(evt: ExfilEvent) -> dict:
    if evt.is_approved_destination or evt.is_cdn or evt.is_backup_agent or evt.is_scanner:
        return {"confidence": 5, "verdict": "WHITELISTED", "reasons": ["Approved/known destination"], "techniques": []}

    score = 0
    reasons = []
    techniques = []

    if evt.protocol == "dns":
        techniques.append("T1071.004")
        has_suspicious_type = any(t.upper() in SUSPICIOUS_DNS_TYPES for t in evt.dns_query_types)
        if has_suspicious_type:
            score += 30
            reasons.append(f"Suspicious DNS record types: {set(t.upper() for t in evt.dns_query_types) & SUSPICIOUS_DNS_TYPES}")

        if evt.dns_queries:
            label_scores = []
            for q in evt.dns_queries[:50]:  # sample first 50
                labels = q.split(".")
                subdomain = ".".join(labels[:-2]) if len(labels) > 2 else ""
                if subdomain:
                    ls = score_dns_label(subdomain)
                    label_scores.append(ls["score"])

            avg_label_score = sum(label_scores) / max(len(label_scores), 1)
            if avg_label_score > 60:
                score += 40
                reasons.append(f"High average label suspicion score: {avg_label_score:.1f}")
            elif avg_label_score > 40:
                score += 25

        if evt.query_rate_per_min > 50:
            score += 25
            reasons.append(f"High DNS query rate: {evt.query_rate_per_min:.0f}/min")
        elif evt.query_rate_per_min > 20:
            score += 15

        if evt.domain_age_days is not None and evt.domain_age_days < 7:
            score += 20
            reasons.append(f"Very new domain: {evt.domain_age_days} days old")
        elif evt.domain_age_days is not None and evt.domain_age_days < 30:
            score += 10

        if len(evt.dns_queries) > 200:
            techniques.append("T1048.003")

    elif evt.protocol in ("https", "http"):
        techniques.append("T1041")
        mb_out = evt.bytes_out / 1_048_576
        mb_in = max(evt.bytes_in, 1) / 1_048_576
        upload_ratio = mb_out / max(mb_in, 0.01)

        if mb_out > 500:
            score += 45
            reasons.append(f"Very large upload: {mb_out:.1f} MB")
        elif mb_out > 100:
            score += 30
            reasons.append(f"Large upload: {mb_out:.1f} MB")
        elif mb_out > 10:
            score += 15

        if upload_ratio > 10:
            score += 25
            reasons.append(f"Upload-dominant ratio: {upload_ratio:.1f}:1")
        elif upload_ratio > 3:
            score += 15

        if evt.domain_age_days is not None and evt.domain_age_days < 30:
            score += 20
            reasons.append(f"New domain ({evt.domain_age_days}d) receiving large upload")

        if evt.reputation_score is not None and evt.reputation_score < 30:
            score += 20
            reasons.append(f"Low reputation score: {evt.reputation_score}")

    elif evt.protocol == "cloud":
        techniques.append("T1567")
        if CLOUD_STORAGE.search(evt.dest_hostname):
            score += 15
            techniques.append("T1567.002")

        mb_out = evt.bytes_out / 1_048_576
        if mb_out > 500:
            score += 40
        elif mb_out > 100:
            score += 25
        elif mb_out > 50:
            score += 15

        if evt.baseline_daily_mb > 0:
            deviation = mb_out / evt.baseline_daily_mb
            if deviation > 10:
                score += 30
                reasons.append(f"10x above baseline upload ({mb_out:.0f} MB vs {evt.baseline_daily_mb:.0f} MB baseline)")
            elif deviation > 5:
                score += 20

    if evt.is_after_hours:
        score += 10
        reasons.append("Activity outside business hours")
    if evt.is_weekend:
        score += 10
        reasons.append("Weekend activity")

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

| TC-ID  | Typ           | Beschreibung                                                                                | Expected Confidence | Expected Verdict |
|--------|---------------|---------------------------------------------------------------------------------------------|---------------------|------------------|
| TC-001 | True Positive | DNScat2: 500+ queries, avg label len=58, TXT records, domain age=2d                       | 90–100              | HIGH             |
| TC-002 | True Positive | HTTPS exfil: 2GB upload, upload ratio=47:1, dest domain age=4 days, low reputation         | 90–100              | HIGH             |
| TC-003 | True Positive | Dropbox API: 18GB at 02:30AM Saturday, baseline=0MB, not in approved cloud users           | 92–100              | HIGH             |
| TC-004 | True Positive | DNS NULL record queries, high entropy labels (entropy > 4.5), sustained 30+ queries/min    | 85–95               | HIGH             |
| TC-005 | True Positive | HTTPS to IP-direct address (no hostname): 500MB upload, ratio=15:1                         | 88–98               | HIGH             |
| TC-006 | False Positive | Akamai CDN traffic (is_cdn=True)                                                           | ≤10                 | WHITELISTED      |
| TC-007 | False Positive | Veeam cloud backup to approved S3 bucket (is_backup_agent=True)                           | ≤10                 | WHITELISTED      |
| TC-008 | False Positive | DKIM TXT record lookup (large TXT response from mail domain)                               | ≤25                 | LOW              |
| TC-009 | Edge Case     | OneDrive sync: 250MB upload during business hours, user in approved list                   | ≤20                 | INFORMATIONAL    |
| TC-010 | Edge Case     | Low-and-slow DNS exfil: 1 query/30s over 8h, moderate entropy                              | 55–75               | MEDIUM           |
