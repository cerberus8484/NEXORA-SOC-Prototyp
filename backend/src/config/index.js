'use strict';

require('dotenv').config();

const config = {
  env:  process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),

  api: {
    version:    'v1',
    prefix:     '/api/v1',
  },

  db: {
    // Echte Persistenz aktiv? Wenn false → InMemory-Repositories (Tests/Dev ohne DB).
    // In Produktion via DB_ENABLED=true einschalten.
    enabled: process.env.DB_ENABLED === 'true',
    host:    process.env.DB_HOST || 'localhost',
    name:    process.env.DB_NAME || 'soc_tickets_dev',
  },

  cors: {
    // In Produktion: nur interne Origins erlauben
    origins: (process.env.CORS_ORIGINS || 'http://localhost:5500').split(','),
  },

  rateLimit: {
    windowMs:   parseInt(process.env.RATE_LIMIT_WINDOW_MS  || '60000',  10), // 1 Minute
    max:        parseInt(process.env.RATE_LIMIT_MAX         || '200',    10), // 200 Req/min (UI/API)
    webhookMax: parseInt(process.env.RATE_LIMIT_WEBHOOK_MAX || '1000',   10), // SIEM-Bursts separat
  },

  // Provisioning-Rate-Limits (P_PROVISION_SECURITY_1) — gezielt nur für /enroll
  // und /heartbeat. Sichere Prod-Defaults; im Test default-inaktiv (nur aktiv,
  // wenn die jeweiligen PROV_*-ENV gesetzt sind — siehe routes/provisioning.js).
  //   enroll:    pro Quell-IP, NUR fehlgeschlagene Versuche zählen (skipSuccessful).
  //   heartbeat: Flood pro nodeId (NAT-transparent), Auth-Fehler pro Quell-IP.
  provisioning: {
    enroll: {
      windowMs:       parseInt(process.env.PROV_ENROLL_WINDOW_MS          || '900000', 10), // 15 min
      max:            parseInt(process.env.PROV_ENROLL_MAX                || '5',      10),
      skipSuccessful: (process.env.PROV_ENROLL_SKIP_SUCCESSFUL            || 'true') === 'true',
    },
    heartbeat: {
      nodeWindowMs:   parseInt(process.env.PROV_HEARTBEAT_WINDOW_MS       || '60000',  10), // 1 min
      maxPerNode:     parseInt(process.env.PROV_HEARTBEAT_MAX_PER_NODE    || '60',     10), // ~1/s, großzügig
      failWindowMs:   parseInt(process.env.PROV_HEARTBEAT_FAIL_WINDOW_MS  || '900000', 10), // 15 min
      failMaxPerIp:   parseInt(process.env.PROV_HEARTBEAT_FAIL_MAX_PER_IP || '20',     10),
    },
  },

  wazuh: {
    // Tickets erst ab diesem Rule-Level. Default 5: fängt Auth-Fehler/Brute-Force
    // (z.B. sshd Rule 5710 = Level 5) und droppt Rauschen wie "A process was created" (Level 3).
    minLevel:          parseInt(process.env.WAZUH_MIN_LEVEL          || '5',  10),
    // Wiederkehrende Offense aktualisiert das offene Ticket nur innerhalb dieses Fensters.
    correlationWindowH: parseInt(process.env.WAZUH_CORRELATION_WINDOW_H || '24', 10),
    // SAFETY GATE (Stage 4): produktiver FP-Schreibpfad (apply/restart/revert).
    // Default FALSE — Stage 4 ist nach Deploy bewusst UNSCHARF. Nur "true" aktiviert ihn.
    fpApplyEnabled:    process.env.WAZUH_FP_APPLY_ENABLED === 'true',
    // SAFETY GATE: direkter Manager-Restart via Wazuh-API (POST /wazuh/manager/restart).
    // Security-sensibel (Remote-Service-Steuerung) → default FALSE, nur "true" aktiviert.
    managerRestartEnabled: process.env.WAZUH_MANAGER_RESTART_ENABLED === 'true',
  },

  // Wazuh-API (Pull/Enrichment) — optional; leer = Enrichment aus.
  wazuhApi: {
    url:      process.env.WAZUH_API_URL      || '',
    user:     process.env.WAZUH_API_USER     || '',
    password: process.env.WAZUH_API_PASSWORD || '',
  },

  // Threat Intel (P17) — Provider-Keys NUR backend, nie im Frontend.
  // Leer = Provider 'not_configured' (Mock bleibt Fallback).
  threatIntel: {
    abuseIpDbKey:    process.env.ABUSEIPDB_API_KEY     || '',
    abuseMaxAgeDays: parseInt(process.env.ABUSEIPDB_MAX_AGE_DAYS || '90', 10),
    virusTotalKey:   process.env.VIRUSTOTAL_API_KEY    || '',
  },

  // Wazuh-Indexer (OpenSearch) für Dashboard-Aggregationen über wazuh-alerts-*.
  wazuhIndexer: {
    url:      process.env.WAZUH_INDEXER_URL      || '',
    user:     process.env.WAZUH_INDEXER_USER     || '',
    password: process.env.WAZUH_INDEXER_PASSWORD || '',
    index:    process.env.WAZUH_INDEXER_INDEX    || 'wazuh-alerts-*',
    vulnIndex: process.env.WAZUH_INDEXER_VULN_INDEX || 'wazuh-states-vulnerabilities-*',
  },

  // Apply-Kanal (P_CORR_ADMIN_2 Stufe 2) — globaler Kill-Switch, Default IMMER false.
  // Nur explizites CONFIG_APPLY_ENABLED=true schaltet den kontrollierten Apply scharf.
  // Selbst dann: nur apply-eligible Capabilities (enge Allowlist), admin + Vier-Augen
  // + frische Reauth + Gates. Nicht über die UI schaltbar.
  //
  // ⚠️ NICHT DEPLOY-REIF: Der Health-Check bestätigt bisher nur die Runtime-Config-VERSION;
  // echter Worker-Heartbeat + Queue-Liveness sind noch Test-Seam (konservativ true). Bis
  // P_CORR_ADMIN_2 Stufe 3 (Live Health Confirmation) darf CONFIG_APPLY_ENABLED in KEINER
  // echten Umgebung auf true gesetzt werden — sonst könnte ein Apply als erfolgreich gelten,
  // obwohl der Worker die Config nicht übernommen hat oder die Queue nicht mehr verarbeitet.
  apply: {
    enabled: process.env.CONFIG_APPLY_ENABLED === 'true',
    // Frische-Fenster für die Apply-Reauth (Sekunden).
    reauthWindowSeconds: parseInt(process.env.CONFIG_APPLY_REAUTH_WINDOW_S || '300', 10),
    // Health-Check-Timeout nach dem Schreiben (Millisekunden).
    healthTimeoutMs: parseInt(process.env.CONFIG_APPLY_HEALTH_TIMEOUT_MS || '10000', 10),
    // Max. Alter eines Worker-Heartbeats, damit er als „frisch" gilt (Millisekunden).
    heartbeatMaxAgeMs: parseInt(process.env.CONFIG_APPLY_HEARTBEAT_MAX_AGE_MS || '30000', 10),
  },

  // Deployment Center (ADR-041) — Infra-schreibender Pfad. Default IMMER false.
  // Nur explizites DEPLOY_ENABLED=true schaltet den Apply frei (Kill-Switch). Selbst
  // dann: nur Allowlist-Module/-Connectoren, admin + Vier-Augen + frische Reauth +
  // Gates + Rollback. Nicht über die UI schaltbar.
  deploy: {
    enabled: process.env.DEPLOY_ENABLED === 'true',
    // Frische-Fenster für die Deploy-Reauth (Sekunden).
    reauthWindowSeconds: parseInt(process.env.DEPLOY_REAUTH_WINDOW_S || '300', 10),
    // Status-Poll-Timeout nach dem Start (Millisekunden), bis die VM erreichbar sein muss.
    statusPollTimeoutMs: parseInt(process.env.DEPLOY_STATUS_POLL_TIMEOUT_MS || '120000', 10),
    // config-Zustellkanal in den Gast: 'first-boot-drive' | 'none' (Default fail-safe).
    deliverChannel: process.env.DEPLOY_DELIVER_CHANNEL || 'none',
    // SSRF-Allowlist: erlaubte Hypervisor-Hosts (kommagetrennt). In Prod Pflicht bei enabled.
    allowedHypervisorHosts: String(process.env.DEPLOY_HYPERVISOR_ALLOWED_HOSTS || '')
      .split(',').map((s) => s.trim()).filter(Boolean),
  },

  // System-Ops aus der Admin-UI (Restart / Git-Update) — default IMMER fail-closed.
  // Die App startet hier nur einen HOST-seitigen Befehl an; ohne explizite Freigabe,
  // Reauth und konfigurierten Host-Kanal bleibt jede Aktion gesperrt.
  systemControl: {
    repoRoot: process.env.SYSTEM_CONTROL_REPO_ROOT || '',
    restartEnabled: process.env.SYSTEM_SELF_RESTART_ENABLED === 'true',
    restartCommand: process.env.SYSTEM_SELF_RESTART_COMMAND || '',
    updateEnabled: process.env.SYSTEM_SELF_UPDATE_ENABLED === 'true',
    updateCommand: process.env.SYSTEM_SELF_UPDATE_COMMAND || '',
  },

  // Autonomie-Gate (ADR-016) — Default IMMER false.
  // Nur explizites AUTONOMY_ENABLED=true aktiviert den Evaluator.
  // Ohne diesen Kill-Switch bleibt jede Policy wirkungslos (advisory).
  autonomy: {
    enabled: process.env.AUTONOMY_ENABLED === 'true',
  },

  // Hunt-Response-Konsole: Default weiter inert.
  //  - HUNT_RESPONSE_AUTO_EXECUTE_MOCK=true: kontrollierter Mock-Pfad (kein echter Exec).
  //  - HUNT_RESPONSE_REAL_EXEC_ENABLED=true: schaltet die ECHTE, menschlich ausgelöste
  //    Endpoint-Ausführung frei (ADR-042). Beide default AUS, getrennt. Real-Exec ist
  //    NIE automatisch — nur ein Mensch löst sie mit frischer Reauth aus.
  huntResponse: {
    autoExecuteMock: process.env.HUNT_RESPONSE_AUTO_EXECUTE_MOCK === 'true',
    realExecutionEnabled: process.env.HUNT_RESPONSE_REAL_EXEC_ENABLED === 'true',
    // ADR-042 Slice 3: Mgmt-Preservation für die Host-Isolation (nftables). Ohne mgmtCidr
    // verweigert der Containment-Runner die Isolation (Selbst-Aussperr-Schutz) — die
    // spätere Freigabe muss über genau diesen Kanal zustellbar bleiben.
    mgmtCidr: process.env.HUNT_RESPONSE_MGMT_CIDR || null,
    mgmtSshPort: process.env.HUNT_RESPONSE_MGMT_SSH_PORT || '22',
  },

  // Outbound-Benachrichtigungskanäle — Default IMMER inert (false).
  // Kein Outbound ohne explizites NOTIFICATIONS_OUTBOUND_ENABLED=true UND konfigurierte URL.
  // Sicherheits-Invariante: URLs niemals ans Frontend geben — nur Boolean "configured".
  notifications: {
    outboundEnabled:   process.env.NOTIFICATIONS_OUTBOUND_ENABLED === 'true',
    slackWebhookUrl:   process.env.NOTIFY_SLACK_WEBHOOK_URL   || '',
    genericWebhookUrl: process.env.NOTIFY_WEBHOOK_URL         || '',
    teamsWebhookUrl:   process.env.NOTIFY_TEAMS_WEBHOOK_URL   || '',
    // E-Mail/SMTP-Kanal — inert solange host ODER to leer ist (Versand zusätzlich
    // durch NOTIFICATIONS_OUTBOUND_ENABLED gated). Creds bleiben serverseitig.
    email: {
      host:   process.env.NOTIFY_SMTP_HOST   || '',
      port:   Number(process.env.NOTIFY_SMTP_PORT) || 587,
      secure: process.env.NOTIFY_SMTP_SECURE === 'true',   // true = 465/TLS, false = STARTTLS
      user:   process.env.NOTIFY_SMTP_USER   || '',
      pass:   process.env.NOTIFY_SMTP_PASS   || '',
      from:   process.env.NOTIFY_EMAIL_FROM  || '',
      to:     process.env.NOTIFY_EMAIL_TO    || '',   // kommagetrennte Empfängerliste
    },
  },

  // Personal Access Tokens (Wave C) — Default IMMER false (inert).
  // Nur explizites API_TOKENS_ENABLED=true aktiviert PAT-Auth + Routen.
  apiTokens: {
    enabled: process.env.API_TOKENS_ENABLED === 'true',
  },

  // MFA / TOTP (Security-Welle 3) — Default IMMER false (inert nach Deploy).
  // Nur explizites MFA_ENABLED=true schaltet Enrollment-Routen + Login-Challenge frei.
  mfa: {
    enabled: process.env.MFA_ENABLED === 'true',
    // Brute-Force-Schutz für die 2.-Faktor-Verifikation (TOTP-Rateversuche gegen
    // den 6-stelligen Code). Greift auf POST /auth/mfa (pro Challenge-Token) und
    // /mfa/verify + /mfa/disable (pro User). Nur FEHLGESCHLAGENE Versuche zählen
    // (skipSuccessfulRequests) → ein legitimer Code wird nie blockiert. Sichere
    // Prod-Defaults; im Test default-inaktiv (nur aktiv, wenn MFA_VERIFY_MAX gesetzt).
    verifyLimit: {
      windowMs: parseInt(process.env.MFA_VERIFY_WINDOW_MS || '900000', 10), // 15 min
      max:      parseInt(process.env.MFA_VERIFY_MAX        || '5',      10),
    },
  },

  // SSO / OIDC (Security-Welle 3) — Default IMMER inert (OIDC_ENABLED!=true).
  // Authorization Code + PKCE; der Passwort-Login bleibt parallel bestehen.
  // Client-Secret bleibt strikt backend-only (nie ans Frontend). Default-Rolle
  // bewusst 'viewer' (PoLA — kein Auto-Admin). allowSignup=false → nur Linking
  // bestehender Accounts per verifizierter E-Mail, kein Auto-Anlegen.
  oidc: {
    enabled:      process.env.OIDC_ENABLED === 'true',
    issuer:       process.env.OIDC_ISSUER        || '',   // z.B. https://idp.example.com/realms/soc
    clientId:     process.env.OIDC_CLIENT_ID     || '',
    clientSecret: process.env.OIDC_CLIENT_SECRET || '',
    redirectUri:  process.env.OIDC_REDIRECT_URI  || '',   // .../api/v1/auth/oidc/callback
    scope:        process.env.OIDC_SCOPE         || 'openid profile email',
    defaultRole:  process.env.OIDC_DEFAULT_ROLE  || 'viewer',
    allowSignup:  process.env.OIDC_ALLOW_SIGNUP === 'true',
  },

  // WebAuthn / Passkey (Security-Welle 3) — Default IMMER inert (WEBAUTHN_ENABLED!=true).
  // FIDO2 als 2. Faktor / Passkey, ergänzt das vorhandene TOTP-MFA.
  //   rpId   = registrierbare Domain OHNE Schema/Port (z.B. nexora.example)
  //   origin = vollständige erwartete Herkunft MIT Schema (z.B. https://nexora.example)
  webauthn: {
    enabled:   process.env.WEBAUTHN_ENABLED === 'true',
    rpId:      process.env.WEBAUTHN_RP_ID      || '',
    rpName:    process.env.WEBAUTHN_RP_NAME    || 'Nexora SOC',
    origin:    process.env.WEBAUTHN_ORIGIN     || '',
    timeoutMs: Number(process.env.WEBAUTHN_TIMEOUT_MS) || 60000,
  },

  // Outbound-Ticket-Export (P12) — Default IMMER inert (false).
  // Nur explizites EXTERNAL_TICKET_EXPORT_ENABLED=true schaltet POST /tickets/:id/export frei.
  // Pro Zielsystem aktiv erst, wenn dessen *_BASE_URL + Credentials gesetzt sind (Adapter-ENV);
  // Credentials bleiben backend-only, nie im Frontend.
  externalTicket: {
    enabled: process.env.EXTERNAL_TICKET_EXPORT_ENABLED === 'true',
  },

  log: {
    level: process.env.LOG_LEVEL || 'info',
  },
};

module.exports = config;
