# Security Policy

Nexora SOC ist ein Sicherheits-Werkzeug — verantwortungsvoller Umgang mit
Schwachstellen ist uns wichtig. Danke, dass du Probleme verantwortungsvoll meldest.

## Unterstützte Versionen

| Version | Status | Sicherheits-Fixes |
|---|---|---|
| `main` (aktueller Pilot) | aktiv entwickelt | ✅ |
| ältere Commits / Tags | — | ❌ (bitte auf `main` aktualisieren) |

Das Projekt ist im **Pilot-Stadium**. Es gibt **keine** stabile Release-/LTS-Linie;
Fixes landen auf `main`.

## Eine Schwachstelle melden (Responsible Disclosure)

- **Bitte KEINE öffentlichen GitHub-Issues** für Sicherheitslücken — und keine
  Exploit-Details, PoCs oder Reproduktionsschritte öffentlich posten.
- Melde stattdessen privat über einen der folgenden Wege:
  - **GitHub Security Advisory** (bevorzugt): Repo → *Security* → *Report a vulnerability*
  - **E-Mail:** `security@example.com` *(Platzhalter — durch echte Projektadresse ersetzen)*
- Bitte gib an: betroffene Komponente/Datei, Auswirkung, Voraussetzungen und
  — falls vorhanden — einen minimalen, **privat** geteilten Reproduktionsweg.

## Was du erwarten kannst

- **Bestätigung des Eingangs**, sobald wir die Meldung gesehen haben.
- Eine **ehrliche Einschätzung** (Schweregrad, ob/wann ein Fix kommt).
- **Keine SLA-Garantie** — dies ist ein Open-Source-Pilot ohne kommerziellen Support.
  Wir bemühen uns aber um zeitnahe, verantwortungsvolle Bearbeitung.
- **Koordinierte Offenlegung:** Wir stimmen einen Zeitpunkt für die Veröffentlichung
  ab, nachdem ein Fix verfügbar ist. Credit gerne, wenn gewünscht.

## Geltungsbereich (Scope)

**Im Scope:** Code in diesem Repository (Backend-API, Frontend, Deployment-Konfiguration,
Auth/RBAC/Audit, Integrations-Adapter).

**Außerhalb des Scopes:**
- Schwachstellen in Dritt-Abhängigkeiten (bitte beim jeweiligen Upstream melden;
  Hinweise auf nötige Versions-Bumps sind aber willkommen).
- Fehlkonfigurationen einer **eigenen** Installation (z. B. schwache Secrets,
  fehlendes TLS, offene Ports) — siehe Sicherheits-Checkliste in
  [`deploy/README.md`](deploy/README.md).
- Demo-/Mock-Daten im Frontend, die bewusst als solche markiert sind.

## Bekannte Grenzen (by design, keine Meldung nötig)

- Die **Hunt Console führt nichts remote aus** — Befehle werden als Datensätze
  gespeichert (Command-Queue-Modell). Das ist Absicht, kein Bug.
- Ohne `DB_ENABLED=true` laufen InMemory-Repositories — Daten sind dann flüchtig.
- Die JWT-Logout-Blocklist ist In-Memory (Tokens laufen über `JWT_EXPIRES_IN` ab).
