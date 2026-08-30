# Ticket-Editor (`/tickets/new`, `/tickets/:id`)

## Zweck
Formular zum manuellen Anlegen oder Bearbeiten eines Tickets (Titel, Priorität, Quelle, IoCs, Beschreibung).

## Rolle & Sichtbarkeit
Nicht in der Sidebar — erreichbar aus der Ticket-Liste/Analyse. **Nur `analyst`+**: andere Rollen werden auf `/tickets` umgeleitet (UX-Gate; Server erzwingt es zusätzlich).

## Funktionen
- **Neuanlage** (`/tickets/new`): leeres Formular → Anlegen → Weiterleitung zu `/tickets/<id>`.
- **Bearbeitung** (`/tickets/:id`): Ticket laden → Felder ändern → Speichern → Erfolgsmeldung oder Fehler.
- **RBAC-Gate:** unzureichende Rolle → Redirect statt Formular.

## Datenquellen (Backend)
- `ticketApi.get()` (Laden), `ticketApi.create()` (Neuanlage), `ticketApi.update()` (Speichern, vollständiges PUT).

## Verknüpfungen zu anderen Seiten
- **Empfängt von:** [Tickets](Tickets.md) (Klick/Neu), [Analyse-Deck](Analysis.md) (Stammdaten ändern), [Evidence Center](EvidenceCenter.md) (Jump-to-Ticket).
- **Navigiert zu:** [Tickets](Tickets.md) (nach Speichern/Abbruch).

## Zustände
- Lade-Spinner beim Holen; Erfolgs-Feedback nach Speichern; ehrliche Validierungs-/Fehlermeldung. PUT ersetzt das Ticket vollständig (kein Teil-Merge) — Vorsicht bei Parallel-Bearbeitung.
