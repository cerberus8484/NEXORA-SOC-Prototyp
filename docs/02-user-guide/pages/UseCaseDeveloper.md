# KI Use-Case Developer (`/use-case-developer`)

## Zweck
KI-gestützte Entwicklungs- und Publikations-Plattform für Detection-Use-Cases. Analyst generiert Entwürfe aus Tickets/Findings/Evidence, prüft Quality-Gate, vergibt Freigaben und veröffentlicht als Detection-Regeln. Workflow: Draft → Review → Approve → Publish → Detection Library.

## Rolle & Sichtbarkeit
**Minimale Rolle:** `analyst` (Generate, Review), `engineer` (Approve/Reject), `admin` (Publish)  
**Navigations-Gruppe:** Analysis / Detection Tools

## Funktionen

### Linkes Panel: Generator + Draft-Liste

- **Neuer Use Case:**
  - Source-Type Dropdown (ticket, finding, evidence, wazuh_rule, manual)
  - Source-ID Input (z.B. INC000123, optional für manual)
  - Button: "Use Case generieren" (disabled wenn nicht analyst+)
  - Hinweis: "Erzeugt nur einen Entwurf — keine Regel wird aktiviert"

- **Entwürfe (Liste):**
  - Scrollbar (max 52vh)
  - Pro Entwurf:
    - Status-Badge (draft/in_review/approved/rejected/published)
    - Severity-Badge (critical/high/medium/low)
    - Titel
    - Quellen-Info (sourceType · sourceId)
  - Active Selection: Highlight + Border
  - Empty State: "Noch keine Entwürfe"

### Mittleres Panel: Draft-Detail

- **Header:** Status- + Severity-Badge, Confidence %, generatedBy-Info
- **Titel:** h2 mit optionalem "(ohne Titel)"
- **Sections:**
  - Description
  - Detection-Ziel
  - Data Sources (Badges)
  - Required Fields (Badges)
  - **Detection Logic:** Language (generic/wazuh/sigma/splunk/qradar) + queryOrRule (pre) + Erklärung
  - **MITRE ATT&CK:** Technique + Tactic Badges (oder "—")
  - **False-Positive-Risiken:** List mit AlertTriangle-Icon
  - **Test Cases:** Tabelle (true_positive/false_positive Badge, Name, Expected Result)
  - **Recommended Actions:** List
  - **Playbook Steps:** Ordered List

- **Export-Vorschau:**
  - Format-Tabs (wazuh / sigma / splunk / qradar)
  - Refresh-Button
  - Vorschau-Code (pre, overflow-auto)
  - Copy- + Download-Buttons
  - Hinweis: "Reine Vorschau — kein Schreiben, keine Aktivierung"

### Rechtes Panel: Quality-Gate + Workflow

- **Quality-Gate Card:**
  - Passed/Failed Badge + Score
  - Check-Liste (✓/⚠/✗ + Label)

- **Workflow Card:**
  - Button: "Zur Prüfung geben" (enabled wenn draft)
  - Button: "Genehmigen" (enabled wenn in_review, engineer+)
  - Button: "Ablehnen" (enabled wenn in_review, engineer+)
  - Button: "Veröffentlichen" (enabled wenn approved, admin-only, rot)
  - Hinweis: "Analyst erstellt + prüft · Engineer/Admin entscheidet · Admin veröffentlicht. Kein Auto-Write."

- **Message Box:** Erfolgs- oder Fehler-Meldung nach Aktion

## Datenquellen (Backend)

| Endpunkt | Zweck |
|---|---|
| `POST /use-case-drafts/generate` | Generiere Draft aus Source (KI/Stub) |
| `GET /use-case-drafts` | Alle Drafts (paginiert) |
| `GET /use-case-drafts/{id}` | Einzelner Draft |
| `GET /use-case-drafts/{id}/quality` | Quality-Gate-Bewertung |
| `GET /use-case-drafts/{id}/export?format=wazuh\|sigma\|splunk\|qradar` | Export-Vorschau |
| `POST /use-case-drafts/{id}/review` | Draft → Review (analyst) |
| `POST /use-case-drafts/{id}/approve` | Review → Approved (engineer) |
| `POST /use-case-drafts/{id}/reject` | Review → Rejected (engineer) |
| `POST /use-case-drafts/{id}/publish` | Approved → Published (admin) → Detection-Library-Eintrag |

**Implementierungsdetail:** `useCaseApi` aus `frontend/src/features/useCases/useCaseDeveloperApi.ts`.

## Verknüpfungen zu anderen Seiten

**Navigiert zu:**
- (keine direkte Navigation; Seite ist self-contained)

**Verlinkt zu / empfängt von:**
- **Tickets** (`/tickets/{id}`) — Source bei Generation
- **Findings** (in ThreatHunts) — Source bei Generation
- **Evidence** (`/evidence`) — Source bei Generation
- **DetectionLibrary** (`/detections`) — Published Detections erscheinen dort

## Zustände

| Zustand | Verhalten |
|---|---|
| **Lädt Draft-Liste** | Spinner in der Draft-Liste |
| **Kein Draft gewählt** | Empty State in Mitte |
| **Draft geladen** | Alle Felder und Sections sichtbar |
| **Quality-Gate:** Pass | Grüne Badge + Check-Häkchen |
| **Quality-Gate:** Fail | Rote Badge + Kreuze; manche Checks als Warnungen |
| **Generating** | Button "Generiere …"; busy-State |
| **Export:** Loading | "Generiere Vorschau …" |
| **Export:** Erfolg | Code-Block mit Kopieren + Download |
| **Export:** Leer | "Format wählen und «Laden» klicken" |
| **Workflow:** Draft | "Zur Prüfung geben" enabled |
| **Workflow:** In Review | "Genehmigen" + "Ablehnen" enabled |
| **Workflow:** Approved | "Veröffentlichen" (rot) enabled |
| **Workflow:** Published | Read-Only, alle Buttons disabled |
| **Workflow:** Rejected | Read-Only |

**Hinweise:**
- Generierung kann Ollama/Cloud-Provider brauchen (Fehler falls nicht verfügbar)
- Export ist Vorschau ohne Speichern
- Lifecycle: draft → review → approve/reject → publish
- RBAC serverseitig; Buttons werden Frontend-seitig disabled
- Generierungs-Info zeigt "Beispiel-Entwurf (kein LLM)" für Stub-Generator
