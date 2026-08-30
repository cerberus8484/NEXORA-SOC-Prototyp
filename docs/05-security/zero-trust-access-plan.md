# Zero-Trust-Access-Plan

**Stand:** 2026-06-29  
**Status:** Architektur-/Security-Track vorbereitet, Implementierung offen.

## 1. Ziel

Nexora soll privilegierten Zugang nicht mehr implizit aus Netznaehe, VPN-Mitgliedschaft oder
"wer im LAN ist, darf schon" ableiten, sondern aus **Identitaet, Kontext, expliziter Policy und Audit**.

Der Track umfasst drei getrennte Ebenen:

1. **App Access** - Browser/API-Zugriff auf Nexora selbst
2. **Operator Access** - Admin-/Wartungszugriff auf Infrastruktur
3. **Managed Node Access** - spaetere, stark kontrollierte Node-/Agent-Funktionen

## 2. Bereits vorhandene Bausteine

- Cookie-only-Session + CSRF-Double-Submit
- Rollen und serverseitige Role-Gates
- MFA/TOTP
- OIDC-SSO
- WebAuthn/Passkey (lokal vorbereitet)
- Audit-Log / Audit-Export
- Control-Plane mit bewusstem No-Apply-Modell

Das ist noch **kein** Zero-Trust-Zugang, aber ein brauchbares Fundament.

## 3. Sicherheitsziele

- Kein privilegierter Zugang nur wegen Netzlage
- MFA / Step-up fuer privilegierte Pfade
- Kurze, widerrufbare Sessions
- Ressourcenfreigabe pro Ziel statt pauschaler Subnetzfreigabe
- Zentrale Auditierbarkeit auch fuer Infrastrukturzugriffe
- Klare Break-Glass-Regel fuer IdP-/Broker-Ausfall

## 4. Nicht-Ziele

- Kein vollstaendiges SOAR-/PAM-Programm in diesem Schritt
- Kein freier Remote-Exec-Kanal ueber die Nexora-Control-Plane
- Keine Produktfestlegung allein aus Marketinggruenden
- Kein "wir aktivieren einfach ein VPN und nennen es Zero Trust"

## 5. Threat Model

| Risiko | Warum relevant | Zielkontrolle |
|---|---|---|
| Gestohlene Zugangsdaten | SOC-/Admin-Accounts sind hochprivilegiert | MFA, Passkey, Re-Auth, Session-Revocation |
| Zu breite Netzfreigaben | VPN/LAN-Zugang oeffnet zu viel | Ressourcenscharfe Policies statt Subnetz |
| Schattenzugang ueber Direktpfade | SSH/DB/Proxy werden ausserhalb des Modells genutzt | Zielinventar + Policy + Audit + harte Abschaltung alter Pfade |
| IdP-/Broker-Ausfall | Zugang darf nicht komplett unrettbar werden | Break-Glass-Konzept |
| Tool-Lock-in | ZTNA-Produkte loesen nicht jedes Infrastrukturproblem gleich gut | Kriterienkatalog vor Produktwahl |
| Missbrauch kuenftiger Node-Funktionen | "Zero Trust" koennte als Rechtfertigung fuer Remote-Exec missbraucht werden | Pull-Modell, Approval, Signatur, No-Apply-Grenze |

## 6. Architekturziel

### 6.1 Ebene A - App Access

- OIDC als primaerer Identity-Anker
- MFA/Passkey fuer privilegierte Rollen
- Re-Auth fuer sensible Aktionen wie:
  - Benutzer-/Rollen-Aenderungen
  - Security-Settings
  - Export-/Schluessel-/Provider-Konfiguration
  - spaeter: Auto-Response-Freigaben
- Rollen und Capabilities bleiben in Nexora autoritativ

### 6.2 Ebene B - Operator Access

- Kein pauschaler "Admin-VPN fuer alles"-Pfad
- Zugang ueber identitaetsgebundene Policies
- Zielobjekte einzeln oder gruppiert, nicht ganze Netze per Default
- Unterschiedliche Pfade fuer:
  - Plattform-Admin
  - SOC-Operator
  - Break-Glass

### 6.3 Ebene C - Managed Node Access

- Weiterhin kein freier Steuerkanal
- Nur ueber signierte, enge, auditierte Pull-Mechanik
- Approval und Rollback bleiben Pflicht

## 7. Bewertungsrahmen fuer spaetere Produktwahl

Ein Kandidat ist nur geeignet, wenn er:

- mit self-hosted / homelab-naher Realitaet vereinbar ist
- OIDC/MFA sauber integrieren kann
- Windows- und Linux-Adminpfade praktikabel abdeckt
- nachvollziehbare Auditdaten liefert
- Sitzungserneuerung / Widerruf / Offboarding gut kann
- keine breite Netzfreigabe als Default erfordert
- fuer die tatsaechlichen Adminpfade von Nexora taugt

Die Liste ist absichtlich produktneutral. `Twingate` und `Tailscale` sind Beispiele, keine Vorfestlegung.

## 8. Geplanter Arbeitsablauf

### Phase 1 - Inventar

- Management-Zielsysteme und Direktpfade erfassen:
  - Proxmox
  - Reverse Proxy / nginx
  - Nexora API/Frontend
  - Postgres
  - Wazuh-Komponenten
  - Mail
  - Qdrant
  - weitere Admin-UIs / SSH-Zugaenge

### Phase 2 - Zugriffsklassen

- Wer braucht worauf Zugriff?
- Welche Pfade sind taeglich, welche selten, welche Break-Glass?
- Welche Aktionen brauchen Step-up oder Vier-Augen?

### Phase 3 - Zieloptionen vergleichen

- 2-3 technische Optionen gegen den Kriterienkatalog pruefen
- Vor- und Nachteile fuer Homelab und spaeteren professionellen Betrieb dokumentieren

### Phase 4 - Implementierungs-ADR

- Erst nach der Auswahl:
  - konkrete Zielarchitektur
  - Migrationspfad
  - alte Direktpfade abschalten
  - Logging / Monitoring / Rollout

## 9. Konkrete offene Entscheidungen

- Reicht IdP + Reverse-Proxy + harte Session-Policies fuer Ebene A, bevor ein externer Broker kommt?
- Welche Infrastrukturpfade muessen wirklich remote erreichbar sein, welche koennen lokal/konsole-only bleiben?
- Wie soll Break-Glass dokumentiert und technisch abgesichert werden?
- Welche alten Zugriffswege werden nach Einfuehrung bewusst deaktiviert?

## 10. Ergebnis dieser Vorarbeit

Der Punkt `Zero-trust access` ist jetzt kein loses Roadmap-Schlagwort mehr, sondern ein klarer
Architektur-/Security-Track mit:

- ADR-038 als Entscheidungsrahmen
- produktneutralem Zielbild
- Threat Model
- Phasen fuer die naechste Bearbeitung
