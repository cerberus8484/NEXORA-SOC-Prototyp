# ML-Evaluation (`/ml-eval`)

## Zweck
Read-Only Daten- und Evaluierungsschicht der KI-basierten Routing-Policy (für advisory KI-Triage-Empfehlungen). Zeigt die aktive Routing-Policy, deren Threshold und Status, sowie Vorschau auf Eval-Snapshots (Gold-Records, Label-Verteilung). **Wichtig:** Dies ist NICHT das KI-Training — es ist die Basis für die advisory Routing-Empfehlung vor Automation.

## Rolle & Sichtbarkeit
**Mindest-Rolle:** admin  
**Nav-Gruppe:** System / KI  
**Zugriffsprüfung:** Admin-only (403 wenn nicht admin)  

## Funktionen

### 1. Info-Banner
- **Icon & Text:** Erklärt Zweck: „Daten- und Evaluationsschicht (Offline-Gold-Eval), kein Modelltraining. Eine aktive Routing-Policy steuert eine **advisory** Empfehlung pro KI-Vorschlag — es wird nie automatisch gehandelt."
- **Wichtiger Hinweis:** Advisory = Mensch genehmigt noch, nie auto-gehandelt

### 2. Aktive Routing-Policy (Card)
- **Status-Anzeige:**
  - Falls aktiv: Badge „Aktiv" (grün)
    - Policy-Name (z. B. `ml-routing-v1.json`)
    - Accept-Threshold (z. B. `≥0.75`)
  - Falls inaktiv: Badge + Grund (z. B. `inactive (file not found)`)

- **Kein Setzen der Policy:** Nur Read-Only
  - Policy wird via `ML_ROUTING_POLICY_PATH` ENV-Variable auf dem Server konfiguriert
  - Status wird vom Backend geprüft

- **Info bei inaktiv:** Link + Text zu `recommended-routing-policy.json` mit `status=ready` hinterlegen

### 3. Eval-Snapshot Preview (Card)
- **Button:** „Snapshot erzeugen" (triggerrt `previewEvalSnapshot()`)
- **Spinner:** während Generierung
- **Fehler:** Falls Fehler, ErrorCard + Retry möglich

- **Snapshot-Anzeige (wenn erfolgreich):**
  - **Records:** Gesamt / exportLimit (z. B. „23 / 1000")
  - **Schema:** Version (z. B. `v1.2`)
  - **Signatur (SHA-256):** Fingerprint der Records (z. B. `c7f4a9d2…`)
  - **Record-Typen:** Pills mit Counts (z. B. `advisory_verdict: 15`, `ml_routing_eval: 8`)
  - **Human-Labels:** Pills mit Label-Verteilung (z. B. `confirmed_incident: 12`, `false_positive: 3`)

- **Leere Anzeige:** Falls Snapshot.returned === 0 → EmptyState „Noch keine Eval-Daten"

## Datenquellen (Backend)

| Funktion | API-Endpunkt | Modul |
|----------|---|---|
| ML-Eval-Status (Policy) | `GET /api/v1/ml-eval/status` | getMlEvalStatus() |
| Eval-Snapshot Vorschau | `POST /api/v1/ml-eval/snapshot/preview` | previewEvalSnapshot() |

## Verknüpfungen zu anderen Seiten

- **Navigiert zu von:** `/ki-agent` (Link „ML-Eval prüfen")
- **Empfängt von:** keine
- **Beeinflusst:** `/analysis` → advisory Routing-Empfehlung pro KI-Vorschlag

## Zustände

### Laden
- Spinner beim initialen Load von Status (Policy)
- Policy-Status wird separat laden

### Fehler
- 403 Forbidden: Admin-Gate, Zugriff verweigert
- API-Fehler beim Status-Load: ErrorCard + Meldung (z. B. „ML-Eval-Status konnte nicht geladen werden (Admin-Rolle nötig)")
- API-Fehler beim Snapshot-Load: ErrorCard + Hinweis zur Retry

### Snapshot-Generierung
- Spinner während Erzeugung
- **Fehler:** ErrorCard mit Fehlermeldung

### Policy inaktiv
- Status-Badge mit Grund
- Info-Hinweis: `ML_ROUTING_POLICY_PATH` setzen

## Besonderheiten

1. **Offline-Gold-Eval:** Snapshots enthalten reviewte KI-Vorschläge und geschlossene Tickets (echte Labels)
2. **Keine Model-Training UI:** Keine Buttons zum Neutraining, kein Hyperparameter-Tuning
3. **Advisory nur:** Policy steuert nur Routing-Empfehlung, nie Auto-Action
4. **Bounded Records:** Snapshot zeigt bis zu exportLimit Records (default ~1000)
5. **Error Hint:** Falls 403, wird Hint `(Admin-Rolle nötig)` angehängt
6. **Monospace für numerisch:** Record-Counts und SHA-Fingerprint in Monospace

## Häufige Workflows

### Policy-Status prüfen
1. `/ml-eval` öffnen
2. Routing-Policy-Card: Status aktiv/inaktiv?
3. Falls inaktiv: ENV-Variable `ML_ROUTING_POLICY_PATH` prüfen + Setup

### Eval-Daten inspizieren
1. Button „Snapshot erzeugen" klick
2. Warten auf Preview
3. Record-Typen + Label-Verteilung einsehen
4. Prüfen: Genug Gold-Records für gutes Training?
5. Audit: SHA-Fingerprint vergleichen (Integrity-Check)
