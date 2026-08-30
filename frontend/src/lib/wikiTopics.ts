// Zentrale Themen-Registry fuer Tooltips: pro konfigurierbarer Funktion ein kurzer Hinweis
// plus ein interner Wiki-Slug. Komponenten referenzieren nur den Topic-Key.

import i18n from '../i18n';

export interface WikiTopic {
  hint: string;
  slug: string;
}

export const WIKI_TOPICS = {
  integrationen: {
    hint: i18n.t('wiki.connectExternalSourcesMonitorTheir'),
    slug: 'admin/integrationen',
  },
  wazuh: {
    hint: i18n.t('wiki.wazuhPrimarySourceAlertsAgents'),
    slug: 'admin/integrationen',
  },
  'threat-intel': {
    hint: i18n.t('wiki.threatIntelEnrichesIpsHashes'),
    slug: 'admin/integrationen',
  },
  sicherheit: {
    hint: i18n.t('wiki.authenticationMfaSessionHardeningPassword'),
    slug: 'admin/sicherheit',
  },
  oidc: {
    hint: i18n.t('wiki.singleSignThroughOidcProvider'),
    slug: 'admin/sicherheit',
  },
  mfa: {
    hint: i18n.t('wiki.twoFactorAuthenticationViaTotp'),
    slug: 'admin/sicherheit',
  },
  'benutzer-rollen': {
    hint: i18n.t('wiki.createUsersAssignRolesCarefully'),
    slug: 'admin/benutzer-und-rollen',
  },
  'ki-agent': {
    hint: i18n.t('wiki.llmProviderAiSTriage'),
    slug: 'admin/ki-agent',
  },
  benachrichtigungen: {
    hint: i18n.t('wiki.emailWebhookNotificationsImportantEvents'),
    slug: 'admin/benachrichtigungen',
  },
  retention: {
    hint: i18n.t('wiki.retentionPeriodsTicketsEvidenceAudit'),
    slug: 'admin/speicherung-retention',
  },
  branding: {
    hint: i18n.t('wiki.displayNameColoursVisualAppearance'),
    slug: 'admin/branding',
  },
  audit: {
    hint: i18n.t('wiki.auditLogSecurityRelevantActions'),
    slug: 'admin/audit-compliance',
  },
  autonomy: {
    hint: i18n.t('wiki.autonomyPoliciesDefineWhatMay'),
    slug: 'admin/autonomy-policies',
  },
  provisioning: {
    hint: i18n.t('wiki.registerRollOutNodesAgents'),
    slug: 'admin/provisioning',
  },
  correlation: {
    hint: i18n.t('wiki.correlationEngineBringsSignalsTogether'),
    slug: 'admin/correlation-engine',
  },
  'api-webhooks': {
    hint: i18n.t('wiki.apiTokensWebhookInputsTraceable'),
    slug: 'admin/audit-compliance',
  },
  mitre: {
    hint: i18n.t('wiki.mitreHelpsYouClassifyYour'),
    slug: 'bedienung/detections',
  },
  hunts: {
    hint: i18n.t('wiki.startThreatHuntingSessionsAgainst'),
    slug: 'bedienung/hunts',
  },
  'use-case-developer': {
    hint: i18n.t('wiki.developUseCasesDetectionIdeas'),
    slug: 'bedienung/detections',
  },
  containment: {
    hint: i18n.t('wiki.containmentDeliberateActionAgainstTarget'),
    slug: 'bedienung/deployment-center',
  },
  services: {
    hint: i18n.t('text.whereYouControlServicesAlready'),
    slug: 'admin/services',
  },
  tickets: {
    hint: i18n.t('wiki.centralCaseListReadFirst'),
    slug: 'bedienung/tickets',
  },
  evidence: {
    hint: i18n.t('wiki.collectedEvidenceTraceableChainDo'),
    slug: 'bedienung/evidence',
  },
  hosts: {
    hint: i18n.t('wiki.allMonitoredMachinesHostData'),
    slug: 'bedienung/hosts',
  },
  detection: {
    hint: i18n.t('text.overviewActiveDetectionsUnderstandRules'),
    slug: 'bedienung/detections',
  },
  'soc-metrics': {
    hint: i18n.t('wiki.keyFiguresSocOperationsNever'),
    slug: 'bedienung/soc-metriken',
  },
  dataplane: {
    hint: i18n.t('wiki.dataPipelineFrontTicketsUseful'),
    slug: 'bedienung/systemstatus',
  },
  yara: {
    hint: i18n.t('wiki.yaraSignaturesFileMemoryChecks'),
    slug: 'bedienung/yara',
  },
  qradar: {
    hint: i18n.t('wiki.reviewQradarOffensesImportThem'),
    slug: 'bedienung/qradar',
  },
  nis2: {
    hint: i18n.t('wiki.readinessNotMagicShowsEvidence'),
    slug: 'bedienung/nis2',
  },
  system: {
    hint: i18n.t('wiki.healthServicesIntegrationsGlanceFirst'),
    slug: 'bedienung/systemstatus',
  },
  deploy: {
    hint: i18n.t('text.deploymentCenterControlledTechnicalActions'),
    slug: 'bedienung/deployment-center',
  },
  profile: {
    hint: i18n.t('wiki.yourOwnAccountManageYour'),
    slug: 'admin/sicherheit',
  },
} as const satisfies Record<string, WikiTopic>;

export type WikiTopicKey = keyof typeof WIKI_TOPICS;

export function getWikiTopic(key: WikiTopicKey): WikiTopic {
  return WIKI_TOPICS[key];
}
