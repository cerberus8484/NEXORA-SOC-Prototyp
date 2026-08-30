'use strict';

// Geteilte Service-Instanz. Provider werden IMMER registriert, rufen aber nur extern,
// wenn ihr Key gesetzt ist (isConfigured()). Sonst → 'not_configured', Mock bleibt Fallback.
// Keys kommen aus config (ENV, backend-only).
const config = require('../../config');
const { ThreatIntelService } = require('./ThreatIntelService');
const { MockThreatIntelProvider } = require('./MockThreatIntelProvider');
const { AbuseIpDbProvider } = require('./AbuseIpDbProvider');
const { VirusTotalProvider } = require('./VirusTotalProvider');
const { createThreatIntelCache } = require('./threatIntelCacheFactory');

// Instanzen einzeln halten → Layer-2-Applier kann ihre Keys zur Laufzeit
// rekonfigurieren (UI-verwaltete Keys, DB > ENV), ohne Prozess-Neustart.
const abuseIpDbProvider = new AbuseIpDbProvider({ key: config.threatIntel.abuseIpDbKey, maxAgeInDays: config.threatIntel.abuseMaxAgeDays });
const virusTotalProvider = new VirusTotalProvider({ key: config.threatIntel.virusTotalKey });

const threatIntelService = new ThreatIntelService({
  providers: [
    new MockThreatIntelProvider(),
    abuseIpDbProvider,
    virusTotalProvider,
  ],
  // DB_ENABLED → persistenter Postgres-Cache (überlebt Neustart), sonst InMemory.
  cache: createThreatIntelCache(),
});

module.exports = { threatIntelService, abuseIpDbProvider, virusTotalProvider };
