# System-Status 2026-07-07

Kurzsnapshot fuer die aktuelle Uebergabe.

## Wo wir stehen

- Live-Stack ist erreichbar ueber `ssh root@192.168.0.101` und danach `pct enter 120`.
- Laufende Container sind belegt:
  - `soc_api_prod`
  - `soc_web_prod`
  - `soc_postgres_prod`
  - `nexora_collector_hub`
  - `nexora_intake`
  - `nexora_outbox_worker`
  - `nexora_intake_pg`
- Frontend-CSP und API-Security-Header sind serverseitig live verifiziert.
- `dataplane_status` liefert frischen Snapshot von `nexora-collector-hub-1`.
- Ticketquellen in Prod zeigen aktuell echte Aktivitaet:
  - `dataplane=3843`
  - `wazuh=185`
- Outbox-Worker verarbeitet laufend erfolgreiche Batches.

## Quellenlage live

- `cowrie`: aktiv, Emit-Zaehler steigt
- `suricata`: aktiv, Emit-Zaehler steigt deutlich
- `wazuh`: Collector laeuft, Emit im Hub aktuell `0`
- `opnsense`: Collector laeuft, geringe Aktivitaet

Fazit: Die Signal-/Quellenkette ist live deutlich besser belegt als vorher, aber noch nicht gleichmaessig stark.

## Offen

- gezielter Lastnachweis gegen den echten Produktiv-Stack
- wirksame Container-Limits live pruefen
- Host-Key-Policy des Collector-Hub produktiv verifizieren
- Signalqualitaet pro Quelle weiter angleichen
- Repo-/Runbook-Pfad im CT 120 sauber gegen die echte operative Struktur nachziehen

## Heute nachgezogen

- `docs/00-overview/system-deep-scan-2026-07-06.html`
  - offene Punkte auf echten Live-Stand gebracht
- `docs/07-operations/production-readiness-checklist.md`
  - Live-Befunde, verifizierter Zugriffspfad und konkrete Produktions-Kommandos ergaenzt

## Naechster sinnvoller Schritt

Gezielten Postgres-/Dataplane-Lastnachweis fahren und das Ergebnis als dauerhaften Go-Live-Beleg ablegen.
