# Sicherheitsplan — Kontrollierter Apply-Kanal (P_CORR_ADMIN_2 Stufe 2)

> **Status: Stufe 2 LOKAL IMPLEMENTIERT + getestet — aber NICHT deploy-reif.**
> Bedrohungsmodell, Kontrollen und harte Invarianten für den ersten echten Apply-Kanal.
> Architektur-Entscheidungen (§9) verbindlich, Stufe 2 gebaut (§12).
>
> ✅ **Stufe 3 (Live Health Confirmation) implementiert (§14):** Der konservative Seam ist ersetzt
> — Health ist jetzt echt fail-closed (Worker bestätigt übernommene Config-Version + frischer
> Heartbeat + Queue-Liveness; sonst Rollback).
>
> ⚠️ **Trotzdem bleibt `CONFIG_APPLY_ENABLED` standardmäßig und in jeder echten Umgebung `false`**
> bis ein separater lokaler Deploy-/Smoke-Test mit echtem Worker (Postgres, end-to-end) und eine
> ausdrückliche Freigabe erfolgt sind. Sicherer Zustand: lokal getestet, Flag `false`, kein
> Push/Deploy/Production-Apply.

Stand: 2026-06-22 (Stufe 2 implementiert, §13 offen) · Branch `p-phase0-close` · bezieht sich auf [[project-p-corr-admin-2-plan]].

---

## 1. Zweck & Scope

Stufe 1 endet bei `approved` + lesbarem, redigiertem **Apply-Plan** — ohne Ausführung.
Stufe 2 würde erstmals einen **kontrollierten Apply** ermöglichen:

```
approved + plan_ready
  → Apply-Request (eigene, separat gegatete Aktion)
  → erlaubte Worker-Config schreiben (bounded, validiert)
  → kontrollierter Reload/Restart (nur der Correlation-Worker)
  → Health-Check (Erfolgskriterium definiert)
  → Audit-Ergebnis (append-only)
  → Rollback bei Fehler (gehärtet wie der Apply selbst)
```

### In-Scope (ausschließlich)
- `correlator.worker.maxChildren` (Integer, reload-Impact)
- `correlator.worker.maxRetries` (Integer, reload-Impact)

### Hart ausgeschlossen (deny by default, A01/A02)
- Jede Host-, Netzwerk-, Firewall-, Receiver-, Collector- oder Integrations-Capability.
- Jede OS-Konfiguration, Datei außerhalb des verwalteten Parameter-Stores, Env, Prozessverwaltung außerhalb des Workers.
- Freie Key-/JSON-/Pfad-/Wert-Eingabe. Nur typisierte, schema-validierte Integer aus der Allowlist.

---

## 2. Vertrauensgrenzen & Akteure

| Akteur | Recht (geplant) |
|---|---|
| analyst | Registry/Plan **lesen** |
| engineer | Draft erstellen/ändern/**validieren**/einreichen |
| admin | genehmigen/ablehnen (Vier-Augen) **und** — NEU — Apply auslösen (separat gegatet) |
| Correlation-Worker | liest den Parameter-Store; führt selbst KEINEN Apply aus |

**Vertrauensgrenze 1:** HTTP-API ↔ Apply-Executor (serverseitig). Der Executor vertraut der Route NICHT blind — er prüft Eligibility, Approval-State und Plan-Integrität erneut.
**Vertrauensgrenze 2:** Apply-Executor ↔ Worker-Parameter-Store (Schreibziel). Klar definiertes, bounded Schreibziel — **kein** beliebiger Pfad.
**Vertrauensgrenze 3:** Parameter-Store ↔ Worker-Laufzeit (Reload-Trigger). Nur der Worker, kein host-/service-weiter Eingriff.

---

## 3. Schutzziele (Invarianten — müssen IMMER gelten)

1. **I1 — Allowlist-Hartgrenze:** Apply nur für die zwei eligible Caps. Defense-in-Depth: Route **und** Executor prüfen `isApplyEligible` unabhängig.
2. **I2 — Kein Apply ohne Pfad:** `applyStatus` wird erst `supported`, wenn `isApplyEligible(cap) && CONFIG_APPLY_ENABLED === true` (Server-/Deployment-Flag, NICHT über UI schaltbar). Default `false` (Kill-Switch, §7).
3. **I3 — Plan-Integrität (kein TOCTOU):** Angewendet wird genau der genehmigte Plan. Apply-Request trägt `planHash` + `expectedDraftVersion`; weicht der aktuelle Zustand ab → **deny, neu planen**.
4. **I4 — Fail-closed:** Jeder Fehler (Validierung, Schreiben, Reload, Health) → kein „halb angewendet", sondern definierter sicherer Zustand + Rollback.
5. **I5 — Single-flight:** Höchstens ein Apply gleichzeitig (Mutex/Advisory-Lock). Keine überlappenden Applies.
6. **I6 — Vollständige Nachvollziehbarkeit:** Append-only Audit über Request, Schreiboperation, Reload, Health, Rollback — redigiert, mit `planHash`.
7. **I7 — Keine Secrets:** Die zwei Params sind keine PII/Secrets; Redaction + No-Secret-Logging bleiben trotzdem aktiv.

---

## 4. Apply-Zustandsmaschine (geplant)

```
approved ──(Plan erzeugt)──► plan_ready
plan_ready ──(Apply-Request, admin, Kill-Switch an, planHash ok)──► applying
applying  ──(write ok)──► reloading
reloading ──(health ok)──► applied
applying|reloading ──(Fehler)──► rolling_back
rolling_back ──(restore+health ok)──► rolled_back
rolling_back ──(restore FEHLER)──► failed_safe_stop  (lauter Alarm, kein unbekannter Zustand)
```

- `applied`/`rolled_back`/`failed_safe_stop` sind terminal.
- `failed_safe_stop` ist der einzige „schlechte" Endzustand und MUSS alarmieren + Apply global sperren bis manueller Eingriff.
- **Wichtig (§9.7):** Dieser Lifecycle gehört zum **immutablen Apply-Plan-/Apply-Run-Record**, NICHT zum Draft. Der Draft bleibt `approved`. Draft-/Approval-Historie und reale Ausführungs-Historie bleiben sauber getrennt.

---

## 5. Bedrohungsmodell (STRIDE → OWASP-Mapping → Kontrolle)

| # | Bedrohung | OWASP | Kontrolle |
|---|---|---|---|
| T1 | **Scope-Creep**: Apply einer nicht-eligible Cap (host/net/fw) | A01/A02 | I1 Doppelprüfung; Executor lehnt unabhängig ab; Negativtests pro ausgeschlossener Cap |
| T2 | **Privilege-Escalation**: engineer/analyst löst Apply aus | A01/A07 | Apply = eigener Endpunkt, `requireRole('admin')`; Apply ≠ Approve; **verpflichtende frische Re-Authentifizierung** vor Apply (kein Break-Glass im ersten Slice) |
| T3 | **Selbstfreigabe**: Ersteller genehmigt eigenen Draft | A01/A06 | **Ersteller ≠ Approver hart erzwungen** (Vier-Augen für Approve). Approver darf nach frischer Reauth anwenden — vollständig auditiert (Approver+Applier) |
| T4 | **TOCTOU**: Draft/Config ändert sich zwischen Approve und Apply | A01/A08 | I3 `planHash`+`expectedVersion`; stale → deny + Re-Plan |
| T5 | **Injection über Wert/Ziel**: freier Pfad/Key/JSON | A05 | Nur Allowlist-Cap + schema-validierter Integer; Schreibziel ist ein fixer, bekannter Store-Key — keine Pfadkonstruktion aus Input |
| T6 | **Unsicheres Schreiben**: Teil-/korrupter Schreibvorgang | A08 | Atomare Schreiboperation (Transaktion); vorheriger Wert als Backup persistiert (Rollback-Quelle) |
| T7 | **Unkontrollierter Reload/Restart**: host-/serviceweiter Neustart | A02/A06 | Nur Worker-Reload; reload bevorzugt vor restart (beide Caps sind reload-Impact); kein OS/Service-Befehl, kein Shell |
| T8 | **Hängender Reload / Worker-Down** | A10 | Health-Check mit hartem Timeout; bei Timeout → Rollback; `applying` nie unbegrenzt |
| T9 | **Replay / Doppel-Apply** | A08 | Idempotenz: `planHash` einmal anwendbar; erneuter Apply desselben Plans = no-op/deny |
| T10 | **Race / paralleler Apply** | A01/A10 | I5 Single-flight Mutex (DB-Advisory-Lock o. ä.) |
| T11 | **Silent Failure**: Fehler verschluckt, Zustand unklar | A09/A10 | Fail-closed (I4); jeder Schritt schreibt Audit; verschluckte Fehler verboten (silent-failure-Review) |
| T12 | **Rollback-Versagen** | A10 | Rollback gleich gehärtet wie Apply; scheitert er → `failed_safe_stop` + Alarm + globale Apply-Sperre |
| T13 | **Audit-Manipulation** | A09 | Append-only, kein Update/Delete; konsistent zur bestehenden IP-Hashing-/Audit-Linie |
| T14 | **Kill-Switch umgangen** | A02 | `applyStatus=supported` nur wenn Kill-Switch an; Default aus; Flag serverseitig, nicht aus Client ableitbar |
| T15 | **Missbrauch/Abuse** vieler Applies | A07/A10 | Rate-Limit + Cool-down zwischen Applies; admin-only; Audit-Alerting auf Häufung |

---

## 6. Kontroll-Design (Soll)

- **Eigener Apply-Endpunkt**, getrennt von decision: z. B. `POST /correlators/:id/drafts/:draftId/apply`, `requireRole('admin')`, Body trägt `planHash` + `expectedVersion`. Verlangt eine **frische Re-Authentifizierung** unmittelbar vor Apply (§9.4).
- **Apply-Executor** als eigener, gut testbarer Service mit reiner Vorprüfung (Eligibility, State=`plan_ready`, planHash-Match, Kill-Switch, frische Reauth) **vor** jeder Wirkung.
- **Schreibziel (§9.1)**: ein **verwalteter, versionierter Runtime-Config-Store in der Datenbank**, den der Worker zur Laufzeit liest — **kein** OS-File, **keine** Env-Änderung, **kein** Prozess-Restart.
- **Reload (§9.2)**: **Hot-Reload nur an Job-Grenzen.** Bereits laufende Correlation-Jobs behalten ihren beim Start gelesenen Config-Snapshot; neue Jobs nutzen erst danach die neue Version. Keine Änderung mitten im Lauf.
- **Health-Check (§9.3)**: Apply gilt nur als erfolgreich, wenn der Worker die **erwartete Config-Version bestätigt** und innerhalb eines festen Timeouts gesund erscheint. Minimum: Heartbeat aktuell · Config-Version übernommen · keine neue Worker-Fehlermeldung · Queue weiterhin verarbeitbar.
- **Rollback**: Backup-Wert (Vorversion aus dem Store) zurückschreiben + erneuter Health-Check.
- **Audit**: pro Schritt ein append-only Eintrag, redigiert, mit `planHash` und Ergebnis. Hält Approver + Applier fest.
- **Kill-Switch (§9.6)**: Deployment-/Server-Flag `CONFIG_APPLY_ENABLED` (Default false), **nicht** über die UI schaltbar; steuert I2.

---

## 7. Kill-Switch & Roll-out

Server-/Deployment-Flag, **nicht** über die UI aktivierbar:

```
CONFIG_APPLY_ENABLED=false   # Default
```

Apply ist nur möglich, wenn **beides** gilt:
- globaler Server-Flag `CONFIG_APPLY_ENABLED=true`, **und**
- Capability steht auf `supported` und ist in der engen Apply-Allowlist (zwei Caps).

Sonst zeigt die UI klar: **„Apply serverseitig gesperrt"**.

1. Feature landet mit `CONFIG_APPLY_ENABLED=false` → verhält sich exakt wie Stufe 1 (`not_supported`).
2. Aktivierung nur bewusst über Deployment, dokumentiert, reversibel.
3. Selbst bei aktiviertem Switch bleibt die Eligibility-Allowlist (zwei Caps) die harte Grenze.
4. `failed_safe_stop` sperrt weitere Applies bis manueller Review (lauter Alarm).

---

## 8. Test-Verpflichtungen vor Stufe-2-Abnahme

- Negativtests: Apply jeder **nicht**-eligible Cap → deny (Route **und** Executor).
- RBAC: analyst/engineer Apply → 403; nur admin.
- **Frische Reauth**: Apply ohne gültige, frische Re-Authentifizierung → deny.
- **Ersteller ≠ Approver** hart erzwungen (Approve durch den Draft-Ersteller → deny); Approver==Applier nach Reauth erlaubt + auditiert.
- **Job-Grenze**: laufender Job behält Config-Snapshot; neue Version greift erst bei neuem Job (kein Mid-Run-Wechsel).
- TOCTOU: veränderter Draft/Plan nach Approve → Apply deny.
- Idempotenz/Replay: zweiter Apply desselben Plans → no-op/deny.
- Single-flight: paralleler Apply → einer gewinnt, kein Doppelschreiben.
- Fail-closed: Schreib-/Reload-/Health-Fehler → Rollback, Zustand definiert, kein Teil-Apply.
- Rollback-Versagen → `failed_safe_stop` + Alarm + Apply-Sperre.
- Kill-Switch aus → `applyStatus=not_supported`, Apply-Endpunkt deny.
- Keine Secrets/Rohinhalte in Audit/Logs/Antworten.

---

## 9. Festgelegte Entscheidungen (verbindlich, 2026-06-22)

1. **Schreibziel:** Kein OS-File, keine Env-Änderung, kein Prozess-Restart. Die zwei Worker-Werte gehen in einen **verwalteten, versionierten Runtime-Config-Store in der Datenbank**.
2. **Reload:** **Hot-Reload nur an Job-Grenzen.** Laufende Correlation-Jobs behalten ihren beim Start gelesenen Config-Snapshot; neue Jobs nutzen erst danach die neue Version. Verhindert unvorhersehbare Änderungen mitten im Lauf.
3. **Health-Kriterium:** Erfolgreich nur, wenn der Worker die **erwartete Config-Version bestätigt** und danach innerhalb eines festen Timeouts gesund erscheint. Minimum: Worker-Heartbeat aktuell · Config-Version übernommen · keine neue Worker-Fehlermeldung · Queue weiterhin verarbeitbar.
4. **Apply-Autorisierung:** Admin **plus** bestehende Vier-Augen-Freigabe **plus frische Re-Authentifizierung** unmittelbar vor Apply. **Kein Break-Glass** im ersten Slice (eigener späterer Sicherheitsblock).
5. **Approver ≠ Applier:** Nicht als zwingende dritte Person. **Hart erzwungen bleibt: Ersteller des Drafts ≠ Approver.** Der genehmigende Admin darf nach frischer Reauth auch anwenden; alles wird vollständig auditiert (Approver + Applier festgehalten).
6. **Kill-Switch:** Deployment-/Server-Flag `CONFIG_APPLY_ENABLED` (Default false), **nicht** über die UI aktivierbar. Apply nur bei Server-Flag **und** Capability `supported` + in Apply-Allowlist; sonst UI „Apply serverseitig gesperrt".
7. **Persistenz:** **Migration 044** mit separaten **Apply-Plan-/Apply-Run-Records**. **Kein** zusätzlicher terminaler Draft-Status im Kernmodell — der Draft bleibt `approved`. Der zugehörige **immutable** Plan erhält seinen eigenen Lifecycle (§4). So bleiben Draft-/Approval-Historie und reale Ausführungs-Historie getrennt.

---

## 10. Ausdrückliche Nicht-Ziele dieser Stufe

- Kein Apply für irgendeine andere Capability als die zwei Worker-Params.
- Kein Host-/Netz-/Firewall-/Receiver-/Collector-/Integrations-Eingriff.
- Keine Shell, kein SSH, kein OS-/Datei-/Env-Schreiben, kein host-/serviceweiter Restart.
- Kein automatischer Apply ohne menschliche, admin-gegatete Auslösung.

---

---

## 11. Sicherster erster technischer Apply (Zielsequenz, verbindlich)

```
approved Draft
→ immutable planHash + expectedVersion
→ frische Admin-Reauth
→ globaler Kill-Switch (CONFIG_APPLY_ENABLED) geprüft
→ Runtime-Config-Store (DB, versioniert) aktualisieren
→ Worker übernimmt neue Version an Job-Grenze
→ Health bestätigt (Config-Version + Timeout)
→ Audit
→ bei Fehler Rollback
```

---

---

## 12. Stufe 2 — implementiert (2026-06-22, lokal, HEAD `0ae0ebf`)

Umgesetzt + getestet (Backend 255 Suiten/3339 · Vitest 99/1126 · E2E 51 · Build ✓):
Migration 044 · Kill-Switch `CONFIG_APPLY_ENABLED` (Default false) · 9-stufige fail-closed
Apply-Gates · ApplyExecutor (Store-Write → Health → Rollback → `failed_safe_stop` + Sperre,
Audit je Schritt) · RuntimeConfigProvider + Worker-Pickup an Job-Grenzen · Reauth
(`/auth/reauth`, purpose `apply_reauth`) · Routes freeze/apply/run/audit (admin + Reauth).
Scope strikt: nur `correlator.worker.maxChildren/maxRetries`. Nur DB-Store-Write.

## 13. Stufe 3 — Live Health Confirmation (OFFEN, Deploy-Blocker)

**Bis dies umgesetzt ist, bleibt `CONFIG_APPLY_ENABLED` in jeder echten Umgebung `false`.**
Heute bestätigt der Health-Adapter nur den **Config-Versions-Match**; Heartbeat/Queue sind
konservativer Seam (`true`). Stufe 3 ersetzt den Seam durch echte Live-Signale:

```
Runtime-Config-Version IM WORKER bestätigen (Worker meldet die übernommene Version)
→ echter Worker-Heartbeat (frisch, innerhalb Schwelle)
→ Queue-Liveness / Verarbeitungssignal (Queue verarbeitet weiter, kein Stall)
→ Timeout / negatives Fehlersignal → Rollback
→ erst dann CONFIG_APPLY_ENABLED in einer echten Umgebung freischaltbar
```

Konkrete Anschlusspunkte (bereits vorbereitet):
- `correlationHealthAdapter` hat den `workerProbe`-Hook — hier kommt die echte Heartbeat-/
  Queue-Probe rein (heute fehlt sie → konservativ true).
- Der Worker muss seine zuletzt an einer Job-Grenze übernommene `runtime_config.version`
  melden (z. B. in einem Heartbeat/Status), damit „Config im Worker bestätigt" echt prüfbar wird.
- Health bleibt fail-closed: jedes negative/fehlende Live-Signal → Rollback, nie „applied".

## 14. Stufe 3 — implementiert (2026-06-22, lokal)

Der konservative Health-Seam ist ersetzt. Umgesetzt + getestet (Backend 258 Suiten/3359 ·
Vitest 99/1130 · E2E 52 · Build ✓):
- Migration 045 `worker_status` (heartbeat, adoptedConfigVersions[cap→ver], Job-Felder, queueProcessingState) + InMemory/Postgres-Repo + Reporter.
- `buildWorkerProbe` (fail-closed) + `correlationHealthAdapter` pollt bis healthy/Timeout: gesund nur wenn Store-Version aktiv **und** Worker hat die Version übernommen **und** Heartbeat frisch **und** Queue gesund (processing|idle). KEIN konservatives true mehr.
- Worker meldet an Job-Grenze (processing) + idle-Tick die übernommene Version + Heartbeat; laufende Jobs behalten ihren Snapshot.
- Apply-Wiring nutzt die echte Probe; ungesunder Worker ⇒ Rollback/`failed_safe_stop` (API-Test belegt: nicht `applied`).
- UI: read-only Worker-Health (Heartbeat frisch/veraltet/unbekannt, übernommene Version, Queue, Apply-Readiness blockiert). Kein UI-Schalter für den Flag.

**Lokaler End-to-End-Smoke-Test: BESTANDEN (2026-06-22).** `deploy/smoke/run-apply-smoke.sh`
beweist gegen echtes Postgres + echten Worker alle drei Pflichtpfade — applied · rolled_back ·
failed_safe_stop (+ Safety-Lock blockiert weitere Applies). Isoliert (Port 5544, tmpfs, down -v),
`CONFIG_APPLY_ENABLED` nur prozess-lokal. Damit ist der Apply-Kanal **technisch abgeschlossen**.

**Verbleibendes Gate vor echter Aktivierung:** ausschließlich eine **ausdrückliche menschliche
Freigabe** für eine kontrollierte Testumgebung. Bis dahin bleibt `CONFIG_APPLY_ENABLED=false`
(Default + jede echte Umgebung). **Kein Push/Deploy/Production-Apply.**
