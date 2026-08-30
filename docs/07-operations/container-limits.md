# Container-Limits, Node-Heap & Graceful Shutdown (P_STABILITY_1 · Task 4)

> **Status: VORBEREITET, NICHT ausgerollt.** Die Werte sind konservative, ENV-parametrisierte
> Defaults — **vor dem Deploy an die echte VM120-Zuteilung anpassen** (kein Blind-Wert).

Ziel: Ein Memory-Spike kann nicht den ganzen Host gefährden, und Node beendet sich
**kontrolliert** (Heap-OOM) statt vom Host-OOM-Killer überrascht zu werden.

---

## Stellschrauben (ENV in `deploy/.env.production`)

| ENV | Default | Wirkung |
|---|---|---|
| `API_MEM_LIMIT` | `512M` | Container-RAM-Limit des API-Containers |
| `API_CPU_LIMIT` | `1.0` | CPU-Limit API |
| `NODE_MAX_OLD_SPACE_MB` | `384` | V8-Heap-Grenze (`--max-old-space-size`) |
| `PG_MEM_LIMIT` / `PG_CPU_LIMIT` | `1G` / `1.5` | Postgres |
| `WEB_MEM_LIMIT` / `WEB_CPU_LIMIT` | `128M` / `0.5` | nginx + statisches SPA |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | hartes Zeitlimit des Graceful Shutdown |

`stop_grace_period: 30s` (alle Services) > `SHUTDOWN_TIMEOUT_MS` (10 s) → Docker gibt dem
geordneten Herunterfahren genug Zeit, bevor `SIGKILL` kommt.

---

## Die wichtigste Regel: Heap **unter** Container-RAM

`NODE_MAX_OLD_SPACE_MB` muss **deutlich unter** `API_MEM_LIMIT` liegen (Richtwert **~75 %**).
Der Rest ist Reserve für:
- V8-Non-Heap (Code, Stacks, Metadaten),
- **native Module** (insb. `pg`-Treiber, prom-client),
- **Buffers** (HTTP-Bodies, JSON, DB-Rows),
- Docker-/Glibc-Overhead.

Setzt man den Heap ≈ dem Container-RAM, killt der **Host-OOM-Killer** den Prozess hart
(kein Graceful Shutdown). Setzt man ihn darunter, wirft V8 zuerst `JavaScript heap out of
memory` → kontrolliertes Ende + Restart-Policy (`unless-stopped`).

### Beispiel-Tiers (Heap ≈ 75 % von API_MEM_LIMIT)

| API_MEM_LIMIT | NODE_MAX_OLD_SPACE_MB | Reserve |
|---|---|---|
| `512M` (Default) | `384` | 128 M |
| `768M` | `560` | ~208 M |
| `1G` | `768` | ~256 M |

---

## Vor dem Deploy — messen statt raten

1. **VM120-RAM ermitteln:** Proxmox-VM-Config bzw. in der VM `free -m`. Wie viel ist für
   die SOC-Container frei (nach VM-OS + ggf. anderen Diensten)?
2. **Summe der Limits** (API + Postgres + web) muss **mit Reserve** in das freie VM-RAM passen
   (Headroom für VM-OS + Postgres-OS-Filecache lassen). Beispiel 4 GB frei:
   API 1G / PG 2G / web 128M lässt ~0,9 G Reserve.
3. **Postgres NICHT zu eng** limitieren — sonst OOM-Kills der DB. Lieber großzügig
   (`shared_buffers` + OS-Cache brauchen Platz).
4. Werte in `deploy/.env.production` setzen, dann erst (auf GO) `docker compose -f
   deploy/docker-compose.prod.yml --env-file deploy/.env.production up -d`.
5. **Nachprüfen unter Last** mit den Task-1-Metriken (`docs/07-operations/observability.md`):
   `soc_nodejs_heap_used_bytes` vs. Heap-Grenze, `soc_process_resident_memory_bytes` vs.
   `API_MEM_LIMIT`. `docker stats` zeigt die reale Container-Auslastung.

---

## Enforcement-Prüfung (Pflicht beim kontrollierten Deploy)

**Valide YAML ≠ wirksames Limit.** Ein Container **ohne** gesetztes Limit hat vollen Zugriff
auf die Host-Ressourcen — die YAML allein beweist nichts. Zwei Schritte:

**1. Aufgelöste Config prüfen (vor dem Start) — lokal bereits verifiziert:**
```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production config
```
Erwartet (Defaults): api `memory: "536870912"` (512 MiB) · `cpus: 1` ·
`NODE_OPTIONS=--max-old-space-size=384`; postgres 1 GiB / 1.5; web 128 MiB / 0.5.

**2. Am laufenden Container prüfen (nach dem Start):**
```bash
docker inspect soc_api_prod --format 'mem={{.HostConfig.Memory}} nanocpu={{.HostConfig.NanoCpus}}'
#   erwartet: mem=536870912 nanocpu=1000000000   (≠ 0 = Limit gesetzt)
docker stats soc_api_prod soc_postgres_prod soc_web_prod --no-stream
#   Spalte "MEM USAGE / LIMIT" zeigt das WIRKSAME Limit + reale Nutzung
```
`Memory: 0` / `NanoCpus: 0` im `inspect` bedeutet **KEIN** Limit → Compose-Schema/Engine prüfen.

> **Konsistenz-Hinweis (Docker-Vorgabe):** hier werden **ausschließlich**
> `deploy.resources.limits` genutzt (kein service-level `mem_limit`/`cpus`). Wird später
> zusätzlich `mem_limit`/`cpus` gesetzt, **müssen** beide Werte übereinstimmen — sonst greift
> ein unerwartetes Limit.

---

## Graceful Shutdown — Reihenfolge

Bei `SIGTERM`/`SIGINT` (z. B. `docker stop`) fährt der API-Container geordnet herunter
(`src/lifecycle/gracefulShutdown.js`), fehler-isoliert + zeitbegrenzt:

1. **HTTP-Server** — keine neuen Requests annehmen.
2. **Poller** (IMAP, CrowdSec) — keine neuen Events mehr einspeisen.
3. **Integration-Worker / Queue** — stoppen.
4. **DB-Pools** — API-Pool **und** Health-Pool schließen (nach dem Worker).
5. **Event-Loop-Sampler** — beenden.

Hängt ein Schritt, greift nach `SHUTDOWN_TIMEOUT_MS` der Force-Exit (Code 1); andernfalls
Exit 0. Mehrfaches Signal ist idempotent.
