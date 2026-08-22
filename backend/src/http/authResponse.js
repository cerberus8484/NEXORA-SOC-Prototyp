'use strict';

function shouldReturnTokenInJson(env = process.env) {
  if (env.AUTH_RETURN_TOKEN_JSON !== undefined) {
    return env.AUTH_RETURN_TOKEN_JSON === 'true';
  }
  return (env.NODE_ENV || 'development') !== 'production';
}

function buildAuthSessionResponse({ token, user, requestId, recoveryCodes }, env = process.env) {
  const payload = { user, requestId };

  if (Array.isArray(recoveryCodes)) {
    payload.recoveryCodes = recoveryCodes;
  }

  if (shouldReturnTokenInJson(env)) {
    payload.token = token;
  }

  return payload;
}

module.exports = { buildAuthSessionResponse, shouldReturnTokenInJson };
