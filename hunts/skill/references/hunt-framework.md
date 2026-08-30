# Hunt Framework — Definition Schema

## Hunt-Definition Schema

```python
HUNT = {
    # Identifikation
    "id":           "HUNT-001",           # Eindeutige ID
    "name":         "Name des Hunts",
    "version":      "1.0.0",
    "status":       "DRAFT|TESTING|VALIDATED|ACTIVE|DEPRECATED",
    "author":       "Analyst",
    "created":      "2026-06-03",

    # MITRE ATT&CK
    "mitre": {
        "techniques": ["T1059.001"],      # Haupt-Technik
        "subtechniques": [],
        "tactics": ["Execution"],
        "groups": ["APT29", "Lazarus"]    # falls bekannt
    },

    # Log-Quellen (was MUSS vorhanden sein)
    "required_sources": [
        "windows_security",               # Windows Security Events
        "sysmon",                         # Sysmon (empfohlen)
        "firewall",                       # Firewall-Logs
        "dns",                            # DNS-Logs
    ],

    # Erkennungslogik
    "detection": {
        "qradar_aql":  "SELECT ... FROM events WHERE ...",
        "splunk_spl":  "index=* sourcetype=... | ...",
        "sigma":       "...",             # Sigma-Regel (optional)
        "description": "Was erkannt wird und warum"
    },

    # Was MUSS erkannt werden (mit Konfidenz)
    "true_positives": [
        {
            "id":          "TP-001",
            "description": "Standard-Angriff, Lehrbuchfall",
            "confidence":  95,
            "fixture":     "fixtures/tp_001_standard.json",
            "indicators":  ["indicator1", "indicator2"]
        }
    ],

    # Was DARF NICHT erkannt werden
    "false_positives": [
        {
            "id":          "FP-001",
            "description": "Legitimer Admin-Tool-Einsatz",
            "source":      "IT-Operations, Monitoring",
            "whitelist":   "host in ADMIN_HOSTS oder user in ADMIN_USERS",
            "fixture":     "fixtures/fp_001_legit_admin.json"
        }
    ],

    # Alle Varianten / Evasion die erkannt werden müssen
    "variants": [
        {
            "id":          "VAR-001",
            "technique":   "Obfuskation via Base64",
            "description": "Payload wird base64-encoded übergeben",
            "confidence_modifier": -5,    # Konfidenz-Abzug wegen Unsicherheit
            "fixture":     "fixtures/var_001_base64.json"
        }
    ],

    # Grenzfälle
    "edge_cases": [
        {
            "id":          "EDGE-001",
            "description": "Legitimes Tool mit gleichem Muster",
            "expected":    "NOT_DETECTED",
            "fixture":     "fixtures/edge_001.json"
        }
    ],

    # Konfidenz-Berechnung
    "confidence_scoring": {
        "base_score": 50,
        "modifiers": [
            {"condition": "known_bad_ip",         "modifier": +30},
            {"condition": "process_injection",    "modifier": +25},
            {"condition": "from_temp_dir",        "modifier": +15},
            {"condition": "signed_binary",        "modifier": -10},
            {"condition": "known_admin_host",     "modifier": -40},
        ]
    },

    # Was braucht man als Evidence
    "evidence_required": [
        "Prozess-Kontext (PID, Parent, Commandline)",
        "Netzwerk-Verbindung (Ziel-IP, Port, Bytes)",
        "User-Kontext (Username, Logon-Session)",
        "Zeitstempel",
        "Rohdaten-Referenz (Log-ID)"
    ],

    # Empfehlungen nach Konfidenz
    "recommended_actions": {
        "90_100": "Sofort eskalieren, Endpoint-Isolation vorschlagen",
        "70_89":  "An Analyst eskalieren, Evidence sammeln",
        "50_69":  "Ticket erstellen, weitere Analyse nötig",
        "30_49":  "Nur loggen",
        "below_30": "Verwerfen"
    },

    # Test-Metriken (wird gefüllt wenn Hunt läuft)
    "metrics": {
        "tp_rate":        None,
        "fp_rate":        None,
        "avg_confidence": None,
        "last_tested":    None
    }
}
```

## Fixture-Format (Log-Samples)

```json
{
  "fixture_id": "TP-001",
  "description": "Standard PowerShell C2 Beacon",
  "expected_result": {
    "detected": true,
    "min_confidence": 80,
    "indicators_present": ["encoded_command", "external_ip", "hidden_window"]
  },
  "log_events": [
    {
      "source":    "windows_security",
      "event_id":  4688,
      "timestamp": "2026-06-03T14:05:00Z",
      "fields": {
        "NewProcessName":       "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
        "CommandLine":          "powershell.exe -nop -w hidden -enc SQBuAHYAbwBrAGUALQBXAGUAYgBSAGUAcQB1AGUAcwB0AA==",
        "ParentProcessName":    "C:\\Windows\\System32\\cmd.exe",
        "SubjectUserName":      "jdoe",
        "SubjectDomainName":    "CORP"
      }
    },
    {
      "source":    "firewall",
      "timestamp": "2026-06-03T14:05:03Z",
      "fields": {
        "src_ip":   "192.168.243.45",
        "dst_ip":   "185.220.101.47",
        "dst_port": 443,
        "bytes_out": 1480,
        "action":   "allow"
      }
    }
  ]
}
```

## QRadar Field Mapping (Referenz)

```
sourceip              → Source IP
destinationip         → Destination IP
username              → Benutzername
EventID               → Windows Event ID
CommandLine           → Prozess-Commandline (via Sysmon)
ProcessName           → Prozess-Name
ParentProcessName     → Eltern-Prozess
BytesSent             → Bytes gesendet
BytesReceived         → Bytes empfangen
category              → Event-Kategorie
severity              → Schweregrad
```

## Splunk Field Mapping (Referenz)

```
src / src_ip          → Source IP
dest / dest_ip        → Destination IP
user / src_user       → Benutzername
EventCode             → Windows Event ID
process               → Prozess-Commandline
process_name          → Prozess-Name
parent_process        → Eltern-Prozess
bytes_out             → Bytes gesendet
bytes_in              → Bytes empfangen
signature             → Event-Signatur
```

## Sysmon Event IDs (wichtigste)

| Event ID | Bedeutung |
|---|---|
| 1  | Prozess erstellt (inkl. Commandline, Hashes) |
| 2  | Dateizeitstempel geändert |
| 3  | Netzwerkverbindung |
| 5  | Prozess beendet |
| 6  | Treiber geladen |
| 7  | DLL geladen (mit Image Load) |
| 8  | CreateRemoteThread (Prozess-Injektion) |
| 10 | ProcessAccess (LSASS-Zugriff) |
| 11 | Datei erstellt |
| 12/13 | Registry-Operationen |
| 15 | Alternate Data Stream |
| 17/18 | Named Pipe erstellt/verbunden |
| 22 | DNS-Abfrage |
| 23 | Datei gelöscht |
| 25 | Prozess manipuliert (Tampering) |
| 26 | Datei gelöscht (inkl. gelöschte Dateien) |

## Windows Security Event IDs (wichtigste)

| Event ID | Bedeutung |
|---|---|
| 4624 | Anmeldung erfolgreich (Logon Type beachten!) |
| 4625 | Anmeldung fehlgeschlagen |
| 4648 | Explizite Anmeldung |
| 4656 | Handle zu Objekt angefordert (LSASS!) |
| 4663 | Auf Objekt zugegriffen |
| 4688 | Prozess erstellt (ohne Commandline ohne Audit-Policy) |
| 4698 | Geplante Aufgabe erstellt |
| 4720 | Benutzerkonto erstellt |
| 4732 | Mitglied zu lokaler Gruppe hinzugefügt |
| 4768 | Kerberos TGT angefordert |
| 4769 | Kerberos Service Ticket angefordert (Kerberoasting!) |
| 4771 | Kerberos Pre-Auth fehlgeschlagen |
| 5136 | Verzeichnisobjekt geändert (AD-Änderungen) |
| 7045 | Dienst installiert |

## Logon Types

| Type | Bedeutung | Relevanz |
|---|---|---|
| 2  | Interaktiv (Konsole) | Normal |
| 3  | Netzwerk (SMB, RPC) | Lateral Movement! |
| 4  | Batch | Geplante Tasks |
| 5  | Service | Service-Accounts |
| 7  | Entsperren | |
| 8  | Netzwerk Cleartext | Verdächtig |
| 9  | Neue Credentials | runas |
| 10 | Remote Interaktiv (RDP) | Lateral Movement! |
| 11 | Cache Interaktiv | Offline |
