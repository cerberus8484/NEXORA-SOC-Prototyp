# Analyse-Deck (`/analysis`)

## Zweck
Zentrale Ermittlungs-Workbench für SOC-Analysten: ein Ticket tief analysieren — Evidence erkunden, anreichern, ein Urteil treffen und einen Report exportieren.

## Rolle & Sichtbarkeit
Nav-Gruppe **Operations**. Sichtbar ab `viewer` (read-only); Schreib-/Entscheidungsaktionen ab `analyst`.

## Funktionen
- **Ticket-Switcher (Header):** schnelles Wechseln zwischen den zuletzt aktualisierten Tickets (bis 100), ohne die Seite zu verlassen.
- **12 Analyse-Tabs:**
  - **Overview:** 3×3-Evidence-Grid, Risk-Score, extrahierte Entitäten, verwandte Fälle, Decision-Rail (Urteil setzen).
  - **Timeline:** Ereignis-Chronologie + Netzwerk-Flows.
  - **Network & NAT:** NAT-Zuordnungen + Verbindungen.
  - **Commands:** forensische Befehle mit (Live-)Output.
  - **Payloads:** Malware-Bezug (Hashes, Magic-Bytes).
  - **Entities:** IP/Domain/User/Host-Extrakte.
  - **IoCs / Export:** Reputations-Anreicherung (VT/AbuseIPDB) + Cross-Reference + JSON-Export.
  - **Evidence:** Master-Detail-Browser aller Evidence-Items des Tickets.
  - **KI Analysis:** KI-Verdict (Ollama/Cloud) mit „in Notizen übernehmen".
  - **Notes:** persistierte Notizen + Checklisten.
  - **History:** Audit-Trail der Ticket-Änderungen.
  - **Playbooks:** Workflow-Status (Containment, Kommunikation …).
  - **Report:** PDF-/Markdown-Export.

## Datenquellen (Backend)
- `ticketApi.*` (Ticket + Logs/Evidence), `evidenceApi.*`, `threatIntelApi.enrich()` (IoC-Reputation on demand), `agentApi.forTicket()` (KI-Verdict). Die reiche Evidence kommt aus der materialisierten Korrelations-Engine (siehe **System & DB**).

## Verknüpfungen zu anderen Seiten
- **Empfängt von:** [Tickets](Tickets.md) (Klick auf ein Ticket öffnet es hier), [Dashboard](Dashboard.md) (Schnellzugriff „Analysis-Deck").
- **Verwandt:** [Evidence Center](EvidenceCenter.md) (dieselben Evidence-Items, dort übergreifend), [KI Agent](KiAgent.md) (KI-Konfiguration, die hier wirkt).
- **Navigiert zu:** [Ticket-Editor](TicketEditor.md) (Stammdaten ändern).

## Zustände
- Lade-Spinner je Tab; ehrliche Leerzustände, wenn ein Ticket (noch) keine Evidence/Flows/Payloads hat. Korrelations-Status wird als aktuell/ausstehend/veraltet gekennzeichnet (nie veraltete Daten als aktuell).
