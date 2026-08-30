# ML-Training-Plan

**Stand:** 2026-06-29  
**Status:** MLE-Track vorbereitet, Implementierung offen.

## 1. Ziel

Nexora soll spaeter aus echten Betriebsdaten lernen koennen, ohne dabei seine heutigen
Sicherheits- und Qualitaetsprinzipien aufzugeben:

- Human-in-the-loop
- No-Fake / nachvollziehbare Begruendung
- Privacy by Design
- reproduzierbare Qualitaetsmessung

Der erste Schritt ist **nicht** sofortiges Fine-Tuning, sondern eine belastbare Lernschleife
mit Eval-Harness, Label-Disziplin und Fehleranalyse.

## 2. Warum nicht direkt trainieren?

Das Produkt ist heute auf:

- RAG
- Provider-Routing
- Confidence-/Guardrail-Logik
- menschliche Freigaben
- Audit

optimiert. In so einem System ist fruehes Modelltraining riskant, wenn noch unklar ist:

- was ueberhaupt das Zielsignal ist
- welche Labels vertrauenswuerdig sind
- welche Fehler teuer sind
- wie Ticket-Rohdaten und PII sauber redigiert werden

## 3. Prinzip

**Reihenfolge:**

1. Datenvertrag
2. Label-Schema
3. Offline-Eval
4. Fehlercluster / Slice-Analyse
5. Threshold-/Routing-Verbesserungen
6. Erst dann optional echtes Training

Der erste konkrete Datenvertrag dazu liegt in
`docs/01-architecture/ml-label-contract.md`.
Das erste Ziel-Exportformat fuer Offline-Evals liegt in
`docs/01-architecture/ml-eval-schema.md` plus Beispiel
`docs/01-architecture/ml-eval-sample.jsonl`.

## 4. Moegliche Label-Quellen

Potenzielle Quellen fuer spaetere Trainings- oder Eval-Daten:

- genehmigte AgentSuggestion
- abgelehnte AgentSuggestion inklusive Ablehnungsgrund
- Ticket-Abschluss und finale Analystenentscheidung
- False-Positive-Entscheidungen
- genehmigte / verworfene Use-Case-Drafts
- spaeter qualitaetsgesicherte Hunt-Ergebnisse

Wichtig: Diese Quellen sind **nicht automatisch Ground Truth**. Sie sind zunaechst nur
reviewbeduerftige Signale.

## 5. Erste sinnvolle ML-/MLE-Ziele

### Geeignet als fruehe Ziele

- Ranking / Priorisierung von KI-Vorschlaegen
- Abstention- oder Review-Routing
- Confidence-Kalibrierung
- False-Positive-Hinweise
- Aehnlichkeitsverbesserungen fuer Retrieval / ähnliche Incidents

### Ungeeignet als erster Schritt

- vollautonome Incident-Entscheidungen
- Black-Box-Verdicts ohne Quellen
- direkter Ersatz fuer Analystenreview
- aggressive Automatisierung auf Basis schwacher Labels

## 6. Datenvertrag

Bevor Training ueberhaupt diskutiert wird, braucht Nexora einen klaren Vertrag:

- Welche Entitaet wird bewertet? Ticket, Suggestion, Verdict, Use-Case-Draft?
- Welcher Zeitpunkt gilt fuer das Label?
- Welche Felder duerfen in Training / Eval hinein?
- Welche Felder sind verboten oder muessen redigiert werden?
- Wie werden Version, Snapshot und Herkunft dokumentiert?

## 7. Privacy- und Security-Anforderungen

- keine Secrets in Trainings-/Eval-Artefakten
- keine unredigierten Rohdaten aus Incidents als Standard-Dataset
- interne IPs, Hostnamen, Usernamen, Mailadressen und Credentials nur nach klarer Redaktion
- keine unkontrollierte Nutzung externer Dienste fuer Trainingsdaten
- Auditierbarkeit der Datensatz-Herkunft

## 8. Eval-Harness statt Bauchgefuehl

Der erste praktische Nutzen kommt aus einer Eval-Strecke:

- Baseline definieren
- Slices definieren
- Fehlertypen clustern
- Prompts / Provider / Guardrails vergleichen
- Confidence-Schwellen pruefen
- Regressionen konservieren

Beispielfragen:

- Wo liefert der aktuelle Agent zu viele False Positives?
- Bei welchen Ticket-Typen ist die Confidence systematisch zu hoch?
- Wo ist RAG stark, wo fehlt Kontext?
- Welche Provider-/Prompt-Kombination ist fuer welchen Fall stabiler?

## 9. Moeglicher Iterationspfad

### Phase 1 - Feedback-Inventar

- vorhandene Review-/Approval-/Reject-Signale inventarisieren
- moegliche Label-Quellen klassifizieren
- Label-Contract fuer `AgentSuggestion`, `Ticket`, `false_positive_review`,
  `UseCaseDraft` und RAG-Rueckfluss pflegen

### Phase 2 - Eval-Dataset

- kleines, redigiertes Offline-Dataset fuer Agent-/Verdict-Bewertung
- Baseline und Slice-Definitionen

### Phase 3 - Eval-Reports

- Precision/Recall oder andere passende Metriken
- Error Clusters
- Konfidenz-/Abstention-Analyse

### Phase 4 - Nicht-modellische Verbesserungen

- Threshold-Tuning
- Prompt-/RAG-Anpassungen
- Provider-Routing
- bessere Review-Hinweise

### Phase 5 - Erst jetzt Trainingsentscheidung

- lohnt sich ueberhaupt eigenes Training?
- falls ja: welches enge Zielproblem zuerst?

## 10. Architekturfolge fuer spaeteres echtes Training

Wenn ein Trainingspfad spaeter begruendet ist, braucht er mindestens:

- versionierte Dataset-Snapshots
- reproduzierbare Pipeline
- Baseline-Vergleich
- Promotion-Gates
- Rollback auf den aktuellen RAG-/Prompt-Betrieb

## 11. Ergebnis dieser Vorarbeit

`Machine learning model training` ist jetzt kein unscharfer Zukunftsbegriff mehr, sondern ein
klarer MLE-Track:

- `ADR-039` als Entscheidungsrahmen
- Fokus auf Eval und Feedback vor Modelltraining
- klare Privacy-/Security-Leitplanken
- enger, sinnvoller Einstieg statt "wir trainieren einfach irgendwas"

**Erster umgesetzter Backend-Schritt:** `POST /api/v1/ml/eval/export` erzeugt einen
redigierten, bounded Eval-Snapshot nach `ml-eval-schema v1` aus reviewed
`AgentSuggestion` und geschlossenen Tickets. Das ist die Datengrundlage fuer Offline-Evals,
noch kein Fine-Tuning. Darauf aufbauend bewertet `npm run ml:eval-report` Threshold-Sweeps
und ein fail-closed Routing-Gate; bei Gate-Fail liefert die CLI bewusst Exit-Code `1`.
Die Exporte tragen jetzt ausserdem `generatedAt` und `recordSha256`, damit wir
Datasets spaeter reproduzierbar referenzieren und Regressionen sauber an genau
einen Snapshot binden koennen.
Mit `npm run ml:dataset-pack` koennen wir daraus jetzt ausserdem ein kleines
Dataset-Artefakt mit `manifest.json`, `report.json` und `report.md` bauen.
Mit `npm run ml:dataset-split` entstehen darauf aufbauend reproduzierbare
`train/validation/test`-Splits samt `split-manifest.json`. Zu kleine Datasets werden
dabei ehrlich als Split-Warnfall markiert, statt eine falsche Baseline-Stabilitaet
vorzugaukeln.
Mit `npm run ml:run-init` koennen wir anschliessend ein erstes `baseline-run.json`
aufsetzen, das technische Preconditions und offene Blocker fuer einen echten Lauf
explizit macht.
Mit `npm run ml:run-eval` koennen wir darauf aufbauend eine Baseline-Auswertung schreiben,
ohne die Schutzlogik zu umgehen: blockierte Runs bleiben blockiert und werden nur als
solche dokumentiert.
Mit `npm run ml:readiness` wird daraus zusaetzlich ein konkreter Daten-Gap-Report,
der z. B. fehlende Gold-Records oder unbrauchbare Split-Groessen klar beziffert.
Mit `npm run ml:gold-merge` koennen neue kuratierte Gold-JSONL-Dateien validiert und
kontrolliert in einen gemeinsamen Gold-Bestand uebernommen werden.
Mit `npm run ml:gold-pipeline` laesst sich der komplette MLE-Artefaktpfad fuer einen
aktualisierten Gold-Bestand in einem Schritt neu erzeugen.
Mit `npm run ml:run-compare` koennen wir auf einem `ready`-Artefakt erstmals mehrere
Thresholds gegeneinander halten und eine Validation-basierte Empfehlung dokumentieren.
Mit `npm run ml:run-policy-compare` koennen wir anschliessend unterschiedliche
Entscheidungs-Policies auf genau denselben Threshold-Ergebnissen gegeneinander halten.
