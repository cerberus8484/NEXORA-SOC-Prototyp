# Audit-Log (`/audit`)

## Zweck
Vollständiges Sicherheitsprotokoll aller Plattform-Aktivitäten: Logins, Ticket-Mutationen, Rollen-Änderungen, Einstellungs-Änderungen, KI-Genehmigungen. Append-only, mit IP-Hashes, RBAC-Gating (Analyst+) und Export (CSV/PDF mit Trunkierungs-Feedback).

## Rolle & Sichtbarkeit
- **Mindest-Rolle:** analyst (server-side + client-side gate)
- **Nav-Gruppe:** Monitoring — Betrieb & Beobachtung

## Funktionen

- **Filter-Bar:**
  - **Aktion:** Dropdown mit 14 Optionen (LOGIN, LOGOUT, LOGIN_FAILED, TICKET_CREATE/UPDATE/DELETE/VIEW, AGENT_SUGGESTION_APPROVE/REJECT, USER_ROLE_CHANGE, USER_ACTIVE_CHANGE, USER_CREATED, SETTINGS_CHANGED)
  - **Zieltyp:** Dropdown (ticket, user, settings, agent_suggestion)
  - **Suchfeld:** Live-Filter über Akteur, Ziel-ID (debounced 300ms, serverseitig)
  - **Filter zurücksetzen:** Button "Clear Filters"

- **Audit-Tabelle:**
  - Spalten: Zeitpunkt (ISO, lokal), Aktion (Badge, farbcodiert), Akteur (E-Mail/Name), Ziel (Typ · ID), IP (Hash)
  - Sortierung: absteigend nach Zeitpunkt (neueste oben)
  - Pagination: 50 Einträge pro Seite
  - Fußzeile: "X–Y von Z · Seite N" + Vor/Zurück-Buttons

- **Pagination:**
  - Server-seitig (`offset` + `limit=50`)
  - Total-Zahl aus Server (`res.total`)
  - hasNext-Flag für "Weiter"-Button-Status
  - Knöpfe: "Zurück" (disabled wenn offset=0), "Weiter" (disabled wenn kein Next)

- **Export-Buttons:**
  - **CSV-Export:** mit BOM für Excel-UTF8-Kompatibilität, CSV-Injection-Schutz
  - **PDF-Export:** dynamic-import von jsPDF-Bibliothek (nicht im Haupt-Bundle)
  - Beide Buttons: disabled wenn keine Einträge, Lade-State während Export

- **Export-Hinweis (bei Trunkierung):**
  - Warnung oben sichtbar wenn Export gekürzt wurde
  - Text: "Export auf X von Y Einträgen begrenzt — Filter oder Suche verfeinern für einen vollständigen Export."
  - Hinweis schließbar (X-Button)
  - Tone: warning

## Datenquellen (Backend)

**Endpunkte:**
- `GET /api/v1/audit/log?limit=50&offset=O&action=A&targetType=T&search=S` → paginiert, total + hasNext
- `GET /api/v1/audit/export?action=A&targetType=T&search=S&format=csv|pdf` → Rows + truncated + total + exportLimit

**API-Modul:** `frontend/src/features/audit/auditApi.ts` → `auditApi.list()`, `.exportAudit()`

**Rückgabetypen (Auswahl):**
```typescript
interface AuditEntry {
  id: string;
  createdAt: string;     // ISO
  action: string;        // LOGIN, TICKET_CREATE, etc.
  actorLabel?: string;   // "alice@example.com" oder user.email
  targetType?: string;   // ticket, user, settings, agent_suggestion
  targetId?: string;     // Ticket-ID, User-ID, etc.
  ip?: string;           // SHA-256-Hash der IP (IP-Anonymisierung, GDPR)
}

interface AuditListResponse {
  data: AuditEntry[];
  total?: number;
  hasNext?: boolean;
}

interface AuditExportResponse {
  data: AuditEntry[];
  truncated: boolean;
  total?: number;
  exportLimit?: number;
}
```

**Export-Helper:**
- `auditEntriesToCsv(rows)` — CSV-Serialisierung mit Injection-Schutz
- `auditCsvFilename()` → `audit-YYYY-MM-DD-HHMMSS.csv`
- `buildAuditPdfDoc(rows)` → jsPDF-Dokument
- `auditPdfFilename()` → `audit-YYYY-MM-DD-HHMMSS.pdf`

## Verknüpfungen zu anderen Seiten

- **Verwandt mit:**
  - `/tickets` — Ticket-Mutationen werden auditiert
  - `/settings` — Einstellungs-Änderungen werden auditiert
  - `/system` — Audit-Log ist Teil der Systemüberwachung

- **Keine direkten Navigationen** — reine Ansicht

## Zustände

- **RBAC-Block (Viewer-Rolle):**
  - Full-page Card mit "Zugriff verweigert. Das Audit-Log ist Analyst+ vorbehalten."

- **Lade-Zustand:** Spinner (während Server-Request), Table semi-transparent (opacity: 0.5)

- **Fehler:** ErrorCard mit Meldung

- **Keine Einträge:** EmptyState
  - Titel: "Keine Einträge"
  - Nachricht: "Keine Einträge passen zu diesem Filter" (wenn Filter aktiv) oder "Das Audit-Log ist leer" (bei leerer DB)

- **Erfolgreiche Ladung:** Tabelle mit Einträgen + Pagination-Bar

- **Export laufend:** Export-Buttons deaktiviert, Lade-State ("Export …")

- **Export gekürzt:** Hinweis-Card oben sichtbar mit Erklärung + Schließen-Button

## Besonderheiten

- **Serverseitige Suche:**
  - Nicht Client-seitig gefiltert (wichtig für Forensik — alle Einträge, nicht nur Seite 1)
  - Debounce 300ms für UX
  - Wirkt über Actor + Target-ID

- **IP-Hashing:**
  - IPs werden SHA-256-gehasht (GDPR-Compliance)
  - Angezeigt als Hash-String (nicht rekonstruierbar)

- **Export-Limits:**
  - Server kann Export auf Z.B. 10.000 Einträge cappen
  - Wenn gekürzt: `truncated=true` + `exportLimit=N`
  - UI teilt dem Nutzer mit, dass der Export unvollständig ist

- **CSV-Injection-Schutz:**
  - Strings, die mit `=`, `+`, `@`, `-` beginnen, werden escaped
  - `auditEntriesToCsv()` implementiert Schutz

- **PDF-Export:**
  - dynamisch importiert → kein bloat im Haupt-Bundle
  - jsPDF + autoTable für Tabellenlayout
  - Zeitstempel + Logo im Header

- **Pagination Heuristik:**
  - Wenn `hasNext=null`: Fallback auf `offset + PAGE_SIZE < total` (wenn total bekannt)
  - Sonst: Heuristik "wenn vollständige Seite, dann gibt es mehr"

## Hinweise zur Ehrlichkeit der Daten

- **Alle Einträge:** Append-only DB-Speicherung, unveränderlich nach Creation
- **Timestamps:** UTC-Speicherung, lokal formatiert für UI
- **IP-Hashes:** Konsistent pro Nutzer-Session (gleicher Hash für gleiche IP)
- **Action-Types:** Enum-validiert (kein beliebiger String)
- **Target-ID:** nur wenn relevant (z.B. null für USER_CREATED ohne Referenz)
- **Export:** Server-seitig gefiltert + serverseitig trunciert (keine Client-Manipulation möglich)
- **Keine Löschungen:** Audit-Log ist immutable; Einträge können nicht entfernt werden
