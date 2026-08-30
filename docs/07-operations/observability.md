# Observability — Stabilitäts-Metriken (P_STABILITY_1 · Task 1)

Wenige, klare Signale, die beim nächsten Lastproblem sofort zeigen: **CPU/Event-Loop,
RAM/Heap, DB-Pool, Queue oder eine bestimmte Route?**

- **Endpunkt:** `GET /metrics` (Prometheus-Textformat). **IP-gated** (nur interne 10.x /
  172.16–31.x / Loopback; kein Auth-Token, kein WAN-Zugriff). Grafana scrapt intern.
- **Kardinalität:** Route-Labels werden normalisiert (`/v1/tickets/<id>` → `/v1/tickets/:id`),
  Query-Strings abgeschnitten. **Keine** UUIDs/IDs/IPs/Request-IDs/PII in Labels.
- **Last:** Runtime-/Pool-Werte werden **beim Scrape** gelesen (kein Dauer-Timer); der
  Event-Loop-Sampler ist ein einzelner `unref`'d Interval.

---

## Metriken nach Kategorie

### Node-Runtime (CPU/RAM/Event-Loop)
| Metrik | Bedeutung |
|---|---|
| `soc_process_resident_memory_bytes` | RSS des Prozesses |
| `soc_nodejs_heap_used_bytes` / `soc_nodejs_heap_total_bytes` | genutzter / reservierter V8-Heap |
| `soc_nodejs_external_memory_bytes` | externer Speicher (Buffer/C++) |
| `soc_process_uptime_seconds` | Laufzeit (Restart-Erkennung) |
| `soc_event_loop_lag_seconds` | **Event-Loop-Lag** — wie lange der Loop blockiert war |
| `soc_nodejs_info{version}` | Node-Version (Wert immer 1) |

### HTTP (Routen)
| Metrik | Bedeutung |
|---|---|
| `soc_http_requests_total{method,route,status_code}` | Request-Anzahl; **Fehlerquote** = `status_code=~"5.."`-Anteil |
| `soc_http_request_duration_seconds{method,route}` | Latenz-Histogramm je Route |
| `soc_http_requests_in_flight` | aktuell laufende Requests (Stau/Überlast) |

### DB-Pool (aus Task 3)
| Metrik | Bedeutung |
|---|---|
| `soc_db_pool_connections{pool,state}` | API- **und** Health-Pool, je total/idle/waiting |
| `soc_db_pool_max{pool}` | konfigurierte Pool-Größe |
| `soc_db_pool_saturation_warnings_total` | Anzahl erkannter Pool-Sättigungen |
| `soc_db_query_timeouts_total` | Queries, die in statement/query-Timeout liefen |

> Pool-Connection-Gauges existieren nur bei aktiver DB (`DB_ENABLED=true`).

### Hintergrundarbeit (Integration-Pipeline)
| Metrik | Bedeutung |
|---|---|
| `soc_integration_jobs_processed_total{result}` | verarbeitete Jobs (completed/failed) |
| `soc_integration_jobs_in_flight` | aktuell laufende Jobs |
| `soc_integration_last_success_timestamp_seconds` | Unix-Zeit des letzten Erfolgs (lebt die Pipeline?) |

> **Bewusst keine Queue-Tiefe-Metrik:** die Integration-Queue ist aktuell die **synchrone
> In-Memory-Queue** (kein stehender Backlog → Tiefe wäre konstant 0). Wenn die persistente
> Queue (pg-boss, vorhanden aber unverdrahtet) aktiviert wird, kommt `soc_integration_queue_depth` dazu.

---

## Schwellen & erste Maßnahme je Signal

| Signal | Auffällig ab | Erste Maßnahme |
|---|---|---|
| **Event-Loop-Lag** `soc_event_loop_lag_seconds` | > 0,1 s anhaltend | CPU-/Sync-Last suchen (große Aggregation, Sync-I/O). Korrelation async ziehen (P_CORR_1); SOC-Metriken DB-seitig aggregieren (P_STABILITY_2). |
| **Heap** `soc_nodejs_heap_used_bytes` | stetig steigend ohne GC-Rückgang **oder** nahe `--max-old-space-size` | Leak-Verdacht prüfen (z. B. unbounded `InMemoryQueueService._jobs`). RSS-Trend gegenprüfen; Heap-Snapshot. |
| **Pool-Sättigung** `…saturation_warnings_total` ↑ / `connections{state="waiting"}>0` | warten anhaltend > 0 | `DB_POOL_MAX` erhöhen **oder** langsame Queries fixen. `…query_timeouts_total` ↑ = `statement_timeout` greift → Query optimieren. |
| **Query-Timeouts** `soc_db_query_timeouts_total` ↑ | > 0 im Normalbetrieb | langsame Query identifizieren (Route-Latenz-Histogramm), Index/Pagination prüfen — **kein** Timeout-Wert blind hochsetzen. |
| **Fehlerquote** 5xx-Anteil | > ~1 % anhaltend | Route mit den 5xx im Log isolieren; nicht den Health-Endpoint. |
| **In-Flight** `soc_http_requests_in_flight` | steigt, ohne abzufließen | Überlast/Stau — Engpass über die anderen Signale eingrenzen (DB-Pool? Event-Loop?). |
| **Pipeline tot** `…last_success_timestamp_seconds` | lange unverändert bei eingehenden Events | Worker/Poller prüfen; `…jobs_processed_total{result="failed"}` ↑? |

---

## Live-Checks für den kontrollierten Pre-Deploy-Test

1. `curl -s http://<api>/metrics | grep -E 'soc_(process_resident|event_loop_lag|http_requests_in_flight|db_pool_connections)'`
   → Runtime-, In-Flight- und **beide** Pool-Gauges (`pool="api"` + `pool="health"`) vorhanden.
2. **Unter Last** (100-Ticket-Bulk-Delete + parallele Dashboard-/Health-Aufrufe, P_STABILITY_2 Task 3):
   `soc_db_pool_connections{state="waiting"}`, `soc_db_pool_saturation_warnings_total`,
   `soc_event_loop_lag_seconds`, `soc_http_request_duration_seconds` und RSS/Heap beobachten →
   **eindeutiger Engpass** sichtbar.
3. **Health bleibt ehrlich unter Sättigung:** während (2) muss `/health` `db:ok` bleiben
   (eigener Health-Pool aus Task 3) — kein False-Fail.
