'use strict';

/**
 * oidcService.js — OIDC-Login-Orchestrierung (Authorization Code + PKCE), Slice 2.
 *
 * Reine Ablauflogik OHNE direkten Netz-/Krypto-Code: Discovery-Fetch, Token-Tausch
 * und Signaturprüfung (JWKS/jose) werden als Funktionen INJIZIERT. Dadurch ist der
 * komplette Flow netzfrei testbar; die echten Implementierungen (HTTP + jose) leben
 * im Boot-Wiring (`oidcInstance.js`).
 *
 * SICHERHEIT (Account-Takeover-Härtung, OWASP A07):
 *   - `state` (CSRF) wird gegen den signierten Flow-Cookie geprüft, bevor irgendetwas passiert.
 *   - ID-Token: erst SIGNATUR (injizierter Verifier/JWKS), dann CLAIMS (oidcClient, inkl. nonce).
 *   - Account-Linking auf bestehende User NUR bei `email_verified === true` — sonst könnte
 *     ein Angreifer mit fremder, unverifizierter E-Mail einen lokalen Account übernehmen.
 *   - Auto-Signup nur bei explizitem `allowSignup` UND verifizierter E-Mail; Default-Rolle
 *     `viewer` (PoLA). Neue SSO-User haben keinen Passwort-Hash → kein Passwort-Login.
 *   - Inaktive User werden abgewiesen.
 *   - Der Grund eines Fehlschlags (`reason`) wird NUR serverseitig geloggt, nie an den Client.
 */

const { User } = require('../../domain/User');
const defaultClient = require('./oidcClient');

/**
 * Fehler im OIDC-Flow. `reason` ist ein interner Code (nur Server-Log), die
 * HTTP-Schicht liefert daraus eine einheitliche, nicht-diskriminierende Antwort.
 */
class OidcError extends Error {
  constructor(reason) {
    super(`oidc_flow_failed:${reason}`);
    this.name = 'OidcError';
    this.reason = reason;
  }
}

/**
 * `email_verified` ist laut Spec ein Boolean — manche IdPs senden den String 'true'.
 * Streng auf den WERT true, tolerant beim Typ.
 */
function isEmailVerified(claims) {
  return claims.email_verified === true || claims.email_verified === 'true';
}

class OidcService {
  /**
   * @param {object}    deps
   * @param {object}   [deps.config] — statische Config (Tests/Legacy): { issuer, clientId, redirectUri, scope, defaultRole, allowSignup, clientSecret? }
   * @param {Function} [deps.getConfig] — async () => effektive Config (DB-basiert, In-UI-Admin). Hat Vorrang vor config.
   * @param {Function}  deps.discover — async (issuer) => { issuer, authorizationEndpoint, tokenEndpoint, jwksUri }
   * @param {Function}  deps.exchangeCode — async ({ tokenEndpoint, code, codeVerifier, redirectUri, clientId, clientSecret }) => Token-Response
   * @param {Function}  deps.verifyIdToken — async (idToken, { issuer, audience, jwksUri }) => signaturgeprüfte Claims
   * @param {object}    deps.userRepository — findByOidcIdentity/findByEmail/save
   * @param {object}    deps.authService — _issueSession(user)
   * @param {object}   [deps.client] — oidcClient-Modul (Default: das echte)
   */
  constructor({ config, getConfig, discover, exchangeCode, verifyIdToken, userRepository, authService, client = defaultClient }) {
    this._config = config;
    this._getConfig = getConfig || null;
    this._discover = discover;
    this._exchangeCode = exchangeCode;
    this._verifyIdToken = verifyIdToken;
    this._users = userRepository;
    this._auth = authService;
    this._client = client;
  }

  /** Aktuelle Config auflösen: dynamischer Provider (DB) hat Vorrang vor statischer Config. */
  async _resolveConfig() {
    return this._getConfig ? await this._getConfig() : this._config;
  }

  /**
   * Startet den Login: PKCE/state/nonce erzeugen + Authorization-URL bauen.
   * Gibt die URL und den FLOW-Zustand zurück (state/nonce/codeVerifier) — die
   * Route signiert den Flow-Zustand in einen kurzlebigen Cookie (kein Server-State).
   *
   * @returns {Promise<{ authorizationUrl: string, flow: { state: string, nonce: string, codeVerifier: string } }>}
   */
  async beginLogin() {
    const cfg = await this._resolveConfig();
    const disco = await this._discover(cfg.issuer);
    const { verifier, challenge } = this._client.generatePkcePair();
    const state = this._client.generateState();
    const nonce = this._client.generateNonce();

    const authorizationUrl = this._client.buildAuthorizationUrl({
      authorizationEndpoint: disco.authorizationEndpoint,
      clientId:     cfg.clientId,
      redirectUri:  cfg.redirectUri,
      scope:        cfg.scope,
      state,
      nonce,
      codeChallenge: challenge,
    });

    return { authorizationUrl, flow: { state, nonce, codeVerifier: verifier } };
  }

  /**
   * Schließt den Login ab: state prüfen → Token tauschen → Signatur + Claims prüfen
   * → User auflösen/verknüpfen → Session ausstellen (identisch zum Passwort-Login).
   *
   * @param {{ code: string, returnedState: string, flow: { state: string, nonce: string, codeVerifier: string } }} params
   * @returns {Promise<{ session: object, userId: string, email: string, linkMode: string }>}
   * @throws {OidcError}
   */
  async completeLogin({ code, returnedState, flow }) {
    if (!code)                                 throw new OidcError('missing_code');
    if (!flow || !flow.state || !flow.codeVerifier) throw new OidcError('missing_flow');
    if (returnedState !== flow.state)          throw new OidcError('state_mismatch');

    const cfg = await this._resolveConfig();
    const disco = await this._discover(cfg.issuer);

    const tokenResponse = await this._exchangeCode({
      tokenEndpoint: disco.tokenEndpoint,
      code,
      codeVerifier: flow.codeVerifier,
      redirectUri:  cfg.redirectUri,
      clientId:     cfg.clientId,
      clientSecret: cfg.clientSecret,
    });
    const idToken = tokenResponse && tokenResponse.id_token;
    if (!idToken) throw new OidcError('no_id_token');

    // 1. SIGNATUR zuerst (das, was Slice 1 bewusst offengelassen hat).
    let claims;
    try {
      claims = await this._verifyIdToken(idToken, {
        issuer:   disco.issuer,
        audience: cfg.clientId,
        jwksUri:  disco.jwksUri,
      });
    } catch {
      throw new OidcError('signature_invalid');
    }

    // 2. CLAIMS danach (iss/aud/exp/iat/nonce/sub) — nonce bindet an genau diese Anfrage.
    const check = this._client.validateIdTokenClaims(claims, {
      issuer:   disco.issuer,
      clientId: cfg.clientId,
      nonce:    flow.nonce,
    });
    if (!check.ok) throw new OidcError(`claims_${check.reason}`);

    const { user, linkMode } = await this._resolveUser(claims, disco.issuer, cfg);
    const session = await this._auth._issueSession(user);
    return { session, userId: user.id, email: user.email, linkMode };
  }

  /**
   * Löst den lokalen User zur externen Identität auf:
   *   1. bestehende Verknüpfung (provider, sub)
   *   2. Linking auf bestehenden Account per VERIFIZIERTER E-Mail
   *   3. Auto-Signup (nur wenn allowSignup + verifizierte E-Mail)
   * sonst: Ablehnung.
   *
   * @returns {Promise<{ user: User, linkMode: 'existing'|'linked'|'created' }>}
   */
  async _resolveUser(claims, provider, cfg) {
    const sub = claims.sub;

    // 1. Bereits verknüpft → direkt anmelden.
    const linked = await this._users.findByOidcIdentity(provider, sub);
    if (linked) {
      if (!linked.isActive) throw new OidcError('user_inactive');
      return { user: linked, linkMode: 'existing' };
    }

    const email = (claims.email || '').toLowerCase().trim();
    const verified = isEmailVerified(claims);

    // 2. Linking auf bestehenden Account — NUR bei verifizierter E-Mail.
    if (email && verified) {
      const byEmail = await this._users.findByEmail(email);
      if (byEmail) {
        if (!byEmail.isActive) throw new OidcError('user_inactive');
        byEmail.oidcProvider = provider;
        byEmail.oidcSub      = sub;
        await this._users.save(byEmail);
        return { user: byEmail, linkMode: 'linked' };
      }
    }

    // 3. Auto-Signup (opt-in) — nur mit verifizierter E-Mail, Default-Rolle viewer.
    if (cfg.allowSignup) {
      if (!email || !verified) throw new OidcError('signup_requires_verified_email');
      const created = new User({
        email,
        displayName:       typeof claims.name === 'string' && claims.name ? claims.name : email,
        role:              cfg.defaultRole || 'viewer',
        passwordHash:      '',                 // kein Passwort → nur SSO-Login möglich
        passwordChangedAt: new Date().toISOString(),
        oidcProvider:      provider,
        oidcSub:           sub,
      });
      await this._users.save(created);
      return { user: created, linkMode: 'created' };
    }

    // 4. Kein lokaler Account und kein Signup erlaubt → Ablehnung.
    throw new OidcError(verified ? 'no_local_account' : 'email_unverified');
  }
}

module.exports = { OidcService, OidcError, isEmailVerified };
