# Nexora SOC — UI-Seiten-Referenz

Pro Seite eine Doku: **Zweck · Rolle & Sichtbarkeit · Funktionen · Datenquellen · Verknüpfungen · Zustände.**
Generiert aus dem echten Code (Stand 2026-06-30) — Stub/Mock-Funktionen sind ehrlich gekennzeichnet.

## Seiten nach Navigations-Gruppe

| Gruppe | Seiten |
|---|---|
| **Dashboard** | [Dashboard](Dashboard.md) |
| **Operations** | [Analyse-Deck](Analysis.md) · [Tickets](Tickets.md) · [Ticket-Editor](TicketEditor.md) · [Evidence Center](EvidenceCenter.md) |
| **Hunting** | [Threat Hunts](ThreatHunts.md) · [Hunt Console](HuntConsole.md) · [Hunt Library](HuntLibrary.md) |
| **Detection** | [Detection Library](DetectionLibrary.md) · [MITRE Coverage](MITRE.md) · [YARA Engine](YARA.md) · [Use-Case Developer](UseCaseDeveloper.md) |
| **Integrations** | [Kollektoren](CollectorsStatus.md) · [Data-Plane](DataPlane.md) · [Wazuh Dashboard](WazuhDashboard.md) · [QRadar Analysis](QRadarAnalysis.md) |
| **Monitoring** | [Hosts](Hosts.md) · [SOC-Metriken](SocMetrics.md) · [System & DB](SystemStatus.md) · [Audit-Log](AuditLog.md) |
| **Administration** | [Correlators](Correlators.md) · [KI Agent](KiAgent.md) · [ML-Evaluation](MlEval.md) · [Autonomy Policies](AutonomyPolicies.md) · [Provisioning](Provisioning.md) · [Settings](Settings.md) |
| **Compliance** | [NIS2 Readiness](Nis2Readiness.md) |
| **Account** | [Profil](Profile.md) · [Login](Login.md) |

## Wie die Seiten ineinandergreifen (Datenfluss + Navigation)

**Ingest → Ticket → Triage → Urteil → Report** ist die Hauptachse:

```
SIEM/Quellen ──Alerts──▶ Tickets ──Klick──▶ Analyse-Deck ──Urteil──▶ (Schließen / Report)
  Wazuh · QRadar · Data-Plane            (12 Tabs: Evidence, KI, IoCs, Notes …)
        │                                          │
        └── Evidence Center ◀── dieselben Items ───┘
```

- **Quellen → Tickets:** [Wazuh](WazuhDashboard.md), [QRadar](QRadarAnalysis.md) und die [Data-Plane](DataPlane.md)-Pipeline erzeugen automatisch Tickets. [Kollektoren](CollectorsStatus.md) zeigt, ob je Quelle echt etwas ankommt; [Data-Plane](DataPlane.md) zeigt die Live-Gesundheit der Korrelations-Pipeline.
- **Tickets → Analyse:** [Tickets](Tickets.md) ist der Einstieg; ein Klick öffnet das [Analyse-Deck](Analysis.md). Der [Ticket-Editor](TicketEditor.md) ändert Stammdaten/legt neu an.
- **Evidence quer:** Das [Evidence Center](EvidenceCenter.md) bündelt die Evidence-Items aller Tickets; im [Analyse-Deck](Analysis.md) erscheinen dieselben Items ticket-bezogen. Beide reichern über Threat-Intel an.
- **Hunting → Tickets/Evidence:** [Threat Hunts](ThreatHunts.md) / [Hunt Console](HuntConsole.md) erzeugen aus Findings Tickets und Evidence; [Hunt Library](HuntLibrary.md) startet Hunts per Klick.
- **Detection-as-Code:** [Detection Library](DetectionLibrary.md), [YARA](YARA.md), [MITRE](MITRE.md) und der [Use-Case Developer](UseCaseDeveloper.md) (Draft→Approve→Publish) definieren, was überhaupt erkannt wird.
- **KI:** Operative KI läuft im [Analyse-Deck](Analysis.md) (Tab „KI Analysis"); [KI Agent](KiAgent.md) ist die Admin-Konfiguration, [ML-Evaluation](MlEval.md) die advisory-only Routing-Schicht, [Autonomy Policies](AutonomyPolicies.md) die (gegatete) Autonomie-Steuerung.
- **Betrieb & Plattform:** [Hosts](Hosts.md), [System & DB](SystemStatus.md), [SOC-Metriken](SocMetrics.md), [Audit-Log](AuditLog.md) beobachten den Betrieb; [Provisioning](Provisioning.md), [Correlators](Correlators.md), [Settings](Settings.md) richten die Plattform ein.
- **Auth-Klammer:** [Login](Login.md) (inkl. erzwungenem Passwortwechsel bei Erstanmeldung/Ablauf) und [Profil](Profile.md) (Self-Service: Passwort, MFA, Passkeys, Tokens) gelten für alle Seiten; org-weite Auth-Policies kommen aus [Settings](Settings.md) → Sicherheit.

## Sichtbarkeits-Regel
Jede Seite nennt ihre `minRole`. Die Sidebar blendet Items unterhalb der Rolle aus (`visibleNavItems`) — das ist ein UX-Gate; die **Wahrheit erzwingt der Server** (`requireRole`).
