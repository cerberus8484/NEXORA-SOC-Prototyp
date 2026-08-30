# KI Agent (`/ki-agent`)

## Zweck
Zentrale Konfigurationsseite für den lokalen KI-Agenten. Hier stellen Administratoren den LLM-Provider, das Modell, die RAG-Wissensbasis und die HITL-/Autonomy-Einstellungen ein. Die operative KI-Nutzung erfolgt im Analysis-Deck unter dem Tab „KI Analyse" beim aktiven Ticket.

## Rolle & Sichtbarkeit
**Mindest-Rolle:** admin  
**Nav-Gruppe:** System (Menü `Einstellungen > KI Agent`)  
**Zugriffsprüfung:** Frontend-Gate (Render-Gate für Nicht-Admins); echte Durchsetzung serverseitig  
**Hinweis:** Kein Sicherheitsersatz — die Frontend-Prüfung ist rein informativ

## Funktionen

### 1. KI-Provider & Modell (KiSettingsCard)
- **LLM-Provider:** Dropdown (Ollama / Anthropic / OpenAI / Google)
- **Modell:** Textfeld (z. B. `llama3.2:3b`, `claude-3-sonnet`)
- **Base-URL:** Feld für Custom-Endpunkt (z. B. `http://localhost:11434` für Ollama)
- **API-Key:** Passwort-Feld (bei Cloud-Providern, nur in Settings sichtbar wenn Wert gespeichert)
- **Status:** Badge zeigt Provider + Modell an
- Speicherung über Admin-Panel (serverseitig validiert)

### 2. RAG-Wissensbasis (RagCard)
- **Qdrant-Verbindung:** Anzeige der URL, Collection-Name
- **Verfügbare Collections:** Index-Übersicht (z. B. MITRE ATT&CK 697 Techniken, Hunt-Katalog)
- **Status:** Badge (Connected / Error)
- **Refresh-Button:** Neu laden der Collection-Stats
- Keine Bearbeitung auf dieser Seite — Wissensbasis wird serverseitig über Migrations-/Sync-Prozess gefüllt

### 3. KI-Analysefunktionen (KiFunctionsCard)
- Rein informativer Katalog der 9 aktiven Funktionen (aus `kiAnalysisFunctions.ts`)
  - Triage, Verdict, Recommendation, Attack Classification, …
  - Beschreibung + Code-Name (`kind`)
- Operative Nutzung im Analysis-Deck

### 4. Human-in-the-Loop & Confidence (HitlCard)
- **Status:** Badge zeigt an, ob Manuelle Freigabe aktiv oder Autonomie aktiv
- **Link zu Autonomy-Policies:** Steuert Confidence-Schwellen, Autonomie-Modi, Aktionsklassen-Decken
- **Erklärtext:** Jeder Vorschlag braucht explizite Freigabe, falls Autonomy deaktiviert

### 5. Rollenrechte — KI-Aktionen (KiRbacCard)
- Read-only Matrixtabelle: Aktion → Beschreibung → Min. Rolle
  - z. B. `approvePrediction` = admin+
- Durchsetzung serverseitig in `authenticate.js` + Middleware

### 6. Prompt-Templates (PromptTemplatesCard)
- **Status:** Ehrlich als „Geplant" markiert
- **Hinweis:** Prompts liegen aktuell serverseitig in `OllamaLlmProvider._buildPromptFromBundle()`
- **Ausblick:** Zukünftig Template-Editor pro Funktion (Triage, Report Draft, …) ohne Neustart

## Datenquellen (Backend)

| Funktion | API-Endpunkt | Modul |
|----------|---|---|
| KI-Provider/Modell laden & speichern | `GET/PUT /api/v1/settings/ki` | `KiSettingsCard` (via settingsApi) |
| RAG-Status | `GET /api/v1/rag/status` | `RagCard` (via settingsApi) |
| Autonomy-Status | `GET /api/v1/autonomy/status` | `HitlCard` (via autonomyApi) |
| KI-Funktionen | (lokal aus `kiAnalysisFunctions.ts`) | `KiFunctionsCard` |
| RBAC-Matrix | (lokal aus `kiAgentRbac.ts`) | `KiRbacCard` |

## Verknüpfungen zu anderen Seiten

- **Navigiert zu / steuert:** `/autonomy-policies` — Confidence-Schwellen, Autonomie-Modi pro Mandant
- **Empfängt von:** `/analysis` → bei KI-Vorschlag Funktionen und Rollen aus dieser Seite nutzen
- **Verknüpft mit:** `/settings` (Tab „KI-Einstellungen") — dupliziert hier Anzeige der KiSettingsCard + RagCard

## Zustände

### Laden
- Spinner beim initialen Load von Provider/Modell
- RAG-Status wird separat geladen (kann offline sein)

### Leer
- Noch keine Provider-Konfiguration: Info-Nachricht „Bitte Provider und Modell konfigurieren"
- RAG-Collections offline: Warning-Badge + Fehlermeldung

### Fehler
- 403 Forbidden (Nicht-Admin): Zugriff verweigert (Render-Gate)
- Provider-Validierung fehlgeschlagen: Fehlermeldung im Settings-Panel
- RAG-Verbindung fehlgeschlagen: Error-Badge auf RagCard

### Geplant / Inert
- **Prompt-Templates:** Nicht verfügbar (ehrlich gekennzeichnet)
- **ENV-Gating:**
  - `KI_ENABLED=false` → KiSettingsCard zeigt Warnung, Provider wählbar aber inert
  - `AUTONOMY_ENABLED=false` → HitlCard erklärt, dass Policies vorbereitet aber inert sind

## Besonderheiten

1. **Keine doppelte Konfiguration:** Echte Werte kommen serverseitig vom LLM-Provider und Qdrant
2. **Rollen korrekt:** RBAC-Matrix und Funktionen sind read-only (UI kann nicht überschreiben)
3. **Ehrliches Design:** Geplante Features (Prompt-Templates) sind nicht gefaket — klare Benachrichtigung, wann verfügbar
4. **Operativer Code:** Operative KI läuft im Analysis-Deck (`/analysis` Tab „KI Analyse"), nicht hier — diese Seite ist rein Admin-Konfiguration
