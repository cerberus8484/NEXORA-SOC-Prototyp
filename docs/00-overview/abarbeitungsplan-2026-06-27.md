# Abarbeitungsplan — geordnet, nach Verdrahtungs-Audit (Stand 2026-06-27)

> Quelle: System-weiter Verdrahtungs-Audit (4 parallele Read-only-Agents, dokumentiert in
> [agent-runs/AGENT-LOG.md](../agent-runs/AGENT-LOG.md)). Verdichtet die
> [offene-punkte-2026-06-26.md](offene-punkte-2026-06-26.md) um den realen Verdrahtungs-Stand.
>
> **Audit-Kernbefund:** Keine der 29 Seiten ist Attrappe; keine der 37 Routen ein toter Stub;
> 0 tote Frontend→Backend-Calls. Die „Lücken" sind zu ~70 % bewusst (gated / YAGNI / honest-planned).
> Echte, baubare Arbeit ist klein und klar abgegrenzt.

## Legende
- 🟢 **BAUBAR-JETZT** — vorhandenes Backend, klare Semantik, keine Entscheidung nötig.
- 🟡 **BRAUCHT-ENTSCHEIDUNG** — erst Schema-/Produkt-Entscheidung, dann kleiner Build.
- 🔴 **ARCHITEKTUR** — neues Subsystem/Infra, braucht ADR vor Bau.
- ⚪ **CLOSEOUT/DOKU** — kein oder trivialer Code.
- 🧑‍💻 **OPERATOR** — nur du (Ops/Infra), nicht von mir baubar.

---

## Phase A — Closeouts (⚪) — ✅ ERLEDIGT 2026-06-27
| # | Item | Ergebnis |
|---|------|----------|
| A1 | WebAuthn-„Lücke" | ✅ **Fehlalarm bestätigt** — voll verdrahtet (`webauthnLogin.ts` nutzt zentralen `api`-Client; `WebAuthnCard` in Profile+Settings). |
| A2 | `/config` ohne UI | ✅ **Bewusst backend-only** dokumentiert (Correlator-Config nutzt `/correlators/:id/config`). Kein spekulatives UI. |
| A3 | Memory `updateTicketStatus`/Export | ✅ Memory korrigiert — beide gegen Code verifiziert (Route + konkrete Adapter implementiert). |
| A4 | `offene-punkte` | ✅ Aktualisiert + verlinkt. (`feature-status.md`-Entstaubung bleibt eigener Punkt.) |
| A5 | `conntrackCollector.js` | ✅ **NICHT entfernt** — ist wählbarer `COLLECTOR_KIND` (`collectorMain.js:33`), kein Dead-Code. Doc korrigiert. |

## Phase B — Quick-Wins (🟢, TDD) — ✅ ERLEDIGT 2026-06-27
| # | Item | Umsetzung |
|---|------|-----------|
| B1 | **Create Follow-up Ticket** (OverviewRail) | ✅ `buildFollowUpTicket` (rein, 5 Tests) → `ticketApi.create` (parentId) → Editor. |
| B2 | **Add as Note** (KiAnalysisView Approval-Bar) | ✅ `appendNote`/`buildKiNoteText` (rein, 7 Tests) → `mutate({notes})`. |

> Beide TDD: reine Logik-Module zuerst (12 neue Tests grün), dann Handler durch Deck-Props.
> Regression: 373/373 in `features/analysis`+`features/tickets`, tsc grün.

## Phase C — Braucht-Entscheidung (🟡) — je 1 Entscheidung, dann kleiner Build
| # | Item | Stand |
|---|------|-------|
| C1 | „Mark as Important" (OverviewRail) | ✅ **ERLEDIGT 2026-06-27** — Entscheidung: `priority='high'`, nie herabstufen (`markImportantPriority`, rein/4 Tests). |
| C2 | „Needs More Context" (Agent-Approval) | ✅ **ERLEDIGT 2026-06-27** — Entscheidung: Re-Propose mit Notiz. Additiver `note`-Durchstich Route→Service→Prompt-Builder (3 Backend-Tests), Analyst-Hinweis-Eingabe in der Approval-Bar. AgentSuggestion-Schema unverändert. |
| C3 | Notification-Kanäle (NotificationsPanel) | ⏳ **Teilweise erledigt 2026-06-27** — Status-Anzeige war schon verdrahtet; neu: **Test-Versand** (`POST /notifications/test`, admin) + Button im Panel (`buildTestNotification`/`formatTestResult`, rein/getestet). Kanal-**Konfiguration** bleibt bewusst **ENV** (ADR-037, keine Secrets in DB) — kein UI-Config-Editor. E-Mail-Kanal live, sobald Mailserver-ENV gesetzt. |
| C4 | Hub↔Backend Live-Status-Brücke (Collectors `available:false`) | HTTP-Push vom Hub vs. DB-Poll. (grenzt an Architektur) |
| C5 | SettingsPage „geplant"-Toggles (CAPTCHA, Lockout-Notify, WebAuthn-Enforce, Settings-Export) | Pro Toggle: bauen oder entfernen. |
| C6 | ProfilePage „Aktive Geräte & Sessions" | Session-Tracking-Modell (Tabelle + Revoke). |

## Phase D — Architektur (🔴) — ADR zuerst, der Reihe nach
| # | Item | Kern-Entscheidung im ADR |
|---|------|--------------------------|
| D1 | Hunt-`Pause` → async Runner | Synchroner Runner → async Job/State (heute ehrlich 501). |
| D2 | Host-Enrollment („Add Host") | Wazuh-Agent-Enrollment-Flow + Token-Mint. |
| D3 | Analyst-Remote-Actions (Isolate/Block/Reset/Notify/Escalate) | Die SSH/permission-Remote-Exec-Vision — Command-Queue + Human-Approval. |
| D4 | Playbook-Zuweisung | Playbook-Engine (`analystState.playbook` ist im Schema, kein Runner). |
| D5 | Evidence-Export: Save-Template · Schedule · Redaction-Engine | Template-Store + Scheduler + Redaktions-Pipeline. |
| D6 | SAML-SSO | Nach OIDC der letzte SSO-Baustein (bounded, aber groß). |
| D7 | Correlators Edit-UI / Apply-Channel scharf | `CONFIG_APPLY_ENABLED` aktivieren — Threat-Model existiert. |
| D8 | QRadar API/ExternalTicket/Credential-Rotation/NIS2-P3 | je eigener Block. |
| D9 | KI P19c/d (lokales Modell + kontinuierliches Lernen) | Trainings-/Feedback-Schleife. |
| D10 | E2E (Playwright) | kritische Flows automatisieren. |
| D11 | HA/Skalierung | Multi-Instance, Sticky-Sessions, DB-Pool. |

## Parallel — Operator (🧑‍💻, nicht von mir baubar)
| # | Item |
|---|------|
| E1 | PR #2 mergen (p-phase0-close → main) + Branch-Schutz reaktivieren |
| E2 | Geleaktes PAT widerrufen + Off-box-Backup |
| E3 | `AUDIT_IP_SALT` in Prod-ENV → danach eskaliere ich zur Fail-fast |
| E4 | S4 known_hosts-Rollout → `COLLECTOR_SSH_STRICT_HOST_KEY=yes` |
| E5 | S6 Vite-Major (eigener Branch) |
| E6 | Browser-Verifikation (Docker-Dev-Stack) |

---

## Empfohlene Reihenfolge
**A (Closeouts) → B (Quick-Wins) → C (Entscheidungen, je einzeln) → D (Architektur, ADR-getrieben).**
E läuft parallel auf deiner Seite. Phase A+B kann ich ohne weitere Rückfrage am Stück liefern;
C braucht je 1 kurze Entscheidung; D je 1 ADR-Freigabe.
