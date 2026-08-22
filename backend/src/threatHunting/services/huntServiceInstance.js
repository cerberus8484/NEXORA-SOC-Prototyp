'use strict';

const { HuntService }              = require('./HuntService');
const { createHuntRepository }     = require('../repositories/huntRepositoryFactory');
const { ticketService }            = require('../../services/TicketService');
const { evidenceService }          = require('../../services/EvidenceService');
const { authService }              = require('../../services/AuthService');
const { createProvisioningRepository } = require('../../repositories/provisioningRepositoryFactory');
const { buildContainmentRunner }   = require('../adapters/containmentRunner');

/**
 * Singleton-Instanz des HuntService für den Express-Betrieb.
 * Repository-Impl wählt die Factory anhand config.db.enabled:
 *   Produktion (DB_ENABLED=true) → Postgres · Tests/Dev → InMemory.
 * ticketService wird injiziert, damit Ticket-Links (P13.4) die Ticket-Existenz prüfen.
 *
 * Für Tests: HuntService direkt mit eigenem Repository instanziieren — niemals dieses Modul.
 */
// authService injiziert für die frische Reauth beim ECHTEN Response-Exec (ADR-042).
// responseRunnerFactory = echter Containment-Runner (Slice 3a): löst targetHost →
// enrollter managed Node → gepinnten host_key_pin auf und fährt die nftables-Isolation
// über den gehärteten sshExecRunner. Bleibt mehrschichtig INERT: Kill-Switch
// (HUNT_RESPONSE_REAL_EXEC_ENABLED) im Service davor; die Factory fail-closed ohne
// Deploy-Keypair (E_NO_CHANNEL) und ohne Mgmt-Preservation-CIDR (E_NO_MGMT_PRESERVE).
const responseRunnerFactory = buildContainmentRunner({ provisioningRepo: createProvisioningRepository() });
const huntService = new HuntService(createHuntRepository(), { ticketService, evidenceService, authService, responseRunnerFactory });

module.exports = { huntService };
