# ML-Label-Contract

**Stand:** 2026-06-29  
**Status:** erster Arbeitsstand fuer Eval-/Feedback-Loop

## 1. Zweck

Dieses Dokument beschreibt die **real existierenden Label- und Feedback-Quellen** in Nexora,
auf denen ein spaeterer Eval- oder Trainingspfad aufbauen kann.

Es geht bewusst **nicht** darum, schon jetzt perfekte Ground Truth zu behaupten. Ziel ist ein
ehrlicher Datenvertrag:

- Welche Entscheidungen fallen heute im System an?
- Welche davon sind als Label-Kandidaten brauchbar?
- Welche Risiken tragen sie?
- Welche eignen sich fuer den **ersten Offline-Eval**?

## 2. Prinzip

Ein Label ist in Nexora nur dann brauchbar, wenn klar ist:

- **welche Entitaet** bewertet wurde
- **wer** die Entscheidung getroffen hat
- **wann** sie getroffen wurde
- ob es sich um **roh**, **abgeleitet** oder **menschlich bestaetigt** handelt

Deshalb unterscheiden wir:

1. **Rohsignal** - von Modell, Regel oder externer Quelle vorgeschlagen
2. **Review-Signal** - menschliche Entscheidung ueber ein Rohsignal
3. **Outcome-Signal** - finaler Ticket- oder Workflow-Ausgang

## 3. Inventarisierte Label-Quellen

## 3.1 AgentSuggestion Review

**Code-Anker:**
- `backend/src/domain/AgentSuggestion.js`
- `backend/src/services/AgentService.js`
- `backend/src/repositories/PostgresAgentSuggestionRepository.js`

**Entitaet:** `AgentSuggestion`

**Wichtige Felder:**
- `id`
- `ticketId`
- `kind`
- `proposal`
- `rationale`
- `verdict`
- `confidence` (`0..1`)
- `status` (`pending|approved|rejected`)
- `reviewedBy`
- `reviewReason`
- `reviewedAt`
- `model`
- `analysis`

**Label-Wert:**
- `approved` = menschlich akzeptierter Vorschlag
- `rejected` = menschlich verworfener Vorschlag

**Staerken:**
- klares Human-in-the-loop-Signal
- direkter Bezug zum konkreten KI-Vorschlag
- Zeitstempel und Reviewer vorhanden

**Risiken:**
- Review kann aus Pragmatik, Zeitdruck oder unvollstaendigem Kontext erfolgen
- `approved` bedeutet nicht automatisch "vollstaendige Wahrheit"
- `rejected` kann schlechte Formulierung, falschen Scope oder falschen Inhalt meinen

**Eignung fuer erste Offline-Eval:**
- **hoch** fuer:
  - Accept/Reject-Analyse
  - Ranking / Routing
  - Confidence-Kalibrierung
- **mittel** fuer:
  - echtes Supervised Training auf Inhaltslabels

## 3.2 Ticket-Decision und Ticket-Close-Reason

**Code-Anker:**
- `backend/src/domain/Ticket.js`
- `backend/src/domain/validation/ticketSchema.js`

**Entitaet:** `Ticket`

**Wichtige Felder:**
- `id`
- `decision` (`''|'benign'|'suspicious'|'incident'|'fp'`)
- `confidence` (`0..100|null`)
- `state` (`OPEN|CLOSED`)
- `closeReason` (`resolved|false_positive|duplicate|benign|other|''`)
- `priority`
- `source`
- `updatedAt`

**Label-Wert:**
- `decision` = Analysten- bzw. Bearbeitungsentscheidung im Verlauf
- `closeReason` = finaler Workflow-Ausgang

**Staerken:**
- ticket-naher Outcome
- fachlich naeher an der echten Incident-Einschaetzung
- `false_positive` ist bereits operativ relevant

**Risiken:**
- `decision` kann mehrfach ueberschrieben werden
- `closeReason` beschreibt Workflow-Ende, nicht immer die gesamte Sicherheitswahrheit
- alte Tickets koennen inkonsistent gepflegt sein

**Eignung fuer erste Offline-Eval:**
- **hoch** fuer:
  - FP-/Incident-Slices
  - Outcome-basierte Rueckschau
- **mittel** fuer:
  - direktes Modelltraining ohne Historisierung der Zwischenentscheidungen

## 3.3 False-Positive-Review und FP-Exception-Workflow

**Code-Anker:**
- `backend/src/services/AgentService.js`
- `backend/src/services/WazuhFpExceptionService.js`
- `backend/src/domain/WazuhFpException.js`

**Entitaet:**
- genehmigte `AgentSuggestion` vom Typ `false_positive_review`
- daraus abgeleitete FP-Exception-Vorschau / FP-Exception

**Label-Wert:**
- besonders starkes Signal fuer "dieses Muster war operativ ein False Positive"

**Staerken:**
- fuer SOC-Betrieb unmittelbar wertvoll
- eng an echte Analystenentscheidung gekoppelt
- spaeter gut nutzbar fuer FP-Warnhinweise oder Review-Routing

**Risiken:**
- Scope einer FP-Entscheidung kann sehr eng sein
- nicht jedes FP ist allgemeingueltig; viele sind quell-, host- oder regelgebunden

**Eignung fuer erste Offline-Eval:**
- **hoch** fuer:
  - FP-Erkennung / FP-Hinweise
  - Warn-/Abstention-Logik
- **niedrig bis mittel** fuer:
  - allgemeines Incident-Klassifikationsmodell

## 3.4 Genehmigte UseCaseDrafts

**Code-Anker:**
- `backend/src/domain/UseCaseDraft.js`
- `backend/src/services/UseCaseDeveloperService.js`

**Entitaet:** `UseCaseDraft`

**Wichtige Felder:**
- `status` (`draft|in_review|approved|rejected|published`)
- `confidence` (`0..100`)
- `falsePositiveRisks`
- `testCases`
- `detectionLogic`
- `mitre`
- `reviewedBy`

**Label-Wert:**
- Detection-Engineering-Qualitaetssignal
- kein Incident-Label, aber wertvoll fuer spaetere Use-Case-/Rule-Qualitaets-Evals

**Staerken:**
- strukturierte Review-Strecke
- TP/FP-Testfaelle bereits als Konzept vorhanden

**Risiken:**
- anderer Problemraum als Ticket-Triage
- nicht direkt mit Incident-Verdicts gleichzusetzen

**Eignung fuer erste Offline-Eval:**
- **hoch** fuer Use-Case-Developer-Evals
- **niedrig** fuer Triage-/Incident-Klassifikation

## 3.5 RAG Incident Ingest aus genehmigten Suggestions / abgeschlossenen Tickets

**Code-Anker:**
- `backend/src/rag/RagIncidentIngestService.js`

**Entitaet:**
- anonymisierte Wissensdokumente aus
  - abgeschlossenen Tickets
  - genehmigten `AgentSuggestion`

**Label-Wert:**
- kein direktes Trainingslabel
- aber sehr wichtiger Datenpfad fuer Retrieval-Qualitaet und spaetere Similarity-Evals

**Staerken:**
- datensparsam / redigiert
- reale Wissensrueckfuehrung aus dem Betrieb

**Risiken:**
- abstrahiert Inhalte stark
- fuer Supervised Training oft zu indirekt

**Eignung fuer erste Offline-Eval:**
- **hoch** fuer Retrieval-/RAG-Evaluation
- **niedrig** fuer klassisches Label-Training

## 4. Erste Priorisierung fuer einen Offline-Eval

Die sinnvollste erste Eval-Stufe ist eine Kombination aus:

1. **AgentSuggestion Review**
2. **Ticket decision / closeReason**
3. **False-positive_review**

Warum diese drei?

- sie liegen schon im Produktfluss
- sie enthalten echte menschliche Entscheidungen
- sie decken Akzeptanz, Outcome und FP-Signale ab
- sie sind wertvoll, ohne dass sofort ein neues Modell trainiert werden muss

## 5. Vorgeschlagener erster Eval-Datensatz

### Einheit

Eine Zeile = ein reviewbarer KI- oder Ticket-Fall.

### Minimalfelder

- `entity_type` (`agent_suggestion|ticket`)
- `entity_id`
- `ticket_id`
- `source_type`
- `source_model_or_system`
- `kind`
- `raw_verdict`
- `raw_confidence`
- `human_label`
- `human_reason`
- `reviewed_by_role` (wenn ableitbar)
- `created_at`
- `reviewed_at`

### Beispielhafte `human_label`-Werte

- `accepted`
- `rejected`
- `false_positive`
- `benign`
- `suspicious`
- `incident`
- `resolved_other`

## 6. Bekannte Datenrisiken

- fehlende Historisierung frueherer Zwischenentscheidungen
- gemischte Confidence-Skalen (`0..1` bei AgentSuggestion, `0..100` bei Ticketen)
- Freitextfelder mit moeglicher PII
- Review-Bias durch Arbeitslast, Senioritaet oder Prozessdruck
- Outcome-Labels koennen je Quelle unterschiedlich streng gesetzt sein

## 7. Erste Normalisierungsregeln

- Confidence fuer Offline-Eval auf ein gemeinsames `0..1`-Format bringen
- `approved/rejected` getrennt von fachlichen Endlabels halten
- `closeReason=false_positive` als starkes FP-Signal markieren
- Freitext nur redigiert oder gar nicht in Eval-Snapshots uebernehmen
- `kind` und `source` immer mitfuehren, um Slices zu erlauben

## 8. Was noch fehlt

- explizite Rolle des Reviewers in jedem Datensatz
- Historie von Ticket-Decision-Aenderungen als eigener Event-Strom
- klarer Exportpfad fuer redigierte Offline-Eval-Snapshots
- definierte Gold-Samples fuer manuell nachgepruefte Ground Truth

## 9. Naechster sauberer Schritt

Aus diesem Vertrag folgt als naechstes:

1. kleines, redigiertes CSV-/JSONL-Eval-Schema festlegen
2. Mapping-Regeln fuer `AgentSuggestion` + `Ticket` dokumentieren
3. ein erstes statisches Eval-Set aus echten, aber anonymisierten Faellen bauen

Fuer den laufenden MLE-Track gibt es jetzt zusaetzlich einen kleinen Gold-Merge-Workflow:

- Basisdatensatz: `docs/01-architecture/ml-gold-sample.jsonl`
- Beispiel-Zufluss: `docs/01-architecture/ml-gold-seed-sample.jsonl`
- Merge-CLI: `cd backend && npm run ml:gold-merge -- <base> <incoming> --out <merged>`
