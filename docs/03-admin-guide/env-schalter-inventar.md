# ENV-Schalter-Inventar — was wird UI-verwaltbar, was bleibt ENV

> Stand: 2026-07-02 · Ergebnis des ENV-Sweeps (P1, Layer 2).
> Leitregel (⭐ Frontend-Administrierbarkeit): Jede Backend-Admin-Fähigkeit soll aus dem
> Frontend bedienbar sein — **außer** Bootstrap-Secrets und Safety-Gates. ENV-only-Zustände
> werden in der UI ehrlich angezeigt (Quelle „ENV-Konfiguration").

Das Backend liest ~129 ENV-Variablen. Drei Klassen:

## 1. Muss ENV bleiben (nie UI-verwaltbar)

| Klasse | Variablen | Warum |
|---|---|---|
| Bootstrap-Secrets | `JWT_SECRET`, `DB_HOST/NAME/USER/PASSWORD`, `AUDIT_IP_SALT`, `SETTINGS_ENC_KEY`, `ADMIN_EMAIL/PASSWORD`, `WEBHOOK_SECRET_*` | Werden VOR der DB gebraucht bzw. sind der Schlüssel, der die DB-Secrets schützt. Ein UI-Weg wäre zirkulär. |
| Safety-Gates | `WAZUH_FP_APPLY_ENABLED`, `WAZUH_MANAGER_RESTART_ENABLED`¹, `CONFIG_APPLY_ENABLED`, `DEPLOY_ENABLED`, `DEPLOY_HYPERVISOR_ALLOWED_HOSTS`, `DEPLOY_DELIVER_CHANNEL` | Bewusste Operator-Entscheidung am Host — ein kompromittiertes Admin-Konto darf produktive Schreibpfade nicht selbst scharfschalten. |
| TLS-/Transport-Härtung | `WAZUH_TLS_REJECT_UNAUTHORIZED`, `DB_SSL`, `*_TLS_REJECT_UNAUTHORIZED` | Cert-Validierung abschalten ist ein Downgrade-Angriffsvektor. |
| Prozess/Boot | `NODE_ENV`, `PORT`, `SHUTDOWN_TIMEOUT_MS`, `BCRYPT_ROUNDS`, `CORS_ORIGINS` | Compile-/Boot-Zeit; CORS in Prod bewusst deploy-seitig. |

¹ Das Restart-*Arm*-Flag ist bereits UI-schaltbar (Passwort-Step-up); das ENV-Gate bleibt als Operator-Fallback bestehen.

## 2. UI-verwaltet — Stand heute

| Bereich | Variablen (Fallback) | UI-Ort | Speicherung |
|---|---|---|---|
| ✅ KI/LLM | `OLLAMA_BASE_URL/MODEL`, `AGENT_LLM_PROVIDER`, `RAG_ENABLED`, `ANTHROPIC/OPENAI/GOOGLE_*` | Settings → KI | Keys AES-256-GCM in `platform_settings` |
| ✅ OIDC-Client | `OIDC_*` | Administration → SSO | Client-Secret verschlüsselt |
| ✅ Sicherheits-Policies | Lockout, Passwort-Aging, Sessions, MFA-Pflicht, TLS-Enforce, IP-Allowlist | Settings → Plattform | `platform_settings` |
| ✅ Wazuh-Manager-Restart (Arm) | (`WAZUH_MANAGER_RESTART_ENABLED` als ENV-Fallback) | Administration → Services | Arm-Store |
| ✅ Wazuh-Verbindung | `WAZUH_API_URL/USER/PASSWORD`, `WAZUH_INDEXER_URL/USER/PASSWORD` | Administration → Services → Wazuh-Verbindung | **Passwörter AES-256-GCM, DB > ENV, sofort wirksam (Client-`reconfigure()`)** |
| ✅ Threat-Intel-Keys | `VIRUSTOTAL_API_KEY`, `ABUSEIPDB_API_KEY` | Settings → Integrationen | Keys AES-256-GCM, DB > ENV, Provider-`reconfigure()` |
| ✅ QRadar-Verbindung | `QRADAR_BASE_URL`, `QRADAR_TOKEN` | Settings → Integrationen | Token AES-256-GCM, DB > ENV, Provider-`reconfigure()`; Step-up + Audit + SSRF-Deny-List (QRadar darf extern sein → keine Allowlist, aber Loopback/Metadaten tabu) |
| ✅ Qdrant-Verbindung (RAG) | `QDRANT_URL`, `QDRANT_API_KEY` | Settings → Integrationen | API-Key AES-256-GCM (optional — Qdrant kann ohne Auth laufen), DB > ENV; modulweite Runtime-Config (Live-Getter, auch Modul-Load-Instanzen), Step-up + Audit + interne Allowlist |
| ✅ **NEU: CrowdSec-Verbindung (LAPI)** | `CROWDSEC_LAPI_URL`, `CROWDSEC_MACHINE_ID`, `CROWDSEC_PASSWORD`, `CROWDSEC_TLS_INSECURE` | Settings → Integrationen | **Boot-Poller hot-reloadbar:** Poller + Processor immer instanziiert, Config **pro Poll-Zyklus** aus DB>ENV aufgelöst (self-skip wenn unkonfiguriert) → UI-Änderung greift beim nächsten Zyklus (≤ Poll-Intervall) ohne Neustart. Passwort AES-256-GCM, Step-up + Audit + SSRF-Deny-List (LAPI darf extern sein) |
| ✅ **NEU: Outbound-Benachrichtigungen** | `NOTIFY_SMTP_*`, `NOTIFY_EMAIL_FROM/TO`, `NOTIFY_SLACK/WEBHOOK/TEAMS_WEBHOOK_URL`, `NOTIFICATIONS_OUTBOUND_ENABLED` | Settings → Benachrichtigungen | **SMTP-Passwort + Webhook-URLs AES-256-GCM, DB > ENV; `deliverOutbound` liest zur Sendezeit (kein Applier). Master-Schalter UI-toggelbar.** |

Muster (bei Wazuh-Verbindung etabliert, wiederverwendbar): maskiertes GET (nie Secrets) ·
PUT mit Passwort-Step-up + Rate-Limit + Audit · Verbindungstest ohne Speichern ·
SSRF-Allowlist (nur localhost/RFC-1918, `internalUrlAllowlist.js`) · ENV-Fallback bleibt.

## 3. UI-Kandidaten (Backlog, Priorität absteigend)

(Erledigt: TI-Keys ✅, QRadar ✅, SMTP/Notify ✅, Qdrant ✅, CrowdSec ✅ — alle Verbindungen/Secrets UI-verwaltbar. CrowdSec als Boot-Poller hot-reloadbar gemacht: Config pro Poll-Zyklus aus DB>ENV.)

Offen (niedrigere Prio):
5. **Tuning-Werte (expert-only Sektion)** `WAZUH_MIN_LEVEL`, `WAZUH_CORRELATION_WINDOW_H`, `RAG_TOP_K`, `OLLAMA_TIMEOUT_MS`, `AUDIT_EXPORT_MAX`, `LOG_LEVEL` — einfache `platform_settings`-Keys, aber je Wert prüfen, wo er zur Laufzeit gelesen wird (Boot-Cache vs. pro Request).
6. **Feature-Flags** `MFA_ENABLED`, `API_TOKENS_ENABLED`, `WEBAUTHN_ENABLED`, `EXTERNAL_TICKET_EXPORT_ENABLED`, `NOTIFICATIONS_OUTBOUND_ENABLED`, `FQDN_RESOLVER_ENABLED` — schaltbar nur, wenn die Enforce-Logik den Wert zur Laufzeit liest (ADR-009: kein Fake-Persist). Vor jedem Umbau: Lesestellen prüfen.
7. **Ticket-Export-Adapter** `SERVICENOW_*`, `OTRS_*` — erst wenn P12-Export produktiv genutzt wird.

**IMAP** (`IMAP_*`): weiterhin Boot-gegatet. Das CrowdSec-Muster (Poller immer instanziiert + Config pro Zyklus aus DB>ENV + self-skip) ist jetzt die Vorlage, um auch IMAP hot-reloadbar zu machen, wenn gewünscht.

## Konvention für neue UI-Schalter

1. ENV bleibt Fallback (Fresh-Install/Automation bricht nie) — DB gewinnt nur, wenn gesetzt.
2. Secrets: `encryptSecret()` vor `settingsRepo.set()`; GET liefert nur `…Set: true/false`.
3. Quelle ehrlich anzeigen (`db`/`env`/`none`).
4. Schreibpfad: admin + Passwort-Step-up + Audit-Action + Rate-Limit.
5. Läuft der Wert in einem Singleton/Cache → beim Boot UND nach PUT anwenden (Muster `wazuhConnectionApplier.js`).
