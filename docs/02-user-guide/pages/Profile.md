# Profil (`/profile`)

## Zweck
Eigenes Benutzerkonto verwalten: persönliche Daten, Passwort, Anzeige-Einstellungen, MFA, Passkeys und API-Tokens — Self-Service.

## Rolle & Sichtbarkeit
Nav-Gruppe **Account**. Für alle angemeldeten Rollen (reine Selbstverwaltung).

## Funktionen
- **Profil-Kopf:** Avatar (Initialen), Name, Rolle, E-Mail, Beitritt, letzte Anmeldung.
- **Persönliche Daten:** Vor-/Nachname, E-Mail (read-only), Telefon, Sprache, Datumsformat → Speichern.
- **Passwort ändern:** Policy (8+ Zeichen, Groß-/Kleinbuchstabe, Ziffer, Sonderzeichen). *(Hinweis: Der erzwungene Wechsel beim Erstlogin nutzt dieselbe `changePassword`-API — siehe [Login](Login.md).)*
- **Anzeige:** Theme (Dunkel/Hell/System) → localStorage + Server-Persistenz.
- **MFA/TOTP** (wenn `MFA_ENABLED`): Enrollment + Recovery-Codes.
- **Passkeys/WebAuthn** (wenn aktiviert): Selbstverwaltung.
- **API-Tokens** (wenn `API_TOKENS_ENABLED`): anlegen/widerrufen.
- **Geplant:** aktive Geräte & Sitzungen.

## Datenquellen (Backend)
- `profileApi.getProfileWithFeatures()`, `profileApi.updateProfile()`, `authApi.changePassword()`, MFA-/WebAuthn-/Token-APIs.

## Verknüpfungen zu anderen Seiten
- **Verwandt:** [Login](Login.md) (MFA/Passkey-Enrollment wirkt dort), [Settings](Settings.md) (org-weite Sicherheits-Policies, die hier greifen).

## Zustände
- Lade-Spinner; Erfolgs-/Fehler-Feedback je Aktion; Feature-Abschnitte erscheinen nur, wenn das jeweilige ENV-Gate aktiv ist (sonst ausgeblendet, kein Fake).
