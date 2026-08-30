# Produktions-Readiness-Checkliste

> Stand: 2026-07-07. Diese Checkliste trennt bewusst zwischen
> **lokal/inhaltlich gebaut** und **auf dem echten Zielsystem unter Last belegt**.

## Ziel

Diese Seite ist der ehrliche Go-/No-Go-Blocker fuer:

- Security-Haertung im Live-Stack
- reale Postgres-/Dataplane-Last
- Dataplane-Kontinuitaet nach Restart / Rebuild

Ein Punkt gilt erst als erledigt, wenn er **gemessen oder live verifiziert** wurde.

---

## 0. Live-Status 2026-07-07

Heute bereits live belegt:

- Frontend-CSP und API-Security-Header sind serverseitig produktiv sichtbar.
- `dataplane_status` liefert frischen Snapshot von `nexora-collector-hub-1`.
- Ticketquellen in Prod zaehlen aktuell `dataplane=3843` und `wazuh=185`.
- `nexora_outbox_worker` verarbeitet laufend erfolgreiche Batches.
- Collector-Snapshot zeigt live `cowrie`, `suricata`, `wazuh`, `opnsense`.

Noch offen trotz dieser Belege:

- gezielter Lastnachweis gegen den echten Produktiv-Stack
- wirksame Container-Limits live pruefen
- SSH-Host-Key-Policy im Collector-Hub auf sauberen Produktivwert verifizieren
- Signalqualitaet pro Quelle angleichen (`wazuh` im Hub aktuell ohne Emission, `opnsense` nur geringe Aktivitaet)

## 0a. Verifizierter Live-Zugriff

Aktuell verifizierter Weg in die Zielumgebung:

1. `ssh root@192.168.0.101`
2. `pct enter 120`

Wichtige Ehrlichkeit:

- CT `120` ist der richtige Live-Container fuer den laufenden Stack.
- Die laufenden Container sind live belegt.
- Der frueher angenommene Repo-Pfad im CT ist **derzeit nicht als operative Wahrheit verifiziert**.
- Fuer repo-pfadbasierte Runbooks erst den echten Arbeitsbaum im CT erneut sauber feststellen.

## 1. Security-Go-Live

Vor einem produktiven Rollout muessen diese Punkte aktiv nachgewiesen werden:

| Punkt | Erwartung | Nachweis |
|---|---|---|
| Frontend-CSP ueber nginx | Header aktiv, UI/Docs rendern weiterhin sauber | `curl -I https://<host>` + Browser-Smoke |
| Dataplane-HMAC-Secret | nur `WEBHOOK_SECRET_DATAPLANE`, kein generischer Fallback | Route-Test + Env-Review |
| API-Security-Header | Helmet liefert Header fuer JSON-API | `/health`-/API-Test |
| SSH-Host-Key-Policy | Produktiv nach Moeglichkeit `yes`, nicht still `accept-new` | Hub-Config / ENV pruefen |
| Secrets-Quelle | keine Secrets in Markdown/Code/Logs | Spot-Review + `rg` |

Aktueller Stand 2026-07-07:

- CSP fuer `/`, `/docs/` und `/health` ist serverseitig live geprueft.
- Browser-/Console-Proof ist optionaler Zusatznutzen, kein blocker fuer den bereits vorhandenen Header-Nachweis.
- Host-Key-Policy bleibt echter Restpunkt.

## 2. Belastbarkeit / Last

Die vorhandene Hauptmessung in [`loadtest-results.md`](./loadtest-results.md) ist **nur ein
InMemory-Entwicklungsnachweis**. Fuer Produktionsfreigabe braucht es zusaetzlich:

| Punkt | Erwartung | Nachweis |
|---|---|---|
| Postgres unter Last | `db: ok`, keine Pool-Warte-Staus, keine Query-Timeouts | echter Lauf gegen Produktiv-oder Lab-Postgres |
| Dataplane-Outbox | `pending` stabil / abbauend, kein unendlicher Rueckstau | Live-Metriken / SQL / Logs |
| Collector-Hub-Robustheit | Reconnects ohne Listener-Leak oder Prozess-Aufblaehung | Node-Tests + Laufzeitbeobachtung |
| Container-Limits wirksam | `docker inspect` zeigt echte Limits, nicht `0` | `docker inspect` + `docker stats` |
| Event-Quellen | nicht nur Wazuh, sondern Cowrie/Suricata/Firewall liefern wieder | Dataplane-UI + Logs + Ticketfluss |

Aktueller Stand 2026-07-07:

- Live-API-Log zeigte bereits mindestens ein `pg_pool_saturated`-Signal.
- Das ist ein echter Druck-Indikator, aber **noch kein kontrollierter Lastbeweis**.
- Die harten Proof-Skripte existieren bereits:
  - `node backend/scripts/loadtest/postgresProductionProof.js`
  - `node dataplane/scripts/outboxBacklogProof.js`
- Fuer den echten Go-Live-Block fehlt der gezielte Lauf gegen die Zielumgebung bzw. ein produktionsnahes Lab mit archiviertem Ergebnis.

## 3. Dataplane-Betrieb

Nach jedem Rebuild, Restart oder Host-Wechsel:

1. Intake / Outbox / Collector-Hub muessen laufen.
2. Seed-Collector muessen vorhanden sein.
3. Status-Bridge nach Nexora muss frische Snapshots liefern.
4. Mindestens eine Testsignal-Kette pro Quelle muss belegt sein.
5. Wazuh-Parent/Child-Aggregation nicht mit fehlenden Fremdquellen verwechseln.

Live gepruefte Quellenlage 2026-07-07:

- `cowrie`: aktiv, steigender Emit-Zaehler
- `suricata`: aktiv, klar steigender Emit-Zaehler
- `wazuh`: Collector laeuft, Emit aktuell `0`
- `opnsense`: Collector laeuft, geringe Aktivitaet

Damit ist die Quellenkette **teilweise live belegt**, aber nicht gleichmaessig stark.

## 4. Harte No-Go-Kriterien

Kein produktives "passt schon", wenn einer dieser Punkte offen ist:

- Nur InMemory-Lasttest vorhanden, aber kein echter Postgres-Lastnachweis.
- Dataplane liefert nur Teilquellen, obwohl mehrere Sensoren erwartet werden.
- Container-Limits stehen in Markdown, sind aber live nicht am Container wirksam.
- Integrationsstatus zeigt "konfiguriert", obwohl Verbindungstests scheitern.
- Repo-/Runbook-Pfade sind dokumentiert, stimmen aber nicht mit der echten Zielumgebung ueberein.

## 5. Empfohlener Nachweis-Block vor dem naechsten Deploy

1. Container-Realitaet pruefen:
   `docker ps --format '{{.Names}} {{.Status}}'`
2. Live-Header pruefen:
   `curl -kI https://localhost/`
   `curl -kI https://localhost/docs/`
   `curl -kI https://localhost/health`
3. Dataplane-Snapshot direkt aus Prod-DB ziehen:
   `docker exec soc_postgres_prod psql -U soc_api -d soc_tickets_prod -c "select node_id, reported_at, received_at, updated_at from dataplane_status order by received_at desc limit 10;"`
4. Quellenverteilung direkt aus Prod-DB ziehen:
   `docker exec soc_postgres_prod psql -U soc_api -d soc_tickets_prod -c "select source, count(*) from tickets group by source order by count(*) desc;"`
5. Collector-Hub und Worker live lesen:
   `docker logs --tail 120 nexora_collector_hub`
   `docker logs --tail 120 nexora_outbox_worker`
6. Danach gezielten Lastlauf fahren und Ergebnis ablegen:
   `node backend/scripts/loadtest/postgresProductionProof.js`
   `node dataplane/scripts/outboxBacklogProof.js`
7. Screenshot / Kurzprotokoll in Changelog oder Ops-Notiz ablegen
