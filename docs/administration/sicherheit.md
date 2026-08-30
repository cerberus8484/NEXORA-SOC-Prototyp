# Sicherheit einstellen — Schritt für Schritt

Für die meisten Leute gedacht, die sich mit Technik nicht auskennen.

---

## Passwort-Regeln

**Was ist das?** Vorgaben, wie schwer dein Passwort sein muss.

**Wozu?** Damit niemand ein zu einfaches Passwort setzt.

**So stellst du es ein:**

1. Gehe zu **Einstellungen** (Zahnrad oben rechts)
2. Wähle den Reiter **Sicherheit**
3. Scrolle zu „Passwort- und Sitzungsrichtlinie"
4. Du siehst diese Schieber/Felder:

| Was | Stelle es so ein |
|-----|------------------|
| **Mindestlänge** | z.B. auf 10 (Passwort muss mindestens 10 Zeichen lang sein) |
| **Komplexität** | z.B. auf „Hoch" (Groß- und Kleinbuchstaben + Zahlen + Sonderzeichen wie !@# erforderlich) |
| **Passwort verfällt nach (Tagen)** | z.B. auf 90 (jedes Passwort muss nach 90 Tagen geändert werden) |
| **Letzte X Passwörter sperren** | z.B. auf 5 (man kann nicht einfach sein altes Passwort wiederverwenden) |

5. Klick oben rechts auf **Speichern**

**Wenn es nicht klappt:**
- „Gespeichert"? Dann hat es funktioniert.
- Feld wird rot? Du hast ein Wert eingestellt, der zu groß oder zu klein ist. Probiere einen anderen Wert.

---

## Sitzungen (wie lange man eingeloggt bleibt)

**Was ist das?** Die Zeit, die du eingeloggt bleiben darfst, bevor das System dich automatisch abmeldet.

**Wozu?** Damit ein fremder nicht an deinem verlassenen Computer arbeiten kann.

**So stellst du es ein:**

1. Gehe zu **Einstellungen** → **Sicherheit**
2. Scrolle zu „Sitzungs-Richtlinie"
3. Stelle diese Werte ein:

| Was | Stelle es so ein |
|-----|------------------|
| **Max. Sitzungsdauer (Stunden)** | z.B. auf 4 (nach 4 Stunden inaktiv → automatisch abgemeldet) |
| **Inaktivität (Minuten)** | z.B. auf 30 (wenn 30 Min. lang nichts passiert, abgemeldet) |

4. Klick **Speichern**

---

## Zwei-Faktor-Authentifizierung (MFA)

**Was ist das?** Ein zweiter Login-Code aus einer Handy-App (wie Google Authenticator). Nur Passwort reicht nicht — man braucht auch noch den 6-stelligen Code.

**Wozu?** Wenn jemand dein Passwort klaut, kommt er trotzdem nicht rein, weil er auch dein Handy brauchte.

**Du (als Admin) kannst es zur Pflicht machen:**

1. Gehe zu **Einstellungen** → **Sicherheit**
2. Scrolle zu „Zwei-Faktor-Authentifizierung"
3. Stelle den Toggle **„MFA für alle Nutzer erforderlich"** auf **AN**
4. Klick **Speichern**
5. Das System fragt dich nach deinem Passwort — gib es ein (Schutz)
6. Klick **Bestätigen**

**Wenn Nutzer es einrichten:**

1. Sie loggen sich ein wie normal (Passwort)
2. Ein Modal-Fenster erscheint: „Zwei-Faktor-Setup"
3. Sie öffnen ihre Authentificator-App (Google Authenticator, Authy, Microsoft Authenticator — egal welche)
4. Sie scannen den QR-Code mit der App ab
5. Sie geben den 6-stelligen Code ein, den die App zeigt
6. Sie speichern die Recovery-Codes (kleine Codes für den Notfall, wenn das Handy weg ist) an einem sicheren Ort
7. Fertig

**Wenn es nicht klappt:**
- „Recovery-Codes verloren"? Der Admin kann die Zwei-Faktor für diesen Nutzer zurücksetzen.
- „QR-Code zu klein"? Nutzer kann die Kamera näher heran oder den langen Text statt QR-Code in der App eingeben.

---

## Zentraler Login (SSO / OIDC)

**Was ist das?** Statt sich direkt bei Nexora anzumelden, kann der Nutzer sein Firmen-Konto oder einen zentralen Dienst wie Keycloak benutzen. Nur eine Anmeldung für alles.

**Wozu?** Zentraler Überblick, wer wo arbeitet. Nutzer merken sich ein Passwort statt vielen.

**So aktivierst du es (für Keycloak als Beispiel):**

1. Gehe zu **Einstellungen** → **Sicherheit**
2. Scrolle zu „Single Sign-On (OIDC)"
3. Folgende Felder ausfüllen (du bekommst diese Werte von deinem Keycloak-Admin):

| Feld | Beispiel | Was ist das? |
|------|----------|-------------|
| **Issuer** | `https://keycloak.example.local/realms/soc` | Die Webadresse des zentralen Diensts |
| **Client-ID** | `nexora-soc` | Ein Text-Name für deine Nexora-Registrierung beim zentralen Dienst |
| **Client-Secret** | (wird eingegeben, bleibt verborgen) | Ein geheimer Schlüssel — wie ein Passwort zwischen zwei Systemen |

4. Klick auf den Button **„Verbindung testen"** — das System prüft, ob alles stimmt
   - Grünes Häkchen? Super, weiter.
   - Rote Fehlermeldung? Eine der 3 Werte stimmt nicht. Frag deinen Keycloak-Admin nach.

5. Stelle diese Toggles:

| Toggle | Stelle auf |
|--------|-----------|
| **Auto-Signup aktivieren** | AN (neue Nutzer aus Keycloak werden automatisch angelegt) |
| **SSO aktiv** | AN (der Login mit Keycloak funktioniert) |

6. Klick **Speichern** — das System fragt nach deinem Passwort (Schutz)
7. Gib dein Passwort ein und klick **Bestätigen**

**Nach dem Setup testen:**

1. Logout (oben rechts)
2. Auf der Login-Seite: Klick **„Mit SSO anmelden"** oder **„Mit Keycloak anmelden"**
3. Du wirst zu Keycloak weitergeleitet
4. Gib deine Keycloak-Anmeldedaten ein
5. Zurück zu Nexora — du bist jetzt angemeldet

**Wenn es nicht klappt:**

| Fehler | Was könnte es sein | Was tun |
|--------|-----------|---------|
| „Verbindung testen" wird rot | Eine Adresse stimmt nicht, oder der Dienst ist nicht erreichbar | Überprüfe die Issuer-Adresse (https, nicht http); frag deinen Keycloak-Admin, ob der Dienst läuft |
| „Zu viele Versuche — kurz warten" | Du hast zu oft das falsche Passwort eingegeben | 15 Minuten warten, dann nochmal versuchen |
| Nach Test speichern abgelehnt | Dein Passwort ist falsch | Gib es nochmal ein; max. 5 Versuche in 15 Minuten |
| Login mit Keycloak funktioniert nicht | Keycloak kennt dich, Nexora aber nicht | Frag deinen Keycloak-Admin, ob der Scopes richtig ist (`openid profile email`) |

---

## Sicherheitsschutz

**Was ist das?** Das System fragt dich nach deinem aktuellen Passwort, wenn du sicherheitsrelevante Sachen änderst.

**Wozu?** Damit nicht jemand an deinem unlocked Computer Nexora-Einstellungen manipuliert.

**Wo passiert das:**
- OIDC speichern
- MFA zur Pflicht machen
- Sitzungs-Dauer senken

**Wenn es nicht klappt:**
- Du gibst ein falsches Passwort ein → Fehlermeldung, versuch's nochmal
- Du schaffst es 5 Mal nicht → kurz warten (15 Min.), dann nochmal versuchen

---

## Audit-Log (wer hat was geändert)

**Was ist das?** Eine Aufzeichnung, wer wann welche Sicherheits-Einstellungen geändert hat.

**Wozu?** Damit du siehst, ob jemand unbefugt Regeln geändert hat (z.B. Passwort-Regeln gelockert).

**So schaust du es an:**

1. Gehe zu **Einstellungen**
2. Wähle den Reiter **Audit & Compliance**
3. Du siehst eine Tabelle mit:
   - **Wann** (Datum/Uhrzeit)
   - **Wer** (Nutzer-Name)
   - **Was** (z.B. „OIDC-Konfiguration geändert")
   - **Status** (erfolgreich oder gescheitert)

**Tipp:** Monatlich einen Blick drauf werfen, ob alles normal aussieht.

---

## Checkliste für den ersten Setup

Geh diese Punkte durch, damit es sicher ist:

- [ ] Passwort-Mindestlänge auf mindestens 10 gesetzt
- [ ] Komplexität auf „Hoch" gestellt
- [ ] Sitzungs-Dauer auf max. 8 Stunden gesetzt
- [ ] OIDC eingegeben und getestet (grünes Häkchen)
- [ ] SSO aktiv = AN
- [ ] Auto-Signup = AN
- [ ] Zwei-Faktor (optional jetzt, später zur Pflicht machen)
- [ ] Zumindest einmal ins Audit-Log geschaut

---

**Zuletzt aktualisiert:** 2026-07-05  
**Fragen?** Frag einen IT-Admin oder schreib an die Dokumentation.
