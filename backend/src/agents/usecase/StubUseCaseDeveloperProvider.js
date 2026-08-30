'use strict';

/**
 * StubUseCaseDeveloperProvider — deterministischer Platzhalter ohne echtes LLM.
 *
 * Erzeugt immer denselben, vollständig ausgefüllten UseCaseDraft.
 * Dient als:
 *   - Default in Tests/Dev, solange kein lokales Modell angebunden ist
 *   - Stabile Basis für Service-/Route-Tests des Orchestrators
 *   - Niemals zufällig → Tests bleiben reproduzierbar
 *
 * Alle Testfälle sind synthetisch/PII-minimiert (DSGVO Art. 25).
 */
class StubUseCaseDeveloperProvider {
  constructor() {
    this.name = 'stub-usecase-developer-v1';
  }

  /**
   * Gibt deterministisch einen vollständigen, validen UseCaseDraft zurück.
   * Ignoriert den Kontext bewusst — Stub = stabile Baseline, kein Context-Parsing.
   *
   * @param {object} _context — ignoriert
   * @returns {Promise<object>} vollständiger UseCaseDraft
   */
  async develop(_context) {
    return {
      title:         'Verdächtiger PowerShell-Prozess mit EncodedCommand',
      description:
        'Erkennt PowerShell-Aufrufe mit dem Parameter -EncodedCommand oder -enc, '
        + 'die häufig zur Verschleierung von Malware-Befehlen verwendet werden.',
      detectionGoal:
        'True-Positive-Nachweis für obfuskierte PowerShell-Ausführung '
        + '(T1059.001 / Execution via PowerShell).',
      dataSources: [
        'Sysmon EventID 1 (Process Creation)',
        'Windows Security Event 4688',
        'Wazuh rule 92200 (Sysmon Process Creation)',
      ],
      requiredFields: [
        'process.name',
        'process.command_line',
        'event.id',
        'agent.name',
      ],
      detectionLogic: {
        language:    'Sigma',
        queryOrRule:
          'title: Suspicious PowerShell EncodedCommand\n'
          + 'logsource:\n  category: process_creation\n  product: windows\n'
          + 'detection:\n  selection:\n    Image|endswith: \'\\powershell.exe\'\n'
          + '    CommandLine|contains|any:\n      - \'-EncodedCommand\'\n      - \' -enc \'\n'
          + '  condition: selection\n'
          + 'falsepositives:\n  - Legitime Deployment-Skripte\n  - SCCM/Ansible\n'
          + 'level: high',
        explanation:
          'Matcht Process-Creation-Events für powershell.exe mit EncodedCommand-Parametern. '
          + 'Base64-kodierte Befehle sind ein klassisches Obfuskierungsmuster.',
      },
      mitre: [
        { tactic: 'Execution',        technique: 'T1059.001 – PowerShell' },
        { tactic: 'Defense Evasion',  technique: 'T1027 – Obfuscated Files or Information' },
      ],
      severity:   'high',
      confidence: 75,
      falsePositiveRisks: [
        'SCCM/ConfigMgr-Deployment-Skripte verwenden EncodedCommand legitim',
        'Ansible-WinRM-Module base64-kodieren Payloads standardmäßig',
        'Eigene Admin-Skripte mit Sonderzeichen im Pfad',
      ],
      testCases: [
        {
          name: 'TP: Verdächtiger EncodedCommand vom User-Kontext',
          type: 'true_positive',
          event: {
            note:        'synthetisch — kein echter Hostname/User/IP',
            image:       'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
            commandLine: 'powershell.exe -EncodedCommand aABlAGwAbABvAA==',
            parentImage: 'C:\\Windows\\System32\\cmd.exe',
            user:        'EXAMPLE\\user01',
            host:        'PC-001.example.internal',
          },
          expectedResult: 'Alarm ausgelöst — EncodedCommand erkannt',
        },
        {
          name: 'FP: SCCM-Deployment-Skript',
          type: 'false_positive',
          event: {
            note:        'synthetisch — SCCM-Kontext',
            image:       'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
            commandLine: 'powershell.exe -EncodedCommand <base64-sccm-install>',
            parentImage: 'C:\\Windows\\CCM\\CcmExec.exe',
            user:        'NT AUTHORITY\\SYSTEM',
            host:        'PC-002.example.internal',
          },
          expectedResult:
            'Alarm ausgelöst, aber FP-Ausnahme via Parent-Prozess CcmExec.exe möglich',
        },
      ],
      recommendedActions: [
        'CommandLine dekodieren (Base64) und auf bekannte Malware-Muster prüfen',
        'Parent-Prozess verifizieren — CcmExec.exe, Ansible, WinRM als mögliche FP-Quelle',
        'Hash des PowerShell-Skripts gegen VirusTotal prüfen',
        'Netzwerkverbindungen des Prozesses auf C2-Muster untersuchen',
      ],
      playbookSteps: [
        '1. Alarm bestätigen: Ticket öffnen, Zeitstempel und Host notieren',
        '2. CommandLine aus dem Event extrahieren und Base64 dekodieren',
        '3. Dekodierten Befehl auf IOCs (URLs, IPs, Registry-Keys) analysieren',
        '4. Parent-Prozess identifizieren — legitim (SCCM/Ansible) → FP schließen',
        '5. Hash und Module des PowerShell-Prozesses per VirusTotal prüfen',
        '6. Netzwerkverbindungen des Prozesses im SIEM abfragen (letzten 24h)',
        '7. Eskalation zu Tier-2 wenn IOCs gefunden oder unbekannter Parent',
      ],
      // Pflichtfelder
      status:      'draft',
      generatedBy: 'stub',
      model:       this.name,
    };
  }
}

module.exports = { StubUseCaseDeveloperProvider };
