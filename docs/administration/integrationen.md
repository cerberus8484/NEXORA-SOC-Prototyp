# Integrationen einrichten

Das hier erklärt, wie du dem System Zugangsdaten für externe Programme gibst — damit deine SOC-Plattform Alarme abholt, verdächtige Dateien nachschlägt und so weiter.

!!! note "Wo du das findest"
    **Systemeinstellungen** oben rechts → Reiter **Integrationen**

---

## Was ist eine Integration?

Eine Integration ist eine **Verbindung zu einem anderen Programm**, das uns hilft. Zum Beispiel:
- **Wazuh** ist unser Haupt-Alarmmelder — von dort kommen die meisten Sicherheitswarnungen.
- **CrowdSec** blockt böse IP-Adressen.
- **E-Mail/IMAP** prüft eine Mailbox auf Phishing-Meldungen.
- **VirusTotal** schlägt nach, ob eine Datei bekannt böse ist.

---

## Regel: Passwörter speichern

!!! warning "Wichtig: Passwörter nie im Klartext"
    Das System speichert Passwörter und Schlüssel **verschlüsselt**. Sie sind auf der Festplatte und in Logs nicht lesbar. Wenn du speicherst, musst du dein eigenes Admin-Passwort eingeben — das bestätigt, dass du die Änderung bewusst machst.

---

## Wazuh (die Hauptalarmmeldung)

**Was ist das?**
Wazuh ist dein Sicherheits-Wachmann — es schaut auf alle deine Rechner und schickt Alarme wenn etwas verdächtig aussieht.

**Was passiert?**
Wenn ein Alarm kommt, wird automatisch ein Ticket erstellt.

**Wichtig:**
Wazuh wird **nicht** in diesem Menü konfiguriert. Ein Administrator setzt es über **Systemeinstellungen** (die `.env`-Datei oder Docker-Umgebungsvariablen) einmalig auf. Das sieht nur, dass Wazuh verbunden ist.

**Wenn zu wenige Alarme reinkommen:**
1. Eventuell ist der Wazuh-Alarm-Filter zu streng (nur wichtige Alarme werden weitergeleitet)
2. Oder Wazuh ist nicht mit deinem System verbunden — das sieht du in diesem Integrations-Menü im Status

---

## CrowdSec (böse IPs blockieren)

**Was ist das?**
CrowdSec blockt IP-Adressen, die böse Aktivitäten zeigen (Hackerversuche, Spam usw.).

**Wozu?**
Wenn deine Firewall oder dein Webserver an CrowdSec angebunden ist, blockiert es automatisch verdächtige Angreifer.

**So richtest du es ein:**

1. Klicke auf die **CrowdSec-Karte**
2. Trage ein:
   - **URL** — Adresse von CrowdSec (z.B. `https://crowdsec.beispiel.local:8080`)
   - **Machine-ID** — Name deines Agenten (z.B. `nexora`)
   - **Passwort** — das LAPI-Passwort von CrowdSec
   - **TLS-Modus** — normalerweise „Zertifikat prüfen", nur bei self-signed Zertifikat ändern
3. Klick auf **Verbindung testen**
4. Wenn grün: Klick **Speichern** und bestätige dein Admin-Passwort

**Wenn es nicht klappt:**
- Hast du die richtige URL eingegeben? Probiere `https://crowdsec.beispiel.local:8080`
- Machine-ID und Passwort korrekt? Frag den Netzwerk-Admin
- Netzwerk-Fehler? Ping-Test machen: `ping crowdsec.beispiel.local`

---

## E-Mail (Phishing-Meldungen abholen)

**Was ist das?**
Das System schaut in eine bestimmte Mailbox (z.B. `phishing@deirefirma.de`) und wandelt eingehende E-Mails in Tickets um.

**Wozu?**
Mitarbeiter können Phishing-Mails an diese Adresse weiterleiten → wird automatisch untersucht.

**So richtest du es ein:**

1. Klicke auf die **IMAP-Karte**
2. Trage ein:
   - **Host** — Adresse des Mailservers (z.B. `mail.beispiel.local`)
   - **Port** — normalerweise `993` (sicher) oder `143` (einfach)
   - **Benutzer** — E-Mail-Adresse (z.B. `phishing@firma.local`)
   - **Passwort** — Passwort dieser Mailbox
   - **Verschlüsselung** — Port `993` = sicher, Port `143` = einfach
3. Klick **Verbindung testen**
4. Wenn grün: Klick **Speichern** und bestätige dein Admin-Passwort

**Wenn es nicht klappt:**
- Port falsch? Versuch `993` (das ist Standard)
- Passwort falsch? Frag den Mail-Administrator
- Timeout? Firewall könnte Port sperren

---

## VirusTotal & AbuseIPDB (Dateien und IPs nachschlagen)

**Was ist das?**
- **VirusTotal** — schlägt nach, ob eine Datei oder IP bekannt als böse eingestuft wurde
- **AbuseIPDB** — speichalisiert auf IP-Reputation und Missbrauch

**Wozu?**
Wenn ein Ticket ankommt, schlägt das System automatisch nach und sagt: „Diese Datei/IP ist bekannt böse" oder „Sauberer als Schnee".

**So richtest du es ein:**

1. Klicke auf die **Threat-Intel-Keys-Karte**
2. Hol dir kostenlose Schlüssel:
   - VirusTotal: https://www.virustotal.com → Menü → API Key
   - AbuseIPDB: https://www.abuseipdb.com → Account → API
3. Trage die Schlüssel ein
4. Klick **Verbindung testen** (optional — sendet einen Test-Check gegen Google DNS)
5. Klick **Speichern**

**Wenn es nicht klappt:**
- Schlüssel falsch? Nochmal in der Webseite nachschauen
- Zu viele Tests gemacht? VirusTotal kostenlos: nur 4 Anfragen pro Minute. Morgen wieder :)
- Test sagt „Kein Key gesetzt"? Speichern vergessen?

---

## Qdrant (KI-Wissensspeicher)

**Was ist das?**
Qdrant speichert Dokumente (z.B. deine Sicherheits-Regelsets, MITRE-Rahmenwerk) — damit die KI schnell nachschlagen kann.

**Wozu?**
Die KI braucht den Zugang zu Wissensdaten, um intelligente Empfehlungen zu geben.

**So richtest du es ein:**

1. Klicke auf die **Qdrant-Karte**
2. Trage ein:
   - **URL** — wo Qdrant läuft (z.B. `http://qdrant.beispiel.local:6333`)
   - **API-Schlüssel** — nur wenn Qdrant mit Passwort läuft (sonst leer lassen)
3. Klick **Verbindung testen**
4. Wenn grün: Klick **Speichern** und bestätige dein Admin-Passwort

**Wenn es nicht klappt:**
- Qdrant läuft? Test: `ping qdrant.beispiel.local`
- URL falsch? Sieht wie `http://` aus, nicht `https://`?
- API-Schlüssel falsch gespeichert? Qdrant-Admin fragen

---

## QRadar & Splunk (Alternative Alarmquellen)

**Status:** Nicht installiert — du kannst diese ignorieren. Falls später gebraucht, ist hier ein Platz dafür.

---

## Warum kommen zu wenige Alarme an?

Das ist ein häufiges Problem. **Mögliche Ursachen:**

1. **Wazuh-Filter ist zu streng**
   - Der Administrator hat den `WAZUH_MIN_LEVEL` sehr hoch gestellt (z.B. nur kritische Alarme)
   - Lösung: Admin senkt den Wert (z.B. auf `5` für Medium + wichtige)

2. **Quelle nicht verbunden**
   - Hier in diesem Menü siehst du den Status. Wenn rot: Quelle ist nicht erreichbar oder nicht konfiguriert

3. **Firewall blockiert**
   - Externe Systeme können die Webhooks nicht schicken (Port zu, Netzwerk unreachbar)

**Erste Schritte:**
- Schau hier im Menü → Status jeder Quelle prüfen (grün oder rot)
- Ping einen externen Server: `ping wazuh.beispiel.local`
- Admin anrufen und sagen: „Wazuh zeigt Fehler"

---

## Tipps

- **Test zuerst:** Nutze immer „Verbindung testen" bevor du speicherst. Spart Debugging-Zeit.
- **Passwort-Feld leer lassen?** Das ist ok — das System behält das alte Passwort.
- **Secrets wechseln?** Alle 90 Tage API-Keys erneuern ist eine gute Idee.
- **Im Audit-Log nachschauen:** Nach jeder Änderung gucken, dass alles protokolliert wurde (Systemeinstellungen → Audit).
- **Helpdesk?** Wenn Integrations-Status rot ist, öffne F12 (Browser) und schau in die Fehler, die im Netzwerk-Tab auftauchen.

---

## Siehe auch

- [Systemeinstellungen](./index.md)
- [Sicherheitsrichtlinien](../05-security/README.md)
