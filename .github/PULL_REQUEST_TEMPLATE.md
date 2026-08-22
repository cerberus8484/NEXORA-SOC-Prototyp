<!--
Danke für den Beitrag! Bitte die Checkliste ausfüllen.
Hardrules (siehe CONTRIBUTING.md): keine Funktion ohne Test · kein externer Input ohne Validierung ·
keine Integration ohne Adapter · element.textContent statt innerHTML · neue Security-/KI-Kontrollen default-AUS.
-->

## Was & Warum

<!-- Kurz: welches Problem löst dieser PR? Warum so? -->

Closes #

## Art der Änderung

- [ ] 🐞 Bugfix
- [ ] ✨ Feature
- [ ] ♻️ Refactor (kein Verhaltenswechsel)
- [ ] 🔐 Security
- [ ] 📄 Doku
- [ ] 🧪 Tests / CI

## Checkliste

- [ ] Tests grün (`npm test` Backend **und** Frontend)
- [ ] Neue Logik ist getestet (TDD — Test zuerst)
- [ ] Keine Secrets/Tokens/PII im Code, in Logs oder in Tests
- [ ] Eingaben an Systemgrenzen validiert (Joi/Schema)
- [ ] Security-Check: keine neue Angriffsoberfläche (oder dokumentiert + default-aus)
- [ ] Privacy-Check: speichert der Code PII? (Audit-Log nur Feldnamen, keine Werte)
- [ ] README, INSTALL oder SECURITY aktualisiert, falls die Änderung es erfordert
- [ ] Commit-Message folgt `<type>: <beschreibung>` (feat/fix/refactor/docs/test/chore)

## Test-Plan

<!-- Wie wurde verifiziert? Befehle, Schritte, Live-Smoke. -->

## Screenshots (bei UI-Änderungen)
