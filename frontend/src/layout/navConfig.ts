import {
  LayoutDashboard, Ticket, Crosshair, Archive, Settings, User, ScanSearch, Server,
  ShieldCheck, Library, Shield, ShieldAlert, Activity, ScrollText, Lightbulb, BarChart3,
  ShieldOff, Bot, Boxes, ClipboardCheck, GitMerge, Antenna, FlaskConical, HardDriveUpload,
  ServerCog, Link2, Network, Target, FileCheck, BookOpen,
  type LucideIcon,
} from 'lucide-react';
import { hasRole, type Role } from '../lib/rbac';
import i18n from '../i18n';

export type NavGroup =
  | 'dashboard' | 'operations' | 'hunting' | 'detection' | 'integrations'
  | 'deployment' | 'monitoring' | 'ki' | 'services' | 'settings' | 'compliance' | 'account';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Gruppe — visuell als Abschnitt mit Überschrift gerendert (siehe Sidebar). */
  group: NavGroup;
  /** Mindest-Rolle für die Sidebar-Sichtbarkeit (UX-Gate, spiegelt den Server-`requireRole`).
   *  Ohne Angabe für alle sichtbar. NIE alleinige Sicherheitsentscheidung — Server gated. */
  minRole?: Role;
}

/** Metadaten einer Sidebar-Gruppe.
 *  `landingTo` — optionale Landing-Page-Route: ist sie gesetzt, wird der Gruppen-Header
 *  in der Sidebar zu einem anklickbaren Link auf eine Kategorie-Übersichtsseite. */
export interface NavGroupMeta {
  key: NavGroup;
  label: string;
  landingTo?: string;
  /** Icon der Kategorie — genutzt, wenn die Gruppe als einzelner Sidebar-Eintrag (Landing) rendert. */
  icon?: LucideIcon;
  /** Mindest-Rolle für die Landing-Page (spiegelt Server-Gate; nur UX/Defense-in-Depth). */
  minRole?: Role;
}

/** Reihenfolge + Anzeige-Label der Sidebar-Gruppen. Landing-Gruppen tragen ein Icon
 *  (sie rendern in der Sidebar als EIN Kategorie-Eintrag; die Unterseiten liegen auf der
 *  Übersichtsseite, nicht mehr in der Sidebar — bewusst entschlankt). */
export const NAV_GROUPS: NavGroupMeta[] = [
  { key: 'dashboard',      label: 'Dashboard' },
  { key: 'operations',     label: 'Operations' },
  { key: 'hunting',        label: 'Hunting',        landingTo: '/hunting',        icon: Crosshair },
  { key: 'detection',      label: 'Detection',      landingTo: '/detection',      icon: Shield },
  { key: 'integrations',   label: 'Integrations',   landingTo: '/integrations',   icon: Antenna },
  { key: 'deployment',     label: 'Deployment / Nodes', landingTo: '/deployment', icon: Network },
  { key: 'monitoring',     label: 'Monitoring',     landingTo: '/monitoring',     icon: Activity },
  { key: 'ki',             label: 'KI / Automation', landingTo: '/ki',            icon: Bot },
  // Services = direkter Top-Level-Eintrag (kein Landing) — reine Ops (admin-only).
  { key: 'services',       label: 'Services' },
  { key: 'settings',       label: 'Settings' },
  { key: 'compliance',     label: 'Compliance' },
  { key: 'account',        label: 'Account' },
];

export const NAV_ITEMS: NavItem[] = [
  // Dashboard
  { to: '/dashboard',    label: 'Dashboard',         icon: LayoutDashboard, group: 'dashboard' },

  // Operations — operative Analystenarbeit
  { to: '/analysis',     label: 'Analysis',          icon: ScanSearch,      group: 'operations' },
  { to: '/tickets',      label: 'Tickets',           icon: Ticket,          group: 'operations' },
  { to: '/evidence',     label: 'Evidence Center',   icon: Archive,         group: 'operations' },

  // Hunting
  { to: '/threat-hunts', label: 'Threat Hunts',      icon: Crosshair,       group: 'hunting' },
  { to: '/hunt-library', label: 'Hunt Library',      icon: Library,         group: 'hunting' },
  { to: '/hunting/settings', label: 'Threat Hunting', icon: Target,         group: 'hunting',        minRole: 'analyst' },

  // Detection — Detection-as-Code
  { to: '/detections',   label: 'Detection Library', icon: Library,         group: 'detection' },
  { to: '/mitre',        label: 'MITRE Coverage',    icon: Shield,          group: 'detection' },
  { to: '/yara',         label: 'YARA Engine',       icon: ShieldAlert,     group: 'detection' },
  { to: '/use-case-developer', label: 'Use-Case Developer', icon: Lightbulb, group: 'detection' },

  // Integrations — SIEM-Quellen: Verbindungen konfigurieren + Status
  { to: '/collectors',   label: 'Integrations',      icon: Antenna,         group: 'integrations' },
  { to: '/integrations/config', label: i18n.t('common.configuration'), icon: Link2,        group: 'integrations', minRole: 'admin' },

  // Deployment / Nodes — ausrollen, anbinden, korrelieren („bauen & verbinden")
  { to: '/deploy',       label: 'Deployment Center', icon: HardDriveUpload, group: 'deployment',     minRole: 'admin' },
  { to: '/provisioning', label: 'Provisioning',      icon: Boxes,           group: 'deployment',     minRole: 'admin' },
  { to: '/correlators',  label: 'Correlators',       icon: GitMerge,        group: 'deployment',     minRole: 'analyst' },
  { to: '/dataplane',    label: 'Data-Plane',        icon: Network,         group: 'deployment',     minRole: 'analyst' },

  // Monitoring — Betrieb & Beobachtung (Analyst-relevant, täglich); inkl. SIEM-Dashboards
  { to: '/hosts',        label: 'Hosts',             icon: Server,          group: 'monitoring' },
  { to: '/wazuh',        label: 'Wazuh Dashboard',   icon: ShieldCheck,     group: 'monitoring' },
  { to: '/qradar',       label: 'QRadar Analysis',   icon: ShieldAlert,     group: 'monitoring' },
  { to: '/soc-metrics',  label: 'SOC-Metriken',      icon: BarChart3,       group: 'monitoring',     minRole: 'engineer' },
  { to: '/system',       label: 'System & DB',       icon: Activity,        group: 'monitoring' },
  { to: '/audit',        label: 'Audit-Log',         icon: ScrollText,      group: 'monitoring',     minRole: 'analyst' },

  // KI / Automation — KI-Konfiguration, Autonomie & Evaluation an einem Ort
  { to: '/ki-agent',     label: 'KI Agent',          icon: Bot,             group: 'ki' },
  { to: '/autonomy-policies', label: 'Autonomy Policies', icon: ShieldOff,  group: 'ki',             minRole: 'admin' },
  { to: '/ml-eval',      label: 'ML-Evaluation',     icon: FlaskConical,    group: 'ki',             minRole: 'admin' },

  // Services — reine Ops (Neustarts), eigener Top-Level-Eintrag
  { to: '/services',     label: 'Services',          icon: ServerCog,       group: 'services',       minRole: 'admin' },

  // Settings — eigenständiger Top-Level-Eintrag (nicht mehr unter Administration)
  { to: '/settings',     label: 'Settings',          icon: Settings,        group: 'settings' },
  { to: '/wiki',         label: 'Wiki',              icon: BookOpen,        group: 'settings' },

  // Compliance — Readiness & Nachweisführung (kein Konformitätsnachweis)
  { to: '/compliance/nis2', label: 'NIS2 Readiness', icon: ClipboardCheck,  group: 'compliance' },
  { to: '/compliance/audit', label: 'Audit & Compliance', icon: FileCheck,  group: 'compliance',     minRole: 'analyst' },

  // Account
  { to: '/profile',      label: 'Profile',           icon: User,            group: 'account' },
];

/**
 * Sidebar-Sichtbarkeit: Items, deren `minRole` die Rolle erfüllt. Reine UX-/Defense-in-Depth-
 * Filterung (analog pageGates) — NIEMALS alleinige Sicherheitsentscheidung; die Server-
 * `requireRole`-Gates bleiben die Wahrheit. Items ohne `minRole` sind für alle sichtbar.
 */
export function visibleNavItems(role: string | undefined): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.minRole || hasRole(role, item.minRole));
}

/** Karten-Datensatz einer Landing-Page: ein Sub-Page-Ziel mit Icon, Label und Kurzbeschreibung. */
export interface LandingCard {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Kurzbeschreibung — aus dem zweiten BREADCRUMB-Tupel-Element, damit sie synchron bleibt. */
  description: string;
}

/**
 * Pure Ableitung der Landing-Karten einer Gruppe: rollengefilterte Sub-Page-Items
 * (via `visibleNavItems`) → Karten mit Beschreibung aus `BREADCRUMB`. Der Landing-Pfad
 * selbst ist kein NAV_ITEM und kann sich daher nicht selbst referenzieren.
 * Getestet in navConfig.test.ts; von CategoryLandingPage konsumiert.
 */
export function landingItemsForGroup(group: NavGroup, role: string | undefined): LandingCard[] {
  return visibleNavItems(role)
    .filter((item) => item.group === group)
    .map((item) => ({
      to: item.to,
      label: item.label,
      icon: item.icon,
      description: BREADCRUMB[item.to]?.[1] ?? '',
    }));
}

/** Breadcrumb-Label je Pfad-Präfix (für die Topbar). */
export const BREADCRUMB: Record<string, [string, string]> = {
  '/dashboard':    ['Dashboard', 'Lagebild'],
  '/analysis':     ['Analysis', 'SOC Triage'],
  '/tickets':      ['Tickets', i18n.t('nav.overview')],
  '/evidence':     ['Evidence Center', i18n.t('nav.overview')],
  // Spezifischer Pfad VOR '/hunting' (Topbar matcht per startsWith, erste Übereinstimmung).
  '/hunting/settings': ['Threat Hunting', i18n.t('nav.huntCatalogAutomation')],
  '/hunting':      ['Hunting', i18n.t('nav.huntingOverview')],
  '/threat-hunts': ['Threat Hunts', 'Hunt Console'],
  '/hunt-library': ['Hunt Library', 'Quick-Launch'],
  '/detections':   ['Detection Library', 'Wazuh Rules'],
  '/mitre':        ['MITRE ATT&CK', 'Coverage Matrix'],
  '/yara':         ['YARA Engine', 'Pattern Matching'],
  '/use-case-developer': ['Use-Case Developer', i18n.t('nav.detectionDrafts')],
  // Landing NACH den Detection-Sub-Pages: '/detection' ist Präfix von '/detections',
  // und Topbar matcht per startsWith(erste Übereinstimmung) — daher spezifischere Pfade zuerst.
  '/detection':    ['Detection', i18n.t('nav.detectionAsCodeOverview')],
  // Spezifischer Pfad VOR '/integrations' (Topbar matcht per startsWith, erste Übereinstimmung).
  '/integrations/config': [i18n.t('settings.integrationsConfig'), i18n.t('nav.connectionsKeysSecrets')],
  '/integrations': ['Integrations', i18n.t('nav.siemSourcesOverview')],
  '/collectors':   ['Integrations & Collectors', i18n.t('nav.integrationsCollectors')],
  '/dataplane':    ['Data-Plane', i18n.t('nav.correlationLiveStatus')],
  '/wazuh':        ['Wazuh Dashboard', 'Real-time Monitoring'],
  '/qradar':       ['QRadar Analysis', 'IBM QRadar SIEM'],
  '/monitoring':   ['Monitoring', i18n.t('nav.opsObservabilityOverview')],
  '/hosts':        ['Hosts', 'Asset- & System-Inventar'],
  '/soc-metrics':  ['SOC-Metriken', i18n.t('app.teamPerformanceDetectionQuality')],
  '/system':       [i18n.t('settings.systemDatabase'), 'Live-Status'],
  '/audit':        ['Audit-Log', 'Sicherheitsprotokoll'],
  '/ki-agent':     ['KI Agent', i18n.t('settings.aiConfiguration')],
  // '/ki' NACH '/ki-agent' (Topbar matcht startsWith, erste Übereinstimmung).
  '/ki':           ['KI / Automation', i18n.t('nav.aiOverview')],
  '/services':     ['Services', i18n.t('nav.servicesSubtitle')],
  '/ml-eval':      ['ML-Evaluation', 'Admin — Routing-Policy & Eval-Snapshot'],
  '/autonomy-policies':  ['Autonomy Policies', i18n.t('autonomy.adminPolicyManagement')],
  '/provisioning': ['Provisioning', 'Admin — Node-Registry & Enrollment'],
  // '/deployment' NACH '/deploy' wäre falsch — '/deploy' ist Präfix von '/deployment';
  // Topbar matcht startsWith → spezifischeres/längeres... hier reicht: /deployment zuerst.
  '/deployment':   ['Deployment / Nodes', i18n.t('nav.opsOverview')],
  '/deploy':       ['Deployment Center', 'Admin — Network as Code (VM-Deploy, gegated)'],
  '/correlators':  ['Correlation Operations Center', 'Registry · Config · Approval'],
  '/settings':     ['Settings', 'System'],
  '/wiki':         ['Wiki', i18n.t('nav.internalDocs')],
  '/compliance/nis2': ['NIS2 Readiness', 'Readiness & Evidence'],
  '/compliance/audit': ['Audit & Compliance', i18n.t('nav.auditAndRetention')],
  '/profile':      ['Profile', i18n.t('nav.account')],
};
