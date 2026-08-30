# Collector-Hub — internes „ein System" (ADR-036)

Ein Container, der **alle Kollektoren intern** fährt und die Daten **selbst von den Quellen pullt**
(automatisch, dauerhaft). Auf den Quellen (Honeypot etc.) läuft **kein Collector-Code, kein
Credential, kein Agent** mehr. Erweiterbar: **ein Eintrag mehr** in der Config.

## Bestandteile
- **Entrypoint:** `dataplane/src/collector/collectorHubMain.js` — lädt `HUB_CONFIG_FILE`, baut den Hub (`buildHubFromConfig`), startet alle Kollektoren, stoppt sauber bei SIGTERM/SIGINT.
- **Config:** `hub.config.example.json` (hier) — eine Liste `collectors[]`. Jeder Eintrag:
  - `name` (eindeutig), `kind` (`cowrie|suricata|opnsense|wazuh|conntrack`), `options` (z.B. `honeypotIp`, `assetIps`, `minLevel`, `scopePorts`),
  - `credential`: **Name** einer ENV-Variable mit dem Token (per-Collector-Identität),
  - `source`:
    - `{ "mode": "tail", "ssh": {host,user,port,identityFile,proxyJump,proxyJumpKey}, "logPath": "…" }` — read-only `tail -n0 -F` über SSH (laufende Logs, niedrigste Latenz).
    - `{ "mode": "poll", "intervalMs": 5000, "fetchSince": … }` — Intervall-Poll mit Cursor (API-Quellen; `intervalMs` Sekunden→ms).

## Sicherheit
- Hub verbindet sich **outbound, read-only** zur Quelle; **Credential/SSH-Key liegen intern** (im Hub), nie auf der exponierten Box.
- `logPath` wird streng validiert (keine Shell-Metazeichen) und gequotet → keine Command-Injection.
- Quelldaten gelten als **untrusted** (validate/normalize, nie `eval`, bounded).

## Docker (Teil des „einen Systems")
Reuse des vorhandenen Images `nexora-intake:prod` (enthält `src/collector/`), eigener CMD — wie der Worker:
```yaml
  collector-hub:
    image: nexora-intake:prod
    container_name: nexora_collector_hub
    command: ["node", "src/collector/collectorHubMain.js"]
    environment:
      HUB_CONFIG_FILE: /config/hub.config.json
      CRED_HP_COWRIE:   "${CRED_HP_COWRIE:?}"      # Tokens (per-Collector) aus .env
      CRED_HP_SURICATA: "${CRED_HP_SURICATA:?}"
    volumes:
      - ./hub.config.json:/config/hub.config.json:ro     # echte Config (IP-frei-Vorlage = hub.config.example.json)
      - ./keys:/keys:ro                                   # read-only SSH-Keys zu den Quellen
    networks: [default]          # selbes Netz wie intake/worker → ein System
    restart: unless-stopped
```
> Die echte `hub.config.json` + `./keys` sind **operator-privat** (gitignored), nur die `*.example.json`-Vorlage liegt im Repo.

## Verhältnis zur Migration (#25)
Der Hub ersetzt die bisherigen **Push**-Kollektoren auf den Quell-Hosts. Vorgehen: Hub intern hochziehen
+ verifizieren (gleiche Tickets/Verdikte), **dann** die VPS-Push-Dienste abbauen — kein Big-Bang.
