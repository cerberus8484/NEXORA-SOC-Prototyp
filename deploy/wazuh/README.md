# Wazuh — Nexora Local Rules

Artefakte für **scoped Wazuh-Local-Rules**, die Nexora braucht. Diese Dateien sind
**Vorschläge/Dokumentation** — das Anwenden auf den Manager passiert **bewusst und
kontrolliert** (Backup → anhängen → `wazuh-logtest` → Restart → Live-Test → ggf. Rollback),
nie automatisch über den App-Deploy.

> Ziel-Datei am Manager (10.99.99.77): `/var/ossec/etc/rules/local_rules.xml`
> (mehrere `<group>`-Blöcke erlaubt — Block ans Ende anhängen, sonst nichts ändern).

## Dateien

| Datei | Status | Zweck |
|---|---|---|
| `local_rules.nexora_sysmon_network.v2.xml` | ✅ **VALIDATED LIVE** (2026-06-17) | Sysmon Event 3 (powershell/tcp) → Level 3 → `wazuh-alerts` → CE-3 Network-Tab |
| `local_rules.nexora_sysmon_network.xml` | ⛔ **V1 — verworfen (inert)** | erster Versuch, `if_group sysmon_event3`; wurde von Built-in 92101 überschattet |

## Warum Sysmon Event 3 eine Regel braucht

Wazuh schreibt nur **rule-matched Alerts ab `log_alert_level=3`** in `wazuh-alerts`.
Die Sysmon-Event-3-Basisregel `61605` ist **Level 0** → NetworkConnect-Events landen
nicht im Index → die Nexora **Correlation Engine (CE-3)** sieht sie nicht.
Eine kleine scoped Regel hebt die relevanten Verbindungen auf Level 3.

## V1 → V2 (die Lehre)

- **V1** nutzte `<if_group>sysmon_event3</if_group>` → war damit **Geschwister** der
  Built-in-Regel `92101` (gleicher `if_group`). Im powershell/tcp-Test hat `92101`
  (niedrigere ID) den Event-Zweig beansprucht → V1 wurde nie ausgewertet → **inert**.
- **V2** hängt als **Kind** von `92101` (`<if_sid>92101</if_sid>`) → keine
  Geschwister-Konkurrenz → feuert. **Live bewiesen.**

> ⚠️ `92101` matcht selbst nur `powershell.exe` **+ `protocol tcp`**. Eine Kindregel
> davon deckt also **nur powershell.exe/tcp** ab (bewusst, Proof-of-Chain).
> pwsh/`_ise`/andere LOLBins kommen über diesen Anker **nicht** an.

## Live-Beweis (V2, 2026-06-17)

```
powershell -> 10.99.99.72:8080  =>  rule.id=100951 feuert (DC01 + WEC01, powershell.exe/tcp)
Nexora INC000283 (DC01): network.flows -> sourceType sysmon_event3
Noise: Top-Image NUR powershell, KEIN osb-agent, Rule 202/203 = 0, Indexer stabil
```

## Apply / Rollback (Kurzfassung)

Voller Schritt-für-Schritt-Plan steht im **Header** der jeweiligen `.xml`. Kurz:

```bash
# Apply
sudo cp -p /var/ossec/etc/rules/local_rules.xml /var/ossec/etc/rules/local_rules.xml.bak-<datum>-pre-nexora-vN
# <group>-Block ans Ende anhängen (byte-exakt, z. B. via base64)
echo 'syntax-check' | sudo /var/ossec/bin/wazuh-logtest   # nur Ruleset-Load/Syntax prüfbar
sudo /var/ossec/bin/wazuh-control restart                  # bewusst, ruhiges Fenster

# Rollback
sudo cp -p /var/ossec/etc/rules/local_rules.xml.bak-<datum>-pre-nexora-vN /var/ossec/etc/rules/local_rules.xml
sudo /var/ossec/bin/wazuh-control restart
```

> `wazuh-logtest` kann das **Feuern** nicht synthetisch beweisen (eventchannel-Events
> werden vom `json`-Decoder statt `windows_eventchannel` verarbeitet) — der Beweis ist
> der **Live-Test** nach dem Restart.

## Erweiterungsplan (später, ruhig)

Weitere LOLBins (rundll32/cmd/certutil/regsvr32/mshta) als **eigene Regeln**
(`100952`/`100953`…), **nicht** alles in eine Regel. Anker **nicht** `92101` (zu schmal) —
breiteren Anker wählen (Kind von `61605` o. eigene Zwischen-Basis) und Shadowing testen.
**Vor** Breit-Apply: Volumen je Binary aus dem Sysmon-Log messen (osb-agent = 99,8 %
Rauschen, bleibt ausgeschlossen).
