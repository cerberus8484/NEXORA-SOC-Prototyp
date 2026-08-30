# Login (`/login`)

## Zweck
Authentifizierung: Passwort, optional zweiter Faktor (MFA), Org-MFA-Setup, Passkeys und SSO/OIDC.

## Rolle & Sichtbarkeit
Öffentlich (unauthentifiziert). Einzige Seite ohne `RequireAuth`.

## Funktionen
- **Schritt 1 — Passwort:** E-Mail + Passwort → Validierung.
- **Schritt 2 — MFA-Challenge** (wenn der User aktive MFA hat): 6-stelliger TOTP-Code → Session.
- **Schritt 3 — MFA-Setup** (Org-Pflicht `MFA_ENABLED` + `mfaRequired`, wenn User noch keine MFA hat): Secret + otpauth-URI → Bestätigung → Recovery-Codes.
- **Schritt 4 — Recovery-Codes:** einmalige Anzeige direkt nach dem Setup.
- **SSO/OIDC-Button** (wenn aktiviert): Weiterleitung zum IdP; SSO-Fehler werden aus `?error=` erkannt und angezeigt.
- **Passkey-Button** (wenn aktiviert): WebAuthn-Ceremony → Session-Cookie.
- **Erzwungener Passwortwechsel** *(nach erfolgreichem Login, über `RequireAuth`)*: Greift bei **Passwort-Ablauf** (Policy) ODER bei der **Erstanmeldung** des Bootstrap-Admins mit temporärem Passwort (`mustChangePassword`). Voll-Screen-Gate, nicht überspringbar — Titel „Erstanmeldung — Passwort festlegen" bzw. „Passwort abgelaufen".

## Datenquellen (Backend)
- `authApi.login()`, `authApi.beginMfaSetup()` / MFA-Verify, `authApi.getOidcStatus()`, `webauthnLogin()`. Login liefert `user` inkl. `passwordExpired` und `mustChangePassword` → steuert das Gate.

## Verknüpfungen zu anderen Seiten
- **Navigiert zu:** [Dashboard](Dashboard.md) (nach erfolgreichem Login); jede geschützte Seite leitet hierher um, wenn keine Sitzung besteht.
- **Verwandt:** [Profil](Profile.md) (MFA/Passkey-Enrollment), [Settings](Settings.md) (org-weite Auth-Policies: Lockout, MFA-Pflicht, OIDC).

## Zustände
- Schrittweise Maske (Passwort → MFA → Setup → Recovery); Fehlermeldungen einheitlich (kein User-Enumeration); Lockout-Hinweis bei zu vielen Fehlversuchen; SSO-Fehlerbanner.
