# Services – Wichtige Programme neu starten

Diese Seite ist zum **Steuern** wichtiger Hintergrund-Programme. Du legst hier **keine neuen Programme an** — sie werden vom System bereitgestellt und erscheinen automatisch als Karte.

## Was ist ein Service?

Ein Service ist ein wichtiges Programm, das im Hintergrund läuft — zum Beispiel der **Wazuh Manager**, das Herzstück, das alle Sicherheits-Alarme sammelt. Diese Seite ist nur dafür da, solche Programme **neu zu starten**, wenn es nötig ist.

## Wie funktioniert das?

Auf der Services-Seite siehst du eine Karte pro laufendem Service. Auf einer Wazuh-Manager-Karte funktioniert es so:

1. Klick auf **„Restart scharfschalten"** und gib dein Passwort ein.
   - Das ist ein Sicherheits-Schritt, damit nichts aus Versehen passiert.

2. Dann erscheint **„Neu starten"** — klick drauf und bestätige im Dialog.

3. Das Ergebnis steht direkt auf der Karte:
   - Grüner Haken = erfolgreich neu gestartet.
   - Roter X = Fehler (mit Grund auf der Karte).

## Wenn es nicht geht: „Wazuh-API nicht konfiguriert"

Diese Meldung bedeutet: die Verbindung zum Wazuh-Manager ist noch nicht eingerichtet.

**Lösung:**
1. Gehe zu **Integrationen**.
2. Eintrag die Wazuh-Verbindung dort (URL, Benutzer, Passwort).
3. Speichern — dann ist der Neustart möglich.

Nur ein Administrator kann das tun.

## Keine Karte sichtbar?

Es gibt aktuell keine Services zu steuern. Das ist normal — es ist nichts zu tun.

---

**Hinweis:** Die Neustarts werden protokolliert. Der Wazuh-Manager geht dabei kurz offline — plane das in einer wartungsarmen Zeit ein.
