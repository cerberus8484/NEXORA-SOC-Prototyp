'use strict';

const crypto = require('crypto');
const logger = require('../logger');

// Privacy by Design (Art. 25): IPs nicht roh speichern. HMAC-SHA256 mit
// geheimem Salt → pseudonymisiert, nicht trivial per Rainbow-Table umkehrbar
// (anders als ein blanker SHA-256 über den kleinen IPv4-Raum).
// Defense-in-Depth zusätzlich zu validateEnv: in Produktion KEIN stiller Fallback auf
// das öffentlich bekannte Dev-Salt (sonst de-pseudonymisierbare Audit-IPs, Art. 25).
const IP_SALT = process.env.AUDIT_IP_SALT
  || (process.env.NODE_ENV === 'production'
    ? (() => { throw new Error('AUDIT_IP_SALT muss in Produktion gesetzt sein (Privacy by Design, Art. 25 DSGVO)'); })()
    : 'dev-audit-ip-salt-change-in-production');
function hashIp(ip) {
  if (!ip) return '';
  return `h:${crypto.createHmac('sha256', IP_SALT).update(String(ip)).digest('hex').slice(0, 32)}`;
}

// Definierte Audit-Actions — verhindert freie Strings
const AUDIT_ACTIONS = {
  LOGIN:          'LOGIN',
  LOGOUT:         'LOGOUT',
  LOGIN_FAILED:   'LOGIN_FAILED',
  TICKET_CREATE:  'TICKET_CREATE',
  TICKET_UPDATE:  'TICKET_UPDATE',
  TICKET_DELETE:  'TICKET_DELETE',
  TICKET_BULK_DELETE: 'TICKET_BULK_DELETE',
  TICKET_VIEW:    'TICKET_VIEW',
  AGENT_SUGGESTION_APPROVE: 'AGENT_SUGGESTION_APPROVE',
  AGENT_SUGGESTION_REJECT:  'AGENT_SUGGESTION_REJECT',
  USER_ROLE_CHANGE:   'USER_ROLE_CHANGE',
  USER_ACTIVE_CHANGE: 'USER_ACTIVE_CHANGE',
  USER_CREATED:        'USER_CREATED',
  USER_PASSWORD_RESET: 'USER_PASSWORD_RESET',
  SETTINGS_CHANGED:    'SETTINGS_CHANGED',
  PROFILE_UPDATED:     'PROFILE_UPDATED',
  WAZUH_AGENT_ENROLLED: 'WAZUH_AGENT_ENROLLED',
  MANUAL_HOST_ADDED:    'MANUAL_HOST_ADDED',
  MANUAL_HOST_REMOVED:  'MANUAL_HOST_REMOVED',
  NIS2_ASSESSMENT_CREATED: 'NIS2_ASSESSMENT_CREATED',
  NIS2_ASSESSMENT_UPDATED: 'NIS2_ASSESSMENT_UPDATED',
  NIS2_STATUS_CHANGED:     'NIS2_STATUS_CHANGED',
  NIS2_EVIDENCE_LINKED:    'NIS2_EVIDENCE_LINKED',
  NIS2_EVIDENCE_REMOVED:   'NIS2_EVIDENCE_REMOVED',
  MFA_ENROLL_STARTED: 'MFA_ENROLL_STARTED',
  MFA_ENABLED:        'MFA_ENABLED',
  MFA_DISABLED:       'MFA_DISABLED',
  MFA_ADMIN_RESET:        'MFA_ADMIN_RESET',
  MFA_ADMIN_RESET_DENIED: 'MFA_ADMIN_RESET_DENIED',
  EXTERNAL_TICKET_EXPORT_SUCCESS: 'EXTERNAL_TICKET_EXPORT_SUCCESS',
  EXTERNAL_TICKET_EXPORT_FAILED:  'EXTERNAL_TICKET_EXPORT_FAILED',
  EXTERNAL_TICKET_STATUS_SYNC_SUCCESS: 'EXTERNAL_TICKET_STATUS_SYNC_SUCCESS',
  EXTERNAL_TICKET_STATUS_SYNC_FAILED:  'EXTERNAL_TICKET_STATUS_SYNC_FAILED',
  AUDIT_EXPORT: 'AUDIT_EXPORT',
  ML_EVAL_EXPORT: 'ML_EVAL_EXPORT',
  WAZUH_MANAGER_RESTART: 'WAZUH_MANAGER_RESTART',
  WAZUH_MANAGER_RESTART_ARMED:      'WAZUH_MANAGER_RESTART_ARMED',
  WAZUH_MANAGER_RESTART_ARM_DENIED: 'WAZUH_MANAGER_RESTART_ARM_DENIED',
  WAZUH_MANAGER_RESTART_DISARMED:   'WAZUH_MANAGER_RESTART_DISARMED',
  WAZUH_CONNECTION_CHANGED:         'WAZUH_CONNECTION_CHANGED',
  WAZUH_CONNECTION_CHANGE_DENIED:   'WAZUH_CONNECTION_CHANGE_DENIED',
  WAZUH_CONNECTION_TEST:            'WAZUH_CONNECTION_TEST',
  SYSTEM_RESTART_REQUESTED:         'SYSTEM_RESTART_REQUESTED',
  SYSTEM_RESTART_FAILED:            'SYSTEM_RESTART_FAILED',
  SYSTEM_UPDATE_REQUESTED:          'SYSTEM_UPDATE_REQUESTED',
  SYSTEM_UPDATE_FAILED:             'SYSTEM_UPDATE_FAILED',
  TI_KEYS_CHANGED:                  'TI_KEYS_CHANGED',
  NOTIFY_SETTINGS_CHANGED:          'NOTIFY_SETTINGS_CHANGED',
  QRADAR_CONNECTION_CHANGED:        'QRADAR_CONNECTION_CHANGED',
  QRADAR_CONNECTION_CHANGE_DENIED:  'QRADAR_CONNECTION_CHANGE_DENIED',
  QRADAR_CONNECTION_TEST:           'QRADAR_CONNECTION_TEST',
  QDRANT_CONNECTION_CHANGED:        'QDRANT_CONNECTION_CHANGED',
  QDRANT_CONNECTION_CHANGE_DENIED:  'QDRANT_CONNECTION_CHANGE_DENIED',
  QDRANT_CONNECTION_TEST:           'QDRANT_CONNECTION_TEST',
  CROWDSEC_CONNECTION_CHANGED:      'CROWDSEC_CONNECTION_CHANGED',
  CROWDSEC_CONNECTION_CHANGE_DENIED:'CROWDSEC_CONNECTION_CHANGE_DENIED',
  CROWDSEC_CONNECTION_TEST:         'CROWDSEC_CONNECTION_TEST',
  IMAP_CONNECTION_CHANGED:          'IMAP_CONNECTION_CHANGED',
  IMAP_CONNECTION_CHANGE_DENIED:    'IMAP_CONNECTION_CHANGE_DENIED',
  IMAP_CONNECTION_TEST:             'IMAP_CONNECTION_TEST',
  SERVICENOW_CONNECTION_CHANGED:       'SERVICENOW_CONNECTION_CHANGED',
  SERVICENOW_CONNECTION_CHANGE_DENIED: 'SERVICENOW_CONNECTION_CHANGE_DENIED',
  SERVICENOW_CONNECTION_TEST:          'SERVICENOW_CONNECTION_TEST',
  OTRS_CONNECTION_CHANGED:          'OTRS_CONNECTION_CHANGED',
  OTRS_CONNECTION_CHANGE_DENIED:    'OTRS_CONNECTION_CHANGE_DENIED',
  OTRS_CONNECTION_TEST:             'OTRS_CONNECTION_TEST',
  WEBHOOK_SECRETS_CHANGED:          'WEBHOOK_SECRETS_CHANGED',
  OIDC_CONFIG_CHANGE_DENIED:        'OIDC_CONFIG_CHANGE_DENIED',
};

class AuditService {
  constructor(repository = null) {
    this._repo   = repository;
    this._log    = [];           // In-Memory für P6, PostgreSQL in P6-Integration
  }

  async write({ actorUserId = null, actorLabel = '', action, targetType = '', targetId = '', metadata = {}, ip = '' }) {
    const ipHash = hashIp(ip);
    const entry = {
      id:          crypto.randomUUID(),
      actorUserId,
      actorLabel,
      action,
      targetType,
      targetId:    String(targetId),
      metadata,
      ip:          ipHash,   // pseudonymisiert (Art. 25) — nie die rohe IP
      createdAt:   new Date().toISOString(),
    };

    // Strukturiertes Logging — immer, auch ohne DB (ebenfalls pseudonymisiert)
    logger.info('audit', {
      action,
      actorLabel,
      targetType,
      targetId: entry.targetId,
      ip: ipHash,
    });

    if (this._repo) {
      await this._repo.save(entry);
    } else {
      this._log.push(entry);
    }

    return entry;
  }

  // Letzte Audit-Einträge (Activity-Feed). Postgres → Repo; sonst interner _log.
  // Gibt { data, total, limit, offset } zurück — nie ein nacktes Array.
  async findRecent({ limit = 50, offset = 0, action = '', targetType = '', targetId = '', search = '' } = {}) {
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const off = Math.max(Number(offset) || 0, 0);
    const q   = String(search || '').trim().toLowerCase();

    if (this._repo) {
      return this._repo.findRecent({
        limit:      lim,
        offset:     off,
        action:     action     || undefined,
        targetType: targetType || undefined,
        targetId:   targetId   ? String(targetId) : undefined,
        search:     q || undefined,
      });
    }

    // InMemory-Pfad: Filter → Suche → Gesamtmenge zählen → Slicen
    let rows = [...this._log].reverse();
    if (action)     rows = rows.filter((e) => e.action === action);
    if (targetType) rows = rows.filter((e) => e.targetType === targetType);
    if (targetId)   rows = rows.filter((e) => e.targetId === String(targetId));
    // A6a: Suche über erlaubte Felder — Actor, Action, Target-Typ, Target-Referenz (z. B. Ticket-ID).
    if (q) {
      rows = rows.filter((e) =>
        `${e.actorLabel || ''} ${e.action || ''} ${e.targetType || ''} ${e.targetId || ''}`
          .toLowerCase().includes(q));
    }

    const total = rows.length;
    const data  = rows.slice(off, off + lim);

    return { data, total, limit: lim, offset: off };
  }

  // Test-Hilfsmethode
  getLog()   { return [...this._log]; }
  clearLog() { this._log = []; }
}

// Default-Singleton: Postgres-Repo bei DB_ENABLED, sonst null → interner _log
const { createAuditRepository } = require('../repositories/auditRepositoryFactory');
const auditService = new AuditService(createAuditRepository());
module.exports = { AuditService, auditService, AUDIT_ACTIONS };
