# Queue-Integrationstest — Ergebnis (P_CORR_0 Live-Gate GESCHLOSSEN)

**Lauf:** 2026-06-21 · lokal, wegwerfbares Postgres (tmpfs) · `npm run test:queue:integration`

## Umgebung / Versionen
| Komponente | Version |
|---|---|
| pg-boss | 12.18.2 |
| PostgreSQL (Server) | 16.14 (`postgres:16-alpine`) |
| node-postgres (`pg`) | 8.21.0 |
| Docker Engine | 29.5.3 |
| Node.js | v24.15.0 |

> Lauf via `node --test` (nicht Jest): pg-boss v12 ist ESM und nur in normalem Node (require-of-ESM)
> ladbar. Datenbank in tmpfs (reiner RAM, Port 55432), nach dem Lauf via `down -v` rückstandslos weg.

## Ergebnis: 4/4 GRÜN
| Garantie | Test | Status |
|---|---|---|
| enqueue → genau-einmal-Verarbeitung + Completion (ack) | `enqueue → Worker …` | ✔ ~0,7 s |
| atomisches Claiming — konkurrierende Worker, **kein** Doppel-Processing | `atomisches Claiming …` | ✔ ~3,1 s |
| Retry/Backoff + **Dead-Letter** bei erschöpften Retries | `retry/backoff + Dead-Letter …` | ✔ ~2,7 s |
| **Recovery** — vor „Worker-Neustart" eingereihter Job geht nicht verloren | `Recovery …` | ✔ ~0,3 s |

Damit sind die geforderten Garantien gegen **echtes pg-boss + echtes Postgres** belegt
(nicht nur im Unit-Test): enqueue · atomisches Claiming ohne Doppelverarbeitung · Ack/Completion ·
Retry mit Backoff · Failed/Dead-Letter-Status · **Recovery nach Worker-Neustart**.

## Gefundener + behobener Bug
Der erste echte Lauf scheiterte an `configuration assert: expiration cannot exceed 24 hours`:
der Adapter setzte einen `expireInSeconds`-Default von 86400 (=24 h). `expireInSeconds` ist in
pg-boss das **Active-Timeout** (Default 15 min, Max 24 h), nicht die Retention — der Default war
konzeptionell falsch. Fix: kein Default mehr, `expireInSeconds` nur bei explizitem Wunsch durchreichen.

## Setup-Falle (Windows / Docker Desktop)
- Docker Desktop startete anfangs nicht: der **„Inference manager" / Docker Model Runner** scheiterte an
  `unix://C:\…\dockerInference` (Unix-Socket-Schema mit Windows-Pfad) und blockierte den Engine-Start.
  Fix: **Docker Model Runner in der GUI deaktivieren** (Settings → AI). `EnableDockerAI:false` allein reichte nicht.
- Ein Container, der während des kaputten Docker-Zustands erzeugt wurde, veröffentlichte **keinen Port**
  (`docker port` leer → `ECONNREFUSED`). Nach sauberem Docker-Neustart + frischem `up -d`: Port korrekt
  (`0.0.0.0:55432->5432`), Tests grün.
