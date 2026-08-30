# Betrieb (Operations)

Dieser Bereich enthält Betriebsleitfäden, Administrationsverfahren und Infrastruktur.

## Inhalt

- **[Observability](./observability.md)** — Health, Metriken, Logging, Tracing
- **[Container-Limits](./container-limits.md)** — Ressourcengrenzen der Container
  - Status: vorbereitet, nicht automatisch als live ausgerollt annehmen
- **[Lasttest-Ergebnisse](./loadtest-results.md)** — Performance-/Lasttests
  - Wichtig: bisher dokumentierter Hauptlauf = InMemory-Szenario, kein echter Postgres-Go-Live-Loadtest
- **[Produktions-Readiness-Checkliste](./production-readiness-checklist.md)** — Go-/No-Go vor echtem Rollout
  - Trennt sauber zwischen lokaler Absicherung und live verifiziertem Produktionsnachweis

- **[Netzwerk & Lab](./network/README.md)** — Lab-Netz und Infrastruktur
  - Netzwerkarchitektur und Planung
  - Lab-Aufbau-Anleitungen
  - Windows-Domänen-Konfiguration (AD, DC, WEC)
  - Agent-Deployment und -Verwaltung

!!! note "Release-Historie"
    Die Versions-/Release-Notizen stehen in der kanonischen `CHANGELOG.md` im Repo-Wurzelverzeichnis
    (*Keep a Changelog* + SemVer).

---

**Siehe auch:** [Installation](../03-admin-guide/README.md) für Inbetriebnahme und Deployment.
