---
name: soc-forensic-hunts
description: >
  Enterprise-grade SOC forensic hunt framework for Tier 1–3 analysts. Use this skill
  whenever you are writing, reviewing, implementing, or testing threat hunting logic,
  hunt definitions, detection rules, or forensic analysis at SOC level. Triggers on:
  hunt definitions, SIEM detection rules (QRadar/Splunk), MITRE ATT&CK mapping,
  IOC analysis, C2 detection, LSASS/credential theft, lateral movement, persistence,
  LOLBins, defense evasion, data exfiltration, ransomware precursors, privilege
  escalation, AD enumeration, phishing/initial access. Always use this skill when
  building the ThreatHunting Tool, writing hunt tests, or defining confidence scoring.
  This is not for toy examples — apply full enterprise SOC Tier 1–3 standards.
---

# SOC Forensic Hunt Framework

## Aufbau dieses Skills

Jeder Hunt hat ein eigenes Reference-File. Lade das passende wenn du an einem spezifischen
Hunt arbeitest. Lade `references/hunt-framework.md` immer zuerst — es definiert das Schema.

| Kategorie | Reference-File | MITRE |
|---|---|---|
| **Framework / Schema** | `references/hunt-framework.md` | — |
| **C2 / Beaconing** | `references/hunt-c2-beaconing.md` | T1071, T1095, T1571 |
| **Credential Theft** | `references/hunt-credential-theft.md` | T1003, T1558, T1550 |
| **Lateral Movement** | `references/hunt-lateral-movement.md` | T1021, T1047, T1570 |
| **Persistence** | `references/hunt-persistence.md` | T1547, T1053, T1543, T1546 |
| **LOLBins / Defense Evasion** | `references/hunt-lolbins-evasion.md` | T1218, T1059, T1562 |
| **Exfiltration / DNS Tunneling** | `references/hunt-exfiltration.md` | T1048, T1071.004, T1041 |
| **Ransomware Precursors** | `references/hunt-ransomware.md` | T1490, T1486, T1489 |
| **Privilege Escalation** | `references/hunt-privesc.md` | T1134, T1548, T1574 |
| **AD Enumeration** | `references/hunt-ad-enumeration.md` | T1087, T1069, T1018 |
| **Initial Access / Phishing** | `references/hunt-initial-access.md` | T1566, T1204, T1059 |

## Kern-Prinzipien (niemals ignorieren)

```
1. Kein Hunt ohne vollständige True-Positive UND False-Positive Tests
2. Jede Variante / Evasion-Technik braucht einen eigenen Test-Case
3. Confidence Score bestimmt die Aktion — nie blind isolieren
4. Traceability: jeder Fund braucht vollständige Beweiskette
5. False-Positive-Rate in Produktion immer messen
6. Legitime Enterprise-Tools niemals blind als Angriff werten
```

## Confidence Scoring (Standard)

| Score | Bedeutung | Empfohlene Aktion |
|---|---|---|
| **90–100** | Bekanntes Angriffsmuster, mehrere Indikatoren | Sofort eskalieren, Isolation vorschlagen |
| **70–89** | Sehr wahrscheinlich Angriff, geringe FP-Rate | Agent eskaliert an Analyst |
| **50–69** | Verdächtig, könnte legitim sein | Ticket erstellen, Hunt-Log |
| **30–49** | Schwache Signale, hohes FP-Risiko | Nur loggen, keine Aktion |
| **< 30** | Zu unsicher | Verwerfen |

## Hunt-Status Workflow

```
DRAFT → TESTING → VALIDATED → ACTIVE → DEPRECATED
          ↑              ↓
       Iteration    FP-Anpassung
```

Hunt geht nur auf ACTIVE wenn:
- Alle TP-Tests grün
- Alle FP-Tests grün
- Alle definierten Varianten abgedeckt
- FP-Rate in Testumgebung < 5%
