# Apply-Kanal End-to-End Smoke-Test (P_CORR_ADMIN_2)

Beweist die komplette kontrollierte Apply-Kette gegen **echtes Postgres** + **echten
Correlation-Worker**, lokal und isoliert. Reproduzierbar, mit automatischem Cleanup.

## Ausführen

```bash
bash deploy/smoke/run-apply-smoke.sh
```

Der Runner:
1. fährt ein isoliertes Postgres hoch (`docker-compose.apply-smoke.yml`, eigener Container
   `soc_postgres_apply_smoke`, Port **5544**, flüchtiges `tmpfs` — berührt Dev-5432/Test-5433 nicht),
2. wartet auf den Health-Check,
3. führt `backend/scripts/applyChannelSmoke.js` gegen dieses Postgres aus,
4. räumt **alles** ab (`down -v --remove-orphans`) und zeigt, dass kein Container übrig bleibt.

Exitcode `0` = alle drei Pflichtpfade grün.

## Bewiesene Pflichtpfade

| Pfad | Erwartung |
|---|---|
| Erfolgsweg | realer Worker übernimmt Config an Job-Grenze + meldet Heartbeat → `Apply-Run = applied`, `runtime_config` trägt den Wert |
| Fehlerweg | Apply-Health fail-closed (Worker bestätigt die neue Version nicht) → Rollback auf Baseline → `rolled_back`, kein Safety-Lock |
| Safe-Stop | Rollback scheitert (Worker bleibt ungesund) → `failed_safe_stop`, globaler Safety-Lock, weitere Applies blockiert (`E_SAFETY_LOCK`) |

## Sicherheits-Eigenschaften

- `CONFIG_APPLY_ENABLED=true` wird **ausschließlich** im Node-Prozess des Smoke-Tests gesetzt
  (Prozess-`env`, verschwindet beim Exit). Außerhalb bleibt der Flag unberührt — das Repo enthält
  **keinen** `.env`-Eintrag, der ihn aktiviert.
- Scope strikt: nur `correlator.worker.maxChildren` / `correlator.worker.maxRetries`.
- Kein OS-File, Env-Write außerhalb des Containers, Shell, SSH, Restart, Netz-, Firewall-,
  Receiver-, Collector- oder Integrations-Apply. Keine echten Wazuh-/OPNsense-Daten.
- DB ist flüchtig (`tmpfs`) **und** wird per `down -v` entfernt — kein Persistenz-Rest.

> **Wichtig:** Ein grüner Smoke-Test aktiviert **nichts** in einer echten Umgebung. Der Apply-Kanal
> bleibt produktiv gesperrt (`CONFIG_APPLY_ENABLED=false`), bis eine ausdrückliche Freigabe erfolgt.
