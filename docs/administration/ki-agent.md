# KI-Agent einstellen (für Nicht-Techniker)

**Menü:** Einstellungen (oben rechts) → KI-Agent (nur Admins)

Die KI hilft dir, verdächtige Alarme schneller einzuschätzen. Du entscheidest am Ende immer selbst.

---

## Wo ist die KI-Konfiguration?

1. Klicke oben rechts auf **Einstellungen** (⚙-Symbol).
2. Wähle **KI-Agent** aus der linken Liste.
3. Du siehst jetzt mehrere Bereiche — sieh sie dir der Reihe nach an.

---

## Schritt 1: Wer liefert die KI? (Provider wählen)

Du siehst 5 Kärtchen. Jedes Kärtchen ist eine KI-Quelle. Klick auf eine, um sie zu wählen.

### **Ollama** (empfohlen) — Die KI läuft bei dir zuhause
- **Was ist das?** Die KI rennt auf deinem eigenen Server, nicht irgendwo in der Cloud.
- **Wozu?** Nichts von deinen Daten verlässt das Büro. Super sicher.
- **Farbe:** Grün = läuft · Orange = aus oder nicht erreichbar.

### **Anthropic, Google, OpenAI** — Die KI läuft in der Cloud
- **Was ist das?** Die KI sitzt bei einem großen Anbieter (Anthropic = Claude, Google = Gemini, OpenAI = ChatGPT).
- **Wozu?** Manchmal stärkere KI, aber deine Daten gehen nach außen.
- **Achtung:** Deine Alarme und Infos fliegen zu einem amerikanischen/europäischen Dienst. Das muss dein Datenschützer absegnen.

**Faustregel:** Nimm Ollama, wenn du kannst. Wenn nicht, frag deinen Datenschützer, bevor du Cloud wählst.

---

## Schritt 2: Die Verbindung einrichten

### **Für Ollama:**

1. Siehst du ein Feld **Ollama-Adresse**? Tipp die Web-Adresse des Ollama-Servers rein.
   - Beispiel: `http://ollama.example.local:11434`
   - (Frag deinen IT-Typ, wenn du die nicht kennst.)

2. Klick auf das **Aktualisierungs-Symbol** (Kreis mit Pfeil) neben dem Feld.
   - Die KI lädt jetzt eine Liste verfügbarer Modelle.

3. Wenn es funktioniert, siehst du ein Dropdown mit Namen wie `llama3.2:3b`.

### **Für Anthropic / Google / OpenAI:**

1. Geh zum Anbieter (z.B. cloud.anthropic.com), meld dich an, und hol dir einen **API-Schlüssel** — das ist wie ein Passwort nur für die KI.

2. Tipp den Schlüssel im Feld **API-Schlüssel** ein.
   - Der Schlüssel wird verschlüsselt gespeichert — du siehst ihn nachher nicht mehr.

3. Klick auf **Verbindung testen**.
   - Grünes Häkchen = funktioniert.
   - Rotes X = wahrscheinlich falscher Schlüssel oder Netz-Problem.

---

## Schritt 3: Das Modell einstellen (die KI selbst)

### **Modell wählen**
Klick im Dropdown und wähl ein Modell. (Ollama zeigt dir die verfügbaren.)

- Empfehlung: **llama3.2:3b** (schnell, reicht für die meisten Fälle).

### **Max Tokens**
Wie lang darf die Antwort der KI sein?

- **500** = kurz und knapp.
- **2000** = ausführlicher.
- (Ein Token ≈ 4 Zeichen.)

**Empfehlung:** 2000. Wenn die KI zu langsam ist, red auf 1000.

### **Temperatur (0,0–2,0)**
Wie kreativ oder fokussiert soll die KI sein?

- **0,0–0,5** = konzentriert, vorhersehbar (für Sicherheit **nimm das**).
- **1,0–2,0** = kreativ, spekulativ (nicht so gut für deine Zwecke).

**Empfehlung:** **0,2**

### **Top P**
(Das ist fancy; wenn du nicht weißt, was das ist, lass es leer.)

### **RAG aktivieren**
Soll die KI bei Fragen Zugriff auf ein Wissens-Handbuch haben (MITRE ATT&CK, Hunt-Katalog)?

- **Ein** = ja, die KI ist klüger.
- **Aus** = nein, die KI antwortet nur aus dem, was du siehst.

**Empfehlung:** **An** (falls konfiguriert).

---

## Schritt 4: Speichern und testen

Unten rechts auf der Seite:

1. Klick **Speichern** (grüner Button).
2. Warte eine Sekunde.
3. Wenn alles grün ist, funktioniert es.

Wenn etwas rot ist oder eine Meldung fehlt, lies bei „Wenn es nicht klappt" nach.

---

## Wenn es nicht klappt

### **Ollama zeigt orange / Offline**

**Das Problem:**
- Die KI sagt "Offline" oder "Verbindung fehlgeschlagen".

**Was tun:**
1. Prüf die Adresse, die du eingegeben hast. Tippfehler?
2. Frag deinen IT-Typ, ob Ollama läuft (SSH zum Server, dann: `curl http://localhost:11434/api/tags`).
3. Wenn die Adresse richtig ist und Ollama läuft, mach einen Screenshot und frag im Team nach.

---

### **Cloud-Provider (Anthropic/Google/OpenAI): "Kein Schlüssel" oder Test schlägt fehl**

**Das Problem:**
- Badge zeigt orange.
- "Verbindung testen" funktioniert nicht.

**Was tun:**
1. Hast du den API-Schlüssel eingegeben?
2. Ist der Schlüssel noch gültig? (Manche Anbieter löschen alte Schlüssel nach 90 Tagen.)
3. Wenn beides OK ist, warte 5 Minuten und versuche es nochmal — manchmal sind Cloud-Systeme langsam.

---

### **Die KI antwortet nicht / Timeout**

**Das Problem:**
- In der Analyse siehst du "KI-Fehler" oder wartest lange.

**Was tun:**
1. Reduzier **Max Tokens** (von 2000 auf 1000).
2. Oder: Wechsel zu einem schnelleren Modell (z.B. `llama3.2:3b` statt größer).
3. Schau in der Fußzeile: stehen da viele KI-Aufrufe mit Fehlern? → Dann hat die KI aktuell Probleme.

---

## Wichtig zu wissen

### **Die KI ist keine Entscheidungsmaschine**
- Die KI gibt Vorschläge.
- **Du entscheidest** am Ende.
- Kein Alarm wird automatisch abgelöscht, nur weil die KI es sagt.

### **Cloud = deine Daten fliegen weg**
- Bei Anthropic/Google/OpenAI sehen diese Firmen deine Alarme.
- Das ist nur OK, wenn:
  - Dein Chef/Datenschützer es erlaubt.
  - Es einen Vertrag gibt (DPA = Datenschutz-Vereinbarung).

### **Ollama = sicher**
- Nichts fliegt weg.
- Du brauchst keine Verträge.
- **Empfehlungen:** Nimm Ollama, wenn möglich.

---

## Speichern, testen, fertig

Wenn alle Felder grün sind und der Test durchläuft:

**Klick Speichern → fertig.**

Die KI startet jetzt beim nächsten Alarm. Gib ihr ein bis zwei Versuche — dann siehst du, wie gut sie bei euch funktioniert.
