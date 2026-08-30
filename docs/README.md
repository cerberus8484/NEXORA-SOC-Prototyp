# Dokumentations-Index — Nexora SOC

> 🌐 **Die Dokumentation ist eine durchsuchbare Website (MkDocs Material)** mit Sidebar,
> Volltextsuche und Sprachumschalter (DE/EN). Das ist die primäre Art, die Doku zu lesen.
> Konfiguration: [`mkdocs.yml`](../mkdocs.yml) (Repo-Wurzel).
>
> ```bash
> python -m pip install -r requirements-docs.txt
> python -m mkdocs serve      # → http://127.0.0.1:8000
> python -m mkdocs build      # → statische Site nach ./site/
> ```
>
> Diese Datei ist nur der **Repo-seitige Index** (nicht Teil der gebauten Website). Alle Links
> unten zeigen ausschließlich auf Markdown-Quellen — keine separaten HTML-Dateien.

## Struktur (drei Säulen)

| Bereich | Inhalt |
|---|---|
| **Was Nexora macht** | [Überblick](./ueberblick/index.md) · [Produkt & Funktionsumfang](./00-overview/produkt-erklaerung.md) · [Feature-Status](./00-overview/feature-status.md) |
| **Installieren** | [Installation](./03-admin-guide/installation.md) · [Admin-Guide](./03-admin-guide/README.md) |
| **Administrieren** | [Administration](./administration/index.md) — alle Einstellungen mit Screenshots |
| **Bedienen** | [User-Guide](./02-user-guide/user-guide.md) + Seiten-Referenz |

## Weitere Sektionen

- **[01-architecture](./01-architecture/README.md)** — arc42, Korrelations-Datenmodell, LLM-Architektur, ML, Deployment-Center
- **[detection](./detection/index.md)** — Erkennungsregel-Katalog & Threat-Hunt-Katalog
- **[05-security](./05-security/README.md)** — Bedrohungsmodelle & Reviews
- **[06-integrations](./06-integrations/README.md)** — QRadar & weitere Integrationen (Referenz)
- **[07-operations](./07-operations/README.md)** — Betrieb, Netzwerk & Lab
- **[04-developer-guide](./04-developer-guide/README.md)** — Developer-Guide, API-Referenz
- **[adr/decisions.md](./adr/decisions.md)** — Architecture Decision Records

## Kanonische Quellen (Repo-Wurzel)

- **[ROADMAP.md](../ROADMAP.md)** — Phasen & Zielbild
- **[CHANGELOG.md](../CHANGELOG.md)** — Änderungen je Release
- **[00-overview/feature-status.md](./00-overview/feature-status.md)** — Feature-Status-Matrix
