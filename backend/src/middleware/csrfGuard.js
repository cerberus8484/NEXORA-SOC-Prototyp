'use strict';

// CSRF-Guard (Double-Submit-Cookie) für Cookie-basierte Auth.
//
// Hintergrund: Seit der Cookie-only-Umstellung authentifiziert der Browser über
// das httpOnly soc_token-Cookie. Cookies werden vom Browser automatisch
// mitgesendet → CSRF-Angriffsfläche. sameSite=strict schützt bereits stark;
// dieser Guard ist die zweite Verteidigungslinie (Defense in Depth).
//
// Regel: zustandsändernde Requests (POST/PUT/PATCH/DELETE) müssen einen
// X-CSRF-Token-Header mitschicken, der dem (JS-lesbaren) csrf_token-Cookie
// entspricht. Ein Cross-Site-Angreifer kann das Cookie nicht lesen → kann den
// Header nicht setzen.
//
// Ausnahmen (kein Cookie-Auth → CSRF-immun):
//   - Safe-Methods (GET/HEAD/OPTIONS)
//   - Authorization: Bearer ...  (JWT/PAT-API-Clients senden das nie automatisch)
//   - /auth/login                (noch keine Session)
//   - /integrations/*            (HMAC-signierte Webhooks, kein Cookie)
//
// Mounten unter dem v1-Prefix (app.use(v1, csrfGuard)) → req.path ist relativ.

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader.split(';').map((p) => p.trim()).find((p) => p.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}

function csrfGuard(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const authz = req.headers.authorization;
  if (authz && authz.startsWith('Bearer ')) return next(); // Token-Auth = CSRF-immun

  const path = req.path || '';
  // HMAC-signierte, cookie-lose Webhook-Eingänge sind nicht CSRF-relevant (kein Browser-Cookie):
  // /integrations + /dataplane explizit ausnehmen (vermeidet, dass eine künftige Cookie-Auth auf
  // /dataplane den Guard unerwartet greifen lässt).
  if (path === '/auth/login' || path.startsWith('/integrations') || path.startsWith('/dataplane')) return next();

  // Nur echte Cookie-Sessions sind CSRF-relevant. Ohne soc_token-Cookie ist der
  // Request unauthentifiziert → an requireAuth weiterreichen (liefert 401, nicht 403).
  if (!parseCookie(req.headers.cookie, 'soc_token')) return next();

  const cookie = parseCookie(req.headers.cookie, 'csrf_token');
  const header = req.headers['x-csrf-token'];

  if (!cookie || !header || cookie !== header) {
    return res.status(403).json({
      error:     'CSRF',
      message:   'CSRF-Token fehlt oder ungültig.',
      requestId: req.id,
    });
  }
  return next();
}

module.exports = { csrfGuard };
