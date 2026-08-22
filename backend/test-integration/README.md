# Queue-Integrationstests (P_CORR_0)

Diese Tests prüfen die persistente Queue (`PgBossQueueService`, pg-boss v12) gegen ein
**echtes, wegwerfbares PostgreSQL** — Verhalten, das die gemockten Jest-Unit-Tests nicht
abdecken können: atomisches Claiming, Retry/Backoff, Dead-Letter, Recovery nach Neustart.

## Warum nicht in Jest?

pg-boss v12 ist ein **ESM-Paket** (`type: module`). Die CommonJS-Jest-Runtime kann es nicht
`require`n (`Cannot use import statement outside a module`). Normales Node (v22+) kann ESM via
`require` laden — daher laufen diese Tests mit **`node --test`**, nicht mit Jest. Die Datei liegt
bewusst außerhalb von `tests/`, damit Jest sie nicht einsammelt.

## Ausführen

```bash
# 1. Wegwerfbares Test-Postgres starten (Daten in tmpfs/RAM, Port 55432)
docker compose -f test-integration/docker-compose.queue.yml up -d

# 2. Integrationstests
npm run test:queue:integration

# 3. Aufräumen (Container + Volume weg)
docker compose -f test-integration/docker-compose.queue.yml down -v
```

Ist **kein** Test-Postgres erreichbar, werden alle Tests **sauber geskippt** (kein Fehlschlag) —
so blockiert das Fehlen von Docker weder `npm test` noch CI-Schritte, die nur Unit-Tests fahren.

## Abgedeckte Garantien

| Test | Garantie |
|------|----------|
| enqueue → Worker | Genau-einmal-Verarbeitung + Completion (ack) |
| atomisches Claiming | Konkurrierende Worker verarbeiten keinen Job doppelt (SKIP LOCKED) |
| retry/backoff + Dead-Letter | Erschöpfte Retries landen in `<queue>.dlq` |
| Recovery | Ein vor „Neustart" eingereihter Job überlebt eine neue Worker-Instanz |

**Kein Produktiv-Postgres, keine echten Daten.** Verbindung über `QUEUE_TEST_*`-ENV überschreibbar
(Defaults siehe `docker-compose.queue.yml`).
