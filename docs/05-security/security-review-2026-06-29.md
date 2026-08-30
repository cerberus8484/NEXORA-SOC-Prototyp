# Security/Privacy Review - 2026-06-29

Scope: Auth, Audit-Logs, Threat-Intel-Adapter, KI-Triage und ausgewaehlte API-Routen.

## Kurzurteil

Grad: Gruen

Die Kernkontrollen sind fuer ein SOC-Tool solide umgesetzt: Auth verwendet HttpOnly-Cookies
mit CSRF-Schutz, Audit-Exports sind begrenzt und pseudonymisiert, KI-Triage bleibt
Human-in-the-loop. Eine konkrete Berechtigungsluecke wurde geschlossen: Viewer koennen
keine externen Threat-Intel-Enrichments mehr ausloesen.

## Gepruefte Bereiche

- Auth: `authenticate`, `csrfGuard`, Auth-Cookies, Login/MFA, JWT-Secret-Handling.
- Audit: IP-HMAC, Export-Grenzen, Audit-Event-Metadaten, Role-Gates.
- Threat Intel: Enrichment-Route, Provider-Adapter, Cache, Input-Validierung.
- KI-Triage: Vorschlagslogik, Confidence-Floors, Approval/Reject-Flow.
- API-Routen: oeffentliche Ausnahmen wie Health, Metrics, OIDC und Data-Plane.

## Ergebnis und Fixes

- `POST /api/v1/threat-intel/enrich` ist jetzt Analyst+ (`requireRole('analyst')`).
- Indicator-Werte werden vor Cache/Provider-Zugriff auf Typ, Format und 2048 Zeichen begrenzt.
- Domain- und URL-Indikatoren haben explizite syntaktische Validierung.
- Login/MFA/MFA-Setup liefern Session-JWTs in Produktion nicht mehr automatisch im JSON-Body.
  `AUTH_RETURN_TOKEN_JSON=true` bleibt als expliziter Kompatibilitaetsmodus fuer alte
  Bearer-Header-Clients verfuegbar; Browser-Clients nutzen das httpOnly-Cookie.
- Tests decken Viewer-403, ungueltige Domain/URL und ueberlange Werte ab.

## Restrisiken

- Wenn `AUTH_RETURN_TOKEN_JSON=true` in Produktion aktiviert wird, erhalten kompatible
  API-Clients den Session-JWT weiterhin im Response-Body. Das sollte nur fuer bekannte
  Altclients genutzt und mittelfristig durch PATs oder Cookie-Flow ersetzt werden.
- Externe Provider erhalten bei Analyst+-Aktionen weiterhin IOCs. Das ist fachlich gewollt,
  muss aber operatorseitig bewusst konfiguriert werden.

## Naechster sauberer Schritt

- API-Referenz fuer Threat Intel mit Rollenmatrix ergaenzen.
- Optional: separate Permission `threat_intel:enrich`, falls spaeter feinere RBAC-Grenzen
  als Rollen gebraucht werden.
- Fuer den Langfrist-Block `Zero-trust access` liegt jetzt ein Architektur-/Security-Track
  vor: `ADR-038` plus `docs/05-security/zero-trust-access-plan.md`.
