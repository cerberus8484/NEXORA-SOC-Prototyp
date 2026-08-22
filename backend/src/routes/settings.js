'use strict';

// Settings-Router
// GET  /api/v1/settings/platform     — requireAuth (alle Rollen lesen)
// PUT  /api/v1/settings/platform     — requireRole('admin') + Joi-Validierung + Audit
// GET  /api/v1/settings/ki           — requireRole('admin')
// PUT  /api/v1/settings/ki           — requireRole('admin')
// GET  /api/v1/settings/ki/models    — requireRole('admin')
//
// Persistenz via SettingsRepository (InMemory/Postgres, key-prefix: platform_*).
// Änderungen werden im Audit-Log protokolliert (SETTINGS_CHANGED).
// Ehrlichkeits-Regel (ADR-009): Nur persistieren/anzeigen, was wir meinen.
// KEINE Sicherheits-Toggles (MFA, TLS, SSO) hier — die hätten keine Enforce-Logik.

const { Router } = require('express');

const rateLimit = require('express-rate-limit');
const { requireAuth, requireRole }    = require('../middleware/authenticate');
const { createSettingsRepository }    = require('../repositories/settingsRepositoryFactory');
const { auditService, AUDIT_ACTIONS } = require('../services/AuditService');
const { authService }                 = require('../services/AuthService');
const { platformSettingsSchema }      = require('../domain/validation/platformSettingsSchema');
const { setMaintenance }              = require('../middleware/maintenanceGuard');
const { setTlsEnforce }               = require('../middleware/tlsGuard');
const { setIpAllowlist }              = require('../middleware/ipAllowlistGuard');
// Info-Disclosure-Härtung: Verbindungstests spiegeln nie rohe Fehler-Strings an den
// Client (Netz-Topologie / Fremd-Server-Texte). classifyConnError → feste Kategorie;
// der rohe err.message bleibt nur serverseitig (Log).
const { classifyConnError }           = require('../integrations/http/connErrorClassifier');
const logger                          = require('../logger');

const router       = Router();
const settingsRepo = createSettingsRepository();

// ── Plattform-Einstellungen ───────────────────────────────────────────────────
// Nur diese Keys werden gelesen/geschrieben. Kein KI-Key kommt hier durch.
// Prefix platform_ trennt Namespaces im gemeinsamen Key-Value-Store sauber.
//
// Security-Keys werden serverseitig in AuthService/UserService durchgesetzt
// (echte Wirkung, kein Fake-Persist — ADR-009). mfaRequired erzwingt org-weit
// MFA-Enrollment beim Login (greift nur wenn MFA_ENABLED). SSO bleibt bewusst NICHT hier.
const PLATFORM_KEYS = [
  'platformName', 'defaultView', 'timezone', 'language', 'maintenanceMode', 'betaFeatures',
  'passwordMinLength', 'passwordComplexity', 'sessionMaxHours',
  'lockoutMaxAttempts', 'lockoutMinutes',
  'passwordExpiryDays', 'passwordHistoryCount', 'maxConcurrentSessions', 'inactivityTimeoutMinutes',
  'tlsEnforce', 'ipAllowlistEnabled', 'ipAllowlistCidrs', 'mfaRequired',
  'accentColor', 'fontFamily', 'backgroundColor', 'sidebarColor',
];
const PLATFORM_DEFAULTS = {
  platformName:       'Nexora SOC Platform',
  defaultView:        'dashboard',
  timezone:           'Europe/Berlin',
  language:           'en',
  maintenanceMode:    false,
  betaFeatures:       false,
  passwordMinLength:  8,
  passwordComplexity: 'medium',
  sessionMaxHours:    8,
  // Account-Lockout: 0 = deaktiviert (kein Verhaltenswechsel ohne explizite Admin-Aktivierung)
  lockoutMaxAttempts: 0,
  lockoutMinutes:     15,
  // Passwort-Aging: 0 = deaktiviert
  passwordExpiryDays:   0,
  passwordHistoryCount: 0,
  // Concurrent-Session-Limit: 0 = unbegrenzt
  maxConcurrentSessions: 0,
  // Inaktivitäts-Timeout (clientseitig): 0 = aus
  inactivityTimeoutMinutes: 0,
  // Zugriffskontrolle: default aus (kein Verhaltenswechsel ohne Admin-Aktivierung)
  tlsEnforce:         false,
  ipAllowlistEnabled: false,
  ipAllowlistCidrs:   '',
  // Org-weite MFA-Pflicht: default aus (kein Verhaltenswechsel ohne Admin-Aktivierung)
  mfaRequired:        false,
  accentColor:        '#3b82f6',
  // Branding-Erweiterung: Schriftart-Stack-Key + App-Hintergrund + Sidebar-Farbe.
  fontFamily:         'default',
  backgroundColor:    '#f8fafd',
  sidebarColor:       '#0b1726',
};

async function readPlatformSettings() {
  const result = {};
  for (const key of PLATFORM_KEYS) {
    const stored = await settingsRepo.get(`platform_${key}`);
    result[key] = stored !== null && stored !== undefined ? stored : PLATFORM_DEFAULTS[key];
  }
  return result;
}

// ── GET /api/v1/settings/platform ────────────────────────────────────────────
router.get('/platform', requireAuth, async (req, res, next) => {
  try {
    const data = await readPlatformSettings();
    res.json({ data, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/v1/settings/platform ────────────────────────────────────────────
router.put('/platform', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { error, value } = platformSettingsSchema.validate(req.body || {});
    if (error) {
      const details = error.details.map((d) => ({
        field:   d.path.join('.'),
        message: d.message.replace(/['"]/g, ''),
      }));
      return res.status(400).json({ error: 'VALIDATION_ERROR', details, requestId: req.id });
    }

    // Aktuellen Stand laden, dann Änderungen zusammenführen
    const current = await readPlatformSettings();
    const updated = { ...current, ...value };

    for (const key of PLATFORM_KEYS) {
      if (key in updated) {
        await settingsRepo.set(`platform_${key}`, updated[key]);
      }
    }

    // maintenanceMode-Cache sofort aktualisieren (kein DB-Read pro Request)
    if ('maintenanceMode' in value) {
      setMaintenance(value.maintenanceMode);
    }
    // Zugriffskontroll-Caches sofort aktualisieren (kein DB-Read pro Request)
    if ('tlsEnforce' in value) {
      setTlsEnforce(updated.tlsEnforce);
    }
    if ('ipAllowlistEnabled' in value || 'ipAllowlistCidrs' in value) {
      setIpAllowlist(updated.ipAllowlistEnabled, updated.ipAllowlistCidrs);
    }

    await auditService.write({
      actorUserId: req.user?.sub ?? null,
      actorLabel:  req.user?.email ?? 'unknown',
      action:      AUDIT_ACTIONS.SETTINGS_CHANGED,
      targetType:  'platform_settings',
      targetId:    'platform',
      metadata:    { changed: value },
      ip:          req.ip,
    });

    res.json({ data: updated, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

const { PROVIDER_KINDS, providerStatus, buildProvider, resolveApiKey, KEY_SETTING_KEY, MODEL_SETTING_KEY } = require('../agents/providers/llmProviderFactory');
const { encryptSecret } = require('../config/secretsCrypto');
const { probeOllamaConnection } = require('../services/ollamaConnectionProbe');
const { resolveOllamaConnection } = require('../services/ollamaConnectionSettings');
const KNOWN_PROVIDERS = PROVIDER_KINDS; // stub · ollama · anthropic · openai · google

// Nicht-geheime KI-Keys, die im GET zurückkommen dürfen (kein ungefiltertes getAll()).
// WICHTIG: Cloud-API-Keys (anthropicApiKey/openaiApiKey/googleApiKey) sind NIE dabei —
// sie liegen verschlüsselt in der DB und werden nie im Klartext ausgegeben (nur Status via /ki/providers).
const KI_KEYS = ['ollamaBaseUrl', 'ollamaModel', 'agentLlmProvider', 'ragEnabled',
  'anthropicModel', 'openaiModel', 'googleModel',
  'agentFallback1', 'agentFallback2', 'llmTemperature', 'llmTopP', 'llmMaxTokens'];

// API-Key-Settings-Keys (verschlüsselt gespeichert) — getrennt behandelt, nie im GET.
const API_KEY_FIELDS = { anthropicApiKey: 'anthropic', openaiApiKey: 'openai', googleApiKey: 'google' };

function pickKiKeys(all) {
  const out = {};
  for (const key of KI_KEYS) out[key] = all[key];
  return out;
}

// SSRF-Schutz: ollamaBaseUrl muss auf localhost oder einen RFC-1918-Host zeigen.
// Geteilte Allowlist (Single Source of Truth) — identisch im Integrations-Status-Pfad.
const { OLLAMA_URL_ALLOWLIST } = require('../integrations/http/ollamaUrlAllowlist');

// ── GET /api/v1/settings/ki ─────────────────────────────────────────────────
router.get('/ki', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const data = pickKiKeys(await settingsRepo.getAll());
    res.json({ data, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/settings/ki/providers ────────────────────────────────────────
// Verfügbarkeit je Provider (ist der API-Key konfiguriert?) — gibt NIE einen Key preis.
router.get('/ki/providers', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const [providers, active] = await Promise.all([providerStatus(), settingsRepo.get('agentLlmProvider')]);
    res.json({ data: { providers, active: active || process.env.AGENT_LLM_PROVIDER || 'stub' }, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// Verbindungstest-Deadline: deutlich unter nginx proxy_read_timeout (60s), damit der
// Test NIE ein 504 auslöst. Der Provider bekommt ein etwas kürzeres HTTP-Timeout, die
// harte Race-Deadline ist der Backstop, falls ein Provider sein Timeout ignoriert.
const KI_TEST_PROVIDER_TIMEOUT_MS = 12000;
const KI_TEST_DEADLINE_MS = 15000;

/** Läuft `promise`, bricht aber nach `ms` mit einem Timeout-Fehler ab (Backstop gegen 504). */
function withDeadline(promise, ms) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('deadline exceeded — timeout')), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

// ── POST /api/v1/settings/ki/test — Verbindung zu einem Provider testen ──────
// Baut den Provider (Key aus ENV/DB, Modell + Ollama-URL aus Settings) und macht einen
// minimalen Probe-Call mit KURZEM Timeout. Gibt ok + Latenz oder eine klare Fehlermeldung
// zurück — nie ein 504, auch wenn der Provider langsam/nicht erreichbar ist.
router.post('/ki/test', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const kind = String(req.body?.provider || '').toLowerCase();
    if (!PROVIDER_KINDS.includes(kind)) {
      return res.status(400).json({ error: 'INVALID_PROVIDER', message: `Unbekannter Provider: ${kind}`, requestId: req.id });
    }
    const ollama = kind === 'ollama' ? await resolveOllamaConnection(settingsRepo, process.env) : null;
    const model  = kind === 'ollama'
      ? ollama.model || null
      : (MODEL_SETTING_KEY[kind] ? (await settingsRepo.get(MODEL_SETTING_KEY[kind]) || null) : null);
    const apiKey = await resolveApiKey(kind, settingsRepo);
    // Ollama: die in der UI konfigurierte Basis-URL testen (nicht nur die ENV-Default).
    const baseUrl = kind === 'ollama' ? (ollama.baseUrl || undefined) : undefined;

    if (kind === 'ollama') {
      const t0 = Date.now();
      const probe = await probeOllamaConnection({
        baseUrl,
        model,
        requireModel: true,
        timeout: KI_TEST_PROVIDER_TIMEOUT_MS,
      });
      return res.json({
        data: {
          ok: probe.reachable && probe.modelAvailable !== false,
          latencyMs: Date.now() - t0,
          model: probe.reachable && probe.modelAvailable !== false ? `ollama:${String(model || '').trim()}` : undefined,
          error: probe.reachable && probe.modelAvailable !== false ? undefined : probe.message,
        },
        requestId: req.id,
      });
    }

    const provider = buildProvider(kind, { model, apiKey, params: {}, timeout: KI_TEST_PROVIDER_TIMEOUT_MS, baseUrl });

    const t0 = Date.now();
    try {
      await withDeadline(
        provider.propose({ ticket: { id: 'conn-test', title: 'Verbindungstest' }, kind: 'triage' }),
        KI_TEST_DEADLINE_MS,
      );
      return res.json({ data: { ok: true, latencyMs: Date.now() - t0, model: provider.name }, requestId: req.id });
    } catch (err) {
      // Provider-/Timeout-Fehler sind hier ein erwartetes Test-Ergebnis (kein 500).
      // Rohen Fehler nur serverseitig loggen; Client bekommt eine sichere Kategorie.
      logger.warn('ki_connection_test_failed', { kind, message: err.message });
      return res.json({ data: { ok: false, latencyMs: Date.now() - t0, error: classifyConnError(err) }, requestId: req.id });
    }
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/v1/settings/ki ─────────────────────────────────────────────────
router.put('/ki', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const current = await settingsRepo.getAll();

    // Fallback darf NIE undefined sein — sonst landet undefined als NULL in der
    // NOT-NULL-Spalte platform_settings.value (500). Unbelegte Felder → ''.
    const str  = (v, fallback) => (typeof v === 'string' ? v.trim() : (fallback ?? ''));
    const blank = (v) => (v === '' || v == null);
    const fbProvider = (v, fallback) => {
      if (v == null) return fallback;
      const s = String(v).trim().toLowerCase();
      return s === '' ? '' : s;   // '' = kein Fallback
    };
    const updated = {
      ollamaBaseUrl:    str(b.ollamaBaseUrl,    current.ollamaBaseUrl),
      ollamaModel:      str(b.ollamaModel,      current.ollamaModel),
      agentLlmProvider: str(b.agentLlmProvider, current.agentLlmProvider),
      ragEnabled:       typeof b.ragEnabled === 'boolean' ? b.ragEnabled : current.ragEnabled,
      anthropicModel:   str(b.anthropicModel,   current.anthropicModel),
      openaiModel:      str(b.openaiModel,      current.openaiModel),
      googleModel:      str(b.googleModel,      current.googleModel),
      agentFallback1:   fbProvider(b.agentFallback1, current.agentFallback1 ?? ''),
      agentFallback2:   fbProvider(b.agentFallback2, current.agentFallback2 ?? ''),
      llmTemperature:   blank(b.llmTemperature) ? (current.llmTemperature ?? '') : Number(b.llmTemperature),
      llmTopP:          blank(b.llmTopP)        ? (current.llmTopP        ?? '') : Number(b.llmTopP),
      llmMaxTokens:     blank(b.llmMaxTokens)   ? (current.llmMaxTokens   ?? '') : Number(b.llmMaxTokens),
    };

    // Provider + Fallbacks gegen die bekannte Liste validieren ('' = kein Fallback erlaubt).
    const provErr = [updated.agentLlmProvider, updated.agentFallback1, updated.agentFallback2]
      .find((p) => p !== '' && !KNOWN_PROVIDERS.includes(p));
    if (provErr) {
      return res.status(400).json({ error: 'INVALID_PROVIDER', message: `Unbekannter Provider: ${provErr}`, requestId: req.id });
    }
    if (updated.ollamaBaseUrl && !OLLAMA_URL_ALLOWLIST.test(updated.ollamaBaseUrl)) {
      return res.status(400).json({ error: 'INVALID_OLLAMA_URL', message: 'ollamaBaseUrl muss auf einen internen Host zeigen (localhost, RFC-1918)', requestId: req.id });
    }

    for (const [key, value] of Object.entries(updated)) {
      // Defensive: niemals undefined an die NOT-NULL-Spalte (value) übergeben.
      await settingsRepo.set(key, value === undefined ? '' : value);
    }

    // API-Keys getrennt: verschlüsselt speichern, nur wenn ein nicht-leerer Wert kommt.
    // Leeres Feld = unverändert (das maskierte UI-Feld überschreibt den Key nicht).
    const keysChanged = [];
    for (const [field, kind] of Object.entries(API_KEY_FIELDS)) {
      const raw = b[field];
      if (typeof raw === 'string' && raw.trim() !== '') {
        await settingsRepo.set(KEY_SETTING_KEY[kind], encryptSecret(raw.trim()));
        keysChanged.push(kind);
      }
    }

    await auditService.write({
      actorUserId: req.user?.sub ?? null,
      actorLabel:  req.user?.email ?? 'unknown',
      action:      AUDIT_ACTIONS.SETTINGS_CHANGED,
      targetType:  'platform_settings',
      targetId:    'ki',
      // NIE Key-Werte loggen — nur welche Provider-Keys gesetzt wurden.
      metadata:    { changed: updated, apiKeysSet: keysChanged },
      ip:          req.ip,
    });

    res.json({ data: updated, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/settings/ki/models — fragt Ollama /api/tags ab ──────────────
router.get('/ki/models', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { baseUrl, model } = await resolveOllamaConnection(settingsRepo, process.env);
    const probe = await probeOllamaConnection({
      baseUrl,
      model,
      requireModel: false,
      timeout: 4000,
    });
    res.json({
      data: probe.models,
      reachable: probe.reachable,
      modelAvailable: probe.modelAvailable,
      reason: probe.reason,
      message: probe.message,
      ...(probe.reachable ? {} : { error: probe.message }),
      requestId: req.id,
    });
  } catch (err) {
    next(err);
  }
});

// ── OIDC / SSO — In-UI-Admin-Konfig (P1 #6) ──────────────────────────────────
// SSO hat jetzt ECHTE Enforce-Logik: der OidcService liest die effektive Config
// dynamisch aus diesem Store (oidcConfigService) — kein Fake-Persist (ADR-009).
// Das Client-Secret liegt verschlüsselt at-rest und wird NIE im GET zurückgegeben.
const fetchFn = require('node-fetch');
const { readOidcConfigForAdmin, writeOidcConfig, getEffectiveOidcConfig } = require('../auth/oidc/oidcConfigService');
const { oidcConfigSchema } = require('../domain/validation/oidcConfigSchema');

// Step-up-Limiter für die OIDC-Config-Änderung (Online-Passwortprüfung) — pro User, im Test inaktiv.
const oidcConnLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.user?.sub || 'anon',
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'rate_limited', message: 'Zu viele Versuche — bitte später erneut.' },
});

// GET /api/v1/settings/oidc — admin; maskiert (clientSecretSet statt Secret).
router.get('/oidc', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    res.json({ data: await readOidcConfigForAdmin(settingsRepo), requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/settings/oidc — admin + Step-up-Reauth (OIDC steuert die Plattform-Auth →
// mindestens dieselbe Passwortbestätigung wie bei den Connector-Configs) + Joi + Audit.
router.put('/oidc', requireAuth, requireRole('admin'), oidcConnLimiter, async (req, res, next) => {
  try {
    // password ist die Step-up-Credential, kein Config-Feld → vor der Schema-Validierung trennen.
    const { password, ...patch } = req.body || {};
    const { error, value } = oidcConfigSchema.validate(patch);
    if (error) {
      const details = error.details.map((d) => ({ field: d.path.join('.'), message: d.message.replace(/['"]/g, '') }));
      return res.status(400).json({ error: 'VALIDATION_ERROR', details, requestId: req.id });
    }

    // Step-up-Reauth: frische Online-Passwortprüfung des handelnden Admins (kein reines Session-Vertrauen).
    const actingUser = await authService._findById(req.user?.sub);
    const reauthOk = actingUser && actingUser.passwordHash && typeof password === 'string'
      ? await authService.verifyPassword(password, actingUser.passwordHash)
      : false;
    if (!reauthOk) {
      await auditService.write({
        actorUserId: req.user?.sub ?? null, actorLabel: req.user?.email ?? 'unknown',
        action: AUDIT_ACTIONS.OIDC_CONFIG_CHANGE_DENIED, targetType: 'platform_settings', targetId: 'oidc',
        metadata: { outcome: 'denied_invalid_password' }, ip: req.ip,
      });
      return res.status(403).json({ error: 'invalid_password', message: 'Passwort ungültig.', requestId: req.id });
    }

    // SSO darf nur aktiviert werden, wenn die Config danach vollständig ist
    // (Issuer + Client-ID + Secret) — sonst liefe der Login ins Leere.
    const current = await readOidcConfigForAdmin(settingsRepo);
    const willEnabled  = typeof value.enabled === 'boolean' ? value.enabled : current.enabled;
    const willIssuer   = value.issuer   !== undefined ? value.issuer.trim()   !== '' : Boolean(current.issuer);
    const willClientId = value.clientId !== undefined ? value.clientId.trim() !== '' : Boolean(current.clientId);
    const willSecret   = (typeof value.clientSecret === 'string' && value.clientSecret.trim() !== '') || current.clientSecretSet;
    if (willEnabled && !(willIssuer && willClientId && willSecret)) {
      return res.status(400).json({
        error: 'OIDC_INCOMPLETE',
        message: 'SSO kann nur aktiviert werden, wenn Issuer, Client-ID und Client-Secret gesetzt sind.',
        requestId: req.id,
      });
    }

    const masked = await writeOidcConfig(settingsRepo, value);

    await auditService.write({
      actorUserId: req.user?.sub ?? null,
      actorLabel:  req.user?.email ?? 'unknown',
      action:      AUDIT_ACTIONS.SETTINGS_CHANGED,
      targetType:  'platform_settings',
      targetId:    'oidc',
      // NIE den Secret-Wert loggen — nur, ob er (neu) gesetzt wurde + die übrigen Felder.
      metadata:    { changed: { ...value, clientSecret: undefined }, secretSet: typeof value.clientSecret === 'string' && value.clientSecret.trim() !== '' },
      ip:          req.ip,
    });

    res.json({ data: masked, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/settings/oidc/test — admin; Discovery-Probe gegen den (übergebenen
// oder gespeicherten) Issuer. SSRF-Härtung: nur https, kein Redirect-Folgen, Timeout.
router.post('/oidc/test', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const issuer = (typeof req.body?.issuer === 'string' && req.body.issuer.trim())
      ? req.body.issuer.trim().replace(/\/+$/, '')
      : (await getEffectiveOidcConfig(settingsRepo)).issuer.replace(/\/+$/, '');
    if (!/^https:\/\//i.test(issuer)) {
      return res.json({ data: { ok: false, error: 'Issuer muss eine https-URL sein' }, requestId: req.id });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const t0 = Date.now();
    try {
      const resp = await fetchFn(`${issuer}/.well-known/openid-configuration`, { redirect: 'error', signal: controller.signal });
      if (!resp.ok) {
        return res.json({ data: { ok: false, error: `Discovery HTTP ${resp.status}`, latencyMs: Date.now() - t0 }, requestId: req.id });
      }
      const doc = await resp.json();
      const ok = Boolean(doc.authorization_endpoint && doc.token_endpoint && doc.jwks_uri);
      return res.json({
        data: { ok, latencyMs: Date.now() - t0, issuer: doc.issuer || issuer, ...(ok ? {} : { error: 'Discovery-Dokument unvollständig' }) },
        requestId: req.id,
      });
    } catch (err) {
      // Rohen Fehler nur serverseitig; Client bekommt Timeout bzw. sichere Kategorie.
      logger.warn('oidc_discovery_test_failed', { message: err.message });
      const safeError = err.name === 'AbortError' ? 'Timeout' : classifyConnError(err);
      return res.json({ data: { ok: false, error: safeError, latencyMs: Date.now() - t0 }, requestId: req.id });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    next(err);
  }
});

// ── Threat-Intel-Provider-Keys (Layer 2: UI-verwaltet, verschlüsselt) ─────────
// VirusTotal + AbuseIPDB: Keys admin-seitig konfigurierbar statt nur .env.
// Verschlüsselt in platform_settings (DB > ENV); GET liefert nie einen Key-Wert.
const { TI_PROVIDERS, resolveTiKey, saveTiKeys, maskedTiKeys } = require('../services/threatIntelKeys');
const { applyThreatIntelKeys } = require('../integrations/threatIntel/threatIntelKeysApplier');
const { AbuseIpDbProvider } = require('../integrations/threatIntel/AbuseIpDbProvider');
const { VirusTotalProvider } = require('../integrations/threatIntel/VirusTotalProvider');
const { WEBHOOK_SOURCES, saveWebhookSecret, maskedWebhookSecrets } = require('../services/webhookSecretsSettings');
const { RealHttpClient } = require('../integrations/http/RealHttpClient');

// Kurzer Timeout für den Test-Pfad (nicht den Request lange blockieren).
const _tiTestProvider = (provider, key) => (provider === 'virustotal'
  ? new VirusTotalProvider({ key, http: new RealHttpClient({ timeout: 5000 }) })
  : new AbuseIpDbProvider({ key, http: new RealHttpClient({ timeout: 5000 }) }));

// GET /api/v1/settings/ti — maskierte Key-Status (admin-only, nie Key-Werte).
router.get('/ti', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    res.json({ data: await maskedTiKeys(settingsRepo), requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/settings/ti — Keys speichern (verschlüsselt) + Provider live rekonfigurieren.
// Leeres Feld = unverändert (maskiertes Feld überschreibt den Key nicht).
router.put('/ti', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const patch = {};
    for (const provider of TI_PROVIDERS) {
      if (typeof b[provider] === 'string') patch[provider] = b[provider];
    }
    const changed = await saveTiKeys(settingsRepo, patch);
    await applyThreatIntelKeys(settingsRepo);

    if (changed.length > 0) {
      await auditService.write({
        actorUserId: req.user?.sub ?? null,
        actorLabel:  req.user?.email ?? 'unknown',
        action:      AUDIT_ACTIONS.TI_KEYS_CHANGED,
        targetType:  'platform_settings',
        targetId:    'threat_intel',
        // NIE Key-Werte loggen — nur welche Provider-Keys gesetzt wurden.
        metadata:    { changed },
        ip:          req.ip,
      });
    }

    res.json({ data: await maskedTiKeys(settingsRepo), requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// ── Inbound-Webhook-Secrets (Layer 2: Alert→Ticket-HMAC, DB > ENV) ────────────
// GET — maskiert (je Quelle nur set + Herkunft, NIE ein Secret-Wert).
router.get('/webhook-secrets', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    res.json({ data: await maskedWebhookSecrets(settingsRepo), requestId: req.id });
  } catch (err) { next(err); }
});

// PUT — Secret einer Quelle setzen/rotieren ({ source, secret }); leeres secret = löschen
// (→ ENV/generic-Fallback). Admin + Audit (nie der Wert im Log). Greift sofort (der
// Webhook-Handler löst pro Request DB > ENV auf — kein Neustart).
router.put('/webhook-secrets', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const source = String(req.body?.source || '').toLowerCase();
    if (!WEBHOOK_SOURCES.includes(source)) {
      return res.status(400).json({ error: 'INVALID_SOURCE', message: `Unbekannte Webhook-Quelle: ${source}`, requestId: req.id });
    }
    const secret = typeof req.body?.secret === 'string' ? req.body.secret : '';
    const result = await saveWebhookSecret(settingsRepo, source, secret);
    await auditService.write({
      actorUserId: req.user?.sub ?? null,
      actorLabel:  req.user?.email ?? 'unknown',
      action:      AUDIT_ACTIONS.WEBHOOK_SECRETS_CHANGED,
      targetType:  'platform_settings',
      targetId:    'webhook_secrets',
      metadata:    { source, set: result.set }, // NIE das Secret loggen
      ip:          req.ip,
    });
    res.json({ data: await maskedWebhookSecrets(settingsRepo), requestId: req.id });
  } catch (err) { next(err); }
});

// POST /api/v1/settings/ti/test — Provider-Verbindungstest (admin), ohne Speichern.
// Nutzt den optional übergebenen Key, sonst den effektiven (DB > ENV). Nicht
// konfiguriert → { ok:false, reason:'not_configured' } (kein externer Call).
router.post('/ti/test', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const provider = String(req.body?.provider || '').toLowerCase();
    if (!TI_PROVIDERS.includes(provider)) {
      return res.status(400).json({ error: 'INVALID_PROVIDER', message: `Unbekannter Provider: ${provider}`, requestId: req.id });
    }
    const candidate = typeof req.body?.key === 'string' && req.body.key.trim() !== '' ? req.body.key.trim() : null;
    const key = candidate ?? (await resolveTiKey(provider, settingsRepo)).key;
    if (!key) {
      return res.json({ data: { ok: false, reason: 'not_configured' }, requestId: req.id });
    }

    // Gegen eine bekannte öffentliche IP proben (Google DNS) — reiner Erreichbarkeits-/
    // Auth-Check. Der Provider wirft nie; er liefert status ok/error/rate_limited.
    const inst = _tiTestProvider(provider, key);

    const t0 = Date.now();
    const r = await inst.enrich('ip', '8.8.8.8');
    const ok = r.status === 'ok';
    res.json({
      data: ok
        ? { ok: true, latencyMs: Date.now() - t0, summary: r.rawSummary }
        : { ok: false, reason: r.status, error: r.rawSummary, latencyMs: Date.now() - t0 },
      requestId: req.id,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
