'use strict';

// ── Route /api/v1/tokens — Personal Access Tokens (PAT) ─────────────────────
//
// Hard-Gate: API_TOKENS_ENABLED=false → alle Endpunkte geben 503 zurück.
// Default ist false — dieser Code ist nach Deploy bewusst INERT.
//
// SICHERHEIT:
//   - Kein Token-Wert in GET-Response — nur einmaliger Rückgabe bei POST
//   - User-Scoping: req.user.sub isoliert jeden Zugriff
//   - Rate-Limiting via globalem Limiter in app.js

const { Router }          = require('express');
const { requireAuth }     = require('../middleware/authenticate');
const { apiTokenService } = require('../services/ApiTokenService');
const { ValidationError } = require('../errors/AppError');
const config              = require('../config');

const router = Router();

// ── Hard-Gate-Middleware (gilt für alle Routen dieses Routers) ────────────────
function tokensEnabledGuard(req, res, next) {
  if (!config.apiTokens.enabled) {
    return res.status(503).json({ error: 'API_TOKENS_DISABLED' });
  }
  next();
}

// ── GET /api/v1/tokens ────────────────────────────────────────────────────────
// Eigene Tokens auflisten (analyst+).
// Response: { data: ApiToken[] } — KEIN tokenHash, KEIN plain token
router.get('/', tokensEnabledGuard, requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.sub || req.user.id;
    const data   = await apiTokenService.listByUser(userId);
    res.json({ data, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v1/tokens ───────────────────────────────────────────────────────
// Neues Token erstellen.
// Response: { token (EINMALIG), apiToken } — token danach unrekonstruierbar
router.post('/', tokensEnabledGuard, requireAuth, async (req, res, next) => {
  try {
    const userId    = req.user.sub || req.user.id;
    const { name, expiresAt } = req.body || {};

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return next(new ValidationError('name ist erforderlich'));
    }

    const result = await apiTokenService.create({
      userId,
      name: name.trim(),
      expiresAt: expiresAt || null,
    });

    // 201 Created — token EINMALIG in Response, danach nie wieder
    res.status(201).json({
      token:    result.token,
      apiToken: result.apiToken,
      requestId: req.id,
    });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/v1/tokens/:id ─────────────────────────────────────────────────
// Eigenes Token widerrufen.
// 204 No Content bei Erfolg, 404 wenn nicht gefunden oder fremdes Token.
router.delete('/:id', tokensEnabledGuard, requireAuth, async (req, res, next) => {
  try {
    const userId  = req.user.sub || req.user.id;
    const tokenId = req.params.id;

    await apiTokenService.revoke({ tokenId, userId });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
