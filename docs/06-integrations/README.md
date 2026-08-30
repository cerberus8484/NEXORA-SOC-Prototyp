# Integrationen (Referenz)

Dieser Bereich enthält die Referenz zu Drittsystem-Integrationen. Die **Einrichtung in der
Oberfläche** steht unter [Administration → Integrationen](../administration/integrationen.md).

## Inhalt

- **[QRadar Go-Live](./qradar-go-live.md)** — IBM-QRadar-Integrationsleitfaden
  - Offense-zu-Ticket-Workflow
  - Webhook-Konfiguration
  - Feld-Mapping und Normalisierung
  - Go-Live-Checkliste

## Weitere Integrationen

Über QRadar hinaus sind diese Integrationen in der [Feature-Status-Matrix](../00-overview/feature-status.md)
dokumentiert:

- **SIEM inbound (adapter-basiert):** Wazuh (primär), QRadar, Splunk, generische Webhooks (HMAC + Nonce).
- **Threat Intel:** VirusTotal + AbuseIPDB (Keys nur im Backend), persistenter Postgres-Reputation-Cache.
- **CrowdSec WAN:** LAPI-Client + Poller + Processor ziehen die externe Angriffsfläche in die Pipeline.
- **Outbound Ticket-Export:** ServiceNow / OTRS via `POST /v1/tickets/:id/export` (+ Status-Sync), ENV-gated.
- **Benachrichtigungen (outbound):** Slack, Webhook, Microsoft Teams, E-Mail/SMTP (siehe
  [Administration → Benachrichtigungen](../administration/benachrichtigungen.md)).

!!! note "QRadar-Use-Case-Bibliothek"
    Die ausführliche QRadar-Szenario-Bibliothek (SSH-Brute-Force, LSASS, Kerberoasting, PsExec,
    RDP-Pivoting, Data-Destruction u. a.) und die ATT&CK-Coverage-Map werden als eigene
    Markdown-Seiten in die Doku überführt. *(Konsolidierung läuft — bis dahin nicht als externe
    HTML verlinkt.)*

---

**Siehe auch:** [Detection & Threat Hunting](../detection/index.md) und
[MITRE ATT&CK in der Oberfläche](../02-user-guide/pages/MITRE.md).
