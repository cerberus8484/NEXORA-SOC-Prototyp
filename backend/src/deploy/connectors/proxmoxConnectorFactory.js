'use strict';

// Deployment Center — Connector-Factory.
// Wählt den deterministischen Fake (Tests/CI oder Gate AUS) oder den echten
// REST-Connector (nur bei scharfem DEPLOY_ENABLED). So läuft die gesamte
// Test-Suite ohne Netz, und Live-Deploys sind bewusst gegated.

const { InMemoryProxmoxConnector } = require('./InMemoryProxmoxConnector');
const { ProxmoxRestConnector } = require('./ProxmoxRestConnector');
const { RealHttpClient } = require('../../integrations/http/RealHttpClient');

function isDeployLive() {
  return process.env.DEPLOY_ENABLED === 'true' && process.env.NODE_ENV !== 'test';
}

function parseAllowedHosts() {
  return String(process.env.DEPLOY_HYPERVISOR_ALLOWED_HOSTS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * @param {object} connector HypervisorConnector-Domain (host, getApiToken, verifyTls …)
 * @param {object} [opts] { fake?: boolean, fakeState?: object, allowedHosts?: string[], httpClient?: object }
 */
function makeProxmoxConnector(connector, opts = {}) {
  if (opts.fake || !isDeployLive()) {
    return new InMemoryProxmoxConnector(opts.fakeState || {});
  }
  const httpClient = opts.httpClient || new RealHttpClient({ timeout: 30_000, rejectUnauthorized: connector.verifyTls !== false });
  const allowedHosts = opts.allowedHosts || parseAllowedHosts();
  return new ProxmoxRestConnector({ connector, httpClient, allowedHosts });
}

module.exports = { makeProxmoxConnector, isDeployLive, parseAllowedHosts };
