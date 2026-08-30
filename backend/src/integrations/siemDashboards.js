'use strict';

// SIEM-Dashboard-Registry — pro SIEM ein Provider mit gleicher DTO-Form.
// Künftige SIEMs (Splunk/QRadar …) hier registrieren; Route + Frontend bleiben gleich.

const { WazuhDashboardProvider } = require('./adapters/wazuh/WazuhDashboardProvider');
const { wazuhApiClient }         = require('./adapters/wazuh/wazuhApiInstance');
const { wazuhIndexerClient }     = require('./adapters/wazuh/wazuhIndexerInstance');
const { ticketService }          = require('../services/TicketService');

const providers = {
  wazuh: new WazuhDashboardProvider({
    indexer:   wazuhIndexerClient,
    apiClient: wazuhApiClient,
    countOpenIncidents: async () => {
      const r = await ticketService.findAll({ state: 'OPEN', limit: 1 });
      return r?.total ?? null;
    },
  }),
};

function getProvider(key) {
  const k = String(key || '').toLowerCase();
  // hasOwnProperty statt Objekt-Lookup: '__proto__'/'constructor' dürfen
  // nicht auf Prototype-Einträge treffen (sonst TypeError → 500 statt 404).
  return Object.prototype.hasOwnProperty.call(providers, k) ? providers[k] : null;
}

function listProviders() {
  return Object.values(providers).map((p) => ({ key: p.key, enabled: p.isEnabled() }));
}

module.exports = { getProvider, listProviders, providers };
