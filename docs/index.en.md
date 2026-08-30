# Nexora SOC — Documentation

!!! abstract "What is Nexora SOC?"
    A **self-hosted SOC orchestration platform for Tier 1–3**: incident ticketing,
    threat hunting (MITRE-mapped), evidence & chain-of-custody, threat-intel enrichment
    (VirusTotal/AbuseIPDB), AI triage with **human approval**, and live telemetry from the
    Wazuh indexer. Nexora *consumes and correlates* SIEM data — it is **not** a SIEM/EDR
    replacement and performs no automatic threat removal.

Nexora sits *on top of* your existing security tooling (Wazuh, QRadar, Splunk) and turns their
raw alerts into traceable, enriched, prioritized cases — "tickets" an analyst can work
efficiently. Critical actions stay human-in-the-loop: role-based, approval-gated, auditable and
reversible.

```
Raw data  →  Adapter  →  Ticket  →  Enrichment  →  AI analysis  →  Decision  →  Report
(SIEM)       (validate    (normal-   (threat intel,  (proposal      (human       (PDF/CSV,
             + normalize) ized,       host context,   with           approves,    chain of
                          dedup.)     MITRE mapping)  evidence)      audited)     custody)
```

---

## Quick start

<div class="grid cards" markdown>

-   :material-rocket-launch-outline: __Getting Started__

    ---

    What the product does, what is live, and where it is headed.

    [:octicons-arrow-right-24: Product Overview](00-overview/produkt-erklaerung.md) ·
    [Feature Status](00-overview/feature-status.md) ·
    [Roadmap](08-roadmap/README.md)

-   :material-download-outline: __Install & Operate__

    ---

    Dev setup, Docker stack, production (nginx + TLS), migrations.

    [:octicons-arrow-right-24: Installation](03-admin-guide/installation.md) ·
    [Admin Guide](03-admin-guide/README.md)

-   :material-monitor-dashboard: __Use the Console__

    ---

    The full analyst workflow and every screen of the UI.

    [:octicons-arrow-right-24: User Guide](02-user-guide/user-guide.md)

-   :material-radar: __Detection & Hunting__

    ---

    Detection rules, MITRE mapping and the threat-hunt catalog.

    [:octicons-arrow-right-24: Detection & Threat Hunting](detection/index.md)

-   :material-sitemap-outline: __Architecture__

    ---

    arc42, UML, correlation data model, AI/LLM architecture, ADRs.

    [:octicons-arrow-right-24: Architecture Overview](01-architecture/README.md) ·
    [Decisions (ADR)](adr/decisions.md)

-   :material-shield-lock-outline: __Security__

    ---

    Threat model, auth/RBAC, secure connections, reviews.

    [:octicons-arrow-right-24: Security](05-security/README.md)

</div>

!!! note "Bilingual documentation"
    This site is bilingual with **German as the primary language**. Use the language switcher in
    the top-right corner to toggle between **English** and **German**. Pages that are not yet
    translated fall back to their German version automatically.
