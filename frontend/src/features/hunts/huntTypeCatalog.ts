// Hunt-Typ-Katalog (Frontend) — Anzeige + Default-Targets fürs New-Hunt-Modal.
// Muss mit backend/src/threatHunting/domain/HuntType.js übereinstimmen.

export interface HuntTypeMeta {
  key: string;
  label: string;
  defaultTarget: string;
  defaultTargetType: 'host' | 'ip' | 'ticket';
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  description: string;
}

export const HUNT_TYPES: HuntTypeMeta[] = [
  {
    key: 'suspicious_powershell_hunt',
    label: 'Suspicious PowerShell Hunt',
    defaultTarget: 'Windows-01',
    defaultTargetType: 'host',
    riskLevel: 'high',
    description: 'Encoded/obfuscated PowerShell-Ausführung auf Windows-Hosts.',
  },
  {
    key: 'opnsense_multicast_review',
    label: 'OPNsense Multicast Review',
    defaultTarget: 'OPNsense-fw',
    defaultTargetType: 'host',
    riskLevel: 'low',
    description: 'Multicast-/mDNS-Firewall-Rauschen (FP-Kandidat) prüfen.',
  },
  {
    key: 'rdp_exposure_hunt',
    label: 'RDP Exposure Hunt',
    defaultTarget: 'Server-01',
    defaultTargetType: 'host',
    riskLevel: 'medium',
    description: 'Exponierten RDP-Dienst (Port 3389) aufspüren.',
  },
  {
    key: 'persistence_hunt',
    label: 'Persistence Hunt',
    defaultTarget: 'Windows-01',
    defaultTargetType: 'host',
    riskLevel: 'medium',
    description: 'Run-Keys, Scheduled Tasks, Services und Autoruns auf Persistenz prüfen.',
  },
  {
    key: 'failed_logon_hunt',
    label: 'Failed Logon Hunt',
    defaultTarget: 'Linux-01',
    defaultTargetType: 'host',
    riskLevel: 'medium',
    description: 'Brute-Force-/Password-Spraying-Muster über gehäufte Logon-Fehler.',
  },
  {
    key: 'dns_tunneling_hunt',
    label: 'DNS Tunneling Hunt',
    defaultTarget: 'DNS-01',
    defaultTargetType: 'host',
    riskLevel: 'medium',
    description: 'DNS-Exfiltration/-Tunneling über hochentropische Subdomains.',
  },
  {
    key: 'scheduled_tasks_hunt',
    label: 'Scheduled Tasks Hunt',
    defaultTarget: 'Windows-01',
    defaultTargetType: 'host',
    riskLevel: 'medium',
    description: 'Verdächtige geplante Aufgaben (schtasks) als Persistenz/Ausführung.',
  },
  {
    key: 'services_hunt',
    label: 'Services Hunt',
    defaultTarget: 'Windows-01',
    defaultTargetType: 'host',
    riskLevel: 'medium',
    description: 'Windows-Dienste mit ungewöhnlichen/unsignierten Binärpfaden.',
  },
  {
    key: 'autoruns_hunt',
    label: 'Autoruns Hunt',
    defaultTarget: 'Windows-01',
    defaultTargetType: 'host',
    riskLevel: 'medium',
    description: 'Autostart-Persistenz: Run/RunOnce-Keys und Startup-Ordner.',
  },
  {
    key: 'remote_access_tools_hunt',
    label: 'Remote Access Tools Hunt',
    defaultTarget: 'Windows-01',
    defaultTargetType: 'host',
    riskLevel: 'medium',
    description: 'RMM-/Remote-Access-Tools (AnyDesk, TeamViewer, ngrok …) aufspüren.',
  },
  {
    key: 'lsass_access_hunt',
    label: 'LSASS Access Hunt',
    defaultTarget: 'Windows-01',
    defaultTargetType: 'host',
    riskLevel: 'critical',
    description: 'Zugriff auf lsass.exe (Sysmon Event 10) — Credential-Dumping-Indikator.',
  },
  {
    key: 'lateral_movement_hunt',
    label: 'Lateral Movement Hunt (PsExec)',
    defaultTarget: 'Windows-02',
    defaultTargetType: 'host',
    riskLevel: 'high',
    description: 'PsExec-artige laterale Bewegung: PSEXESVC-Dienst über ADMIN$.',
  },
  {
    key: 'bits_jobs_hunt',
    label: 'BITS Jobs Hunt',
    defaultTarget: 'Windows-01',
    defaultTargetType: 'host',
    riskLevel: 'medium',
    description: 'Missbräuchliche BITS-Transfer-Jobs (bitsadmin / Start-BitsTransfer).',
  },
  {
    key: 'wmi_persistence_hunt',
    label: 'WMI Persistence Hunt',
    defaultTarget: 'Windows-01',
    defaultTargetType: 'host',
    riskLevel: 'high',
    description: 'WMI-Event-Subscription-Persistenz (__EventFilter/Consumer/Binding).',
  },
  {
    key: 'token_theft_hunt',
    label: 'Token Theft Hunt',
    defaultTarget: 'Windows-01',
    defaultTargetType: 'host',
    riskLevel: 'high',
    description: 'Access-Token-Diebstahl/-Impersonation (Logon Type 9, SeImpersonate) zur Rechteausweitung.',
  },
  {
    key: 'asrep_roasting_hunt',
    label: 'AS-REP Roasting Hunt',
    defaultTarget: 'DC01',
    defaultTargetType: 'host',
    riskLevel: 'high',
    description: 'Kerberos-AS-REQ ohne Pre-Auth (Event 4768, RC4) — crackbare AS-REP-Hashes.',
  },
  {
    key: 'shadow_copy_deletion_hunt',
    label: 'Shadow Copy Deletion Hunt',
    defaultTarget: 'Windows-01',
    defaultTargetType: 'host',
    riskLevel: 'critical',
    description: 'Löschen von Volume Shadow Copies (vssadmin/wmic/bcdedit) — Ransomware-Vorstufe.',
  },
];

export function getHuntTypeMeta(key: string): HuntTypeMeta | undefined {
  return HUNT_TYPES.find((t) => t.key === key);
}
