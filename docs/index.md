# Nexora SOC — Dokumentation

!!! abstract "Was ist Nexora SOC?"
    Eine **self-hosted SOC-Orchestrierungsplattform für Tier 1–3**: Incident-Ticketing,
    Threat Hunting (MITRE-gemappt), Evidence & Chain-of-Custody, Threat-Intel-Anreicherung
    (VirusTotal/AbuseIPDB), KI-Triage mit **Human-Approval** und Live-Telemetrie aus dem
    Wazuh-Indexer. Nexora *konsumiert und korreliert* SIEM-Daten — **kein** SIEM-/EDR-Ersatz,
    keine automatische Bedrohungsentfernung.

Nexora sitzt *über* den vorhandenen Sicherheitswerkzeugen (Wazuh, QRadar, Splunk) und macht aus
deren rohen Alerts nachvollziehbare, angereicherte, priorisierte Vorgänge — „Tickets", die ein
Analyst effizient bearbeiten kann. Kritische Aktionen bleiben Human-in-the-loop, rollenbasiert
freigabepflichtig, auditierbar und rückrollbar.

```
Rohdaten  →  Adapter  →  Ticket  →  Anreicherung  →  KI-Analyse  →  Entscheidung  →  Report
(SIEM)       (Validierung  (normali-   (Threat-Intel,   (Vorschlag     (Mensch gibt      (PDF/CSV,
             + Normali-    siert,       Host-Kontext,    mit Belegen)   frei, Audit,      Chain of
             sierung)      dedupl.)     MITRE-Mapping)                  rückrollbar)      Custody)
```

---

## Schnelleinstieg

Die Doku folgt drei Säulen — **Was das System macht · Wie man es installiert · Wie man es administriert:**

<div class="grid cards" markdown>

-   :material-lightbulb-on-outline: __Was Nexora macht__

    ---

    Kompakter, bebilderter Überblick über Ablauf und Bausteine.

    [:octicons-arrow-right-24: Überblick](ueberblick/index.md) ·
    [Produkt & Funktionsumfang](00-overview/produkt-erklaerung.md) ·
    [Feature-Status](00-overview/feature-status.md)

-   :material-download-outline: __Installieren__

    ---

    Dev-Setup, Docker-Stack, Produktion (nginx + TLS), Migrationen.

    [:octicons-arrow-right-24: Installation](03-admin-guide/installation.md) ·
    [Admin-Guide](03-admin-guide/README.md)

-   :material-tune-variant: __Administrieren__

    ---

    Jede Einstellung mit Screenshot: Benutzer & Rollen, Integrationen,
    Sicherheit/MFA/SSO, KI-Agent, Autonomie, Provisioning.

    [:octicons-arrow-right-24: Administration](administration/index.md)

-   :material-monitor-dashboard: __Bedienen (Konsole)__

    ---

    Der komplette Analysten-Workflow und jede Seite der Oberfläche.

    [:octicons-arrow-right-24: User-Guide](02-user-guide/user-guide.md)

-   :material-radar: __Detection & Hunting__

    ---

    Erkennungsregeln, MITRE-Mapping und der Threat-Hunt-Katalog.

    [:octicons-arrow-right-24: Detection & Threat Hunting](detection/index.md)

-   :material-sitemap-outline: __Architektur__

    ---

    arc42, Korrelations-Datenmodell, KI-/LLM-Architektur, ADRs.

    [:octicons-arrow-right-24: Architektur-Übersicht](01-architecture/README.md) ·
    [Entscheidungen (ADR)](adr/decisions.md)

</div>

---

## Für wen ist diese Doku?

| Rolle | Startpunkt |
|---|---|
| **Entscheider / Evaluator** | [Was Nexora macht](ueberblick/index.md) + [Produkt & Funktionsumfang](00-overview/produkt-erklaerung.md) |
| **Analyst (Tier 1–2)** | [User-Guide](02-user-guide/user-guide.md) + [Seiten-Referenz](02-user-guide/pages/Dashboard.md) |
| **Engineer (Tier 3)** | [Detection & Hunting](detection/index.md), [Use-Case-Developer](02-user-guide/pages/UseCaseDeveloper.md) |
| **Admin / Betrieb** | [Administration](administration/index.md), [Installation](03-admin-guide/installation.md), [Betrieb](07-operations/README.md) |
| **Entwickler** | [Developer-Guide](04-developer-guide/developer-guide.md), [API-Referenz](04-developer-guide/api-reference.md), [ADRs](adr/decisions.md) |

!!! tip "Sprache umschalten"
    Diese Website ist zweisprachig angelegt (Deutsch primär). Über den Sprachumschalter
    oben rechts lässt sich zwischen **Deutsch** und **English** wechseln. Noch nicht übersetzte
    Seiten werden in der englischen Fassung automatisch auf Deutsch angezeigt.

---

## Kanonische Quellen

Für den jeweils **aktuellen** Stand sind diese versionierten Dateien maßgeblich — die restliche
Doku beschreibt Konzepte und Stände zum Redaktionszeitpunkt:

- **[Feature-Status-Matrix](00-overview/feature-status.md)** — was implementiert/getestet ist
- **[Roadmap](08-roadmap/README.md)** — Phasen & Zielbild
- **[Architecture Decision Records](adr/decisions.md)** — alle Architekturentscheidungen
