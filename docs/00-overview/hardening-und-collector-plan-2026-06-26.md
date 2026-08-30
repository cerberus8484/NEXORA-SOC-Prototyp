# Härtungs-Backlog + Kollektoren-Admin-Seite — Plan (2026-06-26)

Ergebnis des Agent-gestützten Sicherheits- & Seiten-Audits. **Bereits erledigt** in dieser
Session (Commits `1fd695eb`, `37fed6a4`): QRadar-Report-Notes-Bug, S1 (Ollama-TLS via ENV),
S2 (Login-Audit ohne err.message), S5 (Blob statt document.write), Helmet-CSP, OIDC-Discovery-TTL.

Dieses Dokument hält die **noch offenen** Punkte fest — bewusst zurückgestellt, weil sie
Prod-/Ops-Koordination oder eine eigene Design-Runde brauchen.

---

## 1. Security-Härtungs-Backlog (offen)

| ID | Schwere | Befund (Beleg) | Warum zurückgestellt / Voraussetzung | Maßnahme |
|---|---|---|---|---|
| **S3** | HIGH | `AUDIT_IP_SALT` nutzt öffentlich bekannten Dev-Default (`AuditService.js:9`) → IP-Pseudonymisierung im Audit-Log de-anonymisierbar (DSGVO Art. 25). | — | 🟡 **TEILWEISE (`e9b7b737`):** `validateEnv.js` **warnt** jetzt in Prod (nicht-brechend) + `.env.example` dokumentiert. **OFFEN:** **Operator setzt `AUDIT_IP_SALT`** (≥32 zufällig) in Prod-ENV → dann **Schritt 2:** Warnung zu Fail-fast (Pflicht-Secret wie `JWT_SECRET`) eskalieren. |
| **S4** | HIGH | Collector-SSH nutzte hartkodiert `StrictHostKeyChecking=accept-new`. | — | 🟡 **TEILWEISE (`a2faedca`):** per-Collector/ENV (`COLLECTOR_SSH_STRICT_HOST_KEY`) konfigurierbar, Allowlist-validiert; Default bleibt `accept-new` (kein Verhaltenswechsel). **OFFEN (Ops):** Host-Keys von OPNsense/Cowrie/Wazuh → `known_hosts` in den `collector-hub`-Container, dann auf `yes` schalten. |
| **S6** | (Dev) | FE Dev-Deps `vite`/`vitest` (Dev-Server/Test). | — | ✅ **GEPRÜFT:** einziger Fix = `vite@8` (Major, breaking, kaskadiert auf vitest). **Eigener Branch** als kontrollierte Migration; kurzfristig Dev-Server nie auf `0.0.0.0`. |
| **M** | MEDIUM | `/metrics` nur IP-Allowlist, kein Auth. | — | ✅ **ERLEDIGT (`a2faedca`):** optionaler `METRICS_TOKEN` (Bearer, timing-sicher) ZUSÄTZLICH zum IP-Gate; ungesetzt = nur IP-Gate (non-breaking). |
| **M** | MEDIUM | Wazuh-Deploy-Skript `StrictHostKeyChecking=no`. | — | ✅ **ERLEDIGT (`a2faedca`):** → `accept-new` + Kommentar. (`WAZUH_TLS_REJECT_UNAUTHORIZED`-Eskalation zu Fehler in Prod noch offen.) |
| **M** | MEDIUM | CSRF-Guard nahm `/dataplane` nicht explizit aus. | — | ✅ **ERLEDIGT (`a2faedca`):** `/dataplane` explizit ausgenommen (HMAC-Webhook, cookie-los, wie `/integrations`). |
| **L** | LOW | `integrations.js` las `OLLAMA_BASE_URL` ohne Allowlist (anders als Settings-Pfad). | — | ✅ **ERLEDIGT (`a2faedca`):** geteiltes `ollamaUrlAllowlist.js` (Single Source of Truth), jetzt in beiden Pfaden geprüft. |

**Gut gelöst (NICHT anfassen):** PKCE-OIDC (state/nonce/Signatur-vor-Claims/email_verified-Gate),
HMAC-Webhooks (timing-safe + Replay-Schutz), parametrisiertes SQL + Sort-Whitelist, bcrypt-12,
JWT-Fail-fast, Secret-at-rest AES-256-GCM, RBAC serverseitig, SSH-Command-Injection-Guards
(`SAFE_PATH`/`SAFE_FILTER`), Fehler-Isolation (keine Stacktraces zum Client).

---

## 2. Kollektoren-Admin-Seite — Scope-Entscheidung: **Read-only Status + Tuning**

**Ausgangslage:** Der Collector-Hub liest seine Config ausschließlich aus einer JSON-Datei
(`collectorHubMain.js:89`, operator-privat/gitignored) + ENV, **nur beim Boot** (kein Live-Reload).
Es gibt keinen Settings-Store-Key, keine Route, keinen UI-Tab. Die Specs enthalten **SSH-Hosts,
Key-Pfade und Credential-Referenzen** (sicherheitssensibel).

**Entscheidung (bestätigt):** **Read-only Status + nicht-geheimes Tuning** — *nicht* die SSH-Secrets
ins Web-UI/DB heben (bewusste Angriffsflächen-Begrenzung).

### Stand
✅ **ERSTE SCHEIBE GEBAUT (Commit `1c9f0a57`):** read-only Seite `/collectors` zeigt die ECHTE
Ingestion-Aktivität je Quelle aus Tickets (`ingestActivityBySource`: total / letzte 24h / last-seen)
über `GET /api/v1/collectors/activity`. Status-Badge active/quiet/none aus echten Zahlen. Bewusst
KEIN erfundener Hub-Prozessstatus (`liveProcessStatus.available=false`).

### Noch offen (Folge-Scheiben)
1. **Hub↔Backend-Status-Brücke** für den ECHTEN Live-Prozessstatus (running/failed/throughput): der Hub
   hat `collectorHub.status()` (`collectorHub.js:68`), läuft aber als eigener Container. Optionen:
   schlanker Status-HTTP-Endpoint am Hub, den die API proxyt, **oder** Hub schreibt Heartbeat in die
   gemeinsame DB. **Designfrage** — erst dann ist „running/failed" ehrlich anzeigbar.
2. **Backend — optionales Tuning (nicht-geheim):** Enable/Disable je Kollektor + Tuning-Werte
   (Filter, Rate-Limits) im `platform_settings`-Store (`collector_*`-Keys), analog OIDC/KI.
   Wirkung erfordert einen **Reload-Pfad** (Hub liest heute nur beim Boot) — Minimalvariante:
   Status zeigt „Änderung erfordert Hub-Neustart", bis ein Reload-Signal gebaut ist.
3. **Frontend — neue Seite `/collectors`** (oder Tab): Read-only Tabelle (Kollektor · Typ · Quelle ·
   Status · letzte Events) + Enable/Disable-Toggle + Tuning-Felder (admin-gated), analog
   `OidcSettingsCard`/`CorrelatorsPage`. Nav-Item in `navConfig.ts` (Gruppe „integrations" oder „system").
4. **Tests:** Status-Endpoint (RBAC, kein Secret-Leak), Tuning-Persistenz, Frontend-API + Card.

### Bewusst NICHT in diesem Scope
- SSH-Host/Key/Credential editierbar machen (bleibt Datei/ENV → Ops/Secrets-Management).
- Voll-dynamische Collector-Provisionierung „bis OS-Ebene" → eigener großer Folge-Block mit
  ADR + Threat-Model (analog Apply-Channel der Correlators), falls später gewünscht.

### Korrelatoren-Seite (verwandt)
Hat bereits ein vollständiges, **bewusst gated** Backend-Admin-System (Registry + Apply-Channel +
RuntimeConfig + RBAC + Vier-Augen + Audit, `routes/correlators.js`), aber **kein Edit-UI**
(`CorrelatorsPage.tsx` liest nur). Offen wäre nur ein Edit/Approval-UI + produktives Scharfschalten
(`CONFIG_APPLY_ENABLED=true`) — bewusste Sicherheitsentscheidung, niedrige Priorität.

---

## 3. Empfohlene Reihenfolge (frische Session)
1. **S3** (Operator setzt Salt → dann Code) — billigste echte DSGVO-Härtung.
2. **Kollektoren read-only Status-Seite** (Punkt 2.1 + 2.3) — sichtbarer Nutzen, kein Secret-Risiko.
3. **S4** (mit Ops: known_hosts-Rollout).
4. **/metrics** Opt-in-Token, restliche MEDIUM/LOW.
5. **S6** Vite-Major-Migration (eigener Branch).
