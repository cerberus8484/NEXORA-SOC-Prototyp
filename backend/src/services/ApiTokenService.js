'use strict';

const { createHash }             = require('crypto');
const { ApiToken, TOKEN_PREFIX } = require('../domain/ApiToken');
const { NotFoundError }          = require('../errors/AppError');
const logger                     = require('../logger');

/**
 * ApiTokenService — Personal Access Tokens (PAT).
 *
 * Sicherheits-Invarianten:
 *   - Plain-Token-Wert NIEMALS in DB/Log/Response — nur SHA-256-Hash
 *   - create() gibt Plain-Token EINMALIG zurück — danach unrekonstruierbar
 *   - authenticate() gibt niemals das Domain-Objekt zurück — nur { userId, tokenId }
 *
 * Dependency Injection:
 *   - Tests übergeben tokenRepo direkt (kein dotenv-Problem)
 *   - Produktionsbetrieb: Lazy-Init via Factory (config/dotenv werden erst dann geladen)
 */
class ApiTokenService {
  constructor({ tokenRepo } = {}) {
    // Wenn tokenRepo übergeben (Tests) → direkt nutzen.
    // Sonst: Lazy-Init beim ersten Zugriff via Factory (vermeidet dotenv beim Import).
    this._repo = tokenRepo || null;
  }

  _getRepo() {
    if (!this._repo) {
      const { createApiTokenRepository } = require('../repositories/apiTokenRepositoryFactory');
      this._repo = createApiTokenRepository();
    }
    return this._repo;
  }

  /**
   * Erstellt einen neuen PAT.
   * @returns {{ token: string, apiToken: object }} — token ist EINMALIG, apiToken ohne hash
   */
  async create({ userId, name, expiresAt = null } = {}) {
    if (!userId) throw new Error('userId ist erforderlich');
    if (!name)   throw new Error('name ist erforderlich');

    const repo = this._getRepo();
    const { token, domain } = await ApiToken.create({ userId, name, expiresAt });
    await repo.save(domain);

    // apiToken-Response-Objekt: toJSON() filtert tokenHash heraus
    return { token, apiToken: domain.toJSON() };
  }

  /**
   * Gibt alle Tokens eines Users zurück (ohne tokenHash).
   */
  async listByUser(userId) {
    const repo   = this._getRepo();
    const tokens = await repo.listByUser(userId);
    return tokens.map(t => t.toJSON());
  }

  /**
   * Widerruft ein eigenes Token.
   * Wirft NotFoundError wenn Token nicht existiert oder einem anderen User gehört.
   */
  async revoke({ tokenId, userId } = {}) {
    const repo  = this._getRepo();
    const token = await repo.findById(tokenId);

    if (!token || token.userId !== userId) {
      throw new NotFoundError('Token nicht gefunden');
    }

    await repo.revoke(tokenId);
  }

  /**
   * Authentifiziert einen Raw-Token-String.
   * @returns {{ userId: string, tokenId: string } | null}
   *
   * Gibt null zurück wenn:
   *   - rawToken ist null/leer/kein String
   *   - Token beginnt nicht mit soc_
   *   - Token nicht gefunden
   *   - Token revoked oder abgelaufen
   */
  async authenticate(rawToken) {
    if (!rawToken || typeof rawToken !== 'string') return null;
    if (!rawToken.startsWith(TOKEN_PREFIX)) return null;

    const repo  = this._getRepo();
    const hash  = createHash('sha256').update(rawToken).digest('hex');
    const token = await repo.findByHash(hash);

    if (!token)          return null;
    if (!token.isActive) return null;

    // lastUsedAt im Hintergrund aktualisieren (best-effort, kein await).
    // Fehler darf die Authentifizierung nicht blockieren, wird aber sichtbar geloggt.
    repo.updateLastUsed(token.id)
      .catch((err) => logger.warn('api_token_last_used_update_failed', { message: err.message }));

    return { userId: token.userId, tokenId: token.id };
  }
}

// Singleton für Produktionsbetrieb (Lazy-Init)
const apiTokenService = new ApiTokenService();

module.exports = { ApiTokenService, apiTokenService };
