# Runbook — ML-Routing-Policy scharfschalten (Prod)

> Ziel: Aus echten, geprüften SOC-Entscheidungen eine belegte Routing-Policy bauen und
> die **advisory** KI-Triage-Empfehlung (`auto_accept_eligible` / `route_to_review`)
> in Produktion aktivieren. Kein Auto-Handeln — Human-in-the-loop bleibt.
>
> Stand 2026-06-29. Bezug: `ADR-039`, `ADR-040`, `ml-training-plan.md`.

## Vorbedingung — was „Gold" heißt
Die Routing-Gate ist **fail-closed**: mind. **20 Gold-Records**, Agreement ≥ 0.8, Coverage ≥ 0.5.
Ein Gold-Record ist eine **menschlich geprüfte** Entscheidung mit
`label_source=gold_review`, einem outcome-fähigen `human_label`, `reviewed_at` und einem
redigierten Grund (siehe `ml-label-contract.md`). Reviewte Agent-Suggestions und
geschlossene Tickets sind die Rohquelle — sie werden aber **erst durch Kuratierung** zu Gold.

## Schritt 1 — Eval-Snapshot aus Prod ziehen (Rohmaterial)
Auf dem Prod-Host (admin-Token nötig):

```bash
curl -s -X POST https://nexora.local/api/v1/ml/eval/export \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"format":"jsonl","include":"all","limit":1000}' \
  > prod-eval-snapshot.jsonl
```

Der Export ist bounded, **redigiert** (keine Proposal-/Rationale-/Ticket-Freitexte) und
wird auditiert (`ML_EVAL_EXPORT`). Alternativ in der UI: `/ml-eval` → „Snapshot erzeugen"
(zeigt Counts/Label-Verteilung als Vorschau).

## Schritt 2 — Gold kuratieren
Aus dem Snapshot die menschlich belegten Fälle als Gold-JSONL aufbereiten
(`label_source=gold_review`, geprüftes `human_label`, `reviewed_at`, redigierter Grund).
Mehrere Gold-Chargen deterministisch zusammenführen:

```bash
cd backend
node scripts/mlGoldMerge.js ../artifacts/prod-gold-batch-01.jsonl ../artifacts/prod-gold-batch-02.jsonl \
  --out ../artifacts/prod-gold-merged.jsonl
```

Ziel: **≥ 20** valide Gold-Records, sonst bleibt die Gate fail-closed (Run = `blocked`).

## Schritt 3 — Pipeline → Policy (deterministisch)
```bash
cd backend
# 3a) Snapshot/Manifest/Splits/Baseline/Readiness
node scripts/mlEvalGoldPipeline.js ../artifacts/prod-gold-merged.jsonl --out-dir ../artifacts/ml-eval
#   → Ausgabe enthält targetDir = ../artifacts/ml-eval/<sha12> und runStatus: ready|blocked

# 3b) Threshold-/Policy-Vergleich (schreibt policy-comparison.json)
node scripts/mlEvalRunPolicyCompare.js ../artifacts/ml-eval/<sha12>

# 3c) Deploybare Policy (Default: conservative_review_bias = im Zweifel Review)
node scripts/mlEvalPolicyExport.js ../artifacts/ml-eval/<sha12>
#   --policy max_validation_agreement  → aggressivere Variante (mehr Auto-Accept)
```

Ergebnis: `../artifacts/ml-eval/<sha12>/recommended-routing-policy.json`
(`status: ready`, ein Accept-Threshold, volle Provenance: Dataset-/Split-SHA, Routing-Gate).
Ist der Run `blocked`, ist `status: blocked` und es gibt **keinen** Threshold — dann fehlen
Gold-Records (siehe `readiness-report.md` → `nextActions`).

## Schritt 4 — Aktivieren (ENV)
Das Artefakt an einen stabilen Pfad legen (z. B. ins Prod-Volume) und in der Prod-ENV setzen:

```bash
ML_ROUTING_POLICY_PATH=/opt/nexora/ml/recommended-routing-policy.json
```

API neu starten (recreate), damit die ENV greift. **Default ist AUS** — ohne diese Variable
ändert sich nichts.

## Schritt 5 — Verifizieren
- `GET /api/v1/ml/eval/status` (admin) → `routingPolicy.active = true`, `policyName`, `threshold`.
- UI `/ml-eval` → Karte „Aktive Routing-Policy" zeigt Name + Accept-Threshold.
- Agent-Suggestion-Responses (`GET /api/v1/agent/suggestions`) tragen jetzt ein
  `routing`-Feld: `auto_accept_eligible` (confidence ≥ Threshold) bzw. `route_to_review`.
- Logs: `routing_policy_active` (mit `policyName`+`threshold`, **ohne** Dateipfad).

## Sicherheits-/Fail-safe-Eigenschaften (ADR-040)
- **Advisory only** — kein Auto-Approve/Execute; Autonomy-Gates (ADR-016) bleiben inert.
- **Fail-safe** — fehlende/blockierte/fehlerhafte Policy ⇒ kein `routing`-Feld, kein
  Verhaltenswechsel. Fehlende confidence ⇒ `unknown` (wird nie geraten).
- **No-Leak** — der Dateipfad erscheint weder in `/status` noch in Logs.
- **Reproduzierbar** — gleicher Gold-Bestand ⇒ gleicher Dataset-SHA ⇒ gleiche Policy.

## Rollback
`ML_ROUTING_POLICY_PATH` entfernen (oder auf eine `status:blocked`-Policy zeigen) und API
recreaten → sofort zurück auf das bisherige Verhalten ohne Routing-Advisory.

## Phase 4 — was die Eval-Reports zusätzlich hergeben (ohne Modelltraining)
Aus demselben Artefakt-Verzeichnis:
- `node scripts/mlEvalRunCompare.js <dir>` — Threshold-Vergleich (Coverage vs. Agreement).
- `report.md` / `readiness-report.md` — Slice-/Gap-Analyse: welche Label/Slices schwach sind.
Daraus folgen die nicht-Modell-Hebel: Threshold-Wahl (oben), Prompt-/RAG-Anpassung,
Provider-Routing. Echtes Fine-Tuning erst, wenn diese Hebel belegt nicht reichen (ADR-039).
