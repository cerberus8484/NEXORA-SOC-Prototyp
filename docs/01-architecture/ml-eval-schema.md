# ML-Eval-Schema

**Stand:** 2026-06-29  
**Status:** erster Zielvertrag fuer redigierte Offline-Eval-Snapshots

## 1. Ziel

Dieses Schema beschreibt das **erste gemeinsame Austauschformat** fuer Offline-Evals im
ML-/KI-Track von Nexora.

Es ist bewusst:

- klein
- redigierbar
- providerunabhaengig
- auf Human-in-the-loop ausgelegt

Der erste Export soll **JSONL** sein: eine Zeile = ein evalbarer Fall.

## 2. Format

**Dateiformat:** `jsonl`  
**Encoding:** UTF-8  
**Eine Zeile:** genau ein JSON-Objekt

**Backend-Export:** `POST /api/v1/ml/eval/export`  
**Rolle:** `admin`  
**Formate:** `jsonl` oder `json`  
**Grenze:** `limit` 1..1000, serverseitig enforced  
**Quellen:** reviewed `AgentSuggestion` und geschlossene `Ticket`-Outcomes

**Snapshot-Metadaten:** Jeder Export traegt reproduzierbare Metadaten:

- `schemaVersion`
- `generatedAt`
- `recordCount` / `returned`
- `recordSha256` als stabile Dataset-Signatur ueber den JSONL-Inhalt
- `labelSourceCounts`
- `humanLabelCounts`

Bei `format=jsonl` kommen Signatur und Zeitstempel zusaetzlich als Header:
`X-Nexora-ML-Eval-Sha256` und `X-Nexora-ML-Eval-Generated-At`.

**Offline-Report:** `cd backend && npm run ml:eval-report -- ../docs/01-architecture/ml-eval-sample.jsonl`  
Der Report validiert JSONL grob, zaehlt Slices (`entity_type`, `kind`, `source_system`,
`human_label`, `priority`) und zeigt `raw_verdict` gegen `human_label`. Fuer vergleichbare
Outcome-Labels (`false_positive`, `benign`, `suspicious`, `incident`) berechnet er ein
vorsichtiges Agreement; Review-Labels (`accepted`, `rejected`) werden dafuer uebersprungen.
Das ist ein Eval-/Datenqualitaetsreport, noch keine allgemeine Modellqualitaetsmetrik.
Zusaetzlich enthaelt der Report einen Threshold-Sweep fuer `0`, `0.5`, `0.7`, `0.9`:
Wieviele outcome-faehige Predictions wuerden automatisch akzeptiert, wieviele gingen in
Review, und wie hoch ist das Agreement der akzeptierten Teilmenge? Das ist ein
Routing-/Abstention-Hinweis, noch kein Promotions-Gate.

**Routing-Gate (fail-closed):** Der Report bewertet zusaetzlich, ob eine Schwelle die
Mindestanforderungen erfuellt. Defaults:

- `minAgreement=0.8`
- `minCoverage=0.5`
- `minGoldRecords=20`

CLI-Flags: `--min-agreement`, `--min-coverage`, `--min-gold-records`.
Wenn zu wenige Gold-Records vorhanden sind oder keine Schwelle die Mindestwerte erreicht,
bleibt das Gate `fail`.
Der CLI-Prozess liefert dann auch Exit-Code `1`, damit CI/Automation fail-closed bleibt.

**Dataset-Packaging:** `cd backend && npm run ml:dataset-pack -- ../docs/01-architecture/ml-gold-sample.jsonl`  
Das Packaging baut aus einem Snapshot einen kleinen Artefakt-Ordner:

- `snapshot.jsonl`
- `manifest.json`
- `report.json`
- `report.md`

Der Zielordner wird unterhalb des gewaehlten `--out-dir` nach dem Snapshot-Hash benannt.
`manifest.json` ist die erste referenzierbare Bruecke zwischen Eval-Snapshot und spaeterem
Training/Baseline-Vergleich.

**Dataset-Split:** `cd backend && npm run ml:dataset-split -- ../artifacts/ml-eval/<hash>`  
Aus einem vorhandenen Dataset-Pack entstehen deterministische Splits:

- `train.jsonl`
- `validation.jsonl`
- `test.jsonl`
- `split-manifest.json`

Die Zuordnung ist seed-basiert reproduzierbar und bucketed nach `human_label`, damit
spaetere Trainings- oder Baseline-Runs wieder dieselben Fallzuschnitte referenzieren koennen.
Wenn ein kleines Dataset keine brauchbaren `validation`-/`test`-Splits hergibt, markiert
`split-manifest.json` das explizit als Warnung statt still einen scheinbar sauberen Split
vorzutaeuschen.

**Run-Initialisierung:** `cd backend && npm run ml:run-init -- ../artifacts/ml-eval/<hash>`  
Aus `manifest.json` und `split-manifest.json` entsteht ein `baseline-run.json`, das
Dataset-SHA, Split-SHA, Seed, Zielsetzung, Strategie und Blocker fuer einen spaeteren
Baseline- oder Trainingslauf zusammenzieht.

**Run-Evaluation:** `cd backend && npm run ml:run-eval -- ../artifacts/ml-eval/<hash>`  
Der Evaluator schreibt `baseline-eval.json` und `baseline-eval.md`. Er bleibt ebenfalls
fail-closed: blockierte Runs erzeugen ein Ergebnis mit Blockern, aber keine
Schein-Metriken fuer einen angeblich gueltigen Baseline-Lauf.

**Readiness-Report:** `cd backend && npm run ml:readiness -- ../artifacts/ml-eval/<hash>`  
Der Readiness-Report schreibt `readiness-report.json` und `readiness-report.md` und macht
fehlende Gold-Records, Split-Luecken und naechste Daten-Schritte explizit.

**Gold-Merge:** `cd backend && npm run ml:gold-merge -- ../docs/01-architecture/ml-gold-sample.jsonl ../docs/01-architecture/ml-gold-seed-sample.jsonl --out ../artifacts/ml-gold-merged.jsonl`  
Neue kuratierte Gold-Records koennen damit validiert, per `entity_id` dedupliziert und
sortiert in ein gemeinsames JSONL-Ziel uebernommen werden.

**Gold-Pipeline:** `cd backend && npm run ml:gold-pipeline -- ../artifacts/ml-gold-merged.jsonl --out-dir ../artifacts/ml-eval`  
Fuehrt Pack, Split, Run-Init, Baseline-Eval und Readiness in einem Lauf fuer ein
Gold-JSONL aus und schreibt alle Artefakte in einen neuen Hash-Ordner.

**Run-Compare:** `cd backend && npm run ml:run-compare -- ../artifacts/ml-eval/<hash>`  
Vergleicht mehrere Thresholds auf einem `ready`-Run ueber `train`, `validation` und `test`
und schreibt `threshold-comparison.json` plus `threshold-comparison.md`.

**Run-Policy-Compare:** `cd backend && npm run ml:run-policy-compare -- ../artifacts/ml-eval/<hash>`  
Vergleicht mehrere Auswahl-Policies fuer Threshold-Empfehlungen auf demselben `ready`-Run
und schreibt `policy-comparison.json` plus `policy-comparison.md`.

**Gold-Sample-Profil:** Records mit `label_source="gold_review"` gelten nur dann als
kuratierte Gold-Samples, wenn sie:

- ein Outcome-Label (`false_positive`, `benign`, `suspicious`, `incident`) tragen
- ein outcome-faehiges `raw_verdict` tragen
- `reviewed_at` gesetzt haben
- einen kurzen, redigierten `human_reason` enthalten

Beispiel: `docs/01-architecture/ml-gold-sample.jsonl`.

## 3. Entitaeten

Das Schema unterstuetzt in der ersten Version vor allem:

- `agent_suggestion`
- `ticket`

Spaeter erweiterbar fuer:

- `use_case_draft`
- `hunt_finding`
- `retrieval_case`

## 4. Pflichtfelder

| Feld | Typ | Bedeutung |
|---|---|---|
| `schema_version` | string | Version des Eval-Schemas, Start `v1` |
| `entity_type` | string | `agent_suggestion` oder `ticket` |
| `entity_id` | string | ID der bewerteten Entitaet |
| `ticket_id` | string | Ticket-Referenz, falls vorhanden |
| `label_source` | string | Woher das menschliche Label stammt |
| `created_at` | string | ISO-Zeitstempel des Ursprungssignals |
| `reviewed_at` | string\|null | ISO-Zeitstempel der menschlichen Entscheidung |
| `human_label` | string | normalisierter Zielwert fuer Eval |

## 5. Kernfelder fuer den ersten Eval

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `kind` | string | nein | z. B. `triage`, `false_positive_review` |
| `source_system` | string | nein | z. B. `ollama`, `wazuh`, `manual` |
| `source_model` | string | nein | z. B. `llama3.2:3b` |
| `raw_verdict` | string | nein | Modell- oder Ursprungseinschaetzung vor Human-Review |
| `raw_confidence` | number\|null | nein | normalisiert auf `0..1` |
| `review_status` | string\|null | nein | `approved`, `rejected`, `closed`, ... |
| `human_reason` | string | nein | knapper, redigierter Grund |
| `close_reason` | string | nein | bei Tickets z. B. `false_positive` |
| `priority` | string | nein | `critical`, `high`, `medium`, `low`, `info` |
| `source_kind` | string | nein | feinerer Ursprung, z. B. `agent_review`, `ticket_close` |

## 6. Erlaubte `human_label`-Werte in v1

Die erste Version haelt die Labelmenge bewusst klein:

- `accepted`
- `rejected`
- `false_positive`
- `benign`
- `suspicious`
- `incident`
- `resolved_other`

Hinweis:
- `accepted` / `rejected` sind **Review-Labels**
- `false_positive` / `benign` / `suspicious` / `incident` sind **fachliche Outcome-Labels**

Diese Ebenen duerfen spaeter getrennt ausgewertet werden.

## 7. Normalisierungsregeln

### 7.1 Confidence

Alle Confidence-Werte werden im Eval-Snapshot auf `0..1` normalisiert:

- `AgentSuggestion.confidence` ist bereits `0..1`
- `Ticket.confidence` (`0..100`) wird auf `0..1` geteilt
- unbekannt = `null`

### 7.2 Zeit

- alle Zeitwerte als ISO-8601 UTC
- `reviewed_at = null`, wenn kein menschliches Review vorliegt

### 7.3 Redigierung

Im Eval-Snapshot sollen **keine unredigierten Incident-Rohtexte** Pflichtbestandteil sein.
Freitext darf nur hinein, wenn:

- er kurz ist
- er redigiert ist
- er keine direkten PII-/Secret-Werte traegt

Deshalb ist `human_reason` als **kurzer, redigierter Text** gedacht.

## 8. Mapping-Regeln v1

## 8.1 `agent_suggestion`

Quelle:
- `backend/src/domain/AgentSuggestion.js`

Mapping:

- `entity_type = "agent_suggestion"`
- `entity_id = suggestion.id`
- `ticket_id = suggestion.ticketId`
- `kind = suggestion.kind`
- `source_system = "agent"`
- `source_model = suggestion.model`
- `raw_verdict = suggestion.verdict`
- `raw_confidence = suggestion.confidence`
- `review_status = suggestion.status`
- `created_at = suggestion.createdAt`
- `reviewed_at = suggestion.reviewedAt`
- `human_label`:
  - `approved -> accepted`
  - `rejected -> rejected`
- `label_source = "agent_review"`
- `human_reason = suggestion.reviewReason`

## 8.2 `ticket`

Quelle:
- `backend/src/domain/Ticket.js`

Mapping:

- `entity_type = "ticket"`
- `entity_id = ticket.id`
- `ticket_id = ticket.id`
- `source_system = ticket.source`
- `raw_verdict = ticket.decision`
- `raw_confidence = ticket.confidence / 100` falls gesetzt
- `review_status = ticket.state`
- `created_at = ticket.createdAt`
- `reviewed_at = ticket.updatedAt`
- `close_reason = ticket.closeReason`
- `priority = ticket.priority`
- `human_label`:
  - `closeReason = false_positive -> false_positive`
  - `decision = benign -> benign`
  - `decision = suspicious -> suspicious`
  - `decision = incident -> incident`
  - sonst `resolved_other`
- `label_source = "ticket_outcome"`

## 9. Beispiel

Siehe:

- `docs/01-architecture/ml-eval-sample.jsonl`
- `docs/01-architecture/ml-gold-sample.jsonl`

## 10. Bewusste Nicht-Ziele von v1

- kein komplettes Trainingsformat
- keine eingebetteten Rohtexte / Bundle-Payloads
- keine Features fuer direktes Fine-Tuning
- keine Vollhistorie aller Ticket-Aenderungen

## 11. Naechster sauberer Schritt

Der erste Backend-Exporter ist umgesetzt. Daraus koennen wir als naechstes ableiten:

1. echte Snapshots gegen den Offline-Report laufen lassen
2. manuell kuratierte Gold-Samples fuer die wichtigsten Fehlerklassen festlegen
3. aus echten Gold-Samples belastbare Threshold-/Routing-Gates ableiten
4. Snapshots ueber `recordSha256` in Eval-Notizen, Regressionen und spaeteren Trainingsversuchen referenzieren
