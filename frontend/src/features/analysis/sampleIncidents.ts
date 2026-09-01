import type { Ticket } from '../../lib/types';

type SampleTicket = Pick<Ticket, 'title'> & Partial<Ticket>;
const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const demo = (data: SampleTicket): SampleTicket => ({
  ...data,
  source: 'manual',
  state: 'OPEN',
  status: 'assigned',
  analyst: 'Demo SOC Analyst',
  customer: 'Nexora Training Lab',
  offenseId: `DEMO-${data.mitre ?? 'CASE'}`,
  os: data.os ?? 'Windows 11 Enterprise 23H2',
  mac: data.mac ?? '00:15:5D:01:20:41',
  srcFqdn: data.srcFqdn ?? 'admin-ws-01.training.internal',
  dstFqdn: data.dstFqdn ?? `${data.hostname?.toLowerCase() ?? 'target'}.training.internal`,
  postNatSrc: data.postNatSrc ?? data.srcIp,
  postNatDst: data.postNatDst ?? data.dstIp,
  bytesSent: data.bytesSent ?? '18432',
  bytesRecv: data.bytesRecv ?? '9321',
  pktsSent: data.pktsSent ?? '44',
  pktsRecv: data.pktsRecv ?? '31',
  firewallAction: data.firewallAction ?? 'permitted',
  eventCount: data.eventCount ?? '6',
  description: `Synthetic training case mapped to ${data.mitre}. ${data.description ?? ''}`.trim(),
  logs: [
    '[Wazuh] Normalized alert correlated with ATT&CK technique.',
    `[Windows Security/Sysmon] ${data.logs ?? 'Process and logon telemetry available.'}`,
    `[Zeek/Firewall] ${data.srcIp ?? '10.10.20.41'} → ${data.dstIp ?? '10.10.20.52'} ${data.protocol ?? 'TCP'}:${data.port ?? '445'} action=permitted bytes=18432/9321`,
    `[Internal ICMP] Echo request/reply between ${data.srcIp ?? '10.10.20.41'} and ${data.dstIp ?? '10.10.20.52'}; 3 probes, RTT 1.2–1.8 ms.`,
  ].join('\n'),
  payloads: [
    { type: 'Command', raw: data.commandLine ?? `${data.process ?? 'unknown.exe'} observed by Sysmon`, fields: { source: 'Sysmon Event ID 1', host: data.hostname ?? 'target' } },
    { type: 'IP', raw: data.srcIp ?? '10.10.20.41', fields: { source: 'Zeek conn.log', role: 'source' } },
    { type: 'Andere', raw: `ICMP echo ${data.srcIp ?? '10.10.20.41'} -> ${data.dstIp ?? '10.10.20.52'}`, fields: { source: 'Firewall + Zeek', probes: '3' } },
  ],
});

/** Synthetic ATT&CK use cases; all IPs are RFC 5737 documentation addresses. */
export function buildSampleIncidents(): SampleTicket[] {
  return [
    demo({ title: 'T1021.002 — SMB admin-share transfer and remote service', priority: 'critical', category: 'Lateral Movement', description: 'ADMIN$ write followed by service creation on the destination host.', iocs: '198.51.100.41\nC:\\Windows\\Temp\\winupd.exe', logs: '5145 ADMIN$\\Temp\\winupd.exe; 7045 ServiceName=WinUpdateSvc ImagePath=C:\\Windows\\Temp\\winupd.exe', srcIp: '10.10.20.41', dstIp: '10.10.20.52', hostname: 'FILE-01', user: 'DEMO\\svc_backup', port: '445', protocol: 'SMB', process: 'services.exe', commandLine: 'sc create WinUpdateSvc binPath= C:\\Windows\\Temp\\winupd.exe', mitre: 'T1021.002' }),
    demo({ title: 'T1021.006 — WinRM remote PowerShell', priority: 'high', category: 'Lateral Movement', description: 'WinRM remote session spawned PowerShell on the target server.', iocs: '198.51.100.42\nInvoke-Command', logs: '4624 LogonType=3; Sysmon 1 ParentImage=wsmprovhost.exe Image=powershell.exe', srcIp: '10.10.20.42', dstIp: '10.10.20.61', hostname: 'APP-01', user: 'DEMO\\helpdesk01', port: '5985', protocol: 'HTTP', process: 'powershell.exe', commandLine: 'Invoke-Command -ComputerName APP-01', mitre: 'T1021.006' }),
    demo({ title: 'T1047 — WMI remote process creation', priority: 'high', category: 'Lateral Movement', description: 'Remote WMI execution created cmd.exe through WmiPrvSE.exe.', iocs: '198.51.100.43\nwmic.exe', logs: 'WMI-Activity 5857 ClientMachine=ADMIN-WS-01; Sysmon 1 ParentImage=WmiPrvSE.exe Image=cmd.exe', srcIp: '10.10.20.43', dstIp: '10.10.20.72', hostname: 'ENG-WS-04', user: 'DEMO\\it.admin', process: 'cmd.exe', commandLine: 'cmd /c whoami > C:\\Windows\\Temp\\whoami.txt', mitre: 'T1047' }),
    demo({ title: 'T1569.002 — PsExec-style service execution', priority: 'critical', category: 'Lateral Movement', description: 'Short-lived PSEXESVC service ran after an ADMIN$ transfer.', iocs: 'PSEXESVC.exe\n198.51.100.44', logs: '5145 ADMIN$\\PSEXESVC.exe; 7045 ServiceName=PSEXESVC; Sysmon 1 Image=PSEXESVC.exe', srcIp: '10.10.20.44', dstIp: '10.10.20.73', hostname: 'DB-01', user: 'DEMO\\domain.admin', port: '445', protocol: 'SMB', process: 'PSEXESVC.exe', mitre: 'T1569.002' }),
    demo({ title: 'T1550.002 — Pass-the-Hash against file server', priority: 'critical', category: 'Lateral Movement', description: 'Anomalous NTLM network logon followed by C$ access.', iocs: '198.51.100.45\nDEMO\\administrator', logs: '4624 LogonType=3 AuthenticationPackage=NTLM WorkstationName=UNKNOWN-WS; 5140 ShareName=\\\\FILE-02\\C$', srcIp: '10.10.20.45', dstIp: '10.10.20.53', hostname: 'FILE-02', user: 'DEMO\\administrator', port: '445', protocol: 'SMB', mitre: 'T1550.002' }),
    demo({ title: 'T1563.002 — RDP session hijacking via tscon', priority: 'high', category: 'Lateral Movement', description: 'SYSTEM attached to another user session without reauthentication.', iocs: 'tscon.exe\nrdp-tcp#5', logs: 'Sysmon 1 User=NT AUTHORITY\\SYSTEM Image=tscon.exe CommandLine=tscon 4 /dest:rdp-tcp#5; TerminalServices 25', hostname: 'RDS-01', process: 'tscon.exe', commandLine: 'tscon 4 /dest:rdp-tcp#5', mitre: 'T1563.002' }),
    demo({ title: 'T1021.001 — RDP password guessing and success', priority: 'high', category: 'Lateral Movement', description: 'Forty-seven failed RDP logons followed by one successful interactive logon.', iocs: '198.51.100.46', logs: '4625 Count=47 TargetUserName=DEMO\\j.smith; 4624 LogonType=10', srcIp: '198.51.100.46', dstIp: '10.10.20.81', hostname: 'RDS-02', user: 'DEMO\\j.smith', port: '3389', protocol: 'TCP', mitre: 'T1021.001' }),
    demo({ title: 'T1053.005 — Remote scheduled task execution', priority: 'high', category: 'Lateral Movement', description: 'Remote schtasks request created a one-time encoded PowerShell task.', iocs: '198.51.100.47\nUpdateTelemetry', logs: 'TaskScheduler 106 TaskName=\\UpdateTelemetry; Security 4698; TaskContent=powershell -enc', srcIp: '10.10.20.47', dstIp: '10.10.20.82', hostname: 'OPS-01', user: 'DEMO\\ops.admin', process: 'schtasks.exe', commandLine: 'schtasks /create /s OPS-01 /tn UpdateTelemetry /tr powershell -enc SQBFAFgA', mitre: 'T1053.005' }),
    demo({ title: 'T1021.004 — SSH remote service with new key', priority: 'medium', category: 'Lateral Movement', description: 'New SSH public key authenticated from an unusual internal source.', iocs: '198.51.100.48\nSHA256:demoKeyFingerprint', logs: 'sshd Accepted publickey for deploy from 10.10.20.48; auditd USER_AUTH', srcIp: '10.10.20.48', dstIp: '10.10.20.91', hostname: 'LINUX-APP-01', user: 'deploy', port: '22', protocol: 'SSH', process: 'sshd', mitre: 'T1021.004' }),
    demo({ title: 'T1003.006 — DCSync replication from workstation', priority: 'critical', category: 'Credential Access', description: 'Non-DC account requested directory replication, enabling credential theft and follow-on movement.', iocs: '198.51.100.49\nDS-Replication-Get-Changes', logs: '4662 SubjectUserName=DEMO\\svc_sync ObjectType=domainDNS ControlAccess=DS-Replication-Get-Changes', srcIp: '10.10.20.49', dstIp: '10.10.20.10', hostname: 'DC-01', user: 'DEMO\\svc_sync', process: 'lsass.exe', mitre: 'T1003.006' }),
  ].map((ticket, index) => {
    const lastSeen = at(index * 7);
    return { ...ticket, datetime: at(index * 7 + 4), firstSeen: at(index * 7 + 6), lastSeen };
  });
}
