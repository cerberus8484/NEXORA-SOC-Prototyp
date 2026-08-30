import i18n from '../i18n';

export interface WikiManualSection {
  title: string;
  body: string;
  steps?: string[];
  bullets?: string[];
}

export interface WikiManualPage {
  slug: string;
  title: string;
  summary: string;
  audience: string;
  goal: string;
  beforeYouStart: string[];
  sections: WikiManualSection[];
  related?: string[];
}

export interface WikiManualGroup {
  id: string;
  title: string;
  description: string;
  slugs: string[];
}

export const WIKI_MANUAL_GROUPS: WikiManualGroup[] = [
  {
    id: 'start',
    title: i18n.t('manual.quickStart'),
    description: i18n.t('text.newColleaguesUnderstandFirstThen'),
    slugs: ['start/erste-schritte', 'bedienung/tickets', 'bedienung/evidence'],
  },
  {
    id: 'daily',
    title: i18n.t('manual.dailyOperation'),
    description: i18n.t('manual.pagesAnalystsActuallyUseDay'),
    slugs: ['bedienung/tickets', 'bedienung/evidence', 'bedienung/hosts', 'bedienung/hunts', 'bedienung/systemstatus'],
  },
  {
    id: 'admin',
    title: 'Administration',
    description: i18n.t('manual.functionsAdministratorsEngineersClearSteps'),
    slugs: ['admin/integrationen', 'admin/sicherheit', 'admin/benutzer-und-rollen', 'admin/ki-agent', 'admin/benachrichtigungen', 'admin/speicherung-retention', 'admin/branding', 'admin/services'],
  },
  {
    id: 'advanced',
    title: 'Fortgeschrittene Themen',
    description: i18n.t('manual.onlyOpenOnceYouConfident'),
    slugs: ['bedienung/detections', 'bedienung/yara', 'bedienung/qradar', 'bedienung/deployment-center', 'admin/provisioning', 'admin/correlation-engine', 'admin/autonomy-policies', 'bedienung/nis2'],
  },
];

export const WIKI_MANUAL_PAGES: WikiManualPage[] = [
  {
    slug: 'start/erste-schritte',
    title: i18n.t('wiki.firstSteps'),
    summary: i18n.t('manual.pageExplainsHowFindYour'),
    audience: i18n.t('label.newAnalystsNewAdministratorsStand'),
    goal: i18n.t('manual.afterFiveMinutesYouShould'),
    beforeYouStart: [
      i18n.t('manual.ifYouOnlyWantRead'),
      i18n.t('manual.ifYouWantChangeSystem'),
      i18n.t('manual.alwaysRunWritingAdminFunctions'),
    ],
    sections: [
      {
        title: i18n.t('text.howThinkAboutNexora'),
        body: i18n.t('manual.nexoraCollectsCorrelatesSecurityData'),
        bullets: [
          'Dashboard = schneller Ueberblick',
          i18n.t('manual.ticketsMeanCases'),
          i18n.t('manual.evidenceCentreMeans'),
          'Hosts = betroffene Systeme nachsehen',
        ],
      },
      {
        title: i18n.t('manual.firstFourClicksNewUsers'),
        body: i18n.t('manual.whenYouOpenSystemFirst'),
        steps: [
          i18n.t('manual.openDashboardSeeWhetherAny'),
          i18n.t('manual.openTicketsFilterStatusPriority'),
          i18n.t('manual.clickTicketReadWhetherEvidence'),
          i18n.t('manual.thenMoveEvidenceCenterCheck'),
        ],
      },
      {
        title: i18n.t('manual.whatNotStart'),
        body: i18n.t('manual.manyNewUsersJumpStraight'),
        bullets: [
          i18n.t('text.doNotStartFiddlingIntegrations'),
          i18n.t('manual.doNotChangeAiSettings'),
          i18n.t('text.doNotRestartServicesFirst'),
        ],
      },
    ],
    related: ['bedienung/tickets', 'bedienung/evidence', 'bedienung/systemstatus'],
  },
  {
    slug: 'admin/integrationen',
    title: 'Integrationen einrichten',
    summary: i18n.t('manual.whereYouConnectExternalSources'),
    audience: 'Admins, Engineers',
    goal: i18n.t('manual.connectSourceProperlyTestOnly'),
    beforeYouStart: [
      i18n.t('manual.haveUrlUsernameApiKey'),
      i18n.t('text.changeOnlyOneIntegrationTime'),
      i18n.t('manual.afterEveryChangeTestConnection'),
    ],
    sections: [
      {
        title: i18n.t('manual.whatPage'),
        body: i18n.t('manual.pageNotAlertViewExists'),
        bullets: [
          i18n.t('manual.wazuhAlertsAgentsTelemetry'),
          i18n.t('text.threatIntelEnrichment'),
          i18n.t('manual.webhookMailSourcesIncomingData'),
        ],
      },
      {
        title: i18n.t('text.howSetUpSourceProperly'),
        body: i18n.t('manual.workThroughStepsOneOne'),
        steps: [
          i18n.t('text.selectIntegrationYouWant'),
          i18n.t('manual.enterEndpointCredentials'),
          i18n.t('manual.clickTestConnectionReadResponse'),
          i18n.t('manual.onlySaveOnceTestSucceeds'),
          i18n.t('manual.thenCheckTicketsCollectorStatus'),
        ],
      },
      {
        title: i18n.t('manual.typicalMistakes'),
        body: i18n.t('manual.mostProblemsDoNotCome'),
        bullets: [
          i18n.t('manual.wrongUrlWrongProtocol'),
          i18n.t('manual.apiKeyForgottenCopiedStray'),
          i18n.t('manual.sourceTechnicallyDeliversDataBut'),
        ],
      },
    ],
    related: ['bedienung/systemstatus', 'bedienung/qradar'],
  },
  {
    slug: 'admin/sicherheit',
    title: i18n.t('manual.configureSecurity'),
    summary: i18n.t('manual.whereYouManagePasswordRules'),
    audience: 'Admins',
    goal: i18n.t('manual.raiseSecurityWithoutLockout'),
    beforeYouStart: [
      i18n.t('manual.changeSecuritySettingsOnlyPlan'),
      i18n.t('manual.ifYouTouchIpAllowlist'),
      i18n.t('text.largerChangesInformSecondAdministrator'),
    ],
    sections: [
      {
        title: i18n.t('manual.understandFirstThenSave'),
        body: i18n.t('manual.pageHoldsRealEffectiveSecurity'),
        bullets: [
          i18n.t('manual.passwordPolicyMeans'),
          'MFA = zweiter Faktor per TOTP',
          i18n.t('text.sessionRulesHowLongUsers'),
          i18n.t('manual.allowlistWhoCanReachPlatform'),
        ],
      },
      {
        title: i18n.t('manual.safeChangeProcedure'),
        body: i18n.t('manual.changeOnlyOneBlockTime'),
        steps: [
          i18n.t('manual.writeDownWhatCurrentlySet'),
          i18n.t('manual.adjustExactlyOneSettingOne'),
          i18n.t('manual.save'),
          i18n.t('manual.checkTestUserSecondBrowser'),
          i18n.t('manual.onlyThenChangeNextBlock'),
        ],
      },
      {
        title: 'Besondere Vorsicht',
        body: i18n.t('manual.someFieldsHighlySensitiveCan'),
        bullets: [
          i18n.t('manual.onlyMaintainIpAllowlistIf'),
          i18n.t('manual.onlyMakeMfaMandatoryOnce'),
          i18n.t('manual.doNotSetSessionLimits'),
        ],
      },
    ],
    related: ['admin/benutzer-und-rollen', 'bedienung/systemstatus'],
  },
  {
    slug: 'admin/benutzer-und-rollen',
    title: i18n.t('manual.usersRoles'),
    summary: i18n.t('manual.whereYouDefineWhoMay'),
    audience: 'Admins',
    goal: i18n.t('manual.grantAccessProperlyWithoutGiving'),
    beforeYouStart: [
      i18n.t('manual.createNewUsersSmallestRole'),
      i18n.t('manual.changeRolesDeliberatelyDocument'),
      i18n.t('text.whenDoubtGrantAnalystRather'),
    ],
    sections: [
      {
        title: i18n.t('manual.howToReadRoles'),
        body: i18n.t('manual.rolesNotTitlesTheyPermission'),
        bullets: [
          'Analyst = operativ arbeiten',
          'Engineer = technische Fachfunktionen',
          i18n.t('manual.administratorSettingsSecurityCriticalOperati'),
        ],
      },
      {
        title: i18n.t('manual.createNewUser'),
        body: i18n.t('text.stickSimpleSafeOrder'),
        steps: [
          'Benutzerbereich oeffnen.',
          i18n.t('manual.createUserCorrectMailAddress'),
          i18n.t('text.grantSmallestSuitableRole'),
          i18n.t('manual.save'),
          i18n.t('manual.checkUserWhetherRequiredPages'),
        ],
      },
      {
        title: i18n.t('text.whenSomeoneWantsSeeEverything'),
        body: i18n.t('manual.thenRequirementUsuallyNotClear'),
        bullets: [
          i18n.t('manual.askWhichTaskNeedsDone'),
          i18n.t('manual.checkAnalystEngineerEnough'),
          i18n.t('manual.administratorOnlyWhenSystemFunctions'),
        ],
      },
    ],
    related: ['admin/sicherheit', 'start/erste-schritte'],
  },
  {
    slug: 'admin/ki-agent',
    title: i18n.t('manual.understandingConfiguringAiAgent'),
    summary: i18n.t('manual.pageExplainsWhatAiAllowed'),
    audience: 'Admins, Engineers',
    goal: i18n.t('manual.configureAiSoHelpsWithout'),
    beforeYouStart: [
      i18n.t('manual.aiSupportNotReplacementAnalysts'),
      'Human Approval bleibt wichtig.',
      i18n.t('manual.doNotChangeProviderPolicies'),
    ],
    sections: [
      {
        title: i18n.t('manual.whatAiMeantDoHere'),
        body: i18n.t('manual.aiAssessesStructuresPrioritisesShould'),
        bullets: [
          i18n.t('manual.generateTriageSuggestions'),
          i18n.t('manual.summariseContext'),
          i18n.t('manual.givePointersNextStep'),
        ],
      },
      {
        title: 'Sicher einstellen',
        body: i18n.t('manual.whenYouAdjustAiConservative'),
        steps: [
          i18n.t('manual.checkProviderMode'),
          i18n.t('manual.changeThresholdsPoliciesOnlySmall'),
          i18n.t('manual.lookEvaluationTestCaseAfter'),
          i18n.t('manual.onlyThenLetOperationsContinue'),
        ],
      },
      {
        title: i18n.t('manual.howRecogniseGoodAiSettings'),
        body: i18n.t('manual.goodNotMaximallyAggressiveTraceable'),
        bullets: [
          'Wenig falsche Freigaben',
          i18n.t('text.clearRationaleSuggestions'),
          i18n.t('text.noSilentAutomationWithoutGate'),
        ],
      },
    ],
    related: ['admin/autonomy-policies', 'bedienung/systemstatus'],
  },
  {
    slug: 'admin/benachrichtigungen',
    title: i18n.t('nav.notifications'),
    summary: i18n.t('manual.whereYouDefineWhoInformed'),
    audience: 'Admins',
    goal: i18n.t('manual.deliverImportantMessagesWithoutFlooding'),
    beforeYouStart: [
      i18n.t('manual.firstDecideWhichEventsGenuinely'),
      i18n.t('manual.enterOnlyNecessaryRecipients'),
      i18n.t('manual.alwaysTestAfterSettingUp'),
    ],
    sections: [
      {
        title: i18n.t('manual.whatPageIntended'),
        body: i18n.t('manual.notificationsShouldGetPeopleS'),
        bullets: [
          'Kritische Tickets',
          'Statuswechsel',
          i18n.t('manual.operationalSecurityEvents'),
        ],
      },
      {
        title: 'Sauber einrichten',
        body: i18n.t('manual.avoidsDuplicateUselessMessages'),
        steps: [
          i18n.t('manual.chooseChannelExampleEmail'),
          i18n.t('manual.defineRecipients'),
          i18n.t('text.enableOnlyRelevantTriggers'),
          'Test senden.',
          i18n.t('manual.verifyResultRealRecipient'),
        ],
      },
      {
        title: 'Was du vermeiden solltest',
        body: i18n.t('text.tooManyMailsMeanEventually'),
        bullets: [
          i18n.t('text.sendingEverySmallEventEveryone'),
          i18n.t('text.usingSeveralChannelsSamePurpose'),
          i18n.t('manual.enableLowSignalWarnings'),
        ],
      },
    ],
    related: ['bedienung/tickets', 'bedienung/systemstatus'],
  },
  {
    slug: 'admin/speicherung-retention',
    title: i18n.t('manual.storageRetention'),
    summary: i18n.t('manual.whereYouControlHowLong'),
    audience: 'Admins',
    goal: i18n.t('manual.keepEnoughDataOperationsWithout'),
    beforeYouStart: [
      i18n.t('manual.firstCheckWhichKindsData'),
      i18n.t('manual.doNotShortenRetentionHunch'),
      i18n.t('manual.especiallyCarefulAuditComplianceData'),
    ],
    sections: [
      {
        title: i18n.t('manual.whatGovernedHere'),
        body: i18n.t('manual.retentionMeansDataDoesNot'),
        bullets: [
          'Tickets',
          'Evidence',
          i18n.t('audit.entries'),
          i18n.t('text.furtherOperationalData'),
        ],
      },
      {
        title: i18n.t('manual.safeApproach'),
        body: i18n.t('manual.onlyChangePeriodsOnceYou'),
        steps: [
          i18n.t('manual.selectAffectedDataType'),
          i18n.t('manual.noteCurrentDeadline'),
          i18n.t('label.setNewDeadline'),
          i18n.t('manual.checkWhetherLegalOperationalReasons'),
          i18n.t('manual.saveTellTeam'),
        ],
      },
      {
        title: 'Typischer Denkfehler',
        body: i18n.t('manual.lessStorageNotAutomaticallyBetter'),
      },
    ],
    related: ['bedienung/evidence', 'admin/audit-compliance'],
  },
  {
    slug: 'admin/branding',
    title: i18n.t('manual.brandingTheme'),
    summary: i18n.t('manual.whereYouAdjustNameColours'),
    audience: 'Admins',
    goal: i18n.t('text.adaptPlatformYourEnvironmentWithout'),
    beforeYouStart: [
      i18n.t('manual.onlyChooseColoursStayReadable'),
      'Markenname konsistent schreiben.',
      i18n.t('text.checkVisualChangesFirstThen'),
    ],
    sections: [
      {
        title: i18n.t('text.whatPageChanges'),
        body: i18n.t('manual.brandingPurelyPresentationChangesNeither'),
        bullets: [
          'Plattformname',
          'Akzentfarbe',
          i18n.t('manual.logoVisualMarkers'),
        ],
      },
      {
        title: i18n.t('text.howProceed'),
        body: i18n.t('manual.betterSparseCleanThanColourful'),
        steps: [
          i18n.t('manual.changeNameColour'),
          i18n.t('manual.checkPreview'),
          i18n.t('manual.watchContrastButtonsLabelsHeaders'),
          i18n.t('manual.onlyThenSave'),
        ],
      },
    ],
    related: ['start/erste-schritte'],
  },
  {
    slug: 'admin/services',
    title: i18n.t('manual.restartServices'),
    summary: i18n.t('manual.whereYouControlExistingServices'),
    audience: 'Admins',
    goal: i18n.t('text.onlyInterveneWhenYouGenuinely'),
    beforeYouStart: [
      i18n.t('manual.firstCheckWhetherFaultReally'),
      i18n.t('text.documentReasonWherePossible'),
      i18n.t('manual.neverRestartOutBoredomHunch'),
    ],
    sections: [
      {
        title: i18n.t('manual.whatPage2'),
        body: i18n.t('manual.youDoNotCreateNew'),
      },
      {
        title: i18n.t('manual.restartInSafeOrder'),
        body: i18n.t('text.orderPreventsHastyMistakes'),
        steps: [
          i18n.t('manual.identifyService'),
          i18n.t('manual.checkWhetherSystemStatusLogs'),
          i18n.t('manual.ifRequiredArmConfirm'),
          i18n.t('manual.triggerRestart'),
          i18n.t('manual.thenCheckSystemStatusFunction'),
        ],
      },
      {
        title: i18n.t('text.whenYouShouldNotRestart'),
        body: i18n.t('manual.restartFixesNeitherWrongConfiguration'),
        bullets: [
          i18n.t('manual.whenOnlyOneIntegrationEntered'),
          i18n.t('text.whenUserPermissionsMissing'),
          i18n.t('manual.whenYouDoNotKnow'),
        ],
      },
    ],
    related: ['bedienung/systemstatus', 'admin/integrationen'],
  },
  {
    slug: 'admin/autonomy-policies',
    title: 'Autonomy Policies',
    summary: i18n.t('manual.whereYouDefineWhichAutomatic'),
    audience: 'Admins',
    goal: i18n.t('manual.controlAutomationDoNotUnleash'),
    beforeYouStart: [
      i18n.t('manual.onlyChangeWhenYouKnow'),
      i18n.t('manual.humanLoopRemainsSafeDefault'),
      i18n.t('manual.alwaysThinkChangesTogetherReview'),
    ],
    sections: [
      {
        title: i18n.t('text.whatPolicyDoes'),
        body: i18n.t('manual.policiesDoNotOnlySay'),
      },
      {
        title: i18n.t('manual.safeApproach'),
        body: i18n.t('manual.smallStepsMandatoryHere'),
        steps: [
          'Aktuelle Policy lesen.',
          i18n.t('text.adjustOnlyOnePart'),
          i18n.t('manual.saveChange'),
          i18n.t('manual.verifyTestCasesEvaluation'),
          i18n.t('text.onlyThenTouchFurtherRules'),
        ],
      },
      {
        title: 'Einfacher Merksatz',
        body: i18n.t('manual.ifYouCannotClearlyExplain'),
      },
    ],
    related: ['admin/ki-agent'],
  },
  {
    slug: 'admin/provisioning',
    title: 'Provisioning',
    summary: i18n.t('manual.whereYouRegisterManageNodes'),
    audience: 'Admins, Engineers',
    goal: i18n.t('label.takeNewSystemsBoardCleanly'),
    beforeYouStart: [
      i18n.t('manual.alwaysCheckWhetherTargetSystem'),
      i18n.t('manual.keepNamesTechnicalMappingClean'),
      i18n.t('manual.doNotStartRolloutsChaotically'),
    ],
    sections: [
      {
        title: i18n.t('manual.whatPage'),
        body: i18n.t('manual.provisioningMeansTakingNodeInto'),
      },
      {
        title: 'Standardablauf',
        body: i18n.t('manual.keepsRolloutTraceable'),
        steps: [
          i18n.t('manual.registerNodeAgent'),
          i18n.t('manual.checkMappingMetadata'),
          i18n.t('manual.createRequiredApprovalsTokens'),
          i18n.t('manual.runInstallationEnrolmentTargetSystem'),
          i18n.t('manual.checkHeartbeatStatus'),
        ],
      },
    ],
    related: ['bedienung/hosts', 'bedienung/deployment-center'],
  },
  {
    slug: 'admin/correlation-engine',
    title: 'Correlation Engine',
    summary: i18n.t('manual.whereYouControlHowIndividual'),
    audience: 'Admins, Engineers',
    goal: i18n.t('text.lessNoiseMoreUsableContext'),
    beforeYouStart: [
      i18n.t('manual.onlyAdjustOnceYouTruly'),
      i18n.t('manual.smallRuleChangesBeatBig'),
      i18n.t('text.watchRealCasesAfterEvery'),
    ],
    sections: [
      {
        title: 'Worum es geht',
        body: i18n.t('manual.correlationStopsEverySmallThing'),
      },
      {
        title: i18n.t('manual.adjustSensibly'),
        body: i18n.t('manual.alwaysWorkCheckEffect'),
        steps: [
          i18n.t('manual.identifyRuleThreshold'),
          i18n.t('manual.keepChangeSmall'),
          i18n.t('manual.save'),
          i18n.t('manual.thenWatchNewTicketsMerges'),
        ],
      },
    ],
    related: ['bedienung/tickets', 'admin/ki-agent'],
  },
  {
    slug: 'admin/audit-compliance',
    title: i18n.t('manual.auditCompliance'),
    summary: i18n.t('manual.whereYouReviewTraceableActivity'),
    audience: 'Admins, Auditoren, Engineers',
    goal: i18n.t('manual.seeClearlyWhoDidWhat'),
    beforeYouStart: [
      i18n.t('manual.notEveryEntryAutomaticallyBad'),
      i18n.t('manual.whenExportingAlwaysCheckWho'),
      i18n.t('manual.auditDoesNotReplaceAnalysis'),
    ],
    sections: [
      {
        title: i18n.t('manual.whatPageGood'),
        body: i18n.t('manual.auditLogHelpsFollowUp'),
      },
      {
        title: i18n.t('text.howWork'),
        body: i18n.t('text.searchFirstThenAssess'),
        steps: [
          i18n.t('manual.filterPeriodActionUser'),
          i18n.t('manual.openRelevantEntry'),
          i18n.t('manual.crossCheckTicketSettingEvent'),
          i18n.t('manual.onlyExportPassWhenNeeded'),
        ],
      },
    ],
    related: ['bedienung/systemstatus', 'bedienung/nis2'],
  },
  {
    slug: 'bedienung/tickets',
    title: i18n.t('manual.workOnTickets'),
    summary: i18n.t('manual.ticketsYourMainWorkplaceWhere'),
    audience: 'Analysten, Engineers, Admins',
    goal: i18n.t('manual.spotQuicklyWhatMattersCarry'),
    beforeYouStart: [
      i18n.t('text.alwaysReadFirstThenChange'),
      i18n.t('manual.notEveryTicketImmediatelyReal'),
      i18n.t('manual.evidenceContextDecideNotYour'),
    ],
    sections: [
      {
        title: i18n.t('manual.whatYouDoTicketList'),
        body: i18n.t('manual.listSortingPrioritisingNotDeep'),
        bullets: [
          i18n.t('text.filterPriority'),
          i18n.t('text.filterStatus'),
          i18n.t('manual.pullOutYourOwnOpen'),
        ],
      },
      {
        title: i18n.t('text.handlingTicketProperly'),
        body: i18n.t('manual.orderMakesSenseAlmostEvery'),
        steps: [
          'Ticket oeffnen.',
          i18n.t('manual.readTitleSourcePrioritySummary'),
          i18n.t('manual.reviewEvidenceAnalysis'),
          i18n.t('manual.decideRealUnclearProbablyFalse'),
          i18n.t('manual.setStatusNoteNextAction'),
        ],
      },
      {
        title: i18n.t('text.doNotDoStraightAway'),
        body: i18n.t('manual.theseMistakesCostTimeLater'),
        bullets: [
          i18n.t('manual.markingSomethingDoneWithoutHaving'),
          i18n.t('text.escalatingJustBecauseAiSummary'),
          i18n.t('manual.ignoringEvidenceBecauseTitleSounds'),
        ],
      },
    ],
    related: ['bedienung/evidence', 'bedienung/hosts', 'bedienung/hunts'],
  },
  {
    slug: 'bedienung/evidence',
    title: i18n.t('wiki.useEvidenceCentre'),
    summary: i18n.t('manual.whereYouReviewEvidenceBehind'),
    audience: 'Analysten, Engineers, Admins',
    goal: i18n.t('manual.understandWhySomethingDetected'),
    beforeYouStart: [
      i18n.t('manual.evidenceBasisGoodDecisions'),
      i18n.t('text.ifTicketLooksOddYou'),
      i18n.t('manual.doNotReadOnlySummary'),
    ],
    sections: [
      {
        title: 'Was Evidence bedeutet',
        body: i18n.t('manual.evidenceMeansDataPointsFiles'),
      },
      {
        title: 'So liest du Evidence richtig',
        body: i18n.t('manual.workFromCoarseConcrete'),
        steps: [
          i18n.t('manual.openTicketSearchTerm'),
          i18n.t('manual.identifyEvidence'),
          i18n.t('manual.checkWhereEvidenceComesFrom'),
          i18n.t('manual.payAttentionTimeSourceContext'),
          i18n.t('text.onlyThenDeriveAssessment'),
        ],
      },
      {
        title: 'Woran du gute Evidence erkennst',
        body: i18n.t('manual.goodEvidenceNotJustLoud'),
        bullets: [
          i18n.t('manual.clearSource'),
          'Zeitlicher Bezug',
          i18n.t('manual.connectionTicketHunt'),
          i18n.t('text.noBareClaimWithoutData'),
        ],
      },
    ],
    related: ['bedienung/tickets', 'bedienung/hunts'],
  },
  {
    slug: 'bedienung/hosts',
    title: i18n.t('wiki.understandHosts'),
    summary: i18n.t('manual.hostPageShowsWhichSystems'),
    audience: 'Analysten, Engineers, Admins',
    goal: i18n.t('manual.quicklySeeWhetherGivenMachine'),
    beforeYouStart: [
      i18n.t('manual.hostsContextNotAutomaticallyCulprits'),
      i18n.t('text.emptyListsOftenMeanIntegration'),
      i18n.t('text.hostDataHelpsYouExplain'),
    ],
    sections: [
      {
        title: i18n.t('manual.whatYouUseHostPage'),
        body: i18n.t('manual.hereYouLookAffectedSystem'),
        bullets: [
          'Agent-Status',
          'Betriebssystem',
          i18n.t('manual.inventoryVulnerabilities'),
          i18n.t('manual.connectionTicketsHunts'),
        ],
      },
      {
        title: 'Typischer Arbeitsablauf',
        body: i18n.t('text.whenHostAppearsTicketProceed'),
        steps: [
          i18n.t('manual.findHostList'),
          i18n.t('manual.lookStatusLastActivity'),
          i18n.t('manual.checkOpenVulnerabilitiesAnythingUnusual'),
          i18n.t('manual.linkTicketHunt'),
        ],
      },
    ],
    related: ['bedienung/tickets', 'admin/integrationen'],
  },
  {
    slug: 'bedienung/hunts',
    title: i18n.t('manual.startThreatHunts'),
    summary: i18n.t('text.whereYouRunTargetedInvestigations'),
    audience: 'Analysten, Engineers',
    goal: i18n.t('text.examineSuspicionSystematicallyInsteadSearchi'),
    beforeYouStart: [
      i18n.t('manual.huntNeedsQuestionHypothesis'),
      i18n.t('text.doNotJustStartRandom'),
      i18n.t('manual.ticketHostShouldKnownBeforehand'),
    ],
    sections: [
      {
        title: i18n.t('text.whenUseHunt'),
        body: i18n.t('manual.huntMakesSenseWhenNormal'),
      },
      {
        title: 'Einfacher Ablauf',
        body: i18n.t('text.keepClearOrder'),
        steps: [
          i18n.t('manual.chooseHostContext'),
          i18n.t('manual.startMatchingHuntTemplateSession'),
          i18n.t('manual.readResultsFindings'),
          i18n.t('manual.checkEvidence'),
          i18n.t('manual.carryResultBack'),
        ],
      },
    ],
    related: ['bedienung/evidence', 'bedienung/tickets'],
  },
  {
    slug: 'bedienung/detections',
    title: 'Detection Library',
    summary: i18n.t('manual.whereYouSeeWhichDetection'),
    audience: 'Analysten, Engineers',
    goal: i18n.t('manual.understandRulesDoNotTouch'),
    beforeYouStart: [
      i18n.t('manual.detectionLibraryOverviewTraceability'),
      i18n.t('manual.youDoNotBuildNew'),
      i18n.t('text.alwaysConsiderImpactBeforeChanging'),
    ],
    sections: [
      {
        title: i18n.t('manual.whatPage2'),
        body: i18n.t('manual.hereYouLookUpWhich'),
      },
      {
        title: i18n.t('manual.howUsePageSensibly'),
        body: i18n.t('text.readFirstThenAssess'),
        steps: [
          i18n.t('text.findRule'),
          i18n.t('manual.readTitleCategoryPurpose'),
          i18n.t('manual.crossCheckTicketMitreContext'),
          i18n.t('manual.onlyMoveUseCaseRule'),
        ],
      },
    ],
    related: ['bedienung/tickets', 'bedienung/yara'],
  },
  {
    slug: 'bedienung/soc-metriken',
    title: 'SOC-Metriken lesen',
    summary: i18n.t('manual.pageShowsOperationalMetricsExists'),
    audience: 'Analysten, Leads, Admins',
    goal: i18n.t('manual.spotImmediatelyWhetherBacklogLoad'),
    beforeYouStart: [
      i18n.t('manual.metricsIndicationsNotTruthWithout'),
      i18n.t('manual.risingNumbersCanNormalCritical'),
      i18n.t('manual.alwaysAssessThemTogetherTickets'),
    ],
    sections: [
      {
        title: i18n.t('manual.howReadNumbers'),
        body: i18n.t('manual.neverLookSingleMetricAlone'),
        bullets: [
          'Offene Tickets',
          'Bearbeitungszeiten',
          i18n.t('text.distributionSource'),
        ],
      },
      {
        title: i18n.t('manual.practicalApproach'),
        body: i18n.t('manual.ifNumberLooksOddGo'),
        steps: [
          i18n.t('manual.markNotableMetric'),
          i18n.t('manual.openRelatedTicketsSources'),
          i18n.t('manual.checkWhetherRealBacklogJust'),
          'Massnahme ableiten.',
        ],
      },
    ],
    related: ['bedienung/tickets', 'bedienung/systemstatus'],
  },
  {
    slug: 'bedienung/yara',
    title: 'YARA Engine',
    summary: i18n.t('manual.aboutSignaturesFileMemoryChecks'),
    audience: 'Engineers, erfahrene Analysten',
    goal: i18n.t('manual.readApplyYaraRulesDeliberately'),
    beforeYouStart: [
      i18n.t('manual.onlyOpenIfYouHave'),
      i18n.t('manual.changingRulesCanAffectWhat'),
      i18n.t('manual.notFirstPlaceNewcomersWork'),
    ],
    sections: [
      {
        title: 'Kurz erklaert',
        body: i18n.t('manual.yaraDescribesPatternsThosePatterns'),
      },
      {
        title: 'Sinnvoller Ablauf',
        body: 'Vorsicht statt Aktionismus.',
        steps: [
          i18n.t('text.lookRule'),
          i18n.t('manual.understandWhatBeingSearched'),
          i18n.t('manual.checkContextTargetSystem'),
          i18n.t('manual.doNotReadMatchBlindly'),
        ],
      },
    ],
    related: ['bedienung/evidence', 'bedienung/detections'],
  },
  {
    slug: 'bedienung/qradar',
    title: 'QRadar Analysis',
    summary: i18n.t('manual.whereYouWorkQradarOffenses'),
    audience: 'Analysten, Engineers',
    goal: i18n.t('manual.moveQradarSignalsIntoNexora'),
    beforeYouStart: [
      i18n.t('manual.qradarIntegrationHasSetUp'),
      i18n.t('text.notEveryOffenseNeedsTicket'),
      i18n.t('text.readContextFirstThenImport'),
    ],
    sections: [
      {
        title: 'Einfacher Arbeitsablauf',
        body: i18n.t('manual.keepsSwitchBetweenQradarNexora'),
        steps: [
          'Offense ansehen.',
          i18n.t('manual.checkItsMeaningUrgency'),
          i18n.t('text.onlyTurnRelevantOffensesInto'),
          'Danach in Nexora normal weiterarbeiten.',
        ],
      },
    ],
    related: ['admin/integrationen', 'bedienung/tickets'],
  },
  {
    slug: 'bedienung/systemstatus',
    title: 'Systemstatus lesen',
    summary: i18n.t('manual.pageYourFirstLookWhen'),
    audience: 'Analysten, Engineers, Admins',
    goal: i18n.t('manual.tellApartQuicklyDataProblem'),
    beforeYouStart: [
      i18n.t('manual.ifSomethingMissingLooksOdd'),
      i18n.t('manual.systemStatusDiagnosisNotRepair'),
      i18n.t('text.narrowDownCauseFirstThen'),
    ],
    sections: [
      {
        title: i18n.t('text.whatYouLookingHere'),
        body: i18n.t('manual.notEveryDisruptionCompleteOutage'),
        bullets: [
          'API erreichbar?',
          i18n.t('manual.isDatabaseHealthy'),
          i18n.t('manual.areIntegrationsReporting'),
          i18n.t('manual.anythingOddAboutCollectorsWeb'),
        ],
      },
      {
        title: i18n.t('manual.whenSomethingLooksRedUnusual'),
        body: i18n.t('manual.proceedCalmlySystematically'),
        steps: [
          i18n.t('manual.identifyComponent'),
          i18n.t('manual.checkWhichFunctionAffected'),
          i18n.t('manual.crossCheckTicketsCollectorsServices'),
          i18n.t('manual.onlyThenChooseRightAdministrative'),
        ],
      },
    ],
    related: ['admin/services', 'admin/integrationen'],
  },
  {
    slug: 'bedienung/deployment-center',
    title: 'Deployment Center',
    summary: i18n.t('manual.pageIntendedControlledRolloutsGoverned'),
    audience: 'Admins, Engineers',
    goal: i18n.t('manual.carryOutWritingActionsDeliberately'),
    beforeYouStart: [
      i18n.t('manual.onlyUseIfYouGenuinely'),
      i18n.t('text.notNormalTicketTriage'),
      i18n.t('manual.beforeEachActionReadCarefully'),
    ],
    sections: [
      {
        title: i18n.t('manual.whatPage3'),
        body: i18n.t('manual.deploymentHereDoesNotOnly'),
      },
      {
        title: i18n.t('manual.safeUsage'),
        body: i18n.t('text.stickConservativeProcedure'),
        steps: [
          i18n.t('manual.chooseTarget'),
          i18n.t('manual.readPreviewConditions'),
          i18n.t('manual.checkWhetherApprovalGateRequired'),
          i18n.t('manual.startActionDeliberately'),
          i18n.t('manual.checkResponseStatus'),
        ],
      },
    ],
    related: ['admin/provisioning', 'bedienung/systemstatus'],
  },
  {
    slug: 'bedienung/nis2',
    title: 'NIS2 Readiness',
    summary: i18n.t('manual.pageShowsYourMaturityEvidence'),
    audience: i18n.t('manual.adminsManagementAuditors'),
    goal: i18n.t('manual.makeGapsEvidenceVisible'),
    beforeYouStart: [
      i18n.t('manual.nis2ReadinessOrientationNotFree'),
      i18n.t('manual.missingEvidenceMeansWorkDo'),
      i18n.t('manual.pageExistsStructureNotMarketing'),
    ],
    sections: [
      {
        title: i18n.t('manual.howReadPageCorrectly'),
        body: i18n.t('manual.watchMissingEvidenceOpenItems'),
      },
      {
        title: i18n.t('manual.simpleApproach'),
        body: i18n.t('manual.whenMaintainingAssessingPageWork'),
        steps: [
          i18n.t('manual.selectControlArea'),
          i18n.t('manual.checkExistingEvidence'),
          i18n.t('manual.markGaps'),
          'Naechste Massnahme festlegen.',
        ],
      },
    ],
    related: ['admin/audit-compliance'],
  },
];

export const WIKI_MANUAL_BY_SLUG = Object.fromEntries(
  WIKI_MANUAL_PAGES.map((page) => [page.slug, page]),
) as Record<string, WikiManualPage>;

export function getWikiManualPage(slug?: string): WikiManualPage | undefined {
  if (!slug) return undefined;
  return WIKI_MANUAL_BY_SLUG[slug];
}
