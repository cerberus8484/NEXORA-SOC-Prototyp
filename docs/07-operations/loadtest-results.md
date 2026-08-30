# Lokaler Lasttest — Ergebnisse (P_STABILITY_2 · 3.4)

Reproduzierbar: `node backend/scripts/loadtest/bulkDeleteLoad.js`
(Tuning: `LOAD_TICKETS`, `LOAD_PARALLEL`; `LOG_LEVEL=error` für sauberen Report.)

Szenario: 300 Tickets seeden → **gleichzeitig** ein 100er-Bulk-Delete + 50 parallele
Clients × (Ticket-Liste + SOC-Metriken + Health) = 151 parallele Requests.

> **Nur tatsächlich gemessene Werte** (keine erfundenen Zahlen). Lauf 2026-06-20,
> InMemory-Modus, Entwicklungsmaschine.

## Messung (Default 300 Tickets / 50 parallel)

| Metrik | Wert |
|---|---|
| Requests (Lastphase) | 151 |
| **Fehlerquote** | **0** |
| Latenz p50 / p90 / p99 / max | 220 / 228 / 230 / 230 ms |
| Gesamtdauer Lastphase | 288 ms |
| Event-Loop-Lag | 0 s *(siehe Caveat)* |
| Heap used (vor → nach) | 41,1 → 46,6 MB |
| RSS (vor → nach) | 125,3 → 159,9 MB |
| Queue (depth/running/failed) | 0 / 0 / 0 · `maxRetained` 1000 |
| **Health unter Last** | **`ok`** |

## Interpretation

- **Keine Fehler, Health bleibt `ok`** unter 151 gleichzeitigen Requests inkl. 100er-Bulk-Delete.
- **Kein Memory-Leak-Signal**: Heap +5,5 MB für die Lastphase, danach stabil; die Queue ist
  **bounded** (`maxRetained` 1000) — der frühere unbounded-Befund ist geschlossen (3.1a).
- Die ~220 ms p50 entstehen, weil **alle 151 Requests gleichzeitig** auf einem Event-Loop
  liegen (50× SOC-Metrik-Aggregation in Node, InMemory-Pfad). Genau dieser Pfad wird in
  Prod durch die **SQL-Aggregation** (3.3) entlastet.

## Ehrliche Caveats (wichtig)

1. **InMemory, kein DB-Pool** → `dbPool`-Waiting/Sättigung sind hier **nicht** messbar.
   Diese gehören in den **kontrollierten Pre-Deploy-Lasttest gegen echtes Postgres**
   (dann `soc_db_pool_connections{state="waiting"}`, `…saturation_warnings_total`,
   `…query_timeouts_total` beobachten).
2. **Event-Loop-Lag = 0**, weil die Lastphase (<300 ms) kürzer ist als das Sampler-Intervall
   (1 s) → es wurde kein Lag-Sample erfasst. Für eine belastbare Lag-Messung den Lauf
   verlängern (`LOAD_TICKETS`/`LOAD_PARALLEL` hoch) oder die Sampler-Resolution senken.
3. Die Latenzen sind **in-process** (supertest, kein echter Netzwerk-Round-Trip) → relativ,
   nicht als absolute Prod-Latenzen lesbar.
4. Der globale **Rate-Limiter** (Default 200/min) greift real — das Script hebt ihn nur für
   die reine Messung an (`RATE_LIMIT_MAX`). In Prod bleibt er aktiv.

## Pre-Deploy-Lasttest (gegen echtes Postgres, beim GO)

Zusätzlich beobachten: DB-Pool-Waiting, Pool-Sättigungswarnungen, Query-Timeouts,
Event-Loop-Lag über längeren Lauf, Health-`db:ok` unter Pool-Druck (Task 3 Health-Pool).
