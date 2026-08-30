# Detection & Threat Hunting

Dieser Bereich bündelt die **Erkennungsseite** von Nexora: den Erkennungsregel-Katalog und die
MITRE-gemappte **Threat-Hunt-Bibliothek**. Die Hunts laufen per Knopfdruck gegen die Wazuh-Daten;
Funde werden zu Tickets oder Evidence.

!!! info "Bedienung vs. Referenz"
    Diese Seite ist die **Referenz** zu den Detection-Inhalten. Wie du Hunts in der Oberfläche
    startest und auswertest, steht unter [Threat Hunts](../02-user-guide/pages/ThreatHunts.md),
    [Hunt-Konsole](../02-user-guide/pages/HuntConsole.md) und
    [Hunt-Bibliothek](../02-user-guide/pages/HuntLibrary.md).

## Erkennungsregeln

- **[Regel-Katalog](rules-catalog.md)** — kuratierte Erkennungsregeln, Sysmon-Event-Regeln,
  AV-Layer und die **MITRE-ATT&CK-Coverage-Matrix**.

## Threat-Hunt-Katalog (MITRE-gemappt)

Zehn vordefinierte Hunts. Hypothese, Datenquellen, Query-Logik und MITRE-Technik je Hunt sind im
Regel-Katalog dokumentiert → **[Regel-Katalog · Abschnitt „Threat-Hunt-Katalog"](rules-catalog.md)**.

| Hunt | Fokus (MITRE-Taktik) |
|---|---|
| HUNT-001 | C2 / Beaconing Detection (Command & Control) |
| HUNT-002 | Credential Theft (Credential Access) |
| HUNT-003 | Lateral Movement |
| HUNT-004 | Persistence |
| HUNT-005 | LOLBins / Defense Evasion |
| HUNT-006 | Exfiltration / DNS Tunneling |
| HUNT-007 | Ransomware Precursors (Impact) |
| HUNT-008 | Privilege Escalation |
| HUNT-009 | AD Enumeration (Discovery) |
| HUNT-010 | Initial Access / Phishing |

## Verwandt

- [MITRE ATT&CK in der Oberfläche](../02-user-guide/pages/MITRE.md)
- [YARA-Regeln](../02-user-guide/pages/YARA.md)
- [Detection-Bibliothek](../02-user-guide/pages/DetectionLibrary.md)
- [Use-Case-Developer](../02-user-guide/pages/UseCaseDeveloper.md)
