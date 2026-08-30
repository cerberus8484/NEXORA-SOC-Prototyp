# Tickets (`/tickets`)

## Zweck
Master-Liste aller Incident-Tickets mit Filtern, Suche und Bulk-Aktionen — der Einstieg in die tägliche Triage.

## Rolle & Sichtbarkeit
Nav-Gruppe **Operations**. Lesen ab `viewer`; Schreiben (Zuweisen/Schließen/FP) ab `analyst`; Löschen nur `admin`.

## Funktionen
- **Filter-Leiste:** Zustand (offen/geschlossen), Status (assigned/in_progress/on_hold/awaiting_customer), Priorität, Quelle, Freitext-Suche, „Nur meine".
- **Pagination:** 25 Tickets pro Seite.
- **Bulk-Aktionen** (bei Auswahl): ausgewählte schließen, löschen (admin), Auswahl aufheben.
- **Kontextmenü (Rechtsklick):** Zuweisen/Entziehen, Schließen, False-Positive-Modal, Löschen (admin).
- **False-Positive-Modal:** Pflicht-Begründung → als `closeReason` gespeichert.
- **Lösch-Modal (admin):** Bestätigung vor Einzel-Löschung; **Bulk-Delete-Modal** mit ehrlicher Erfolgs-/Fehler-Rückmeldung pro Ticket.

## Datenquellen (Backend)
- `ticketApi.list()` (Filter/Pagination/Suche), `ticketApi.update()` (Status/Assign/Close), `ticketApi.delete()` + `ticketApi.bulkDelete()` (admin).

## Verknüpfungen zu anderen Seiten
- **Navigiert zu:** [Analyse-Deck](Analysis.md) (Ticket analysieren), [Ticket-Editor](TicketEditor.md) (Stammdaten/Neuanlage).
- **Empfängt von:** [Dashboard](Dashboard.md) (KPI „Offene Tickets"), automatisch aus [Wazuh](WazuhDashboard.md)/[QRadar](QRadarAnalysis.md)/[Data-Plane](DataPlane.md) (Alerts → Tickets).

## Zustände
- Lade-Spinner; Leerzustand bei leerem Filter; ehrliche Fehlermeldung; Bulk-Delete meldet pro Ticket Erfolg/Fehler (keine stille Teil-Löschung).
