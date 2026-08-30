// Hunt-Typ-Katalog (Frontend) — Anzeige + Default-Targets fürs New-Hunt-Modal.
// Muss mit backend/src/threatHunting/domain/HuntType.js übereinstimmen.

import i18n from '../../i18n';

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
    description: i18n.t('ui.encodedObfuscatedPowershellExecutionWindows'),
  },
  {
    key: 'opnsense_multicast_review',
    label: 'OPNsense Multicast Review',
    defaultTarget: 'OPNsense-fw',
    defaultTargetType: 'host',
    riskLevel: 'low',
    description: i18n.t('ui.reviewMulticastMdnsFirewallNoise'),
  },
  {
    key: 'rdp_exposure_hunt',
    label: 'RDP Exposure Hunt',
    defaultTarget: 'Server-01',
    defaultTargetType: 'host',
    riskLevel: 'medium',
    description: i18n.t('ui.trackDownExposedRdpService'),
  },
  {
    key: 'persistence_hunt',
    label: 'Persistence Hunt',
    defaultTarget: 'Windows-01',
    defaultTargetType: 'host',
    riskLevel: 'medium',
    description: i18n.t('ui.checkRunKeysScheduledTasks'),
  },
  {
    key: 'failed_logon_hunt',
    label: 'Failed Logon Hunt',
    defaultTarget: 'Linux-01',
    defaultTargetType: 'host',
    riskLevel: 'medium',
    description: i18n.t('ui.bruteForcePasswordSprayingPatterns'),
  },
  {
    key: 'dns_tunneling_hunt',
    label: 'DNS Tunneling Hunt',
    defaultTarget: 'DNS-01',
    defaultTargetType: 'host',
    riskLevel: 'medium',
    description: i18n.t('ui.dnsExfiltrationTunnellingViaHigh'),
  },
  {
    key: 'scheduled_tasks_hunt',
    label: 'Scheduled Tasks Hunt',
    defaultTarget: 'Windows-01',
    defaultTargetType: 'host',
    riskLevel: 'medium',
    description: i18n.t('ui.suspiciousScheduledTasksSchtasksUsed'),
  },
  {
    key: 'services_hunt',
    label: 'Services Hunt',
    defaultTarget: 'Windows-01',
    defaultTargetType: 'host',
    riskLevel: 'medium',
    description: i18n.t('ui.windowsServicesUnusualUnsignedBinary'),
  },
  {
    key: 'autoruns_hunt',
    label: 'Autoruns Hunt',
    defaultTarget: 'Windows-01',
    defaultTargetType: 'host',
    riskLevel: 'medium',
    description: i18n.t('ui.autostartPersistenceRunRunonceKeys'),
  },
  {
    key: 'remote_access_tools_hunt',
    label: 'Remote Access Tools Hunt',
    defaultTarget: 'Windows-01',
    defaultTargetType: 'host',
    riskLevel: 'medium',
    description: i18n.t('ui.trackDownRmmRemoteAccess'),
  },
  {
    key: 'lsass_access_hunt',
    label: 'LSASS Access Hunt',
    defaultTarget: 'Windows-01',
    defaultTargetType: 'host',
    riskLevel: 'critical',
    description: i18n.t('detection.lsassAccess'),
  },
  {
    key: 'lateral_movement_hunt',
    label: 'Lateral Movement Hunt (PsExec)',
    defaultTarget: 'Windows-02',
    defaultTargetType: 'host',
    riskLevel: 'high',
    description: i18n.t('ui.psexecStyleLateralMovementPsexesvc'),
  },
  {
    key: 'bits_jobs_hunt',
    label: 'BITS Jobs Hunt',
    defaultTarget: 'Windows-01',
    defaultTargetType: 'host',
    riskLevel: 'medium',
    description: i18n.t('ui.abusiveBitsTransferJobsBitsadmin'),
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
    description: i18n.t('ui.accessTokenTheftImpersonationLogon'),
  },
  {
    key: 'asrep_roasting_hunt',
    label: 'AS-REP Roasting Hunt',
    defaultTarget: 'DC01',
    defaultTargetType: 'host',
    riskLevel: 'high',
    description: i18n.t('detection.kerberosNoPreauth'),
  },
  {
    key: 'shadow_copy_deletion_hunt',
    label: 'Shadow Copy Deletion Hunt',
    defaultTarget: 'Windows-01',
    defaultTargetType: 'host',
    riskLevel: 'critical',
    description: i18n.t('ui.deletionVolumeShadowCopiesVssadmin'),
  },
];

export function getHuntTypeMeta(key: string): HuntTypeMeta | undefined {
  return HUNT_TYPES.find((t) => t.key === key);
}
