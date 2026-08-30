# Administration

Dieser Bereich erklärt, **wie man Nexora administriert** — jede Einstellung, wo sie sitzt, was
sie bewirkt und welche Rolle sie ändern darf. Alle Screenshots stammen aus der laufenden
Plattform.

!!! info "Zentrale Anlaufstelle: Systemeinstellungen"
    Der Großteil der Administration liegt unter **Systemeinstellungen** (Zahnrad-Menü → *Einstellungen*).
    Die Seite ist in Tabs gegliedert — jeder Tab hat unten eine eigene Doku-Seite:

<div class="grid cards" markdown>

-   :material-cog-outline: __Allgemein & Lizenz__

    ---
    Plattformname, Sprache, Zeitzone, Wartungsmodus, Lizenz & Nutzung.

    [:octicons-arrow-right-24: Allgemein & Lizenz](allgemein.md)

-   :material-account-group-outline: __Benutzer & Rollen__

    ---
    Benutzerverwaltung und die serverseitig erzwungene RBAC-Matrix.

    [:octicons-arrow-right-24: Benutzer & Rollen](benutzer-rollen.md)

-   :material-connection: __Integrationen__

    ---
    SIEM (Wazuh/QRadar/Splunk), Threat Intel (VT/AbuseIPDB), LLM (Ollama).

    [:octicons-arrow-right-24: Integrationen](integrationen.md)

-   :material-shield-key-outline: __Sicherheit__

    ---
    Passwort-/Sitzungsrichtlinie, Account-Lockout, MFA, SSO/OIDC, Security-Score.

    [:octicons-arrow-right-24: Sicherheit](sicherheit.md)

-   :material-webhook: __API & Webhooks__

    ---
    Basis-URL, Rate-Limits, eingehende Webhook-Empfänger, persönliche API-Tokens.

    [:octicons-arrow-right-24: API & Webhooks](api-webhooks.md)

-   :material-bell-outline: __Benachrichtigungen__

    ---
    In-App, E-Mail, Slack/Teams/Webhook-Kanäle.

    [:octicons-arrow-right-24: Benachrichtigungen](benachrichtigungen.md)

-   :material-database-outline: __Speicherung & Retention__

    ---
    Datenbankgröße, Backup-Cron, Aufbewahrungsregeln.

    [:octicons-arrow-right-24: Speicherung & Retention](speicherung-retention.md)

-   :material-palette-outline: __Branding & Thema__

    ---
    Plattformname und Akzentfarbe.

    [:octicons-arrow-right-24: Branding & Thema](branding.md)

-   :material-clipboard-check-outline: __Audit & Compliance__

    ---
    Audit-Aktivität, DSGVO-Hinweise, Compliance-Report.

    [:octicons-arrow-right-24: Audit & Compliance](audit-compliance.md)

-   :material-robot-outline: __KI-Agent-Konfiguration__

    ---
    Provider, Modell, RAG, Guardrails, Confidence-Schwellen.

    [:octicons-arrow-right-24: KI-Agent-Konfiguration](ki-agent.md)

</div>

## Weitere Admin-Bereiche (eigene Screens)

| Bereich | Zweck | Seite |
|---|---|---|
| **Autonomie-Richtlinien** | Policies pro Mandant × Aktionsklasse; global per Kill-Switch | [Autonomie-Richtlinien](autonomy-policies.md) |
| **Provisioning & Enrollment** | Node-Registry, Enrollment-Profile (read-only, kein Apply) | [Provisioning](provisioning.md) |
| **Correlation Engine** | Jobs, Worker-Health, gesperrter Apply-Kanal | [Correlation Engine](correlation-engine.md) |
| **ML-Evaluation** | Offline-Gold-Eval & advisory Routing-Policy | [ML-Evaluation](ml-evaluation.md) |

## Rollen — wer darf was

Die Berechtigungen sind **serverseitig erzwungen** (`authenticate.js` + Middleware). Die UI blendet
nur zusätzlich aus. Hierarchie: **admin > engineer > analyst > viewer**.

| Aktion | viewer | analyst | engineer | admin |
|---|:--:|:--:|:--:|:--:|
| Tickets & Hunts lesen | ✅ | ✅ | ✅ | ✅ |
| Ticket anlegen & bearbeiten | — | ✅ | ✅ | ✅ |
| Hunts starten · KI-Analyse anfordern | — | ✅ | ✅ | ✅ |
| FP-Ausnahme anwenden | — | — | ✅ | ✅ |
| Einstellungen & Benutzer verwalten | — | — | — | ✅ |
| KI-Vorschläge genehmigen | — | ✅ | ✅ | ✅ |
| KI-Konfiguration ändern | — | — | — | ✅ |

!!! warning "Grundprinzip"
    Neue Security-/KI-Kontrollen sind **default-AUS** und serverseitig erzwungen — kein
    Fake-Toggle. Was gespeichert wird, wird auch durchgesetzt. Kritische Schalter
    (Apply, Autonomie) sind zusätzlich per ENV-Variable gesperrt.
