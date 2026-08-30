'use strict';

// Dünner HTTP-Layer über dem reinen Intake-Service. Mappt Service-Ergebnis → HTTP-Status:
//   accepted → 202 · duplicate → 200 (idempotent) · UNAUTHENTICATED → 401 · SCHEMA_INVALID → 400
// `resolveAuth(req)` ist injizierbar (Test/Stub/echte Credential-Auflösung).
const express = require('express');
const { ingestEvent } = require('./intakeService');

function createIntakeApp({ repo, resolveAuth, now, rateLimit } = {}) {
  if (!repo || typeof resolveAuth !== 'function') {
    throw new Error('createIntakeApp: repo + resolveAuth erforderlich');
  }
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'nexora-intake', timestamp: new Date().toISOString() });
  });

  // Optionales Rate-Limit (Burst-Schutz). Nur aktiv, wenn vom Boot (main.js) injiziert →
  // bestehende Tests ohne Limiter bleiben unberührt.
  const ingestMw = typeof rateLimit === 'function' ? [rateLimit] : [];

  app.post('/v1/intake/events', ...ingestMw, async (req, res, next) => {
    try {
      const auth = await resolveAuth(req); // null/undefined → unauthenticated
      const result = await ingestEvent(req.body, { auth, repo, now: typeof now === 'function' ? now() : undefined });
      if (result.status === 'accepted') return res.status(202).json(result);
      if (result.status === 'duplicate') return res.status(200).json(result);
      if (result.rejectionCode === 'UNAUTHENTICATED') return res.status(401).json(result);
      return res.status(400).json(result); // SCHEMA_INVALID
    } catch (err) {
      next(err);
    }
  });

  // JSON-Parse-Fehler etc. → 400 strukturiert, nie HTML-Stack.
  app.use((err, _req, res, _next) => {
    const isParse = err.type === 'entity.parse.failed' || err instanceof SyntaxError;
    res.status(isParse ? 400 : 500).json({
      status: isParse ? 'rejected' : 'error',
      rejectionCode: isParse ? 'MALFORMED_JSON' : undefined,
      error: err.message,
    });
  });

  return app;
}

module.exports = { createIntakeApp };
