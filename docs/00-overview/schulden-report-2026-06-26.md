# Schulden-Report — System-Durchleuchtung 2026-06-26

Vollständige Bestandsaufnahme offener Schulden/Lücken. Methodik: kanonische `feature-status.md`-Matrix
**gegen den Code verifiziert** (alle 26 Frontend-Seiten, TODO/FIXME/stub/`501`-Marker im ganzen Code,
Test-Skips = keine, Doku-Aktualität, `main`-vs-`p-phase0-close`).

> Ergebnis: Der Code bestätigt die Matrix — keine versteckten Stub-Überraschungen. Die größten realen
> Schulden sind **Doku-Stale** + ein **großer offener Branch-Merge**, nicht fehlender Code.

---

## 1. Frontend-Seiten mit Schulden
| Seite | Schuld | To-do |
|---|---|---|
| ThreatHunts / HuntConsole | Hunt-Pause → `501 NOT_SUPPORTED` (Runner synchron) | Async/resumable Runner-Re-Architektur (großer Block); aktuell ehrlich gegated |
| AnalysisPage | „Agent Commands · Coming Soon" | Remote-Command-Kanal — bewusst out-of-scope (Agent-read-only) |
| HostsPage | „Add Host"/Enrollment ❌ | Braucht Wazuh-write → no-touch-Entscheidung |
| SettingsPage | SSO/OIDC-UI fehlt (Backend `auth/oidc/*` da) + SAML | OIDC-Login-UI bauen |
| CorrelatorsPage | Apply-Kanal inert (`CONFIG_APPLY_ENABLED=false`) | Gated Apply-Channel = eigener Security-Block |
| global | Accessibility (ARIA) partial · Keyboard-Shortcuts ❌ | A11y-Pass + Shortcut-Layer |

Sauber: Dashboard, Tickets, Evidence, Detection, YARA, KI-Agent, NIS2, Provisioning(View), Audit, Profile, MITRE, SystemStatus, SocMetrics, WazuhDashboard, QRadarAnalysis, UseCaseDeveloper, AutonomyPolicies.

## 2. Backend / Feature-Schulden
- QRadar-API-Client = Mock/Stub (nur Inbound real); ExternalTicketAdapter = nur Vertrag (P12.1).
- Credential-Rotation ❌ (Folgeblock) · NIS2 P_NIS2_3 ❌ · KI P19c/d (lokales Modell + kont. Lernen) 🔶 40 %.
- FP-rule-Auto-Apply ⚠️ (hinter Flag, by design) · Auto-Response-Actions ❌ · Multi-SIEM-Dashboard ❌.

## 3. Data-Plane (aktueller Block)
- OPNsense-Firewall — Pull-Capability + quellseitiger `filter` (`tail|grep`) gebaut (commit `2a0146b9`). **Live gemessen (2026-06-26):** `filter=block` liefert ausschließlich LAN-Broadcast/Multicast-Rauschen (`192.168.x→.255` NetBIOS, `224.0.0.22` IGMP) → **pausiert** (nicht in den Prod-Ticket-Strom geshippt). Echte Quelle braucht **WAN/extern-Scope + Broadcast-Ausschluss** (multi-stage grep oder ein Action/Interface-Gate im opnsenseCollector). Der `sshTail`-Filter bleibt als wiederverwendbare Capability.
- Update-Pull / Desired-State — nicht gebaut (Control-Plane, eigenes ADR + Security).
- Horizontale Skalierung / HA / signierte Updates — Horizont.
- `conntrackCollector.js` ungenutzt (abgelöst, Fallback) — optional entfernen.

## 4. ⚠️ Doku-Schulden
- **`feature-status.md` veraltet:** „NICHT deployt"-Flags für Features, die laut Deploy-Record live sind
  (P_PROVISION_SECURITY_1, P_NIS2_2, P_CORR_1-Frontend); Header-Behauptung „Deploy-Gap PR#1 noch nicht live"
  ist überholt; „Last Updated"-Footer ≠ Header-Datum; **Data-Plane fehlt in den Feature-Tabellen**.
- P_CORR_1 Pre-Deploy-Gates ⏳ — längst erledigt (live), Doku stale.

## 5. ⚠️ Git/Release-Schuld
- **134 Commits auf `p-phase0-close`, NICHT in `main`.** Prod läuft direkt von `p-phase0-close`; `main` weit
  hinterher → großer offener Merge/PR `p-phase0-close → main` (oder Rolle von `main` klären). main-Branch-Schutz
  nach Force-Push reaktivieren.

## 6. Betriebs-Hygiene
- PAT `ghp_XSE…` im GitHub-Web widerrufen · Session-Backup off-machine kopieren.

---

## Empfohlene Reihenfolge
1. `feature-status.md` aktualisieren (Stale-Flags + Data-Plane-Sektion) — *die echteste Schuld, billig*.
2. PR `p-phase0-close → main` (134 Commits einholen).
3. PAT revoke + Backup off-machine (Hygiene).
4. Feature-Wahl: OIDC-Login-UI · Data-Plane (OPNsense/Update-Pull) · Hunt-Pause-Re-Architektur.
