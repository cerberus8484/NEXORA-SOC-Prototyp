# Master-Roadmap — Nexora SOC (Stand 2026-06-26)

Synthese aus der vollständigen System-Durchleuchtung: Seiten-Verdrahtung, Code-/Security-Scan und
allen offenen Punkten dieser Arbeitssession. **Priorisiert in P0–P3.**

---

## 0. Gesamtbild
- **Produktiv & stabil:** Nexora-SOC + Data-Plane (3 live Pull-Quellen: Cowrie/Suricata/Wazuh) auf der nexora-VM (KVM/Proxmox), 7 Container.
- **Code-Gesundheit gut:** typsicher, keine kritischen Security-Sinks. Die echten Schulden sind **Release-Hygiene + Feature-Lücken + Doku-Pflege**, weniger fehlender/kaputter Code.

## 1. Code-/Security-Scorecard (Scan 2026-06-26)
| Check | Ergebnis |
|---|---|
| TypeScript (FE `tsc --noEmit`) | ✅ **0 Fehler** |
| ESLint (FE) | ✅ **0 Errors, 0 Warnings** (A11y-Pass erledigt 2026-06-26: a11y-Handler/Rollen + stabile React-Keys; `lib/a11y.ts` `onActivateKey`-Helper) |
| XSS-Sinks (`dangerouslySetInnerHTML`/`innerHTML`/`eval`/`Function`) | ✅ **keine** |
| Shell-Injection (`child_process`/`exec`) | ✅ keine — nur validierter SSH-`spawn` (Args geprüft, kein Shell), alle `.exec(` = Regex |
| Hardcoded Secrets | ✅ keine in Prod-Code (nur Test-Fixtures/Smoke) |
| SQL-Injection | ✅ keine — parametrisiert (`$1/$2`, Werte in `params`) |
| `npm audit` FE | ⚠️ 6 Vulns (2 critical/1 high/3 mod) — **alle Dev/Test** (`vite-node`/`vitest`), nicht Prod-Runtime |
| `npm audit` BE | ⚠️ 17 moderate — **alle Dev/Test** (`babel-jest`/`@jest/transform`) |
| Backend-Lint | — kein `lint`-Script konfiguriert |

## 2. Seiten-Verdrahtung (26 Seiten)
**Alle Seiten ziehen echte APIs/Hooks — keine tote/Stub-Seite.** Offene Punkte sind *Features innerhalb* von Seiten:
| Seite | Lücke (Feature, nicht Seite) |
|---|---|
| ThreatHunts / HuntConsole | Hunt-Pause → `501` (synchroner Runner) |
| AnalysisPage | „Agent Commands · Coming Soon" (Remote-Channel, bewusst out-of-scope) |
| HostsPage | „Add Host"/Enrollment ❌ (Wazuh-write-Entscheidung) |
| CorrelatorsPage | Apply-Kanal inert (`CONFIG_APPLY_ENABLED=false`) |
| SettingsPage | OIDC-Login ✅ live; In-UI-Admin-Konfig + SAML offen |
| global | A11y partial (s. 139 Warnings) · Keyboard-Shortcuts ❌ |

---

## P0 — Sofort / Hygiene (billig, hoher Klarheits-/Risikowert)
1. **PR #2 mergen** (`p-phase0-close → main`, 134 Commits) → `main` einholen + **Branch-Schutz** reaktivieren.
2. **PAT `ghp_XSE…` widerrufen** (GitHub-Web) · **Session-Backup off-machine** kopieren.
3. **Dev-Deps updaten** (`vitest`/`vite-node`, `babel-jest`) → `npm audit`-Vulns (Dev) weg. Kein Prod-Runtime-Risiko, aber Supply-Chain-Hygiene.

## P1 — Klar abgegrenzte Features (mittel, hoher Nutzen)
4. ~~**A11y-Pass** — die eslint-Warnings abbauen~~ ✅ **ERLEDIGT 2026-06-26**: 134 Warnings → 0 (klug-Hybrid). Echte Defekte (`jsx-key`/`no-console`/`unused`) sauber gefixt, 48 a11y-Stellen (Keyboard-Handler/ARIA-Rollen bzw. begründete Disables für Modal-Backdrops/Toasts), 56 React-Keys auf stabile IDs (Index nur noch bei index-adressierten/statischen Listen mit Begründung), 8 hook-deps (useMemo/useCallback-Kapselung). Neuer Helper `lib/a11y.ts`.
5. ~~**Keyboard-Shortcuts**-Layer (global)~~ ✅ **ERLEDIGT 2026-06-26**: `features/shortcuts/` — Leader-Navigation (`g` dann Taste → 13 Seiten), Direkt-Aktionen (`?` Hilfe-Overlay, `n` neues Ticket [RBAC-gated], `[` Sidebar-Toggle). Pures testbares Modell (`shortcutModel.ts`, 16 Tests), `useKeyboardShortcuts`-Hook (ignoriert Eingabefelder/Modifier, Leader-Timeout), barrierearmes Help-Overlay (`useFocusTrap`/ESC). In `AppShell` gemountet. **Offen:** Browser-Verifikation (keine Preview-Config — Unit-getestet).
6. **OIDC In-UI-Admin-Konfig** (Issuer/Client via UI statt ENV) **+ SAML** — 🟡 **Backend-Foundation ERLEDIGT 2026-06-26**: `oidcConfigService` (effektive Config aus `platform_settings` `oidc_*` mit ENV-Fallback; Client-Secret verschlüsselt at-rest via `secretsCrypto`, nie im GET); `OidcService`/`oidcInstance` lesen Config jetzt **dynamisch** (`getConfig`-Provider, abwärtskompatibel); Admin-Routen `GET/PUT /settings/oidc` (maskiert, Joi, Audit ohne Secret, „enabled nur wenn vollständig") + `POST /settings/oidc/test` (Discovery-Probe); `/auth/oidc/status`+Gate lesen `enabled` aus effektiver Config. Tests grün (oidcConfigService 7, oidcService 15, oidcRoute 16, oidcSettings 11). **Frontend-Admin-UI ✅** (`OidcSettingsCard` im Sicherheits-Tab: Issuer/Client/Secret[maskiert]/RedirectUri/Scope/Rolle/Signup/Aktivieren + „Verbindung testen"; `oidcAdminApi` 5 Tests; Platzhalter ersetzt). **OFFEN nur noch:** **SAML** (separater Block: node-saml/SP-Cert/ACS) + Browser-Verifikation (keine Preview-Config).
7. **OPNsense-WAN-Scope** (Folge-Design): nur extern-eingehende Blocks + Broadcast/Multicast-Ausschluss (multi-grep oder Collector-Action/Interface-Gate) — die Pull-Quelle ist *pausiert*, Capability steht.
8. **Update-Pull / Desired-State** (ADR zuerst): jedes System holt Config/Version aus Nexora; baut auf Apply-Channel + Enrollment. Der strategische „von Nexora bis OS-Ebene"-Schritt.

## P2 — Größere Blöcke (eigene Pläne)
9. **Hunt-Pause** → async/resumable Runner-Re-Architektur.
10. **Hosts-Enrollment** (Wazuh-write-Entscheidung) + **Agent-Commands** (Remote-Command-Kanal, Scope-Entscheidung).
11. **QRadar echter API-Client** (heute Mock) · **ExternalTicketAdapter** (outbound, nur Vertrag) · **Credential-Rotation** (Provisioning) · **NIS2 P_NIS2_3**.
12. **KI P19c/d** — lokales Modell + kontinuierliches Lernen (Vollausbau, aktuell 40 %).
13. **Horizontale Skalierung / HA** — mehrere Outbox-Worker/Hubs über mehrere VMs (`SKIP LOCKED` ist vorbereitet) + Intake-Replicas + signierte Updates.

## P3 — Horizont
14. Auto-Response-Actions (isolate host) · Multi-SIEM-Unified-Dashboard · Mobile-App · SOAR (bidirektional) · Multi-Tenancy · Zero-Trust-Access (Track vorbereitet: ADR-038) · ML-Model-Training (MLE-Track vorbereitet: ADR-039).

---

## Doku-Schuld (laufend)
- `feature-status.md` neigt zum **Unterschätzen** des Ist-Stands (Stale-Deploy-Flags + OIDC-Login fälschlich „offen" — beide diese Session korrigiert). Bei jedem Feature: Status **gegen den Code** pflegen.
- conntrackCollector.js ungenutzt (abgelöst) — optional entfernen.

> Quellen dieser Roadmap: Schulden-Report (`schulden-report-2026-06-26.md`), Data-Plane-Inventar, ADR-035/036, operator-privater INFRA-CHANGELOG, sowie der Code-/Security-Scan vom 2026-06-26.
