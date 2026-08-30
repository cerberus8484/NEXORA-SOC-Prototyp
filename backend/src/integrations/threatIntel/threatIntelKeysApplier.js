'use strict';

// Layer 2: die effektiven TI-Keys (DB > ENV) auf die laufenden Provider-Instanzen
// anwenden — beim Boot (nach DB-Start) und nach jedem PUT /settings/ti. Kein Neustart.

const { createSettingsRepository } = require('../../repositories/settingsRepositoryFactory');
const { resolveTiKey } = require('../../services/threatIntelKeys');
const { abuseIpDbProvider, virusTotalProvider } = require('./threatIntelInstance');
const logger = require('../../logger');

async function applyThreatIntelKeys(repo = null) {
  const settingsRepo = repo || createSettingsRepository();
  const vt    = await resolveTiKey('virustotal', settingsRepo);
  const abuse = await resolveTiKey('abuseipdb', settingsRepo);
  virusTotalProvider.reconfigure({ key: vt.key });
  abuseIpDbProvider.reconfigure({ key: abuse.key });
  // Nur Quellen loggen — NIE Key-Werte.
  logger.info('threat_intel_keys_applied', { virustotalSource: vt.source, abuseipdbSource: abuse.source });
  return { virustotal: vt.source, abuseipdb: abuse.source };
}

module.exports = { applyThreatIntelKeys };
