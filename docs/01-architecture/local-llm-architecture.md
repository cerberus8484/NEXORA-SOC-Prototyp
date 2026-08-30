# Lokales LLM — Architektur & Konzept

> Alle KI-Analysen bleiben im internen Netz.
> Keine Incident-Daten, IOCs, Hashes oder Credentials verlassen die Infrastruktur.

---

## Motivation

| Mit Cloud-LLM (Claude API) | Mit lokalem LLM |
|---|---|
| Ticket-Daten → Internet → Anthropic | Alles bleibt intern |
| IOCs / Hashes verlassen das Netz | Kein Datenschutzproblem |
| Compliance-Risiko | DSGVO / Enterprise-konform |
| Kosten pro Token | Keine laufenden API-Kosten |
| Internetabhängigkeit | Funktioniert offline |

**Grundsatz:** Sensitive SOC-Daten (Credentials, Hashes, interne IPs, Incident-Details) dürfen niemals über eine externe API verarbeitet werden.

---

## Gesamtarchitektur

```
┌─────────────────────────────────────────────────────────────┐
│                    SOC VLAN (intern)                         │
│                                                             │
│  Analyst / Frontend                                         │
│      │ HTTPS + JWT                                          │
│      ▼                                                      │
│  SOC Ticket Tool Backend API                                │
│      │ HTTP (intern)                                        │
│      ▼                                                      │
│  Flowise (Agent Orchestrierung)                             │
│      │ REST API (localhost)                                  │
│      ▼                                                      │
│  ┌─────────────────────────────────────┐                   │
│  │         RAG Pipeline                │                   │
│  │  LlamaIndex / LangChain             │                   │
│  │      │              │               │                   │
│  │      ▼              ▼               │                   │
│  │  Ollama          Qdrant             │                   │
│  │  (LLM Server)    (Vector DB)        │                   │
│  │  Llama 3.1 8B    Embeddings         │                   │
│  └─────────────────────────────────────┘                   │
│                    ▲                                        │
│                    │ Knowledge Base                         │
│      ┌─────────────┼──────────────────┐                   │
│      │             │                  │                    │
│  Hunt-Definitionen  MITRE ATT&CK  Incident Reports        │
│  (HUNT-001..010)   (lokal)        (anonymisiert)          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Fine-Tuning vs. RAG

**Entscheidung: RAG (Retrieval Augmented Generation)**

| Kriterium | Fine-Tuning | RAG |
|---|---|---|
| Aktualität | Retraining bei Änderungen | Sofort aktuell |
| Hunt-Updates | Neu trainieren (Tage/Wochen) | Neu einlesen (Minuten) |
| Traceability | Keine Quellenangabe | Quelle wird genannt |
| Aufwand | Sehr hoch | Gering |
| Hardware | GPU-Cluster | Consumer GPU reicht |
| Auditierbarkeit | Schwierig | Vollständig |

**Warum RAG für SOC:**
Hunt-Definitionen ändern sich mit neuen Angriffstechniken. Ein RAG-System kann neue Informationen sofort einarbeiten ohne das Modell zu verändern. Für Audit-Zwecke kann der Agent exakt angeben welches Dokument welche Aussage begründet.

> **Stand 2026-06-29:** Das spaetere Thema `ML-Training` wird bewusst **nicht**
> als Widerspruch zu dieser RAG-Entscheidung verstanden. Nexora verfolgt zuerst
> einen **Eval-/Feedback-Track** und nur spaeter optional echtes Training oder
> Fine-Tuning. Siehe `docs/01-architecture/ml-training-plan.md` und `ADR-039`.

---

## Technologie-Stack

| Komponente | Tool | Version | Zweck |
|---|---|---|---|
| **LLM Server** | Ollama | Latest | Lokale Modell-Ausführung |
| **Sprachmodell** | Llama 3.1 8B (Q4_K_M) | 3.1 | Haupt-Inferenz |
| **Embedding** | nomic-embed-text | via Ollama | Text → Vektoren |
| **Agent UI** | Flowise | Latest | Workflow-Orchestrierung |
| **RAG Framework** | LlamaIndex | 0.10+ | Dokument-Retrieval |
| **Vector DB** | Qdrant | Latest | Embedding-Speicher |
| **Deployment** | Docker Compose | | Alle Services |

---

## Hardware-Anforderungen

### Minimum (Llama 3.1 8B quantisiert)
```
CPU:   8+ Cores (AMD/Intel)
RAM:   16 GB System-RAM
GPU:   NVIDIA RTX 3080 (10 GB VRAM) oder RTX 4070 Ti
Disk:  50 GB für Modelle + Vector DB
OS:    Ubuntu 22.04
```

### Empfohlen (bessere Performance)
```
CPU:   16+ Cores
RAM:   32 GB
GPU:   NVIDIA RTX 4090 (24 GB VRAM)
       → ermöglicht auch 13B Modelle
Disk:  100 GB SSD
```

### Enterprise (70B Modell — maximale Qualität)
```
GPU:   2x NVIDIA A100 40GB oder 4x RTX 3090
RAM:   128 GB
       → für hochkomplexe Analysen, größere Teams
```

### Kein GPU verfügbar (CPU-only)
```
Ollama läuft auch ohne GPU
Performance: ~3-5 Token/Sekunde (statt 40-60 mit GPU)
Akzeptabel für Batch-Analyse, nicht für Echtzeit
```

---

## Modell-Auswahl

| Modell | VRAM | Qualität | Empfehlung |
|---|---|---|---|
| Phi-3 Mini 3.8B | 4 GB | Gut für einfache Triage | Sehr schnell |
| **Llama 3.1 8B Q4** | **6 GB** | **Sehr gut** | **Start-Empfehlung** |
| Mistral 7B Q4 | 6 GB | Sehr gut | Alternative |
| Llama 3.1 13B Q4 | 10 GB | Exzellent | Bei RTX 4090 |
| Llama 3.1 70B Q4 | 40+ GB | Maximum | Enterprise-GPU |

---

## Knowledge Base — Was eingespeist wird

### Sofort verfügbar (bereits vorhanden)
```
hunts/skill/references/
├── hunt-framework.md         Hunt-Schema + Event IDs
├── hunt-c2-beaconing.md      HUNT-001: C2/Beaconing
├── hunt-credential-theft.md  HUNT-002: LSASS, Kerberoasting
├── hunt-lateral-movement.md  HUNT-003: PsExec, WMI, RDP
├── hunt-persistence.md       HUNT-004: Registry, Tasks
├── hunt-lolbins-evasion.md   HUNT-005: certutil, mshta
├── hunt-exfiltration.md      HUNT-006: DNS-Tunnel, Cloud
├── hunt-ransomware.md        HUNT-007: VSS, Backup-Stop
├── hunt-privesc.md           HUNT-008: Token, UAC
├── hunt-ad-enumeration.md    HUNT-009: BloodHound, DCSync
└── hunt-initial-access.md    HUNT-010: Makros, Phishing
```

### Externe Quellen (lokal herunterladen)
```
MITRE ATT&CK Enterprise Matrix (JSON)
  → https://github.com/mitre/cti
  → Alle Techniken, Taktiken, Gruppen, Software

MITRE ATT&CK Navigator Layers
  → Relevante Angreifer-Gruppen

Sigma Rules (Community)
  → https://github.com/SigmaHQ/sigma

LOLBAS Project (Living off the Land Binaries)
  → https://lolbas-project.github.io/
```

### Wächst mit dem Betrieb
```
Abgeschlossene Incident Reports (anonymisiert)
  → Analyst-bestätigte True Positives
  → False Positive Patterns

Bestätigte IOC-Sammlungen
  → Interne IOC-Datenbank
  → Threat Actor Zuordnungen

SOC Playbooks
  → Schritt-für-Schritt Reaktionspläne
  → Eskalationspfade
```

---

## RAG-Ablauf (wie ein Agent antwortet)

```
1. Analyst-Anfrage:
   "Was bedeutet: powershell.exe -nop -w hidden -enc SQBu..."

2. Embedding der Anfrage:
   nomic-embed-text → Vektor [0.23, -0.45, 0.67, ...]

3. Ähnlichkeitssuche in Qdrant:
   → HUNT-001 (C2/Beaconing) Confidence: 0.94
   → HUNT-005 (LOLBins) Confidence: 0.87
   → MITRE T1059.001 Confidence: 0.91

4. Kontext an LLM übergeben:
   [HUNT-001 Inhalt] + [HUNT-005 Inhalt] + [MITRE T1059.001]
   + Original-Anfrage

5. LLM generiert Antwort:
   "Basierend auf HUNT-001 (C2/Beaconing) Variante VAR-002:
    Dies ist ein PowerShell-Encoded-Command typisch für
    Cobalt Strike Stager. Confidence: 89%.
    
    Indikatoren:
    - -nop (NoProfile) + -w hidden = Stealth
    - -enc = Base64-Payload
    - Bekannte Evasion-Technik (HUNT-001 VAR-002)
    
    Empfehlung: Endpoint isolieren, HUNT-002 (LSASS) prüfen.
    Quelle: hunt-c2-beaconing.md, TP-002"

6. Antwort + Quellen → Agent → Frontend
```

---

## Hybrid-Strategie

```
Lokales Modell (90% der Fälle):
  → Routine-Triage
  → Bekannte Angriffsmuster
  → IOC-Analyse (Hashes, IPs, Domains)
  → Evidence-Interpretation
  → Alle sensitiven Daten

Claude API (10% der Fälle):
  → Unbekannte Angriffsmuster (0-Day)
  → Komplexe Ursachenanalyse
  → Report-Erstellung für Management
  → NUR anonymisierte Beschreibungen (keine Roh-IOCs)
  → Nur wenn lokales Modell nicht sicher genug (< 50% Confidence)
```

---

## Sicherheit des lokalen LLM

### Netzwerk
```
Ollama: nur localhost (127.0.0.1:11434)
Qdrant: nur localhost (127.0.0.1:6333)
Flowise: HTTPS hinter nginx, mit Auth
Kein direkter externer Zugriff auf LLM-Ports
```

### Modell-Integrität
```
Modelle von ollama.com mit SHA256-Verifikation
Keine unverifizierten Modelle in Produktion
Modell-Hashes dokumentieren
```

### Prompt Injection
```
Systemkontext ist fest (vom Backend gesetzt)
Benutzer-Inputs werden sanitized
Anweisungen aus externen Daten werden nicht ausgeführt
Maximale Output-Länge begrenzt
```

---

## Deployment (Docker Compose)

```yaml
# Auszug docker-compose.yml (Phase 17a)
services:

  ollama:
    image: ollama/ollama:latest
    volumes:
      - ollama_data:/root/.ollama
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    # Nur intern erreichbar
    expose: ["11434"]

  qdrant:
    image: qdrant/qdrant:latest
    volumes:
      - qdrant_data:/qdrant/storage
    expose: ["6333"]

  flowise:
    image: flowiseai/flowise:latest
    environment:
      - FLOWISE_USERNAME=${FLOWISE_USERNAME}
      - FLOWISE_PASSWORD=${FLOWISE_PASSWORD}
    volumes:
      - flowise_data:/root/.flowise
    expose: ["3001"]
```

---

## Roadmap-Phasen

| Phase | Inhalt | Aufwand |
|---|---|---|
| **17a** | Ollama + Qdrant + Flowise deployen, Llama 3.1 8B laden | 3 Tage |
| **17b** | Hunt-Definitionen + MITRE ATT&CK einlesen + embedden | 2 Tage |
| **17c** | Flowise RAG-Chain konfigurieren, Agent-Tools anschließen | 3 Tage |
| **17d** | Kontinuierliches Lernen: Incident Reports automatisch einlesen | 2 Tage |

---

## Kontinuierliches Lernen

```python
# Nach jedem abgeschlossenen Ticket (Status → closed):
# Incident Report automatisch in Knowledge Base einlesen

async def ingest_closed_ticket(ticket_id: str):
    ticket = await get_ticket(ticket_id)
    if ticket.status != 'closed':
        return

    # Nur bestätigte True Positives einlesen (kein FP-Lärm)
    if ticket.verdict == 'false_positive':
        return

    document = format_for_rag(ticket)
    await qdrant.upsert(
        collection='incident_reports',
        points=[document],
    )
    # Sofort verfügbar für zukünftige Analysen
```

---

## Metriken — Qualität messen

```
Wöchentlich auswerten:
  - LLM Confidence-Score pro Ticket (Trend)
  - Übereinstimmung LLM-Verdict vs. Analyst-Verdict
  - False-Positive-Rate des LLM
  - Anzahl Korrekturen durch Analysten
  - Durchschnittliche Analyse-Zeit

Ziel nach 3 Monaten Betrieb:
  - LLM-Verdict stimmt in > 85% der Fälle mit Analyst überein
  - FP-Rate < 5%
  - Analyse-Zeit < 30 Sekunden pro Ticket
```

---

## Analyse-Pipeline (implementiert) — Evidence-First + Verdict-Floors

> Stand 2026-06-14. Siehe ADR-014. Code: `backend/src/agents/`.

```
Ticket + Evidence
   │
   ▼
EvidenceBundleBuilder.build()              ─ baut EvidenceBundle
   │   ├─ WazuhAlertNormalizer.normalize() ─ Entities aus Roh-Alert:
   │   │     host · user(SID/Domain/Privilege) · process(SHA256/Signatur/Publisher)
   │   │     · file(FIM + Sysmon FileCreate) · registry · network · threatIntel(VT)
   │   └─ AgentService._enrichInventory()   ─ OS/MAC/FQDN aus Wazuh-Syscollector
   │
   ▼
RagQueryService.buildContext()             ─ optionaler Qdrant-Kontext (MITRE/Hunts/Incidents)
   │
   ▼
OllamaLlmProvider.propose()                ─ /api/generate (format=json, num_predict=2000)
   │   ├─ _buildPromptFromBundle()         ─ Prompt mit Entities + Guardrails
   │   ├─ _parse() + buildAnalysisObject() ─ JSON → analysis (snake→camelCase)
   │   │     applyAuthoritativeEntities()  ─ leere Felder aus Alert/Inventory nachfüllen
   │   ├─ _enforceOperationalErrorFloor()  ─ Benign-Floor (Scanner-Selbstfehler → false_positive)
   │   └─ _enforceEvidenceFloor()          ─ VT-Floor (malicious → suspicious/confirmed)
   │
   ▼
AgentSuggestion { proposal, rationale, verdict, confidence, analysis(JSONB) }  status=pending
   │
   ▼
Frontend AnalysisCards.tsx                 ─ Host/User/Process/File/Registry/Network
                                             + IOCs/Facts/Indicators/Missing/Actions/MITRE
   │
   ▼
Analyst approve / reject  (Human-in-the-Loop, auditiert)
```

### Verdict-Floors — warum deterministisch?

Ein schwaches 3B-Modell halluziniert (z. B. ClamAV-Lesefehler → „Malware installiert"). Harte Signale
dürfen nicht von der Modell-Laune abhängen:

| Floor | Richtung | Auslöser | Wirkung |
|---|---|---|---|
| **Benign-Floor** | herab | AV/Scanner-Selbstfehler ohne Fund | → `false_positive` / `low` |
| **Evidence-Floor** | hoch | VirusTotal ≥1 / ≥5 Engines bösartig | → `suspicious` / `confirmed_incident` |

Reihenfolge: Benign **vor** Evidence — ein echter Fund überstimmt eine fälschliche Benign-Einstufung.
Zusätzlich: **FP-Konsistenz-Guard** (`possible=false` nur bei confirmed) + Prompt-Regeln
(confirmed_facts nur belegt, SIEM-Severity ≠ Risk).

### Daten-Vertrag (wichtig bei Erweiterung)

Das Modell liefert Entities in **snake_case**, die Karten lesen **camelCase**. Gemappt wird **einmal**
in `buildAnalysisObject` (`ENTITY_FIELD_MAP`). Neue Entity-Felder ⇒ **beide** Seiten pflegen:
`ENTITY_FIELD_MAP` (Backend) + `AgentAnalysis`-Typen + `AnalysisCards.tsx` (Frontend).

### Relevante ENV

| Variable | Default | Zweck |
|---|---|---|
| `AGENT_LLM_PROVIDER` | `stub` | `ollama` für Produktion |
| `OLLAMA_MODEL` | `llama3.2:3b` | 3b schlägt 8b empirisch (s. ADR-014) |
| `OLLAMA_NUM_PREDICT` | `2000` | Output-Budget für reiches JSON |
| `OLLAMA_TIMEOUT_MS` | `120000` | CPU-Inferenz; Prod 600000 |
| `RAG_INGEST_BATCH_SIZE` | `50` | Chunk-Größe MITRE-Ingest (CPU-Embeddings) |

### Verifikation (Live-Lauf 2026-06-14, deployt, llama3.2:3b)

End-to-End gegen das laufende System, vier repräsentative Alert-Typen:

| Fall | Verdict | Floor | Entities befüllt | Dauer |
|---|---|---|---|---|
| ClamAV-Scanner-Lesefehler | `false_positive` (0.8) | **Benign** | host, process, file, registry | 158 s |
| EICAR / VirusTotal 60/70 | `confirmed_incident` (0.9) | **Evidence** | host, process, file | 156 s |
| Sysmon: unsigniert in `\Temp` (svchost-Masquerade) | `suspicious` (0.8) | — | host, process, registry (+1 IOC) | 177 s |
| Sysmon Registry IFEO/Debugger | `suspicious` (0.8) | — | host, process, file, registry | 172 s |

**Ergebnis:** Beide deterministischen Floors greifen korrekt; Entities werden über alle
Decoder-Typen befüllt; kein halluziniertes Verdict mehr (vgl. Ausgangsfall „Malware installiert").
Extraktion zusätzlich durch 56 Normalizer-Unit-Tests abgesichert.

**Bekannte Restschwäche:** `mitreAttack` und `iocs` füllt das 3B-Modell unzuverlässig (oft leer,
auch bei klarem T1546.012). Hebel: MITRE-RAG-Collection befüllen (`ingest-rag.js --mitre`), damit
der Kontext die Technik-Zuordnung liefert. Generierungsdauer ~160–180 s (num_predict=2000, CPU).
