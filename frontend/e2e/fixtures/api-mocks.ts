import type { Page, Route } from '@playwright/test';

/**
 * Zentrale API-Mocks für die E2E-Suite.
 *
 * Alle Antworten spiegeln die Shapes aus src/features/*\/...Api.ts und src/lib/types.ts.
 * So läuft die Suite OHNE laufendes Backend. Der apiClient nutzt BASE = '/api/v1'.
 *
 * Auth-Modell (ab P_AGENT_1+): Cookie-only mit credentials:'include'.
 * Der Browser sendet das httpOnly soc_token-Cookie automatisch mit — kein Bearer-Header
 * mehr im apiClient. Im E2E-Mock reagiert /auth/me deshalb auf das "authenticated"-Flag,
 * nicht auf einen Authorization-Header.
 */

export const API = '**/api/v1';

export const VALID_EMAIL = 'analyst@nexora.example';
export const VALID_PASSWORD = 'DevAnalyst123!';
export const MOCK_TOKEN = 'e2e-mock-jwt-token';

export const MOCK_USER = {
  id: 'user-1',
  email: VALID_EMAIL,
  displayName: 'Test Analyst',
  role: 'analyst',
};

export const MOCK_ADMIN = {
  id: 'user-admin',
  email: 'admin@nexora.example',
  displayName: 'Test Admin',
  role: 'admin',
};

export const MOCK_TICKETS = [
  {
    id: 'tkt-1',
    ticketNr: 'INC000001',
    title: 'Verdächtige PowerShell-Ausführung auf WEC01',
    priority: 'high',
    status: 'in_progress',
    analyst: 'Test Analyst',
    createdAt: '2026-06-14T08:00:00.000Z',
    updatedAt: '2026-06-14T09:00:00.000Z',
    state: 'OPEN',
    source: 'wazuh',
    offenseId: '100610',
    srcIp: '10.99.99.11',
    mitre: 'T1059.001',
    iocs: 'powershell.exe',
  },
  {
    id: 'tkt-2',
    ticketNr: 'INC000002',
    title: 'Fehlgeschlagene Anmeldungen DC01',
    priority: 'medium',
    status: 'assigned',
    analyst: '',
    createdAt: '2026-06-13T10:00:00.000Z',
    updatedAt: '2026-06-13T10:30:00.000Z',
    state: 'OPEN',
    source: 'wazuh',
    offenseId: '100700',
    srcIp: '10.99.99.10',
  },
];

// ── NIS2 Mock-Daten ──────────────────────────────────────────────────────────

const NIS2_CONTROLS_RAW = [
  { key: 'incident_handling',       title: 'Incident Handling',               shortDescription: 'Prozesse zur Erkennung und Reaktion auf Sicherheitsvorfälle.',          defaultRiskArea: 'Betrieb',         sourceReference: 'Art. 21 Abs. 2 lit. b NIS2', status: 'not_started', owner: '', dueDate: null, lastReviewedAt: null, evidenceCount: 0, hasAssessment: false, overdue: false, missingEvidence: true,  needsReview: false },
  { key: 'vulnerability_mgmt',      title: 'Schwachstellenmanagement',        shortDescription: 'Identifikation und Behebung von Schwachstellen in Systemen.',           defaultRiskArea: 'Betrieb',         sourceReference: 'Art. 21 Abs. 2 lit. e NIS2', status: 'not_started', owner: '', dueDate: null, lastReviewedAt: null, evidenceCount: 0, hasAssessment: false, overdue: false, missingEvidence: true,  needsReview: false },
  { key: 'access_control',          title: 'Zugriffskontrolle',               shortDescription: 'Steuerung und Überwachung von Zugriffen auf Systeme und Daten.',        defaultRiskArea: 'Identität',       sourceReference: 'Art. 21 Abs. 2 lit. i NIS2', status: 'not_started', owner: '', dueDate: null, lastReviewedAt: null, evidenceCount: 0, hasAssessment: false, overdue: false, missingEvidence: true,  needsReview: false },
  { key: 'encryption',              title: 'Kryptografie & Verschlüsselung',  shortDescription: 'Einsatz von Verschlüsselung zum Schutz von Daten.',                    defaultRiskArea: 'Datenschutz',     sourceReference: 'Art. 21 Abs. 2 lit. h NIS2', status: 'not_started', owner: '', dueDate: null, lastReviewedAt: null, evidenceCount: 0, hasAssessment: false, overdue: false, missingEvidence: true,  needsReview: false },
  { key: 'supply_chain_security',   title: 'Lieferkettensicherheit',          shortDescription: 'Sicherheitsanforderungen an Lieferanten und Dienstleister.',            defaultRiskArea: 'Lieferkette',     sourceReference: 'Art. 21 Abs. 2 lit. d NIS2', status: 'not_started', owner: '', dueDate: null, lastReviewedAt: null, evidenceCount: 0, hasAssessment: false, overdue: false, missingEvidence: true,  needsReview: false },
  { key: 'network_security',        title: 'Netzwerk- und Systemsicherheit',  shortDescription: 'Schutz von Netzwerken und IT-Systemen vor unbefugtem Zugriff.',        defaultRiskArea: 'Infrastruktur',   sourceReference: 'Art. 21 Abs. 2 lit. c NIS2', status: 'not_started', owner: '', dueDate: null, lastReviewedAt: null, evidenceCount: 0, hasAssessment: false, overdue: false, missingEvidence: true,  needsReview: false },
  { key: 'business_continuity',     title: 'Business Continuity',             shortDescription: 'Sicherstellung des Geschäftsbetriebs bei Sicherheitsvorfällen.',        defaultRiskArea: 'Verfügbarkeit',   sourceReference: 'Art. 21 Abs. 2 lit. c NIS2', status: 'not_started', owner: '', dueDate: null, lastReviewedAt: null, evidenceCount: 0, hasAssessment: false, overdue: false, missingEvidence: true,  needsReview: false },
  { key: 'security_training',       title: 'Sicherheitsschulungen',           shortDescription: 'Regelmäßige Schulungen zu Sicherheitsthemen für Mitarbeiter.',          defaultRiskArea: 'Personal',        sourceReference: 'Art. 21 Abs. 2 lit. g NIS2', status: 'not_started', owner: '', dueDate: null, lastReviewedAt: null, evidenceCount: 0, hasAssessment: false, overdue: false, missingEvidence: true,  needsReview: false },
  { key: 'risk_management',         title: 'Risikomanagement',                shortDescription: 'Identifikation und Bewertung von Risiken für Netzwerk- und IT-Systeme.', defaultRiskArea: 'Governance',      sourceReference: 'Art. 21 Abs. 1 NIS2',        status: 'not_started', owner: '', dueDate: null, lastReviewedAt: null, evidenceCount: 0, hasAssessment: false, overdue: false, missingEvidence: true,  needsReview: false },
  { key: 'logging_monitoring',      title: 'Protokollierung & Monitoring',    shortDescription: 'Lückenlose Protokollierung und Überwachung sicherheitsrelevanter Ereignisse.', defaultRiskArea: 'Betrieb',   sourceReference: 'Art. 21 Abs. 2 lit. f NIS2', status: 'not_started', owner: '', dueDate: null, lastReviewedAt: null, evidenceCount: 0, hasAssessment: false, overdue: false, missingEvidence: true,  needsReview: false },
];

const NIS2_SUMMARY = {
  catalogVersion: '1.0',
  controlsTotal: 10,
  evidenceCoverage: 0,
  evidenceCoveragePct: 0,
  needsReview: 0,
  overdue: 0,
  missingEvidence: 10,
};

const NIS2_REPORT = {
  meta: {
    generatedAt: '2026-06-19T06:00:00.000Z',
    catalogVersion: '1.0',
    disclaimer: 'kein Konformitätsnachweis — Arbeitsunterstützung für interne Readiness-Bewertung',
  },
  summary: {
    controlsTotal: 10,
    byStatus: { not_started: 10 },
    evidenceCoverage: 0,
    evidenceCoveragePct: 0,
    incidentEvidenceTotal: 0,
    addressedWithEvidence: 0,
    needsReview: 0,
    overdue: 0,
    missingEvidence: 10,
  },
  controls: NIS2_CONTROLS_RAW.map((c) => ({
    key: c.key,
    title: c.title,
    status: c.status,
    owner: c.owner,
    dueDate: c.dueDate,
    evidenceCount: 0,
    incidentEvidenceCount: 0,
    overdue: false,
    missingEvidence: true,
    needsReview: false,
  })),
};

// ── Provisioning Mock-Daten ──────────────────────────────────────────────────

const MOCK_ENROLLMENT_PROFILES = [
  {
    id: 'ep-1',
    name: 'lab-sensor-01',
    role: 'network_sensor',
    capabilities: ['inventory', 'heartbeat'],
    status: 'active',
    expiresAt: null,
    createdAt: '2026-06-19T05:00:00.000Z',
    updatedAt: '2026-06-19T05:00:00.000Z',
  },
];

const MOCK_NODES = [
  {
    id: 'node-1',
    name: 'lab-sensor-01',
    role: 'network_sensor',
    profileId: 'ep-1',
    fqdn: null,
    ip: '10.99.99.50',
    os: 'Linux',
    version: '1.0.0',
    status: 'active',
    lastSeenAt: '2026-06-19T05:30:00.000Z',
    createdAt: '2026-06-19T05:00:00.000Z',
    updatedAt: '2026-06-19T05:30:00.000Z',
  },
];

// ── Hunt Mock-Daten ──────────────────────────────────────────────────────────

const MOCK_HUNTS = [
  {
    id: 'hunt-1',
    title: 'PowerShell Lateral Movement',
    huntType: 'powershell_analysis',
    targetHost: 'DC01.nexora.example',
    targetType: 'host',
    riskLevel: 'medium',
    status: 'completed',
    analystId: 'user-1',
    scope: 'E2E Test Scope',
    hypothesis: null,
    summary: null,
    findings: [],
    commands: [],
    events: [],
    ticketIds: [],
    startedAt: '2026-06-14T08:00:00.000Z',
    closedAt: '2026-06-14T09:00:00.000Z',
    createdAt: '2026-06-14T07:55:00.000Z',
    updatedAt: '2026-06-14T09:00:00.000Z',
  },
];

// ── Evidence Mock-Daten ──────────────────────────────────────────────────────

const MOCK_EVIDENCE = [
  {
    id: 'ev-1',
    ticketId: 'tkt-1',
    type: 'network',
    source: 'wazuh',
    logSource: 'wazuh-alerts',
    title: 'Sysmon Netzwerkverbindung',
    eventId: 'EV-001',
    rawText: null,
    status: 'open',
    capturedAt: '2026-06-14T08:30:00.000Z',
    createdAt: '2026-06-14T08:30:00.000Z',
    updatedAt: '2026-06-14T08:30:00.000Z',
  },
];

// ── Helfer ───────────────────────────────────────────────────────────────────

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

// ── mockApi ──────────────────────────────────────────────────────────────────

export interface MockApiOptions {
  /** Wenn true: /auth/me liefert den eingestellten Mock-User (kein Bearer-Header-Check). */
  authenticated?: boolean;
  /** Rolle des simulierten Users — 'analyst' (default) oder 'admin'. */
  role?: 'analyst' | 'admin';
}

/**
 * Registriert eine typisierte Catch-all-Route auf /api/v1/**.
 *
 * ACHTUNG Auth-Modell: Der echte apiClient nutzt seit P_AGENT_1 credentials:'include'
 * (httpOnly Cookie). Playwright interceptiert das Cookie nie — deshalb reagiert
 * /auth/me hier schlicht auf das authenticated-Flag, nicht auf einen Header.
 */
// ── Correlators Mock-Daten (P_CORR_ADMIN_1) ──────────────────────────────────

const MOCK_CORRELATOR = {
  id: 'correlation-worker',
  name: 'Correlation Engine',
  description: 'Asynchrone, materialisierte Korrelation aus Tickets/Evidence.',
  engineVersion: 'ce-1',
  riskClass: 'medium',
  inputSources: ['ticket', 'child-ticket', 'evidence'],
  outputTypes: ['correlated-evidence'],
  configTargetId: 'correlation-worker',
  configCapabilityIds: ['correlator.worker.maxChildren', 'correlator.worker.maxRetries'],
  queue: { total: 5, active: 1, pending: 1, running: 0, retrying: 0, completed: 3, failed: 0, superseded: 1 },
  lastActivityAt: '2026-06-22T08:00:00.000Z',
};

const MOCK_CORRELATOR_JOBS = [
  { id: 'cj-1', ticketId: 'INC000001', presentationStatus: 'completed', superseded: false, engineVersion: 'ce-1', sourceRevision: 'r1', inputHash: 'h1', resultReference: 'cr-1', retryCount: 0, failureSummary: null, createdAt: '2026-06-22T07:00:00.000Z', startedAt: '2026-06-22T07:00:01.000Z', completedAt: '2026-06-22T07:00:02.000Z' },
  { id: 'cj-2', ticketId: 'INC000009', presentationStatus: 'superseded', superseded: true, engineVersion: 'ce-1', sourceRevision: 'r2', inputHash: 'h2', resultReference: null, retryCount: 0, failureSummary: null, createdAt: '2026-06-22T08:00:00.000Z', startedAt: null, completedAt: null },
];

const MOCK_CORRELATOR_RESULTS = [
  { id: 'cr-1', ticketId: 'INC000001', jobId: 'cj-1', inputHash: 'h1', sourceRevision: 'r1', engineVersion: 'ce-1', eventCount: 3, sources: [{ source: 'Wazuh', count: 2 }, { source: 'QRadar', count: 1 }], evidenceRefCount: 3, createdAt: '2026-06-22T07:00:02.000Z' },
];

const CORR_CAP_MAXCHILDREN = {
  id: 'correlator.worker.maxChildren', scope: 'correlator', risk: 'low',
  description: 'Maximale Anzahl Child-Tickets pro Correlation-Job.', effect: 'Begrenzt den Input pro Job.',
  applyImpact: 'reload', applyStatus: 'not_supported', editable: true, sensitiveFields: [],
  allowedTargets: ['correlation-worker'],
  fields: [{ name: 'maxChildren', type: 'number', required: false, default: 200, sensitive: false }],
};

const MOCK_CORRELATOR_CONFIG = {
  bound: [
    { ...CORR_CAP_MAXCHILDREN, drafts: [
      { id: 'd-appr', capabilityId: 'correlator.worker.maxChildren', targetId: 'correlation-worker', value: { maxChildren: 150 }, status: 'approved', version: 3, revision: 1, createdBy: 'eng@nexora', createdAt: '2026-06-22T06:00:00.000Z', updatedAt: '2026-06-22T06:30:00.000Z' },
    ] },
    {
      id: 'correlator.worker.maxRetries', scope: 'correlator', risk: 'low',
      description: 'Maximale Wiederholungen eines Correlation-Jobs.', effect: 'Bounded Retries.',
      applyImpact: 'reload', applyStatus: 'not_supported', editable: true, sensitiveFields: [],
      allowedTargets: ['correlation-worker'],
      fields: [{ name: 'maxRetries', type: 'number', required: false, default: 3, sensitive: false }],
      drafts: [],
    },
  ],
  reserved: [
    {
      id: 'host.network.allowlist', scope: 'host', risk: 'prohibited',
      description: 'RESERVIERT — host-/netznahe Quell-Allowlist.', effect: '',
      applyImpact: 'restart', applyStatus: 'not_supported', editable: false, sensitiveFields: [],
      allowedTargets: ['host-fw'], fields: [],
    },
  ],
};

const MOCK_CORRELATOR_AUDIT = [
  { id: 'ca-1', type: 'config.draft.created', actor: 'eng@nexora', capabilityId: 'correlator.worker.maxChildren', targetId: 'correlation-worker', draftId: 'd1', before: null, after: { maxChildren: 150 }, at: '2026-06-22T06:00:00.000Z' },
];

export async function mockApi(page: Page, opts: MockApiOptions = {}): Promise<void> {
  const { authenticated = false, role = 'analyst' } = opts;
  const mockUser = role === 'admin' ? MOCK_ADMIN : MOCK_USER;
  const tickets = MOCK_TICKETS;

  await page.route(`${API}/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^.*\/api\/v1/, '');
    const method = route.request().method();

    // ── Auth ─────────────────────────────────────────────
    if (path === '/auth/login' && method === 'POST') {
      const payload = route.request().postDataJSON() as { email?: string; password?: string };
      if (payload?.email === VALID_EMAIL && payload?.password === VALID_PASSWORD) {
        return json(route, { token: MOCK_TOKEN, user: MOCK_USER });
      }
      return json(route, { error: 'INVALID_CREDENTIALS', message: 'E-Mail oder Passwort ungültig' }, 401);
    }
    if (path === '/auth/me' && method === 'GET') {
      // Cookie-basiertes Auth: kein Authorization-Header-Check.
      // Wenn authenticated=true → User liefern, sonst 401 (kein Cookie simuliert).
      if (authenticated) return json(route, { data: mockUser });
      return json(route, { error: 'UNAUTHORIZED', message: 'Nicht authentifiziert' }, 401);
    }
    if (path === '/auth/logout' && method === 'POST') {
      return json(route, { ok: true });
    }

    // ── Tickets ──────────────────────────────────────────
    if (path === '/tickets' && method === 'GET') {
      const priority = url.searchParams.get('priority');
      const state = url.searchParams.get('state');
      const status = url.searchParams.get('status');
      let filtered = tickets;
      if (priority) filtered = filtered.filter((t) => t.priority === priority);
      if (state) filtered = filtered.filter((t) => (t.state ?? 'OPEN') === state);
      if (status) filtered = filtered.filter((t) => t.status === status);
      return json(route, { data: filtered, total: filtered.length, limit: 50, offset: 0 });
    }
    const ticketMatch = path.match(/^\/tickets\/([^/]+)$/);
    if (ticketMatch && method === 'GET') {
      const t = tickets.find((x) => x.id === ticketMatch[1]);
      return t ? json(route, { data: t }) : json(route, { error: 'NOT_FOUND', message: 'Ticket nicht gefunden' }, 404);
    }
    if (path === '/tickets' && method === 'POST') {
      return json(route, { data: { ...tickets[0], id: 'tkt-new' } }, 201);
    }

    // ── KI-Agent ─────────────────────────────────────────
    if (path === '/agent/suggestions' && method === 'GET') {
      return json(route, { data: [], total: 0 });
    }
    if (path === '/settings/ki' && method === 'GET') {
      return json(route, { data: { provider: 'ollama', model: 'llama3.2:3b', baseUrl: 'http://192.168.240.78:11434', enabled: true } });
    }
    if (path === '/settings/ki' && method === 'PUT') {
      return json(route, { data: { ok: true } });
    }

    // ── OIDC / SSO (Sicherheit-Tab) ──────────────────────
    // Ohne diesen Mock fällt /settings/oidc auf den Catch-all ({ data: [] })
    // → cfg = [] → cfg.issuer.trim() crasht die SecurityTab in die Error-Boundary
    // → MFA-Card rendert nicht. Wohlgeformte, deaktivierte Default-Config.
    if (path === '/settings/oidc' && method === 'GET') {
      return json(route, { data: { enabled: false, issuer: '', clientId: '', redirectUri: '', scope: 'openid email profile', defaultRole: 'viewer', allowSignup: false, clientSecretSet: false, configured: false } });
    }
    if (path === '/settings/oidc' && method === 'PUT') {
      return json(route, { data: { enabled: false, issuer: '', clientId: '', redirectUri: '', scope: 'openid email profile', defaultRole: 'viewer', allowSignup: false, clientSecretSet: false, configured: false } });
    }
    if (path === '/settings/oidc/test' && method === 'POST') {
      return json(route, { data: { ok: true, latencyMs: 12, issuer: '' } });
    }

    // ── Evidence / RAG / Audit ────────────────────────────
    if (path === '/evidence' && method === 'GET') {
      return json(route, { data: MOCK_EVIDENCE });
    }
    const evidenceDetailMatch = path.match(/^\/evidence\/([^/]+)$/);
    if (evidenceDetailMatch && method === 'GET') {
      const ev = MOCK_EVIDENCE[0];
      return json(route, {
        data: {
          ...ev,
          comment: '',
          confidence: null,
          sha256: null,
          collectedBy: null,
          reviewStatus: 'open',
          custody: [],
          rawText: null,
        },
      });
    }
    if (path.match(/^\/evidence\/([^/]+)\/custody$/) && method === 'POST') {
      return json(route, {
        data: {
          ...MOCK_EVIDENCE[0],
          comment: '',
          confidence: null,
          sha256: null,
          collectedBy: null,
          reviewStatus: 'reviewed',
          custody: [],
          rawText: null,
        },
      });
    }
    if (path.match(/^\/evidence\/export\/[^/]+$/) && method === 'GET') {
      return json(route, { data: { items: [], ticket: null } });
    }
    if (path === '/rag/status' && method === 'GET') {
      return json(route, { enabled: false, qdrantReachable: false, collection: 'nexora', vectorCount: null });
    }
    if (path === '/audit' && method === 'GET') {
      return json(route, { data: [] });
    }

    // ── Hunts ─────────────────────────────────────────────
    if ((path === '/hunts' || path === '/hunts/sessions') && method === 'GET') {
      return json(route, { data: MOCK_HUNTS });
    }
    if (path === '/hunts/catalog' && method === 'GET') {
      return json(route, { data: [] });
    }
    // Sub-resource endpoints — müssen VOR dem generischen /hunts/:id kommen.
    // useHuntSession ruft alle 7 Endpoints parallel auf; die Listen-Endpoints
    // müssen { data: [] } zurückgeben, sonst crash in findings.map().
    if (path.match(/^\/hunts\/[^/]+\/(findings|commands|logs|artifacts|ticket-links|response-actions|notes)$/) && method === 'GET') {
      return json(route, { data: [] });
    }
    if (path.match(/^\/hunts\/[^/]+\/(start|pause|cancel|complete|run-command)$/) && method === 'POST') {
      return json(route, { data: MOCK_HUNTS[0] });
    }
    // Generischer Hunt-Detail-Endpoint — nur exakt /hunts/:id (kein weiteres Segment).
    if (path.match(/^\/hunts\/[^/]+$/) && method === 'GET') {
      const huntId = path.split('/')[2];
      const h = MOCK_HUNTS.find((x) => x.id === huntId);
      if (h) return json(route, { data: h });
    }

    // ── NIS2 ─────────────────────────────────────────────
    if (path === '/nis2/controls' && method === 'GET') {
      return json(route, { data: NIS2_CONTROLS_RAW, summary: NIS2_SUMMARY });
    }
    if (path === '/nis2/report' && method === 'GET') {
      return json(route, { data: NIS2_REPORT });
    }
    if (path === '/nis2/catalog' && method === 'GET') {
      return json(route, { data: NIS2_CONTROLS_RAW.map((c) => ({ key: c.key, title: c.title, shortDescription: c.shortDescription, evidenceHints: [], defaultRiskArea: c.defaultRiskArea, sourceReference: c.sourceReference, version: '1.0' })) });
    }
    if (path.startsWith('/nis2/assessments/') && method === 'GET') {
      const key = path.replace('/nis2/assessments/', '');
      const ctrl = NIS2_CONTROLS_RAW.find((c) => c.key === key);
      if (ctrl) {
        return json(route, {
          data: {
            control: { key: ctrl.key, title: ctrl.title, shortDescription: ctrl.shortDescription, evidenceHints: ['Incident-Ticket', 'Audit-Log'], defaultRiskArea: ctrl.defaultRiskArea, sourceReference: ctrl.sourceReference, version: '1.0' },
            assessment: null,
            evidence: [],
            overdue: false,
            missingEvidence: true,
            needsReview: false,
            evidenceCount: 0,
          },
        });
      }
    }
    if (path.startsWith('/nis2/assessments/') && (method === 'PUT' || method === 'POST')) {
      return json(route, { data: { ok: true } });
    }
    if (path.startsWith('/nis2/evidence/') && method === 'DELETE') {
      return json(route, {});
    }
    if (path.startsWith('/nis2/controls/') && method === 'POST') {
      return json(route, { data: { ok: true } }, 201);
    }

    // ── Provisioning ──────────────────────────────────────
    if (path === '/provisioning/enrollment-profiles' && method === 'GET') {
      return json(route, { data: MOCK_ENROLLMENT_PROFILES });
    }
    if (path === '/provisioning/enrollment-profiles' && method === 'POST') {
      return json(route, { data: { ...MOCK_ENROLLMENT_PROFILES[0], id: 'ep-new' } }, 201);
    }
    if (path === '/provisioning/nodes' && method === 'GET') {
      return json(route, { data: MOCK_NODES });
    }
    if (path.match(/^\/provisioning\/nodes\/([^/]+)$/) && method === 'GET') {
      return json(route, {
        data: {
          node: MOCK_NODES[0],
          capabilities: [{ id: 'cap-1', nodeId: 'node-1', name: 'inventory', allowedSince: '2026-06-19T05:00:00.000Z' }],
          heartbeats: [{ id: 'hb-1', nodeId: 'node-1', status: 'healthy', reportedAt: '2026-06-19T05:30:00.000Z', createdAt: '2026-06-19T05:30:00.000Z' }],
          latestHeartbeat: { id: 'hb-1', nodeId: 'node-1', status: 'healthy', reportedAt: '2026-06-19T05:30:00.000Z', createdAt: '2026-06-19T05:30:00.000Z' },
        },
      });
    }
    if (path.match(/^\/provisioning\/nodes\/([^/]+)\/credentials$/) && method === 'GET') {
      return json(route, { data: [{ id: 'cred-1', nodeId: 'node-1', status: 'active', issuedAt: '2026-06-19T05:00:00.000Z', revokedAt: null }] });
    }
    if (path === '/provisioning/audit' && method === 'GET') {
      return json(route, { data: [] });
    }
    if (path.match(/^\/provisioning\/enrollment-profiles\/([^/]+)\/token$/) && method === 'POST') {
      return json(route, { data: { token: 'enr_mock1234abcdef' } }, 201);
    }
    if (path.match(/^\/provisioning\/nodes\/([^/]+)\/(retire|credentials\/[^/]+\/revoke)$/) && (method === 'POST' || method === 'PATCH')) {
      return json(route, { data: { ok: true } });
    }

    // ── Correlators (P_CORR_ADMIN_1) ──────────────────────
    if (path === '/correlators' && method === 'GET') {
      return json(route, { data: [MOCK_CORRELATOR] });
    }
    if (path.match(/^\/correlators\/([^/]+)\/jobs$/) && method === 'GET') {
      return json(route, { data: MOCK_CORRELATOR_JOBS, total: MOCK_CORRELATOR_JOBS.length });
    }
    if (path.match(/^\/correlators\/([^/]+)\/results$/) && method === 'GET') {
      return json(route, { data: MOCK_CORRELATOR_RESULTS });
    }
    if (path.match(/^\/correlators\/([^/]+)\/config$/) && method === 'GET') {
      return json(route, { data: MOCK_CORRELATOR_CONFIG });
    }
    if (path.match(/^\/correlators\/([^/]+)\/audit$/) && method === 'GET') {
      return json(route, { data: MOCK_CORRELATOR_AUDIT });
    }
    if (path.match(/^\/correlators\/([^/]+)\/worker-health$/) && method === 'GET') {
      return json(route, { data: {
        workerId: 'correlation-worker', present: true, lastHeartbeatAt: '2026-06-22T09:00:00.000Z',
        ageMs: 1200, heartbeatFresh: true, adoptedConfigVersions: { 'correlator.worker.maxChildren': 1 },
        queueProcessingState: 'idle', queueOk: true, lastJobOutcome: 'completed',
        killSwitchEnabled: false, applyReady: false, reasons: ['Apply serverseitig gesperrt (CONFIG_APPLY_ENABLED=false)'],
      } });
    }
    const corrDraftMatch = path.match(/^\/correlators\/([^/]+)\/drafts$/);
    if (corrDraftMatch && method === 'POST') {
      const body = route.request().postDataJSON() as { capabilityId?: string; value?: Record<string, unknown> };
      return json(route, { data: { id: 'corr-draft-new', capabilityId: body?.capabilityId, targetId: 'correlation-worker', value: body?.value ?? {}, status: 'draft', version: 1, revision: 1, createdBy: 'e2e', createdAt: '2026-06-22T00:00:00.000Z', updatedAt: '2026-06-22T00:00:00.000Z' } }, 201);
    }
    if (path.match(/^\/correlators\/([^/]+)\/drafts\/([^/]+)\/submit$/) && method === 'POST') {
      return json(route, { data: { id: 'corr-draft-new', status: 'pending_approval', version: 2 } });
    }
    if (path.match(/^\/correlators\/([^/]+)\/drafts\/([^/]+)\/decision$/) && method === 'POST') {
      return json(route, { data: { id: 'corr-draft-new', status: 'approved', version: 3 } });
    }
    if (path.match(/^\/correlators\/([^/]+)\/drafts\/([^/]+)\/validate$/) && method === 'POST') {
      return json(route, { data: { draftId: 'd-appr', capabilityId: 'correlator.worker.maxChildren', valid: true, value: { maxChildren: 150 }, errors: [] } });
    }
    if (path.match(/^\/correlators\/([^/]+)\/drafts\/([^/]+)\/plan$/) && method === 'GET') {
      return json(route, { data: {
        draftId: 'd-appr', draftStatus: 'approved', capabilityId: 'correlator.worker.maxChildren', targetId: 'correlation-worker',
        applyImpact: 'reload', applyStatus: 'not_supported', applyEligible: true, wouldApply: false,
        before: { maxChildren: 200 }, after: { maxChildren: 150 },
        changes: [{ key: 'maxChildren', before: 200, after: 150 }], unchanged: [],
        note: 'Vorschau. Es wird nichts angewendet.', generatedAt: '2026-06-22T09:00:00.000Z',
      } });
    }
    const corrDraftPut = path.match(/^\/correlators\/([^/]+)\/drafts\/([^/]+)$/);
    if (corrDraftPut && method === 'PUT') {
      return json(route, { data: { id: corrDraftPut[2], status: 'draft', version: 2 } });
    }

    // ── System / Health ───────────────────────────────────
    if (path === '/health' || path === '/system/health') {
      return json(route, { status: 'ok' });
    }
    if (path.includes('/telemetry')) {
      return json(route, { enabled: false, data: null });
    }

    // ── Fallback: leere, gültige Hülle statt Netzwerkfehler ──
    return json(route, { data: [], total: 0 });
  });
}

/**
 * seedToken — veraltet (Auth läuft jetzt über Cookies).
 * Bleibt als No-op erhalten, damit ältere Aufrufer nicht brechen.
 * @deprecated Verwende mockApi(page, { authenticated: true }) direkt.
 */
export async function seedToken(_page: Page): Promise<void> {
  // no-op — Auth via Cookie; /auth/me-Mock reagiert auf das authenticated-Flag.
}
