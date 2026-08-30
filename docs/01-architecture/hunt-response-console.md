# Architektur- & Sicherheitskonzept: Hunt Response Console

> Status: **Teilweise implementiert (Stufe 2 live, Stufe 3 offen)**.
> Zweck: Sicheren, gestuften Weg von "read-only Safe Commands" zu "Analyst
> isoliert einen Client und arbeitet mit Genehmigung wie ein Admin" festlegen.
> Scope-Grenzen aus dem Projekt gelten: keine freie gefaehrliche Shell, keine
> destruktiven Defaults, keine Wazuh Stage 4/5-Aenderung, kein Manager-Restart,
> keine Secrets im Frontend, alles auditierbar.

---

## 1. Zielbild

Ein Analyst kann im Threat-Hunts-Operations-Center:

1. **Read-only** Diagnose-Befehle gegen einen Host laufen lassen (sofort).
2. Bei Verdacht den **Host isolieren** (Netzwerk-Containment) - **nur mit Erlaubnis**.
3. Auf dem isolierten Host **administrativ arbeiten** (privilegierte Commands) -
   **nur mit Erlaubnis**, jede Aktion auditiert.

Kernprinzip (wie im restlichen Tool): **Vorschlag/Anfrage -> menschliche
Genehmigung -> Ausfuehrung -> Audit.** Reale Wirkung erfolgt weiterhin nicht
automatisch; optional kann ein explizit aktivierter Mock-Pfad genehmigte
Containment-Aktionen fuer Demo- und Testzwecke bis `completed` durchlaufen lassen.

---

## 2. Drei-Stufen-Modell

| Stufe | Inhalt | Wirkung | Voraussetzung |
|---|---|---|---|
| **1 - Safe Commands** | Allowlist read-only (`whoami`, `hostname`, `tasklist`, `netstat -ano`, `ipconfig /all`, `Get-Process`, `Get-Service`) | sofort, mock-backed (kein Agent) -> spaeter echt | - |
| **2 - Approval Gate** | "Isolate Host" + privilegierte Commands als **Genehmigungs-Anfrage** (pending) | live: Anfrage + Vier-Augen-Freigabe + Audit; optional Mock-Ausfuehrung fuer Containment | Capability + zweite Genehmigung |
| **3 - Reale Ausfuehrung** | Genehmigte Aktionen laufen wirklich (Isolation, Admin-Commands) | echte Wirkung am Endpoint | **Agent/Collector** + signierte Command-Queue |

Stufe 1+2 sind ohne Agent sicher baubar. **Stufe 3 erfordert den Agent** und ist
ein eigenes Projekt. Aktuell kann `HUNT_RESPONSE_AUTO_EXECUTE_MOCK=true`
genehmigte `isolate_host`- und `release_isolation`-Aktionen als klar markierte
Mock-Ausfuehrung simulieren; `privileged_command` bleibt auch dann bei
`approved` / `pending agent`.

---

## 3. Capability-basierte Autorisierung (RBAC++)

Rollen allein reichen nicht. Ergaenzung um **Capabilities** (feingranular):

```text
canRunSafeCommand           # Stufe 1 - analyst+
canRequestPrivilegedCommand # Stufe 2 - analyst+ (nur ANFRAGEN)
canRequestHostIsolation     # Stufe 2 - analyst+ (nur ANFRAGEN)
canApproveResponseAction    # Stufe 2 - senior analyst / admin (NICHT der Anforderer)
canExecuteResponseAction    # Stufe 3 - system/agent-runner, nie ein Mensch direkt
canReleaseHostIsolation     # Stufe 2/3 - senior analyst / admin
```

Regeln:
- **Vier-Augen-Prinzip**: Anforderer != Genehmiger (`requestedBy !== approvedBy`).
- Capabilities werden serverseitig geprueft (Middleware), nie nur im Frontend.
- Mapping Rolle -> Capabilities zentral, ueberschreibbar pro Nutzer (spaeter).

---

## 4. Datenmodell (additiv, neue Domain `ResponseAction`)

```text
ResponseAction
  id
  huntSessionId        # Kontext
  targetHost
  kind                 # safe_command | privileged_command | isolate_host | release_isolation
  command?             # bei *_command: der konkrete Befehl
  status               # requested | approved | rejected | executing | completed | failed | expired
  riskTier             # read_only | privileged | containment
  requestedBy
  requestedAt
  approvedBy?          # != requestedBy (Vier-Augen)
  approvedAt?
  executedAt?
  result / stdout / stderr / exitCode?
  rejectionReason?
  expiresAt            # offene Anfragen verfallen (z.B. 30 min)
```

- **Safe Commands** (Stufe 1) ueberspringen das Gate: `requested -> executing -> completed`
  in einem Schritt (read_only). Nutzt vorhandenes `HuntCommand`-Modell.
- **Privileged / Isolation** (Stufe 2): `requested -> approved -> (Stufe 3) executing -> completed`.
  Ohne Agent endet es bei `approved` mit Hinweis "pending agent".
  Wenn `HUNT_RESPONSE_AUTO_EXECUTE_MOCK=true` gesetzt ist, laufen genehmigte
  Containment-Aktionen (`isolate_host`, `release_isolation`) kontrolliert als
  Mock ueber `executing -> completed`, inklusive Audit-Events
  `RESPONSE_EXECUTED` plus `HOST_ISOLATED` bzw. `HOST_ISOLATION_RELEASED`.
- Wiederverwendung: `HuntCommand` hat bereits `blocked -> (Genehmigung) -> queued` -
  das Gate-Muster existiert konzeptionell schon.

---

## 5. API (geplant / teilweise live)

```text
# Stufe 1
POST /v1/hunts/:id/run-command            { command }      # nur Allowlist, sofort
GET  /v1/hunts/:id/commands                                # Verlauf

# Stufe 2
POST /v1/hunts/:id/response-actions        { kind, command? }   # Anfrage (pending)
GET  /v1/hunts/:id/response-actions                             # Queue
POST /v1/response-actions/:id/approve                           # canApproveResponseAction, != requester
POST /v1/response-actions/:id/reject       { reason }
POST /v1/hunts/:id/isolate                 { reason }           # = response-action kind=isolate_host
POST /v1/hunts/:id/release-isolation       { reason }

# Stufe 3 (mit Agent) - intern, nicht direkt von Menschen aufrufbar
(worker) consume approved actions -> agent command queue (signiert) -> result zurueck
```

Alle schreibenden Endpunkte: Audit-Eintrag mit actor, action, target, capability.

---

## 6. Agent-Vertrag (Stufe 3, Vorbereitung)

- **Allowlist auch am Agent** - der Agent fuehrt nur bekannte, signierte Aktionen aus.
  Keine generische Shell-Weiterleitung.
- **Pull-Modell**: Agent pollt die Command-Queue (kein offener Inbound-Port am Client).
- **Signierte Commands**: Backend signiert, Agent verifiziert (HMAC/asymmetrisch).
- **Isolation** = Netzwerk-Containment (Host-Firewall-Regel: nur Management-Kanal
  zum SOC bleibt offen). Reversibel via `release-isolation`.
- **Heartbeat + Timeout**: haengende Aktionen -> `failed`/`expired`.
- Keine Secrets im Frontend; Agent-Keys nur server-/agent-seitig.

---

## 7. Threat Model (Kurz)

| Risiko | Gegenmassnahme |
|---|---|
| Missbrauch privilegierter Commands | Allowlist + Vier-Augen-Approval + Capability + Audit |
| Kompromittierter Analyst-Account | Approval durch zweite Person, Audit, Session-Expiry |
| Command-Injection in `command` | Server-Allowlist (Pattern-Match), kein Passthrough an Shell |
| Agent als Angriffsweg | Pull-Modell, signierte Commands, Agent-eigene Allowlist |
| Versehentliche Isolation | Bestaetigung + Grund-Pflichtfeld + reversibel + Audit |
| Datenabfluss (Secrets) | keine Secrets im Frontend, Output redaction, Evidence-Hashing |

---

## 8. Audit (Pflicht)

Jede Response-Action erzeugt Audit-Eintraege:
`RESPONSE_REQUESTED`, `RESPONSE_APPROVED`, `RESPONSE_REJECTED`,
`RESPONSE_EXECUTED`, `HOST_ISOLATED`, `HOST_ISOLATION_RELEASED`,
`SAFE_COMMAND_RUN` - jeweils mit actor, host, sessionId, capability.

---

## 9. Empfohlene Umsetzungsreihenfolge

1. **Stufe 1** - Safe-Command-Console (Allowlist, `HuntCommand`, mock-backed,
   `Commands`-Tab interaktiv). Klein, sicher, sofort nutzbar.
2. **Capability-Layer** - Capability-Map + Middleware (`requireCapability`).
3. **Stufe 2** - `ResponseAction`-Domain + Approval-Gate + `isolate`/`release`
   als auditierte Anfragen (realer Exec offen, optionaler Mock fuer Containment).
4. **Stufe 3** - Agent/Collector + signierte Command-Queue + reale Isolation.
   Eigenes Projekt, eigene Sicherheitsabnahme.

---

## 10. Offene Entscheidungen

- Capability-Speicherung: statische Rollen-Map vs. pro-Nutzer in DB?
- Agent-Technologie (eigener Go/Rust-Agent vs. Wazuh-Active-Response - Letzteres
  beruehrt Wazuh-Stage-Grenzen und ist daher zunaechst ausgeschlossen)?
- Approval-Eskalation: Timeout-Verhalten, Benachrichtigung des Genehmigers?
- Isolation-Scope: nur Host-Firewall vs. Switch/Netzwerk-Ebene?
