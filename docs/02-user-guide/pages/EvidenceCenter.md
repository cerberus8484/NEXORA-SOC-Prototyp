# Evidence Center (`/evidence`)

## Zweck
Übergreifende Verwaltung aller Evidence-Items mit Master-Detail-Browser und Chain-of-Custody — quer über alle Tickets.

## Rolle & Sichtbarkeit
Nav-Gruppe **Operations**. Lesen ab `viewer`; Custody-Aktionen (Verify/Review/Flag) ab `analyst`.

## Funktionen
- **5 KPIs:** Evidence-Items gesamt, Anzahl Quellen, verlinkte Tickets, verifizierte Items, neu (24h).
- **Filter:** Typ (Threat Intel, Firewall, Sysmon …), Quelle, Verdict (clean/suspicious/malicious), Status (open/reviewed/verified/flagged), Zeitraum (24h/7d/30d/all), Freitext.
- **Master-Detail:** Tabelle links, Detail mit Rohtext rechts.
- **Chain-of-Custody:** Integrität verifizieren, Review, Flag + Notiz.
- **Import-Modal:** Evidence manuell hochladen. **Export:** Ticket-Evidence als JSON.
- **Jump-to-Ticket:** Klick → Ticket-Editor des zugehörigen Tickets.

## Datenquellen (Backend)
- `evidenceApi.recent()` (Liste/Filter), `evidenceApi.get()` (Detail), `evidenceApi.custody()` (Verify/Review/Flag), `evidenceApi.exportTicket()` (JSON).

## Verknüpfungen zu anderen Seiten
- **Navigiert zu:** [Ticket-Editor](TicketEditor.md) (Jump-to-Ticket), implizit [Analyse-Deck](Analysis.md) (dieselben Items pro Ticket).
- **Empfängt von:** [Dashboard](Dashboard.md) (KPI „Evidence Items"); gespeist aus SIEM-/Hunt-/TI-Datenflüssen.

## Zustände
- Lade-Spinner; Leerzustand bei leerem Filter; ehrliche Fehlermeldung; Custody-Aktionen mit Erfolgs-/Fehler-Feedback.
