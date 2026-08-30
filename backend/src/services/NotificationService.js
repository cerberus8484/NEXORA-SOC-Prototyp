'use strict';

const { Notification } = require('../domain/Notification');
const { createNotificationRepository } = require('../repositories/notificationRepositoryFactory');
const logger = require('../logger');
const { deliverOutbound: _defaultDeliverOutbound } = require('./notificationOutbound');

/**
 * NotificationService — In-App-Benachrichtigungen.
 *
 * Alle Operationen sind user-scoped: ein User sieht und verwaltet nur seine eigenen
 * Notifications. broadcastToRoles() ist best-effort — ein Fehler pro User stoppt nie
 * die gesamte Fan-out-Schleife.
 */
class NotificationService {
  /**
   * @param {{ repo?: object, userRepo?: object, deliverOutbound?: Function }} opts
   *   repo            — NotificationRepository (InMemory oder Postgres via Factory)
   *   userRepo        — UserRepository — wird für broadcastToRoles() benötigt
   *   deliverOutbound — Outbound-Funktion (injizierbar für Tests; Default: _defaultDeliverOutbound)
   */
  constructor({ repo, userRepo, deliverOutbound } = {}) {
    this._repo            = repo            || createNotificationRepository();
    this._userRepo        = userRepo        || null;
    this._deliverOutbound = deliverOutbound || _defaultDeliverOutbound;
  }

  /**
   * Legt eine neue Notification an.
   * Validierung liegt im Domain-Modell (Notification.create wirft bei Fehler).
   * @param {object} data — userId, title, severity?, body?, source?, link?
   * @returns {Promise<object>} gespeicherte Notification (plain JSON)
   */
  async create(data = {}) {
    const n = Notification.create(data);
    return this._repo.create(n);
  }

  /**
   * Gibt alle Notifications eines Users zurück (neueste zuerst).
   * Gibt zusätzlich unreadCount für den UI-Badge mit zurück.
   * @param {string} userId
   * @param {{ unreadOnly?: boolean, limit?: number }} opts
   * @returns {Promise<{ data: object[], total: number, unreadCount: number }>}
   */
  async listForUser(userId, opts = {}) {
    const [data, unreadCount] = await Promise.all([
      this._repo.listForUser(userId, opts),
      this._repo.unreadCount(userId),
    ]);
    return { data, total: data.length, unreadCount };
  }

  /**
   * Gibt die Anzahl ungelesener Notifications eines Users zurück.
   * @param {string} userId
   * @returns {Promise<number>}
   */
  async unreadCount(userId) {
    return this._repo.unreadCount(userId);
  }

  /**
   * Markiert eine Notification als gelesen — NUR die eigene.
   * Gibt null zurück wenn die Notification nicht dem User gehört oder nicht existiert.
   * @param {string} id
   * @param {string} userId
   * @returns {Promise<object|null>}
   */
  async markRead(id, userId) {
    return this._repo.markRead(id, userId);
  }

  /**
   * Markiert alle ungelesenen Notifications eines Users als gelesen.
   * @param {string} userId
   * @returns {Promise<{ updated: number }>}
   */
  async markAllRead(userId) {
    const updated = await this._repo.markAllRead(userId);
    return { updated };
  }

  /**
   * Sendet eine Notification an alle aktiven User mit einer der gegebenen Rollen.
   * Fan-out: ein Fehler pro User bricht die Schleife NICHT ab (best-effort).
   * Stürzt nie ab — Logging statt throw.
   *
   * @param {string[]} roles — z.B. ['analyst', 'engineer', 'admin']
   * @param {{ severity, title, body?, source?, link? }} payload
   */
  async broadcastToRoles(roles, payload) {
    if (!Array.isArray(roles) || roles.length === 0) return;

    let users = [];
    try {
      if (!this._userRepo) {
        logger.warn('notification_broadcast_skipped', { reason: 'kein userRepo konfiguriert' });
        return;
      }
      users = await this._userRepo.findAll();
    } catch (err) {
      logger.error('notification_broadcast_user_fetch_failed', { error: err.message });
      return; // best-effort: kein throw
    }

    const targets = users.filter(
      (u) => u.isActive && roles.includes(u.role)
    );

    // ── In-App Fan-out (unverändert) ─────────────────────────────────────────
    for (const user of targets) {
      try {
        await this.create({ ...payload, userId: user.id });
      } catch (err) {
        // Einzelfehler loggen, aber nie die gesamte Fan-out-Schleife abbrechen
        logger.error('notification_broadcast_single_failed', {
          userId: user.id,
          error: err.message,
        });
      }
    }

    // ── Outbound-Versand — genau EINMAL pro Broadcast, best-effort ───────────
    // Läuft NACH dem In-App-Fan-out; ein Fehler hier darf nie Tickets/Broadcasts
    // brechen. URL / Secret tauchen in Logs oder Rückgabewerten NICHT auf.
    try {
      await this._deliverOutbound(payload);
    } catch (err) {
      logger.warn('notification_outbound_error', { error: err.message });
    }
  }
}

// Singleton für Route-Injection (identisches Muster wie evidenceService/auditService).
// userRepo wird lazy aus authService gezogen — vermeidet zirkuläre require-Abhängigkeit
// (authService lädt nach, notificationService früher).
const notificationService = new NotificationService();

// Lazy-Wire: beim ersten broadcastToRoles()-Aufruf userRepo aus authService holen.
const _originalBroadcast = notificationService.broadcastToRoles.bind(notificationService);
notificationService.broadcastToRoles = async function lazyBroadcast(roles, payload) {
  if (!this._userRepo) {
    try {
      // Lazy-require verhindert zirkuläre Abhängigkeit zur Startzeit.
      const { authService } = require('./AuthService');
      this._userRepo = authService._users;
    } catch {
      // Fallback: kein userRepo verfügbar — broadcast wird übersprungen
    }
  }
  return _originalBroadcast(roles, payload);
};

module.exports = { NotificationService, notificationService };
