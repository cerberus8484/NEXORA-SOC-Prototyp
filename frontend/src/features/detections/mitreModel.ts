export interface MitreTechnique {
  id: string;
  name: string;
}

export interface MitreTactic {
  id: string;
  name: string;
  techniques: MitreTechnique[];
}

/** Statisches ATT&CK-Subset — häufigste Techniken je Taktik (Wazuh-relevant). */
export const MITRE_MATRIX: MitreTactic[] = [
  {
    id: 'TA0001', name: 'Initial Access',
    techniques: [
      { id: 'T1190', name: 'Exploit Public-Facing Application' },
      { id: 'T1133', name: 'External Remote Services' },
      { id: 'T1566', name: 'Phishing' },
      { id: 'T1078', name: 'Valid Accounts' },
      { id: 'T1195', name: 'Supply Chain Compromise' },
    ],
  },
  {
    id: 'TA0002', name: 'Execution',
    techniques: [
      { id: 'T1059', name: 'Command & Scripting Interpreter' },
      { id: 'T1053', name: 'Scheduled Task/Job' },
      { id: 'T1569', name: 'System Services' },
      { id: 'T1204', name: 'User Execution' },
      { id: 'T1106', name: 'Native API' },
    ],
  },
  {
    id: 'TA0003', name: 'Persistence',
    techniques: [
      { id: 'T1543', name: 'Create/Modify System Process' },
      { id: 'T1547', name: 'Boot/Logon Autostart Execution' },
      { id: 'T1053', name: 'Scheduled Task/Job' },
      { id: 'T1505', name: 'Server Software Component' },
      { id: 'T1136', name: 'Create Account' },
    ],
  },
  {
    id: 'TA0004', name: 'Privilege Escalation',
    techniques: [
      { id: 'T1548', name: 'Abuse Elevation Control Mechanism' },
      { id: 'T1078', name: 'Valid Accounts' },
      { id: 'T1055', name: 'Process Injection' },
      { id: 'T1134', name: 'Access Token Manipulation' },
      { id: 'T1611', name: 'Escape to Host' },
    ],
  },
  {
    id: 'TA0005', name: 'Defense Evasion',
    techniques: [
      { id: 'T1562', name: 'Impair Defenses' },
      { id: 'T1070', name: 'Indicator Removal' },
      { id: 'T1036', name: 'Masquerading' },
      { id: 'T1055', name: 'Process Injection' },
      { id: 'T1218', name: 'System Binary Proxy Execution' },
    ],
  },
  {
    id: 'TA0006', name: 'Credential Access',
    techniques: [
      { id: 'T1003', name: 'OS Credential Dumping' },
      { id: 'T1110', name: 'Brute Force' },
      { id: 'T1552', name: 'Unsecured Credentials' },
      { id: 'T1555', name: 'Credentials from Password Stores' },
      { id: 'T1040', name: 'Network Sniffing' },
    ],
  },
  {
    id: 'TA0007', name: 'Discovery',
    techniques: [
      { id: 'T1082', name: 'System Information Discovery' },
      { id: 'T1083', name: 'File & Directory Discovery' },
      { id: 'T1057', name: 'Process Discovery' },
      { id: 'T1049', name: 'System Network Connections Discovery' },
      { id: 'T1087', name: 'Account Discovery' },
    ],
  },
  {
    id: 'TA0008', name: 'Lateral Movement',
    techniques: [
      { id: 'T1021', name: 'Remote Services' },
      { id: 'T1550', name: 'Use Alternate Auth Material' },
      { id: 'T1534', name: 'Internal Spearphishing' },
      { id: 'T1570', name: 'Lateral Tool Transfer' },
    ],
  },
  {
    id: 'TA0009', name: 'Collection',
    techniques: [
      { id: 'T1005', name: 'Data from Local System' },
      { id: 'T1074', name: 'Data Staged' },
      { id: 'T1560', name: 'Archive Collected Data' },
      { id: 'T1113', name: 'Screen Capture' },
    ],
  },
  {
    id: 'TA0011', name: 'Command & Control',
    techniques: [
      { id: 'T1071', name: 'Application Layer Protocol' },
      { id: 'T1095', name: 'Non-Application Layer Protocol' },
      { id: 'T1572', name: 'Protocol Tunneling' },
      { id: 'T1105', name: 'Ingress Tool Transfer' },
      { id: 'T1132', name: 'Data Encoding' },
    ],
  },
  {
    id: 'TA0010', name: 'Exfiltration',
    techniques: [
      { id: 'T1041', name: 'Exfiltration Over C2 Channel' },
      { id: 'T1048', name: 'Exfiltration Over Alt Protocol' },
      { id: 'T1567', name: 'Exfiltration Over Web Service' },
    ],
  },
  {
    id: 'TA0040', name: 'Impact',
    techniques: [
      { id: 'T1486', name: 'Data Encrypted for Impact' },
      { id: 'T1489', name: 'Service Stop' },
      { id: 'T1485', name: 'Data Destruction' },
      { id: 'T1491', name: 'Defacement' },
    ],
  },
];

/** Normalisiert eine Technik-ID auf den Stamm (T1059.001 → T1059). */
export function normalizeTechniqueId(id: string): string {
  return id.split('.')[0].toUpperCase();
}

/** Gibt Set der abgedeckten normalisierten Technik-IDs zurück. */
export function buildCoverageSet(mitreIds: string[]): Set<string> {
  return new Set(mitreIds.map(normalizeTechniqueId));
}

/**
 * Kombiniert die Abdeckung aus Wazuh-Detection-Regeln UND dem Hunt-Katalog.
 * Hunts mit leerer MITRE-ID (FP-/Exposure-Hunts) werden ignoriert. Sub-Techniken
 * werden auf den Stamm normalisiert und über beide Quellen dedupliziert.
 */
export function buildCombinedCoverageSet(
  ruleMitreIds: string[],
  huntItems: ReadonlyArray<{ mitre: string }>,
): Set<string> {
  const huntIds = huntItems.map((h) => h.mitre).filter((id) => id.length > 0);
  return buildCoverageSet([...ruleMitreIds, ...huntIds]);
}
