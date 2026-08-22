'use strict';

const express     = require('express');
const helmet      = require('helmet');
const cors        = require('cors');
const rateLimit   = require('express-rate-limit');

const config        = require('./config');
const requestId     = require('./middleware/requestId');
const requestLogger = require('./middleware/requestLogger');
const metricsMiddleware = require('./middleware/metricsMiddleware');
const errorHandler  = require('./errors/errorHandler');
const { maintenanceGuard } = require('./middleware/maintenanceGuard');
const { tlsGuard }         = require('./middleware/tlsGuard');
const { ipAllowlistGuard } = require('./middleware/ipAllowlistGuard');
const { csrfGuard }        = require('./middleware/csrfGuard');

const { router: metricsRoutes } = require('./routes/metrics');
const healthRoutes  = require('./routes/health');
const authRoutes         = require('./routes/auth');
const oidcRoutes         = require('./routes/oidc');
const webauthnRoutes     = require('./routes/webauthn');
const userRoutes         = require('./routes/users');
const ticketRoutes       = require('./routes/tickets');
const integrationRoutes  = require('./routes/integrations');
const collectorsRoutes   = require('./routes/collectors');
const huntRoutes         = require('./routes/hunts');
const wazuhRoutes        = require('./routes/wazuh');
const serviceRoutes      = require('./routes/services');
const hostRoutes         = require('./routes/hosts');
const siemRoutes         = require('./routes/siem');
const threatIntelRoutes  = require('./routes/threatIntel');
const evidenceRoutes     = require('./routes/evidence');
const detectionRoutes    = require('./routes/detections');
const auditRoutes        = require('./routes/audit');
const yaraRoutes         = require('./routes/yara');
const agentRoutes        = require('./routes/agent');
const qradarRoutes       = require('./routes/qradar');
const crowdsecRoutes     = require('./routes/crowdsec');
const servicenowRoutes   = require('./routes/servicenow');
const otrsRoutes         = require('./routes/otrs');
const imapRoutes         = require('./routes/imap');
const analysisTemplateRoutes = require('./routes/analysisTemplates');
const useCaseRoutes      = require('./routes/useCases');
const systemRoutes       = require('./routes/system');
const settingsRoutes     = require('./routes/settings');
const ragRoutes          = require('./routes/rag');
const { createSocMetricsRouter } = require('./routes/socMetrics');
const useCaseDraftRoutes     = require('./routes/useCaseDrafts');
const autonomyPoliciesRoutes = require('./routes/autonomyPolicies');
const profileRoutes          = require('./routes/profile');
const notificationRoutes     = require('./routes/notifications');
const apiTokenRoutes         = require('./routes/apiTokens');
const mfaRoutes              = require('./routes/mfa');
const provisioningRoutes     = require('./routes/provisioning');
const nis2Routes             = require('./routes/nis2');
const configRoutes           = require('./routes/configRegistry');
const correlatorRoutes       = require('./routes/correlators');
const deployRoutes           = require('./routes/deploy');
const dataplaneRoutes        = require('./routes/dataplane');
const mlEvalRoutes           = require('./routes/mlEval');

const app = express();

// ── Hinter nginx: echte Client-IP aus X-Forwarded-For (genau 1 Hop) ──
// Ohne das teilen sich ALLE Clients einen Rate-Limit-Zähler (die Proxy-IP) →
// Wazuh-Webhook + Frontend + Login laufen in denselben Topf → fälschliche 429.
// '1' (nicht true) = nur dem direkten nginx vertrauen, kein IP-Spoofing.
app.set('trust proxy', 1);

// ── Security Headers (CSP, HSTS, etc.) ────
// Reine JSON-API (kein HTML/Swagger/Static-Serving) → striktest mögliche CSP:
// nichts darf geladen/eingebettet werden. Härtet gegen versehentliches HTML-Rendering
// und Clickjacking, ohne legitime API-Nutzung zu beeinträchtigen.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'none'"],
      frameAncestors: ["'none'"],
      baseUri:        ["'none'"],
    },
  },
}));

// ── CORS ───────────────────────────────────────────────────
app.use(cors({
  origin:      config.cors.origins,
  credentials: true,
}));

// ── Body Parser — rawBody für HMAC-Verifikation aufbewahren ─
app.use(express.json({
  limit: '1mb',
  verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); },
}));

// ── Request-ID (Traceability) ──────────────────────────────
app.use(requestId);

// ── Request Logging ────────────────────────────────────────
app.use(requestLogger);

// ── Prometheus-Metriken (P20) ──────────────────────────────
// Middleware misst alle Requests; /metrics liegt unterhalb des Rate-Limiters,
// damit Grafana-Scraping nie ge-throttled wird (IP-gated in der Route selbst).
app.use(metricsMiddleware);
app.use('/metrics', metricsRoutes);

// ── Routes ─────────────────────────────────────────────────
const v1 = config.api.prefix;

// ── Rate Limiting ──────────────────────────────────────────
const { makeGlobalRateLimitSkip } = require('./middleware/globalRateLimitSkip');
// Globales Limit pro Client-IP — Integrations-Webhooks + der authentifizierte
// Ticket-Triage-Hot-Path (Listen-Reload GET /tickets + Status-Update PUT /tickets/:id)
// ausgenommen, damit weder Alert-Bursts noch ein Analyst, der mehrere Tickets in Folge
// schließt, den UI-/Login-Verkehr sperren. Details + Rationale: globalRateLimitSkip.js.
app.use(rateLimit({
  windowMs: config.rateLimit.windowMs,
  max:      config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders:   false,
  skip: makeGlobalRateLimitSkip(v1),
  message: { error: 'TOO_MANY_REQUESTS', message: 'Too many requests, please try again later' },
}));

// Eigener Limiter für eingehende Webhooks (SIEM-Bursts) — höher, separater Topf.
const webhookLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max:      config.rateLimit.webhookMax,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'TOO_MANY_REQUESTS', message: 'Webhook rate limit exceeded' },
});

// Strikter Rate-Limiter für Login (Brute-Force-Schutz)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  // Im Test-Modus deaktiviert — Suites loggen sich vielfach pro IP ein.
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'TOO_MANY_REQUESTS' },
});
app.use(`${v1}/auth/login`, loginLimiter);

// Deploy-Reauth ist eine Privileged-Action (Passwort-Bestätigung für den Infra-
// Kanal) — strikt limitiert gegen Online-Brute-Force, unabhängig vom Login-Lockout.
const deployReauthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'TOO_MANY_REQUESTS' },
});
app.use(`${v1}/auth/deploy-reauth`, deployReauthLimiter);

// ── Zugriffskontrolle — TLS-Pflicht + IP-Allowlist (beide default aus) ────
// Laufen früh (vor Auth/Feature-Routen). Fast-path wenn deaktiviert.
// /health bleibt in beiden Guards frei (Monitoring).
app.use(tlsGuard);
app.use(ipAllowlistGuard);

// ── Maintenance Guard — nach Rate-Limit, vor Feature-Routen ───────────────
// Nicht-Admins erhalten 503 wenn maintenanceMode=true.
// /health, /auth/* und GET /settings/platform sind immer frei.
app.use(maintenanceGuard);

// ── CSRF-Guard (Double-Submit) — nur für Cookie-Auth auf state-changing Requests ──
// Bearer/PAT-Clients + Webhooks (HMAC) + Login + Safe-Methods sind ausgenommen.
app.use(v1, csrfGuard);

app.use(`${v1}/health`,  healthRoutes);
// /auth/oidc + /auth/webauthn VOR /auth mounten — eigene SSO-/Passkey-Routen,
// klar vom Passwort-Login getrennt.
app.use(`${v1}/auth/oidc`,     oidcRoutes);
app.use(`${v1}/auth/webauthn`, webauthnRoutes);
app.use(`${v1}/auth`,          authRoutes);
app.use(`${v1}/users`,        userRoutes);
app.use(`${v1}/tickets`,      ticketRoutes);
app.use(`${v1}/integrations`, webhookLimiter, integrationRoutes);
app.use(`${v1}/collectors`,   collectorsRoutes);
app.use(`${v1}/dataplane`, webhookLimiter, dataplaneRoutes);
app.use(`${v1}/hunts`,        huntRoutes);
app.use(`${v1}/wazuh`,        wazuhRoutes);
app.use(`${v1}/services`,     serviceRoutes);
app.use(`${v1}/hosts`,        hostRoutes);
app.use(`${v1}/siem`,         siemRoutes);
app.use(`${v1}/threat-intel`, threatIntelRoutes);
app.use(`${v1}/evidence`,     evidenceRoutes);
app.use(`${v1}/detections`,   detectionRoutes);
app.use(`${v1}/yara`,         yaraRoutes);
app.use(`${v1}/agent`,        agentRoutes);
app.use(`${v1}/audit`,        auditRoutes);
app.use(`${v1}/qradar`,       qradarRoutes);
app.use(`${v1}/crowdsec`,     crowdsecRoutes);
app.use(`${v1}/servicenow`,   servicenowRoutes);
app.use(`${v1}/otrs`,         otrsRoutes);
app.use(`${v1}/imap`,         imapRoutes);
app.use(`${v1}/analysis-templates`, analysisTemplateRoutes);
app.use(`${v1}/use-cases`,    useCaseRoutes);
app.use(`${v1}/system`,       systemRoutes);
app.use(`${v1}/settings`,    settingsRoutes);
app.use(`${v1}/rag`,         ragRoutes);
app.use(`${v1}/soc-metrics`, createSocMetricsRouter());
app.use(`${v1}/use-case-drafts`,    useCaseDraftRoutes);
app.use(`${v1}/autonomy-policies`, autonomyPoliciesRoutes);
app.use(`${v1}/profile`,           profileRoutes);
app.use(`${v1}/notifications`,     notificationRoutes);
app.use(`${v1}/tokens`,           apiTokenRoutes);
app.use(`${v1}/mfa`,              mfaRoutes);
app.use(`${v1}/provisioning`,     provisioningRoutes);
app.use(`${v1}/nis2`,             nis2Routes);
app.use(`${v1}/config`,           configRoutes);
app.use(`${v1}/correlators`,      correlatorRoutes);
app.use(`${v1}/deploy`,           deployRoutes);
app.use(`${v1}/ml/eval`,          mlEvalRoutes);

// Zukünftige Routen (P4+) — Architektur-Vorbereitung
// app.use(`${v1}/evidence`,        evidenceRoutes);   // P4
// app.use(`${v1}/agent/tasks`,     agentRoutes);      // P17 (Flowise)
// app.use(`${v1}/integrations`,    integrationRoutes);// P7

// ── 404 Handler ────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error:     'NOT_FOUND',
    message:   `Route ${req.method} ${req.path} not found`,
    requestId: req.id,
  });
});

// ── Central Error Handler ──────────────────────────────────
app.use(errorHandler);

module.exports = app;
