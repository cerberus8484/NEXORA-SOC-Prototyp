# Architektur

Dieser Bereich enthält die technische Architektur: Systemdesign, Datenmodelle und
Framework-Entscheidungen.

## Inhalt

- **[arc42](./arc42.md)** — Arc42-Architekturdokumentation
  - Systemkontext, Container und Komponenten
  - Laufzeit- und Deployment-Sicht
  - Risiken, technische Schulden, Qualitätsanforderungen

- **[Korrelations-Datenmodell](./correlation-data-model.md)** — Correlation Engine (CE-1 bis CE-7)
  - Datenquellen Q1–Q10 und das `CorrelationResult`-Modell
  - Netzwerk-/NAT-Flow-Modell (Firewall + Sysmon Event 3), Host-Case-Aggregation
  - Feld-Provenienz & `missingReason` (keine erfundenen Werte)

- **[CE-5 FQDN-Source-Discovery](./ce5-fqdn-source-discovery.md)**
  - Quellenmatrix (Wazuh-Kurznamen, AD-DNS-Forward, LDAP)
  - DNS-Forward-Confirm (A-Record muss der Flow-IP entsprechen, keine Fakes)
  - Read-only; Reverse-PTR geparkt, LDAP optional

- **[GitOps-Provisioning](./gitops-provisioning.md)** (Control-Plane)
  - Provisioning-Profile & Plan-Generierung (validate + plan)
  - No-Apply / No-Remote / No-Network-Kanal (per Test erzwungen)

- **[Hunt-Response-Konsole](./hunt-response-console.md)** — sichere Kommando-Ausführung
  - Dreistufige Response-Konsole (Safe Commands → Approval Gate → Agent)
  - Capability-basierte RBAC, Command-Allowlisting und Sandboxing

- **[Lokale-LLM-Architektur](./local-llm-architecture.md)** — KI-Agent & Ollama
  - LLM-Provider-Abstraktion (Ollama, Anthropic, OpenAI, Google)
  - Evidence-Bundling und Prompt-Konstruktion, Anti-Halluzinations-Guardrails

- **Machine Learning:** [Training-Plan](./ml-training-plan.md) ·
  [Label-Contract](./ml-label-contract.md) · [Eval-Schema](./ml-eval-schema.md)
  - Eval-/Feedback-Loop vor Fine-Tuning, Label-Disziplin, Offline-Eval-Exportvertrag

- **[Server-Implementierungsplan](./server-implementation-plan.md)** — Backend-Phasen (S1–S4)

- **[Wazuh-Frontend-Replacement](./wazuh-frontend-replacement.md)** — Wazuh-Integration & Dashboards

---

**Siehe auch:** [Architecture Decision Records](../adr/decisions.md) für alle Architekturentscheidungen.
