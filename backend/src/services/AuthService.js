'use strict';

const bcrypt = require('bcrypt');
const jwt    = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const { User }       = require('../domain/User');
const { InMemoryUserRepository } = require('../repositories/InMemoryUserRepository');
const { UnauthorizedError, ValidationError } = require('../errors/AppError');
const logger = require('../logger');

const BCRYPT_DEFAULT_ROUNDS = 12;
const BCRYPT_TEST_ROUNDS    = 4;
const JWT_MIN_LEN   = 32;
const DEV_FALLBACK  = 'dev-secret-change-in-production-min-32-chars';

const config = require('../config');
const { validatePassword, pushPasswordHistory, isPasswordExpired } = require('../domain/passwordPolicy');

// Kurzlebige MFA-Login-Challenge (2. Faktor). Trägt purpose:'mfa_challenge' und
// KEINE Session-Semantik (kein jti/role) — verifyToken lehnt es für normale Routen ab.
const MFA_CHALLENGE_EXPIRES = '5m';

// MFA-Setup-Token: bei org-weiter MFA-Pflicht stellt der Login statt einer Session
// einen kurzlebigen Setup-Token aus, der NUR das MFA-Enrollment autorisiert
// (purpose:'mfa_setup'; verifyToken lehnt ihn für geschützte Routen ab). 15 Min reichen
// zum Scannen + Bestätigen; danach muss der User sich erneut anmelden.
const MFA_SETUP_EXPIRES = '15m';

// Einheitliche, nicht-diskriminierende Fehlermeldung für ALLE MFA-Login-Fehlschläge.
// Verhindert User-Enumeration / Unterscheidung „Challenge abgelaufen" vs. „falscher Code".
const MFA_FAILED_MESSAGE = 'Zwei-Faktor-Bestätigung fehlgeschlagen — Code ungültig oder Sitzung abgelaufen.';
const { loadPasswordPolicy, loadSessionMaxHours, loadLockoutPolicy, loadPasswordAgingPolicy, loadMaxConcurrentSessions, loadMfaRequired } = require('../domain/passwordPolicyLoader');

// ── Persistente JWT-Blocklist ────────────────────────────────────────────────
// Wenn DB_ENABLED=true: Postgres-Tabelle jwt_blocklist (Lazy-Init beim ersten
// Zugriff). Sonst: In-Memory-Set als Fallback (Einträge gehen bei Neustart verloren,
// aber Tokens verfallen ohnehin nach JWT_EXPIRES).

const DB_ENABLED = process.env.DB_ENABLED === 'true';

// Lazy-Init-Flag damit CREATE TABLE IF NOT EXISTS nur einmal läuft.
let _dbBlocklistReady = false;

async function _ensureBlocklistTable(queryFn) {
  if (_dbBlocklistReady) return;
  await queryFn(`
    CREATE TABLE IF NOT EXISTS jwt_blocklist (
      jti        TEXT        PRIMARY KEY,
      expires_at TIMESTAMPTZ NOT NULL
    )
  `);
  _dbBlocklistReady = true;
}

/**
 * Fügt einen JTI in die Postgres-Blocklist ein.
 * exp ist der Unix-Timestamp (Sekunden) aus dem Token-Payload.
 */
async function _dbRevoke(queryFn, jti, exp) {
  await _ensureBlocklistTable(queryFn);
  const expiresAt = new Date(exp * 1000).toISOString();
  await queryFn(
    'INSERT INTO jwt_blocklist (jti, expires_at) VALUES ($1, $2) ON CONFLICT (jti) DO NOTHING',
    [jti, expiresAt],
  );
}

/**
 * Prüft ob ein JTI in der Postgres-Blocklist steht.
 * Räumt gleichzeitig abgelaufene Einträge auf (Lazy Cleanup).
 */
async function _dbIsRevoked(queryFn, jti) {
  await _ensureBlocklistTable(queryFn);
  // Abgelaufene Einträge aufräumen (best-effort). Fehler darf den Revoke-Check
  // nicht blockieren, wird aber sichtbar geloggt (kein stilles Schlucken).
  queryFn('DELETE FROM jwt_blocklist WHERE expires_at < now()')
    .catch((err) => logger.warn('jwt_blocklist_cleanup_failed', { message: err.message }));
  const res = await queryFn(
    'SELECT 1 FROM jwt_blocklist WHERE jti = $1 AND expires_at >= now()',
    [jti],
  );
  return (res.rows?.length ?? 0) > 0;
}

// ── Persistenter Account-Lockout ─────────────────────────────────────────────
// Analog zur jwt_blocklist: bei DB-Pfad Postgres-Tabelle login_lockouts
// (Lazy-Init), sonst In-Memory-Map als Fallback. Persistent = restart- und
// multi-instanz-fest (Lockout lässt sich nicht durch Neustart umgehen).

let _dbLockoutReady = false;

async function _ensureLockoutTable(queryFn) {
  if (_dbLockoutReady) return;
  await queryFn(`
    CREATE TABLE IF NOT EXISTS login_lockouts (
      email        TEXT        PRIMARY KEY,
      fails        INTEGER     NOT NULL DEFAULT 0,
      locked_until TIMESTAMPTZ,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  _dbLockoutReady = true;
}

// Gibt lockedUntil (ms) zurück, falls aktuell gesperrt — sonst null. Räumt
// abgelaufene Sperren best-effort auf.
async function _dbGetLockedUntil(queryFn, key) {
  await _ensureLockoutTable(queryFn);
  // Abgelaufene Sperren best-effort aufräumen; Fehler sichtbar loggen statt schlucken.
  queryFn('UPDATE login_lockouts SET locked_until = NULL, fails = 0 WHERE locked_until < now()')
    .catch((err) => logger.warn('lockout_cleanup_failed', { message: err.message }));
  const res = await queryFn('SELECT locked_until FROM login_lockouts WHERE email = $1', [key]);
  const lockedUntil = res.rows?.[0]?.locked_until;
  if (!lockedUntil) return null;
  const ms = new Date(lockedUntil).getTime();
  return ms > Date.now() ? ms : null;
}

// Zählt einen Fehlversuch hoch; bei Erreichen von maxAttempts wird gesperrt
// (locked_until gesetzt, Zähler zurück) — gleiche Semantik wie der In-Memory-Pfad.
async function _dbRecordFailure(queryFn, key, lockout) {
  await _ensureLockoutTable(queryFn);
  const res = await queryFn(
    `INSERT INTO login_lockouts (email, fails, updated_at)
       VALUES ($1, 1, now())
     ON CONFLICT (email) DO UPDATE SET fails = login_lockouts.fails + 1, updated_at = now()
     RETURNING fails`,
    [key],
  );
  const fails = res.rows?.[0]?.fails ?? 1;
  if (fails >= lockout.maxAttempts) {
    const lockedUntil = new Date(Date.now() + lockout.minutes * 60 * 1000).toISOString();
    await queryFn(
      'UPDATE login_lockouts SET locked_until = $2, fails = 0, updated_at = now() WHERE email = $1',
      [key, lockedUntil],
    );
  }
}

async function _dbClearLockout(queryFn, key) {
  await _ensureLockoutTable(queryFn);
  await queryFn('DELETE FROM login_lockouts WHERE email = $1', [key]);
}

// ── Aktive Sitzungen (Concurrent-Session-Limit) ──────────────────────────────
// Tabelle user_sessions hält pro ausgestelltem Token (jti) eine Zeile. Beim Login
// wird die neue Session eingetragen; überschreitet die Zahl aktiver Sessions das
// Limit, werden die ältesten revoziert (jti in jwt_blocklist + Zeile gelöscht).

let _dbSessionsReady = false;

async function _ensureSessionsTable(queryFn) {
  if (_dbSessionsReady) return;
  await queryFn(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      jti        TEXT        PRIMARY KEY,
      user_id    TEXT        NOT NULL,
      issued_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL
    )
  `);
  _dbSessionsReady = true;
}

async function _dbRecordSession(queryFn, jti, userId, expiresAtMs) {
  await _ensureSessionsTable(queryFn);
  // Abgelaufene Sessions best-effort aufräumen; Fehler sichtbar loggen statt schlucken.
  queryFn('DELETE FROM user_sessions WHERE expires_at < now()')
    .catch((err) => logger.warn('session_cleanup_failed', { message: err.message }));
  await queryFn(
    'INSERT INTO user_sessions (jti, user_id, expires_at) VALUES ($1, $2, $3) ON CONFLICT (jti) DO NOTHING',
    [jti, userId, new Date(expiresAtMs).toISOString()],
  );
}

// Revoziert die ältesten Sessions oberhalb des Limits (blocklist + Zeile löschen).
async function _dbEnforceSessionLimit(queryFn, userId, max, revokeFn) {
  await _ensureSessionsTable(queryFn);
  const res = await queryFn(
    'SELECT jti, expires_at FROM user_sessions WHERE user_id = $1 AND expires_at >= now() ORDER BY issued_at ASC',
    [userId],
  );
  const rows = res.rows ?? [];
  if (rows.length <= max) return;
  const toRevoke = rows.slice(0, rows.length - max);
  for (const row of toRevoke) {
    const expSec = Math.floor(new Date(row.expires_at).getTime() / 1000);
    await revokeFn(row.jti, expSec);                                   // jwt_blocklist
    await queryFn('DELETE FROM user_sessions WHERE jti = $1', [row.jti]);
  }
}

async function _dbRemoveSession(queryFn, jti) {
  await _ensureSessionsTable(queryFn);
  await queryFn('DELETE FROM user_sessions WHERE jti = $1', [jti]);
}

/**
 * Löst das JWT-Secret auf — fail-fast in Produktion.
 *
 * In Produktion (NODE_ENV=production) MUSS ein eigenes Secret (>=32 Zeichen)
 * gesetzt sein. Ohne das würde sonst still ein öffentlich bekanntes Dev-Secret
 * genutzt → Token-Fälschung / Auth-Bypass. Daher: Wurf statt stillem Fallback.
 */
function resolveJwtSecret({ secret, nodeEnv } = {}) {
  if (nodeEnv === 'production') {
    if (!secret || secret.length < JWT_MIN_LEN) {
      throw new Error(
        `JWT_SECRET muss in Produktion gesetzt sein (min. ${JWT_MIN_LEN} Zeichen) — kein Dev-Fallback erlaubt`
      );
    }
    return secret;
  }
  return secret || DEV_FALLBACK;
}

function resolveBcryptRounds({ rounds, nodeEnv } = {}) {
  if (nodeEnv === 'test' && !rounds) return BCRYPT_TEST_ROUNDS;

  const parsed = Number.parseInt(rounds || `${BCRYPT_DEFAULT_ROUNDS}`, 10);
  if (!Number.isInteger(parsed) || parsed < 4 || parsed > 31) {
    throw new Error('BCRYPT_ROUNDS muss eine Ganzzahl zwischen 4 und 31 sein');
  }
  if (nodeEnv === 'production' && parsed < BCRYPT_DEFAULT_ROUNDS) {
    throw new Error(`BCRYPT_ROUNDS muss in Produktion mindestens ${BCRYPT_DEFAULT_ROUNDS} sein`);
  }
  return parsed;
}

const JWT_SECRET  = resolveJwtSecret({ secret: process.env.JWT_SECRET, nodeEnv: process.env.NODE_ENV });
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '8h';
const BCRYPT_ROUNDS = resolveBcryptRounds({ rounds: process.env.BCRYPT_ROUNDS, nodeEnv: process.env.NODE_ENV });

class AuthService {
  constructor(userRepository = null, queryFn = null) {
    // P14: einheitlich über UserRepository — kein Map-Sonderzweig mehr.
    this._users = userRepository || new InMemoryUserRepository();
    // Blocklist: Postgres wenn DB_ENABLED, sonst In-Memory-Set.
    // queryFn wird im Singleton-Pfad aus dem Pool gezogen; in Tests kann ein
    // Stub übergeben werden.
    // queryFn wird explizit übergeben (Singleton: Pool-Query bei DB_ENABLED, sonst
    // null; Tests: Fake-queryFn). Wenn gesetzt → Postgres-Pfad für Blocklist + Lockout.
    this._queryFn    = queryFn || null;
    this._blocklist  = new Set();               // Set<jti> — Fallback ohne DB
    // Account-Lockout: fehlgeschlagene Login-Versuche pro E-Mail.
    // DB-Pfad (this._queryFn) → persistent in login_lockouts (restart-/multi-instanz-fest).
    // Fallback ohne DB → diese In-Memory-Map (Map<emailLower, { fails, lockedUntil }>).
    this._loginAttempts = new Map();
    // Aktive Sitzungen für das Concurrent-Session-Limit.
    // DB-Pfad → user_sessions; Fallback → Map<jti, { userId, expiresAt }> (Insertion-Order = ältester zuerst).
    this._sessions = new Map();
  }

  // Passwort hashen (Prod default: 12 rounds; Tests nutzen niedrigere Rounds für stabile Laufzeiten).
  async hashPassword(plaintext) {
    return bcrypt.hash(plaintext, BCRYPT_ROUNDS);
  }

  // Passwort prüfen
  async verifyPassword(plaintext, hash) {
    return bcrypt.compare(plaintext, hash);
  }

  // JWT erstellen — expiresIn optional überschreibbar (für sessionMaxHours)
  signToken(user, expiresIn = JWT_EXPIRES) {
    const jti = randomUUID();
    const token = jwt.sign(
      {
        sub:  user.id,
        jti,
        role: user.role,
        email: user.email,
      },
      JWT_SECRET,
      { expiresIn }
    );
    return { token, jti };
  }

  // JWT verifizieren + Blocklist prüfen
  // Gibt synchron zurück wenn DB nicht aktiv; async (Promise<payload>) wenn DB aktiv.
  // Aufrufer (authenticate-Middleware) awaitet den Rückgabewert — kompatibel in beiden Fällen.
  async verifyToken(token) {
    const payload = jwt.verify(token, JWT_SECRET); // wirft bei ungültigem Token
    // Purpose-Tokens (MFA-Challenge / MFA-Setup / OIDC-Flow / WebAuthn-Flow) sind KEINE
    // Session-Tokens — niemals für geschützte Routen gültig (nur für den Zweck-Endpoint).
    if (payload.purpose === 'mfa_challenge' || payload.purpose === 'mfa_setup' || payload.purpose === 'oidc_flow' || payload.purpose === 'webauthn_flow' || payload.purpose === 'apply_reauth' || payload.purpose === 'deploy_reauth') {
      throw new UnauthorizedError('Purpose-Token ist kein Session-Token');
    }
    const revoked = this._queryFn
      ? await _dbIsRevoked(this._queryFn, payload.jti)
      : this._blocklist.has(payload.jti);
    if (revoked) {
      throw new UnauthorizedError('Token wurde invalidiert');
    }
    return payload;
  }

  // User registrieren (intern — kein öffentlicher Signup)
  async register({ email, displayName, password, role = 'analyst', mustChangePassword = false }) {
    if (!email || !password) throw new ValidationError('email und password sind Pflichtfelder');

    // Policy serverseitig laden und durchsetzen — gilt NUR für neue Passwörter.
    const policy = await loadPasswordPolicy();
    const { ok, errors } = validatePassword(password, policy);
    if (!ok) throw new ValidationError(errors.join('; '));

    const passwordHash = await this.hashPassword(password);
    const user = new User({
      email, displayName, passwordHash, role,
      passwordChangedAt: new Date().toISOString(),
      mustChangePassword,
    });

    await this._users.save(user);
    return user.toPublicJSON();
  }

  /**
   * Idempotenter Admin-Bootstrap: legt den Admin nur an, wenn dieser
   * E-Mail-Account noch nicht existiert. Gibt { created } zurück.
   * Loggt NIEMALS das Passwort.
   */
  async ensureAdminUser({ email, password, mustChangePassword = true }) {
    if (!email || !password) throw new ValidationError('ADMIN_EMAIL und ADMIN_PASSWORD sind erforderlich');
    const existing = await this._findByEmail(email);
    if (existing) return { created: false, email: existing.email };
    // Bootstrap-Admin startet i.d.R. mit temporärem Passwort → Wechsel beim ersten Login
    // erzwingen (Default). Für automatisierte Fixtures (E2E) opt-out via Flag.
    const user = await this.register({
      email, displayName: 'Administrator', password, role: 'admin', mustChangePassword,
    });
    return { created: true, email: user.email };
  }

  // Login — gibt JWT zurück
  async login({ email, password, ip = '' }) {
    const key = (email || '').toLowerCase();

    // Account-Lockout-Policy laden (defensiv: in Tests kann der Loader gemockt sein).
    const lockout = typeof loadLockoutPolicy === 'function'
      ? await loadLockoutPolicy()
      : { maxAttempts: 0, minutes: 15 };
    const lockEnabled = lockout.maxAttempts > 0;

    // 1. Bereits gesperrt? → sofort ablehnen, ohne Passwort zu prüfen.
    if (lockEnabled) {
      const lockedUntil = await this._isLockedOut(key);
      if (lockedUntil) {
        const mins = Math.ceil((lockedUntil - Date.now()) / 60000);
        throw new UnauthorizedError(
          `Konto vorübergehend gesperrt — zu viele Fehlversuche. Erneut versuchen in ~${mins} Min.`,
        );
      }
    }

    // 2. Credentials prüfen (einheitliche Antwort für unbekannt/inaktiv/falsch).
    const user  = await this._findByEmail(email);
    const valid = user && user.isActive
      ? await this.verifyPassword(password, user.passwordHash)
      : false;

    if (!valid) {
      if (lockEnabled) await this._recordLoginFailure(key, lockout);
      throw new UnauthorizedError('Ungültige Credentials');
    }

    // 3. Erfolg → Fehlversuch-Zähler zurücksetzen (Passwort ist bewiesen).
    if (lockEnabled) await this._clearLoginFailures(key);

    // 4. Zweiter Faktor: hat der User aktive MFA, gibt es hier KEIN Session-Token,
    //    sondern eine kurzlebige Challenge. Das Session-Token kommt erst nach
    //    erfolgreicher /auth/mfa-Verifizierung (completeMfaLogin).
    if (await this._mfaActive(user.id)) {
      return { mfaRequired: true, challengeToken: this._signMfaChallenge(user) };
    }

    // 5. Org-weite MFA-Pflicht: hat der User (hier garantiert) KEINE aktive MFA,
    //    aber die Org erzwingt sie, gibt es KEINE Session — nur einen Setup-Token,
    //    der ausschließlich das Enrollment autorisiert. Greift nur bei aktivem Gate.
    if (config.mfa.enabled && (await loadMfaRequired())) {
      return { mfaSetupRequired: true, setupToken: this._signMfaSetup(user) };
    }

    return this._issueSession(user);
  }

  /**
   * Stellt das eigentliche Session-Token aus (lastLogin, Session-Registrierung,
   * Concurrent-Limit, Passwort-Ablauf-Flag). Gemeinsamer Pfad für Login ohne MFA
   * und für completeMfaLogin nach erfolgreichem 2. Faktor.
   */
  async _issueSession(user) {
    // Letzten Login persistieren (über das Repository, nicht in der Route)
    user.lastLoginAt = new Date().toISOString();
    await this._users.save(user);

    // sessionMaxHours aus Settings laden — Fallback auf JWT_EXPIRES wenn kein Wert.
    const sessionHours = await loadSessionMaxHours();
    const expiresIn    = sessionHours !== null ? `${sessionHours}h` : JWT_EXPIRES;
    const { token, jti } = this.signToken(user, expiresIn);

    // Session registrieren + Concurrent-Limit durchsetzen (älteste revozieren).
    const expSec = jwt.decode(token)?.exp ?? Math.floor(Date.now() / 1000) + 28800;
    await this._recordSession(jti, user.id, expSec * 1000);
    const maxSessions = await loadMaxConcurrentSessions();
    if (maxSessions > 0) await this._enforceSessionLimit(user.id, maxSessions);

    // Passwort-Ablauf-Flag mitgeben → Frontend erzwingt ggf. einen Wechsel.
    const { expiryDays } = await loadPasswordAgingPolicy();
    const pub = user.toPublicJSON();
    pub.passwordExpired = isPasswordExpired(user.passwordChangedAt, expiryDays);

    return { token, jti, user: pub };
  }

  /**
   * Schließt den Login nach dem 2. Faktor ab. Verifiziert die Challenge + den
   * TOTP-/Recovery-Code und stellt erst dann das Session-Token aus.
   *
   * Sicherheit (Account/User-Enumeration, OWASP A07): ALLE Fehlerpfade werfen
   * exakt denselben Fehler (gleicher Status 401, gleiche Meldung). Ein Angreifer
   * darf nicht unterscheiden können, ob die Challenge ungültig/abgelaufen war,
   * der `purpose` falsch ist, der User fehlt/inaktiv ist oder nur der Code falsch
   * war. Der konkrete Grund wird ausschließlich serverseitig geloggt — niemals
   * in die HTTP-Antwort oder client-sichtbare Audit-Metadaten.
   */
  async completeMfaLogin({ challengeToken, code }) {
    if (!config.mfa.enabled) return this._failMfa('mfa_gate_disabled');

    let payload;
    try {
      payload = jwt.verify(challengeToken, JWT_SECRET);
    } catch {
      return this._failMfa('challenge_invalid_or_expired');
    }
    if (payload.purpose !== 'mfa_challenge') {
      return this._failMfa('challenge_wrong_purpose');
    }

    const user = await this._findById(payload.sub);
    if (!user || !user.isActive) return this._failMfa('user_missing_or_inactive');

    const { mfaService } = require('./MfaService');
    const ok = await mfaService.verify(user.id, code);
    if (!ok) return this._failMfa('code_invalid');

    return this._issueSession(user);
  }

  /**
   * Einheitlicher MFA-Fehlschlag: gleicher Status + gleiche Meldung für jeden
   * Grund (verhindert die Unterscheidung „abgelaufen" vs. „falscher Code").
   * `reason` dient NUR dem serverseitigen Logging — er verlässt den Server nicht.
   */
  _failMfa(reason) {
    // Serverseitiges Logging (intern, nicht client-sichtbar). Kein Code/Secret.
    logger.warn('mfa_login_failed', { reason });
    throw new UnauthorizedError(MFA_FAILED_MESSAGE);
  }

  /** True, wenn MFA per Gate aktiv ist UND der User eine aktive Anmeldung hat. */
  async _mfaActive(userId) {
    if (!config.mfa.enabled) return false;
    const { mfaService } = require('./MfaService');
    const status = await mfaService.getStatus(userId);
    return status.status === 'active';
  }

  /**
   * P_CORR_ADMIN_2 Stufe 2 — frische Re-Authentifizierung für den Apply-Kanal.
   * Prüft das Passwort des eingeloggten Users erneut und gibt einen kurzlebigen,
   * zweckgebundenen apply_reauth-Token zurück (KEIN Session-Token).
   */
  async issueApplyReauth({ email, password } = {}) {
    const user = await this._findByEmail(email);
    const valid = user && user.isActive ? await this.verifyPassword(password, user.passwordHash) : false;
    if (!valid) throw new UnauthorizedError('Re-Authentifizierung fehlgeschlagen');
    const expiresIn = (config.apply && config.apply.reauthWindowSeconds) || 300;
    const token = jwt.sign({ sub: user.id, purpose: 'apply_reauth' }, JWT_SECRET, { expiresIn });
    return { token, expiresIn };
  }

  /** Verifiziert einen apply_reauth-Token (Zweck + Frische + Bindung an den Actor). */
  verifyApplyReauth(token, expectedSub) {
    if (!token) return { ok: false };
    let payload;
    try { payload = jwt.verify(token, JWT_SECRET); } catch { return { ok: false }; }
    if (payload.purpose !== 'apply_reauth') return { ok: false };
    if (expectedSub && payload.sub !== expectedSub) return { ok: false };
    return { ok: true, sub: payload.sub };
  }

  /**
   * Deployment Center — frische Re-Authentifizierung für den Deploy-Kanal
   * (Infra-Write). Prüft das Passwort erneut und gibt einen kurzlebigen,
   * zweckgebundenen deploy_reauth-Token zurück (KEIN Session-Token).
   */
  async issueDeployReauth({ email, password } = {}) {
    const user = await this._findByEmail(email);
    const valid = user && user.isActive ? await this.verifyPassword(password, user.passwordHash) : false;
    if (!valid) throw new UnauthorizedError('Re-Authentifizierung fehlgeschlagen');
    const expiresIn = (config.deploy && config.deploy.reauthWindowSeconds) || (config.apply && config.apply.reauthWindowSeconds) || 300;
    // jti → One-Shot: der Token wird beim ersten verify verbraucht (Replay-Schutz).
    const token = jwt.sign({ sub: user.id, purpose: 'deploy_reauth', jti: randomUUID() }, JWT_SECRET, { expiresIn });
    return { token, expiresIn };
  }

  /**
   * Verifiziert einen deploy_reauth-Token (Zweck + Frische + Bindung an den Actor)
   * und invalidiert ihn One-Shot (jti in die Blocklist). Ein zweiter Versuch mit
   * demselben Token schlägt fehl — ein abgefangener Token ist nicht wiederverwendbar.
   */
  async verifyDeployReauth(token, expectedSub) {
    if (!token) return { ok: false };
    let payload;
    try { payload = jwt.verify(token, JWT_SECRET); } catch { return { ok: false }; }
    if (payload.purpose !== 'deploy_reauth') return { ok: false };
    if (expectedSub && payload.sub !== expectedSub) return { ok: false };
    if (payload.jti) {
      const used = this._queryFn
        ? await _dbIsRevoked(this._queryFn, payload.jti)
        : this._blocklist.has(payload.jti);
      if (used) return { ok: false }; // bereits verbraucht (Replay)
      // konsumieren — ab jetzt ungültig.
      if (this._queryFn) await _dbRevoke(this._queryFn, payload.jti, payload.exp);
      else this._blocklist.add(payload.jti);
    }
    return { ok: true, sub: payload.sub };
  }

  /** Signiert eine kurzlebige MFA-Challenge (kein Session-Token). */
  _signMfaChallenge(user) {
    // jti = eindeutiger Nonce: jede Challenge ist byte-verschieden (auch zwei im
    // selben Sekundentakt). Das macht das per-Challenge-Rate-Limit (mfaRateLimit)
    // wirklich pro Challenge — sonst teilten sich gleichzeitige Challenges einen
    // Zähler. completeMfaLogin prüft nur purpose+sub; jti bleibt sonst ungenutzt.
    return jwt.sign({ sub: user.id, purpose: 'mfa_challenge', jti: randomUUID() }, JWT_SECRET, {
      expiresIn: MFA_CHALLENGE_EXPIRES,
    });
  }

  /** Signiert einen kurzlebigen MFA-Setup-Token (kein Session-Token, nur Enrollment). */
  _signMfaSetup(user) {
    return jwt.sign({ sub: user.id, purpose: 'mfa_setup' }, JWT_SECRET, {
      expiresIn: MFA_SETUP_EXPIRES,
    });
  }

  /**
   * Verifiziert einen Setup-Token und liefert den User. Wirft den einheitlichen
   * MFA-Fehler (nicht-diskriminierend) bei ungültigem/abgelaufenem/zweckfremdem Token
   * oder fehlendem/inaktivem User. Wird nie für geschützte Routen genutzt.
   */
  async _verifyMfaSetupToken(setupToken) {
    let payload;
    try {
      payload = jwt.verify(setupToken, JWT_SECRET);
    } catch {
      this._failMfa('setup_token_invalid_or_expired');
    }
    if (payload.purpose !== 'mfa_setup') this._failMfa('setup_token_wrong_purpose');
    const user = await this._findById(payload.sub);
    if (!user || !user.isActive) this._failMfa('setup_user_missing_or_inactive');
    return user;
  }

  /**
   * Startet das erzwungene MFA-Enrollment mit einem Setup-Token (org-weite Pflicht).
   * Response wie /mfa/enroll: { secret (EINMALIG), otpauthUri, enrollment }.
   */
  async beginMfaSetup({ setupToken }) {
    if (!config.mfa.enabled) this._failMfa('mfa_gate_disabled');
    const user = await this._verifyMfaSetupToken(setupToken);
    const { mfaService } = require('./MfaService');
    let result;
    try {
      result = await mfaService.beginEnrollment(user.id, { issuer: 'Nexora SOC', label: user.email });
    } catch (err) {
      throw new ValidationError(err.message); // z.B. bereits aktiv
    }
    return { secret: result.secret, otpauthUri: result.otpauthUri, enrollment: result.enrollment, userId: user.id, email: user.email };
  }

  /**
   * Schließt das erzwungene Enrollment ab: aktiviert MFA mit dem ersten TOTP-Code
   * und stellt dann die volle Session aus (User ist danach angemeldet).
   * Response: { token, jti, user, recoveryCodes (EINMALIG) }.
   */
  async completeMfaSetup({ setupToken, code }) {
    if (!config.mfa.enabled) this._failMfa('mfa_gate_disabled');
    const user = await this._verifyMfaSetupToken(setupToken);
    const { mfaService } = require('./MfaService');
    let result;
    try {
      result = await mfaService.activate(user.id, code);
    } catch (err) {
      // Falscher Code / kein Enrollment → 400 (kein Enumeration-Risiko: per Setup-Token
      // ist der User bereits passwort-authentifiziert).
      throw new ValidationError(err.message);
    }
    const session = await this._issueSession(user);
    return { ...session, recoveryCodes: result.recoveryCodes, email: user.email };
  }

  // Logout — Token in Blocklist (persistent wenn DB aktiv)
  // exp = Unix-Timestamp (Sekunden) aus dem Token-Payload; für DB-TTL benötigt.
  async logout(jti, exp) {
    if (this._queryFn) {
      await _dbRevoke(this._queryFn, jti, exp ?? Math.floor(Date.now() / 1000) + 28800);
    } else {
      this._blocklist.add(jti);
    }
    // Session-Eintrag entfernen (zählt nicht mehr gegen das Limit).
    await this._removeSession(jti);
  }

  // Aktuellen User aus Token laden
  async getUserFromToken(token) {
    const payload = await this.verifyToken(token);
    return this.getUserById(payload.sub);
  }

  // Leichte Flag-Abfrage für die Middleware (Erst-Login-Zwang serverseitig):
  // nur die für die Zugriffsentscheidung nötigen Felder, kein Policy-Load.
  async getUserFlags(id) {
    const user = await this._findById(id);
    if (!user) return null;
    return { isActive: user.isActive, mustChangePassword: user.mustChangePassword === true };
  }

  // User per (bereits verifizierter) ID laden — für Routen hinter requireAuth,
  // damit das Token nicht ein zweites Mal geparst/verifiziert werden muss.
  async getUserById(id) {
    const user = await this._findById(id);
    if (!user || !user.isActive) throw new UnauthorizedError('Benutzer nicht gefunden');
    // Passwort-Ablauf-Flag auch bei /me liefern, damit das Gate nach Reload greift.
    const { expiryDays } = await loadPasswordAgingPolicy();
    const pub = user.toPublicJSON();
    pub.passwordExpired = isPasswordExpired(user.passwordChangedAt, expiryDays);
    return pub;
  }

  /**
   * Eigenes Passwort ändern — prüft das aktuelle Passwort, validiert das neue,
   * speichert den neuen Hash. Loggt NIEMALS Passwörter.
   */
  async changePassword({ userId, currentPassword, newPassword }) {
    if (!currentPassword || !newPassword) {
      throw new ValidationError('currentPassword und newPassword sind Pflichtfelder');
    }

    // Policy für neues Passwort serverseitig durchsetzen — gilt NUR für neue Passwörter.
    const policy = await loadPasswordPolicy();
    const { ok, errors } = validatePassword(newPassword, policy);
    if (!ok) throw new ValidationError(errors.join('; '));
    const user = await this._findById(userId);
    if (!user || !user.isActive) throw new UnauthorizedError('Benutzer nicht gefunden');

    const valid = await this.verifyPassword(currentPassword, user.passwordHash);
    if (!valid) throw new UnauthorizedError('Aktuelles Passwort ist falsch');
    if (currentPassword === newPassword) {
      throw new ValidationError('Neues Passwort muss sich vom aktuellen unterscheiden');
    }

    // Passwort-History-Sperre: neues Passwort darf keines der letzten N sein.
    const { historyCount } = await loadPasswordAgingPolicy();
    if (historyCount > 0) {
      const recentHashes = [user.passwordHash, ...(user.passwordHistory || [])].slice(0, historyCount + 1);
      for (const hash of recentHashes) {
        if (hash && await this.verifyPassword(newPassword, hash)) {
          throw new ValidationError(`Neues Passwort darf keines der letzten ${historyCount} Passwörter sein`);
        }
      }
    }

    // Bisherigen Hash in die History aufnehmen, dann ersetzen + Änderungszeitpunkt setzen.
    user.passwordHistory   = pushPasswordHistory(user.passwordHistory, user.passwordHash, historyCount);
    user.passwordHash      = await this.hashPassword(newPassword);
    user.passwordChangedAt = new Date().toISOString();
    // Erst-Login-Zwang erfüllt — Flag löschen (sonst bliebe das Gate stehen).
    user.mustChangePassword = false;
    await this._users.save(user);
    return { ok: true };
  }

  // ── private Hilfsmethoden ──────────────────────────────

  /**
   * Gibt den Sperr-Zeitpunkt (ms) zurück, falls das Konto aktuell gesperrt ist,
   * sonst null. DB-Pfad wenn queryFn vorhanden, sonst In-Memory.
   */
  async _isLockedOut(key) {
    if (this._queryFn) {
      return _dbGetLockedUntil(this._queryFn, key);
    }
    const entry = this._loginAttempts.get(key);
    return entry && entry.lockedUntil && entry.lockedUntil > Date.now()
      ? entry.lockedUntil
      : null;
  }

  /**
   * Zählt einen fehlgeschlagenen Login und sperrt bei Erreichen von maxAttempts.
   * Nach dem Sperren wird der Zähler zurückgesetzt — nach Ablauf der Sperre
   * sind wieder maxAttempts Versuche nötig, bevor erneut gesperrt wird.
   */
  async _recordLoginFailure(key, lockout) {
    if (this._queryFn) {
      return _dbRecordFailure(this._queryFn, key, lockout);
    }
    const now   = Date.now();
    const entry = this._loginAttempts.get(key) || { fails: 0, lockedUntil: null };
    entry.fails += 1;
    if (entry.fails >= lockout.maxAttempts) {
      entry.lockedUntil = now + lockout.minutes * 60 * 1000;
      entry.fails = 0;
    }
    this._loginAttempts.set(key, entry);
  }

  /** Setzt den Fehlversuch-/Sperr-Zustand für ein Konto zurück (nach erfolgreichem Login). */
  async _clearLoginFailures(key) {
    if (this._queryFn) {
      return _dbClearLockout(this._queryFn, key);
    }
    this._loginAttempts.delete(key);
  }

  /** Registriert eine aktive Session (jti) für das Concurrent-Limit. */
  async _recordSession(jti, userId, expiresAtMs) {
    if (this._queryFn) {
      return _dbRecordSession(this._queryFn, jti, userId, expiresAtMs);
    }
    this._sessions.set(jti, { userId, expiresAt: expiresAtMs });
  }

  /** Revoziert die ältesten Sessions eines Users oberhalb des Limits. */
  async _enforceSessionLimit(userId, max) {
    if (this._queryFn) {
      return _dbEnforceSessionLimit(
        this._queryFn, userId, max,
        (jti, expSec) => _dbRevoke(this._queryFn, jti, expSec),
      );
    }
    const now = Date.now();
    // Abgelaufene Sessions aufräumen.
    for (const [jti, v] of this._sessions) {
      if (v.expiresAt < now) this._sessions.delete(jti);
    }
    // Aktive Sessions dieses Users in Insertion-Order (ältester zuerst).
    const own = [...this._sessions.entries()].filter(([, v]) => v.userId === userId);
    if (own.length <= max) return;
    for (const [jti] of own.slice(0, own.length - max)) {
      this._blocklist.add(jti);     // Token sofort ungültig
      this._sessions.delete(jti);
    }
  }

  /** Entfernt eine Session (Logout / Revoke). */
  async _removeSession(jti) {
    if (this._queryFn) {
      return _dbRemoveSession(this._queryFn, jti);
    }
    this._sessions.delete(jti);
  }

  async _findByEmail(email) {
    return this._users.findByEmail(email);
  }

  async _findById(id) {
    return this._users.findById(id);
  }
}

// Default-Singleton: UserRepository via Factory (Postgres bei DB_ENABLED, sonst InMemory).
// queryFn aus dem Pool einbinden — so bleibt AuthService selbst frei von direkten
// Pool-Imports und ist in Tests mit einem Stub testbar.
const { createUserRepository } = require('../repositories/userRepositoryFactory');
const _poolQuery = DB_ENABLED ? require('../db/pool').query : null;
const authService = new AuthService(createUserRepository(), _poolQuery);
module.exports = { AuthService, authService, JWT_SECRET, resolveJwtSecret, resolveBcryptRounds };
